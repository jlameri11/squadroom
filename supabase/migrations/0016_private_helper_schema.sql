-- 0016_private_helper_schema.sql
-- Move every RLS helper out of `public`.
--
-- Why: Supabase publishes each function in the `public` schema as a REST
-- endpoint, so all 21 helpers were callable at /rest/v1/rpc/<name> — by the
-- anon role, before anyone logs in. The obvious fix, revoking EXECUTE, does
-- not work: an RLS policy expression IS permission-checked against the calling
-- role, so revoking EXECUTE from `authenticated` makes every policy fail.
-- (I tested that assumption wrongly the first time — the revoke appeared
-- harmless only because the privilege was still arriving via PUBLIC.)
--
-- The fix that actually holds: put the helpers in a schema PostgREST does not
-- expose. `authenticated` keeps USAGE and EXECUTE, so policies keep working,
-- but there is no HTTP route to any of them.
--
-- Only four functions stay in `public`, because they are the deliberate API:
-- member_directory, get_reaction_voters, reaction_counts, poll_counts. Each
-- performs its own authorisation check.

create schema if not exists app_private;
grant usage on schema app_private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. The helpers, in their new home
-- ---------------------------------------------------------------------------
create or replace function app_private.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where profile_id = auth.uid());
$$;

create or replace function app_private.is_academy_member(p_academy uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.academy_members
     where academy_id = p_academy
       and profile_id = auth.uid()
       and status = 'active'
  );
$$;

create or replace function app_private.academy_role_of(p_academy uuid)
returns public.academy_role language sql stable security definer set search_path = public as $$
  select role from public.academy_members
   where academy_id = p_academy and profile_id = auth.uid() and status = 'active';
$$;

