-- 0252: volunteers — a ground's Saturday roster, a squad's duty rotation,
-- and the coordinator's view of the gaps.
--
-- Big Club Mode item 10 (Joey, 9 Nov 2026): "Club rosters: canteen, BBQ,
-- ground official/field marshal, set-up/pack-up — per ground per Saturday
-- (extend G-07 helpers). Team duty roster: oranges, linesperson, kit wash —
-- fair rotation across families, swap requests, reminders. Volunteer
-- coordinator sees this."
--
-- Reuse first. A ground's Saturday IS an event — club-wide, of type 'other',
-- marked ground_day — so the helpers machinery (0225: jobs with spots and
-- times, "I can help", the ask, the 6 pm reminder, the editor on the event
-- page) works on it unchanged, and every game at that ground that day shows
-- the ground's jobs beside its own. Duties are new and small: a squad's
-- list of titles, one family per title per game, the fewest turns first.

-- ---------------------------------------------------------------------------
-- 1. A ground's day.
-- ---------------------------------------------------------------------------
alter table public.events
  add column if not exists ground_day boolean not null default false;
create index if not exists events_ground_day_idx on public.events (academy_id, starts_at) where ground_day;

-- Whoever runs volunteers manages the jobs on a club-wide event too.
create or replace function app_private.may_manage_helpers(p_event uuid)
returns boolean
language plpgsql stable security definer set search_path = public as $fn$
declare
  e public.events;
begin
  select * into e from public.events where id = p_event;
  if e.id is null or e.private_to is not null then
    return false;
  end if;
  if e.team_id is not null then
    return coalesce(app_private.is_team_coach(e.team_id), false);
  end if;
  return coalesce(app_private.is_academy_coach(e.academy_id), false)
      or coalesce(app_private.may_run_club(e.academy_id, 'volunteers'), false);
end;
$fn$;

-- The ground's day, made once per ground and date, with the usual jobs
-- unless told otherwise. Returns the event, existing or new.
create or replace function public.create_ground_day(p_academy uuid, p_venue uuid, p_date date, p_jobs jsonb default null)
returns uuid
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v    public.venues;
  v_tz text;
  v_id uuid;
  v_item jsonb;
  v_pos integer := 0;
