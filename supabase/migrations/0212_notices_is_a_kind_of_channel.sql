-- 0212: a competition's Notices are a kind of channel (Joey, 5 Nov 2026).
--
-- Added on its own because ALTER TYPE ... ADD VALUE cannot run in the same
-- transaction as anything that then uses the new label (0073a is the
-- precedent). 0213 builds the channel itself.
alter type public.channel_type add value if not exists 'notices';
