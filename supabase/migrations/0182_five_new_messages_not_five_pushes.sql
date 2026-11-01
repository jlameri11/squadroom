-- 0182: five new messages, not five pushes.
--
-- C-07. A busy team chat on a Friday night is twenty pushes, and twenty
-- pushes is how a parent turns notifications off and misses Saturday's
-- cancellation. A person can ask for ordinary messages to be grouped:
-- every ten, thirty or sixty minutes, one push per channel — "5 new
-- messages in U8 SPL" — instead of one per message. Off by default.
--
-- NEVER GROUPED: announcements, mentions, a game called off or moved, a
-- reminder, an RSVP nudge. Those are the pushes the grouping exists to
-- make room for. Direct messages are not grouped either — one person
-- writing to you is not noise.
--
-- Done in the queue, not the drain: a digest is one row whose body is
-- rewritten as messages arrive and whose send time is the end of the
-- window; the drain sends it like any other row. Quiet hours still win.

alter table public.user_settings
  add column if not exists digest_minutes integer not null default 0
  check (digest_minutes in (0, 10, 30, 60));

create or replace function public.set_digest_minutes(p_minutes integer)
returns void
language plpgsql security definer set search_path = public as $fn$
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '42501'; end if;
  if p_minutes not in (0, 10, 30, 60) then raise exception 'off, 10, 30 or 60 minutes' using errcode = '22023'; end if;
  insert into public.user_settings (profile_id, digest_minutes) values (auth.uid(), p_minutes)
  on conflict (profile_id) do update set digest_minutes = excluded.digest_minutes;
end;
$fn$;

create or replace function public.my_digest_minutes()
returns integer
language sql stable security definer set search_path = public as $fn$
  select coalesce((select digest_minutes from public.user_settings where profile_id = auth.uid()), 0);
$fn$;

-- 0179's trigger with the digest branch.
create or replace function public.enqueue_message_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_channel public.channels%rowtype;
  v_sender  text;
  v_title   text;
  v_body    text;
  v_everyone boolean := false;
begin
  if new.status <> 'published' or new.deleted_at is not null then
    return new;
  end if;

  select * into v_channel from public.channels where id = new.channel_id;
  select full_name into v_sender from public.profiles where id = new.sender_id;

  if new.mention_everyone and exists (
    select 1 from public.channel_members cm where cm.channel_id = new.channel_id and cm.profile_id = new.sender_id and cm.role = 'host'
  ) then
    v_everyone := true;
  end if;

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
    case
      when cm.profile_id = any (new.mentions) or v_everyone then 'mention'
      when new.is_announcement then 'announcement'
      else 'message'
    end,
    case when cm.profile_id = any (new.mentions) or v_everyone
         then coalesce(v_sender, 'Somebody') || ' mentioned you' || case when v_channel.type = 'direct' then '' else ' in ' || coalesce(v_channel.name, 'a channel') end
         else v_title end,
    v_body,
    '/chat/' || new.channel_id,
    jsonb_build_object('channel_id', new.channel_id, 'message_id', new.id, 'count', 1),
    greatest(
      -- Urgent now; a grouped message at the end of its window.
      case
        when new.is_announcement or cm.profile_id = any (new.mentions) or v_everyone or v_channel.type = 'direct' or us.digest_minutes = 0 then now()
        else to_timestamp((floor(extract(epoch from now()) / (us.digest_minutes * 60)) + 1) * us.digest_minutes * 60)
      end,
      case
        when not (new.is_announcement or cm.profile_id = any (new.mentions) or v_everyone)
         and us.quiet_hours_enabled
         and (public.zone_time(a.timezone) >= us.quiet_hours_start
              or public.zone_time(a.timezone) < us.quiet_hours_end)
        then ((current_date + 1) + us.quiet_hours_end) at time zone a.timezone
        else now()
      end
    ),
    case
      when new.is_announcement or cm.profile_id = any (new.mentions) or v_everyone or v_channel.type = 'direct' or us.digest_minutes = 0
        then new.id::text || ':' || cm.profile_id::text
      else 'digest:' || new.channel_id::text || ':' || cm.profile_id::text || ':' || floor(extract(epoch from now()) / (us.digest_minutes * 60))::text
    end
  from public.channel_members cm
  join public.user_settings us on us.profile_id = cm.profile_id
  join public.academies a on a.id = new.academy_id
  where cm.channel_id = new.channel_id
    and cm.profile_id <> new.sender_id
    and (not cm.muted or new.is_announcement or cm.profile_id = any (new.mentions) or v_everyone)
    and (cm.profile_id = any (new.mentions) or v_everyone
         or (case when new.is_announcement then us.notify_announcements else us.notify_messages end))
  on conflict (dedupe_key) do update
    set payload = public.notification_queue.payload || jsonb_build_object('count', coalesce((public.notification_queue.payload->>'count')::integer, 1) + 1, 'message_id', excluded.payload->>'message_id'),
        body = (coalesce((public.notification_queue.payload->>'count')::integer, 1) + 1) || ' new messages in ' || coalesce(v_channel.name, 'the channel'),
        title = coalesce(v_channel.name, 'New messages')
    where public.notification_queue.sent_at is null
      and public.notification_queue.dedupe_key like 'digest:%';

  return new;
end;
$$;

grant execute on function public.set_digest_minutes(integer) to authenticated;
grant execute on function public.my_digest_minutes() to authenticated;
