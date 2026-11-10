-- 0244: a stream's notices, the Committee room and the Team managers' room
-- are kinds of channel.
--
-- Big Club Mode item 4 (Joey, 9 Nov 2026): "Communication layers (each
-- automatic by role/team — nobody adds people by hand). Club Notices
-- (read-only, everyone). Stream / age-group notices (read-only, by team
-- membership). Team chats (exist). Staff rooms: Committee, Coaches, Team
-- managers." On its own because ALTER TYPE ... ADD VALUE cannot run in the
-- same transaction as anything that uses the new label (0212, 0232, 0234
-- are the precedents). 0245 builds the rooms.
alter type public.channel_type add value if not exists 'stream';
alter type public.channel_type add value if not exists 'committee';
alter type public.channel_type add value if not exists 'managers';
