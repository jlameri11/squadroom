-- 0039_approval_queue_integrity.sql
--
-- The approval queue did nothing.
--
-- messages_insert correctly forced status = 'pending' for a non-host in a
-- channel with approval_required. But messages_update allows an author to
-- edit their own message, and status is just a column - so a parent could
-- post, then immediately update their own row to 'published'. Verified
-- against the live database before writing this: it worked.
--
-- RLS cannot express "you may change these columns but not that one", and
-- WITH CHECK sees only the new row, so it cannot tell an unchanged status
-- from a changed one. A trigger can see both.

create or replace function public.guard_message_moderation()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_is_host boolean := app_private.is_channel_host(new.channel_id);
begin
  -- Only a host moves a message between pending, published and rejected.
  if new.status is distinct from old.status and not v_is_host then
    raise exception 'only a host can approve or reject a message'
      using errcode = '42501';
  end if;

  -- Nor can an author promote themselves to announcement after the fact,
  -- which the insert policy already refuses at the point of writing.
  if new.is_announcement is distinct from old.is_announcement and not v_is_host then
    raise exception 'only a host can post an announcement' using errcode = '42501';
  end if;

  -- Pinning is a host action too.
  if new.pinned_at is distinct from old.pinned_at and not v_is_host then
    raise exception 'only a host can pin a message' using errcode = '42501';
  end if;

  -- Record who approved it, rather than trusting the client to say.
  if new.status = 'published' and old.status = 'pending' then
    new.approved_by := auth.uid();
    new.approved_at := now();
  end if;

  -- Editing marks the message as edited. Silently changing what somebody
  -- said, with no trace, is not something this app should allow.
  if new.body is distinct from old.body and new.deleted_at is null and old.deleted_at is null then
    new.edited_at := now();
  end if;

  return new;
end;
$$;

create trigger messages_guard_moderation
  before update on public.messages
  for each row execute function public.guard_message_moderation();

-- What a host needs to clear the queue.
create or replace function public.pending_messages(p_channel uuid)
returns table (
  id          uuid,
  body        text,
  attachments jsonb,
  sender_id   uuid,
  sender_name text,
  created_at  timestamptz
)
language sql stable security definer set search_path = public as $$
  select m.id, m.body, m.attachments, m.sender_id, p.full_name, m.created_at
    from public.messages m
    left join public.profiles p on p.id = m.sender_id
   where m.channel_id = p_channel
     and m.status = 'pending'
     and app_private.is_channel_host(p_channel)
   order by m.created_at;
$$;

grant execute on function public.pending_messages(uuid) to authenticated;
