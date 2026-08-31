-- 0036_allow_event_only_messages.sql
--
-- messages_not_empty existed to stop blank messages, and it was right to
-- refuse an event card: at the time, a message with no body and no
-- attachments genuinely was empty.
--
-- 0035 introduced a third kind of content and did not widen the definition,
-- so posting a fixture failed on a constraint rather than silently creating
-- an invisible row. That is the constraint doing exactly its job.

alter table public.messages drop constraint messages_not_empty;

alter table public.messages add constraint messages_not_empty check (
  deleted_at is not null
  or length(btrim(coalesce(body, ''))) > 0
  or jsonb_array_length(attachments) > 0
  or event_id is not null
);
