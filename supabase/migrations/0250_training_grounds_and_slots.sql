-- 0250: training grounds and slots, and "Close ground".
--
-- Big Club Mode item 8 (Joey, 9 Nov 2026): "Grounds (existing
-- venues/pitches) with weeknight slots per pitch/half-pitch. Coordinator
-- assigns teams to slots; clashes refused; families see their slot on the
-- team page and calendar. Ground closure: 'Close ground' for a date → every
-- affected session and game called off and every affected family told in
-- one action."
--
-- Reuse first. A slot IS a weekly series (0090) on a pitch (0198): the
-- series carries the pitch, every session it makes carries it too, and the
-- venue text every screen already reads becomes "Ground · Pitch". The
-- clash rule is the one fixtures have had since 0198 — a pitch, its parent
-- and its halves are one piece of grass — applied to series by weekday and
-- time; the hours are the pitch's (else its parent's), as pitch_open reads
-- them. Closing a ground calls off the club's own sessions there through
-- the same update as call_off_day (0132), so the cancellation trigger tells
-- every family, and games in competitions the club runs through the
-- organiser's own call_off_fixtures; games another league holds there are
-- named for the club to tell the league, never touched.

-- ---------------------------------------------------------------------------
-- 1. A series and its sessions know their pitch.
-- ---------------------------------------------------------------------------
alter table public.event_series
  add column if not exists pitch_id uuid references public.pitches(id) on delete set null,
  add column if not exists venue_id uuid references public.venues(id) on delete set null;
alter table public.events
  add column if not exists pitch_id uuid references public.pitches(id) on delete set null,
  add column if not exists venue_id uuid references public.venues(id) on delete set null;
create index if not exists event_series_pitch_idx on public.event_series (pitch_id) where pitch_id is not null;
create index if not exists events_venue_idx on public.events (venue_id, starts_at) where venue_id is not null;

-- ---------------------------------------------------------------------------
-- 2. The rules: open then, and not taken.
-- ---------------------------------------------------------------------------
-- The first weekday the slot falls outside the pitch's hours (its own, else
-- its parent's; a pitch with no hours set is open), or null.
create or replace function app_private.slot_outside_hours(p_pitch uuid, p_days smallint[], p_time time, p_duration integer)
returns text
language sql stable security definer set search_path = public as $fn$
  with w as (
    select pa.weekday, pa.opens, pa.closes from public.pitch_availability pa where pa.pitch_id = p_pitch
    union all
    select pa.weekday, pa.opens, pa.closes
      from public.pitch_availability pa
      join public.pitches c on c.parent_id = pa.pitch_id
     where c.id = p_pitch
       and not exists (select 1 from public.pitch_availability x where x.pitch_id = p_pitch)
  )
  select (array['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'])[d + 1]
    from unnest(p_days) as d
   where exists (select 1 from w)
     and not exists (select 1 from w
                      where w.weekday = d and w.opens <= p_time
                        and w.closes >= p_time + make_interval(mins => coalesce(p_duration, 60)))
   order by d
   limit 1;
$fn$;

-- Another squad's slot on the pitch, its parent or any of its halves, on a
-- shared weekday, overlapping in time and in dates — named, or null.
create or replace function app_private.slot_clash(
  p_pitch uuid, p_days smallint[], p_time time, p_duration integer, p_from date, p_until date, p_except uuid default null
)
returns text
language sql stable security definer set search_path = public as $fn$
  select coalesce(p.name, 'the pitch') || ' is taken '
         || (array['Sun','Mon','Tue','Wed','Thu','Fri','Sat'])[d + 1] || ' '
         || to_char(s.at_time, 'FMHH12:MI am') || '–' || to_char(s.at_time + make_interval(mins => s.duration_mins), 'FMHH12:MI am')
         || ' by ' || coalesce((select t.name from public.teams t where t.id = s.team_id), s.title)
    from public.event_series s
    join unnest(p_days) as d on d = any (s.days)
    left join public.pitches p on p.id = s.pitch_id
   where s.pitch_id in (select app_private.pitch_family(p_pitch))
     and s.id is distinct from p_except
     and s.ends_on >= p_from and s.starts_on <= p_until
     and s.at_time < p_time + make_interval(mins => coalesce(p_duration, 60))
     and s.at_time + make_interval(mins => s.duration_mins) > p_time
   order by d, s.at_time
   limit 1;
