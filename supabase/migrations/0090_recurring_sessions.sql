-- 0090: training is weekly, and until now had to be typed forty times.
--
-- `events` has no notion of recurrence, so "Tuesday and Thursday, 5pm, all
-- season" was forty-odd rows created by hand. Every competitor in
-- DRIBL_INTEL's table-stakes list has recurring sessions, and it is the most
-- common event in an academy by a wide margin — a squad plays once a week and
-- trains twice.
--
-- MATERIALISED, NOT EXPANDED AT READ TIME. The tempting design is to store a
-- recurrence rule and expand it when something asks. It would be wrong here,
-- because an occurrence is not just a date: it carries RSVPs per child, a
-- cancellation with a reason, a notification queue, an entry in the ICS feed,
-- a card in a chat thread, and a row in the run sheet. Every one of those
-- readers — the events_select policy, can_read_event, my_upcoming_events,
-- calendar_feed_events, the home screen, the reminder sweep — would have to
-- learn to expand a rule, and the first to forget would silently show a
-- family the wrong Tuesday.
--
-- So a series creates real `events` rows, each tagged with `series_id`.
-- Everything built in the last eighty-nine migrations keeps working untouched:
-- RSVPs, reminders, the cancellation push, the calendar subscription, the
-- private_to rule, all of it.
--
-- TIMEZONE. The occurrence times are built from a DATE and a local TIME in
-- the academy's own zone, never from a UTC timestamp. CLAUDE.md records why:
-- a local midnight in Sydney becomes the previous day in UTC, which moves
-- every Saturday game to Friday. It also means a season that crosses the
-- daylight-saving boundary keeps training at 5pm rather than drifting to 4pm
-- in April.

create table if not exists public.event_series (
  id         uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id) on delete cascade,
  team_id    uuid,
  type       public.event_type not null default 'training',
  title      text not null check (btrim(title) <> ''),

  -- Days of the week this runs on, 0 = Sunday through 6 = Saturday. An array
  -- because a squad trains twice a week and "Tuesday and Thursday" is one
  -- decision a coach makes once, not two series to keep in step.
  days       smallint[] not null check (
    array_length(days, 1) between 1 and 7
    and days <@ array[0,1,2,3,4,5,6]::smallint[]
  ),
  at_time    time not null,
  duration_mins integer not null default 60 check (duration_mins between 5 and 600),
  -- Minutes before the start. Stored as an offset rather than a time, so
  -- moving the session moves the arrive-by with it.
  arrive_mins   integer check (arrive_mins between 0 and 240),

  venue      text,
  address    text,
  kit_colour text,
  notes      text,

  starts_on  date not null,
  ends_on    date not null,
  constraint event_series_dates_ordered check (starts_on <= ends_on),

  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint event_series_id_academy_key unique (id, academy_id),
  constraint event_series_team_fkey foreign key (team_id, academy_id)
    references public.teams (id, academy_id) on delete cascade
);

alter table public.events
  add column if not exists series_id uuid;

-- Plain, not composite: events already carries academy_id and the series is
-- in the same academy by construction. A composite FK here would need
-- event_series(id, academy_id) which exists, so use it — same-tenant asserted
-- rather than assumed, like every other child table in this schema.
do $$ begin
  alter table public.events
    add constraint events_series_fkey foreign key (series_id, academy_id)
      references public.event_series (id, academy_id) on delete set null;
exception when duplicate_object then null; end $$;

create index if not exists events_series_idx on public.events (series_id, starts_at);

alter table public.event_series enable row level security;

create policy event_series_select on public.event_series
  for select to authenticated
  using ((select app_private.is_academy_member(academy_id)));

create policy event_series_insert on public.event_series
  for insert to authenticated
  with check ((select app_private.is_academy_coach(academy_id)));

create policy event_series_update on public.event_series
  for update to authenticated
  using ((select app_private.is_academy_coach(academy_id)))
  with check ((select app_private.is_academy_coach(academy_id)));

create policy event_series_delete on public.event_series
  for delete to authenticated
  using ((select app_private.is_academy_coach(academy_id)));

create trigger event_series_set_updated_at
  before update on public.event_series
  for each row execute function public.set_updated_at();

/**
 * Create a series and every session in it.
 *
 * Returns how many sessions were made, so the screen can say "32 sessions
 * created" rather than claiming success and leaving the coach to count.
 *
 * Refuses a span that would produce more than 200 sessions. Not an arbitrary
 * limit: it is roughly two years of twice-weekly training, and the only way
 * to exceed it is a typo in the end date — which would otherwise fill a
 * family's calendar subscription with a decade of Tuesdays.
 */
