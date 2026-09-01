-- 0057_wake_push_sender.sql
--
-- The push sender ran on a schedule every minute: 43,200 Netlify invocations
-- a month, almost all of them finding an empty queue. That was the single
-- largest consumer of the free allowance while the product had no users on
-- it at all, and it still made a parent wait up to a minute for a message.
--
-- So the queue now says when it has something. A statement-level trigger
-- calls the Netlify endpoint over pg_net; the schedule drops to every five
-- minutes and becomes a safety net rather than the delivery mechanism.
-- Faster and roughly five times cheaper, which is rare enough to take.
--
-- This does NOT reopen the decision in CLAUDE.md against database webhooks.
-- The sending still happens in a Netlify function holding the service-role
-- key. All the database gained is the ability to say "now" instead of the
-- function asking "yet?" sixty times an hour.
--
-- Three things it must not do:
--   * wake for a reminder scheduled for tomorrow night
--   * wake once per row when a hundred parents are notified at once
--   * hold the inserting transaction open on an HTTP call - pg_net is
--     asynchronous precisely so posting a message never waits on Netlify

create extension if not exists pg_net with schema extensions;

create table if not exists app_private.config (
  key   text primary key,
  value text not null
);
revoke all on app_private.config from public, anon, authenticated;

create table if not exists app_private.push_wake (
  id           boolean primary key default true check (id),
  last_wake_at timestamptz not null default 'epoch'
);
insert into app_private.push_wake (id) values (true) on conflict do nothing;
revoke all on app_private.push_wake from public, anon, authenticated;

create or replace function app_private.wake_push_sender()
returns trigger
language plpgsql
security definer
set search_path = public as $fn$
declare
  v_url    text;
  v_secret text;
  v_woke   timestamptz;
begin
  if not exists (
    select 1 from inserted
     where sent_at is null and scheduled_for <= now() + interval '30 seconds'
  ) then
    return null;
  end if;

  select value into v_url    from app_private.config where key = 'push_wake_url';
  select value into v_secret from app_private.config where key = 'push_wake_secret';
  if v_url is null or v_secret is null then
    return null;   -- not configured; the five-minute sweep still covers it
  end if;

  -- One wake every fifteen seconds at most. An announcement to a large
  -- academy inserts hundreds of rows across several statements, and each one
  -- calling Netlify would be the same waste in a different costume.
  update app_private.push_wake
     set last_wake_at = now()
   where last_wake_at < now() - interval '15 seconds'
  returning last_wake_at into v_woke;

  if v_woke is null then
    return null;
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'content-type', 'application/json',
                 'x-squadroom-wake', v_secret),
    body    := '{}'::jsonb
  );

  return null;
end;
$fn$;

drop trigger if exists notification_queue_wake on public.notification_queue;
create trigger notification_queue_wake
  after insert on public.notification_queue
  referencing new table as inserted
  for each statement execute function app_private.wake_push_sender();

-- app_private is not reachable over PostgREST, which is the point of it - so
-- there has to be one narrow, service-role-only door for writing the wake
-- configuration. scripts/configure-push-wake.mjs sets it from the
-- environment; nothing else can call this, and nothing at all can read the
-- value back out.
create or replace function public.set_push_wake_config(p_url text, p_secret text)
returns void
language sql volatile security definer set search_path = public as $fn$
  insert into app_private.config (key, value)
  values ('push_wake_url', p_url), ('push_wake_secret', p_secret)
  on conflict (key) do update set value = excluded.value;
$fn$;

revoke execute on function public.set_push_wake_config(text, text)
  from public, anon, authenticated;
grant execute on function public.set_push_wake_config(text, text) to service_role;

-- net._http_response is the only evidence, from inside the database, that the
-- wake-up actually reached Netlify. Service role only: it holds responses
-- from an internal endpoint and has no business being readable by a parent.
create or replace function public.recent_wake_calls(p_minutes integer default 10)
returns table (id bigint, status_code integer, ms integer, created timestamptz)
language sql stable security definer set search_path = public as $fn$
  select r.id, r.status_code, 0 as ms, r.created
    from net._http_response r
   where r.created > now() - make_interval(mins => p_minutes)
   order by r.created desc
   limit 50;
$fn$;

revoke execute on function public.recent_wake_calls(integer) from public, anon, authenticated;
grant execute on function public.recent_wake_calls(integer) to service_role;