$fn$;

-- ---------------------------------------------------------------------------
-- 3. Put a series on a pitch (or take it off). Coaches and staff.
-- ---------------------------------------------------------------------------
create or replace function public.set_training_slot(p_series uuid, p_pitch uuid)
returns jsonb
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_s     public.event_series;
  v_p     public.pitches;
  v_v     public.venues;
  v_msg   text;
  v_label text;
  v_n     integer := 0;
begin
  select * into v_s from public.event_series where id = p_series;
  if v_s.id is null then
    raise exception 'no such series' using errcode = '42501';
  end if;
  if not coalesce(app_private.is_academy_coach(v_s.academy_id), false) then
    raise exception 'only a coach sets a training slot' using errcode = '42501';
  end if;
  if p_pitch is null then
    update public.event_series set pitch_id = null, venue_id = null where id = p_series;
    update public.events set pitch_id = null, venue_id = null where series_id = p_series and starts_at > now();
    return jsonb_build_object('series_id', p_series, 'pitch', null);
  end if;
  select * into v_p from public.pitches where id = p_pitch and academy_id = v_s.academy_id;
  if v_p.id is null then
    raise exception 'that pitch is not one of the club''s' using errcode = '22023';
  end if;
  select * into v_v from public.venues where id = v_p.venue_id;
  v_msg := app_private.slot_outside_hours(p_pitch, v_s.days, v_s.at_time, v_s.duration_mins);
  if v_msg is not null then
    raise exception '% is not open then on a % — its hours are set in the venue layout', v_p.name, v_msg using errcode = '23P01';
  end if;
  v_msg := app_private.slot_clash(p_pitch, v_s.days, v_s.at_time, v_s.duration_mins, greatest(v_s.starts_on, current_date), v_s.ends_on, p_series);
  if v_msg is not null then
    raise exception '%', v_msg using errcode = '23P01';
  end if;
  v_label := v_v.name || ' · ' || v_p.name;
  update public.event_series set pitch_id = p_pitch, venue_id = v_v.id, venue = v_label where id = p_series;
  -- Sessions still to come follow; past ones keep their record.
  update public.events set pitch_id = p_pitch, venue_id = v_v.id, venue = v_label, updated_at = now()
   where series_id = p_series and starts_at > now();
  get diagnostics v_n = row_count;
  perform app_private.log_activity(v_s.academy_id, 'training_slot_set', 'event_series', p_series,
                                   coalesce((select t.name from public.teams t where t.id = v_s.team_id), v_s.title),
                                   jsonb_build_object('pitch', v_p.name, 'venue', v_v.name));
  return jsonb_build_object('series_id', p_series, 'pitch', v_p.name, 'venue', v_v.name, 'sessions_updated', v_n);
end;
$fn$;
revoke execute on function public.set_training_slot(uuid, uuid) from public, anon;
grant execute on function public.set_training_slot(uuid, uuid) to authenticated;

-- Weekly training on a pitch, in one go: the slot is checked BEFORE a
-- session is made, so a refused slot leaves nothing behind.
create or replace function public.create_training_series(
  p_academy uuid, p_title text, p_days smallint[], p_time time, p_from date, p_until date,
  p_team uuid default null, p_duration integer default 60, p_arrive integer default null,
  p_pitch uuid default null, p_venue text default null
)
returns jsonb
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_p     public.pitches;
  v_v     public.venues;
  v_msg   text;
  v_label text;
  v_res   jsonb;
  v_series uuid;
