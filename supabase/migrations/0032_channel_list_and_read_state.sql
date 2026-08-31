-- 0032_channel_list_and_read_state.sql
--
-- The channel list is the screen people open forty times a day, so it is one
-- query rather than one per channel plus one per unread count.

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
language sql stable security definer set search_path = public as $$
  select
    c.id, c.name, c.type, c.team_id, c.posting_mode, c.status,
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
    lm.created_at,
    -- A deleted message still occupies the preview slot; showing its body
    -- there would undo the deletion in the one place everyone looks.
    case when lm.deleted_at is not null then null else lm.body end,
    p.full_name
  from public.channel_members cm
  join public.channels c on c.id = cm.channel_id
  left join lateral (
    select m.body, m.created_at, m.sender_id, m.deleted_at
      from public.messages m
     where m.channel_id = c.id and m.status = 'published'
     order by m.created_at desc
     limit 1
  ) lm on true
  left join public.profiles p on p.id = lm.sender_id
  where cm.profile_id = auth.uid()
    and c.academy_id = p_academy
  order by (c.status = 'archived'), lm.created_at desc nulls last, c.name;
$$;

grant execute on function public.my_channels(uuid) to authenticated;

-- Refuses to move the marker backwards: two devices open at once should not
-- resurrect unreads on the one you are actually looking at.
create or replace function public.mark_channel_read(p_channel uuid)
returns void
language sql security definer set search_path = public as $$
  update public.channel_members
     set last_read_at = now()
   where channel_id = p_channel
     and profile_id = auth.uid()
     and last_read_at < now();
$$;

grant execute on function public.mark_channel_read(uuid) to authenticated;

-- Messages with sender details, newest first for paging. Exists so the client
-- does not join profiles itself, and so a tombstone is shaped in one place.
create or replace function public.channel_messages(
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
  reply_to_id  uuid,
  reply_to_body text,
  reply_to_name text,
  is_announcement boolean,
  pinned_at    timestamptz,
  created_at   timestamptz,
  edited_at    timestamptz,
  deleted_at   timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    m.id,
    case when m.deleted_at is not null then null else m.body end,
    case when m.deleted_at is not null then '[]'::jsonb else m.attachments end,
    m.sender_id, p.full_name, am.role,
    m.reply_to_id,
    case when r.deleted_at is not null then null else r.body end,
    rp.full_name,
    m.is_announcement, m.pinned_at, m.created_at, m.edited_at, m.deleted_at
  from public.messages m
  join public.channels c on c.id = m.channel_id
  left join public.profiles p on p.id = m.sender_id
  left join public.academy_members am on am.profile_id = m.sender_id and am.academy_id = c.academy_id
  left join public.messages r on r.id = m.reply_to_id
  left join public.profiles rp on rp.id = r.sender_id
  where m.channel_id = p_channel
    and app_private.is_channel_member(p_channel)
    and m.status = 'published'
    and (p_before is null or m.created_at < p_before)
  order by m.created_at desc
  limit least(coalesce(p_limit, 50), 100);
$$;

grant execute on function public.channel_messages(uuid, timestamptz, integer) to authenticated;