begin
  if not (coalesce(app_private.is_academy_coach(p_academy), false) or coalesce(app_private.may_run_club(p_academy, 'volunteers'), false)) then
    raise exception 'only the club''s staff or its volunteer coordinator sets a ground''s day' using errcode = '42501';
  end if;
  select * into v from public.venues where id = p_venue and academy_id = p_academy;
  if v.id is null then
    raise exception 'that ground is not one of the club''s' using errcode = '22023';
  end if;
  select coalesce(timezone, 'Australia/Sydney') into v_tz from public.academies where id = p_academy;
  select e.id into v_id from public.events e
   where e.academy_id = p_academy and e.ground_day and e.venue_id = p_venue
     and (e.starts_at at time zone v_tz)::date = p_date
   limit 1;
  if v_id is not null then
    return v_id;
  end if;
  insert into public.events (academy_id, team_id, type, title, starts_at, ends_at, venue, address, venue_id, source, ground_day)
  values (p_academy, null, 'other', v.name || ' — ' || to_char(p_date, 'FMDay'),
          (p_date::timestamp + time '07:00') at time zone v_tz, (p_date::timestamp + time '18:00') at time zone v_tz,
          v.name, v.address, p_venue, 'manual', true)
  returning id into v_id;
  for v_item in select * from jsonb_array_elements(coalesce(p_jobs, '[
      {"title": "Set-up", "start_time": "07:00", "end_time": "08:00", "spots": 2},
      {"title": "Canteen", "start_time": "08:00", "end_time": "12:00", "spots": 2},
      {"title": "BBQ", "start_time": "10:00", "end_time": "14:00", "spots": 2},
      {"title": "Field marshal", "start_time": "08:00", "end_time": "12:00", "spots": 1},
      {"title": "Pack-down", "start_time": "14:00", "end_time": "15:00", "spots": 2}]'::jsonb)) loop
    v_pos := v_pos + 1;
    insert into public.event_jobs (academy_id, event_id, title, start_time, end_time, spots, position, created_by)
    values (p_academy, v_id, btrim(v_item->>'title'), nullif(v_item->>'start_time', '')::time, nullif(v_item->>'end_time', '')::time,
            greatest(1, least(30, coalesce((v_item->>'spots')::integer, 1))), v_pos, auth.uid());
  end loop;
  perform app_private.log_activity(p_academy, 'ground_day_made', 'event', v_id, v.name || ' ' || p_date::text, jsonb_build_object('venue_id', p_venue, 'date', p_date));
  return v_id;
end;
$fn$;
revoke execute on function public.create_ground_day(uuid, uuid, date, jsonb) from public, anon;
grant execute on function public.create_ground_day(uuid, uuid, date, jsonb) to authenticated;

-- The ground's jobs beside a game's own, on every game there that day.
create or replace function public.event_helpers(p_event uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  e    public.events;
  v_tz text;
  g    public.events;
begin
  select * into e from public.events where id = p_event;
  if e.id is null or not coalesce(app_private.can_read_event(p_event), false) then
    raise exception 'that event is not one of yours' using errcode = '42501';
  end if;
  select coalesce(a.timezone, 'Australia/Sydney') into v_tz from public.academies a where a.id = e.academy_id;
  -- The ground's day, when this is a game there (and not the day itself).
  if not e.ground_day then
    select x.* into g from public.events x
     where x.academy_id = e.academy_id and x.ground_day and x.cancelled_at is null
       and (x.starts_at at time zone v_tz)::date = (e.starts_at at time zone v_tz)::date
       and ((e.venue_id is not null and x.venue_id = e.venue_id)
            or (e.venue_id is null and e.venue is not null and x.venue is not null
                and (e.venue ilike '%' || x.venue || '%' or x.venue ilike '%' || e.venue || '%')))
     limit 1;
  end if;
  return jsonb_build_object(
    'can_manage', app_private.may_manage_helpers(p_event),
    'can_help', e.private_to is null and e.cancelled_at is null
                and (e.starts_at at time zone v_tz)::date >= (now() at time zone v_tz)::date,
    'ground_day', e.ground_day,
    'jobs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', j.id, 'title', j.title,
               'start_time', to_char(j.start_time, 'HH24:MI'), 'end_time', to_char(j.end_time, 'HH24:MI'),
               'time', app_private.job_time(j.start_time, j.end_time),
               'spots', j.spots, 'note', j.note,
               'helpers', coalesce((
                 select jsonb_agg(jsonb_build_object('profile_id', h.profile_id, 'name', pr.full_name, 'me', h.profile_id = auth.uid())
                                  order by h.created_at)
                   from public.event_job_helpers h
                   join public.profiles pr on pr.id = h.profile_id
                  where h.job_id = j.id), '[]'::jsonb))
             order by j.position, j.start_time nulls first, j.created_at)
        from public.event_jobs j
       where j.event_id = p_event), '[]'::jsonb),
    'ground', case when g.id is null then null else jsonb_build_object(
      'event_id', g.id, 'title', g.title,
      'jobs', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', j.id, 'title', j.title,
                 'start_time', to_char(j.start_time, 'HH24:MI'), 'end_time', to_char(j.end_time, 'HH24:MI'),
                 'time', app_private.job_time(j.start_time, j.end_time),
                 'spots', j.spots, 'note', j.note,
                 'helpers', coalesce((
                   select jsonb_agg(jsonb_build_object('profile_id', h.profile_id, 'name', pr.full_name, 'me', h.profile_id = auth.uid())
                                    order by h.created_at)
                     from public.event_job_helpers h
                     join public.profiles pr on pr.id = h.profile_id
                    where h.job_id = j.id), '[]'::jsonb))
               order by j.position, j.start_time nulls first, j.created_at)
          from public.event_jobs j
         where j.event_id = g.id), '[]'::jsonb)) end);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 2. A squad's duties: the titles, and one family per title per game.
