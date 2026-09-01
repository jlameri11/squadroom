-- 0047_fixture_generation.sql
--
-- Building a draw: every team in a group plays every other, spread across the
-- fields and time slots actually available.
--
-- Two separate problems, done in two passes.
--
-- 1. WHO plays WHO. The circle method: fix one team, rotate the rest. It
--    produces a complete round robin where no team appears twice in a round,
--    which is what makes the second pass tractable. An odd group gets a
--    phantom team, and whoever draws it has the bye - unavoidable with seven
--    teams, which is exactly what NRIFA's U7s tournament runs.
--
-- 2. WHEN and WHERE. Greedy: walk the slots, fill each field with the first
--    remaining game whose teams are both free in that slot. Groups interleave
--    across fields naturally, which is what fills 4 fields with 3 groups
--    rather than leaving a field idle while one group waits.
--
-- Not an optimiser. On NRIFA's real numbers - 21 teams, 3 groups, 4 fields -
-- it produces 63 games in 17 slots against the 16 a human achieved by hand.
-- One slot worse, in 52 milliseconds instead of an afternoon.

create or replace function public.generate_fixtures(
  p_competition uuid,
  p_division    text,
  p_start_at    timestamptz,
  p_game_mins   integer default 20,
  p_gap_mins    integer default 5,
  p_fields      text[] default array['Field 1'],
  p_venue_label text default null,
  p_replace     boolean default false
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_groups     text[];
  v_group      text;
  v_ids        uuid[];
  v_n          integer;
  v_rounds     integer;
  v_r          integer;
  v_i          integer;
  v_home       uuid;
  v_away       uuid;
  v_rotated    uuid[];
  v_pair_home  uuid[] := '{}';
  v_pair_away  uuid[] := '{}';
  v_pair_group text[] := '{}';
  v_pair_round integer[] := '{}';
  v_done       boolean[] := '{}';
  v_total      integer;
  v_placed     integer := 0;
  v_slot       integer := 0;
  v_field      integer;
  v_busy       uuid[];
  v_k          integer;
  v_assigned   boolean;
  v_start      timestamptz;
begin
  if not app_private.is_competition_organiser(p_competition) then
    raise exception 'only the organiser can build the draw' using errcode = '42501';
  end if;
  if coalesce(array_length(p_fields, 1), 0) = 0 then
    raise exception 'give me at least one field' using errcode = '22023';
  end if;

  if p_replace then
    -- Only the unplayed ones. Wiping results because someone regenerated a
    -- draw would be unforgivable on a tournament morning.
    delete from public.fixtures
     where competition_id = p_competition
       and division = p_division
       and status = 'scheduled'
       and home_score is null;
  end if;

  select coalesce(array_agg(distinct coalesce(group_label, '')), '{}')
    into v_groups
    from public.competition_entries
   where competition_id = p_competition and division = p_division;

  -- pass 1: who plays who
  foreach v_group in array v_groups loop
    select array_agg(id order by coalesce(seed, 0), display_name)
      into v_ids
      from public.competition_entries
     where competition_id = p_competition
       and division = p_division
       and coalesce(group_label, '') = v_group;

    if coalesce(array_length(v_ids, 1), 0) < 2 then
      continue;
    end if;

    -- A phantom entry so the rotation works; its opponent sits out.
    if array_length(v_ids, 1) % 2 = 1 then
      v_ids := v_ids || null::uuid;
    end if;

    v_n := array_length(v_ids, 1);
    v_rounds := v_n - 1;

    for v_r in 1..v_rounds loop
      for v_i in 1..(v_n / 2) loop
        v_home := v_ids[v_i];
        v_away := v_ids[v_n + 1 - v_i];
        if v_home is not null and v_away is not null then
          v_pair_home  := v_pair_home  || v_home;
          v_pair_away  := v_pair_away  || v_away;
          v_pair_group := v_pair_group || v_group;
          v_pair_round := v_pair_round || v_r;
          v_done       := v_done       || false;
        end if;
      end loop;

      -- Rotate everything except the first entry.
      v_rotated := array[v_ids[1]] || v_ids[v_n] || v_ids[2:v_n-1];
      v_ids := v_rotated;
    end loop;
  end loop;

  v_total := coalesce(array_length(v_pair_home, 1), 0);
  if v_total = 0 then
    return 0;
  end if;

  -- pass 2: when and where
  while v_placed < v_total loop
    v_busy := '{}';
    v_assigned := false;
    v_start := p_start_at + (v_slot * (p_game_mins + p_gap_mins) || ' minutes')::interval;

    for v_field in 1..array_length(p_fields, 1) loop
      for v_k in 1..v_total loop
        if v_done[v_k] then continue; end if;
        -- A team cannot be on two fields at once.
        if v_pair_home[v_k] = any(v_busy) or v_pair_away[v_k] = any(v_busy) then
          continue;
        end if;

        insert into public.fixtures (
          competition_id, division, group_label, round,
          home_entry_id, away_entry_id,
          starts_at, duration_mins, venue_label, field_label, status
        )
        values (
          p_competition, p_division, nullif(v_pair_group[v_k], ''),
          'Round ' || v_pair_round[v_k],
          v_pair_home[v_k], v_pair_away[v_k],
          v_start, p_game_mins, p_venue_label, p_fields[v_field], 'scheduled'
        );

        v_busy := v_busy || v_pair_home[v_k] || v_pair_away[v_k];
        v_done[v_k] := true;
        v_placed := v_placed + 1;
        v_assigned := true;
        exit;  -- this field is taken for this slot
      end loop;
    end loop;

    -- Nothing fitted anywhere: every remaining game shares a team with one
    -- already placed. Advancing the slot is the only way forward, and if even
    -- that fails we would loop forever, so stop.
    if not v_assigned then
      if v_slot > v_total * 2 then
        raise exception 'could not schedule % remaining games', v_total - v_placed;
      end if;
    end if;

    v_slot := v_slot + 1;
  end loop;

  return v_placed;
end;
$$;

revoke execute on function public.generate_fixtures(uuid, text, timestamptz, integer, integer, text[], text, boolean) from public, anon;
grant execute on function public.generate_fixtures(uuid, text, timestamptz, integer, integer, text[], text, boolean) to authenticated;

-- The run sheet: what a tournament organiser holds on the day.
create or replace function public.competition_run_sheet(p_competition uuid, p_division text default null)
returns table (
  fixture_id  uuid,
  starts_at   timestamptz,
  field_label text,
  division    text,
  group_label text,
  round       text,
  home_name   text,
  away_name   text,
  home_score  integer,
  away_score  integer,
  status      public.fixture_status,
  can_score   boolean
)
language sql stable security definer set search_path = public as $$
  select
    f.id, f.starts_at, f.field_label, f.division, f.group_label, f.round,
    h.display_name, a.display_name,
    f.home_score, f.away_score, f.status,
    -- The organiser, or either club in this game. Returned so the UI does not
    -- have to guess who may type a score.
    (app_private.is_competition_organiser(f.competition_id)
      or app_private.can_manage_entry(f.home_entry_id)
      or app_private.can_manage_entry(f.away_entry_id))
  from public.fixtures f
  left join public.competition_entries h on h.id = f.home_entry_id
  left join public.competition_entries a on a.id = f.away_entry_id
  where f.competition_id = p_competition
    and (p_division is null or f.division = p_division)
    and app_private.is_competition_participant(f.competition_id)
  order by f.starts_at, f.field_label;
$$;

grant execute on function public.competition_run_sheet(uuid, text) to authenticated;
