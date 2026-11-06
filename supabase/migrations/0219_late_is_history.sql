-- 0219: a push or a text that could not go for twelve hours is not sent late.
--
-- The queue took any unsent row that had failed fewer than five times,
-- however old. So a sender down for a day — or a person who switches push
-- on for the first time — got every queued push at once: yesterday's goals,
-- a game changed last week, "called off" for a game already played. Found 7
-- Nov 2026: 1,449 test pushes from one day's suites sat unsent in the demo's
-- queue, waiting for the first phone to switch push on.
--
-- Twelve hours after it was due, a push or a text is history: the chat and
-- the fixture have the facts, and a late "called off" text about a game
-- already played is worse than none. Reminders are queued for when they are
-- due, so they are not affected unless the sender was down past them.
--
-- As 0149 and 0064 otherwise.

create or replace function public.claim_notifications(p_limit integer default 100)
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
language plpgsql
security definer
set search_path = public as $fn$
declare
  v_ids uuid[];
begin
  with picked as (
    select n.id
      from public.notification_queue n
     where n.sent_at is null
       and n.scheduled_for <= now()
       and n.scheduled_for > now() - interval '12 hours'
       and n.attempts < 5
     order by
       exists (select 1 from public.push_subscriptions s
                where s.profile_id = n.profile_id and s.failed_at is null) desc,
       n.scheduled_for
     limit p_limit
     for update skip locked
  ),
  marked as (
    update public.notification_queue n
       set attempts = n.attempts + 1
      from picked
     where n.id = picked.id
    returning n.id
  )
  select coalesce(array_agg(marked.id), '{}'::uuid[]) into v_ids from marked;

  return query
    select n.id, n.profile_id, n.kind, n.title, n.body, n.url,
           s.platform, s.endpoint, s.p256dh, s.auth, s.id
      from public.notification_queue n
      join public.push_subscriptions s
        on s.profile_id = n.profile_id
       and s.failed_at is null
     where n.id = any(v_ids);
end;
$fn$;

create or replace function public.claim_sms_escalations(p_limit integer default 50)
returns table (
  id         uuid,
  profile_id uuid,
  phone      text,
  title      text,
  body       text
)
language sql security definer set search_path = public as $fn$
  with due as (
    select n.id
      from public.notification_queue n
     where n.escalate_sms
       and n.sms_sent_at is null
       and n.scheduled_for <= now()
       and n.scheduled_for > now() - interval '12 hours'
       and n.sms_attempts < 3
     order by n.scheduled_for
     limit p_limit
     for update skip locked
  ),
  marked as (
    update public.notification_queue n
       set sms_attempts = n.sms_attempts + 1
      from due
     where n.id = due.id
     returning n.*
  )
  select m.id, m.profile_id, p.phone::text, m.title, m.body
    from marked m
    join public.profiles p on p.id = m.profile_id
   where p.phone is not null;
$fn$;
