-- 0234: a competition's Clubs chat and a league's Referees chat are kinds of channel.
--
-- Joey, 9 Nov 2026: the organiser groups, and "Academy vs league organiser"
-- items 2–3. On its own because ALTER TYPE ... ADD VALUE cannot run in the
-- same transaction as anything that then uses the new label (0212 is the
-- precedent). 0235 builds the channels themselves.
alter type public.channel_type add value if not exists 'clubs';
alter type public.channel_type add value if not exists 'referees';
