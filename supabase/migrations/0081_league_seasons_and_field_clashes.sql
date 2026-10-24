-- 0081: the draw builder learns to build a SEASON, and stops double-booking
-- fields across divisions.
--
-- Two faults in 0047, both found by using it rather than reading it.
--
-- X-15 — IT COULD ONLY BUILD ONE DAY. Pass 2 walks consecutive slots of
-- (game_mins + gap_mins) from one start time and places any game whose teams
-- are free. That is exactly right for a gala day and cannot express a league:
-- there is no way to say "Round 1 this Sunday, Round 2 next Sunday", and the
-- greedy placement cheerfully puts Round 1 and Round 2 games in the same slot.
-- So Squadroom could run a tournament and not a season — half of what Dribl
-- is for.
--
-- `p_round_every_days` fixes it. At 0, which is the default, nothing changes
-- and a gala day draws exactly as before. Above 0, each round starts its own
-- clock that many days after the last, and only that round's games may be
-- placed in it.
--
-- X-14 — IT DOUBLE-BOOKED FIELDS ACROSS DIVISIONS. `v_busy` tracks which
-- TEAMS are occupied in a slot, so no team plays twice at once. It knows
-- nothing about fixtures already placed by an earlier call, because each call
-- assumes it owns the fields it is handed. Draw three age groups onto the same
-- four fields — which is what a gala day IS — and you get a beautiful
-- timetable with three games kicking off on Field 1 at nine.
--
-- Found while seeding NRIFA's Spring Gala Day; worked around there by giving
-- each division its own fields, which is not something a coach should have to
-- know. Now the generator checks the fixtures table for a clash on
-- (venue, field, time) before it writes, so divisions drawn one after another
-- share fields correctly.
--
-- The two together are what make "create a league or a tournament" true
-- rather than aspirational.

create or replace function public.generate_fixtures(
  p_competition uuid,
  p_division    text,
  p_start_at    timestamptz,
  p_game_mins   integer default 20,
  p_gap_mins    integer default 5,
  p_fields      text[] default array['Field 1'],
  p_venue_label text default null,
  p_replace     boolean default false,
  -- 0 means a single block of play: a gala day, drawn exactly as 0047 did.
  -- 7 means a weekly league season.
  p_round_every_days integer default 0
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
  v_round_base timestamptz;
  v_max_round  integer;
  v_this_round integer;
  v_remaining  integer;
begin
  if not app_private.is_competition_organiser(p_competition) then
    raise exception 'only the organiser can build the draw' using errcode = '42501';
  end if;
  if coalesce(array_length(p_fields, 1), 0) = 0 then
    raise exception 'give me at least one field' using errcode = '22023';
  end if;
  if p_round_every_days < 0 then
    raise exception 'rounds cannot be spaced by a negative number of days'
      using errcode = '22023';
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
          -- Alternate the nominal home side each round, or the same club
          -- heads every round's home column and ends the season with every
          -- game at its own ground.
          if v_r % 2 = 0 then
            v_pair_home := v_pair_home || v_away;
            v_pair_away := v_pair_away || v_home;
          else
            v_pair_home := v_pair_home || v_home;
            v_pair_away := v_pair_away || v_away;
          end if;
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

  select max(r) into v_max_round from unnest(v_pair_round) r;

  -- pass 2: when and where
  --
  -- One pass over the rounds. With p_round_every_days = 0 there is a single
  -- iteration that may place any game, which is 0047's behaviour exactly.
  -- Above 0, each round gets its own clock and only its own games.
  -- generate_series cannot live inside a CASE — "set-returning functions are
  -- not allowed in CASE" — so the series is always generated and filtered.
  -- Round 0 is the sentinel for "one block, any round's games".
  for v_this_round in
    select r
      from generate_series(0, case when p_round_every_days = 0 then 0 else v_max_round end) r
     where p_round_every_days = 0 or r > 0
  loop
    v_round_base := case
      when p_round_every_days = 0 then p_start_at
      else p_start_at + ((v_this_round - 1) * p_round_every_days || ' days')::interval
    end;
    v_slot := 0;

    -- How many games this iteration is responsible for.
    select count(*) into v_remaining
      from generate_subscripts(v_pair_home, 1) k
     where not v_done[k]
       and (v_this_round = 0 or v_pair_round[k] = v_this_round);

    while v_remaining > 0 loop
      v_busy := '{}';
      v_assigned := false;
      v_start := v_round_base + (v_slot * (p_game_mins + p_gap_mins) || ' minutes')::interval;

      for v_field in 1..array_length(p_fields, 1) loop
        -- X-14: a field already carrying a game at this moment is taken,
        -- whoever put it there. Another division of this competition, drawn
        -- by an earlier call, is the common case.
        if exists (
          select 1 from public.fixtures f
           where f.competition_id = p_competition
             and f.starts_at = v_start
             and f.field_label = p_fields[v_field]
             and coalesce(f.venue_label, '') = coalesce(p_venue_label, '')
        ) then
          continue;
        end if;

        for v_k in 1..v_total loop
          if v_done[v_k] then continue; end if;
          if v_this_round <> 0 and v_pair_round[v_k] <> v_this_round then continue; end if;
          -- A team cannot be on two fields at once.
          if v_pair_home[v_k] = any(v_busy) or v_pair_away[v_k] = any(v_busy) then
            continue;
          end if;
          -- Nor can it be playing elsewhere in this competition at this
          -- moment — in another division, in a game drawn by an earlier call.
          if exists (
            select 1 from public.fixtures f
             where f.competition_id = p_competition
               and f.starts_at = v_start
               and (f.home_entry_id in (v_pair_home[v_k], v_pair_away[v_k])
                 or f.away_entry_id in (v_pair_home[v_k], v_pair_away[v_k]))
          ) then
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
          v_remaining := v_remaining - 1;
          v_assigned := true;
          exit;  -- this field is taken for this slot
        end loop;
      end loop;

      -- Nothing fitted anywhere: every remaining game shares a team with one
      -- already placed, or every field is already occupied. Advancing the slot
      -- is the only way forward, and if even that fails we would loop forever,
      -- so stop.
      if not v_assigned then
        if v_slot > v_total * 2 + 24 then
          raise exception 'could not schedule % remaining games in %',
            v_remaining, coalesce('round ' || nullif(v_this_round, 0)::text, 'the block');
        end if;
      end if;

      v_slot := v_slot + 1;
    end loop;
  end loop;

  return v_placed;
end;
$$;

-- The old signature would otherwise still exist and make an eight-argument
-- call ambiguous.
drop function if exists public.generate_fixtures(
  uuid, text, timestamptz, integer, integer, text[], text, boolean
);

revoke execute on function public.generate_fixtures(
  uuid, text, timestamptz, integer, integer, text[], text, boolean, integer
) from public, anon;
grant execute on function public.generate_fixtures(
  uuid, text, timestamptz, integer, integer, text[], text, boolean, integer
) to authenticated;
