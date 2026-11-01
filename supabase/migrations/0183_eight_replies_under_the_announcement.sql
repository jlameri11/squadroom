-- 0183: eight replies, under the announcement.
--
-- C-06. A coach posts the Saturday details and eight parents reply
-- "thanks" — eight messages in the feed and, until now, eight pushes to
-- fifty families. Replies to an announcement now collapse under it in
-- the feed ("8 replies"), and they notify only the people in the thread:
-- the announcement's author and whoever has replied already. A reply to
-- an ordinary message is unchanged. Mentions and a host's @everyone still
-- reach whoever they name.

drop function if exists public.channel_messages(uuid, timestamptz, integer);
create function public.channel_messages(
  p_channel uuid,
  p_before  timestamptz default null,
  p_limit   integer default 50
)
returns table (
  id           uuid,
  body         text,
  attachments  jsonb,
  sender_id    uuid,
  sender_name  text,
  sender_role  public.academy_role,
  sender_label text,
  reply_to_id  uuid,
  reply_to_body text,
  reply_to_name text,
  is_announcement boolean,
  pinned_at    timestamptz,
  created_at   timestamptz,
  edited_at    timestamptz,
  deleted_at   timestamptz,
  event_id     uuid,
  event        jsonb,
  poll_id      uuid,
  poll         jsonb,
  reply_count  integer,
  reply_to_announcement boolean
)
language sql stable security definer set search_path = public as $$
  select
    m.id,
    case when m.deleted_at is null then m.body else null end,
    case when m.deleted_at is null then m.attachments else '[]'::jsonb end,
    m.sender_id,
    p.full_name,
    am.role,
    app_private.channel_member_label(p_channel, m.sender_id),
    m.reply_to_id,
    case when r.deleted_at is null then r.body else null end,
    rp.full_name,
    m.is_announcement,
    m.pinned_at,
    m.created_at,
    m.edited_at,
    m.deleted_at,
    m.event_id,
    case when m.event_id is null then null else (
      select to_jsonb(e) from (
        select ev.id, ev.title, ev.type, ev.starts_at, ev.ends_at, ev.arrive_at,
               ev.venue, ev.address, ev.opponent, ev.kit_colour, ev.cancelled_at
          from public.events ev where ev.id = m.event_id
      ) e
    ) end,
    m.poll_id,
    case when m.poll_id is null then null else (
      select to_jsonb(q) from (
        select po.id, po.question, po.options, po.type, po.multi, po.anonymous,
               po.closes_at, po.closed_at
          from public.polls po where po.id = m.poll_id
      ) q
    ) end,
    (select count(*)::integer from public.messages x where x.reply_to_id = m.id and x.status = 'published' and x.deleted_at is null),
    coalesce(r.is_announcement, false)
  from public.messages m
  left join public.profiles p on p.id = m.sender_id
  left join public.academy_members am
    on am.academy_id = m.academy_id and am.profile_id = m.sender_id
  left join public.messages r on r.id = m.reply_to_id
  left join public.profiles rp on rp.id = r.sender_id
  where m.channel_id = p_channel
    and m.status = 'published'
    and (p_before is null or m.created_at < p_before)
    and (select app_private.is_channel_member(p_channel))
  order by m.created_at desc
  limit least(coalesce(p_limit, 50), 100);
$$;

revoke execute on function public.channel_messages(uuid, timestamptz, integer) from public, anon;
grant execute on function public.channel_messages(uuid, timestamptz, integer) to authenticated;

-- 0182's trigger with the thread rule.
create or replace function public.enqueue_message_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_channel public.channels%rowtype;
  v_sender  text;
  v_title   text;
  v_body    text;
  v_everyone boolean := false;
  v_thread  boolean := false;
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

  -- A reply under an announcement is a thread: its author and its repliers hear, the channel does not.
  if new.reply_to_id is not null and exists (select 1 from public.messages a where a.id = new.reply_to_id and a.is_announcement) then
    v_thread := true;
  end if;

  v_title := case
    when v_channel.type = 'direct' then coalesce(v_sender, 'New message')
    when new.is_announcement then coalesce(v_channel.name, 'Announcement')
    when v_thread then 'Reply in ' || coalesce(v_channel.name, 'the channel')
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
    and (not v_thread
         or cm.profile_id = any (new.mentions) or v_everyone
         or cm.profile_id in (
              select x.sender_id from public.messages x where x.id = new.reply_to_id
              union
              select x.sender_id from public.messages x where x.reply_to_id = new.reply_to_id and x.status = 'published' and x.deleted_at is null))
  on conflict (dedupe_key) do update
    set payload = public.notification_queue.payload || jsonb_build_object('count', coalesce((public.notification_queue.payload->>'count')::integer, 1) + 1, 'message_id', excluded.payload->>'message_id'),
        body = (coalesce((public.notification_queue.payload->>'count')::integer, 1) + 1) || ' new messages in ' || coalesce(v_channel.name, 'the channel'),
        title = coalesce(v_channel.name, 'New messages')
    where public.notification_queue.sent_at is null
      and public.notification_queue.dedupe_key like 'digest:%';

  return new;
end;
$$;
