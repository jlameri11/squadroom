-- 0056_screenshot_scans.sql
--
-- Dribl owns the draw and has no API, so getting a fixture out of it is
-- currently retyping. A parent already has it on screen; let them photograph
-- it and have the app read it.
--
-- Three things this had to settle before any of it was worth building.
--
-- 1. AN EVENT NOBODY ELSE SEES. A parent scanning their own draw must not
--    create something the whole team is notified about. `events.private_to`
--    is that: when set, the event exists for exactly one person. It is a
--    fourth visibility rule on a table that already had three, so it is
--    applied in every place that reads events - the policy, can_read_event,
--    my_upcoming_events and the calendar feed. Miss one and a family's
--    private schedule leaks into someone else's list.
--
-- 2. THE IMAGE LEAVES OUR INFRASTRUCTURE. Reading a screenshot means sending
--    it to a model provider. A fixture list is low-risk - team names, times,
--    grounds - but somebody will eventually drop in a team sheet with
--    children's full names on it. So: the bucket is private, the path is
--    scoped to one person, the image is purged after seven days, and the
--    upload screen says plainly what happens to it. Consent that is buried
--    is not consent.
--
-- 3. THE MODEL IS NOT TRUSTED WITH THE CALENDAR MATHS. It returns a local
--    date and a local clock time as it appears on screen, and nothing else.
--    The academy's own timezone turns that into an instant, here, in
--    Postgres. A model asked for a UTC timestamp will confidently produce one
--    that is off by the daylight-saving offset, and a fixture an hour wrong
--    is worse than no fixture: the family drives to an empty ground.

-- ---------------------------------------------------------------------------
-- 1. Events that belong to one person
-- ---------------------------------------------------------------------------

alter table public.events
  add column private_to uuid references public.profiles(id) on delete cascade,
  add column source text not null default 'manual'
    check (source in ('manual','screenshot','import','fixture')),
  add column source_scan_id uuid,
  add column confirmed_at timestamptz,
  add column confirmed_by uuid references public.profiles(id) on delete set null;

comment on column public.events.private_to is
  'When set, this event is visible to exactly this profile. Used for events a
   parent scanned from their own screenshot. Every reader of events must
   honour it.';

comment on column public.events.confirmed_at is
  'A human has looked at a machine-read event and agreed with it. Null on a
   fresh scan; the interface says so rather than pretending it is verified.';

-- A private event is one person's own business, so it has no team.
alter table public.events
  add constraint events_private_has_no_team
    check (private_to is null or team_id is null);

create index events_private_to_idx on public.events (private_to, starts_at)
  where private_to is not null;

-- ---------------------------------------------------------------------------
-- 2. The scan itself
-- ---------------------------------------------------------------------------

create table public.event_scans (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  -- Null once the image has been purged. The row outlives the picture.
  storage_path text,
  status      text not null default 'pending'
    check (status in ('pending','done','failed')),
  -- Whether the person asked for these to become team events. Requested, not
  -- granted: create_scanned_events checks they are actually a coach.
  team_id     uuid,
  share       boolean not null default false,
  model       text,
  -- What the model returned, verbatim, before we touched it. When a parent
  -- says "it got the time wrong", this is the only way to know whether the
  -- model misread or our own date handling did.
  raw         jsonb,
  error       text,
  found       integer not null default 0,
  created_at  timestamptz not null default now(),
  processed_at timestamptz,
  purge_after timestamptz not null default now() + interval '7 days',

  constraint event_scans_id_academy_key unique (id, academy_id),
  constraint event_scans_team_fkey foreign key (team_id, academy_id)
    references public.teams (id, academy_id) on delete set null (team_id)
);
alter table public.event_scans enable row level security;

alter table public.events
  add constraint events_scan_fkey foreign key (source_scan_id, academy_id)
    references public.event_scans (id, academy_id) on delete set null (source_scan_id);

-- Your own scans, nobody else's - not even a coach's. A screenshot is a
-- picture off someone's phone, and the events it produced are the shared
-- artefact, not the picture.
create policy event_scans_own on public.event_scans for all to authenticated
  using (profile_id = (select auth.uid()))
  with check (
    profile_id = (select auth.uid())
    and (select app_private.is_academy_member(academy_id))
  );

create index event_scans_purge_idx on public.event_scans (purge_after)
  where storage_path is not null;

