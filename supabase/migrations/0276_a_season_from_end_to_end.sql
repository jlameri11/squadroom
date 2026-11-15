-- 0276 — a season from end to end (the Season 4 simulation, docs/SIMULATION.md,
-- 14–15 Nov 2026). Playing a whole league week by week on the local Postgres
-- found what a league running fourteen rounds needs that a tournament never
-- did. Each piece below is a bug in docs/BUGS.md.
--
--   1. A draw of two legs. The generator made one round robin and a second
--      run labelled the games Round 1–7 again, with nobody's home game
--      reversed (bug #2). `p_legs` draws the second half with home and away
--      swapped and the rounds numbered on; `p_skip_dates` leaves a week out
--      (the school holidays); and the round dates are worked out in the
--      competition's zone, so a 9 am kick-off is still 9 am after the clocks
--      change — timestamptz + '7 days' in a UTC session is 168 hours, which
--      put every game after 4 April an hour earlier (bug #3).
--   2. A game moved by name lands on the pitch. `apply_reschedule` wrote the
--      field and ground as labels and left `pitch_id` on the old pitch, so the
--      booking guard put the old field's name straight back and the run sheet
--      disagreed with itself (bug #4). The labels resolve to the pitch now,
--      and the mirrored event carries the field, so a family's game page
--      says "Harbour Park · Field 3" and a field change is a change they hear.
--   3. A team withdraws. There was no way but deleting the entry, which
--      deletes every game it played (on delete cascade) and the ladder with
--      it (bug #5). `withdraw_entry` gives its remaining games as byes, marks
--      the entry, keeps what was played, and the opponents' families see the
--      game is off — a bye is mirrored as a called-off game now (bug #6).
--   4. Referees hear it. A called-off or moved game told every family and
--      nobody with a whistle (bug #7); `notify_referees_of_change` tells the
--      appointed referees, with a text inside 24 hours like everyone else.
--   5. Finals of four from one table (`create_finals(p_top => 4)`), and a
--      knockout decided on penalties: `rule_on_score` records the shootout and
--      the winner goes through (bugs #8, #9).
--   6. A sheet below the division's minimum is refused (`squad_size_min`,
--      bug #10); an under-18 referee is never put on an U15 or older game
--      (bug #11); the clubs whose entry fee is still owed are reminded every
--      fortnight (bug #12); an injury report reaches the Welfare officer and
--      the President at once (bug #13); a referee's report of abuse reaches
--      the coordinator and the discipline officer at once (bug #14).

-- ------------------------------------------- 0. the queue knows the new kinds
alter table public.notification_queue drop constraint if exists notification_queue_kind_check;
alter table public.notification_queue add constraint notification_queue_kind_check check (kind = any (array[
  'message', 'announcement', 'event_reminder', 'poll_opened', 'poll_closing', 'rsvp_change', 'invite', 'event_cancelled', 'event_changed',
  'event_back_on', 'rsvp_nudge', 'announcement_repeat', 'wwcc_expiring', 'guardian_erased', 'official_rego_pending', 'reregister_nudge', 'offer',
  'referee_appointment', 'referee_response', 'referee_withdrawn', 'fixture_change_proposed', 'fixture_change_answered', 'fixture_change_decided',
  'mention', 'match_correction_requested', 'match_correction_decided', 'fixture_flowing_open', 'discipline_warning', 'discipline_suspension',
  'forfeit_request', 'forfeit_decided', 'nomination', 'fee_due', 'fee_overdue', 'player_report', 'player_clip', 'selected', 'not_selected',
  'match_day', 'support_reply', 'match_video', 'match_photos', 'photo_hidden', 'helpers_wanted', 'helper_reminder', 'helper_changed',
  'report_filed', 'team_published', 'team_sheet_due', 'accreditation_expiring', 'role_request', 'role_decided', 'ban', 'receipt',
  -- 0276
  'referee_game_off', 'referee_game_moved', 'referee_report', 'incident_report', 'entry_fee_owed']));

-- ------------------------------------------------------------ 1. the draw
-- Joey's rule (15 Nov 2026): a club with several squads on at once is fine
-- (different teams, different coaches). The same COACH or TEAM MANAGER is
-- never drawn into two games that overlap, counting half an hour's travel
-- between different grounds. Families with children at two grounds at once
-- are a warning on the draw check, to be kept down, never a refusal.
create or replace function app_private.entry_staff(p_entry uuid)
returns setof uuid
language sql stable security definer set search_path = public as $$
  select tm.profile_id
    from public.competition_entries e
    join public.team_members tm on tm.team_id = e.team_id and tm.role = 'coach'
   where e.id = p_entry and e.team_id is not null
  union
  select cr.profile_id
    from public.competition_entries e
    join public.club_roles cr on cr.team_id = e.team_id and cr.role = 'team_manager'
   where e.id = p_entry and e.team_id is not null;
$$;

create or replace function app_private.staff_clash(p_competition uuid, p_home uuid, p_away uuid, p_from timestamptz, p_to timestamptz, p_venue text, p_except uuid default null)
returns text
language sql stable security definer set search_path = public as $$
  -- One pass: the games near this moment, their teams, the coaches and
  -- managers of those teams, against the coaches and managers of this pair.
  with people as (
    select tm.profile_id
      from public.competition_entries e
      join public.team_members tm on tm.team_id = e.team_id and tm.role = 'coach'
     where e.id in (p_home, p_away) and e.team_id is not null
    union
    select cr.profile_id
      from public.competition_entries e
      join public.club_roles cr on cr.team_id = e.team_id and cr.role = 'team_manager'
     where e.id in (p_home, p_away) and e.team_id is not null
  ),
  near as (
    select f.id, f.starts_at, f.venue_label, f.home_entry_id, f.away_entry_id,
           (case when coalesce(f.venue_label, '') = coalesce(p_venue, '') then interval '0' else interval '30 minutes' end) as travel,
           make_interval(mins => coalesce(f.duration_mins, 60)) as length
      from public.fixtures f
     where f.competition_id = p_competition
       and f.id is distinct from p_except
       and f.status in ('scheduled', 'in_progress')
       and f.starts_at is not null
       and f.starts_at > p_from - interval '6 hours' and f.starts_at < p_to + interval '6 hours'
  ),
  hit as (
    select n.*, x.profile_id
      from near n
      join public.competition_entries e on e.id in (n.home_entry_id, n.away_entry_id) and e.team_id is not null
      join lateral (
        select tm.profile_id from public.team_members tm where tm.team_id = e.team_id and tm.role = 'coach'
        union
        select cr.profile_id from public.club_roles cr where cr.team_id = e.team_id and cr.role = 'team_manager'
      ) x on x.profile_id in (select profile_id from people)
     where n.starts_at - n.travel < p_to
       and n.starts_at + n.length + n.travel > p_from
     order by n.starts_at
     limit 1
  )
  select (select p.full_name from public.profiles p where p.id = h.profile_id) || ' is on '
         || coalesce(he.display_name, '?') || ' v ' || coalesce(ae.display_name, '?') || ' at '
         || to_char(h.starts_at at time zone app_private.competition_tz(p_competition), 'HH24:MI')
         || coalesce(' (' || h.venue_label || ')', '')
    from hit h
    left join public.competition_entries he on he.id = h.home_entry_id
    left join public.competition_entries ae on ae.id = h.away_entry_id;
$$;

-- The draw asks "who else is on at this moment" for every slot it tries.
create index if not exists fixtures_competition_starts_idx on public.fixtures (competition_id, starts_at);
create index if not exists team_members_team_role_idx on public.team_members (team_id, role);
create index if not exists club_roles_team_role_idx on public.club_roles (team_id, role) where team_id is not null;

drop function if exists public.generate_fixtures(uuid, text, timestamptz, integer, integer, text[], text, boolean, integer);
drop function if exists public.generate_fixtures_managed(uuid, text, timestamptz, integer, integer, text[], text, boolean, integer);
drop function if exists public.generate_fixtures_on_pitches(uuid, text, uuid, date, integer, integer, boolean, integer);

create or replace function public.generate_fixtures_managed(
  p_competition uuid, p_division text, p_start_at timestamptz,
  p_game_mins integer default 20, p_gap_mins integer default 5,
  p_fields text[] default array['Field 1'], p_venue_label text default null,
  p_replace boolean default false, p_round_every_days integer default 0,
  p_legs integer default 1, p_skip_dates date[] default null)
returns integer
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
  v_leg        integer;
  v_leg_rounds integer;
  v_tz         text;
  v_local      timestamp;
  v_day        date;
  v_dates      date[] := '{}';
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
  if p_legs not between 1 and 4 then
    raise exception 'a season is one to four legs' using errcode = '22023';
  end if;
  if coalesce(array_length(p_skip_dates, 1), 0) > 0 and p_round_every_days = 0 then
    raise exception 'a week can only be left out of a season drawn round by round' using errcode = '22023';
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

  -- A team that has withdrawn is not drawn (0276).
  select coalesce(array_agg(distinct coalesce(group_label, '')), '{}')
    into v_groups
    from public.competition_entries
   where competition_id = p_competition and division = p_division and withdrawn_at is null;

  -- pass 1: who plays who, once a leg; the second leg the other way round
  foreach v_group in array v_groups loop
    select array_agg(id order by coalesce(seed, 0), display_name)
      into v_ids
      from public.competition_entries
     where competition_id = p_competition
       and division = p_division
       and withdrawn_at is null
       and coalesce(group_label, '') = v_group;

    if coalesce(array_length(v_ids, 1), 0) < 2 then
      continue;
    end if;

    if array_length(v_ids, 1) % 2 = 1 then
      v_ids := v_ids || null::uuid;
    end if;

    v_n := array_length(v_ids, 1);
    v_rounds := v_n - 1;
    v_leg_rounds := v_rounds;

    for v_leg in 1..p_legs loop
      for v_r in 1..v_rounds loop
        for v_i in 1..(v_n / 2) loop
          v_home := v_ids[v_i];
          v_away := v_ids[v_n + 1 - v_i];
          if v_home is not null and v_away is not null then
            -- Alternate home and away through the leg; the next leg reverses it.
            if (v_r % 2 = 0) <> (v_leg % 2 = 0) then
              v_pair_home := v_pair_home || v_away;
              v_pair_away := v_pair_away || v_home;
            else
              v_pair_home := v_pair_home || v_home;
              v_pair_away := v_pair_away || v_away;
            end if;
            v_pair_group := v_pair_group || v_group;
            v_pair_round := v_pair_round || (v_r + (v_leg - 1) * v_leg_rounds);
            -- L-24: a pair a pinned game already covers is drawn already.
            v_done := v_done || exists (
              select 1 from public.fixtures f
               where f.competition_id = p_competition and f.division = p_division and f.pinned
                 and f.round = 'Round ' || (v_r + (v_leg - 1) * v_leg_rounds)
                 and ((f.home_entry_id = v_home and f.away_entry_id = v_away)
                   or (f.home_entry_id = v_away and f.away_entry_id = v_home)));
          end if;
        end loop;

        v_rotated := array[v_ids[1]] || v_ids[v_n] || v_ids[2:v_n-1];
        v_ids := v_rotated;
      end loop;
    end loop;
  end loop;

  v_total := coalesce(array_length(v_pair_home, 1), 0);
  if v_total = 0 then
    return 0;
  end if;

  select max(r) into v_max_round from unnest(v_pair_round) r;

  -- The round dates, in the competition's zone: the start, then every
  -- p_round_every_days, skipping the dates the league leaves out (and every
  -- later round moves on a week with them). A calendar day, never 24 hours,
  -- so the clocks changing does not move a kick-off.
  v_tz := app_private.competition_tz(p_competition);
  v_local := p_start_at at time zone v_tz;
  if p_round_every_days > 0 then
    v_day := v_local::date;
    for v_r in 1..v_max_round loop
      while v_day = any (coalesce(p_skip_dates, '{}'::date[])) loop
        v_day := v_day + p_round_every_days;
      end loop;
      v_dates := v_dates || v_day;
      v_day := v_day + p_round_every_days;
    end loop;
  end if;

  -- pass 2: when and where
  for v_this_round in
    select r
      from generate_series(0, case when p_round_every_days = 0 then 0 else v_max_round end) r
     where p_round_every_days = 0 or r > 0
  loop
    v_round_base := case
      when p_round_every_days = 0 then p_start_at
      else (v_dates[v_this_round] + v_local::time) at time zone v_tz
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
          -- Nor a coach or manager of either side at another game then (0276).
          if app_private.staff_clash(p_competition, v_pair_home[v_k], v_pair_away[v_k], v_start,
                                     v_start + make_interval(mins => p_game_mins), p_venue_label, null) is not null then
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
revoke execute on function public.generate_fixtures_managed(uuid, text, timestamptz, integer, integer, text[], text, boolean, integer, integer, date[]) from public, anon, authenticated;

create or replace function public.generate_fixtures(
  p_competition uuid, p_division text, p_start_at timestamptz,
  p_game_mins integer default 20, p_gap_mins integer default 5,
  p_fields text[] default array['Field 1'], p_venue_label text default null,
  p_replace boolean default false, p_round_every_days integer default 0,
  p_legs integer default 1, p_skip_dates date[] default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_mode public.competition_mode;
begin
  if not coalesce(app_private.is_competition_organiser(p_competition), false) then
    raise exception 'only the organiser can build the draw' using errcode = '42501';
  end if;
  select mode into v_mode from public.competitions where id = p_competition;
  if v_mode = 'comms_only' then
    raise exception 'This competition is run elsewhere. Squadroom handles its messages and reminders, not its draw.'
      using errcode = '22023';
  end if;
  return public.generate_fixtures_managed(
    p_competition, p_division, p_start_at, p_game_mins, p_gap_mins, p_fields, p_venue_label, p_replace, p_round_every_days, p_legs, p_skip_dates);
end;
$$;
revoke execute on function public.generate_fixtures(uuid, text, timestamptz, integer, integer, text[], text, boolean, integer, integer, date[]) from public, anon;
grant execute on function public.generate_fixtures(uuid, text, timestamptz, integer, integer, text[], text, boolean, integer, integer, date[]) to authenticated, service_role;

create or replace function public.generate_fixtures_on_pitches(
  p_competition uuid, p_division text, p_venue uuid, p_first_date date,
  p_game_mins integer default null, p_gap_mins integer default 5,
  p_replace boolean default false, p_round_every_days integer default 7,
  p_legs integer default 1, p_skip_dates date[] default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_comp     public.competitions;
  v_venue    public.venues;
  v_size     text;
  v_tz       text;
  v_names    text[];
  v_ids      uuid[];
  v_game     integer;
  v_open     time;
  v_start    timestamptz;
  -- now(), not clock_timestamp(): the rows the generator inserts get
  -- created_at = now() (the transaction's start), and the fit below must
  -- see them and none from an earlier draw.
  v_t0       timestamptz := now();
  v_made     integer;
  v_placed   integer := 0;
  v_overflow integer := 0;
  v_pitch    uuid;
  v_day      date;
  v_fx       record;
  v_cursor   timestamptz;
  v_slot     timestamptz;
  v_end      timestamptz;
  v_fits     boolean;
  v_tries    integer;
begin
  if not coalesce(app_private.is_competition_organiser(p_competition), false) then
    raise exception 'only the organiser can build the draw' using errcode = '42501';
  end if;
  select * into v_comp from public.competitions where id = p_competition;
  select * into v_venue from public.venues where id = p_venue;
  if v_venue.id is null or not (
    v_venue.academy_id = v_comp.organiser_id
    or exists (select 1 from public.competition_clubs cc where cc.competition_id = p_competition and cc.academy_id = v_venue.academy_id)
  ) then
    raise exception 'that venue is not the league''s or an entered club''s' using errcode = '22023';
  end if;
  v_tz   := app_private.competition_tz(p_competition);
  v_size := app_private.division_pitch_size(p_competition, p_division);
  select coalesce(array_agg(p.name order by p.sort, p.name), '{}'), coalesce(array_agg(p.id order by p.sort, p.name), '{}')
    into v_names, v_ids
    from public.pitches p where p.venue_id = p_venue and p.size = v_size;
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception 'No %-size pitches at %. In Venues, % a full pitch.', v_size, v_venue.name,
      case v_size when 'full' then 'add' when 'half' then 'cut in halves' when 'third' then 'cut in thirds' else 'cut in quarters' end
      using errcode = '22023';
  end if;
  v_game := coalesce(p_game_mins,
              (select d.match_length_mins from public.competition_divisions d where d.competition_id = p_competition and d.division = p_division),
              40);

  -- Kick-off: the earliest these pitches open on that weekday, else 8am.
  select min(h.opens) into v_open
    from public.pitch_availability h
   where (h.pitch_id = any (v_ids) or h.pitch_id in (select parent_id from public.pitches where id = any (v_ids)))
     and h.weekday = extract(dow from p_first_date)::integer;
  v_start := (p_first_date::text || ' ' || coalesce(v_open, '08:00'::time)::text)::timestamp at time zone v_tz;

  v_made := public.generate_fixtures(p_competition, p_division, v_start, v_game, coalesce(p_gap_mins, 5),
                                     v_names, v_venue.name, p_replace, coalesce(p_round_every_days, 7), p_legs, p_skip_dates);

  -- Now fit: per pitch, per date, in drawn order.
  for v_pitch in select unnest(v_ids) loop
    for v_day in
      select distinct (f.starts_at at time zone v_tz)::date
        from public.fixtures f
       where f.competition_id = p_competition and f.division = p_division
         and f.pitch_id is null and f.created_at >= v_t0
         and f.field_label = (select name from public.pitches where id = v_pitch)
       order by 1
    loop
      v_cursor := null;
      for v_fx in
        select f.id, f.starts_at, coalesce(f.duration_mins, v_game) as mins, f.home_entry_id, f.away_entry_id
          from public.fixtures f
         where f.competition_id = p_competition and f.division = p_division
           and f.pitch_id is null and f.created_at >= v_t0
           and f.field_label = (select name from public.pitches where id = v_pitch)
           and (f.starts_at at time zone v_tz)::date = v_day
         order by f.starts_at
      loop
        v_slot := coalesce(v_cursor, v_fx.starts_at);
        v_fits := false;
        v_tries := 0;
        while not v_fits and v_tries < 60 loop
          v_end := v_slot + make_interval(mins => v_fx.mins);
          if (v_end at time zone v_tz)::date <> v_day then
            exit;
          end if;
          if app_private.pitch_open(v_pitch, v_slot, v_end)
             and app_private.pitch_clash(v_pitch, v_slot, v_end, v_fx.id) is null
             and app_private.staff_clash(p_competition, v_fx.home_entry_id, v_fx.away_entry_id, v_slot, v_end, v_venue.name, v_fx.id) is null then
            v_fits := true;
          else
            v_slot := v_slot + make_interval(mins => v_fx.mins + coalesce(p_gap_mins, 5));
            v_tries := v_tries + 1;
          end if;
        end loop;
        if v_fits then
          update public.fixtures set starts_at = v_slot, pitch_id = v_pitch, updated_at = now() where id = v_fx.id;
          v_placed := v_placed + 1;
          v_cursor := v_slot + make_interval(mins => v_fx.mins + coalesce(p_gap_mins, 5));
        else
          v_overflow := v_overflow + 1;
        end if;
      end loop;
    end loop;
  end loop;

  return jsonb_build_object('games', v_made, 'placed', v_placed, 'overflow', v_overflow,
                            'size', v_size, 'pitches', to_jsonb(v_names), 'venue', v_venue.name);
end;
$$;
revoke execute on function public.generate_fixtures_on_pitches(uuid, text, uuid, date, integer, integer, boolean, integer, integer, date[]) from public, anon;
grant execute on function public.generate_fixtures_on_pitches(uuid, text, uuid, date, integer, integer, boolean, integer, integer, date[]) to authenticated, service_role;


-- The draw check: a coach or manager in two games is the thing to fix; a
-- family at two grounds at once is a warning; two squads of one club at the
-- same time is not a finding at all.
create or replace function public.draw_quality(p_competition uuid, p_division text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
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
           where e.competition_id = p_competition and e.division = p_division and e.withdrawn_at is null
           group by e.id, e.display_name
        ) t), '[]'::jsonb),
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
    -- HARD: a coach or team manager in two games that overlap (half an hour's travel between grounds).
    'staff_clashes', coalesce((
      select jsonb_agg(jsonb_build_object('person', q.person, 'at', q.at, 'games', q.games) order by q.at, q.person)
        from (
          select distinct p.full_name as person, least(f1.starts_at, f2.starts_at) as at,
                 jsonb_build_array(
                   coalesce(h1.display_name, '?') || ' v ' || coalesce(a1.display_name, '?') || coalesce(' (' || f1.venue_label || ')', ''),
                   coalesce(h2.display_name, '?') || ' v ' || coalesce(a2.display_name, '?') || coalesce(' (' || f2.venue_label || ')', '')) as games
            from public.fixtures f1
            join public.fixtures f2
              on f2.competition_id = f1.competition_id and f2.id > f1.id
             and f2.starts_at between f1.starts_at - interval '6 hours' and f1.starts_at + interval '6 hours'
            join lateral (select s from app_private.entry_staff(f1.home_entry_id) s union select s from app_private.entry_staff(f1.away_entry_id) s) s1 on true
            join lateral (select s from app_private.entry_staff(f2.home_entry_id) s union select s from app_private.entry_staff(f2.away_entry_id) s) s2 on s2.s = s1.s
            join public.profiles p on p.id = s1.s
            left join public.competition_entries h1 on h1.id = f1.home_entry_id
            left join public.competition_entries a1 on a1.id = f1.away_entry_id
            left join public.competition_entries h2 on h2.id = f2.home_entry_id
            left join public.competition_entries a2 on a2.id = f2.away_entry_id
           where f1.competition_id = p_competition
             and (f1.division = p_division or f2.division = p_division)
             and f1.status in ('scheduled', 'in_progress') and f2.status in ('scheduled', 'in_progress')
             and f1.starts_at is not null and f2.starts_at is not null
             and f1.starts_at - (case when coalesce(f1.venue_label, '') = coalesce(f2.venue_label, '') then interval '0' else interval '30 minutes' end)
                 < f2.starts_at + make_interval(mins => coalesce(f2.duration_mins, 60))
             and f2.starts_at - (case when coalesce(f1.venue_label, '') = coalesce(f2.venue_label, '') then interval '0' else interval '30 minutes' end)
                 < f1.starts_at + make_interval(mins => coalesce(f1.duration_mins, 60))
        ) q), '[]'::jsonb),
    -- SOFT: a family with children in two teams on at the same time at different grounds.
    'family_clashes', coalesce((
      select jsonb_agg(jsonb_build_object('family', q.family, 'at', q.at, 'games', q.games) order by q.at, q.family)
        from (
          select distinct p.full_name as family, least(f1.starts_at, f2.starts_at) as at,
                 jsonb_build_array(
                   coalesce(h1.display_name, '?') || ' v ' || coalesce(a1.display_name, '?') || coalesce(' (' || f1.venue_label || ')', ''),
                   coalesce(h2.display_name, '?') || ' v ' || coalesce(a2.display_name, '?') || coalesce(' (' || f2.venue_label || ')', '')) as games
            from public.fixtures f1
            join public.fixtures f2
              on f2.competition_id = f1.competition_id and f2.id > f1.id
             and f2.starts_at < f1.starts_at + make_interval(mins => coalesce(f1.duration_mins, 60))
             and f1.starts_at < f2.starts_at + make_interval(mins => coalesce(f2.duration_mins, 60))
             and coalesce(f2.venue_label, '') <> coalesce(f1.venue_label, '')
            join public.competition_entries e1 on e1.id in (f1.home_entry_id, f1.away_entry_id) and e1.team_id is not null
            join public.competition_entries e2 on e2.id in (f2.home_entry_id, f2.away_entry_id) and e2.team_id is not null and e2.team_id <> e1.team_id
            join public.players pl1 on pl1.team_id = e1.team_id
            join public.player_guardians g1 on g1.player_id = pl1.id
            join public.players pl2 on pl2.team_id = e2.team_id
            join public.player_guardians g2 on g2.player_id = pl2.id and g2.profile_id = g1.profile_id
            join public.profiles p on p.id = g1.profile_id
            left join public.competition_entries h1 on h1.id = f1.home_entry_id
            left join public.competition_entries a1 on a1.id = f1.away_entry_id
            left join public.competition_entries h2 on h2.id = f2.home_entry_id
            left join public.competition_entries a2 on a2.id = f2.away_entry_id
           where f1.competition_id = p_competition
             and (f1.division = p_division or f2.division = p_division)
             and f1.status in ('scheduled', 'in_progress') and f2.status in ('scheduled', 'in_progress')
             and f1.starts_at is not null and f2.starts_at is not null
        ) q), '[]'::jsonb),
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

-- --------------------------------------------- 2. a game moved lands on a pitch
create or replace function app_private.apply_reschedule(p_fixture uuid, p_starts_at timestamptz, p_venue_label text, p_field text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  f        public.fixtures;
  v_org    uuid;
  v_venue  uuid;
  v_pitch  uuid;
  v_label  text := nullif(btrim(coalesce(p_venue_label, '')), '');
  v_field  text := nullif(btrim(coalesce(p_field, '')), '');
  v_why    text;
begin
  select * into f from public.fixtures where id = p_fixture;
  select organiser_id into v_org from public.competitions where id = f.competition_id;
  -- A coach or manager cannot be at two games (0276, Joey's draw rule).
  v_why := app_private.staff_clash(f.competition_id, f.home_entry_id, f.away_entry_id, p_starts_at,
                                   p_starts_at + make_interval(mins => coalesce(f.duration_mins, 60)), coalesce(v_label, f.venue_label), f.id);
  if v_why is not null then
    raise exception '% — the same coach or manager cannot be at both games' , v_why using errcode = '23P01';
  end if;
  -- The ground, by name: the league's or an entered club's. Unknown names
  -- stay as labels, the way a game at a borrowed park always was.
  if v_label is not null then
    select v.id into v_venue
      from public.venues v
     where v.name = v_label
       and (v.academy_id = v_org
            or exists (select 1 from public.competition_clubs cc where cc.competition_id = f.competition_id and cc.academy_id = v.academy_id))
     order by (v.academy_id = v_org) desc
     limit 1;
  else
    v_venue := f.venue_id;
  end if;
  if v_field is not null and v_venue is not null then
    select p.id into v_pitch from public.pitches p where p.venue_id = v_venue and p.name = v_field limit 1;
  end if;

  update public.fixtures
     set status = 'scheduled', cancel_reason = null,
         starts_at = p_starts_at,
         venue_label = coalesce(v_label, venue_label),
         field_label = coalesce(v_field, field_label),
         -- A new ground with no pitch found there: off the old pitch, labels only.
         venue_id = case when v_label is not null then v_venue else venue_id end,
         pitch_id = case
                      when v_field is not null then v_pitch
                      when v_label is not null and v_venue is distinct from venue_id then null
                      else pitch_id
                    end,
         pinned = true,
         updated_at = now()
   where id = p_fixture;
end;
$$;

-- The mirror: the field with the ground, and a bye is a game that is off.
create or replace function public.mirror_fixture(p_fixture uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  f         public.fixtures%rowtype;
  e         record;
  opponent_name text;
  comp_name text;
  v_venue   text;
begin
  select * into f from public.fixtures where id = p_fixture;
  if f.id is null then return; end if;

  select name into comp_name from public.competitions where id = f.competition_id;
  v_venue := coalesce(f.venue_label, (select name from public.venues where id = f.venue_id));
  -- "Harbour Park · Field 3": the field is what a family looks for at the ground.
  if f.field_label is not null and v_venue is not null and position(f.field_label in v_venue) = 0 then
    v_venue := v_venue || ' · ' || f.field_label;
  end if;

  for e in
    select ce.*, (case when ce.id = f.home_entry_id then f.away_entry_id else f.home_entry_id end) as other_id
      from public.competition_entries ce
     where ce.id in (f.home_entry_id, f.away_entry_id)
       and ce.academy_id is not null
       and ce.team_id is not null
  loop
    select display_name into opponent_name from public.competition_entries where id = e.other_id;

    insert into public.events (
      academy_id, team_id, competition_id, fixture_id, type, title,
      starts_at, ends_at, venue, opponent, round
    )
    values (
      e.academy_id, e.team_id, f.competition_id, f.id, 'match',
      coalesce(comp_name, 'Fixture') || ' — vs ' || coalesce(opponent_name, 'TBC'),
      coalesce(f.starts_at, now()),
      case when f.starts_at is not null and f.duration_mins is not null
           then f.starts_at + (f.duration_mins || ' minutes')::interval end,
      v_venue,
      opponent_name, f.round
    )
    on conflict (fixture_id, academy_id) where fixture_id is not null do update
      set starts_at    = excluded.starts_at,
          ends_at      = excluded.ends_at,
          venue        = excluded.venue,
          opponent     = excluded.opponent,
          round        = excluded.round,
          title        = excluded.title,
          -- Keep the original cancellation time on a game that stays off;
          -- clear it when the game is back on. A bye is a game that is off
          -- (0276): the other side withdrew, or the league gave the bye.
          cancelled_at = case when f.status in ('cancelled','postponed','bye')
                              then coalesce(public.events.cancelled_at, now()) end,
          cancellation_reason = case when f.status in ('cancelled','postponed') then f.cancel_reason
                                     when f.status = 'bye' then 'other' end,
          cancellation_note   = case when f.status in ('cancelled','postponed') then f.notes
                                     when f.status = 'bye' then coalesce(f.notes, 'Bye — no game this round') end;
  end loop;
end;
$$;

-- The games already mirrored learn their field quietly: this is not a change
-- anyone needs a push about, so the notify trigger sleeps for the backfill.
alter table public.events disable trigger events_notify_change;
update public.events e
   set venue = coalesce(f.venue_label, (select v.name from public.venues v where v.id = f.venue_id)) || ' · ' || f.field_label
  from public.fixtures f
 where e.fixture_id = f.id
   and f.field_label is not null
   and coalesce(f.venue_label, (select v.name from public.venues v where v.id = f.venue_id)) is not null
   and position(f.field_label in coalesce(e.venue, '')) = 0;
alter table public.events enable trigger events_notify_change;

-- ------------------------------------------------------- 3. a team withdraws
alter table public.competition_entries
  add column if not exists withdrawn_at   timestamptz,
  add column if not exists withdrawn_note text;

create or replace function public.withdraw_entry(p_entry uuid, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e       public.competition_entries;
  v_n     integer := 0;
  v_ids   uuid[];
begin
  select * into e from public.competition_entries where id = p_entry;
  if e.id is null or not coalesce(app_private.may_run(e.competition_id, 'competition'), false) then
    raise exception 'only the league withdraws a team' using errcode = '42501';
  end if;
  if e.withdrawn_at is not null then
    raise exception '% withdrew on %', e.display_name, to_char(e.withdrawn_at at time zone app_private.competition_tz(e.competition_id), 'FMDD Mon') using errcode = '22023';
  end if;
  update public.competition_entries
     set withdrawn_at = now(), withdrawn_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_entry;
  -- The games still to play are byes for the other side; what was played stands.
  with gone as (
    update public.fixtures f
       set status = 'bye', home_score = null, away_score = null, cancel_reason = null,
           notes = coalesce(nullif(btrim(coalesce(p_note, '')), ''), e.display_name || ' withdrew — bye'),
           updated_at = now()
     where f.competition_id = e.competition_id
       and (f.home_entry_id = p_entry or f.away_entry_id = p_entry)
       and f.status in ('scheduled', 'postponed', 'in_progress')
     returning f.id
  )
  select count(*), coalesce(array_agg(id), '{}') into v_n, v_ids from gone;
  perform app_private.log_activity((select organiser_id from public.competitions where id = e.competition_id),
                                   'entry.withdrawn', 'competition_entry', e.id, e.display_name,
                                   jsonb_build_object('competition_id', e.competition_id, 'division', e.division, 'byes', v_n, 'note', p_note));
  return jsonb_build_object('entry_id', e.id, 'team', e.display_name, 'byes', v_n, 'fixtures', to_jsonb(v_ids));
end;
$$;
revoke execute on function public.withdraw_entry(uuid, text) from public, anon;
grant execute on function public.withdraw_entry(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------- 4. the referees hear it
create or replace function public.notify_referees_of_change()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_tz    text;
  v_org   uuid;
  v_home  text;
  v_away  text;
  v_when  text;
  v_kind  text;
  v_title text;
  v_body  text;
  v_urgent boolean;
  v_off   boolean := new.status in ('cancelled', 'postponed', 'bye') and old.status not in ('cancelled', 'postponed', 'bye');
  v_moved boolean := new.status in ('scheduled', 'in_progress')
                     and (old.status in ('cancelled', 'postponed', 'bye')
                          or old.starts_at is distinct from new.starts_at
                          or coalesce(old.venue_label, '') <> coalesce(new.venue_label, '')
                          or coalesce(old.field_label, '') <> coalesce(new.field_label, ''));
begin
  if not (v_off or v_moved) then
    return new;
  end if;
  select c.organiser_id, app_private.competition_tz(c.id) into v_org, v_tz from public.competitions c where c.id = new.competition_id;
  select h.display_name, a.display_name into v_home, v_away
    from (select 1) one
    left join public.competition_entries h on h.id = new.home_entry_id
    left join public.competition_entries a on a.id = new.away_entry_id;
  v_when := to_char(new.starts_at at time zone v_tz, 'Dy FMDD Mon, FMHH12:MIam');
  v_urgent := coalesce(old.starts_at, new.starts_at) < now() + interval '24 hours'
          and coalesce(old.starts_at, new.starts_at) > now() - interval '3 hours';
  if v_off then
    v_kind  := 'referee_game_off';
    v_title := 'Off: ' || coalesce(v_home, 'TBC') || ' v ' || coalesce(v_away, 'TBC');
    v_body  := trim(both ' · ' from concat_ws(' · ',
                 case new.cancel_reason when 'wet_weather' then 'Wet weather' when 'ground_closed' then 'Ground closed'
                                        when 'forfeit' then 'Forfeit' when 'not_enough_players' then 'Not enough players'
                                        else case when new.status = 'bye' then 'Bye' end end,
                 'was ' || v_when,
                 nullif(btrim(coalesce(new.notes, '')), '')));
  else
    v_kind  := 'referee_game_moved';
    v_title := (case when old.status in ('cancelled', 'postponed', 'bye') then 'Back on: ' else 'Moved: ' end)
               || coalesce(v_home, 'TBC') || ' v ' || coalesce(v_away, 'TBC');
    v_body  := 'Now ' || v_when
               || coalesce(' · ' || nullif(coalesce((select name from public.venues where id = new.venue_id), new.venue_label), ''), '')
               || coalesce(' ' || new.field_label, '');
  end if;
  insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload, scheduled_for, escalate_sms, dedupe_key)
  select v_org, r.profile_id, v_kind, left(v_title, 120), left(v_body, 200),
         '/referee',
         jsonb_build_object('fixture_id', new.id, 'appointment_id', ap.id, 'status', new.status),
         now(), v_urgent,
         'ref-change-' || new.id || '-' || r.id || '-' || new.status || '-' || extract(epoch from new.starts_at)::bigint || '-' || coalesce(new.venue_label, '') || coalesce(new.field_label, '')
    from public.referee_appointments ap
    join public.referees r on r.id = ap.referee_id
   where ap.fixture_id = new.id
     and ap.status in ('offered', 'accepted')
     and r.profile_id is not null
  on conflict (dedupe_key) do nothing;
  return new;
end;
$$;
drop trigger if exists fixtures_notify_referees on public.fixtures;
create trigger fixtures_notify_referees
  after update of status, starts_at, venue_id, venue_label, field_label on public.fixtures
  for each row execute function public.notify_referees_of_change();

-- --------------------------------------- 5. finals of four, and a shootout
alter table public.fixtures
  add column if not exists pens_home integer,
  add column if not exists pens_away integer;
alter table public.fixtures drop constraint if exists fixtures_pens_are_a_pair;
alter table public.fixtures add constraint fixtures_pens_are_a_pair
  check ((pens_home is null) = (pens_away is null) and coalesce(pens_home, 0) >= 0 and coalesce(pens_away, 0) >= 0);

drop function if exists public.create_finals(uuid, text, timestamptz, integer, integer, text[], text);
create or replace function public.create_finals(
  p_competition uuid, p_division text, p_start_at timestamptz,
  p_game_mins integer default 20, p_gap_mins integer default 15,
  p_fields text[] default array['Field 1', 'Field 2'], p_venue_label text default null,
  p_top integer default 2, p_final_at timestamptz default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_mode   public.competition_mode;
  v_groups integer;
  v_sf1    uuid;
  v_sf2    uuid;
  v_final_at timestamptz;
  v_made   integer := 0;
begin
  if not app_private.is_competition_organiser(p_competition) then
    raise exception 'only the organiser can set up the finals' using errcode = '42501';
  end if;
  if p_top not in (2, 4) then
    raise exception 'finals are for the top two or the top four' using errcode = '22023';
  end if;

  select mode into v_mode from public.competitions where id = p_competition;
  if v_mode = 'comms_only' then
    raise exception 'This competition is run elsewhere. Its finals live there.'
      using errcode = '22023';
  end if;

  select count(distinct coalesce(group_label, '')) into v_groups
    from public.competition_entries
   where competition_id = p_competition and division = p_division and withdrawn_at is null;

  if v_groups = 0 then
    raise exception 'no teams entered in this division' using errcode = '22023';
  end if;

  delete from public.fixtures
   where competition_id = p_competition and division = p_division
     and stage = 'final' and home_score is null;

  v_final_at := coalesce(p_final_at, p_start_at);

  if v_groups >= 2 or p_top = 4 then
    insert into public.fixtures (competition_id, division, round, stage,
      home_source, away_source, starts_at, duration_mins, venue_label, field_label)
    values (p_competition, p_division, 'Semi-final 1', 'final',
      'P:1:1',
      -- Two groups: cross over, so the winners cannot meet early. One table
      -- of four: first plays fourth (a source is P:<position>:<rank among
      -- the teams at that position>, so fourth of one table is P:4:1).
      case when v_groups = 1 then 'P:4:1' when v_groups = 2 then 'P:2:2' else 'P:2:1' end,
      p_start_at, p_game_mins, p_venue_label, p_fields[1])
    returning id into v_sf1;

    insert into public.fixtures (competition_id, division, round, stage,
      home_source, away_source, starts_at, duration_mins, venue_label, field_label)
    values (p_competition, p_division, 'Semi-final 2', 'final',
      case when v_groups = 1 then 'P:2:1' else 'P:1:2' end,
      case when v_groups = 1 then 'P:3:1' when v_groups = 2 then 'P:2:1' else 'P:1:3' end,
      p_start_at, p_game_mins, p_venue_label, coalesce(p_fields[2], p_fields[1]))
    returning id into v_sf2;

    v_made := 2;
    if p_final_at is null then
      v_final_at := p_start_at + ((p_game_mins + p_gap_mins) || ' minutes')::interval;
    end if;
  end if;

  insert into public.fixtures (competition_id, division, round, stage,
    home_source, away_source, starts_at, duration_mins, venue_label, field_label)
  values (p_competition, p_division, 'Final', 'final',
    -- One group, top two: straight through.
    case when v_sf1 is null then 'P:1:1' else 'W:' || v_sf1 end,
    case when v_sf1 is null then 'P:2:1' else 'W:' || v_sf2 end,
    v_final_at, p_game_mins, p_venue_label, p_fields[1]);

  -- A season already complete seeds them now.
  perform app_private.resolve_finals_internal(p_competition, p_division);
  return v_made + 1;
end;
$$;
revoke execute on function public.create_finals(uuid, text, timestamptz, integer, integer, text[], text, integer, timestamptz) from public, anon;
grant execute on function public.create_finals(uuid, text, timestamptz, integer, integer, text[], text, integer, timestamptz) to authenticated, service_role;

-- A knockout decided on penalties goes to the side that won the shootout.
create or replace function public.resolve_source(p_competition uuid, p_division text, p_source text)
returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  parts text[] := string_to_array(p_source, ':');
  v_id  uuid;
  v_fx  public.fixtures%rowtype;
begin
  if parts[1] = 'P' then
    -- Every group game must be finished, or "best runner-up" is a guess.
    if exists (
      select 1 from public.fixtures
       where competition_id = p_competition and division = p_division
         and stage = 'group' and status not in ('final','forfeit','bye','cancelled')
    ) then
      return null;
    end if;
    select entry_id into v_id
      from public.cross_group_standings(p_competition, p_division, parts[2]::integer)
     order by points desc, goal_difference desc, goals_for desc
     offset (parts[3]::integer - 1) limit 1;
    return v_id;

  elsif parts[1] in ('W', 'L') then
    select * into v_fx from public.fixtures where id = parts[2]::uuid;
    if v_fx.id is null or v_fx.home_score is null or v_fx.away_score is null then
      return null;
    end if;
    -- A drawn knockout is settled by the shootout the organiser recorded
    -- (0276); with none recorded, nobody goes through yet.
    if v_fx.home_score = v_fx.away_score then
      if v_fx.pens_home is null or v_fx.pens_home = v_fx.pens_away then
        return null;
      end if;
      if parts[1] = 'W' then
        return case when v_fx.pens_home > v_fx.pens_away then v_fx.home_entry_id else v_fx.away_entry_id end;
      else
        return case when v_fx.pens_home < v_fx.pens_away then v_fx.home_entry_id else v_fx.away_entry_id end;
      end if;
    end if;
    if parts[1] = 'W' then
      return case when v_fx.home_score > v_fx.away_score then v_fx.home_entry_id else v_fx.away_entry_id end;
    else
      return case when v_fx.home_score < v_fx.away_score then v_fx.home_entry_id else v_fx.away_entry_id end;
    end if;
  end if;

  return null;
end;
$$;

drop function if exists public.rule_on_score(uuid, integer, integer, text);
create or replace function public.rule_on_score(p_fixture uuid, p_home integer, p_away integer, p_note text default null,
                                                p_pens_home integer default null, p_pens_away integer default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  f public.fixtures;
begin
  select * into f from public.fixtures where id = p_fixture;
  if f.id is null or not coalesce(app_private.is_competition_organiser(f.competition_id), false) then
    raise exception 'only the organiser can rule on a score' using errcode = '42501';
  end if;
  if (p_pens_home is null) <> (p_pens_away is null) then
    raise exception 'a shootout needs both sides'' penalties' using errcode = '22023';
  end if;
  if p_pens_home is not null and p_home <> p_away then
    raise exception 'penalties only decide a drawn game' using errcode = '22023';
  end if;
  if p_pens_home is not null and p_pens_home = p_pens_away then
    raise exception 'a shootout has a winner' using errcode = '22023';
  end if;
  update public.fixtures
     set home_score = p_home, away_score = p_away, status = 'final',
         pens_home = p_pens_home, pens_away = p_pens_away,
         score_disputed = false, score_entered_by = auth.uid(), score_entered_at = now(),
         ended_at = coalesce(ended_at, now()), ended_by = coalesce(ended_by, auth.uid()),
         notes = coalesce(nullif(btrim(coalesce(p_note, '')), ''), notes)
   where id = p_fixture;
  update public.match_sheets set status = 'confirmed' where fixture_id = p_fixture and status = 'disputed';
  perform app_private.log_sheet(f.competition_id, p_fixture, null, 'score_ruled',
    jsonb_build_object('home', p_home, 'away', p_away, 'note', p_note, 'pens_home', p_pens_home, 'pens_away', p_pens_away));
end;
$$;
revoke execute on function public.rule_on_score(uuid, integer, integer, text, integer, integer) from public, anon;
grant execute on function public.rule_on_score(uuid, integer, integer, text, integer, integer) to authenticated, service_role;

-- --------------------------------------------------- 6. the smaller things
-- A sheet below the division's minimum.
alter table public.competition_divisions
  add column if not exists squad_size_min integer check (squad_size_min between 1 and 30);

drop function if exists app_private.division_rules(uuid, text);
create or replace function app_private.division_rules(p_competition uuid, p_division text)
returns table(scores_public boolean, ladder_enabled boolean, points_win integer, points_draw integer, points_loss integer,
              tie_break text, match_length_mins integer, squad_size_max integer, sheet_lock_mins integer, finals_min_games integer,
              borrow_cap integer, squad_size_min integer)
language sql stable as $$
  select coalesce(d.scores_public, true), coalesce(d.ladder_enabled, true),
         coalesce(d.points_win, 3), coalesce(d.points_draw, 1), coalesce(d.points_loss, 0),
         coalesce(d.tie_break, 'gd_then_gf'), d.match_length_mins, d.squad_size_max,
         coalesce(d.sheet_lock_mins, 30), d.finals_min_games, d.borrow_cap, d.squad_size_min
    from (select 1) one
    left join public.competition_divisions d
      on d.competition_id = p_competition and d.division = p_division;
$$;

create or replace function public.submit_match_sheet(p_fixture uuid, p_entry uuid, p_players jsonb, p_captain uuid default null, p_keeper uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  f          public.fixtures;
  v_side     text;
  v_max      integer;
  v_min      integer;
  v_lock_m   integer;
  v_n        integer;
  v_sheet    uuid;
  v_row      jsonb;
  v_why      text;
  v_on       date;
  v_lock     timestamptz;
  v_official boolean;
  v_manager  boolean;
  v_after    boolean := false;
begin
  select * into f from public.fixtures where id = p_fixture;
  if f.id is null then
    raise exception 'no such game' using errcode = '22023';
  end if;
  v_side := app_private.fixture_side(p_fixture, p_entry);
  v_manager  := coalesce(app_private.can_manage_entry(p_entry), false);
  v_official := coalesce(app_private.is_fixture_referee(p_fixture), false)
                or coalesce(app_private.is_competition_organiser(f.competition_id), false);
  if not (v_manager or v_official) then
    raise exception 'only the team''s manager or coach can submit its sheet' using errcode = '42501';
  end if;
  if f.ended_at is not null then
    raise exception 'this game has ended; ask the league for a correction' using errcode = '22023';
  end if;
  if f.status in ('final', 'forfeit', 'bye', 'cancelled') then
    raise exception 'this game is %; the sheet is closed', f.status using errcode = '22023';
  end if;
  select r.squad_size_max, r.sheet_lock_mins, r.squad_size_min into v_max, v_lock_m, v_min
    from app_private.division_rules(f.competition_id, f.division) r;
  v_lock := app_private.sheet_lock_at(p_fixture);
  if v_lock is not null and now() >= v_lock then
    v_after := true;
    if not v_official then
      raise exception 'the sheet locked at % (% minutes before kick-off); only the referee or the league can change it now',
        to_char(v_lock at time zone app_private.competition_tz(f.competition_id), 'HH12:MI am'), v_lock_m
        using errcode = '22023';
    end if;
  end if;
  if p_players is null or jsonb_typeof(p_players) <> 'array' or jsonb_array_length(p_players) = 0 then
    raise exception 'a sheet needs players on it' using errcode = '22023';
  end if;
  v_n := jsonb_array_length(p_players);
  if v_max is not null and v_n > v_max then
    raise exception '% players on the sheet; this division allows %', v_n, v_max using errcode = '22023';
  end if;
  -- 0276: short of the division's minimum. The referee or the league can
  -- still record who did take the field.
  if v_min is not null and v_n < v_min and not v_official then
    raise exception '% players on the sheet; this division needs at least %. Borrow from a lower squad, or ask the league about a forfeit.', v_n, v_min using errcode = '22023';
  end if;
  v_on := coalesce(f.starts_at::date, current_date);

  for v_row in select * from jsonb_array_elements(p_players) loop
    v_why := app_private.ineligibility(p_entry, (v_row->>'player_id')::uuid, v_on, p_fixture);
    if v_why is not null then
      raise exception '%', v_why using errcode = '22023';
    end if;
  end loop;

  insert into public.match_sheets (competition_id, fixture_id, entry_id, captain_player_id, keeper_player_id, submitted_by)
  values (f.competition_id, p_fixture, p_entry, p_captain, p_keeper, auth.uid())
  on conflict (fixture_id, entry_id) do update
    set captain_player_id = excluded.captain_player_id,
        keeper_player_id  = excluded.keeper_player_id,
        submitted_by = excluded.submitted_by,
        submitted_at = now(),
        status = 'submitted', confirmed_by = null, confirmed_at = null
  returning id into v_sheet;

  delete from public.match_sheet_players where sheet_id = v_sheet;
  insert into public.match_sheet_players (sheet_id, player_id, number, starting)
  select v_sheet, (x->>'player_id')::uuid, (x->>'number')::integer, coalesce((x->>'starting')::boolean, true)
    from jsonb_array_elements(p_players) x;

  perform app_private.log_sheet(f.competition_id, p_fixture, p_entry,
    case when v_after then 'sheet_changed_after_lock' else 'sheet_submitted' end,
    jsonb_build_object('players', v_n, 'side', v_side, 'after_lock', v_after,
                       'by_official', v_official));
  return v_sheet;
end;
$$;

-- An under-18 referee is not given an U15 or older game.
create or replace function app_private.referee_unavailable_reason(p_referee uuid, p_fixture uuid)
returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_window tstzrange := app_private.fixture_window(p_fixture);
  v_reason text;
  v_other  text;
  v_age    integer;
begin
  if v_window is null then
    return null;
  end if;
  if (select r.under_18 from public.referees r where r.id = p_referee) then
    select app_private.age_number(coalesce(d.age_group, substring(f.division from '\mU\d{1,2}\M')))
      into v_age
      from public.fixtures f
      left join public.competition_divisions d on d.competition_id = f.competition_id and d.division = f.division
     where f.id = p_fixture;
    if v_age is null or v_age >= 15 then
      return 'under 18 — not appointed to U15 and older games';
    end if;
  end if;
  select coalesce(nullif(b.reason, ''), 'not available') into v_reason
    from public.referee_blockouts b
   where b.referee_id = p_referee
     and tstzrange(b.starts_at, b.ends_at, '[)') && v_window
   limit 1;
  if v_reason is not null then
    return 'blocked out: ' || v_reason;
  end if;
  select h.display_name || ' v ' || a.display_name into v_other
    from public.referee_appointments ap
    join public.fixtures f on f.id = ap.fixture_id
    left join public.competition_entries h on h.id = f.home_entry_id
    left join public.competition_entries a on a.id = f.away_entry_id
   where ap.referee_id = p_referee
     and ap.fixture_id <> p_fixture
     and ap.status in ('offered', 'accepted')
     and app_private.fixtures_clash(f.id, p_fixture)
   limit 1;
  if v_other is not null then
    return 'already on ' || v_other;
  end if;
  return null;
end;
$$;

-- The clubs whose entry fee is still owed, reminded every fortnight.
create or replace function public.queue_entry_fee_reminders()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_sent integer := 0;
begin
  with owed as (
    select ef.id, ef.competition_id, ef.amount_cents, ef.created_at,
           coalesce(ef.club_academy_id, ef.academy_id) as club_id,
           e.display_name as team, c.name as competition, c.organiser_id,
           ((current_date - ef.created_at::date) / 14)::integer as fortnight
      from public.entry_fees ef
      join public.competition_entries e on e.id = ef.entry_id
      join public.competitions c on c.id = ef.competition_id
     where ef.status = 'owed'
       and ef.created_at < now() - interval '14 days'
       and c.status = 'active'
  ),
  people as (
    select o.*, am.profile_id
      from owed o
      join public.academy_members am on am.academy_id = o.club_id and am.status = 'active' and am.role in ('owner', 'admin')
    union
    select o.*, cr.profile_id
      from owed o
      join public.club_roles cr on cr.academy_id = o.club_id and cr.role = 'treasurer'
  ),
  queued as (
    insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload, dedupe_key)
    select p.organiser_id, p.profile_id, 'entry_fee_owed',
           left(p.competition || ': entry fee owed for ' || p.team, 120),
           '$' || to_char(p.amount_cents / 100.0, 'FM999999990.00') || ' still to pay the league. The details are under the competition''s Entries.',
           '/competitions/' || p.competition_id || '?tab=entries',
           jsonb_build_object('entry_fee_id', p.id, 'competition_id', p.competition_id, 'amount_cents', p.amount_cents),
           'entry_fee:' || p.id || ':' || p.profile_id || ':' || p.fortnight
      from people p
    on conflict (dedupe_key) do nothing
    returning 1
  )
  select count(*)::integer into v_sent from queued;
  return v_sent;
end;
$$;
revoke execute on function public.queue_entry_fee_reminders() from public, anon, authenticated;

select cron.unschedule('queue-entry-fee-reminders')
 where exists (select 1 from cron.job where jobname = 'queue-entry-fee-reminders');
select cron.schedule(
  'queue-entry-fee-reminders',
  '30 19 * * *',  -- 19:30 UTC is 06:30 in Sydney, after the family fee reminders
  $cron$select public.queue_entry_fee_reminders()$cron$
);

-- An injury report reaches the Welfare officer and the President at once.
create or replace function public.file_incident_report(p_academy uuid, p_what text, p_event uuid default null, p_player uuid default null, p_who text default null,
                                                       p_occurred_at timestamptz default null, p_first_aid text default null, p_ambulance boolean default false, p_parent_told boolean default false)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  e      public.events;
  v_id   uuid;
  v_team uuid;
  v_name text;
  v_by   text;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_event is not null then
    select * into e from public.events where id = p_event and academy_id = p_academy;
    if e.id is null then
      raise exception 'that game is not this club''s' using errcode = '22023';
    end if;
    v_team := e.team_id;
  end if;
  if not (coalesce(app_private.is_academy_coach(p_academy), false)
          or coalesce(app_private.may_run_club(p_academy, 'volunteers'), false)
          or (v_team is not null and coalesce(app_private.is_team_coach(v_team), false))) then
    raise exception 'an incident is reported by the squad''s coach or manager, the club''s staff or a field marshal' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_what, '')), '') is null then
    raise exception 'say what happened' using errcode = '22023';
  end if;
  if p_player is not null and not exists (select 1 from public.players pl where pl.id = p_player and pl.academy_id = p_academy) then
    raise exception 'that player is not this club''s' using errcode = '22023';
  end if;
  insert into public.incident_reports (academy_id, event_id, team_id, reported_by, occurred_at, player_id, who, what, first_aid, ambulance, parent_told)
  values (p_academy, p_event, v_team, auth.uid(), coalesce(p_occurred_at, now()), p_player,
          nullif(btrim(coalesce(p_who, '')), ''), btrim(p_what), nullif(btrim(coalesce(p_first_aid, '')), ''),
          coalesce(p_ambulance, false), coalesce(p_parent_told, false))
  returning id into v_id;

  -- 0276: the Welfare officer and the President hear at once — the people
  -- who ring the family and the league.
  select full_name into v_by from public.profiles where id = auth.uid();
  select coalesce(nullif(pl.preferred_name, ''), split_part(pl.full_name, ' ', 1)) into v_name from public.players pl where pl.id = p_player;
  insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload, dedupe_key)
  select p_academy, x.profile_id, 'incident_report',
         left('Incident' || coalesce(' — ' || v_name, '') || coalesce(' (' || (select t.name from public.teams t where t.id = v_team) || ')', ''), 120),
         left(btrim(p_what) || coalesce(' · ' || nullif(btrim(coalesce(p_first_aid, '')), ''), '')
              || case when coalesce(p_ambulance, false) then ' · ambulance called' else '' end
              || case when coalesce(p_parent_told, false) then ' · family told' else ' · family not yet told' end
              || coalesce(' · reported by ' || v_by, ''), 200),
         '/admin/welfare',
         jsonb_build_object('incident_id', v_id, 'event_id', p_event, 'player_id', p_player),
         'incident:' || v_id || ':' || x.profile_id
    from (
      select o.profile_id from public.safeguarding_officers o where o.academy_id = p_academy
      union
      select cr.profile_id from public.club_roles cr where cr.academy_id = p_academy and cr.role = 'president'
      union
      select am.profile_id from public.academy_members am where am.academy_id = p_academy and am.status = 'active' and am.role = 'owner'
    ) x
   where x.profile_id <> auth.uid()
  on conflict (dedupe_key) do nothing;
  return v_id;
end;
$$;

-- A referee's report of abuse reaches the coordinator and the discipline officer.
create or replace function public.submit_referee_report(p_appointment uuid, p_report jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ap   public.referee_appointments;
  v_ko   timestamptz;
  v_home text;
  v_away text;
  v_ref  text;
  v_who  uuid;
begin
  select * into v_ap from public.referee_appointments where id = p_appointment;
  if v_ap.id is null or not app_private.is_this_referee(v_ap.referee_id) then
    raise exception 'that appointment is not yours' using errcode = '42501';
  end if;
  if v_ap.status <> 'accepted' then
    raise exception 'only an accepted appointment has a report' using errcode = '22023';
  end if;
  select starts_at into v_ko from public.fixtures where id = v_ap.fixture_id;
  if v_ko is null or now() < v_ko then
    raise exception 'the report comes after the game' using errcode = '22023';
  end if;
  if jsonb_typeof(p_report) <> 'object' then
    raise exception 'a report is an object' using errcode = '22023';
  end if;
  update public.referee_appointments set report = p_report, reported_at = now() where id = p_appointment;

  -- 0276: abuse, an injury or a sending-off in the report is not left for
  -- someone to find on a screen.
  if coalesce((p_report->>'abuse')::boolean, false)
     or coalesce((p_report->>'injury')::boolean, false)
     or coalesce((p_report->>'incident')::boolean, false) then
    select h.display_name, a.display_name into v_home, v_away
      from public.fixtures f
      left join public.competition_entries h on h.id = f.home_entry_id
      left join public.competition_entries a on a.id = f.away_entry_id
     where f.id = v_ap.fixture_id;
    select full_name into v_ref from public.referees where id = v_ap.referee_id;
    for v_who in
      select * from app_private.area_holders(v_ap.competition_id, 'referees')
      union
      select * from app_private.area_holders(v_ap.competition_id, 'discipline')
    loop
      insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload, dedupe_key)
      values (v_ap.academy_id, v_who, 'referee_report',
              left(coalesce(v_ref, 'The referee') || ' reports ' || case when coalesce((p_report->>'abuse')::boolean, false) then 'abuse' when coalesce((p_report->>'injury')::boolean, false) then 'an injury' else 'an incident' end
                   || ': ' || coalesce(v_home, 'TBC') || ' v ' || coalesce(v_away, 'TBC'), 120),
              left(coalesce(p_report->>'detail', p_report->>'note', 'See the report on the appointments screen.'), 200),
              '/competitions/' || v_ap.competition_id || '?tab=referees',
              jsonb_build_object('appointment_id', p_appointment, 'fixture_id', v_ap.fixture_id),
              'ref-report-' || p_appointment || '-' || v_who)
      on conflict (dedupe_key) do nothing;
    end loop;
  end if;
end;
$$;
