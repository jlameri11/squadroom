-- 0064_event_change_notifications.sql
--
-- Calling a game off notified nobody.
--
-- cancelled_at was set, the fixture went grey in the list, and not a single
-- push went out. A family who did not happen to open the app drove to the
-- ground. Everything needed to prevent that already existed - the queue, the
-- sender, the wake-up - and nothing was connected to it.
--
-- Four rules that make this different from the reminder sweep:
--
-- 1. IT GOES TO EVERYONE WHO CAN SEE THE EVENT, not to those who RSVP'd.
--    Reminders follow the register, which is right for "your kid has a game
--    tomorrow". A cancellation is the opposite: the family least likely to
--    have answered is the family most likely to turn up anyway.
--
-- 2. QUIET HOURS DO NOT APPLY. A 6am ground closure is exactly the message
--    worth waking a phone for, and it is why the exception exists.
--
-- 3. THERE IS NO SETTING TO TURN IT OFF, and deliberately so. Every other
--    notification in this product can be muted, because every other one is
--    someone else's business. "Your child's game is not happening" has no
--    legitimate "I would rather not know", and an opt-out here would only
--    ever be discovered on a wet Saturday.
--
-- 4. INSIDE 24 HOURS IT ESCALATES TO SMS. CLAUDE.md reserves Twilio for
--    precisely one case - "a match cancelled or moved inside 24 hours" - and
--    until now nothing had ever set that flag. Wet weather in Sydney junior
--    football is decided at 7am on a Saturday, which is the whole reason the
--    exception was carved out.

alter table public.notification_queue
  drop constraint notification_queue_kind_check;

alter table public.notification_queue
  add constraint notification_queue_kind_check check (kind in
    ('message','announcement','event_reminder','poll_opened','poll_closing',
     'rsvp_change','invite','event_cancelled','event_changed','event_back_on'));

-- Set by the trigger, never by a client. The sender treats it as permission
-- to spend money, so nothing reachable from a browser may raise it.
alter table public.notification_queue
  add column escalate_sms boolean not null default false,
  add column sms_sent_at  timestamptz,
  add column sms_attempts integer not null default 0;

alter table public.events
  add column cancellation_reason text
    check (cancellation_reason is null or cancellation_reason in
      ('wet_weather','ground_closed','forfeit','not_enough_players','other')),
  add column cancellation_note text;

comment on column public.events.cancellation_reason is
  'Why a game is off. Wet weather is not the same message as a forfeit, and a
   parent reading it in a car park deserves the difference.';

-- ---------------------------------------------------------------------------
-- Who needs to know. Team members if the event has a team, everyone active in
-- the academy if it does not. Deliberately NOT filtered by RSVP.
-- ---------------------------------------------------------------------------
create or replace function app_private.event_audience(p_event public.events)
returns table (profile_id uuid)
language sql stable security definer set search_path = public as $fn$
  select distinct am.profile_id
    from public.academy_members am
   where am.academy_id = p_event.academy_id
     and am.status = 'active'
     and (
       p_event.team_id is null
       or exists (
         select 1 from public.team_members tm
          where tm.team_id = p_event.team_id and tm.profile_id = am.profile_id
       )
     )
     -- A private scanned event has an audience of exactly one person, and
     -- they already know: they created it.
     and p_event.private_to is null;
$fn$;

create or replace function public.notify_event_change()
returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  v_tz     text;
  v_kind   text;
  v_title  text;
  v_body   text;
  v_urgent boolean;
  v_when   text;
  v_reason text;
begin
  select timezone into v_tz from public.academies where id = new.academy_id;
  v_when := to_char(new.starts_at at time zone v_tz, 'Dy FMDD Mon, FMHH12:MIam');

  -- Inside 24 hours is the difference between "note the change" and "you are
  -- about to leave the house".
  v_urgent := new.starts_at < now() + interval '24 hours'
          and new.starts_at > now() - interval '3 hours';

  if old.cancelled_at is null and new.cancelled_at is not null then
    v_kind := 'event_cancelled';
    v_reason := case new.cancellation_reason
      when 'wet_weather'        then 'Wet weather'
      when 'ground_closed'      then 'Ground closed'
      when 'forfeit'            then 'Forfeit'
      when 'not_enough_players' then 'Not enough players'
      else null end;
    v_title := 'Called off: ' || new.title;
    v_body  := trim(both ' · ' from concat_ws(' · ',
                 v_reason,
                 'was ' || v_when,
                 nullif(btrim(coalesce(new.cancellation_note,'')), '')));

  elsif old.cancelled_at is not null and new.cancelled_at is null then
    v_kind  := 'event_back_on';
    v_title := 'Back on: ' || new.title;
    v_body  := v_when || coalesce(' · ' || new.venue, '');

  elsif new.cancelled_at is null
    and (old.starts_at <> new.starts_at
         or coalesce(old.venue,'') <> coalesce(new.venue,'')) then
    v_kind := 'event_changed';
    v_title := 'Changed: ' || new.title;
    v_body := case
      when old.starts_at <> new.starts_at and coalesce(old.venue,'') <> coalesce(new.venue,'')
        then 'Now ' || v_when || ' at ' || coalesce(new.venue, 'a new ground')
      when old.starts_at <> new.starts_at then 'Now ' || v_when
      else 'Now at ' || coalesce(new.venue, 'a new ground')
    end;

  else
    return new;
  end if;

  insert into public.notification_queue
    (academy_id, profile_id, kind, title, body, url, payload,
     scheduled_for, escalate_sms, dedupe_key)
  select
    new.academy_id,
    aud.profile_id,
    v_kind,
    v_title,
    v_body,
    '/calendar/' || new.id,
    jsonb_build_object('event_id', new.id, 'reason', new.cancellation_reason),
    now(),                    -- quiet hours deliberately do not apply
    v_urgent,
    -- Keyed on the new time and venue as well as the event, so a coach who
    -- moves a game twice sends two messages, but saving the same change
    -- twice sends one.
    new.id::text || ':' || v_kind || ':' || extract(epoch from new.starts_at)::bigint::text
      || ':' || coalesce(new.venue,'') || ':' || aud.profile_id::text
  from app_private.event_audience(new) aud
  on conflict (dedupe_key) do nothing;

  return new;
end;
$fn$;

drop trigger if exists events_notify_change on public.events;
create trigger events_notify_change
  after update on public.events
  for each row execute function public.notify_event_change();

-- What the SMS sender drains: only rows the trigger flagged, only for people
-- with a number, and only once. Separate from claim_notifications so a push
-- failure never suppresses the text, and vice versa.
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

revoke execute on function public.claim_sms_escalations(integer) from public, anon, authenticated;
grant execute on function public.claim_sms_escalations(integer) to service_role;

create index notification_queue_sms_idx
  on public.notification_queue (scheduled_for)
  where escalate_sms and sms_sent_at is null;
