-- 0050_competition_mode.sql
--
-- Two ways to run a competition here, chosen per competition rather than
-- assumed:
--
--   managed     Squadroom owns the draw, the ladder and the finals.
--               For a tournament or gala day nobody else is running.
--
--   comms_only  Someone else - Dribl, usually - owns the competition. We are
--               the chat and the notifications: one place to reach forty
--               clubs, and fixtures imported so parents still get reminders
--               and RSVPs.
--
-- The mode is enforced, not merely respected by the UI. A league that keeps
-- Dribl must not end up with a second, divergent ladder because somebody
-- found the button - two sources of truth for who won is worse than one
-- source you dislike.

create type public.competition_mode as enum ('managed', 'comms_only');

alter table public.competitions
  add column mode public.competition_mode not null default 'managed';

comment on column public.competitions.mode is
  'managed: we run the draw and ladder. comms_only: someone else does, and we
   are the communication layer. Enforced in generate_fixtures and
   create_finals.';

-- The generator body moves into app_private-style internal function so the
-- public entry point can check the mode first. Same algorithm as 0047; the
-- only change is the guard and the explicit stage = 'group'.
create or replace function public.generate_fixtures_managed(
  p_competition uuid, p_division text, p_start_at timestamptz,
  p_game_mins integer, p_gap_mins integer, p_fields text[],
  p_venue_label text, p_replace boolean
) returns integer
language plpgsql security definer set search_path = public as $fn$
declare
  v_groups text[]; v_group text; v_ids uuid[]; v_n integer; v_rounds integer;
  v_r integer; v_i integer; v_home uuid; v_away uuid; v_rotated uuid[];
  v_pair_home uuid[] := '{}'; v_pair_away uuid[] := '{}';
  v_pair_group text[] := '{}'; v_pair_round integer[] := '{}';
  v_done boolean[] := '{}'; v_total integer; v_placed integer := 0;
  v_slot integer := 0; v_field integer; v_busy uuid[]; v_k integer;
  v_assigned boolean; v_start timestamptz;
begin
  if not app_private.is_competition_organiser(p_competition) then
    raise exception 'only the organiser can build the draw' using errcode = '42501';
  end if;
  if coalesce(array_length(p_fields, 1), 0) = 0 then
    raise exception 'give me at least one field' using errcode = '22023';
  end if;

  if p_replace then
    delete from public.fixtures
     where competition_id = p_competition and division = p_division
       and stage = 'group' and status = 'scheduled' and home_score is null;
  end if;

  select coalesce(array_agg(distinct coalesce(group_label, '')), '{}') into v_groups
    from public.competition_entries
   where competition_id = p_competition and division = p_division;

  foreach v_group in array v_groups loop
    select array_agg(id order by coalesce(seed, 0), display_name) into v_ids
      from public.competition_entries
     where competition_id = p_competition and division = p_division
       and coalesce(group_label, '') = v_group;

    if coalesce(array_length(v_ids, 1), 0) < 2 then continue; end if;
    if array_length(v_ids, 1) % 2 = 1 then v_ids := v_ids || null::uuid; end if;

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
      v_rotated := array[v_ids[1]] || v_ids[v_n] || v_ids[2:v_n-1];
      v_ids := v_rotated;
    end loop;
  end loop;

  v_total := coalesce(array_length(v_pair_home, 1), 0);
  if v_total = 0 then return 0; end if;

  while v_placed < v_total loop
    v_busy := '{}';
    v_assigned := false;
    v_start := p_start_at + (v_slot * (p_game_mins + p_gap_mins) || ' minutes')::interval;

    for v_field in 1..array_length(p_fields, 1) loop
      for v_k in 1..v_total loop
        if v_done[v_k] then continue; end if;
        if v_pair_home[v_k] = any(v_busy) or v_pair_away[v_k] = any(v_busy) then continue; end if;

        insert into public.fixtures (
          competition_id, division, group_label, round, stage,
          home_entry_id, away_entry_id,
          starts_at, duration_mins, venue_label, field_label, status
        )
        values (
          p_competition, p_division, nullif(v_pair_group[v_k], ''),
          'Round ' || v_pair_round[v_k], 'group',
          v_pair_home[v_k], v_pair_away[v_k],
          v_start, p_game_mins, p_venue_label, p_fields[v_field], 'scheduled'
        );

        v_busy := v_busy || v_pair_home[v_k] || v_pair_away[v_k];
        v_done[v_k] := true;
        v_placed := v_placed + 1;
        v_assigned := true;
        exit;
      end loop;
    end loop;

    if not v_assigned and v_slot > v_total * 2 then
      raise exception 'could not schedule % remaining games', v_total - v_placed;
    end if;

    v_slot := v_slot + 1;
  end loop;

  return v_placed;
end;
$fn$;

revoke execute on function public.generate_fixtures_managed(uuid, text, timestamptz, integer, integer, text[], text, boolean) from public, anon, authenticated;
grant execute on function public.generate_fixtures_managed(uuid, text, timestamptz, integer, integer, text[], text, boolean) to service_role;

-- Building a draw for a competition somebody else runs would create a second
-- version of the truth.
create or replace function public.generate_fixtures(
  p_competition uuid, p_division text, p_start_at timestamptz,
  p_game_mins integer default 20, p_gap_mins integer default 5,
  p_fields text[] default array['Field 1'], p_venue_label text default null,
  p_replace boolean default false
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_mode public.competition_mode;
begin
  select mode into v_mode from public.competitions where id = p_competition;
  if v_mode = 'comms_only' then
    raise exception 'This competition is run elsewhere. Squadroom handles its messages and reminders, not its draw.'
      using errcode = '22023';
  end if;
  return public.generate_fixtures_managed(
    p_competition, p_division, p_start_at, p_game_mins, p_gap_mins,
    p_fields, p_venue_label, p_replace);
end;
$$;

revoke execute on function public.generate_fixtures(uuid, text, timestamptz, integer, integer, text[], text, boolean) from public, anon;
grant execute on function public.generate_fixtures(uuid, text, timestamptz, integer, integer, text[], text, boolean) to authenticated;
