-- 0225: helpers wanted.
--
-- G-07, the volunteer and referee roster. Every Saturday a club needs people
-- who are not playing — the canteen, a linesman, someone on the gate, set-up
-- and pack-down — and on a gala day a marshal on every field and a scorer at
-- every table. Clubs run it in a spreadsheet and a WhatsApp plea on Friday
-- night. Now a game or a club day says what it needs: jobs, each with a time
-- on the day and a number of spots. The people who can see the event put
-- their own names down; the coach asks once ("Helpers needed — Canteen
-- 8:00 am, Linesman"); each helper is reminded at 6 pm the evening before.
-- Referees for a competition stay with the league's appointments (0161); a
-- club's own gala day can have "Referee — Field 2" as a job.
--
-- A job's times are the club's wall clock ON THE EVENT'S DAY (time, not
-- timestamptz), so a gala day moved to Sunday keeps canteen at 8:00 and the
-- reminders move with it; a game called off takes them away. A private
-- event (a parent's own scan) has no jobs. The names on the list are the
-- club's own people, seen only by those who can see the event — nothing
-- here is public, and nothing crosses to another club.

create table if not exists public.event_jobs (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  event_id    uuid not null,
  title       text not null check (char_length(btrim(title)) between 1 and 60),
  start_time  time,
  end_time    time,
  spots       integer not null default 1 check (spots between 1 and 30),
  note        text check (note is null or char_length(note) <= 200),
  position    integer not null default 0,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint event_jobs_id_academy_key unique (id, academy_id),
  constraint event_jobs_end_after_start check (start_time is null or end_time is null or end_time > start_time),
  foreign key (event_id, academy_id) references public.events(id, academy_id) on delete cascade
);
create index if not exists event_jobs_event_idx on public.event_jobs (event_id, position);

create table if not exists public.event_job_helpers (
  job_id      uuid not null,
  academy_id  uuid not null,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  added_by    uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (job_id, profile_id),
  foreign key (job_id, academy_id) references public.event_jobs(id, academy_id) on delete cascade
);
create index if not exists event_job_helpers_profile_idx on public.event_job_helpers (profile_id);

-- Read by whoever can see the event; written only through the functions below.
alter table public.event_jobs enable row level security;
drop policy if exists event_jobs_read on public.event_jobs;
create policy event_jobs_read on public.event_jobs for select to authenticated
  using ((select app_private.can_read_event(event_id)));
grant select on public.event_jobs to authenticated;

alter table public.event_job_helpers enable row level security;
drop policy if exists event_job_helpers_read on public.event_job_helpers;
create policy event_job_helpers_read on public.event_job_helpers for select to authenticated
  using (exists (select 1 from public.event_jobs j where j.id = job_id and app_private.can_read_event(j.event_id)));
grant select on public.event_job_helpers to authenticated;

-- ------------------------------------------------------------- notification kinds
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
    'message', 'announcement', 'event_reminder', 'poll_opened', 'poll_closing', 'rsvp_change', 'invite',
    'event_cancelled', 'event_changed', 'event_back_on', 'rsvp_nudge', 'announcement_repeat', 'wwcc_expiring',
    'guardian_erased', 'official_rego_pending', 'reregister_nudge', 'offer', 'referee_appointment',
    'referee_response', 'referee_withdrawn', 'fixture_change_proposed', 'fixture_change_answered',
    'fixture_change_decided', 'mention', 'match_correction_requested', 'match_correction_decided',
    'fixture_flowing_open', 'discipline_warning', 'discipline_suspension', 'forfeit_request', 'forfeit_decided',
    'nomination', 'fee_due', 'fee_overdue', 'player_report', 'player_clip', 'selected', 'not_selected',
    'match_day', 'support_reply', 'match_video', 'match_photos', 'photo_hidden', 'helpers_wanted',
    'helper_reminder', 'helper_changed']));
end $$;

-- ------------------------------------------------------------------ helpers
/** Who sets a game's jobs: its squad's coaches (and the club's staff); a club-wide day's: the club's coaches and staff. */
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
  return coalesce(app_private.is_academy_coach(e.academy_id), false);
end;
$fn$;

/** "8:00 am", "8:00 am–10:00 am", or nothing: a job's time, as the club reads it. */
create or replace function app_private.job_time(p_start time, p_end time)
returns text
language sql immutable as $fn$
  select case
    when p_start is null then null
    when p_end is null then lower(to_char(p_start, 'FMHH12:MI AM'))
    else lower(to_char(p_start, 'FMHH12:MI AM')) || '–' || lower(to_char(p_end, 'FMHH12:MI AM'))
  end;
