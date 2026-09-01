-- 0046_message_notifications.sql
--
-- A new message notifies the channel. Enqueued by a trigger rather than by
-- the client, because a client that forgets - or is a native app, or a script
-- - would silently stop notifying anyone.
--
-- The queue keeps sending off the write path. A channel of thirty families
-- must not make posting a message thirty times slower, and a push provider
-- being slow must not make chat feel broken.

-- Named zone_time, not localtime: LOCALTIME is a reserved SQL keyword, so
-- localtime(a.timezone) parses as the keyword followed by a parenthesised
-- expression and fails in a way that points nowhere near the cause.
create or replace function public.zone_time(p_zone text)
returns time language sql stable as $$
  select (now() at time zone p_zone)::time;
$$;

create or replace function public.enqueue_message_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_channel public.channels%rowtype;
  v_sender  text;
  v_title   text;
  v_body    text;
begin
  if new.status <> 'published' or new.deleted_at is not null then
    return new;
  end if;

  select * into v_channel from public.channels where id = new.channel_id;
  select full_name into v_sender from public.profiles where id = new.sender_id;

  v_title := case
    when v_channel.type = 'direct' then coalesce(v_sender, 'New message')
    when new.is_announcement then coalesce(v_channel.name, 'Announcement')
    else coalesce(v_channel.name, 'New message')
  end;

  v_body := case
    when new.body is not null and length(btrim(new.body)) > 0
      then case when v_channel.type = 'direct' then '' else coalesce(v_sender || ': ', '') end
           || left(new.body, 140)
    when new.event_id is not null then coalesce(v_sender || ' shared a fixture', 'A fixture was shared')
    when new.poll_id  is not null then coalesce(v_sender || ' asked a question', 'A poll was posted')
    else coalesce(v_sender || ' sent a photo', 'A photo was sent')
  end;

  insert into public.notification_queue
    (academy_id, profile_id, kind, title, body, url, payload, scheduled_for, dedupe_key)
  select
    new.academy_id, cm.profile_id,
    case when new.is_announcement then 'announcement' else 'message' end,
    v_title, v_body,
    '/chat/' || new.channel_id,
    jsonb_build_object('channel_id', new.channel_id, 'message_id', new.id),
    -- Quiet hours hold ordinary messages until morning. They do not apply to
    -- announcements, which is the point of an announcement, and 0042 already
    -- exempts event reminders.
    case
      when new.is_announcement then now()
      when us.quiet_hours_enabled
       and (public.zone_time(a.timezone) >= us.quiet_hours_start
            or public.zone_time(a.timezone) < us.quiet_hours_end)
      then ((current_date + 1) + us.quiet_hours_end) at time zone a.timezone
      else now()
    end,
    new.id::text || ':' || cm.profile_id::text
  from public.channel_members cm
  join public.user_settings us on us.profile_id = cm.profile_id
  join public.academies a on a.id = new.academy_id
  where cm.channel_id = new.channel_id
    and cm.profile_id <> new.sender_id           -- never notify the sender
    and (not cm.muted or new.is_announcement)     -- muting spares you all but an announcement
    and (case when new.is_announcement then us.notify_announcements else us.notify_messages end)
  on conflict (dedupe_key) do nothing;

  return new;
end;
$$;

create trigger messages_notify
  after insert on public.messages
  for each row execute function public.enqueue_message_notification();

-- What the sender drains. Oldest first, so a backlog clears in the order it
-- happened. FOR UPDATE SKIP LOCKED means two senders running at once take
-- different rows rather than both taking the same one. attempts increments in
-- the same statement, so a crash mid-send cannot leave a row retried forever.
create or replace function public.claim_notifications(p_limit integer default 100)
returns table (
  id         uuid,
  profile_id uuid,
  title      text,
  body       text,
  url        text,
  endpoint   text,
  p256dh     text,
  auth       text,
  sub_id     uuid
)
language sql security definer set search_path = public as $$
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
  select m.id, m.profile_id, m.title, m.body, m.url,
         s.endpoint, s.p256dh, s.auth, s.id
    from marked m
    join public.push_subscriptions s
      on s.profile_id = m.profile_id and s.failed_at is null;
$$;

revoke execute on function public.claim_notifications(integer) from public, anon, authenticated;
grant execute on function public.claim_notifications(integer) to service_role;

create index notification_queue_pending_idx
  on public.notification_queue (scheduled_for)
  where sent_at is null;
