-- 0179: say their name.
--
-- C-03. "@Sarah can you bring the oranges" is how a team chat actually
-- works, and a muted channel is exactly where a parent misses it. A
-- mention is the one thing that gets through a mute: a push of its own
-- kind, to the person named, however quiet they keep the channel.
-- @everyone is for hosts only — a parent typing it is just typing — and
-- it reaches the muted too, because a host saying "everyone" means it.
--
-- Names are matched to members by the composer, which asks the channel
-- who is in it (channel_mentionables: names and labels, never a phone);
-- the message carries the ids, so a renamed profile still gets its push.

alter table public.messages
  add column if not exists mentions uuid[] not null default '{}',
  add column if not exists mention_everyone boolean not null default false;

alter table public.notification_queue
  drop constraint if exists notification_queue_kind_check;
alter table public.notification_queue
  add constraint notification_queue_kind_check
  check (kind = any (array[
    'message', 'announcement', 'event_reminder', 'poll_opened', 'poll_closing',
    'rsvp_change', 'invite', 'event_cancelled', 'event_changed', 'event_back_on',
    'rsvp_nudge', 'announcement_repeat', 'wwcc_expiring', 'guardian_erased',
    'official_rego_pending', 'reregister_nudge', 'offer',
    'referee_appointment', 'referee_response', 'referee_withdrawn',
    'fixture_change_proposed', 'fixture_change_answered', 'fixture_change_decided',
    'mention'
  ]));

-- Who can be named here. The same label rule as the sender line (0111),
-- so what the autocomplete shows is what the channel may say.
create or replace function public.channel_mentionables(p_channel uuid)
returns jsonb
language sql stable security definer set search_path = public as $fn$
  select case when not app_private.is_channel_member(p_channel) then '[]'::jsonb
  else coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', p.id,
             'name', p.full_name,
             'label', app_private.channel_member_label(p_channel, p.id)
           ) order by p.full_name)
      from public.channel_members cm
      join public.profiles p on p.id = cm.profile_id
     where cm.channel_id = p_channel and cm.profile_id <> auth.uid() and p.full_name is not null
  ), '[]'::jsonb) end;
$fn$;

-- The message trigger, 0046's body plus mentions: the named get their own
-- push through a mute; @everyone from a host reaches everyone.
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

  -- @everyone only means something from a host.
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
    jsonb_build_object('channel_id', new.channel_id, 'message_id', new.id),
    case
      when new.is_announcement or cm.profile_id = any (new.mentions) or v_everyone then now()
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
    and cm.profile_id <> new.sender_id
    and (not cm.muted or new.is_announcement or cm.profile_id = any (new.mentions) or v_everyone)
    and (cm.profile_id = any (new.mentions) or v_everyone
         or (case when new.is_announcement then us.notify_announcements else us.notify_messages end))
  on conflict (dedupe_key) do nothing;

  return new;
end;
$$;

grant execute on function public.channel_mentionables(uuid) to authenticated;
