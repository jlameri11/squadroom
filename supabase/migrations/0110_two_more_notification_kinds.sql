-- 0110: the two kinds 0109 sends.
--
-- `notification_queue.kind` is a fixed list, and 0109 inserts 'rsvp_nudge'
-- and 'announcement_repeat' without adding them to it — so every nudge failed
-- the check constraint. Caught by the test on its second assertion.
--
-- The constraint is doing its job. A free-text kind would have let the typo
-- through and the sender would have skipped the rows silently, which is a
-- worse day than a failed insert.
--
-- They are separate kinds rather than reusing 'event_reminder' and
-- 'announcement' because the sender and the settings screen both read this
-- column: a person who has turned event reminders off should not be nudged,
-- and somebody later building per-kind preferences needs to be able to tell a
-- coach's chase from the automatic 24-hour reminder.

alter table public.notification_queue
  drop constraint if exists notification_queue_kind_check;

alter table public.notification_queue
  add constraint notification_queue_kind_check
  check (kind = any (array[
    'message',
    'announcement',
    'event_reminder',
    'poll_opened',
    'poll_closing',
    'rsvp_change',
    'invite',
    'event_cancelled',
    'event_changed',
    'event_back_on',
    -- 0109: a coach chasing the families who have not answered a fixture.
    'rsvp_nudge',
    -- 0109: a coach chasing the people who have not opened an announcement.
    'announcement_repeat'
  ]));
