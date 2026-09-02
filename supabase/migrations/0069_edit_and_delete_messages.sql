-- 0069: editing and deleting a message.
--
-- The columns have existed since 0006 and the policy has always allowed a
-- sender or a host to update — there was simply no way to do it, which in a
-- product replacing a WhatsApp group is a conspicuous hole. Everyone expects
-- to be able to unsend a message sent to the wrong channel.
--
-- Two rules the interface cannot be trusted to enforce on its own:
--
-- 1. AN EDIT IS MARKED AS ONE. Silently rewriting what somebody said in a
--    channel full of arrangements is how "kick-off is 9am" becomes "kick-off
--    is 10am" with no trace and two families at the wrong ground. The trigger
--    stamps edited_at; the interface shows it.
--
-- 2. A HOST MAY REMOVE, BUT NOT REWRITE. Moderating a channel means being
--    able to take something down. It does not mean being able to put words in
--    a parent's mouth, and the difference matters enormously in a room full
--    of other people's children.

create or replace function app_private.guard_message_edit()
returns trigger
language plpgsql
security definer
set search_path = public as $fn$
begin
  -- Only the author may change the words. A host reaching in and altering
  -- the body would be indistinguishable, afterwards, from the parent having
  -- written it.
  if new.body is distinct from old.body and new.sender_id <> auth.uid() then
    raise exception 'only the author can change a message. You can delete it instead.'
      using errcode = '42501';
  end if;

  -- An edit is always visible as one, whatever the client sends.
  if new.body is distinct from old.body and old.deleted_at is null then
    new.edited_at := now();
  end if;

  -- Deleting is one-way. Un-deleting would make the archive a lie.
  if old.deleted_at is not null then
    new.deleted_at := old.deleted_at;
  end if;

  -- An edit must not turn an ordinary message into an announcement, which
  -- bypasses mutes and quiet hours.
  if new.is_announcement and not old.is_announcement then
    raise exception 'a message cannot become an announcement after it is sent'
      using errcode = '42501';
  end if;

  return new;
end;
$fn$;

drop trigger if exists messages_guard_edit on public.messages;
create trigger messages_guard_edit
  before update on public.messages
  for each row
  when (old.deleted_at is null or new.deleted_at is not null)
  execute function app_private.guard_message_edit();
