-- 0011_rls_helpers.sql
-- The functions every policy is built from.
--
-- All of these are SECURITY DEFINER and STABLE on purpose:
--   * DEFINER so they can read academy_members without tripping that table's
--     own policies, which would recurse.
--   * STABLE so Postgres evaluates them once per statement when a policy
--     calls them as (select fn(...)) rather than once per row. That wrapping
--     is not cosmetic — it is the difference between a fast query and a scan
--     at a few hundred academies.
-- Every policy in 0013 wraps its calls this way.

-- ---------------------------------------------------------------------------
-- Platform + academy
-- ---------------------------------------------------------------------------
create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where profile_id = auth.uid());
$$;

create or replace function public.is_academy_member(p_academy uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.academy_members
     where academy_id = p_academy
       and profile_id = auth.uid()
       and status = 'active'
  );
$$;

create or replace function public.academy_role_of(p_academy uuid)
returns public.academy_role language sql stable security definer set search_path = public as $$
  select role from public.academy_members
   where academy_id = p_academy and profile_id = auth.uid() and status = 'active';
$$;

-- Owners and admins.
create or replace function public.is_academy_staff(p_academy uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.academy_role_of(p_academy) in ('owner', 'admin');
$$;

-- Owners, admins and coaches — anyone who may create events or invite.
create or replace function public.is_academy_coach(p_academy uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.academy_role_of(p_academy) in ('owner', 'admin', 'coach');
$$;

create or replace function public.my_academy_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select academy_id from public.academy_members
   where profile_id = auth.uid() and status = 'active';
$$;

-- Do I share an academy with this person? Gates seeing their name at all.
create or replace function public.shares_academy_with(p_profile uuid)
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
create or replace function public.is_team_coach(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.team_members
     where team_id = p_team and profile_id = auth.uid() and role = 'coach'
  ) or exists (
    select 1 from public.teams t
     where t.id = p_team and public.is_academy_staff(t.academy_id)
  );
$$;

create or replace function public.is_team_member(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.team_members
     where team_id = p_team and profile_id = auth.uid()
  );
$$;

create or replace function public.is_guardian_of(p_player uuid)
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
create or replace function public.is_channel_member(p_channel uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.channel_members
     where channel_id = p_channel and profile_id = auth.uid()
  );
$$;

-- Hosts and co-hosts, plus academy owners/admins who always have the keys.
create or replace function public.is_channel_host(p_channel uuid)
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
       and public.is_academy_staff(c.academy_id)
  );
$$;

-- The posting-mode rule, enforced here rather than trusted to the UI.
create or replace function public.can_post_in_channel(
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

  if not public.is_channel_member(p_channel) then
    return false;
  end if;

  if public.is_channel_host(p_channel) then
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
create or replace function public.channel_requires_approval(p_channel uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((restrictions ->> 'approval_required')::boolean, false)
    from public.channels where id = p_channel;
$$;

-- ---------------------------------------------------------------------------
-- Directory
-- ---------------------------------------------------------------------------
-- May I see this academy's phone numbers? Staff and coaches always; everyone
-- else only where the academy has opened its directory.
create or replace function public.can_see_contact_details(p_academy uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_academy_coach(p_academy)
      or exists (
        select 1 from public.academies a
         where a.id = p_academy
           and a.directory_visibility = 'all'
           and public.is_academy_member(p_academy)
      );
$$;

-- ---------------------------------------------------------------------------
-- Lookups used by policies on child tables. These exist so a policy never has
-- to sub-select another RLS-protected table, which would recurse or crawl.
-- ---------------------------------------------------------------------------
create or replace function public.message_channel(p_message uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select channel_id from public.messages where id = p_message;
$$;

create or replace function public.poll_channel(p_poll uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select channel_id from public.polls where id = p_poll;
$$;

create or replace function public.poll_is_anonymous(p_poll uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(anonymous, false) from public.polls where id = p_poll;
$$;

create or replace function public.poll_is_open(p_poll uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select closed_at is null and (closes_at is null or closes_at > now())
    from public.polls where id = p_poll;
$$;

-- May I run the register for this event? Its team's coach, or academy staff.
create or replace function public.is_event_coach(p_event uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.events e
     where e.id = p_event
       and (public.is_academy_staff(e.academy_id)
            or (e.team_id is not null and public.is_team_coach(e.team_id)))
  );
$$;

create or replace function public.can_read_event(p_event uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.events e
     where e.id = p_event
       and public.is_academy_member(e.academy_id)
       and (e.team_id is null
            or public.is_team_member(e.team_id)
            or public.is_academy_coach(e.academy_id))
  );
$$;
