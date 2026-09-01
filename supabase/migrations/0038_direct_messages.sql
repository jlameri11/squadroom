-- 0038_direct_messages.sql
--
-- Opening a DM is a function rather than an insert, because it has to enforce
-- the academy's dm_policy - and the default is staff_only. In a product about
-- children, parent-to-parent private messaging is off unless an academy
-- deliberately turns it on, and that decision must not be bypassable by a
-- client that simply inserts a channel row itself.

create or replace function public.open_direct_channel(
  p_academy uuid,
  p_other   uuid
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me     uuid := auth.uid();
  v_key    text;
  v_id     uuid;
  v_policy public.dm_policy;
  v_me_staff    boolean;
  v_other_staff boolean;
begin
  if v_me is null then
    raise exception 'must be signed in' using errcode = '42501';
  end if;
  if p_other = v_me then
    raise exception 'you cannot message yourself' using errcode = '22023';
  end if;

  if not app_private.is_academy_member(p_academy) then
    raise exception 'not a member of this academy' using errcode = '42501';
  end if;

  -- The other person must be in the same academy. Otherwise this becomes a
  -- way to message anyone whose id you happen to learn.
  if not exists (
    select 1 from public.academy_members
     where academy_id = p_academy and profile_id = p_other and status = 'active'
  ) then
    raise exception 'that person is not in this academy' using errcode = '22023';
  end if;

  select dm_policy into v_policy from public.academies where id = p_academy;

  select role in ('owner','admin','coach') into v_me_staff
    from public.academy_members where academy_id = p_academy and profile_id = v_me;
  select role in ('owner','admin','coach') into v_other_staff
    from public.academy_members where academy_id = p_academy and profile_id = p_other;

  -- staff_only means at least one end of the conversation is staff. Two
  -- parents cannot open one; a parent and their coach can.
  if v_policy = 'staff_only' and not (coalesce(v_me_staff,false) or coalesce(v_other_staff,false)) then
    raise exception 'this academy does not allow parents to message each other directly'
      using errcode = '42501';
  end if;

  v_key := least(v_me::text, p_other::text) || ':' || greatest(v_me::text, p_other::text);

  select id into v_id from public.channels
   where academy_id = p_academy and type = 'direct' and dm_key = v_key;

  if v_id is null then
    insert into public.channels (academy_id, type, dm_key, name, created_by)
    values (p_academy, 'direct', v_key, null, v_me)
    returning id into v_id;

    insert into public.channel_members (academy_id, channel_id, profile_id, role)
    values (p_academy, v_id, v_me, 'member'), (p_academy, v_id, p_other, 'member');
  end if;

  return v_id;
end;
$$;

revoke execute on function public.open_direct_channel(uuid, uuid) from public, anon;
grant execute on function public.open_direct_channel(uuid, uuid) to authenticated;

-- A direct channel has no name, so the list has to work out whose it is.
-- Doing that in the client means fetching the members of every DM to render
-- one row each.
drop function if exists public.my_channels(uuid);

create function public.my_channels(p_academy uuid)
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
    lm.created_at,
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
  -- The other person in a DM, for its name.
  left join lateral (
    select pr.full_name
      from public.channel_members other
      join public.profiles pr on pr.id = other.profile_id
     where c.type = 'direct'
       and other.channel_id = c.id
       and other.profile_id <> auth.uid()
     limit 1
  ) dm on true
  where cm.profile_id = auth.uid()
    and c.academy_id = p_academy
  order by (c.status = 'archived'), lm.created_at desc nulls last, coalesce(c.name, dm.full_name);
$$;

grant execute on function public.my_channels(uuid) to authenticated;