-- ---------------------------------------------------------------------------
-- 3. The bucket
--
-- Path is {academy_id}/{profile_id}/{file}, and the policies read both out of
-- it. Same shape as attachments in 0034.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'scans', 'scans', false,
  10485760,
  array['image/jpeg','image/png','image/webp','image/heic']
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types,
      public = false;

create policy "scans writable into your own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'scans'
    and app_private.is_academy_member(((storage.foldername(name))[1])::uuid)
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy "scans readable by their owner"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'scans'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy "scans removable by their owner"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'scans'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- 4. Turning what the model read into events
--
-- The model hands over local wall-clock strings exactly as they appear in the
-- screenshot. Everything that could be got subtly wrong happens here instead:
-- the timezone, the missing year, a finish time that crosses midnight.
-- ---------------------------------------------------------------------------

create or replace function public.create_scanned_events(
  p_scan   uuid,
  p_events jsonb
)
returns setof uuid
language plpgsql
volatile
security definer set search_path = public as $$
declare
  v_scan     public.event_scans;
  v_tz       text;
  v_share    boolean;
  v_item     jsonb;
  v_date     date;
  v_start    timestamptz;
  v_end      timestamptz;
  v_arrive   timestamptz;
  v_event    uuid;
  v_count    integer := 0;
begin
  select * into v_scan from public.event_scans where id = p_scan;
  if v_scan is null or v_scan.profile_id <> auth.uid() then
    raise exception 'not your scan' using errcode = '42501';
  end if;

  select timezone into v_tz from public.academies where id = v_scan.academy_id;

  -- Asking to share is not the same as being allowed to. A parent's scan
  -- becomes their own event no matter what the client sent.
  v_share := v_scan.share
    and v_scan.team_id is not null
    and (app_private.is_academy_staff(v_scan.academy_id)
         or app_private.is_team_coach(v_scan.team_id));

  for v_item in select * from jsonb_array_elements(p_events)
  loop
    continue when coalesce(v_item->>'local_date', '') = ''
              or coalesce(v_item->>'local_time', '') = '';

    v_date := (v_item->>'local_date')::date;

    -- A screenshot often shows "Sat 5 Sep" with no year. The client sends the
    -- current year in that case, which is wrong every December. Slide it
    -- forward if that puts the game more than four months in the past.
    if v_date < current_date - interval '120 days' then
      v_date := v_date + interval '1 year';
    end if;

    v_start := (v_date + (v_item->>'local_time')::time) at time zone v_tz;

    if coalesce(v_item->>'end_time', '') <> '' then
      v_end := (v_date + (v_item->>'end_time')::time) at time zone v_tz;
      -- A 7:30pm start finishing at 12:15am is the next day, not minus 19
      -- hours. The check constraint would reject it and the whole scan would
      -- fail over one late kick-off.
      if v_end < v_start then v_end := v_end + interval '1 day'; end if;
    else
      v_end := v_start + interval '90 minutes';
    end if;

    if coalesce(v_item->>'arrive_time', '') <> '' then
      v_arrive := (v_date + (v_item->>'arrive_time')::time) at time zone v_tz;
      if v_arrive > v_start then v_arrive := null; end if;
    else
      v_arrive := null;
    end if;

    insert into public.events (
      academy_id, team_id, private_to, type, title,
      starts_at, ends_at, arrive_at,
      venue, address, opponent, round, kit_colour,
      source, source_scan_id, created_by
    ) values (
      v_scan.academy_id,
      case when v_share then v_scan.team_id end,
      case when v_share then null else auth.uid() end,
      coalesce(nullif(v_item->>'type',''), 'match')::public.event_type,
      coalesce(nullif(btrim(v_item->>'title'), ''), 'Match'),
      v_start, v_end, v_arrive,
      nullif(btrim(coalesce(v_item->>'venue','')), ''),
      nullif(btrim(coalesce(v_item->>'address','')), ''),
      nullif(btrim(coalesce(v_item->>'opponent','')), ''),
      nullif(btrim(coalesce(v_item->>'round','')), ''),
      nullif(btrim(coalesce(v_item->>'kit_colour','')), ''),
      'screenshot', p_scan, auth.uid()
    )
    returning id into v_event;

    -- A private event has no register, so nothing would ever remind them
    -- about it. Their own "going" is what puts it into the reminder sweep.
    if not v_share then
      insert into public.event_rsvps (academy_id, event_id, profile_id, status)
      values (v_scan.academy_id, v_event, auth.uid(), 'yes')
      on conflict do nothing;
    end if;

    v_count := v_count + 1;
    return next v_event;
  end loop;

  update public.event_scans
     set status = 'done', processed_at = now(), found = v_count
   where id = p_scan;