-- ---------------------------------------------------------------------------
create table if not exists public.team_duties (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  team_id     uuid not null,
  title       text not null check (char_length(btrim(title)) between 1 and 40),
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  constraint team_duties_once unique (team_id, title),
  constraint team_duties_team_fkey foreign key (team_id, academy_id) references public.teams (id, academy_id) on delete cascade
);
alter table public.team_duties enable row level security;
drop policy if exists team_duties_select on public.team_duties;
create policy team_duties_select on public.team_duties
  for select to authenticated
  using ((select app_private.is_team_member(team_id)) or (select app_private.is_team_coach(team_id)));

create table if not exists public.event_duties (
  id                 uuid primary key default gen_random_uuid(),
  academy_id         uuid not null references public.academies(id) on delete cascade,
  event_id           uuid not null,
  team_id            uuid not null,
  title              text not null,
  player_id          uuid not null,
  requested_swap_at  timestamptz,
  swap_note          text check (swap_note is null or char_length(swap_note) <= 200),
  created_at         timestamptz not null default now(),
  constraint event_duties_once unique (event_id, title),
  constraint event_duties_event_fkey foreign key (event_id, academy_id) references public.events (id, academy_id) on delete cascade,
  constraint event_duties_team_fkey foreign key (team_id, academy_id) references public.teams (id, academy_id) on delete cascade,
  constraint event_duties_player_fkey foreign key (player_id, academy_id) references public.players (id, academy_id) on delete cascade
);
create index if not exists event_duties_team_idx on public.event_duties (team_id, player_id);
alter table public.event_duties enable row level security;
drop policy if exists event_duties_select on public.event_duties;
create policy event_duties_select on public.event_duties
  for select to authenticated
  using ((select app_private.can_read_event(event_id)));
-- Written through the functions below only.

-- Who may set a squad's duties and roster them: its coach or manager, the
-- staff, whoever runs volunteers.
create or replace function app_private.may_roster(p_team uuid)
returns boolean
language sql stable security definer set search_path = public as $fn$
  select coalesce(app_private.is_team_coach(p_team), false)
      or coalesce(app_private.may_run_club((select t.academy_id from public.teams t where t.id = p_team), 'volunteers'), false);
$fn$;

create or replace function public.set_team_duties(p_team uuid, p_titles text[])
returns jsonb
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_academy uuid;
  v_t text;
  v_pos integer := 0;
  v_keep text[] := '{}';
begin
  select t.academy_id into v_academy from public.teams t where t.id = p_team;
  if v_academy is null or not app_private.may_roster(p_team) then
    raise exception 'only the squad''s coach or manager sets its duties' using errcode = '42501';
  end if;
  if coalesce(array_length(p_titles, 1), 0) > 12 then
    raise exception 'up to twelve duties' using errcode = '22023';
  end if;
  foreach v_t in array coalesce(p_titles, '{}') loop
    v_t := btrim(v_t);
    if v_t = '' or v_t = any (v_keep) then continue; end if;
    v_pos := v_pos + 1;
    v_keep := v_keep || v_t;
    insert into public.team_duties (academy_id, team_id, title, position)
    values (v_academy, p_team, v_t, v_pos)
    on conflict (team_id, title) do update set position = excluded.position;
  end loop;
  -- A duty taken off the list takes its turns still to come with it.
  delete from public.event_duties d
   where d.team_id = p_team and not (d.title = any (v_keep))
     and exists (select 1 from public.events e where e.id = d.event_id and e.starts_at > now());
  delete from public.team_duties where team_id = p_team and not (title = any (v_keep));
  return to_jsonb(v_keep);
end;
$fn$;
revoke execute on function public.set_team_duties(uuid, text[]) from public, anon;
grant execute on function public.set_team_duties(uuid, text[]) to authenticated;

