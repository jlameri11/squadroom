-- 0088: a second way for a live message to arrive, because the first one
-- drops about one in five.
--
-- MEASURED, not suspected. test-chat's realtime step failed roughly one run in
-- three. A fresh subscription delivered 16 out of 16, filtered and unfiltered,
-- and an aged, busy client delivered 6 out of 6 — so the app's own pattern is
-- sound in isolation. Inside the full suite it still misses, with the message
-- written and simply never delivered. Closing the sockets each suite leaks
-- helped and did not fix it: 4 of 5.
--
-- CLAUDE.md already called this: postgres_changes "does not scale — it
-- re-evaluates RLS per subscriber per change" and has to be swapped for
-- broadcast-from-trigger "before roughly the twentieth academy". This is that
-- weakness arriving early, on one academy, in a test. A chat that silently
-- loses one live message in five is not a chat anybody would describe as
-- better than WhatsApp.
--
-- WHY BOTH, AND NOT A SWAP. Chat is the most-used screen in the product and I
-- cannot click through it by hand. Replacing its transport outright risks
-- trading an intermittent fault for a total one. So the broadcast runs
-- ALONGSIDE postgres_changes and the hook takes whichever arrives first,
-- deduplicating by message id. Delivery then needs only one of two
-- independent paths to work, which is strictly better than either alone.
--
-- Once this has run for a while and the broadcast proves reliable,
-- postgres_changes comes out and takes its per-subscriber RLS cost with it.
-- That is the step this makes safe, rather than the step itself.
--
-- WHAT IS SENT. The message id and the channel, and nothing else — not the
-- body, not the sender's name. A broadcast topic is a weaker boundary than a
-- table policy: `realtime.send` with private = true requires authorisation to
-- read the topic, but the payload is not row-level-security-filtered the way a
-- select is. So the broadcast is a NUDGE, and the client fetches the message
-- through channel_messages, which is the same policy-checked path it already
-- uses. Nobody learns anything from the nudge they could not already learn
-- from knowing a channel exists.

create or replace function public.broadcast_new_message()
returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  -- Only published messages. A draft or a moderated one is not an event
  -- anybody should be told about.
  if new.status is distinct from 'published' then
    return new;
  end if;

  perform realtime.send(
    jsonb_build_object(
      'id', new.id,
      'channel_id', new.channel_id,
      -- So a client can ignore its own echo without waiting for the fetch.
      'sender_id', new.sender_id
    ),
    'new_message',
    'channel:' || new.channel_id::text,
    -- Private: a subscriber must be authorised for the topic. Without this
    -- anyone who guessed a channel id would learn when it was busy.
    true
  );

  return new;
end;
$fn$;

drop trigger if exists messages_broadcast on public.messages;
create trigger messages_broadcast
  after insert on public.messages
  for each row execute function public.broadcast_new_message();

/**
 * Who may listen to a channel's broadcast topic.
 *
 * `realtime.messages` is the table Realtime checks for broadcast
 * authorisation, and with no policy on it a private topic is readable by
 * nobody — the broadcast would be sent and never arrive, which is the same
 * silence this migration exists to remove.
 *
 * The rule is the one that already governs the channel: its members, and
 * nobody else. Written against the existing helper so it cannot drift from
 * the policy on `messages` itself.
 */
-- RLS is already enabled on realtime.messages and the table is owned by
-- supabase_realtime_admin, so it cannot be altered from here — and does not
-- need to be. What it has no policies at all, which is why a private topic
-- currently reaches nobody.
drop policy if exists channel_members_may_listen on realtime.messages;
create policy channel_members_may_listen on realtime.messages
  for select to authenticated
  using (
    -- topic is 'channel:<uuid>'; anything else is not ours to allow.
    topic like 'channel:%'
    and (
      select app_private.is_channel_member(
        substring(topic from 9)::uuid
      )
    )
  );
