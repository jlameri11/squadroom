-- 0070: the edit guard has to know a deletion when it sees one.
--
-- 0069 refused every host removal, and the reason is trigger ordering.
-- Postgres fires BEFORE UPDATE triggers alphabetically:
-- messages_archive_on_delete runs first and, having copied the message to the
-- archive, sets new.body := null. By the time messages_guard_edit ran, a host
-- deleting a parent's message looked exactly like a host rewriting one, and
-- the guard did its job on the wrong facts.
--
-- Two triggers, each correct alone, wrong together. The test caught it; a
-- coach would have caught it on a Saturday.
--
-- Also fixes the WHEN clause. It read
--   when (old.deleted_at is null or new.deleted_at is not null)
-- which is false for exactly one case - setting deleted_at back to null - so
-- the trigger meant to make deletion one-way was skipped for the only update
-- that could undo it.

create or replace function app_private.guard_message_edit()
returns trigger
language plpgsql
security definer
set search_path = public as $fn$
declare
  v_deleting boolean := old.deleted_at is null and new.deleted_at is not null;
begin
  -- A deletion, not an edit. RLS has already established this is the author
  -- or a host, and archive_deleted_message has blanked the body on its way
  -- past - which is why the body check below must not see it.
  if v_deleting then
    return new;
  end if;

  -- Deleting is one way. Un-deleting would make the archive a lie about what
  -- is still visible.
  if old.deleted_at is not null then
    new.deleted_at := old.deleted_at;
    new.body := old.body;
    new.attachments := old.attachments;
    return new;
  end if;

  -- Only the author may change the words. A host moderating a channel can
  -- take a message down; putting words in a parent's mouth is a different
  -- thing entirely, and in a room full of other people's children the
  -- difference matters.
  if new.body is distinct from old.body and new.sender_id <> auth.uid() then
    raise exception 'only the author can change a message. You can delete it instead.'
      using errcode = '42501';
  end if;

  -- An edit is always visible as one, whatever the client sends. Silently
  -- rewriting "kick-off is 9am" to "10am" is how two families end up at an
  -- empty ground.
  if new.body is distinct from old.body then
    new.edited_at := now();
  end if;

  -- An edit must not promote a message to an announcement, which bypasses
  -- mutes and quiet hours.
  if new.is_announcement and not old.is_announcement then
    raise exception 'a message cannot become an announcement after it is sent'
      using errcode = '42501';
  end if;

  return new;
end;
$fn$;

drop trigger if exists messages_guard_edit on public.messages;

-- No WHEN clause. The one it had excluded the un-delete case, which is the
-- single update this most needs to see.
create trigger messages_guard_edit
  before update on public.messages
  for each row execute function app_private.guard_message_edit();