-- Owners and admins.
create or replace function app_private.is_academy_staff(p_academy uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select app_private.academy_role_of(p_academy) in ('owner', 'admin');
$$;

-- Owners, admins and coaches — anyone who may create events or invite.
create or replace function app_private.is_academy_coach(p_academy uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select app_private.academy_role_of(p_academy) in ('owner', 'admin', 'coach');
$$;

create or replace function app_private.my_academy_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select academy_id from public.academy_members
   where profile_id = auth.uid() and status = 'active';
$$;

-- Do I share an academy with this person? Gates seeing their name at all.
create or replace function app_private.shares_academy_with(p_profile uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.academy_members mine
      join public.academy_members theirs on theirs.academy_id = mine.academy_id
     where mine.profile_id = auth.uid() and mine.status = 'active'
       and theirs.profile_id = p_profile and theirs.status = 'active'
  );
$$;

-- ---------------------------------------------------------------------------
-- Teams and players
-- ---------------------------------------------------------------------------
create or replace function app_private.is_team_coach(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.team_members
     where team_id = p_team and profile_id = auth.uid() and role = 'coach'
  ) or exists (
    select 1 from public.teams t
     where t.id = p_team and app_private.is_academy_staff(t.academy_id)
  );
$$;

create or replace function app_private.is_team_member(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.team_members
     where team_id = p_team and profile_id = auth.uid()
  );
$$;

create or replace function app_private.is_guardian_of(p_player uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.player_guardians
     where player_id = p_player and profile_id = auth.uid()
  ) or exists (
    -- A 16+ player answering for themselves.
    select 1 from public.players where id = p_player and profile_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Channels
-- ---------------------------------------------------------------------------
create or replace function app_private.is_channel_member(p_channel uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.channel_members
     where channel_id = p_channel and profile_id = auth.uid()
  );
$$;

-- Hosts and co-hosts, plus academy owners/admins who always have the keys.
create or replace function app_private.is_channel_host(p_channel uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.channel_members
     where channel_id = p_channel
       and profile_id = auth.uid()
       and role in ('host', 'co_host')
  ) or exists (
    select 1 from public.channels c
     where c.id = p_channel
       and c.type <> 'direct'          -- nobody is a host of someone else's DM
       and app_private.is_academy_staff(c.academy_id)
  );
$$;

-- The posting-mode rule, enforced here rather than trusted to the UI.
create or replace function app_private.can_post_in_channel(
  p_channel  uuid,
  p_reply_to uuid default null
) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  c public.channels%rowtype;
begin
  select * into c from public.channels where id = p_channel;

  if c.id is null or c.status <> 'active' then
    return false;                       -- archived seasons are read-only
  end if;

  if not app_private.is_channel_member(p_channel) then
    return false;
  end if;

  if app_private.is_channel_host(p_channel) then
    return true;
  end if;

  return case c.posting_mode
    when 'open'         then true
    when 'hosts_only'   then false
    when 'replies_only' then p_reply_to is not null
                             and exists (select 1 from public.messages m
                                          where m.id = p_reply_to
                                            and m.channel_id = p_channel)
    else false
  end;
end;
$$;

-- Whether a message must go through the approval queue.
create or replace function app_private.channel_requires_approval(p_channel uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((restrictions ->> 'approval_required')::boolean, false)
    from public.channels where id = p_channel;
$$;

-- ---------------------------------------------------------------------------
-- Directory
-- ---------------------------------------------------------------------------
-- May I see this academy's phone numbers? Staff and coaches always; everyone
-- else only where the academy has opened its directory.
create or replace function app_private.can_see_contact_details(p_academy uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select app_private.is_academy_coach(p_academy)
      or exists (
        select 1 from public.academies a
         where a.id = p_academy
           and a.directory_visibility = 'all'
           and app_private.is_academy_member(p_academy)
      );
$$;

-- ---------------------------------------------------------------------------
-- Lookups used by policies on child tables. These exist so a policy never has
-- to sub-select another RLS-protected table, which would recurse or crawl.
-- ---------------------------------------------------------------------------
create or replace function app_private.message_channel(p_message uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select channel_id from public.messages where id = p_message;
$$;

create or replace function app_private.poll_channel(p_poll uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select channel_id from public.polls where id = p_poll;
$$;

create or replace function app_private.poll_is_anonymous(p_poll uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(anonymous, false) from public.polls where id = p_poll;
$$;

create or replace function app_private.poll_is_open(p_poll uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select closed_at is null and (closes_at is null or closes_at > now())
    from public.polls where id = p_poll;
$$;

-- May I run the register for this event? Its team's coach, or academy staff.
create or replace function app_private.is_event_coach(p_event uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.events e
     where e.id = p_event
       and (app_private.is_academy_staff(e.academy_id)
            or (e.team_id is not null and app_private.is_team_coach(e.team_id)))
  );
$$;

create or replace function app_private.can_read_event(p_event uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.events e
     where e.id = p_event
       and app_private.is_academy_member(e.academy_id)
       and (e.team_id is null
            or app_private.is_team_member(e.team_id)
            or app_private.is_academy_coach(e.academy_id))
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. Drop every policy, so the public helpers can be dropped
-- ---------------------------------------------------------------------------
do $drop$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'public'
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end;
$drop$;

-- ---------------------------------------------------------------------------
-- 3. Recreate them against app_private
-- ---------------------------------------------------------------------------
create policy academies_select on public.academies for select to authenticated
  using ((select app_private.is_academy_member(id)) or (select app_private.is_platform_admin()));

create policy academies_insert on public.academies for insert to authenticated
  with check (created_by = (select auth.uid()));

create policy academies_update on public.academies for update to authenticated
  using ((select app_private.is_academy_staff(id)))
  with check ((select app_private.is_academy_staff(id)));

create policy academies_delete on public.academies for delete to authenticated
  using ((select app_private.is_platform_admin()));

-- Names and avatars are needed on every message bubble, so the row is shared
-- across an academy. The phone column is withheld by grant, not by policy
-- (see 0012).
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or (select app_private.shares_academy_with(id))
    or (select app_private.is_platform_admin())
  );

create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy platform_admins_select on public.platform_admins for select to authenticated
  using ((select app_private.is_platform_admin()));

-- ===========================================================================
-- Membership
-- ===========================================================================
create policy academy_members_select on public.academy_members for select to authenticated
  using ((select app_private.is_academy_member(academy_id)) or (select app_private.is_platform_admin()));

create policy academy_members_insert on public.academy_members for insert to authenticated
  with check ((select app_private.is_academy_staff(academy_id)));

create policy academy_members_update on public.academy_members for update to authenticated
  using ((select app_private.is_academy_staff(academy_id)))
  with check ((select app_private.is_academy_staff(academy_id)));

create policy academy_members_delete on public.academy_members for delete to authenticated
  using ((select app_private.is_academy_staff(academy_id)));

-- ===========================================================================
-- Teams, players, rosters
-- ===========================================================================
create policy teams_select on public.teams for select to authenticated
  using ((select app_private.is_academy_member(academy_id)));

create policy teams_write on public.teams for all to authenticated
  using ((select app_private.is_academy_staff(academy_id)))
  with check ((select app_private.is_academy_staff(academy_id)));

create policy team_members_select on public.team_members for select to authenticated
  using ((select app_private.is_academy_member(academy_id)));

-- Coaches manage their own team's roster; staff manage any.
create policy team_members_write on public.team_members for all to authenticated
  using ((select app_private.is_academy_staff(academy_id)) or (select app_private.is_team_coach(team_id)))
  with check ((select app_private.is_academy_staff(academy_id)) or (select app_private.is_team_coach(team_id)));

-- A player is visible to their own team, their guardians, and academy staff.
create policy players_select on public.players for select to authenticated
  using (
    (select app_private.is_academy_coach(academy_id))
    or (select app_private.is_guardian_of(id))
    or (team_id is not null and (select app_private.is_team_member(team_id)))
  );

create policy players_write on public.players for all to authenticated
  using ((select app_private.is_academy_staff(academy_id))
         or (team_id is not null and (select app_private.is_team_coach(team_id))))
  with check ((select app_private.is_academy_staff(academy_id))
         or (team_id is not null and (select app_private.is_team_coach(team_id))));

create policy player_guardians_select on public.player_guardians for select to authenticated
  using (
    profile_id = (select auth.uid())
    or (select app_private.is_academy_coach(academy_id))
    or (select app_private.is_guardian_of(player_id))
  );

create policy player_guardians_write on public.player_guardians for all to authenticated
  using ((select app_private.is_academy_coach(academy_id)))
  with check ((select app_private.is_academy_coach(academy_id)));

-- ===========================================================================
-- Invites — the delegation rules live here
-- ===========================================================================
create policy invites_select on public.invites for select to authenticated
  using ((select app_private.is_academy_coach(academy_id)));

-- Owners/admins may invite any role. Coaches may only bring in parents and
-- players, never another coach or an admin.
create policy invites_insert on public.invites for insert to authenticated
  with check (
    invited_by = (select auth.uid())
    and (
      (select app_private.is_academy_staff(academy_id))
      or ((select app_private.is_academy_coach(academy_id)) and role in ('parent', 'player'))
    )
  );

create policy invites_update on public.invites for update to authenticated
  using ((select app_private.is_academy_staff(academy_id)) or invited_by = (select auth.uid()))
  with check ((select app_private.is_academy_staff(academy_id)) or invited_by = (select auth.uid()));

-- And this is where "coaches invite to their own teams only" actually bites:
-- an invite is worthless without a team attached, and a coach can only attach
-- a team they coach.
create policy invite_teams_select on public.invite_teams for select to authenticated
  using ((select app_private.is_academy_coach(academy_id)));

create policy invite_teams_write on public.invite_teams for all to authenticated
  using ((select app_private.is_academy_staff(academy_id)) or (select app_private.is_team_coach(team_id)))
  with check ((select app_private.is_academy_staff(academy_id)) or (select app_private.is_team_coach(team_id)));

create policy join_links_select on public.join_links for select to authenticated
  using ((select app_private.is_academy_coach(academy_id)));

create policy join_links_insert on public.join_links for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (
      (select app_private.is_academy_staff(academy_id))
      or ((select app_private.is_team_coach(team_id)) and role in ('parent', 'player'))
    )
  );

create policy join_links_update on public.join_links for update to authenticated
  using ((select app_private.is_academy_staff(academy_id)) or created_by = (select auth.uid()))
  with check ((select app_private.is_academy_staff(academy_id)) or created_by = (select auth.uid()));

create policy join_link_redemptions_select on public.join_link_redemptions for select to authenticated
  using ((select app_private.is_academy_coach(academy_id)));
-- Rows are written only by the redemption RPC (security definer). No insert
-- policy, deliberately.

create policy academy_invites_all on public.academy_invites for all to authenticated
  using ((select app_private.is_platform_admin()))
  with check ((select app_private.is_platform_admin()));

-- ===========================================================================
-- Channels
-- ===========================================================================
-- Staff can see every channel except a DM, which is nobody else's business.
create policy channels_select on public.channels for select to authenticated
  using (
    (select app_private.is_channel_member(id))
    or (type <> 'direct' and (select app_private.is_academy_staff(academy_id)))
  );

create policy channels_insert on public.channels for insert to authenticated
  with check ((select app_private.is_academy_coach(academy_id)));

create policy channels_update on public.channels for update to authenticated
  using ((select app_private.is_channel_host(id)))
  with check ((select app_private.is_channel_host(id)));

create policy channels_delete on public.channels for delete to authenticated
  using (type <> 'direct' and (select app_private.is_academy_staff(academy_id)));

create policy channel_members_select on public.channel_members for select to authenticated
  using ((select app_private.is_channel_member(channel_id)) or (select app_private.is_academy_staff(academy_id)));

-- Only hosts add people. This is the "parents can't add anyone" rule.
create policy channel_members_insert on public.channel_members for insert to authenticated
  with check ((select app_private.is_channel_host(channel_id)));

-- You may update your own row (mute, last_read_at); a host may update anyone's.
create policy channel_members_update on public.channel_members for update to authenticated
  using (profile_id = (select auth.uid()) or (select app_private.is_channel_host(channel_id)))
  with check (profile_id = (select auth.uid()) or (select app_private.is_channel_host(channel_id)));

create policy channel_members_delete on public.channel_members for delete to authenticated
  using (profile_id = (select auth.uid()) or (select app_private.is_channel_host(channel_id)));

-- ===========================================================================
-- Messages
-- ===========================================================================
-- Queued messages are visible only to their author and the channel's hosts.
create policy messages_select on public.messages for select to authenticated
  using (
    (select app_private.is_channel_member(channel_id))
    and (
      status = 'published'
      or sender_id = (select auth.uid())
      or (select app_private.is_channel_host(channel_id))
    )
  );

-- Posting mode, archived seasons and the approval queue, all enforced here.
create policy messages_insert on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and (select app_private.can_post_in_channel(channel_id, reply_to_id))
    and (not is_announcement or (select app_private.is_channel_host(channel_id)))
    and (
      case
        when (select app_private.channel_requires_approval(channel_id))
             and not (select app_private.is_channel_host(channel_id))
        then status = 'pending'
        else status = 'published'
      end
    )
  );

-- Authors edit and delete their own; hosts pin, approve and moderate.
create policy messages_update on public.messages for update to authenticated
  using (sender_id = (select auth.uid()) or (select app_private.is_channel_host(channel_id)))
  with check (sender_id = (select auth.uid()) or (select app_private.is_channel_host(channel_id)));

-- No delete policy: messages are soft-deleted so the archive trigger runs.

-- Owners and admins may read deleted content for the retention window.
create policy deleted_archive_select on public.deleted_message_archive for select to authenticated
  using ((select app_private.is_academy_staff(academy_id)) and purge_after > now());

-- ===========================================================================
-- Reactions — the one thing a parent can do in a broadcast channel
-- ===========================================================================
-- The base table exposes identity, so it is host-only. Everyone else reads
create policy message_reactions_select on public.message_reactions for select to authenticated
  using (
    profile_id = (select auth.uid())
    or (select app_private.is_channel_host(app_private.message_channel(message_id)))
  );

-- Note this checks membership, NOT can_post_in_channel: reacting is exactly
-- what stays available when a channel is set to hosts_only.
create policy message_reactions_insert on public.message_reactions for insert to authenticated
  with check (
    profile_id = (select auth.uid())
    and (select app_private.is_channel_member(app_private.message_channel(message_id)))
  );

create policy message_reactions_delete on public.message_reactions for delete to authenticated
  using (profile_id = (select auth.uid()));

-- ===========================================================================
-- Events and RSVPs
-- ===========================================================================
create policy events_select on public.events for select to authenticated
  using (
    (select app_private.is_academy_member(academy_id))
    and (
      team_id is null
      or (select app_private.is_team_member(team_id))
      or (select app_private.is_academy_coach(academy_id))
    )
  );

create policy events_write on public.events for all to authenticated
  using ((select app_private.is_academy_staff(academy_id))
         or (team_id is not null and (select app_private.is_team_coach(team_id))))
  with check ((select app_private.is_academy_staff(academy_id))
         or (team_id is not null and (select app_private.is_team_coach(team_id))));

-- Coaches see the whole register; a parent sees only their own answers.
create policy event_rsvps_select on public.event_rsvps for select to authenticated
  using (
    profile_id = (select auth.uid())
    or (select app_private.is_event_coach(event_id))
  );

create policy event_rsvps_insert on public.event_rsvps for insert to authenticated
  with check (
    (select app_private.can_read_event(event_id))
    and (
      (profile_id = (select auth.uid())
       and (player_id is null or (select app_private.is_guardian_of(player_id))))
      or (select app_private.is_event_coach(event_id))
    )
  );

create policy event_rsvps_update on public.event_rsvps for update to authenticated
  using (profile_id = (select auth.uid()) or (select app_private.is_event_coach(event_id)))
  with check (profile_id = (select auth.uid()) or (select app_private.is_event_coach(event_id)));

create policy event_rsvps_delete on public.event_rsvps for delete to authenticated
  using (profile_id = (select auth.uid()) or (select app_private.is_event_coach(event_id)));

-- ===========================================================================
-- Polls
-- ===========================================================================
create policy polls_select on public.polls for select to authenticated
  using ((select app_private.is_channel_member(channel_id)));

create policy polls_insert on public.polls for insert to authenticated
  with check (created_by = (select auth.uid()) and (select app_private.is_channel_host(channel_id)));

create policy polls_update on public.polls for update to authenticated
  using ((select app_private.is_channel_host(channel_id)))
  with check ((select app_private.is_channel_host(channel_id)));

-- An anonymous poll is anonymous to the host too. Tallies come from
create policy poll_votes_select on public.poll_votes for select to authenticated
  using (
    profile_id = (select auth.uid())
    or (
      (select app_private.is_channel_host(app_private.poll_channel(poll_id)))
      and not (select app_private.poll_is_anonymous(poll_id))
    )
  );

create policy poll_votes_insert on public.poll_votes for insert to authenticated
  with check (
    profile_id = (select auth.uid())
    and (select app_private.is_channel_member(app_private.poll_channel(poll_id)))
    and (select app_private.poll_is_open(poll_id))
    and (player_id is null or (select app_private.is_guardian_of(player_id)))
  );

create policy poll_votes_update on public.poll_votes for update to authenticated
  using (profile_id = (select auth.uid()) and (select app_private.poll_is_open(poll_id)))
  with check (profile_id = (select auth.uid()) and (select app_private.poll_is_open(poll_id)));

create policy poll_votes_delete on public.poll_votes for delete to authenticated
  using (profile_id = (select auth.uid()) and (select app_private.poll_is_open(poll_id)));

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

