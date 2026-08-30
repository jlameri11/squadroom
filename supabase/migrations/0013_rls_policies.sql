-- 0013_rls_policies.sql
-- Every policy, for every table. RLS was switched on as each table was
-- created, so until this file runs the whole schema is deny-all.
--
-- Convention: helper calls are wrapped as (select fn(...)) so Postgres treats
-- them as an InitPlan and evaluates them once per statement, not once per row.

-- ===========================================================================
-- Tenant root and identity
-- ===========================================================================
create policy academies_select on public.academies for select to authenticated
  using ((select public.is_academy_member(id)) or (select public.is_platform_admin()));

create policy academies_insert on public.academies for insert to authenticated
  with check (created_by = (select auth.uid()));

create policy academies_update on public.academies for update to authenticated
  using ((select public.is_academy_staff(id)))
  with check ((select public.is_academy_staff(id)));

create policy academies_delete on public.academies for delete to authenticated
  using ((select public.is_platform_admin()));

-- Names and avatars are needed on every message bubble, so the row is shared
-- across an academy. The phone column is withheld by grant, not by policy
-- (see 0012).
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or (select public.shares_academy_with(id))
    or (select public.is_platform_admin())
  );

create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy platform_admins_select on public.platform_admins for select to authenticated
  using ((select public.is_platform_admin()));

-- ===========================================================================
-- Membership
-- ===========================================================================
create policy academy_members_select on public.academy_members for select to authenticated
  using ((select public.is_academy_member(academy_id)) or (select public.is_platform_admin()));

create policy academy_members_insert on public.academy_members for insert to authenticated
  with check ((select public.is_academy_staff(academy_id)));

create policy academy_members_update on public.academy_members for update to authenticated
  using ((select public.is_academy_staff(academy_id)))
  with check ((select public.is_academy_staff(academy_id)));

create policy academy_members_delete on public.academy_members for delete to authenticated
  using ((select public.is_academy_staff(academy_id)));

-- ===========================================================================
-- Teams, players, rosters
-- ===========================================================================
create policy teams_select on public.teams for select to authenticated
  using ((select public.is_academy_member(academy_id)));

create policy teams_write on public.teams for all to authenticated
  using ((select public.is_academy_staff(academy_id)))
  with check ((select public.is_academy_staff(academy_id)));

create policy team_members_select on public.team_members for select to authenticated
  using ((select public.is_academy_member(academy_id)));

-- Coaches manage their own team's roster; staff manage any.
create policy team_members_write on public.team_members for all to authenticated
  using ((select public.is_academy_staff(academy_id)) or (select public.is_team_coach(team_id)))
  with check ((select public.is_academy_staff(academy_id)) or (select public.is_team_coach(team_id)));

-- A player is visible to their own team, their guardians, and academy staff.
create policy players_select on public.players for select to authenticated
  using (
    (select public.is_academy_coach(academy_id))
    or (select public.is_guardian_of(id))
    or (team_id is not null and (select public.is_team_member(team_id)))
  );

create policy players_write on public.players for all to authenticated
  using ((select public.is_academy_staff(academy_id))
         or (team_id is not null and (select public.is_team_coach(team_id))))
  with check ((select public.is_academy_staff(academy_id))
         or (team_id is not null and (select public.is_team_coach(team_id))));

create policy player_guardians_select on public.player_guardians for select to authenticated
  using (
    profile_id = (select auth.uid())
    or (select public.is_academy_coach(academy_id))
    or (select public.is_guardian_of(player_id))
  );

create policy player_guardians_write on public.player_guardians for all to authenticated
  using ((select public.is_academy_coach(academy_id)))
  with check ((select public.is_academy_coach(academy_id)));

-- ===========================================================================
-- Invites — the delegation rules live here
-- ===========================================================================
create policy invites_select on public.invites for select to authenticated
  using ((select public.is_academy_coach(academy_id)));

-- Owners/admins may invite any role. Coaches may only bring in parents and
-- players, never another coach or an admin.
create policy invites_insert on public.invites for insert to authenticated
  with check (
    invited_by = (select auth.uid())
    and (
      (select public.is_academy_staff(academy_id))
      or ((select public.is_academy_coach(academy_id)) and role in ('parent', 'player'))
    )
  );

create policy invites_update on public.invites for update to authenticated
  using ((select public.is_academy_staff(academy_id)) or invited_by = (select auth.uid()))
  with check ((select public.is_academy_staff(academy_id)) or invited_by = (select auth.uid()));

