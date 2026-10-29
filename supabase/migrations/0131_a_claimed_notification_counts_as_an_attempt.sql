-- 0131: claiming a notification actually counts as an attempt.
--
-- MEASURED, not suspected. Same row, same database:
--
--   select * from claim_notifications(200)   as plain SQL  → attempts +2 (!)
--   supabase.rpc('claim_notifications', …)   as the app does → attempts +0
--
-- Neither number is 1, and that is the whole story.
--
-- `claim_notifications` was `language sql` whose body was ONE statement: a
-- `with due as (select … for update skip locked), marked as (update … )`
-- followed by a select joining `marked` to `push_subscriptions`. The comment
-- above it said claiming "increments attempts in the same statement, so a
-- crash mid-send cannot leave a row to be retried forever".
--
-- The postgres docs do promise that a data-modifying CTE runs "exactly once,
-- and always to completion, independently of whether the primary query reads
-- any of their output". What that promise is about is the primary query. A
-- single-statement `language sql` function is a candidate for INLINING into
-- whatever query called it, and once it is inlined the CTE is no longer the
-- primary statement — it is a subquery in someone else's plan, and how many
-- times it runs is up to that plan. Called by PostgREST it ran zero times;
-- wrapped in `count(*)` it ran twice.
--
-- WHY IT MATTERS. The retry cap is `attempts < 5`. A counter that never
-- increments is a cap that never engages, so a row that cannot be delivered
-- is re-claimed every five minutes for ever. Today there are 0 registered
-- devices and the queue is empty, so nothing looks wrong. At 300 academies
-- this is the queue silting up, which CLAUDE.md already names as the thing
-- to avoid.
--
-- THE FIX IS NOT A BETTER CTE. It is to stop the correctness of a counter
-- depending on a planner decision. plpgsql executes each statement itself,
-- exactly once, and is never inlined into the caller — so the claim happens
-- once because it is its own statement, not because of how it was asked for.
--
-- Deliberately NOT changed here: a row for somebody with no registered
-- device is still never claimed, exactly as before. It is tempting to let the
-- new, working retry cap quietly abandon those after five sweeps, but that is
-- a decision about dropping somebody's notification and it belongs to Joey,
-- not to a bug fix. Logged in NIGHT_LOG as an open question.
--
-- The signature is unchanged, so `create or replace` is enough and no grant
-- is disturbed.

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
  -- STATEMENT ONE: claim. Its own statement, so it runs once.
  --
  -- `exists` on a live subscription keeps the previous behaviour: a
  -- notification for somebody with no device is left alone rather than
  -- burning an attempt it could never have used.
  with picked as (
    select n.id
      from public.notification_queue n
     where n.sent_at is null
       and n.scheduled_for <= now()
       and n.attempts < 5
       and exists (
         select 1
           from public.push_subscriptions s
          where s.profile_id = n.profile_id
            and s.failed_at is null
       )
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

  -- STATEMENT TWO: say what to send. A separate read, so the fan-out across
  -- a family's devices cannot affect whether the claim happened.
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

revoke execute on function public.claim_notifications(integer) from public, anon, authenticated;
grant execute on function public.claim_notifications(integer) to service_role;
