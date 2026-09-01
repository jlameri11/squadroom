-- 0058_claim_notifications_carries_platform.sql
--
-- The sender has to know what kind of device it is talking to.
--
-- push_subscriptions has carried a `platform` column since 0010, but
-- claim_notifications never returned it, so every row came back looking like
-- a web push subscription. A native device token would have been handed to
-- web-push, which would have failed silently five times and then retired the
-- subscription - the iPhone would simply never buzz, with nothing in any log
-- saying why. A column that exists but is never read is not a feature.
--
-- Also returns the notification kind, because APNs needs to know whether a
-- payload may interrupt a focus mode. A cancelled game may; a chat message
-- may not, and an app that claims every message is urgent gets muted
-- permanently and then delivers nothing at all.

drop function if exists public.claim_notifications(integer);

create function public.claim_notifications(p_limit integer default 100)
returns table (
  id         uuid,
  profile_id uuid,
  kind       text,
  title      text,
  body       text,
  url        text,
  platform   text,
  endpoint   text,
  p256dh     text,
  auth       text,
  sub_id     uuid
)
language sql security definer set search_path = public as $fn$
  with due as (
    select n.id
      from public.notification_queue n
     where n.sent_at is null
       and n.scheduled_for <= now()
       and n.attempts < 5
     order by n.scheduled_for
     limit p_limit
     for update skip locked
  ),
  marked as (
    update public.notification_queue n
       set attempts = n.attempts + 1
      from due
     where n.id = due.id
     returning n.*
  )
  select m.id, m.profile_id, m.kind, m.title, m.body, m.url,
         s.platform, s.endpoint, s.p256dh, s.auth, s.id
    from marked m
    join public.push_subscriptions s on s.profile_id = m.profile_id
   where s.failed_at is null;
$fn$;

revoke execute on function public.claim_notifications(integer) from public, anon, authenticated;
grant execute on function public.claim_notifications(integer) to service_role;