-- And this is where "coaches invite to their own teams only" actually bites:
-- an invite is worthless without a team attached, and a coach can only attach
-- a team they coach.
create policy invite_teams_select on public.invite_teams for select to authenticated
  using ((select public.is_academy_coach(academy_id)));

create policy invite_teams_write on public.invite_teams for all to authenticated
  using ((select public.is_academy_staff(academy_id)) or (select public.is_team_coach(team_id)))
  with check ((select public.is_academy_staff(academy_id)) or (select public.is_team_coach(team_id)));

create policy join_links_select on public.join_links for select to authenticated
  using ((select public.is_academy_coach(academy_id)));

create policy join_links_insert on public.join_links for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (
      (select public.is_academy_staff(academy_id))
      or ((select public.is_team_coach(team_id)) and role in ('parent', 'player'))
    )
  );

create policy join_links_update on public.join_links for update to authenticated
  using ((select public.is_academy_staff(academy_id)) or created_by = (select auth.uid()))
  with check ((select public.is_academy_staff(academy_id)) or created_by = (select auth.uid()));

create policy join_link_redemptions_select on public.join_link_redemptions for select to authenticated
  using ((select public.is_academy_coach(academy_id)));
-- Rows are written only by the redemption RPC (security definer). No insert
-- policy, deliberately.

create policy academy_invites_all on public.academy_invites for all to authenticated
  using ((select public.is_platform_admin()))
  with check ((select public.is_platform_admin()));

-- ===========================================================================
-- Channels
-- ===========================================================================
-- Staff can see every channel except a DM, which is nobody else's business.
create policy channels_select on public.channels for select to authenticated
  using (
    (select public.is_channel_member(id))
    or (type <> 'direct' and (select public.is_academy_staff(academy_id)))
  );

create policy channels_insert on public.channels for insert to authenticated
  with check ((select public.is_academy_coach(academy_id)));

create policy channels_update on public.channels for update to authenticated
  using ((select public.is_channel_host(id)))
  with check ((select public.is_channel_host(id)));

create policy channels_delete on public.channels for delete to authenticated
  using (type <> 'direct' and (select public.is_academy_staff(academy_id)));

create policy channel_members_select on public.channel_members for select to authenticated
  using ((select public.is_channel_member(channel_id)) or (select public.is_academy_staff(academy_id)));

-- Only hosts add people. This is the "parents can't add anyone" rule.
create policy channel_members_insert on public.channel_members for insert to authenticated
  with check ((select public.is_channel_host(channel_id)));

-- You may update your own row (mute, last_read_at); a host may update anyone's.
create policy channel_members_update on public.channel_members for update to authenticated
  using (profile_id = (select auth.uid()) or (select public.is_channel_host(channel_id)))
  with check (profile_id = (select auth.uid()) or (select public.is_channel_host(channel_id)));

create policy channel_members_delete on public.channel_members for delete to authenticated
  using (profile_id = (select auth.uid()) or (select public.is_channel_host(channel_id)));

-- ===========================================================================
-- Messages
-- ===========================================================================
-- Queued messages are visible only to their author and the channel's hosts.
create policy messages_select on public.messages for select to authenticated
  using (
    (select public.is_channel_member(channel_id))
    and (
      status = 'published'
      or sender_id = (select auth.uid())
      or (select public.is_channel_host(channel_id))
    )
  );

-- Posting mode, archived seasons and the approval queue, all enforced here.
create policy messages_insert on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and (select public.can_post_in_channel(channel_id, reply_to_id))
    and (not is_announcement or (select public.is_channel_host(channel_id)))
    and (
      case
        when (select public.channel_requires_approval(channel_id))
             and not (select public.is_channel_host(channel_id))
        then status = 'pending'
        else status = 'published'
      end
    )
  );

-- Authors edit and delete their own; hosts pin, approve and moderate.
create policy messages_update on public.messages for update to authenticated
  using (sender_id = (select auth.uid()) or (select public.is_channel_host(channel_id)))
  with check (sender_id = (select auth.uid()) or (select public.is_channel_host(channel_id)));

-- No delete policy: messages are soft-deleted so the archive trigger runs.

-- Owners and admins may read deleted content for the retention window.
create policy deleted_archive_select on public.deleted_message_archive for select to authenticated
  using ((select public.is_academy_staff(academy_id)) and purge_after > now());