end;
$$;

revoke execute on function public.create_scanned_events(uuid, jsonb) from public, anon;
grant execute on function public.create_scanned_events(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Honouring private_to everywhere events are read
--
-- Four readers. This is the whole cost of the column, paid in one place so it
-- can be checked in one place.
-- ---------------------------------------------------------------------------

drop policy events_select on public.events;
create policy events_select on public.events for select to authenticated
  using (
    (select app_private.is_academy_member(academy_id))
    and (private_to is null or private_to = (select auth.uid()))
    and (
      team_id is null
      or (select app_private.is_team_member(team_id))
      or (select app_private.is_academy_coach(academy_id))
    )
  );

-- Writing your own private event needs no coaching role - it is yours. A
-- coach's authority stops at the events the team can see.
drop policy events_write on public.events;
create policy events_write on public.events for all to authenticated
  using (
    (private_to is not null and private_to = (select auth.uid()))
    or ((select app_private.is_academy_staff(academy_id))
        or (team_id is not null and (select app_private.is_team_coach(team_id))))
  )
  with check (
    (private_to is not null and private_to = (select auth.uid())
     and (select app_private.is_academy_member(academy_id)))
    or ((select app_private.is_academy_staff(academy_id))
        or (team_id is not null and (select app_private.is_team_coach(team_id))))
  );

create or replace function app_private.can_read_event(p_event uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.events e
     where e.id = p_event
       and app_private.is_academy_member(e.academy_id)
       and (e.private_to is null or e.private_to = auth.uid())
       and (e.team_id is null
            or app_private.is_team_member(e.team_id)
            or app_private.is_academy_coach(e.academy_id))
  );
$$;

-- my_upcoming_events gains two columns as well as the filter, so the home
-- screen can mark a machine-read event as unconfirmed rather than letting it
-- sit there looking as solid as one a coach typed.
drop function if exists public.my_upcoming_events(uuid, integer);
create function public.my_upcoming_events(
  p_academy uuid,
  p_days    integer default 30
)
returns table (
  id            uuid,
  type          public.event_type,
  title         text,
  starts_at     timestamptz,
  ends_at       timestamptz,
  arrive_at     timestamptz,
  venue         text,
  address       text,
  opponent      text,
  kit_colour    text,
  round         text,
  team_id       uuid,
  team_name     text,
  competition   text,
  cancelled_at  timestamptz,
  my_replies    integer,
  my_children   integer,
  going         integer,
  no_reply      integer,
  private_to    uuid,
  source        text,
  confirmed_at  timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    e.id, e.type, e.title, e.starts_at, e.ends_at, e.arrive_at,
    e.venue, e.address, e.opponent, e.kit_colour, e.round,
    e.team_id, t.name, c.name, e.cancelled_at,
    (select count(*)::integer
       from public.players pl
       join public.player_guardians pg on pg.player_id = pl.id and pg.profile_id = auth.uid()
       join public.event_rsvps er on er.event_id = e.id and er.player_id = pl.id
      where pl.academy_id = e.academy_id and (e.team_id is null or pl.team_id = e.team_id)),
    (select count(*)::integer
       from public.players pl
       join public.player_guardians pg on pg.player_id = pl.id and pg.profile_id = auth.uid()
      where pl.academy_id = e.academy_id and (e.team_id is null or pl.team_id = e.team_id)),
    case when app_private.is_event_coach(e.id) then s.going end,
    case when app_private.is_event_coach(e.id) then s.no_reply end,
    e.private_to, e.source, e.confirmed_at
  from public.events e
  left join public.teams t on t.id = e.team_id
  left join public.competitions c on c.id = e.competition_id
  left join lateral public.event_rsvp_summary(e.id) s on true
  where e.academy_id = p_academy
    and e.starts_at >= now() - interval '3 hours'
    and e.starts_at <  now() + (p_days || ' days')::interval
    and (e.private_to is null or e.private_to = auth.uid())
    and (e.team_id is null
         or app_private.is_team_member(e.team_id)
         or app_private.is_academy_coach(e.academy_id))
    and app_private.is_academy_member(p_academy)
  order by e.starts_at;
$$;

revoke execute on function public.my_upcoming_events(uuid, integer) from public, anon;
grant execute on function public.my_upcoming_events(uuid, integer) to authenticated;

-- The subscribed calendar runs as the service role with no auth.uid(), so it
-- carries the profile explicitly. Without this clause one parent's private
-- fixtures would appear in every other parent's phone at the same academy.
create or replace function public.calendar_feed_events(p_token text)
returns table (
  event_id   uuid,
  title      text,
  starts_at  timestamptz,
  ends_at    timestamptz,
  arrive_at  timestamptz,
  venue      text,
  address    text,
  opponent   text,
  kit_colour text,
  cancelled_at timestamptz,
  updated_at timestamptz,
  timezone   text
)
language plpgsql
volatile
security definer set search_path = public as $$
declare
  v_profile uuid;
begin
  select profile_id into v_profile from public.calendar_feeds where token = p_token;
  if v_profile is null then
    return;
  end if;

  update public.calendar_feeds
     set last_read_at = now(), read_count = read_count + 1
   where token = p_token;

  return query
    select distinct on (e.id)
      e.id, e.title, e.starts_at, e.ends_at, e.arrive_at,
      e.venue, e.address, e.opponent, e.kit_colour, e.cancelled_at, e.updated_at,
      a.timezone
    from public.events e
    join public.academies a on a.id = e.academy_id
    join public.academy_members am
      on am.academy_id = e.academy_id and am.profile_id = v_profile and am.status = 'active'
    left join public.team_members tm
      on tm.team_id = e.team_id and tm.profile_id = v_profile
   where e.starts_at > now() - interval '30 days'
     and (e.private_to is null or e.private_to = v_profile)
     and (e.team_id is null or tm.profile_id is not null)
   order by e.id, e.starts_at;
end;
$$;

revoke execute on function public.calendar_feed_events(text) from public, anon, authenticated;
grant execute on function public.calendar_feed_events(text) to service_role;

-- ---------------------------------------------------------------------------
-- 6. The picture does not live forever
--
-- Only the storage row is emptied here; the file is removed by the scheduled
-- function, because deleting a row in storage.objects leaves the object
-- behind in the bucket. So this marks, and netlify/functions/purge-scans.mts
-- does the deleting.
-- ---------------------------------------------------------------------------

create or replace function public.scans_due_for_purge()
returns table (id uuid, storage_path text)
language sql stable security definer set search_path = public as $$
  select s.id, s.storage_path
    from public.event_scans s
   where s.storage_path is not null
     and s.purge_after < now()
   limit 200;
$$;

create or replace function public.mark_scan_purged(p_scan uuid)
returns void
language sql volatile security definer set search_path = public as $$
  update public.event_scans set storage_path = null where id = p_scan;
$$;

revoke execute on function public.scans_due_for_purge() from public, anon, authenticated;
revoke execute on function public.mark_scan_purged(uuid) from public, anon, authenticated;
grant execute on function public.scans_due_for_purge() to service_role;
grant execute on function public.mark_scan_purged(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 7. A write policy must not be a read policy
--
-- events_write above was FOR ALL, which includes SELECT, and permissive
-- policies are OR-ed together. So its USING clause - "staff may touch any
-- event in their academy" - was also a read grant, and it beat the
-- private_to filter in events_select. The isolation test caught a coach
-- reading every private event in the academy.
--
-- The hole was always there; until private_to existed a coach was supposed
-- to see every event anyway, so nothing could reveal it. Split by command so
-- the read rule is stated exactly once, in events_select.
-- ---------------------------------------------------------------------------

drop policy events_write on public.events;

create policy events_insert on public.events for insert to authenticated
  with check (
    (private_to is not null and private_to = (select auth.uid())
     and team_id is null
     and (select app_private.is_academy_member(academy_id)))
    or (select app_private.is_academy_staff(academy_id))
    or (team_id is not null and (select app_private.is_team_coach(team_id)))
  );

create policy events_update on public.events for update to authenticated
  using (
    (private_to is not null and private_to = (select auth.uid()))
    or (select app_private.is_academy_staff(academy_id))
    or (team_id is not null and (select app_private.is_team_coach(team_id)))
  )
  with check (
    (private_to is not null and private_to = (select auth.uid())
     and team_id is null)
    or (select app_private.is_academy_staff(academy_id))
    or (team_id is not null and (select app_private.is_team_coach(team_id)))
  );

create policy events_delete on public.events for delete to authenticated
  using (
    (private_to is not null and private_to = (select auth.uid()))
    or (select app_private.is_academy_staff(academy_id))
    or (team_id is not null and (select app_private.is_team_coach(team_id)))
  );