begin
  if not coalesce(app_private.is_academy_coach(p_academy), false) then
    raise exception 'only a coach adds training' using errcode = '42501';
  end if;
  if p_pitch is not null then
    select * into v_p from public.pitches where id = p_pitch and academy_id = p_academy;
    if v_p.id is null then
      raise exception 'that pitch is not one of the club''s' using errcode = '22023';
    end if;
    select * into v_v from public.venues where id = v_p.venue_id;
    v_msg := app_private.slot_outside_hours(p_pitch, p_days, p_time, coalesce(p_duration, 60));
    if v_msg is not null then
      raise exception '% is not open then on a % — its hours are set in the venue layout', v_p.name, v_msg using errcode = '23P01';
    end if;
    v_msg := app_private.slot_clash(p_pitch, p_days, p_time, coalesce(p_duration, 60), p_from, p_until, null);
    if v_msg is not null then
      raise exception '%', v_msg using errcode = '23P01';
    end if;
    v_label := v_v.name || ' · ' || v_p.name;
  end if;
  v_res := public.create_event_series(p_academy, p_title, p_days, p_time, p_from, p_until, p_team, 'training',
                                      coalesce(p_duration, 60), p_arrive, coalesce(v_label, nullif(btrim(coalesce(p_venue, '')), '')));
  v_series := (v_res->>'series_id')::uuid;
  if p_pitch is not null then
    update public.event_series set pitch_id = p_pitch, venue_id = v_v.id where id = v_series;
    update public.events set pitch_id = p_pitch, venue_id = v_v.id where series_id = v_series;
    perform app_private.log_activity(p_academy, 'training_slot_set', 'event_series', v_series,
                                     coalesce((select t.name from public.teams t where t.id = p_team), p_title),
                                     jsonb_build_object('pitch', v_p.name, 'venue', v_v.name));
  end if;
  return v_res || jsonb_build_object('pitch', v_p.name, 'venue', v_v.name);
end;
$fn$;
revoke execute on function public.create_training_series(uuid, text, smallint[], time, date, date, uuid, integer, integer, uuid, text) from public, anon;
grant execute on function public.create_training_series(uuid, text, smallint[], time, date, date, uuid, integer, integer, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Readers: a ground's week, and a team's slot.
-- ---------------------------------------------------------------------------
create or replace function public.ground_slots(p_venue uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v public.venues;
begin
  if auth.uid() is null then
    return null;
  end if;
  select * into v from public.venues where id = p_venue;
  if v.id is null or not coalesce(app_private.is_academy_member(v.academy_id), false) then
    return null;
  end if;
  return jsonb_build_object(
    'venue', jsonb_build_object('id', v.id, 'name', v.name),
    'pitches', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'name', p.name, 'size', p.size, 'parent_id', p.parent_id,
               'hours', coalesce((select jsonb_agg(jsonb_build_object('weekday', pa.weekday, 'opens', pa.opens, 'closes', pa.closes) order by pa.weekday)
                                    from public.pitch_availability pa where pa.pitch_id = p.id), '[]'::jsonb),
               'slots', coalesce((select jsonb_agg(jsonb_build_object(
                                           'series_id', s.id, 'title', s.title, 'team_id', s.team_id,
                                           'team', (select t.name from public.teams t where t.id = s.team_id),
                                           'days', s.days, 'at_time', s.at_time, 'duration_mins', s.duration_mins,
                                           'starts_on', s.starts_on, 'ends_on', s.ends_on) order by s.at_time)
                                    from public.event_series s where s.pitch_id = p.id and s.ends_on >= current_date), '[]'::jsonb))
             order by p.sort, p.name)
        from public.pitches p where p.venue_id = v.id), '[]'::jsonb));
end;
$fn$;
revoke execute on function public.ground_slots(uuid) from public, anon;
grant execute on function public.ground_slots(uuid) to authenticated;

create or replace function public.team_training(p_team uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_academy uuid;
begin
  if auth.uid() is null then
    return null;
  end if;
  select t.academy_id into v_academy from public.teams t where t.id = p_team;
  if v_academy is null or not coalesce(app_private.is_academy_member(v_academy), false) then
    return null;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'series_id', s.id, 'title', s.title, 'days', s.days, 'at_time', s.at_time, 'duration_mins', s.duration_mins,
             'venue', s.venue, 'venue_id', s.venue_id, 'pitch_id', s.pitch_id,
             'pitch', (select p.name from public.pitches p where p.id = s.pitch_id),
             'ground', (select v.name from public.venues v where v.id = s.venue_id),
             'starts_on', s.starts_on, 'ends_on', s.ends_on) order by s.at_time)
      from public.event_series s
     where s.team_id = p_team and s.type = 'training' and s.ends_on >= current_date), '[]'::jsonb);