-- The rotation: for each game still to come without a family on a duty,
-- the family with the fewest turns on this squad, the longest ago first,
-- never the same family twice in one game.
create or replace function public.roster_team_duties(p_team uuid, p_games integer default 10)
returns jsonb
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_academy uuid;
  v_e record;
  v_d record;
  v_player uuid;
  v_games integer := 0;
  v_assigned integer := 0;
begin
  select t.academy_id into v_academy from public.teams t where t.id = p_team;
  if v_academy is null or not app_private.may_roster(p_team) then
    raise exception 'only the squad''s coach or manager rosters its duties' using errcode = '42501';
  end if;
  if not exists (select 1 from public.team_duties d where d.team_id = p_team) then
    raise exception 'set the squad''s duties first' using errcode = '22023';
  end if;
  for v_e in
    select e.id from public.events e
     where e.team_id = p_team and e.type in ('match', 'tournament') and e.cancelled_at is null and e.private_to is null
       and e.starts_at > now()
     order by e.starts_at
     limit greatest(1, least(coalesce(p_games, 10), 40))
  loop
    v_games := v_games + 1;
    for v_d in select d.title from public.team_duties d where d.team_id = p_team order by d.position loop
      if exists (select 1 from public.event_duties x where x.event_id = v_e.id and x.title = v_d.title) then
        continue;
      end if;
      select pl.id into v_player
        from public.players pl
       where pl.team_id = p_team
         and pl.id not in (select x.player_id from public.event_duties x where x.event_id = v_e.id)
       order by (select count(*) from public.event_duties x where x.team_id = p_team and x.player_id = pl.id),
                (select max(ev.starts_at) from public.event_duties x join public.events ev on ev.id = x.event_id
                  where x.team_id = p_team and x.player_id = pl.id) asc nulls first,
                pl.full_name
       limit 1;
      if v_player is null then
        exit;
      end if;
      insert into public.event_duties (academy_id, event_id, team_id, title, player_id)
      values (v_academy, v_e.id, p_team, v_d.title, v_player);
      v_assigned := v_assigned + 1;
    end loop;
  end loop;
  perform app_private.log_activity(v_academy, 'duties_rostered', 'team', p_team,
                                   (select t.name from public.teams t where t.id = p_team),
                                   jsonb_build_object('games', v_games, 'assigned', v_assigned));
  return jsonb_build_object('games', v_games, 'assigned', v_assigned);
end;
$fn$;
revoke execute on function public.roster_team_duties(uuid, integer) from public, anon;
grant execute on function public.roster_team_duties(uuid, integer) to authenticated;

-- A family's name: the child's surname, as a club says it.
create or replace function app_private.family_name(p_player uuid)
returns text
language sql stable security definer set search_path = public as $fn$
  select coalesce(nullif(split_part(pl.full_name, ' ', array_length(string_to_array(pl.full_name, ' '), 1)), ''), pl.full_name) || ' family'
    from public.players pl where pl.id = p_player;
$fn$;

create or replace function public.event_duties(p_event uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  e public.events;
begin
  select * into e from public.events where id = p_event;
  if e.id is null or not coalesce(app_private.can_read_event(p_event), false) then
    return null;
  end if;
  return jsonb_build_object(
    'can_manage', e.team_id is not null and app_private.may_roster(e.team_id),
    'can_take', e.team_id is not null and (coalesce(app_private.is_team_member(e.team_id), false)),
    'titles', coalesce((select jsonb_agg(d.title order by d.position) from public.team_duties d where d.team_id = e.team_id), '[]'::jsonb),
    'duties', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', d.id, 'title', d.title, 'player_id', d.player_id,
               'player', (select coalesce(pl.preferred_name, split_part(pl.full_name, ' ', 1)) from public.players pl where pl.id = d.player_id),
               'family', app_private.family_name(d.player_id),
               'mine', coalesce(app_private.is_guardian_of(d.player_id), false),
               'requested_swap_at', d.requested_swap_at, 'swap_note', d.swap_note)
             order by d.created_at)
        from public.event_duties d where d.event_id = p_event), '[]'::jsonb));