$fn$;

/**
 * Each helper's reminder, made again from what is true now: one push per
 * person at 6 pm the evening before the event's day, at the club, naming
 * their jobs. None for a cancelled or private event, or once that evening
 * has passed. Called after every change, and when the event moves.
 */
create or replace function app_private.queue_helper_reminders(p_event uuid)
returns void
language plpgsql volatile security definer set search_path = public as $fn$
declare
  e    public.events;
  v_tz text;
  v_at timestamptz;
begin
  delete from public.notification_queue q
   where q.kind = 'helper_reminder' and q.sent_at is null and q.payload->>'event_id' = p_event::text;
  select * into e from public.events where id = p_event;
  if e.id is null or e.cancelled_at is not null or e.private_to is not null then
    return;
  end if;
  select coalesce(a.timezone, 'Australia/Sydney') into v_tz from public.academies a where a.id = e.academy_id;
  v_at := ((((e.starts_at at time zone v_tz)::date - 1) + time '18:00')::timestamp at time zone v_tz);
  if v_at <= now() then
    return;
  end if;
  insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload, scheduled_for)
  select e.academy_id, h.profile_id, 'helper_reminder',
         'Tomorrow you''re helping at ' || e.title,
         string_agg(j.title || coalesce(', ' || app_private.job_time(j.start_time, j.end_time), ''), ' · ' order by j.position, j.start_time),
         '/calendar/' || e.id,
         jsonb_build_object('event_id', e.id),
         v_at
    from public.event_job_helpers h
    join public.event_jobs j on j.id = h.job_id
   where j.event_id = p_event
   group by h.profile_id;
end;
$fn$;

-- ----------------------------------------------------------------- reading
create or replace function public.event_helpers(p_event uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  e    public.events;
  v_tz text;
begin
  select * into e from public.events where id = p_event;
  if e.id is null or not coalesce(app_private.can_read_event(p_event), false) then
    raise exception 'that event is not one of yours' using errcode = '42501';
  end if;
  select coalesce(a.timezone, 'Australia/Sydney') into v_tz from public.academies a where a.id = e.academy_id;
  return jsonb_build_object(
    'can_manage', app_private.may_manage_helpers(p_event),
    -- Until the end of the event's day, unless it is called off.
    'can_help', e.private_to is null and e.cancelled_at is null
                and (e.starts_at at time zone v_tz)::date >= (now() at time zone v_tz)::date,
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
       where j.event_id = p_event), '[]'::jsonb));
end;
$fn$;

-- ----------------------------------------------------------------- setting
/**
 * The coach's list of jobs for an event, whole: [{id?, title, start_time,
 * end_time, spots, note}]. A job left out is removed and its helpers told;
 * a job cannot have fewer spots than people already down for it.
 */
