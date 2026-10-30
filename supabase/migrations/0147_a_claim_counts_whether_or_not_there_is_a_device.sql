-- 0147: a claim counts, whether or not there is a device.
--
-- 0131 fixed claim_notifications so that claiming increments `attempts`
-- through the RPC — and, deliberately, left a row for somebody with no
-- registered device unclaimed, calling the alternative "a decision about
-- dropping somebody's notification" and logging it as an open question.
--
-- test-notifications, written months earlier, had already decided it, and
-- its reasoning is the better one: "what matters is that claiming counts
-- attempts at all, which is what stops a stuck row retrying forever" — and
-- it asserts that for a recipient with no device, in so many words. A row
-- that is never claimed is the stuck row. A push is ephemeral; one about a
-- message from twenty-five minutes ago, delivered to a phone that installed
-- the app this afternoon, is noise, and the in-app badge still says the
-- message is there.
--
-- So the claim no longer asks whether there is a device. Every due row is
-- claimed and counted; only the deliverable ones are returned to send. A
-- row with nowhere to go is tried five times over twenty-five minutes and
-- then left, which is the cap doing its job.

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
       and n.attempts < 5
     order by n.scheduled_for
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
