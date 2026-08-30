-- 0010_settings_notifications.sql
-- Per-person display and notification preferences, push subscriptions, and
-- the queue that fans out messages and event reminders.

-- ---------------------------------------------------------------------------
-- user_settings — keyed to the person, not the academy. A coach working at
-- two academies carries one set of preferences across both.
-- ---------------------------------------------------------------------------
create table public.user_settings (
  profile_id      uuid primary key references public.profiles(id) on delete cascade,

  -- Display
  text_scale      text not null default 'md' check (text_scale in ('sm','md','lg','xl')),
  theme           text not null default 'system' check (theme in ('system','light','dark')),
  compact_lists   boolean not null default false,
  home_order      text not null default 'events' check (home_order in ('events','chats')),

  -- Notifications
  notify_messages      boolean not null default true,
  notify_announcements boolean not null default true,
  notify_reminder_24h  boolean not null default true,
  notify_reminder_2h   boolean not null default true,
  notify_rsvp_changes  boolean not null default true,
  quiet_hours_enabled  boolean not null default true,
  quiet_hours_start    time not null default '21:00',
  quiet_hours_end      time not null default '07:00',

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.user_settings enable row level security;

create trigger user_settings_set_updated_at
  before update on public.user_settings
  for each row execute function public.set_updated_at();

-- Give every new profile a settings row so the app never has to handle a
-- missing one.
create or replace function public.on_profile_created()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_settings (profile_id) values (new.id)
  on conflict (profile_id) do nothing;
  return new;
end;
$$;

create trigger profiles_bootstrap_settings
  after insert on public.profiles
  for each row execute function public.on_profile_created();

-- ---------------------------------------------------------------------------
-- push_subscriptions — one row per browser or device. 'platform' is what lets
-- the same table serve web push now and APNs/FCM after the Capacitor wrap.
-- ---------------------------------------------------------------------------
create table public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  platform     text not null default 'web' check (platform in ('web','ios','android')),
  endpoint     text not null unique,
  p256dh       text,
  auth         text,
  device_label text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  failed_at    timestamptz,
  failure_count integer not null default 0
);
alter table public.push_subscriptions enable row level security;

-- ---------------------------------------------------------------------------
-- notification_queue — fan-out is queued, never inline in the request. A busy
-- channel must not make sending a message slow.
-- ---------------------------------------------------------------------------
create table public.notification_queue (
  id            uuid primary key default gen_random_uuid(),
  academy_id    uuid not null references public.academies(id) on delete cascade,
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  kind          text not null check (kind in
                  ('message','announcement','event_reminder','poll_opened','poll_closing','rsvp_change','invite')),
  title         text not null,
  body          text,
  url           text,
  payload       jsonb not null default '{}'::jsonb,
  scheduled_for timestamptz not null default now(),
  sent_at       timestamptz,
  attempts      integer not null default 0,
  last_error    text,
  -- Stops a retry or a double-write sending the same nudge twice.
  dedupe_key    text unique,
  created_at    timestamptz not null default now()
);
alter table public.notification_queue enable row level security;

create index notification_queue_due_idx
  on public.notification_queue (scheduled_for)
  where sent_at is null;

-- pg_cron drains the queue and schedules the 24h/2h reminders. Enabling it is
-- a dashboard/CLI step on hosted Supabase; this is a no-op if it is already on.
do $$
begin
  create extension if not exists pg_cron;
exception when others then
  raise notice 'pg_cron not enabled here — schedule the queue drain externally';
end;
$$;