create or replace function public.set_event_jobs(p_event uuid, p_jobs jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = public as $fn$
declare
  e      public.events;
  v_item jsonb;
  v_id   uuid;
  v_keep uuid[] := '{}';
  v_pos  integer := 0;
  v_have integer;
  v_spots integer;
  r      record;
begin
  select * into e from public.events where id = p_event;
  if e.id is null or not app_private.may_manage_helpers(p_event) then
    raise exception 'only the squad''s coach sets the jobs for this' using errcode = '42501';
  end if;
  if e.cancelled_at is not null then
    raise exception 'this has been called off' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_jobs, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_jobs, '[]'::jsonb)) > 30 then
    raise exception 'a list of up to thirty jobs' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_jobs, '[]'::jsonb)) loop
    v_id := nullif(v_item ->> 'id', '')::uuid;
    v_spots := coalesce(nullif(v_item ->> 'spots', '')::integer, 1);
    if v_id is not null and exists (select 1 from public.event_jobs j where j.id = v_id and j.event_id = p_event) then
      select count(*) into v_have from public.event_job_helpers h where h.job_id = v_id;
      if v_spots < v_have then
        raise exception '% has % people down for it — take someone off before making it %', btrim(v_item ->> 'title'), v_have, v_spots
          using errcode = '22023';
      end if;
      update public.event_jobs
         set title = btrim(v_item ->> 'title'),
             start_time = nullif(v_item ->> 'start_time', '')::time,
             end_time = nullif(v_item ->> 'end_time', '')::time,
             spots = v_spots,
             note = nullif(btrim(coalesce(v_item ->> 'note', '')), ''),
             position = v_pos
       where id = v_id;
    else
      insert into public.event_jobs (academy_id, event_id, title, start_time, end_time, spots, note, position, created_by)
      values (e.academy_id, p_event, btrim(v_item ->> 'title'),
              nullif(v_item ->> 'start_time', '')::time, nullif(v_item ->> 'end_time', '')::time,
              v_spots, nullif(btrim(coalesce(v_item ->> 'note', '')), ''), v_pos, auth.uid())
      returning id into v_id;
    end if;
    v_keep := v_keep || v_id;
    v_pos := v_pos + 1;
  end loop;

  -- The jobs taken off the list: their helpers are told, then they go.
  for r in
    select j.id, j.title, h.profile_id
      from public.event_jobs j
      join public.event_job_helpers h on h.job_id = j.id
     where j.event_id = p_event and not (j.id = any (v_keep)) and h.profile_id <> auth.uid()
  loop
    insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload)
    values (e.academy_id, r.profile_id, 'helper_changed', e.title || ' — ' || r.title || ' is not needed now',
            'The coach took it off the list. Thank you for putting your name down.',
            '/calendar/' || e.id, jsonb_build_object('event_id', e.id));
  end loop;
  delete from public.event_jobs j where j.event_id = p_event and not (j.id = any (v_keep));

  perform app_private.queue_helper_reminders(p_event);
  return public.event_helpers(p_event);
end;
$fn$;

-- ----------------------------------------------------------- putting names down
create or replace function public.help_with(p_job uuid)
returns jsonb
language plpgsql volatile security definer set search_path = public as $fn$
declare
  j      public.event_jobs;
  e      public.events;
  v_tz   text;
  v_have integer;
begin
  -- The job's row lock: two people answering for the last spot count one
  -- after the other.
  select * into j from public.event_jobs where id = p_job for update;
  if j.id is null or not coalesce(app_private.can_read_event(j.event_id), false) then
    raise exception 'that job is not one of yours' using errcode = '42501';
  end if;
  select * into e from public.events where id = j.event_id;
  select coalesce(a.timezone, 'Australia/Sydney') into v_tz from public.academies a where a.id = e.academy_id;
  if e.cancelled_at is not null or e.private_to is not null
     or (e.starts_at at time zone v_tz)::date < (now() at time zone v_tz)::date then
    raise exception 'that day has gone, or it was called off' using errcode = '22023';
  end if;
  if exists (select 1 from public.event_job_helpers h where h.job_id = p_job and h.profile_id = auth.uid()) then
    return public.event_helpers(j.event_id);
  end if;
  select count(*) into v_have from public.event_job_helpers h where h.job_id = p_job;
  if v_have >= j.spots then
    raise exception '% is full — thank you all the same', j.title using errcode = '22023';
  end if;
  insert into public.event_job_helpers (job_id, academy_id, profile_id, added_by)
  values (p_job, j.academy_id, auth.uid(), auth.uid());
  perform app_private.queue_helper_reminders(j.event_id);
  return public.event_helpers(j.event_id);
end;
$fn$;

/**
 * Off a job: yourself (p_profile null), or someone else if you run the
 * event's jobs, who is then told. A helper dropping out in the last two
 * days tells the people who run them, so the gap is seen before Saturday.
 */
create or replace function public.stop_helping(p_job uuid, p_profile uuid default null)
returns jsonb
language plpgsql volatile security definer set search_path = public as $fn$
declare
  j      public.event_jobs;
  e      public.events;
  v_who  uuid := coalesce(p_profile, auth.uid());
  v_name text;