create or replace function public.create_event_series(
  p_academy    uuid,
  p_title      text,
  p_days       smallint[],
  p_time       time,
  p_from       date,
  p_until      date,
  p_team       uuid default null,
  p_type       public.event_type default 'training',
  p_duration   integer default 60,
  p_arrive     integer default null,
  p_venue      text default null,
  p_address    text default null,
  p_kit_colour text default null,
  p_notes      text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_series   uuid;
  v_zone     text;
  v_day      date;
  v_start    timestamptz;
  v_count    integer := 0;
  v_expected integer;
begin
  if not app_private.is_academy_coach(p_academy) then
    raise exception 'only a coach can schedule sessions' using errcode = '42501';
  end if;

  if p_team is not null and not exists (
    select 1 from public.teams where id = p_team and academy_id = p_academy
  ) then
    raise exception 'that team is not in this academy' using errcode = '42501';
  end if;

  select timezone into v_zone from public.academies where id = p_academy;
  if v_zone is null then
    raise exception 'academy not found' using errcode = '22023';
  end if;

  -- Counted before anything is written, so a typo in the end date is refused
  -- rather than half-applied.
  select count(*) into v_expected
    from generate_series(p_from, p_until, interval '1 day') d
   where extract(dow from d)::smallint = any(p_days);

  if v_expected = 0 then
    raise exception 'no % between % and %',
      case when array_length(p_days, 1) = 1 then 'session falls' else 'sessions fall' end,
      p_from, p_until
      using errcode = '22023';
  end if;
  if v_expected > 200 then
    raise exception 'that would create % sessions — check the end date', v_expected
      using errcode = '22023';
  end if;

  insert into public.event_series (
    academy_id, team_id, type, title, days, at_time, duration_mins,
    arrive_mins, venue, address, kit_colour, notes, starts_on, ends_on, created_by
  ) values (
    p_academy, p_team, p_type, btrim(p_title), p_days, p_time, p_duration,
    p_arrive, p_venue, p_address, p_kit_colour, p_notes, p_from, p_until, auth.uid()
  )
  returning id into v_series;

  for v_day in
    select d::date from generate_series(p_from, p_until, interval '1 day') d
     where extract(dow from d)::smallint = any(p_days)
     order by d
  loop
    -- The academy's own clock. Built from a date and a local time rather than
    -- by adding hours to a UTC instant, so a session stays at 5pm across the
    -- daylight-saving boundary instead of drifting to 4pm in April.
    v_start := (v_day + p_time) at time zone v_zone;

    insert into public.events (
      academy_id, team_id, type, title, starts_at, ends_at, arrive_at,
      venue, address, kit_colour, notes, series_id, created_by, source
    ) values (
      p_academy, p_team, p_type, btrim(p_title),
      v_start,
      v_start + (p_duration || ' minutes')::interval,
      case when p_arrive is null then null
           else v_start - (p_arrive || ' minutes')::interval end,
      p_venue, p_address, p_kit_colour, p_notes, v_series, auth.uid(), 'manual'
    );
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('series_id', v_series, 'created', v_count);
end;
$fn$;

revoke execute on function public.create_event_series(
  uuid, text, smallint[], time, date, date, uuid, public.event_type,
  integer, integer, text, text, text, text
) from public, anon;
grant execute on function public.create_event_series(
  uuid, text, smallint[], time, date, date, uuid, public.event_type,
  integer, integer, text, text, text, text
) to authenticated;

/**
 * Call off, or delete, the rest of a series.
 *
 * "The rest" and not "all of it": a session that has already happened is a
 * record, and a coach ending Thursday training in August must not erase the
 * attendance and RSVPs from June.
 *
 * Cancelling goes through `cancelled_at`, so the existing trigger notifies
 * every affected family exactly as it does for one game — including the
 * inside-24-hours SMS escalation, which is the whole reason that path exists.
 * Deleting is for a series created by mistake and only touches sessions
 * nobody has answered.
 */
create or replace function public.end_event_series(
  p_series uuid,
  p_from   date default null,
  p_reason text default null,
  p_delete boolean default false
)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_academy uuid;
  v_cut     timestamptz;
  v_touched integer := 0;
  v_kept    integer := 0;
begin
  select academy_id into v_academy from public.event_series where id = p_series;
  if v_academy is null then
    raise exception 'no such series' using errcode = '22023';
  end if;
  if not app_private.is_academy_coach(v_academy) then
    raise exception 'only a coach can change the schedule' using errcode = '42501';
  end if;

  -- Default to now, so "end this series" never reaches into the past.
  v_cut := coalesce(
    (p_from::timestamp at time zone (select timezone from public.academies where id = v_academy)),
    now()
  );
  if v_cut < now() then
    v_cut := now();
  end if;

  if p_delete then
    -- Only the untouched ones. A session somebody has already answered is
    -- their answer, and deleting it would take the RSVP with it.
    select count(*) into v_kept
      from public.events e
     where e.series_id = p_series and e.starts_at >= v_cut
       and exists (select 1 from public.event_rsvps r where r.event_id = e.id);

    with gone as (
      delete from public.events e
       where e.series_id = p_series
         and e.starts_at >= v_cut
         and not exists (select 1 from public.event_rsvps r where r.event_id = e.id)
      returning 1
    )
    select count(*) into v_touched from gone;
  else
    with called_off as (
      update public.events e
         set cancelled_at = now(),
             cancellation_reason = coalesce(p_reason, 'Series ended'),
             updated_at = now()
       where e.series_id = p_series
         and e.starts_at >= v_cut
         and e.cancelled_at is null
      returning 1
    )
    select count(*) into v_touched from called_off;
  end if;

  update public.event_series
     set ends_on = least(ends_on, (v_cut at time zone
           (select timezone from public.academies where id = v_academy))::date),
         updated_at = now()
   where id = p_series;

  return jsonb_build_object(
    'affected', v_touched,
    -- Named rather than silently skipped, so the screen can say why a number
    -- is smaller than the coach expected.
    'kept_because_answered', v_kept
  );
end;
$fn$;

revoke execute on function public.end_event_series(uuid, date, text, boolean)
  from public, anon;
grant execute on function public.end_event_series(uuid, date, text, boolean)
  to authenticated;
