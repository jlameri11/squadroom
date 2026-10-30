-- 0149: deliverable rows first.
--
-- 0147 made every due row claimable, device or not, so the retry cap can
-- end a stuck one. The cost showed up in the same hour: a claim takes the
-- oldest p_limit due rows, and with no devices registered yet every row
-- ever queued is due and undeliverable, so a batch of 200 can be filled
-- entirely with rows nobody can be sent — and the one row with a device
-- behind it waits, up to five sweeps, behind rows that will never go.
--
-- The order now puts rows that CAN be sent first, then the rest by age.
-- Nothing is excluded — an undeliverable row still burns its five
-- attempts and ends — but it never stands in front of a push that can
-- actually reach a phone.

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
