-- 0189: the draw flows, is checked, and is watched.
--
-- Three more Squadi-parity rows (SQUADI_INTEL §6A.7, §6A.8, §6A.10):
--
-- L-23  FIXTURE FLOWING. After the draw is published the league opens a
--       window (a week, say). Inside it a HOME club's proposed move of its
--       own game — within a few days of the drawn time — applies the moment
--       the other club agrees, with no league decision needed; the league is
--       told. Outside the window, or proposed by the away side, 0174's chain
--       stands: the league decides. The club-to-club notes thread is 0174's.
--
-- L-24  DRAW QUALITY. `draw_quality` reads a division's draw back as the
--       organiser would check it by hand: how often each pair meets, each
--       team's home/away balance and early/late slots, two teams of one
--       club drawn at the same time, a team with two games in a day, empty
--       field slots, a team at two grounds in a day. `field_impact` says
--       which games and clubs a closed field on a day would hit, before it
--       is closed. And ONE SOURCE OF TRUTH: a game moved by hand is PINNED,
--       and rebuilding the draw keeps it and draws around it instead of
--       overwriting it — Squadi's known flaw.
--
-- L-26  MATCH-DAY OPS. `match_day_ops` is the league's live list: sheets
--       missing from games played, scores waiting on one side or disputed,
--       games not yet ended, referee reports outstanding, games without a
--       referee this week, suspensions being served, open corrections and
--       change requests. Every row points at the game.

-- ------------------------------------------------------------ L-23 window
alter table public.competitions
  add column if not exists flowing_until timestamptz,
  add column if not exists flowing_window_days integer not null default 3;
alter table public.competitions
  drop constraint if exists competitions_flowing_window_days_check,
  add constraint competitions_flowing_window_days_check check (flowing_window_days between 0 and 14);
comment on column public.competitions.flowing_until is
  'L-23: while set and in the future, a home club''s agreed move of its own game applies without the league.';

alter table public.fixtures
  add column if not exists pinned boolean not null default false;
comment on column public.fixtures.pinned is
  'L-24: moved by hand after the draw. A rebuild keeps it and draws around it.';

do $$
declare
  v_name text;
begin
  select conname into v_name from pg_constraint
   where conrelid = 'public.notification_queue'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) like '%kind = ANY%';
  if v_name is not null then
    execute format('alter table public.notification_queue drop constraint %I', v_name);
  end if;
  alter table public.notification_queue add constraint notification_queue_kind_check check (kind = any (array[
    'message','announcement','event_reminder','poll_opened','poll_closing','rsvp_change','invite',
    'event_cancelled','event_changed','event_back_on','rsvp_nudge','announcement_repeat','wwcc_expiring',
    'guardian_erased','official_rego_pending','reregister_nudge','offer','referee_appointment',
    'referee_response','referee_withdrawn','fixture_change_proposed','fixture_change_answered',
    'fixture_change_decided','mention','match_correction_requested','match_correction_decided',
    'fixture_flowing_open']));
end $$;