end;
$fn$;
revoke execute on function public.team_training(uuid) from public, anon;
grant execute on function public.team_training(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Close ground: a date, a venue, one action.
-- ---------------------------------------------------------------------------
create or replace function public.close_ground(p_academy uuid, p_venue uuid, p_date date, p_reason text default 'ground_closed', p_note text default null)
returns jsonb
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v        public.venues;
  v_zone   text;
  v_from   timestamptz;
  v_to     timestamptz;
  v_sessions integer := 0;
  v_titles text[];
  v_games  integer := 0;
  v_c      record;
  v_r      jsonb;
  v_failed jsonb := '[]'::jsonb;
  v_league jsonb;
begin
  if not coalesce(app_private.is_academy_coach(p_academy), false) then
    raise exception 'only a coach can close a ground' using errcode = '42501';
  end if;
  if p_reason is null or p_reason not in ('wet_weather', 'ground_closed', 'forfeit', 'not_enough_players', 'other') then
    raise exception 'that is not a reason this product knows' using errcode = '22023';
  end if;
  select * into v from public.venues where id = p_venue and academy_id = p_academy;
  if v.id is null then
    raise exception 'that ground is not one of the club''s' using errcode = '22023';
  end if;
  select timezone into v_zone from public.academies where id = p_academy;
  v_from := (p_date::timestamp at time zone coalesce(v_zone, 'Australia/Sydney'));
  v_to   := ((p_date + 1)::timestamp at time zone coalesce(v_zone, 'Australia/Sydney'));

  -- The club's own sessions and events there, still to come. Not the
  -- mirrored league games: those are the fixture's, below. The trigger
  -- (events_notify_change) tells every family, SMS inside 24 hours.
  with hit as (
    update public.events e
       set cancelled_at = now(),
           cancellation_reason = p_reason,
           cancellation_note = nullif(btrim(coalesce(p_note, '')), ''),
           updated_at = now()
     where e.academy_id = p_academy
       and e.starts_at >= v_from and e.starts_at < v_to
       and e.cancelled_at is null
       and e.starts_at > now()
       and e.fixture_id is null
       and (e.venue_id = p_venue
            or (e.venue_id is null and e.venue is not null
                and (e.venue ilike '%' || v.name || '%' or v.name ilike '%' || e.venue || '%')))
    returning e.title
  )
  select count(*), coalesce(array_agg(title), '{}') into v_sessions, v_titles from hit;

  -- Games in competitions this club runs, at this ground: the organiser's
  -- own call-off, one competition at a time. Postponed, not cancelled —
  -- a closed ground is a game to re-schedule.
  for v_c in
    select distinct c.id, c.name
      from public.competitions c
      join public.fixtures f on f.competition_id = c.id
     where c.organiser_id = p_academy and f.venue_id = p_venue
       and f.starts_at >= v_from and f.starts_at < v_to and f.status in ('scheduled', 'in_progress')
  loop
    begin
      v_r := public.call_off_fixtures(v_c.id, p_date, p_reason, v.name, false, p_note, null);
      v_games := v_games + coalesce((v_r->>'affected')::integer, 0);
    exception when others then
      v_failed := v_failed || jsonb_build_object('competition', v_c.name, 'why', sqlerrm);
    end;
  end loop;

  -- Games another league holds here that day are theirs to call off; named
  -- so the club can tell them, never touched.
  select coalesce(jsonb_agg(jsonb_build_object('competition', c.name, 'organiser', coalesce(a.name, c.organiser), 'games', x.n)), '[]'::jsonb)
    into v_league
    from (select f.competition_id, count(*) as n
            from public.fixtures f
           where f.venue_id = p_venue and f.starts_at >= v_from and f.starts_at < v_to
             and f.status in ('scheduled', 'in_progress')
           group by f.competition_id) x
    join public.competitions c on c.id = x.competition_id
    left join public.academies a on a.id = c.organiser_id
   where c.organiser_id is distinct from p_academy;

  perform app_private.log_activity(p_academy, 'ground_closed', 'venue', p_venue, v.name,
                                   jsonb_build_object('date', p_date, 'reason', p_reason, 'sessions', v_sessions, 'games', v_games));
  return jsonb_build_object('sessions', v_sessions, 'titles', to_jsonb(v_titles), 'games', v_games,
                            'could_not', v_failed, 'ask_the_league', v_league);
end;
$fn$;
revoke execute on function public.close_ground(uuid, uuid, date, text, text) from public, anon;
grant execute on function public.close_ground(uuid, uuid, date, text, text) to authenticated;