end;
$fn$;
revoke execute on function public.event_duties(uuid) from public, anon;
grant execute on function public.event_duties(uuid) to authenticated;

-- "We can't do it that week": the squad hears it where it talks.
create or replace function public.request_duty_swap(p_duty uuid, p_note text default null)
returns jsonb
language plpgsql volatile security definer set search_path = public as $fn$
declare
  d public.event_duties;
  e public.events;
  v_chan uuid;
  v_tz text;
begin
  select * into d from public.event_duties where id = p_duty;
  if d.id is null then
    raise exception 'no such duty' using errcode = '42501';
  end if;
  if not (coalesce(app_private.is_guardian_of(d.player_id), false) or app_private.may_roster(d.team_id)) then
    raise exception 'only that family, or the squad''s coach, asks for a swap' using errcode = '42501';
  end if;
  select * into e from public.events where id = d.event_id;
  if e.starts_at <= now() then
    raise exception 'that game has been played' using errcode = '22023';
  end if;
  update public.event_duties set requested_swap_at = now(), swap_note = nullif(btrim(coalesce(p_note, '')), '') where id = p_duty;
  select coalesce(a.timezone, 'Australia/Sydney') into v_tz from public.academies a where a.id = e.academy_id;
  select c.id into v_chan from public.channels c where c.team_id = d.team_id and c.type = 'team' and c.status = 'active' limit 1;
  if v_chan is not null then
    insert into public.messages (academy_id, channel_id, sender_id, body, event_id)
    values (e.academy_id, v_chan, auth.uid(),
            'The ' || app_private.family_name(d.player_id) || ' can''t do ' || d.title || ' on '
            || to_char(e.starts_at at time zone v_tz, 'FMDay FMDD Mon') || coalesce(' v ' || e.opponent, '')
            || ' — can anyone swap? Open the game and tap "I''ll take it".'
            || coalesce(chr(10) || nullif(btrim(coalesce(p_note, '')), ''), ''),
            e.id);
  end if;
  return public.event_duties(d.event_id);
end;
$fn$;
revoke execute on function public.request_duty_swap(uuid, text) from public, anon;
grant execute on function public.request_duty_swap(uuid, text) to authenticated;

-- "We'll take it": another family on the squad.
create or replace function public.take_duty(p_duty uuid)
returns jsonb
language plpgsql volatile security definer set search_path = public as $fn$
declare
  d public.event_duties;
  e public.events;
  v_child uuid;
  v_chan uuid;
  v_tz text;
begin
  select * into d from public.event_duties where id = p_duty;
  if d.id is null then
    raise exception 'no such duty' using errcode = '42501';
  end if;
  select * into e from public.events where id = d.event_id;
  if e.starts_at <= now() then
    raise exception 'that game has been played' using errcode = '22023';
  end if;
  -- The taker's own child on this squad (an adult player is their own).
  select pl.id into v_child
    from public.players pl
   where pl.team_id = d.team_id
     and (pl.profile_id = auth.uid()
          or exists (select 1 from public.player_guardians g where g.player_id = pl.id and g.profile_id = auth.uid()))
   order by pl.full_name
   limit 1;
  if v_child is null then
    raise exception 'only a family on this squad can take a duty' using errcode = '42501';
  end if;
  if v_child = d.player_id then
    raise exception 'that is already yours' using errcode = '22023';
  end if;
  update public.event_duties set player_id = v_child, requested_swap_at = null, swap_note = null where id = p_duty;
  select coalesce(a.timezone, 'Australia/Sydney') into v_tz from public.academies a where a.id = e.academy_id;
  select c.id into v_chan from public.channels c where c.team_id = d.team_id and c.type = 'team' and c.status = 'active' limit 1;
  if v_chan is not null then
    insert into public.messages (academy_id, channel_id, sender_id, body, event_id)
    values (e.academy_id, v_chan, auth.uid(),
            'The ' || app_private.family_name(v_child) || ' will do ' || d.title || ' on '
            || to_char(e.starts_at at time zone v_tz, 'FMDay FMDD Mon') || ' — thanks.',
            e.id);
  end if;
  return public.event_duties(d.event_id);
