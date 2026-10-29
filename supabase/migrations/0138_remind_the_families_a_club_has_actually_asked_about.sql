-- 0138: remind the families a club has actually asked about.
--
-- 0137's sweep reminded every guardian of every player whose status was
-- 'unknown' or 'pending'. On its first run against the seed it queued
-- thirty. That is what it would do on its first morning in production,
-- too: 'unknown' is the default for every row that existed before 0137, so
-- every family at every club with a game inside a fortnight would be told
-- their child is "not yet registered with PlayFootball" — including clubs
-- that have never opened the control and children who have been registered
-- for years.
--
-- 'unknown' means nobody has checked. It is not a fact about the child.
-- 'pending' is: a club has looked, and said the family has not done it.
-- That is the one worth a push, and it is what "done/pending" in the brief
-- means. A club that never marks anything gets no reminders, which is right
-- — the reminder is on the club's say-so, not the default's.

create or replace function public.queue_official_rego_reminders()
returns integer
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_sent integer := 0;
begin
  with first_match as (
    select e.team_id, min(e.starts_at) as kick_off
      from public.events e
     where e.type = 'match'
       and e.cancelled_at is null
       and e.team_id is not null
       and e.starts_at > now()
     group by e.team_id
  ),
  due as (
    select pl.id as player_id, pl.academy_id, pl.full_name, fm.kick_off,
           greatest(0, (fm.kick_off::date - current_date)) as days_left
      from public.players pl
      join first_match fm on fm.team_id = pl.team_id
     where pl.official_status = 'pending'
       and fm.kick_off <= now() + interval '14 days'
  ),
  recipients as (
    select d.*, pg.profile_id as tell
      from due d
      join public.player_guardians pg on pg.player_id = d.player_id
  ),
  fresh as (
    select r.* from recipients r
     where not exists (
       select 1 from public.notification_queue n
        where n.kind = 'official_rego_pending'
          and n.profile_id = r.tell
          and n.payload->>'player_id' = r.player_id::text
          and n.created_at > now() - interval '7 days'
     )
  ),
  queued as (
    insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload)
    select
      f.academy_id,
      f.tell,
      'official_rego_pending',
      'Not yet registered with PlayFootball',
      f.full_name || ' plays ' ||
      case when f.days_left = 0 then 'today'
           when f.days_left = 1 then 'tomorrow'
           else 'in ' || f.days_left || ' days' end ||
      ' and the club has no PlayFootball registration for them. Without one they cannot take the field.',
      '/settings/family',
      jsonb_build_object('player_id', f.player_id, 'kick_off', f.kick_off)
    from fresh f
    returning 1
  )
  select count(*)::integer into v_sent from queued;

  return v_sent;
end;
$fn$;

-- The thirty queued by 0137's first run against this database were never
-- sent (0 devices) and are not wanted.
delete from public.notification_queue where kind = 'official_rego_pending' and sent_at is null;
