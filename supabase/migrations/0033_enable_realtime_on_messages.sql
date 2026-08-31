-- 0033_enable_realtime_on_messages.sql
--
-- Realtime is opt-in per table, and nothing had opted in. Subscribing to
-- postgres_changes on a table outside the publication does not error - it
-- succeeds and then delivers nothing. Chat would have looked perfect to
-- whoever sent a message and stayed frozen for everyone else, which is the
-- worst kind of bug to ship: invisible to the person testing it.
--
-- RLS still applies to realtime, so a subscriber only receives rows they
-- could have selected anyway.

alter publication supabase_realtime add table public.messages;

-- Reactions are deliberately NOT added.
--
-- They carry no channel_id, so a client could only filter by academy - every
-- reaction in the academy pushed to every member, to update a number on one
-- screen. The counts are read when a message renders instead.
--
-- The fix for both is the same and is already planned: broadcast from a
-- trigger, on a channel-scoped topic, which sends one small payload to
-- exactly the people in that channel. Do it with the postgres_changes swap.
