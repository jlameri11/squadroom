-- 0181: send it Thursday at seven.
--
-- C-04. A coach writes the Thursday reminder on Tuesday night and wants
-- it to land on Thursday at seven, not now. A scheduled message is a
-- message row with status 'scheduled' and a send time: the sender's alone
-- until it goes — not in the feed, not readable by anyone else (not even
-- a host), no push, not counted anywhere. A minute-by-minute publisher
-- turns it into an ordinary message at its time, with its send time as
-- its time, through the same triggers a message sent now goes through:
-- broadcast, channel touch, pushes, mentions, mutes. Cancel or move it
-- before then. The posting rules are the ones for sending now: a parent
-- in a hosts-only channel cannot schedule round them, and a channel that
-- approves posts approves these when they arrive.

alter table public.messages add column if not exists scheduled_for timestamptz;
create index if not exists messages_scheduled_idx on public.messages (scheduled_for) where status = 'scheduled';

-- Not even a host reads another person's scheduled message.
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select to authenticated
  using (
    (select app_private.is_channel_member(channel_id))
    and (
      status = 'published'
      or sender_id = (select auth.uid())
      or ((select app_private.is_channel_host(channel_id)) and status <> 'scheduled')
    )
  );

-- Scheduling goes through schedule_message, never a direct insert.
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and status <> 'scheduled'
    and (select app_private.can_post_in_channel(channel_id, reply_to_id))
    and (not is_announcement or (select app_private.is_channel_host(channel_id)))
    and (
      case
        when (select app_private.channel_requires_approval(channel_id))
             and not (select app_private.is_channel_host(channel_id))
        then status = 'pending'
        else status = 'published'
      end
    )
  );

-- The moderation guard lets the publisher through, and nobody else.
create or replace function public.guard_message_moderation()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_is_host boolean := app_private.is_channel_host(new.channel_id);
  v_publishing boolean := coalesce(current_setting('app.publishing', true), '') = 'on';
begin
  if new.status is distinct from old.status and not v_is_host and not v_publishing then
    raise exception 'only a host can approve or reject a message'
      using errcode = '42501';
  end if;

  if new.is_announcement is distinct from old.is_announcement and not v_is_host then
    raise exception 'only a host can post an announcement' using errcode = '42501';
  end if;

  if new.pinned_at is distinct from old.pinned_at and not v_is_host then
    raise exception 'only a host can pin a message' using errcode = '42501';
  end if;

  if new.status = 'published' and old.status = 'pending' then
    new.approved_by := auth.uid();
    new.approved_at := now();
  end if;

  if new.body is distinct from old.body and new.deleted_at is null and old.deleted_at is null then
    new.edited_at := now();
  end if;

  return new;
end;
$$;

create or replace function public.schedule_message(p_channel uuid, p_body text, p_at timestamptz, p_announcement boolean default false)
returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  v_academy uuid;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_body, ''))) = 0 then raise exception 'nothing to send' using errcode = '22023'; end if;
  if p_at is null or p_at <= now() then raise exception 'pick a time that has not happened yet' using errcode = '22023'; end if;
  if p_at > now() + interval '90 days' then raise exception 'ninety days is far enough ahead' using errcode = '22023'; end if;
  -- The same rules as sending now.
  if not app_private.can_post_in_channel(p_channel, null) then
    raise exception 'you cannot post in this channel' using errcode = '42501';
  end if;
  if p_announcement and not app_private.is_channel_host(p_channel) then
    raise exception 'only a host sends an announcement' using errcode = '42501';
  end if;
  select academy_id into v_academy from public.channels where id = p_channel;
  insert into public.messages (academy_id, channel_id, sender_id, body, status, is_announcement, scheduled_for)
  values (v_academy, p_channel, auth.uid(), btrim(p_body), 'scheduled', p_announcement, p_at)
  returning id into v_id;
  return v_id;
end;
$fn$;

create or replace function public.my_scheduled_messages(p_channel uuid)
returns jsonb
language sql stable security definer set search_path = public as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'body', m.body, 'is_announcement', m.is_announcement, 'scheduled_for', m.scheduled_for) order by m.scheduled_for), '[]'::jsonb)
    from public.messages m
   where m.channel_id = p_channel and m.sender_id = auth.uid() and m.status = 'scheduled';
$fn$;

create or replace function public.cancel_scheduled_message(p_message uuid)
returns void
language plpgsql security definer set search_path = public as $fn$
begin
  delete from public.messages where id = p_message and sender_id = auth.uid() and status = 'scheduled';
  if not found then raise exception 'that is not a scheduled message of yours' using errcode = '42501'; end if;
end;
$fn$;

create or replace function public.reschedule_message(p_message uuid, p_at timestamptz, p_body text default null)
returns void
language plpgsql security definer set search_path = public as $fn$
begin
  if p_at is null or p_at <= now() then raise exception 'pick a time that has not happened yet' using errcode = '22023'; end if;
  update public.messages
     set scheduled_for = p_at,
         body = coalesce(nullif(btrim(coalesce(p_body, '')), ''), body)
   where id = p_message and sender_id = auth.uid() and status = 'scheduled';
  if not found then raise exception 'that is not a scheduled message of yours' using errcode = '42501'; end if;
  -- Changing the text before it is sent is writing, not editing.
  update public.messages set edited_at = null where id = p_message;
end;
$fn$;

-- The publisher. Each due message becomes a message sent now, at now; a
-- channel that approves posts gets it as pending from a non-host.
create or replace function public.publish_scheduled_messages()
returns integer
language plpgsql security definer set search_path = public as $fn$
declare
  r record;
  v_n integer := 0;
  v_status public.message_status;
begin
  perform set_config('app.publishing', 'on', true);
  for r in select m.id, m.channel_id, m.sender_id from public.messages m where m.status = 'scheduled' and m.scheduled_for <= now() order by m.scheduled_for loop
    v_status := case
      when app_private.channel_requires_approval(r.channel_id)
           and not exists (select 1 from public.channel_members cm where cm.channel_id = r.channel_id and cm.profile_id = r.sender_id and cm.role = 'host')
      then 'pending' else 'published' end;
    update public.messages set status = v_status, created_at = now() where id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$fn$;

-- The after-insert triggers, once more for the moment a scheduled message goes.
drop trigger if exists messages_notify_on_publish on public.messages;
create trigger messages_notify_on_publish
  after update of status on public.messages
  for each row when (old.status = 'scheduled' and new.status = 'published')
  execute function public.enqueue_message_notification();
drop trigger if exists messages_broadcast_on_publish on public.messages;
create trigger messages_broadcast_on_publish
  after update of status on public.messages
  for each row when (old.status = 'scheduled' and new.status in ('published', 'pending'))
  execute function public.broadcast_new_message();
drop trigger if exists messages_touch_channel_on_publish on public.messages;
create trigger messages_touch_channel_on_publish
  after update of status on public.messages
  for each row when (old.status = 'scheduled' and new.status = 'published')
  execute function public.touch_channel_on_message();

revoke execute on function public.publish_scheduled_messages() from public, anon, authenticated;
grant execute on function public.publish_scheduled_messages() to service_role;
grant execute on function public.schedule_message(uuid, text, timestamptz, boolean) to authenticated;
grant execute on function public.my_scheduled_messages(uuid) to authenticated;
grant execute on function public.cancel_scheduled_message(uuid) to authenticated;
grant execute on function public.reschedule_message(uuid, timestamptz, text) to authenticated;

select cron.schedule(
  'publish-scheduled-messages',
  '* * * * *',
  $cron$select public.publish_scheduled_messages()$cron$
);
