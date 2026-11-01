-- 0184: say it, or show it.
--
-- C-05. A coach walking off the pitch talks faster than they type, and a
-- parent at the ground has a clip of the goal. Voice notes and short video
-- go into the same private bucket as photos, under the same path rule
-- ({academy}/{channel}/{uploader}/{file}) and the same three policies from
-- 0034: readable by the channel's members, writable by whoever may post
-- there, removable by the uploader or a host. Nothing about who may see a
-- child changes; only what a message can carry.
--
-- 25 MB is the ceiling, which is about thirty seconds of phone video. The
-- client refuses anything bigger before a byte is sent, and this is the
-- backstop for a client that does not.

update storage.buckets
   set file_size_limit = 26214400,
       allowed_mime_types = array[
         'image/jpeg','image/png','image/webp','image/heic','image/gif','application/pdf',
         'audio/webm','audio/mp4','audio/mpeg','audio/ogg','audio/aac','audio/x-m4a','audio/wav',
         'video/mp4','video/quicktime','video/webm'
       ],
       public = false
 where id = 'attachments';

-- What a message with no words carries, in words. One place, so the chat
-- list and the push say the same thing.
create or replace function app_private.attachment_label(p_attachments jsonb)
returns text language sql immutable as $$
  select case
    when p_attachments is null or jsonb_typeof(p_attachments) <> 'array' or jsonb_array_length(p_attachments) = 0 then null
    when jsonb_array_length(p_attachments) = 1 then
      case
        when p_attachments->0->>'mime' like 'audio/%' then 'Voice note'
        when p_attachments->0->>'mime' like 'video/%' then 'Video'
        when p_attachments->0->>'mime' like 'image/%' then 'Photo'
        else 'File'
      end
    else
      case
        when (select bool_and(a->>'mime' like 'image/%') from jsonb_array_elements(p_attachments) a)
          then jsonb_array_length(p_attachments)::text || ' photos'
        else jsonb_array_length(p_attachments)::text || ' attachments'
      end
  end;
$$;

create or replace function app_private.attachment_icon(p_attachments jsonb)
returns text language sql immutable as $$
  select case
    when p_attachments->0->>'mime' like 'audio/%' then '🎙'
    when p_attachments->0->>'mime' like 'video/%' then '🎬'
    when p_attachments->0->>'mime' like 'image/%' then '📷'
    else '📄'
  end;
$$;

-- 0077's channel list, with the label above instead of "Photo" for everything.
create or replace function public.my_channels(p_academy uuid)
returns table (
  channel_id     uuid,
  name           text,
  type           public.channel_type,
  team_id        uuid,
  posting_mode   public.posting_mode,
  status         public.channel_status,
  my_role        public.channel_member_role,
  muted          boolean,
  unread_count   integer,
  last_message_at   timestamptz,
  last_message_body text,
  last_sender_name  text
)
language sql stable security definer set search_path = public as $fn$
  select
    c.id,
    coalesce(c.name, dm.full_name, 'Direct message'),
    c.type, c.team_id, c.posting_mode, c.status,
    cm.role, cm.muted,
    (
      select count(*)::integer
        from public.messages m
       where m.channel_id = c.id
         and m.created_at > cm.last_read_at
         and m.sender_id is distinct from auth.uid()
         and m.deleted_at is null
         and m.status = 'published'
    ),
    last.created_at,
    case
      when last.id is null then null
      when last.deleted_at is not null then 'Message deleted'
      when nullif(btrim(coalesce(last.body, '')), '') is not null then last.body
      when last.event_id is not null then
        '📅 ' || coalesce((select e.title from public.events e where e.id = last.event_id), 'Fixture')
      when exists (select 1 from public.polls p where p.message_id = last.id) then
        '📊 ' || coalesce((select p.question from public.polls p where p.message_id = last.id), 'Poll')
      when jsonb_array_length(coalesce(last.attachments, '[]'::jsonb)) > 0 then
        app_private.attachment_icon(last.attachments) || ' ' || app_private.attachment_label(last.attachments)
      else null
    end,
    (select p.full_name from public.profiles p where p.id = last.sender_id)
  from public.channels c
  join public.channel_members cm
    on cm.channel_id = c.id and cm.profile_id = auth.uid()
  left join lateral (
    select m.id, m.body, m.created_at, m.sender_id, m.event_id, m.attachments, m.deleted_at
      from public.messages m
     where m.channel_id = c.id and m.status = 'published'
     order by m.created_at desc
     limit 1
  ) last on true
  left join lateral (
    select pr.full_name
      from public.channel_members other
      join public.profiles pr on pr.id = other.profile_id
     where c.type = 'direct'
       and other.channel_id = c.id
       and other.profile_id <> auth.uid()
     limit 1
  ) dm on true
 where c.academy_id = p_academy
 order by (c.status = 'archived'), last.created_at desc nulls last, coalesce(c.name, dm.full_name);
$fn$;

revoke execute on function public.my_channels(uuid) from public, anon;
grant execute on function public.my_channels(uuid) to authenticated;

-- 0183's trigger, with the push saying "sent a voice note" rather than
-- "sent a photo" for one. Nothing else changes.
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
    else coalesce(v_sender, 'Somebody') || ' sent a ' || lower(coalesce(app_private.attachment_label(new.attachments), 'photo'))
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
