-- A chat that is not a team, an age group, the coaches or the whole academy
-- needs a type of its own. Added separately because ALTER TYPE ... ADD VALUE
-- cannot run in the same transaction as something that then uses the label.
alter type public.channel_type add value if not exists 'custom';
