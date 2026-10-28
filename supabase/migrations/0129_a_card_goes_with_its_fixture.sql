-- 0129: a coach who posts a fixture can never delete it.
--
-- REPRODUCED, not suspected:
--
--   post a fixture into a team channel  → a card, which is a message with
--                                         an event_id and no body
--   delete the fixture                  → ERROR: new row for relation
--                                         "messages" violates check
--                                         constraint "messages_not_empty"
--
-- `events.id` is referenced by `messages.event_id` with ON DELETE SET NULL,
-- so deleting the event tries to blank the card's only content. A card has
-- no body and no attachments — the event IS the message — so the row becomes
-- empty, `messages_not_empty` refuses it, and the whole delete fails.
--
-- The coach sees a failure with a constraint name in it about a table they
-- did not touch. Nothing tells them the cause is a message they posted three
-- weeks ago, and there is no way for them to work it out.
--
-- Found written down as a workaround inside scripts/refresh-demo.mjs — which
-- deleted the cards itself before deleting events, and said in a comment
-- that this is "a real product bug, not just a seeding one". It was right,
-- and a workaround in a seeding script does nothing for the coach.
--
-- THE CARD GOES WITH THE FIXTURE. A card whose event is gone is not a
-- message anybody can read: it has no text, nothing to open and nothing to
-- say. Keeping it as a tombstone was considered and rejected — a tombstone
-- is for words somebody wrote and then withdrew, and nobody wrote this.
--
-- A message that has a body AND an event — a coach who typed "don't forget
-- your boots" with the fixture attached — keeps its words and simply loses
-- the card. Those are their words, and deleting a fixture is not permission
-- to delete a sentence.

create or replace function public.take_the_card_with_it()
returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  -- Only the cards that would be left with nothing. A message carrying its
  -- own text survives; the FK's ON DELETE SET NULL then clears its event_id
  -- and the text stays, which is what somebody who typed a sentence expects.
  delete from public.messages m
   where m.event_id = old.id
     and nullif(btrim(coalesce(m.body, '')), '') is null
     and coalesce(jsonb_array_length(coalesce(m.attachments, '[]'::jsonb)), 0) = 0;

  return old;
end;
$fn$;

-- BEFORE, so the cards are gone by the time the foreign key tries to blank
-- them. An AFTER trigger runs once the constraint has already refused.
drop trigger if exists events_take_cards on public.events;
create trigger events_take_cards
  before delete on public.events
  for each row execute function public.take_the_card_with_it();