-- The move itself, with no caller check: reschedule_fixture checks the
-- league, the flowing path checks the window. Both pin the game.
create or replace function app_private.apply_reschedule(p_fixture uuid, p_starts_at timestamptz, p_venue_label text, p_field text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.fixtures
     set status = 'scheduled', cancel_reason = null,
         starts_at = p_starts_at,
         venue_label = coalesce(nullif(btrim(coalesce(p_venue_label, '')), ''), venue_label),
         field_label = coalesce(nullif(btrim(coalesce(p_field, '')), ''), field_label),
         pinned = true,
         updated_at = now()
   where id = p_fixture;
end;
$$;

create or replace function public.reschedule_fixture(p_fixture uuid, p_starts_at timestamptz, p_venue_label text default null, p_field text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  f public.fixtures;
begin
  select * into f from public.fixtures where id = p_fixture;
  if f.id is null or not coalesce(app_private.may_run(f.competition_id, 'grounds'), false) then
    raise exception 'only the organiser can reschedule a game' using errcode = '42501';
  end if;
  if f.status in ('final', 'forfeit') then
    raise exception 'this game has been played' using errcode = '22023';
  end if;
  if p_starts_at is null then
    raise exception 'a rescheduled game needs a time' using errcode = '22023';
  end if;
  perform app_private.apply_reschedule(p_fixture, p_starts_at, p_venue_label, p_field);
end;
$$;

create or replace function public.set_fixture_flowing(p_competition uuid, p_until timestamptz, p_days integer default 3)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_who uuid;
  v_name text;
begin
  if not coalesce(app_private.may_run(p_competition, 'grounds'), false) then
    raise exception 'only the league opens fixture flowing' using errcode = '42501';
  end if;
  update public.competitions
     set flowing_until = p_until, flowing_window_days = coalesce(p_days, flowing_window_days), updated_at = now()
   where id = p_competition;
  if p_until is not null and p_until > now() then
    select name into v_name from public.competitions where id = p_competition;
    -- Every club's managers hear that the window is open.
    for v_who in
      select distinct m from public.competition_entries e
        cross join lateral app_private.entry_managers(e.id) m
       where e.competition_id = p_competition
    loop
      insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload, dedupe_key)
      select c.organiser_id, v_who, 'fixture_flowing_open',
             'Fixture flowing is open: ' || coalesce(v_name, 'the draw'),
             'Home clubs may move their own games until ' || to_char(p_until at time zone app_private.competition_tz(p_competition), 'FMDay FMDD Mon')
               || ' — propose a time, and once the other club agrees it is done.',
             '/competitions/' || p_competition || '?tab=clubs',
             jsonb_build_object('competition_id', p_competition),
             'flowing-' || p_competition || '-' || v_who || '-' || extract(epoch from now())::bigint
        from public.competitions c where c.id = p_competition;
    end loop;
  end if;
end;
$$;

-- 0174's answer, with the flowing rule added: agreed + home side + inside
-- the window + near the drawn time = done.
create or replace function public.answer_fixture_change(p_request uuid, p_agree boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_req   public.fixture_change_requests;
  v_fx    public.fixtures;
  v_comp  public.competitions;
  v_who   uuid;
  v_flow  boolean := false;
begin
  select * into v_req from public.fixture_change_requests where id = p_request;
  if v_req.id is null or v_req.other_entry_id is null or not coalesce(app_private.can_manage_entry(v_req.other_entry_id), false) then
    raise exception 'only the other team answers a change' using errcode = '42501';
  end if;
  if v_req.status <> 'proposed' then
    raise exception 'already %', v_req.status using errcode = '22023';
  end if;
  select * into v_fx from public.fixtures where id = v_req.fixture_id;
  select * into v_comp from public.competitions where id = v_req.competition_id;

  if p_agree
     and v_comp.flowing_until is not null and v_comp.flowing_until > now()
     and v_req.by_entry_id = v_fx.home_entry_id
     and v_fx.status in ('scheduled', 'postponed')
     and (v_req.proposed_starts_at is null
          or abs(extract(epoch from (v_req.proposed_starts_at - v_fx.starts_at))) <= v_comp.flowing_window_days * 86400) then
    v_flow := true;
  end if;

  update public.fixture_change_requests
     set status = case when not p_agree then 'declined' when v_flow then 'approved' else 'agreed' end::public.change_request_status,
         answered_by = auth.uid(), answered_at = now(), answer_note = nullif(btrim(coalesce(p_note, '')), ''),
         decided_at = case when v_flow then now() end,
         decision_note = case when v_flow then 'Agreed by both clubs inside the fixture-flowing window' end
   where id = p_request;

  if v_flow then
    perform app_private.apply_reschedule(v_req.fixture_id, coalesce(v_req.proposed_starts_at, v_fx.starts_at),
                                         coalesce(v_req.proposed_venue, v_fx.venue_label), coalesce(v_req.proposed_field, v_fx.field_label));
  end if;

  for v_who in select * from app_private.entry_managers(v_req.by_entry_id) loop
    perform app_private.change_request_push(p_request, v_who,
      case when v_flow then 'fixture_change_decided' else 'fixture_change_answered' end,
      (select display_name from public.competition_entries where id = v_req.other_entry_id)
        || case when not p_agree then ' can''t do that time' when v_flow then ' agree — the game is moved' else ' agree to the move' end,
      coalesce(nullif(btrim(coalesce(p_note, '')), ''),
               case when not p_agree then 'Propose another.' when v_flow then 'Inside the fixture-flowing window, so it is done.' else 'The league decides next.' end));
  end loop;
  if v_flow then
    -- The league's grounds people, less anyone already told as a club manager
    -- (the seed's NRIFA owner also runs the SPL).
    for v_who in
      select * from app_private.area_holders(v_req.competition_id, 'grounds')
      except select * from app_private.entry_managers(v_req.by_entry_id)
    loop
      perform app_private.change_request_push(p_request, v_who, 'fixture_change_decided',
        'Moved by the clubs: ' || (select h.display_name from public.competition_entries h where h.id = v_fx.home_entry_id)
          || ' v ' || (select a.display_name from public.competition_entries a where a.id = v_fx.away_entry_id),
        'Agreed inside the fixture-flowing window — ' || coalesce(to_char(v_req.proposed_starts_at at time zone app_private.competition_tz(v_req.competition_id), 'FMDay FMDD Mon, FMHH12:MIam'), 'same time')
          || coalesce(' · ' || v_req.proposed_venue, ''));
    end loop;
  end if;
end;
$$;

-- -------------------------------------------------------- L-24 the rebuild
-- 0047/0081's builder, with two changes: a rebuild keeps PINNED games, and
-- a pair that a pinned game already covers is not drawn again.
create or replace function public.generate_fixtures_managed(
  p_competition uuid, p_division text, p_start_at timestamptz,
  p_game_mins integer default 20, p_gap_mins integer default 5,
  p_fields text[] default array['Field 1'::text], p_venue_label text default null,
  p_replace boolean default false, p_round_every_days integer default 0
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
    -- Only the unplayed, unpinned ones. Wiping results because someone
    -- regenerated a draw would be unforgivable on a tournament morning, and
    -- wiping a game the league moved by hand is Squadi's known flaw.
    delete from public.fixtures
     where competition_id = p_competition
       and division = p_division
       and status = 'scheduled'
       and home_score is null
       and not pinned;
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
          if v_r % 2 = 0 then
            v_pair_home := v_pair_home || v_away;
            v_pair_away := v_pair_away || v_home;
          else
            v_pair_home := v_pair_home || v_home;
            v_pair_away := v_pair_away || v_away;
          end if;
          v_pair_group := v_pair_group || v_group;
          v_pair_round := v_pair_round || v_r;
          -- L-24: a pair a pinned game already covers is drawn already.
          v_done := v_done || exists (
            select 1 from public.fixtures f
             where f.competition_id = p_competition and f.division = p_division and f.pinned
               and ((f.home_entry_id = v_home and f.away_entry_id = v_away)
                 or (f.home_entry_id = v_away and f.away_entry_id = v_home)));
        end if;
      end loop;

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

    select count(*) into v_remaining
      from generate_subscripts(v_pair_home, 1) k
     where not v_done[k]
       and (v_this_round = 0 or v_pair_round[k] = v_this_round);

    while v_remaining > 0 loop
      v_busy := '{}';
      v_assigned := false;
      v_start := v_round_base + (v_slot * (p_game_mins + p_gap_mins) || ' minutes')::interval;

      for v_field in 1..array_length(p_fields, 1) loop
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
          if v_pair_home[v_k] = any(v_busy) or v_pair_away[v_k] = any(v_busy) then
            continue;
          end if;
          -- Nor playing elsewhere in this competition at this moment — a
          -- pinned game, or another division drawn earlier.
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
          exit;
        end loop;
      end loop;

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

-- --------------------------------------------------------- L-24 the check
create or replace function public.draw_quality(p_competition uuid, p_division text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text;
begin
  if not coalesce(app_private.may_run(p_competition, 'competition'), false) then
    return null;
  end if;
  v_tz := app_private.competition_tz(p_competition);
  return jsonb_build_object(
    'games', (select count(*) from public.fixtures f
               where f.competition_id = p_competition and f.division = p_division
                 and f.status not in ('cancelled', 'bye')),
    'pinned', (select count(*) from public.fixtures f
                where f.competition_id = p_competition and f.division = p_division and f.pinned),
    -- Each team: games, home, away, first slot of the day, last slot of the day.
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object('entry_id', t.id, 'name', t.name, 'games', t.games,
               'home', t.home, 'away', t.away, 'early', t.early, 'late', t.late) order by t.name)
        from (
          select e.id, e.display_name as name,
                 count(f.id) as games,
                 count(f.id) filter (where f.home_entry_id = e.id) as home,
                 count(f.id) filter (where f.away_entry_id = e.id) as away,
                 count(f.id) filter (where f.starts_at = d.first_at) as early,
                 count(f.id) filter (where f.starts_at = d.last_at) as late
            from public.competition_entries e
            left join public.fixtures f
              on f.competition_id = e.competition_id and f.division = e.division
             and (f.home_entry_id = e.id or f.away_entry_id = e.id)
             and f.status not in ('cancelled', 'bye')
            left join lateral (
              select min(x.starts_at) as first_at, max(x.starts_at) as last_at
                from public.fixtures x
               where x.competition_id = p_competition and x.division = p_division
                 and (x.starts_at at time zone v_tz)::date = (f.starts_at at time zone v_tz)::date
            ) d on true
           where e.competition_id = p_competition and e.division = p_division
           group by e.id, e.display_name
        ) t), '[]'::jsonb),
    -- Pairs: how often each pair meets; the ones that differ from the usual
    -- count named. Counted per unordered pair first, then summarised.
    'pairs', (
      select jsonb_build_object('min', coalesce(min(pc.c), 0), 'max', coalesce(max(pc.c), 0),
               'uneven', coalesce(jsonb_agg(jsonb_build_object(
                           'a', (select e.display_name from public.competition_entries e where e.id = pc.a),
                           'b', (select e.display_name from public.competition_entries e where e.id = pc.b),
                           'games', pc.c))
                           filter (where pc.c <> (select mode() within group (order by m.c) from (
                             select count(*) as c from public.fixtures y
                              where y.competition_id = p_competition and y.division = p_division
                                and y.home_entry_id is not null and y.away_entry_id is not null
                                and y.status not in ('cancelled', 'bye')
                              group by least(y.home_entry_id, y.away_entry_id), greatest(y.home_entry_id, y.away_entry_id)) m)), '[]'::jsonb))
        from (
          select least(f.home_entry_id, f.away_entry_id) as a,
                 greatest(f.home_entry_id, f.away_entry_id) as b,
                 count(*) as c
            from public.fixtures f
           where f.competition_id = p_competition and f.division = p_division
             and f.home_entry_id is not null and f.away_entry_id is not null
             and f.status not in ('cancelled', 'bye')
           group by least(f.home_entry_id, f.away_entry_id), greatest(f.home_entry_id, f.away_entry_id)
        ) pc),
    -- Two entries of one club at the same moment, any division.
    'club_clashes', coalesce((
      select jsonb_agg(jsonb_build_object('at', q.at, 'club', q.club, 'games', q.games) order by q.at)
        from (
          select f.starts_at as at, a.name as club,
                 jsonb_agg(distinct (h.display_name || ' v ' || w.display_name)) as games
            from public.fixtures f
            join public.competition_entries h on h.id = f.home_entry_id
            join public.competition_entries w on w.id = f.away_entry_id
            join public.competition_entries e on e.id in (f.home_entry_id, f.away_entry_id) and e.academy_id is not null
            join public.academies a on a.id = e.academy_id
           where f.competition_id = p_competition and f.status not in ('cancelled', 'bye')
             and (f.division = p_division or exists (select 1 from public.fixtures z where z.competition_id = p_competition and z.division = p_division and z.starts_at = f.starts_at))
           group by f.starts_at, a.name
          having count(distinct f.id) > 1
        ) q), '[]'::jsonb),
    -- A team with two games on one day.
    'double_headers', coalesce((
      select jsonb_agg(jsonb_build_object('team', q.team, 'day', q.day, 'games', q.games) order by q.day, q.team)
        from (
          select e.display_name as team, (f.starts_at at time zone v_tz)::date as day, count(*) as games
            from public.fixtures f
            join public.competition_entries e on e.id in (f.home_entry_id, f.away_entry_id)
           where f.competition_id = p_competition and f.division = p_division
             and f.status not in ('cancelled', 'bye')
           group by e.display_name, (f.starts_at at time zone v_tz)::date
          having count(*) > 1
        ) q), '[]'::jsonb),
    -- A team at two grounds on one day.
    'travel', coalesce((
      select jsonb_agg(jsonb_build_object('team', q.team, 'day', q.day, 'grounds', q.grounds) order by q.day, q.team)
        from (
          select e.display_name as team, (f.starts_at at time zone v_tz)::date as day,
                 jsonb_agg(distinct coalesce(f.venue_label, '?')) as grounds
            from public.fixtures f
            join public.competition_entries e on e.id in (f.home_entry_id, f.away_entry_id)
           where f.competition_id = p_competition and f.division = p_division
             and f.status not in ('cancelled', 'bye')
           group by e.display_name, (f.starts_at at time zone v_tz)::date
          having count(distinct coalesce(f.venue_label, '?')) > 1
        ) q), '[]'::jsonb),
    -- Empty slots: a time at which some field of the day is used and this one is not.
    'empty_slots', coalesce((
      select jsonb_agg(jsonb_build_object('at', s.at, 'venue', s.venue, 'field', s.field) order by s.at, s.field)
        from (
          select times.at, fields.venue, fields.field
            from (select distinct f.starts_at as at, coalesce(f.venue_label, '') as venue
                    from public.fixtures f
                   where f.competition_id = p_competition and f.division = p_division and f.status not in ('cancelled', 'bye')) times
            join (select distinct coalesce(f.venue_label, '') as venue, f.field_label as field
                    from public.fixtures f
                   where f.competition_id = p_competition and f.division = p_division and f.field_label is not null
                     and f.status not in ('cancelled', 'bye')) fields on fields.venue = times.venue
           where not exists (
             select 1 from public.fixtures g
              where g.competition_id = p_competition
                and g.starts_at = times.at and coalesce(g.venue_label, '') = fields.venue and g.field_label = fields.field
                and g.status not in ('cancelled', 'bye'))
        ) s), '[]'::jsonb)
  );
end;
$$;

create or replace function public.field_impact(p_competition uuid, p_date date, p_venue text default null, p_field text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text;
begin
  if not coalesce(app_private.may_run(p_competition, 'grounds'), false) then
    return null;
  end if;
  v_tz := app_private.competition_tz(p_competition);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'fixture_id', f.id, 'starts_at', f.starts_at, 'division', f.division, 'round', f.round,
             'venue', coalesce(v.name, f.venue_label), 'field', f.field_label,
             'home', h.display_name, 'away', a.display_name,
             'clubs', (select jsonb_agg(distinct ac.name) from public.competition_entries e
                        join public.academies ac on ac.id = e.academy_id
                       where e.id in (f.home_entry_id, f.away_entry_id)))
             order by f.starts_at, f.field_label)
      from public.fixtures f
      left join public.venues v on v.id = f.venue_id
      left join public.competition_entries h on h.id = f.home_entry_id
      left join public.competition_entries a on a.id = f.away_entry_id
     where f.competition_id = p_competition
       and f.status in ('scheduled', 'in_progress')
       and (f.starts_at at time zone v_tz)::date = p_date
       and (p_venue is null or coalesce(v.name, f.venue_label, '') ilike '%' || btrim(p_venue) || '%')
       and (p_field is null or f.field_label = p_field)
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------- L-26 the ops
create or replace function public.match_day_ops(p_competition uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_any boolean;
begin
  v_any := coalesce(app_private.may_run(p_competition, 'competition'), false)
        or coalesce(app_private.may_run(p_competition, 'referees'), false)
        or coalesce(app_private.may_run(p_competition, 'discipline'), false)
        or coalesce(app_private.may_run(p_competition, 'grounds'), false);
  if not v_any then
    return null;
  end if;
  return jsonb_build_object(
    'missing_sheets', coalesce((
      select jsonb_agg(jsonb_build_object('fixture_id', f.id, 'starts_at', f.starts_at, 'division', f.division,
               'home', h.display_name, 'away', a.display_name,
               'sheets', (select count(*) from public.match_sheets s where s.fixture_id = f.id)) order by f.starts_at desc)
        from public.fixtures f
        left join public.competition_entries h on h.id = f.home_entry_id
        left join public.competition_entries a on a.id = f.away_entry_id
       where f.competition_id = p_competition
         and f.starts_at between now() - interval '7 days' and now()
         and f.status in ('scheduled', 'in_progress', 'final')
         and f.home_entry_id is not null and f.away_entry_id is not null
         and (select count(*) from public.match_sheets s where s.fixture_id = f.id) < 2), '[]'::jsonb),
    'unverified', coalesce((
      select jsonb_agg(jsonb_build_object('fixture_id', f.id, 'starts_at', f.starts_at, 'division', f.division,
               'home', h.display_name, 'away', a.display_name,
               'state', case when f.score_disputed then 'disputed' else 'one side' end) order by f.starts_at desc)
        from public.fixtures f
        left join public.competition_entries h on h.id = f.home_entry_id
        left join public.competition_entries a on a.id = f.away_entry_id
       where f.competition_id = p_competition
         and f.status in ('scheduled', 'in_progress')
         and f.starts_at < now()
         and (f.score_disputed
              or exists (select 1 from public.match_sheets s where s.fixture_id = f.id and s.our_score is not null))), '[]'::jsonb),
    'not_ended', coalesce((
      select jsonb_agg(jsonb_build_object('fixture_id', f.id, 'starts_at', f.starts_at, 'division', f.division,
               'home', h.display_name, 'away', a.display_name, 'status', f.status) order by f.starts_at desc)
        from public.fixtures f
        left join public.competition_entries h on h.id = f.home_entry_id
        left join public.competition_entries a on a.id = f.away_entry_id
       where f.competition_id = p_competition
         and f.ended_at is null
         and f.starts_at between now() - interval '7 days' and now() - interval '3 hours'
         and f.status in ('scheduled', 'in_progress', 'final')
         and f.home_entry_id is not null and f.away_entry_id is not null), '[]'::jsonb),
    'pending_reports', coalesce((
      select jsonb_agg(jsonb_build_object('fixture_id', f.id, 'starts_at', f.starts_at, 'division', f.division,
               'home', h.display_name, 'away', a.display_name, 'referee', r.full_name) order by f.starts_at desc)
        from public.referee_appointments ap
        join public.referees r on r.id = ap.referee_id
        join public.fixtures f on f.id = ap.fixture_id
        left join public.competition_entries h on h.id = f.home_entry_id
        left join public.competition_entries a on a.id = f.away_entry_id
       where ap.competition_id = p_competition
         and ap.role = 'referee' and ap.status = 'accepted' and ap.reported_at is null
         and f.starts_at between now() - interval '14 days' and now() - interval '2 hours'
         and f.status in ('scheduled', 'in_progress', 'final')), '[]'::jsonb),
    'unfilled', coalesce((
      select jsonb_agg(jsonb_build_object('fixture_id', f.id, 'starts_at', f.starts_at, 'division', f.division,
               'home', h.display_name, 'away', a.display_name) order by f.starts_at)
        from public.fixtures f
        left join public.competition_entries h on h.id = f.home_entry_id
        left join public.competition_entries a on a.id = f.away_entry_id
       where f.competition_id = p_competition
         and f.status = 'scheduled'
         and f.starts_at between now() and now() + interval '7 days'
         and not exists (select 1 from public.referee_appointments ra
                          where ra.fixture_id = f.id and ra.role = 'referee' and ra.status = 'accepted')), '[]'::jsonb),
    'suspensions', coalesce((
      select jsonb_agg(jsonb_build_object('player', pl.full_name, 'team', e.display_name,
               'reason', s.reason, 'left', s.games - s.served) order by s.issued_at desc)
        from public.suspensions s
        join public.players pl on pl.id = s.player_id
        left join public.competition_entries e on e.id = s.entry_id
       where s.competition_id = p_competition and s.status = 'active' and s.served < s.games), '[]'::jsonb),
    'corrections', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'fixture_id', c.fixture_id, 'kind', c.kind, 'detail', c.detail,
               'home', h.display_name, 'away', a.display_name, 'created_at', c.created_at) order by c.created_at)
        from public.match_corrections c
        join public.fixtures f on f.id = c.fixture_id
        left join public.competition_entries h on h.id = f.home_entry_id
        left join public.competition_entries a on a.id = f.away_entry_id
       where c.competition_id = p_competition and c.status = 'open'), '[]'::jsonb),
    'change_requests', (select count(*) from public.fixture_change_requests r
                         where r.competition_id = p_competition and r.status in ('proposed', 'agreed')),
    'flowing_until', (select c.flowing_until from public.competitions c where c.id = p_competition)
  );
end;
$$;

revoke execute on function public.set_fixture_flowing(uuid, timestamptz, integer) from public, anon;
grant execute on function public.set_fixture_flowing(uuid, timestamptz, integer) to authenticated;
revoke execute on function public.draw_quality(uuid, text) from public, anon;
grant execute on function public.draw_quality(uuid, text) to authenticated;
revoke execute on function public.field_impact(uuid, date, text, text) from public, anon;
grant execute on function public.field_impact(uuid, date, text, text) to authenticated;
revoke execute on function public.match_day_ops(uuid) from public, anon;
grant execute on function public.match_day_ops(uuid) to authenticated;
revoke execute on function public.generate_fixtures_managed(uuid, text, timestamptz, integer, integer, text[], text, boolean, integer) from public, anon, authenticated;