-- ===========================================================================
-- Reactions — the one thing a parent can do in a broadcast channel
-- ===========================================================================
-- The base table exposes identity, so it is host-only. Everyone else reads
-- message_reaction_counts.
create policy message_reactions_select on public.message_reactions for select to authenticated
  using (
    profile_id = (select auth.uid())
    or (select public.is_channel_host(public.message_channel(message_id)))
  );

-- Note this checks membership, NOT can_post_in_channel: reacting is exactly
-- what stays available when a channel is set to hosts_only.
create policy message_reactions_insert on public.message_reactions for insert to authenticated
  with check (
    profile_id = (select auth.uid())
    and (select public.is_channel_member(public.message_channel(message_id)))
  );

create policy message_reactions_delete on public.message_reactions for delete to authenticated
  using (profile_id = (select auth.uid()));

-- ===========================================================================
-- Events and RSVPs
-- ===========================================================================
create policy events_select on public.events for select to authenticated
  using (
    (select public.is_academy_member(academy_id))
    and (
      team_id is null
      or (select public.is_team_member(team_id))
      or (select public.is_academy_coach(academy_id))
    )
  );

create policy events_write on public.events for all to authenticated
  using ((select public.is_academy_staff(academy_id))
         or (team_id is not null and (select public.is_team_coach(team_id))))
  with check ((select public.is_academy_staff(academy_id))
         or (team_id is not null and (select public.is_team_coach(team_id))));

-- Coaches see the whole register; a parent sees only their own answers.
create policy event_rsvps_select on public.event_rsvps for select to authenticated
  using (
    profile_id = (select auth.uid())
    or (select public.is_event_coach(event_id))
  );

create policy event_rsvps_insert on public.event_rsvps for insert to authenticated
  with check (
    (select public.can_read_event(event_id))
    and (
      (profile_id = (select auth.uid())
       and (player_id is null or (select public.is_guardian_of(player_id))))
      or (select public.is_event_coach(event_id))
    )
  );

create policy event_rsvps_update on public.event_rsvps for update to authenticated
  using (profile_id = (select auth.uid()) or (select public.is_event_coach(event_id)))
  with check (profile_id = (select auth.uid()) or (select public.is_event_coach(event_id)));

create policy event_rsvps_delete on public.event_rsvps for delete to authenticated
  using (profile_id = (select auth.uid()) or (select public.is_event_coach(event_id)));

-- ===========================================================================
-- Polls
-- ===========================================================================
create policy polls_select on public.polls for select to authenticated
  using ((select public.is_channel_member(channel_id)));

create policy polls_insert on public.polls for insert to authenticated
  with check (created_by = (select auth.uid()) and (select public.is_channel_host(channel_id)));

create policy polls_update on public.polls for update to authenticated
  using ((select public.is_channel_host(channel_id)))
  with check ((select public.is_channel_host(channel_id)));

-- An anonymous poll is anonymous to the host too. Tallies come from
-- poll_vote_counts either way.
create policy poll_votes_select on public.poll_votes for select to authenticated
  using (
    profile_id = (select auth.uid())
    or (
      (select public.is_channel_host(public.poll_channel(poll_id)))
      and not (select public.poll_is_anonymous(poll_id))
    )
  );

create policy poll_votes_insert on public.poll_votes for insert to authenticated
  with check (
    profile_id = (select auth.uid())
    and (select public.is_channel_member(public.poll_channel(poll_id)))
    and (select public.poll_is_open(poll_id))
    and (player_id is null or (select public.is_guardian_of(player_id)))
  );

create policy poll_votes_update on public.poll_votes for update to authenticated
  using (profile_id = (select auth.uid()) and (select public.poll_is_open(poll_id)))
  with check (profile_id = (select auth.uid()) and (select public.poll_is_open(poll_id)));

create policy poll_votes_delete on public.poll_votes for delete to authenticated
  using (profile_id = (select auth.uid()) and (select public.poll_is_open(poll_id)));

-- ===========================================================================
-- Personal
-- ===========================================================================
create policy user_settings_all on public.user_settings for all to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

create policy push_subscriptions_all on public.push_subscriptions for all to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

-- Readable so the app can show what it is about to send; written only by the
-- queue's own security-definer functions.
create policy notification_queue_select on public.notification_queue for select to authenticated
  using (profile_id = (select auth.uid()));

-- ===========================================================================
-- Grants for the owner-rights count views
-- ===========================================================================
grant select on public.message_reaction_counts to authenticated;
grant select on public.poll_vote_counts to authenticated;
