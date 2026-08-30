-- 0014_indexes.sql
-- Indexes last, once every column exists.
--
-- The rule driving this file: every policy in 0013 filters on academy_id,
-- channel_id or profile_id, so every one of those needs an index. Without
-- them RLS turns into a sequential scan on every read, and the app is fine
-- at three academies and unusable at three hundred.

-- Tenant key on every table.
create index academy_members_academy_idx     on public.academy_members (academy_id);
create index academy_members_profile_idx     on public.academy_members (profile_id);
create index teams_academy_idx               on public.teams (academy_id) where status = 'active';
create index team_members_academy_idx        on public.team_members (academy_id);
create index team_members_profile_idx        on public.team_members (profile_id);
create index team_members_team_idx           on public.team_members (team_id);
create index players_academy_idx             on public.players (academy_id);
create index players_team_idx                on public.players (team_id);
create index players_profile_idx             on public.players (profile_id) where profile_id is not null;
create index player_guardians_profile_idx    on public.player_guardians (profile_id);
create index player_guardians_player_idx     on public.player_guardians (player_id);

create index invites_academy_idx             on public.invites (academy_id);
create index invites_phone_idx               on public.invites (phone) where status = 'pending';
create index invites_invited_by_idx          on public.invites (invited_by);
create index invite_teams_team_idx           on public.invite_teams (team_id);
create index join_links_academy_idx          on public.join_links (academy_id);
create index join_links_team_idx             on public.join_links (team_id);
create index join_link_redemptions_link_idx  on public.join_link_redemptions (link_id);

create index channels_academy_idx            on public.channels (academy_id);
create index channels_team_idx               on public.channels (team_id);
-- Channel list, most recently active first.
create index channels_recent_idx             on public.channels (academy_id, updated_at desc) where status = 'active';
create index channel_members_profile_idx     on public.channel_members (profile_id);
create index channel_members_channel_idx     on public.channel_members (channel_id);
-- Serves "my channels" and the unread count in one shot.
create index channel_members_unread_idx      on public.channel_members (profile_id, channel_id) include (last_read_at, muted);

-- The one that matters most: paging a channel's history.
create index messages_channel_recent_idx     on public.messages (channel_id, created_at desc);
create index messages_academy_idx            on public.messages (academy_id);
create index messages_sender_idx             on public.messages (sender_id);
create index messages_reply_idx              on public.messages (reply_to_id) where reply_to_id is not null;
create index messages_pinned_idx             on public.messages (channel_id, pinned_at desc) where pinned_at is not null;
create index messages_queue_idx              on public.messages (channel_id) where status = 'pending';
-- Unread counts: messages in a channel after my last_read_at.
create index messages_unread_idx             on public.messages (channel_id, created_at) where deleted_at is null and status = 'published';

create index message_reactions_message_idx   on public.message_reactions (message_id);
create index message_reactions_profile_idx   on public.message_reactions (profile_id);
create index deleted_archive_academy_idx     on public.deleted_message_archive (academy_id, purge_after);

-- Calendar: "next 7 days across my teams" is the app's default landing query.
create index events_academy_start_idx        on public.events (academy_id, starts_at) where cancelled_at is null;
create index events_team_start_idx           on public.events (team_id, starts_at) where cancelled_at is null;
create index event_rsvps_event_idx           on public.event_rsvps (event_id);
create index event_rsvps_profile_idx         on public.event_rsvps (profile_id);
create index event_rsvps_player_idx          on public.event_rsvps (player_id) where player_id is not null;

create index polls_channel_idx               on public.polls (channel_id);
create index polls_open_idx                  on public.polls (academy_id, closes_at) where closed_at is null;
create index poll_votes_poll_idx             on public.poll_votes (poll_id);
create index poll_votes_profile_idx          on public.poll_votes (profile_id);

create index push_subscriptions_profile_idx  on public.push_subscriptions (profile_id) where failed_at is null;
create index notification_queue_profile_idx  on public.notification_queue (profile_id, created_at desc);

-- Directory search: case-insensitive name matching without a full scan.
create extension if not exists pg_trgm;
create index profiles_name_trgm_idx          on public.profiles using gin (full_name gin_trgm_ops);