begin
  select * into j from public.event_jobs where id = p_job;
  if j.id is null or not coalesce(app_private.can_read_event(j.event_id), false) then
    raise exception 'that job is not one of yours' using errcode = '42501';
  end if;
  select * into e from public.events where id = j.event_id;
  if v_who <> auth.uid() and not app_private.may_manage_helpers(j.event_id) then
    raise exception 'only the coach takes someone else off a job' using errcode = '42501';
  end if;
  delete from public.event_job_helpers h where h.job_id = p_job and h.profile_id = v_who;
  if found then
    if v_who <> auth.uid() then
      insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload)
      values (e.academy_id, v_who, 'helper_changed', e.title || ' — you''re off ' || j.title,
              'The coach changed the list. Thank you for putting your name down.',
              '/calendar/' || e.id, jsonb_build_object('event_id', e.id));
    elsif e.starts_at < now() + interval '48 hours' and e.starts_at > now() - interval '12 hours' then
      select pr.full_name into v_name from public.profiles pr where pr.id = v_who;
      insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload)
      select e.academy_id, c.profile_id, 'helper_changed',
             coalesce(split_part(v_name, ' ', 1), 'Someone') || ' can''t do ' || j.title || ' now',
             e.title || ' — a spot is open again.',
             '/calendar/' || e.id, jsonb_build_object('event_id', e.id)
        from (
          select m.profile_id from public.team_members m where m.team_id = e.team_id and m.role = 'coach'
          union
          select am.profile_id from public.academy_members am
           where e.team_id is null and am.academy_id = e.academy_id and am.status = 'active' and am.role in ('owner', 'admin')
        ) c
       where c.profile_id <> v_who;
    end if;
  end if;
  perform app_private.queue_helper_reminders(j.event_id);
  return public.event_helpers(j.event_id);
end;
$fn$;

-- --------------------------------------------------------------- asking
/**
 * One push to the people who can see the event — a squad's, or for a club
 * day the club's members — naming the jobs with spots left. Once in twelve
 * hours, so Friday night is one message and not five.
 */
create or replace function public.ask_for_helpers(p_event uuid)
returns integer
language plpgsql volatile security definer set search_path = public as $fn$
declare
  e      public.events;
  v_open text;
  v_n    integer;
begin
  select * into e from public.events where id = p_event;
  if e.id is null or not app_private.may_manage_helpers(p_event) then
    raise exception 'only the squad''s coach asks for helpers' using errcode = '42501';
  end if;
  if e.cancelled_at is not null then
    raise exception 'this has been called off' using errcode = '22023';
  end if;
  if exists (select 1 from public.notification_queue q
              where q.kind = 'helpers_wanted' and q.payload->>'event_id' = p_event::text
                and q.created_at > now() - interval '12 hours') then
    raise exception 'asked already in the last twelve hours' using errcode = '22023';
  end if;
  select string_agg(j.title || coalesce(' ' || app_private.job_time(j.start_time, j.end_time), ''), ', ' order by j.position, j.start_time)
    into v_open
    from public.event_jobs j
   where j.event_id = p_event
     and (select count(*) from public.event_job_helpers h where h.job_id = j.id) < j.spots;
  if v_open is null then
    raise exception 'every job has its people' using errcode = '22023';
  end if;

  insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload)
  select e.academy_id, a.profile_id, 'helpers_wanted', e.title || ' — helpers needed', v_open,
         '/calendar/' || p_event, jsonb_build_object('event_id', p_event)
    from (
      select distinct m.profile_id from public.team_members m
       where e.team_id is not null and m.team_id = e.team_id and m.role <> 'player'
      union
      select am.profile_id from public.academy_members am
       where e.team_id is null and am.academy_id = e.academy_id and am.status = 'active' and am.role <> 'player'
    ) a
   where a.profile_id <> auth.uid();
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

-- ------------------------------------------------- the event moves, or goes
create or replace function public.events_requeue_helper_reminders()
returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if (new.starts_at is distinct from old.starts_at or new.cancelled_at is distinct from old.cancelled_at)
     and exists (select 1 from public.event_jobs j where j.event_id = new.id) then
    perform app_private.queue_helper_reminders(new.id);
  end if;
  return null;
end;
$fn$;
drop trigger if exists events_helper_reminders on public.events;
create trigger events_helper_reminders
  after update of starts_at, cancelled_at on public.events
  for each row execute function public.events_requeue_helper_reminders();

revoke execute on function public.event_helpers(uuid) from public, anon;
revoke execute on function public.set_event_jobs(uuid, jsonb) from public, anon;
revoke execute on function public.help_with(uuid) from public, anon;
revoke execute on function public.stop_helping(uuid, uuid) from public, anon;
revoke execute on function public.ask_for_helpers(uuid) from public, anon;
grant execute on function public.event_helpers(uuid) to authenticated;
grant execute on function public.set_event_jobs(uuid, jsonb) to authenticated;
grant execute on function public.help_with(uuid) to authenticated;
grant execute on function public.stop_helping(uuid, uuid) to authenticated;
grant execute on function public.ask_for_helpers(uuid) to authenticated;