end;
$fn$;
revoke execute on function public.take_duty(uuid) from public, anon;
grant execute on function public.take_duty(uuid) to authenticated;

-- The evening before, each family with a duty tomorrow: once. Hourly from
-- five, the club's time. p_now is for the tests.
create or replace function public.queue_duty_reminders(p_now timestamptz default now())
returns integer
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_n integer := 0;
  v_k integer;
  r record;
begin
  for r in
    select d.id as duty_id, d.title, d.player_id, e.id as event_id, e.academy_id, e.opponent, e.starts_at, t.name as team_name,
           coalesce(a.timezone, 'Australia/Sydney') as tz
      from public.event_duties d
      join public.events e on e.id = d.event_id
      join public.teams t on t.id = d.team_id
      join public.academies a on a.id = e.academy_id
     where e.cancelled_at is null and e.private_to is null
       and (e.starts_at at time zone coalesce(a.timezone, 'Australia/Sydney'))::date
           = (p_now at time zone coalesce(a.timezone, 'Australia/Sydney'))::date + 1
       and extract(hour from p_now at time zone coalesce(a.timezone, 'Australia/Sydney')) >= 17
  loop
    insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload, dedupe_key)
    select r.academy_id, x.profile_id, 'helper_reminder',
           'Tomorrow: ' || r.title || ' for ' || r.team_name || coalesce(' v ' || r.opponent, ''),
           'Your turn. Kick-off ' || to_char(r.starts_at at time zone r.tz, 'FMHH12:MI am') || '. Can''t make it? Open the game and ask for a swap.',
           '/calendar/' || r.event_id,
           jsonb_build_object('event_id', r.event_id, 'duty_id', r.duty_id),
           'duty:' || r.duty_id || ':' || x.profile_id
      from (
        select g.profile_id from public.player_guardians g
          join public.academy_members am on am.profile_id = g.profile_id and am.academy_id = r.academy_id and am.status = 'active'
         where g.player_id = r.player_id
        union
        select pl.profile_id from public.players pl where pl.id = r.player_id and pl.profile_id is not null
      ) x
    on conflict (dedupe_key) do nothing;
    get diagnostics v_k = row_count;
    v_n := v_n + v_k;
  end loop;
  return v_n;
end;
$fn$;
revoke execute on function public.queue_duty_reminders(timestamptz) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.queue_duty_reminders(timestamptz) to service_role;
  end if;
end $$;
select cron.unschedule('queue-duties')
 where exists (select 1 from cron.job where jobname = 'queue-duties');
select cron.schedule(
  'queue-duties',
  '10 * * * *',
  $cron$select public.queue_duty_reminders()$cron$
);

