-- 0042_calendar_and_reminders.sql
--
-- The calendar screen, and the machinery that decides who gets told about
-- what and when.

-- What is coming up, for me. A parent sees their own teams' events; a coach
-- sees theirs. The RSVP summary comes back on the same row so a list of
-- twenty fixtures is one query rather than twenty-one.
create or replace function public.my_upcoming_events(
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
  no_reply      integer
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
    case when app_private.is_event_coach(e.id) then s.no_reply end
  from public.events e
  left join public.teams t on t.id = e.team_id
  left join public.competitions c on c.id = e.competition_id
  left join lateral public.event_rsvp_summary(e.id) s on true
  where e.academy_id = p_academy
    and e.starts_at >= now() - interval '3 hours'
    and e.starts_at <  now() + (p_days || ' days')::interval
    and (e.team_id is null
         or app_private.is_team_member(e.team_id)
         or app_private.is_academy_coach(e.academy_id))
    and app_private.is_academy_member(p_academy)
  order by e.starts_at;
$$;

grant execute on function public.my_upcoming_events(uuid, integer) to authenticated;

-- Reminders. Queued, never sent inline. Two windows: the night before, and
-- the leaving-the-house nudge. dedupe_key is what makes this safe to run
-- every five minutes - a second pass over the same event and person is a
-- no-op, so a slow drain or a restart cannot double-send.
--
-- Quiet hours deliberately do NOT apply. Someone who muted a channel still
-- wants to know their kid has a game; that is the one message worth waking a
-- phone for, and it is why this is separate from message notifications.
create or replace function public.enqueue_event_reminders()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count integer := 0;
begin
  insert into public.notification_queue
    (academy_id, profile_id, kind, title, body, url, payload, scheduled_for, dedupe_key)
  select
    e.academy_id,
    r.profile_id,
    'event_reminder',
    case when w.window_label = '24h' then 'Tomorrow: ' || e.title else e.title end,
    trim(both ' · ' from concat_ws(' · ',
      to_char(e.starts_at at time zone a.timezone, 'Dy FMHH12:MIam'),
      e.venue,
      case when e.arrive_at is not null
           then 'arrive ' || to_char(e.arrive_at at time zone a.timezone, 'FMHH12:MIam') end)),
    '/calendar/' || e.id,
    jsonb_build_object('event_id', e.id, 'window', w.window_label),
    now(),
    e.id::text || ':' || r.profile_id::text || ':' || w.window_label
  from public.events e
  join public.academies a on a.id = e.academy_id
  cross join lateral (values ('24h', interval '24 hours'), ('2h', interval '2 hours'))
    as w(window_label, lead_time)
  join lateral (
    select 1 where e.starts_at - w.lead_time <= now()
                and e.starts_at - w.lead_time >  now() - interval '15 minutes'
  ) fires on true
  join lateral (
    select distinct tm.profile_id
      from public.team_members tm
     where e.team_id is not null and tm.team_id = e.team_id
    union
    select distinct am.profile_id
      from public.academy_members am
     where e.team_id is null and am.academy_id = e.academy_id and am.status = 'active'
  ) r on true
  join public.user_settings us on us.profile_id = r.profile_id
  where e.cancelled_at is null
    and e.starts_at > now()
    and ((w.window_label = '24h' and us.notify_reminder_24h)
      or (w.window_label = '2h'  and us.notify_reminder_2h))
  on conflict (dedupe_key) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.enqueue_event_reminders() from public, anon, authenticated;
grant execute on function public.enqueue_event_reminders() to service_role;

-- A cancelled or moved event should not still send yesterday's reminder.
create or replace function public.clear_stale_reminders()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.cancelled_at is not null and old.cancelled_at is null
     or new.starts_at is distinct from old.starts_at then
    delete from public.notification_queue
     where sent_at is null
       and kind = 'event_reminder'
       and (payload ->> 'event_id')::uuid = new.id;
  end if;
  return new;
end;
$$;

create trigger events_clear_stale_reminders
  after update of starts_at, cancelled_at on public.events
  for each row execute function public.clear_stale_reminders();

-- Every five minutes. The 15-minute window above is wider than the interval
-- on purpose: a missed run still catches up rather than silently skipping an
-- event's reminder entirely.
select cron.schedule(
  'enqueue-event-reminders',
  '*/5 * * * *',
  $cron$select public.enqueue_event_reminders()$cron$
);
