-- 0180: a fourth message status.
--
-- 'scheduled' joins published / pending / rejected. On its own, because
-- Postgres refuses to USE a new enum value in the transaction that added
-- it; 0181 is the feature.
alter type public.message_status add value if not exists 'scheduled';