-- ---------------------------------------------------------------------------
-- 3. The coordinator's gaps: the next fortnight.
-- ---------------------------------------------------------------------------
create or replace function public.volunteer_gaps(p_academy uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_tz text;
begin
  if auth.uid() is null then
    return null;
  end if;
  if not (coalesce(app_private.is_academy_staff(p_academy), false) or coalesce(app_private.may_run_club(p_academy, 'volunteers'), false)) then
    return null;
  end if;
  select coalesce(timezone, 'Australia/Sydney') into v_tz from public.academies where id = p_academy;
  return jsonb_build_object(
    'ground_days', coalesce((
      select jsonb_agg(jsonb_build_object(
               'event_id', e.id, 'title', e.title, 'venue', e.venue, 'venue_id', e.venue_id,
               'date', (e.starts_at at time zone v_tz)::date,
               'spots', (select coalesce(sum(j.spots), 0) from public.event_jobs j where j.event_id = e.id),
               'filled', (select count(*) from public.event_job_helpers h join public.event_jobs j on j.id = h.job_id where j.event_id = e.id),
               'open', (select coalesce(sum(greatest(j.spots - (select count(*) from public.event_job_helpers h where h.job_id = j.id), 0)), 0)
                          from public.event_jobs j where j.event_id = e.id),
               'games', (select count(*) from public.events g
                          where g.academy_id = p_academy and g.type in ('match', 'tournament') and g.cancelled_at is null and g.private_to is null
                            and (g.starts_at at time zone v_tz)::date = (e.starts_at at time zone v_tz)::date
                            and ((g.venue_id is not null and g.venue_id = e.venue_id)
                                 or (g.venue_id is null and g.venue is not null and (g.venue ilike '%' || e.venue || '%' or e.venue ilike '%' || g.venue || '%')))))
             order by e.starts_at)
        from public.events e
       where e.academy_id = p_academy and e.ground_day and e.cancelled_at is null
         and e.starts_at >= now() - interval '1 day' and e.starts_at < now() + interval '14 days'), '[]'::jsonb),
    -- Game days at a drawn ground with no ground's day yet.
    'days_without', coalesce((
      select jsonb_agg(jsonb_build_object('venue_id', x.venue_id, 'venue', x.venue, 'date', x.d, 'games', x.n) order by x.d, x.venue)
        from (
          select g.venue_id, v.name as venue, (g.starts_at at time zone v_tz)::date as d, count(*) as n
            from public.events g
            join public.venues v on v.id = g.venue_id
           where g.academy_id = p_academy and g.type in ('match', 'tournament') and g.cancelled_at is null and g.private_to is null
             and g.starts_at >= now() and g.starts_at < now() + interval '14 days'
             and not exists (select 1 from public.events e where e.academy_id = p_academy and e.ground_day and e.cancelled_at is null
                               and e.venue_id = g.venue_id and (e.starts_at at time zone v_tz)::date = (g.starts_at at time zone v_tz)::date)
           group by g.venue_id, v.name, (g.starts_at at time zone v_tz)::date
        ) x), '[]'::jsonb),
    'duties', coalesce((
      select jsonb_agg(jsonb_build_object(
               'event_id', e.id, 'team_id', e.team_id, 'team', t.name, 'opponent', e.opponent, 'starts_at', e.starts_at,
               'titles', (select count(*) from public.team_duties d where d.team_id = e.team_id),
               'assigned', (select count(*) from public.event_duties d where d.event_id = e.id),
               'swaps', (select count(*) from public.event_duties d where d.event_id = e.id and d.requested_swap_at is not null))
             order by e.starts_at)
        from public.events e
        join public.teams t on t.id = e.team_id
       where e.academy_id = p_academy and e.type in ('match', 'tournament') and e.cancelled_at is null and e.private_to is null
         and e.starts_at >= now() and e.starts_at < now() + interval '14 days'
         and exists (select 1 from public.team_duties d where d.team_id = e.team_id)
         and ((select count(*) from public.event_duties d where d.event_id = e.id) < (select count(*) from public.team_duties d where d.team_id = e.team_id)
              or exists (select 1 from public.event_duties d where d.event_id = e.id and d.requested_swap_at is not null))), '[]'::jsonb),
    'squads_without_duties', coalesce((
      select jsonb_agg(jsonb_build_object('team_id', t.id, 'team', t.name) order by t.age_group, t.name)
        from public.teams t
       where t.academy_id = p_academy and t.status = 'active'
         and not exists (select 1 from public.team_duties d where d.team_id = t.id)
         and exists (select 1 from public.events e where e.team_id = t.id and e.type in ('match', 'tournament') and e.starts_at > now())), '[]'::jsonb));
end;
$fn$;
revoke execute on function public.volunteer_gaps(uuid) from public, anon;
grant execute on function public.volunteer_gaps(uuid) to authenticated;
