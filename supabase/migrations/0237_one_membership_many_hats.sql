-- 0237: one membership per person per club, with a set of hats on it.
--
-- Joey, 10 Nov 2026, Part A fix 1: "one membership per person per club,
-- plus a set of roles on it (a person can be parent + coach + President +
-- team manager at once). Update every RLS helper to ask 'does this person
-- hold role X here' instead of reading one role. Migrate existing rows
-- without losing anything. Home shows each hat clearly."
--
-- The shape: `academy_members.roles` (an array of the base hats — owner,
-- admin, coach, parent, player — several at once) beside `role`, which
-- stays as the STRONGEST hat so that every function from before reads the
-- same answer it read yesterday; a trigger keeps the two in step, and a
-- write to `role` alone (every older caller) swaps that hat in the set and
-- keeps the rest. Scoped hats (a team's manager, an age group's
-- coordinator, the committee) live in `club_roles` (0236), because each
-- names a team or an age group. The helpers ask "holds X here":
-- `member_roles_of`, `holds_role`; `academy_role_of`, `is_academy_staff`,
-- `is_academy_coach` are rewritten on top of them, so every policy already
-- asks the new question without changing. `home_personas` lists a person's
-- hats and `home_jobs` takes the one to show.

-- ================================================================== shape

alter table public.academy_members add column if not exists roles public.academy_role[] not null default '{}';
update public.academy_members set roles = array[role] where roles = '{}';

-- owner > admin > coach > parent > player: the hat with the most reach.
create or replace function app_private.strongest_role(p_roles public.academy_role[])
returns public.academy_role
language sql immutable as $fn$
  select r from unnest(p_roles) r
   order by case r when 'owner' then 5 when 'admin' then 4 when 'coach' then 3 when 'parent' then 2 else 1 end desc
   limit 1;
$fn$;

-- `role` follows `roles`; a write to `role` alone swaps that hat in the set.
create or replace function app_private.sync_member_roles()
returns trigger
language plpgsql set search_path = public as $fn$
begin
  if tg_op = 'INSERT' then
    if new.roles is null or new.roles = '{}' then
      new.roles := array[new.role];
    elsif not (new.role = any (new.roles)) then
      new.roles := new.roles || new.role;
    end if;
  else
    if new.roles is distinct from old.roles then
      if new.roles is null or new.roles = '{}' then
        raise exception 'a member holds at least one role — remove the membership instead' using errcode = '22023';
      end if;
    elsif new.role is distinct from old.role then
      new.roles := array_remove(old.roles, old.role);
      if not (new.role = any (new.roles)) then
        new.roles := new.roles || new.role;
      end if;
    end if;
  end if;
  -- No hat twice.
  select coalesce(array_agg(distinct r), '{}') into new.roles from unnest(new.roles) r;
  new.role := app_private.strongest_role(new.roles);
  return new;
end;
$fn$;
drop trigger if exists academy_members_0_sync_roles on public.academy_members;
create trigger academy_members_0_sync_roles
  before insert or update of role, roles on public.academy_members
  for each row execute function app_private.sync_member_roles();

alter table public.academy_members drop constraint if exists academy_members_roles_not_empty;
alter table public.academy_members add constraint academy_members_roles_not_empty check (cardinality(roles) >= 1);
alter table public.academy_members drop constraint if exists academy_members_role_in_roles;
alter table public.academy_members add constraint academy_members_role_in_roles check (role = any (roles));

-- The WWCC rule (0120) looks at the set: a coach's or an admin's hat needs a
-- check on record, whatever else the person is.
create or replace function public.require_a_clearance_for_staff()
returns trigger
language plpgsql set search_path = public as $fn$
begin
  if new.status = 'active'
     and (new.roles && array['coach', 'admin']::public.academy_role[]
          or (new.roles is null and new.role in ('coach', 'admin')))
     and not app_private.has_current_clearance(new.academy_id, new.profile_id) then
    raise exception 'That person has no current Working With Children Check recorded. Record it under Admin → Working With Children Checks first.'
      using errcode = '42501';
  end if;
  return new;
end;
$fn$;
drop trigger if exists academy_members_require_clearance on public.academy_members;
create trigger academy_members_require_clearance
  before insert or update of role, roles, status, profile_id on public.academy_members
  for each row execute function public.require_a_clearance_for_staff();

-- ================================================================ helpers

-- The hats the caller holds here, as rights: an owner's or admin's hat
-- counts only with the second step done where the club requires it
-- (0231/0232), a coach's only with their own two-step satisfied (0224).
-- The parent's and player's hats are theirs on a password alone.
create or replace function app_private.member_roles_of(p_academy uuid)
returns public.academy_role[]
language plpgsql stable security definer set search_path = public as $fn$
declare
  v public.academy_role[];
begin
  if auth.uid() is null or p_academy is null then
    return '{}';
  end if;
  select m.roles into v from public.academy_members m
   where m.academy_id = p_academy and m.profile_id = auth.uid() and m.status = 'active';
  if v is null then
    return '{}';
  end if;
  if v && array['owner', 'admin']::public.academy_role[] and not app_private.two_step_ok_for(p_academy) then
    v := array_remove(array_remove(v, 'owner'::public.academy_role), 'admin'::public.academy_role);
  end if;
  if 'coach' = any (v) and not app_private.two_step_ok() then
    v := array_remove(v, 'coach'::public.academy_role);
  end if;
  return v;
end;
$fn$;

create or replace function app_private.holds_role(p_academy uuid, p_role public.academy_role)
returns boolean
language sql stable security definer set search_path = public as $fn$
  select p_role = any (app_private.member_roles_of(p_academy));
$fn$;

-- The strongest hat, for everything that asks for one role.
create or replace function app_private.academy_role_of(p_academy uuid)
returns public.academy_role
language plpgsql stable security definer set search_path = public as $fn$
declare
  v public.academy_role[] := app_private.member_roles_of(p_academy);
begin
  if v = '{}' then
    return null;
  end if;
  return app_private.strongest_role(v);
end;
$fn$;

create or replace function app_private.is_academy_staff(p_academy uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(app_private.member_roles_of(p_academy) && array['owner', 'admin']::public.academy_role[], false);
$$;

create or replace function app_private.is_academy_coach(p_academy uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(app_private.member_roles_of(p_academy) && array['owner', 'admin', 'coach']::public.academy_role[], false)
     and not app_private.clearance_lapsed(p_academy, auth.uid());
$$;

-- A team's manager and the coordinator over it are on the team for every
-- read that asks "is on this team" (the roster, the fees aimed at it).
create or replace function app_private.is_team_member(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.team_members
     where team_id = p_team and profile_id = auth.uid()
  ) or app_private.runs_team(p_team, true);
$$;

-- ---------------------------------------------------------- the base hats

-- Give or take a base hat. Owners, admins, the President and the Secretary;
-- only an owner makes another owner; the last owner keeps theirs. The WWCC
-- trigger above still speaks for a coach's or an admin's hat.
create or replace function public.add_member_role(p_academy uuid, p_profile uuid, p_role public.academy_role)
returns public.academy_role[]
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v public.academy_role[];
begin
  if auth.uid() is null or not app_private.may_run_club(p_academy, 'club') then
    raise exception 'only the club''s owners, admins, President or Secretary change what someone is here' using errcode = '42501';
  end if;
  if p_role = 'owner' and not app_private.holds_role(p_academy, 'owner') then
    raise exception 'only an owner makes another owner' using errcode = '42501';
  end if;
  update public.academy_members m
     set roles = (select coalesce(array_agg(distinct r), '{}') from unnest(m.roles || p_role) r)
   where m.academy_id = p_academy and m.profile_id = p_profile and m.status = 'active'
  returning m.roles into v;
  if v is null then
    raise exception 'they are not a member here yet' using errcode = '22023';
  end if;
  return v;
end;
$fn$;

create or replace function public.remove_member_role(p_academy uuid, p_profile uuid, p_role public.academy_role)
returns public.academy_role[]
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v public.academy_role[];
begin
  if auth.uid() is null or not app_private.may_run_club(p_academy, 'club') then
    raise exception 'only the club''s owners, admins, President or Secretary change what someone is here' using errcode = '42501';
  end if;
  if p_role = 'owner' and not app_private.holds_role(p_academy, 'owner') then
    raise exception 'only an owner takes an owner''s hat away' using errcode = '42501';
  end if;
  if p_role = 'owner' and (select count(*) from public.academy_members m
                            where m.academy_id = p_academy and m.status = 'active' and 'owner' = any (m.roles)) <= 1 then
    raise exception 'a club keeps at least one owner' using errcode = '22023';
  end if;
  select m.roles into v from public.academy_members m
   where m.academy_id = p_academy and m.profile_id = p_profile and m.status = 'active';
  if v is null then
    raise exception 'they are not a member here' using errcode = '22023';
  end if;
  if cardinality(array_remove(v, p_role)) = 0 then
    raise exception 'that is their only hat — remove the membership instead' using errcode = '22023';
  end if;
  update public.academy_members m set roles = array_remove(m.roles, p_role)
   where m.academy_id = p_academy and m.profile_id = p_profile
  returning m.roles into v;
  return v;
end;
$fn$;

-- The roster policy (0170) also opens to the people who run the team.
drop policy if exists players_select on public.players;
create policy players_select on public.players for select to authenticated
  using (
    (select app_private.is_academy_coach(players.academy_id))
    or (select app_private.is_guardian_of(players.id))
    or (team_id is not null
        and (select app_private.is_team_member(players.team_id))
        and not (select app_private.clearance_lapsed(players.academy_id, auth.uid())))
  );

-- A team's manager is in its chats: the club role puts them there and
-- takes them out again (the team's own coaches and families arrive through
-- team_members as before).
create or replace function app_private.on_club_role_channels()
returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  r public.club_roles := coalesce(new, old);
  c record;
begin
  if r.role <> 'team_manager' or r.team_id is null then
    return null;
  end if;
  if tg_op = 'INSERT' then
    for c in select ch.id from public.channels ch where ch.team_id = r.team_id and ch.type = 'team' and ch.status = 'active' loop
      perform public.add_to_channel(c.id, r.profile_id, 'member');
    end loop;
  else
    if not exists (select 1 from public.team_members tm where tm.team_id = r.team_id and tm.profile_id = r.profile_id)
       and not exists (select 1 from public.club_roles x where x.team_id = r.team_id and x.profile_id = r.profile_id and x.role = 'team_manager') then
      delete from public.channel_members cm
       using public.channels ch
       where cm.channel_id = ch.id and ch.team_id = r.team_id and ch.type = 'team' and cm.profile_id = r.profile_id;
    end if;
  end if;
  return null;
end;
$fn$;
drop trigger if exists club_roles_channels on public.club_roles;
create trigger club_roles_channels
  after insert or delete on public.club_roles
  for each row execute function app_private.on_club_role_channels();

-- Managers already granted (0236) join their team chats now.
do $$
declare r record;
begin
  for r in select cr.profile_id, ch.id as channel_id
             from public.club_roles cr
             join public.channels ch on ch.team_id = cr.team_id and ch.type = 'team' and ch.status = 'active'
            where cr.role = 'team_manager' loop
    perform public.add_to_channel(r.channel_id, r.profile_id, 'member');
  end loop;
end $$;

-- ================================================================== Home

-- Every hat a person wears here, biggest first — what the chips on Home
-- show. Raw rows, not rights: a hat is a hat whether or not this session
-- has done its second step (the tools behind it still ask).
create or replace function app_private.home_personas(p_academy uuid, p_profile uuid)
returns text[]
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_roles public.academy_role[];
  v_type text;
  v_club public.club_role[];
  v_league boolean;
  out text[] := '{}';
begin
  select m.roles into v_roles from public.academy_members m
   where m.academy_id = p_academy and m.profile_id = p_profile and m.status = 'active';
  if v_roles is null then
    return '{}';
  end if;
  select a.type::text into v_type from public.academies a where a.id = p_academy;
  select coalesce(array_agg(distinct r.role), '{}') into v_club from public.club_roles r
   where r.academy_id = p_academy and r.profile_id = p_profile;
  v_league := exists (select 1 from public.league_roles lr where lr.academy_id = p_academy and lr.profile_id = p_profile);

  if v_type = 'league' and (v_roles && array['owner', 'admin']::public.academy_role[] or v_league) then
    out := array_append(out, 'league');
  elsif v_roles && array['owner', 'admin']::public.academy_role[] then
    out := array_append(out, 'owner');
  end if;
  if v_club && array['president', 'secretary']::public.club_role[] then out := array_append(out, 'president'); end if;
  if 'treasurer' = any (v_club) then out := array_append(out, 'treasurer'); end if;
  if 'registrar' = any (v_club) then out := array_append(out, 'registrar'); end if;
  if 'coordinator' = any (v_club) then out := array_append(out, 'coordinator'); end if;
  if 'team_manager' = any (v_club) then out := array_append(out, 'manager'); end if;
  if 'coach' = any (v_roles) then out := array_append(out, 'coach'); end if;
  if 'welfare_officer' = any (v_club) then out := array_append(out, 'welfare'); end if;
  if 'volunteer_coordinator' = any (v_club) then out := array_append(out, 'volunteers'); end if;
  if 'player' = any (v_roles) then out := array_append(out, 'player'); end if;
  if 'parent' = any (v_roles)
     or exists (select 1 from public.player_guardians g join public.players p on p.id = g.player_id
                 where g.profile_id = p_profile and p.academy_id = p_academy) then
    out := array_append(out, 'parent');
  end if;
  if out = '{}' then
    out := array['parent'];
  end if;
  return out;
end;
$fn$;

-- Kept for the callers that still ask for one.
create or replace function app_private.home_persona(
  p_academy uuid, p_profile uuid, p_role public.academy_role, p_type text
) returns text language sql stable as $$
  select (app_private.home_personas(p_academy, p_profile))[1];
$$;

-- The top of Home: the hats, the one being worn (p_persona, if held; else
-- the biggest), and that hat's three jobs. Dropped and made again: a
-- second argument changes the signature.
drop function if exists public.home_jobs(uuid);
create or replace function public.home_jobs(p_academy uuid default null, p_persona text default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_me       uuid := auth.uid();
  v_academy  uuid;
  v_role     public.academy_role;
  v_type     text;
  v_tz       text;
  v_persona  text;
  v_personas text[];
  v_jobs     jsonb := '[]'::jsonb;
  v_today    jsonb;
  v_ann      jsonb;
  v_switch   jsonb;
  v_id       uuid;
  v_title    text;
  v_at       timestamptz;
  v_count    integer;
  v_count2   integer;
  v_count3   integer;
  v_cents    bigint;
  v_detail   text;
  v_comp     uuid;
  v_comp2    uuid;
  v_day      date;
  v_sun      date;
  v_upcoming jsonb := '[]'::jsonb;
  v_teams    uuid[];
begin
  if v_me is null then
    return null;
  end if;
  v_academy := app_private.my_academy(p_academy);
  if v_academy is null then
    return null;
  end if;

  select am.role into v_role
    from public.academy_members am
   where am.academy_id = v_academy and am.profile_id = v_me and am.status = 'active';
  select a.type::text, coalesce(a.timezone, 'Australia/Sydney') into v_type, v_tz
    from public.academies a where a.id = v_academy;
  v_personas := app_private.home_personas(v_academy, v_me);
  v_persona := case when p_persona is not null and p_persona = any (v_personas) then p_persona else v_personas[1] end;
  v_day := (now() at time zone v_tz)::date;
  v_sun := v_day + ((7 - extract(dow from v_day)::integer) % 7);

  -- The next three weeks, worked out ONCE (0216).
  if v_persona in ('parent', 'coach', 'player') then
    select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb) into v_upcoming
      from public.my_upcoming_events(v_academy, 21) e;
  end if;

  -- ------------------------------------------------------- parent / player
  if v_persona in ('parent', 'player') then
    select e.id, e.title, e.starts_at into v_id, v_title, v_at
      from jsonb_to_recordset(v_upcoming) as e(id uuid, type public.event_type, title text, starts_at timestamptz, cancelled_at timestamptz, my_replies integer, my_children integer, no_reply integer)
     where e.cancelled_at is null and coalesce(e.my_children, 0) > coalesce(e.my_replies, 0)
     order by e.starts_at, e.id limit 1;
    select count(*) into v_count
      from jsonb_to_recordset(v_upcoming) as e(id uuid, type public.event_type, title text, starts_at timestamptz, cancelled_at timestamptz, my_replies integer, my_children integer, no_reply integer)
     where e.cancelled_at is null and coalesce(e.my_children, 0) > coalesce(e.my_replies, 0);
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'rsvp', 'label', 'Answer',
      'detail', case when v_id is null then 'All answered'
                     else v_title || ' · ' || to_char(v_at at time zone v_tz, 'Dy') end,
      'href', case when v_id is null then '/calendar' else '/calendar/' || v_id end,
      'count', coalesce(v_count, 0));

    v_id := null; v_title := null; v_count := null;
    select c.channel_id, c.name, c.unread_count into v_id, v_title, v_count
      from public.my_channels(v_academy) c
     where c.status = 'active' and c.type = 'team'
     order by c.unread_count desc, c.last_message_at desc nulls last limit 1;
    if v_id is null then
      select c.channel_id, c.name, c.unread_count into v_id, v_title, v_count
        from public.my_channels(v_academy) c
       where c.status = 'active'
       order by c.unread_count desc, c.last_message_at desc nulls last limit 1;
    end if;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'chat', 'label', 'Team chat',
      'detail', coalesce(v_title, 'No chats yet'),
      'href', case when v_id is null then '/chat' else '/chat/' || v_id end,
      'count', coalesce(v_count, 0));

    v_count := null; v_detail := null;
    select (x->>'count')::integer, x->>'detail' into v_count, v_detail
      from jsonb_array_elements(coalesce(public.needs_you(v_academy), '[]'::jsonb)) x
     where x->>'kind' = 'fees' limit 1;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'pay', 'label', 'Pay',
      'detail', coalesce(v_detail, 'Nothing owing'),
      'href', '/payments',
      'count', coalesce(v_count, 0));

  -- ------------------------------------------------------------------- coach
  elsif v_persona = 'coach' then
    select c.channel_id, c.name, c.unread_count into v_id, v_title, v_count
      from public.my_channels(v_academy) c
     where c.status = 'active' and c.type = 'team'
     order by (c.my_role = 'host') desc, c.unread_count desc, c.last_message_at desc nulls last limit 1;
    if v_id is null then
      select c.channel_id, c.name, c.unread_count into v_id, v_title, v_count
        from public.my_channels(v_academy) c
       where c.status = 'active'
       order by c.unread_count desc, c.last_message_at desc nulls last limit 1;
    end if;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'post', 'label', 'Post',
      'detail', coalesce(v_title, 'No chats yet'),
      'href', case when v_id is null then '/chat' else '/chat/' || v_id end,
      'count', coalesce(v_count, 0));

    v_id := null; v_title := null; v_count := null;
    select e.id, e.title, e.no_reply into v_id, v_title, v_count
      from jsonb_to_recordset(v_upcoming) as e(id uuid, type public.event_type, title text, starts_at timestamptz, cancelled_at timestamptz, my_replies integer, my_children integer, no_reply integer)
     where e.cancelled_at is null and e.type in ('match', 'tournament')
     order by e.starts_at, e.id limit 1;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'squad', 'label', 'Squad',
      'detail', case when v_id is null then 'No game coming up'
                     when coalesce(v_count, 0) > 0 then v_count || ' no reply · ' || v_title
                     else v_title end,
      'href', case when v_id is null then '/calendar' else '/calendar/' || v_id end,
      'count', coalesce(v_count, 0));

    v_id := null; v_title := null; v_at := null;
    select e.id, e.title, e.starts_at into v_id, v_title, v_at
      from public.events e
     where e.academy_id = v_academy and e.type = 'training' and e.cancelled_at is null
       and e.private_to is null
       and e.starts_at between now() - interval '12 hours' and now()
       and (app_private.is_academy_coach(v_academy)
            or (e.team_id is not null and app_private.is_team_coach(e.team_id)))
     order by e.starts_at desc limit 1;
    if v_id is null then
      select e.id, e.title, e.starts_at into v_id, v_title, v_at
        from jsonb_to_recordset(v_upcoming) as e(id uuid, type public.event_type, title text, starts_at timestamptz, cancelled_at timestamptz, my_replies integer, my_children integer, no_reply integer)
       where e.starts_at < now() + interval '7 days'
         and e.cancelled_at is null and e.type = 'training'
       order by e.starts_at, e.id limit 1;
    end if;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'attendance', 'label', 'Attendance',
      'detail', case when v_id is null then 'No training this week'
                     when v_at <= now() then v_title || ' · register open'
                     else v_title || ' · ' || to_char(v_at at time zone v_tz, 'Dy HH12:MI am') end,
      'href', case when v_id is null then '/calendar' else '/calendar/' || v_id end,
      'count', 0);

  -- ------------------------------------------------------------------- owner
  elsif v_persona = 'owner' then
    select (select count(*) from public.registration_requests rr
             where rr.academy_id = v_academy and rr.status = 'pending')
         + (select count(*) from public.program_registrations pr
             where pr.academy_id = v_academy and pr.status = 'pending')
      into v_count;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'registrations', 'label', 'Registrations',
      'detail', case when coalesce(v_count, 0) = 0 then 'None waiting' else v_count || ' waiting' end,
      'href', '/admin/registrations',
      'count', coalesce(v_count, 0));

    select count(distinct o.player_id), coalesce(sum(o.outstanding_cents), 0) into v_count, v_cents
      from public.outstanding_fees(v_academy) o
     where o.outstanding_cents > 0;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'owing', 'label', 'Who owes',
      'detail', case when coalesce(v_count, 0) = 0 then 'Nobody owes'
                     else '$' || to_char(v_cents / 100.0, 'FM999999990') || ' · ' || v_count
                          || case when v_count = 1 then ' child' else ' children' end end,
      'href', '/admin/payments',
      'count', coalesce(v_count, 0));

    v_id := null; v_title := null;
    select c.channel_id, c.name into v_id, v_title
      from public.my_channels(v_academy) c
     where c.status = 'active' and c.type = 'academy_wide' limit 1;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'everyone', 'label', 'Message everyone',
      'detail', coalesce(v_title, 'Club-wide chat'),
      'href', case when v_id is null then '/chat' else '/chat/' || v_id end,
      'count', 0);

    select count(*) into v_count
      from public.events e
     where e.academy_id = v_academy and e.cancelled_at is null and e.private_to is null
       and (e.starts_at at time zone v_tz)::date = v_day;
    v_today := jsonb_build_object(
      'label', 'Today across all teams',
      'detail', case when coalesce(v_count, 0) = 0 then 'Nothing on today'
                     else v_count || case when v_count = 1 then ' session' else ' sessions' end end,
      'count', coalesce(v_count, 0),
      'href', '/calendar');

  -- --------------------------------------------------------------- president
  -- Club HQ (Big Club Mode item 12): needs a decision · this weekend · money.
  elsif v_persona = 'president' then
    select (select count(*) from public.registration_requests rr where rr.academy_id = v_academy and rr.status = 'pending')
         + (select count(*) from public.program_registrations pr where pr.academy_id = v_academy and pr.status = 'pending')
         + (select count(*) from public.join_requests jr where jr.academy_id = v_academy and jr.status = 'pending')
         + (select count(*) from public.refunds rf where rf.academy_id = v_academy and rf.status = 'requested')
      into v_count;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'decisions', 'label', 'Needs a decision',
      'detail', case when coalesce(v_count, 0) = 0 then 'Nothing waiting' else v_count || ' waiting' end,
      'href', '/admin/registrations',
      'count', coalesce(v_count, 0));

    select count(*), count(*) filter (where e.cancelled_at is not null) into v_count, v_count2
      from public.events e
     where e.academy_id = v_academy and e.private_to is null and e.type in ('match', 'tournament')
       and (e.starts_at at time zone v_tz)::date between v_day and v_sun;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'weekend', 'label', 'This weekend',
      'detail', case when coalesce(v_count, 0) = 0 then 'No games'
                     else (v_count - v_count2) || ' games' || case when v_count2 > 0 then ' · ' || v_count2 || ' called off' else '' end end,
      'href', '/calendar',
      'count', coalesce(v_count, 0) - coalesce(v_count2, 0));

    select count(distinct o.player_id), coalesce(sum(o.outstanding_cents), 0) into v_count, v_cents
      from public.outstanding_fees(v_academy) o
     where o.outstanding_cents > 0;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'money', 'label', 'Money',
      'detail', case when coalesce(v_count, 0) = 0 then 'Nobody owes'
                     else '$' || to_char(v_cents / 100.0, 'FM999999990') || ' owed · ' || v_count end,
      'href', '/admin/payments',
      'count', coalesce(v_count, 0));

    select count(*) into v_count
      from public.events e
     where e.academy_id = v_academy and e.cancelled_at is null and e.private_to is null
       and (e.starts_at at time zone v_tz)::date = v_day;
    v_today := jsonb_build_object(
      'label', 'Today across the club',
      'detail', case when coalesce(v_count, 0) = 0 then 'Nothing on today'
                     else v_count || case when v_count = 1 then ' session' else ' sessions' end end,
      'count', coalesce(v_count, 0),
      'href', '/calendar');

  -- --------------------------------------------------------------- treasurer
  elsif v_persona = 'treasurer' then
    select count(distinct o.player_id), coalesce(sum(o.outstanding_cents), 0) into v_count, v_cents
      from public.outstanding_fees(v_academy) o
     where o.outstanding_cents > 0;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'owing', 'label', 'Who owes',
      'detail', case when coalesce(v_count, 0) = 0 then 'Nobody owes'
                     else '$' || to_char(v_cents / 100.0, 'FM999999990') || ' · ' || v_count end,
      'href', '/admin/payments',
      'count', coalesce(v_count, 0));

    select coalesce(sum(p.amount_cents), 0), count(*) into v_cents, v_count
      from public.payments p
     where p.academy_id = v_academy and p.status = 'paid'
       and coalesce(p.paid_at, p.created_at) >= date_trunc('month', now() at time zone v_tz);
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'collected', 'label', 'Collected',
      'detail', case when coalesce(v_count, 0) = 0 then 'Nothing yet this month'
                     else '$' || to_char(v_cents / 100.0, 'FM999999990') || ' this month' end,
      'href', '/admin/payments',
      'count', 0);

    select count(*) into v_count from public.refunds rf where rf.academy_id = v_academy and rf.status = 'requested';
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'refunds', 'label', 'Refunds',
      'detail', case when coalesce(v_count, 0) = 0 then 'None to issue' else v_count || ' to issue' end,
      'href', '/admin/payments',
      'count', coalesce(v_count, 0));

  -- --------------------------------------------------------------- registrar
  elsif v_persona = 'registrar' then
    select (select count(*) from public.registration_requests rr where rr.academy_id = v_academy and rr.status = 'pending')
         + (select count(*) from public.program_registrations pr where pr.academy_id = v_academy and pr.status = 'pending')
      into v_count;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'registrations', 'label', 'Registrations',
      'detail', case when coalesce(v_count, 0) = 0 then 'None waiting' else v_count || ' waiting' end,
      'href', '/admin/registrations',
      'count', coalesce(v_count, 0));

    select count(*) into v_count from public.players p
     where p.academy_id = v_academy and p.official_status = 'pending';
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'playfootball', 'label', 'PlayFootball',
      'detail', case when coalesce(v_count, 0) = 0 then 'Everyone done' else v_count || ' not done' end,
      'href', '/admin/teams',
      'count', coalesce(v_count, 0));

    select count(*) into v_count from public.offers o
     where o.academy_id = v_academy and o.status = 'open' and o.expires_at > now();
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'offers', 'label', 'Offers',
      'detail', case when coalesce(v_count, 0) = 0 then 'None open' else v_count || ' open' end,
      'href', '/admin/season',
      'count', coalesce(v_count, 0));

  -- ------------------------------------------------------------- coordinator
  elsif v_persona = 'coordinator' then
    select coalesce(array_agg(t.id), '{}') into v_teams
      from public.teams t
     where t.academy_id = v_academy and t.status = 'active'
       and exists (select 1 from public.club_roles r
                    where r.academy_id = v_academy and r.profile_id = v_me and r.role = 'coordinator'
                      and ((r.scope_kind = 'stream' and r.stream_id = t.stream_id)
                           or (r.scope_kind = 'age_group' and r.age_group = t.age_group)));
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'teams', 'label', 'My teams',
      'detail', case when cardinality(v_teams) = 0 then 'No squads in your groups yet' else cardinality(v_teams) || ' squads' end,
      'href', '/admin/teams',
      'count', cardinality(v_teams));

    select count(*) into v_count
      from public.events e
     where e.academy_id = v_academy and e.cancelled_at is null and e.private_to is null
       and e.team_id = any (v_teams) and e.type in ('match', 'tournament')
       and (e.starts_at at time zone v_tz)::date between v_day and v_sun;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'weekend', 'label', 'This weekend',
      'detail', case when coalesce(v_count, 0) = 0 then 'No games' else v_count || ' games' end,
      'href', '/calendar',
      'count', coalesce(v_count, 0));

    v_id := null; v_title := null; v_count := null;
    select c.channel_id, c.name, c.unread_count into v_id, v_title, v_count
      from public.my_channels(v_academy) c
     where c.status = 'active' and c.type = 'coaches' limit 1;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'coaches', 'label', 'Coaches',
      'detail', coalesce(v_title, 'The coaches'' room'),
      'href', case when v_id is null then '/chat' else '/chat/' || v_id end,
      'count', coalesce(v_count, 0));

  -- ----------------------------------------------------------------- manager
  elsif v_persona = 'manager' then
    select coalesce(array_agg(r.team_id), '{}') into v_teams
      from public.club_roles r
     where r.academy_id = v_academy and r.profile_id = v_me and r.role = 'team_manager';

    v_id := null; v_title := null; v_at := null; v_count := null;
    select e.id, e.title, e.starts_at,
           (select count(*) from public.team_members tm
             where tm.team_id = e.team_id and tm.role in ('parent', 'player')
               and not exists (select 1 from public.event_rsvps rs where rs.event_id = e.id and rs.profile_id = tm.profile_id))
      into v_id, v_title, v_at, v_count
      from public.events e
     where e.academy_id = v_academy and e.team_id = any (v_teams) and e.cancelled_at is null and e.private_to is null
       and e.type in ('match', 'tournament') and e.starts_at > now()
     order by e.starts_at limit 1;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'availability', 'label', 'Availability',
      'detail', case when v_id is null then 'No game coming up'
                     when coalesce(v_count, 0) > 0 then v_count || ' not answered · ' || v_title
                     else v_title end,
      'href', case when v_id is null then '/calendar' else '/calendar/' || v_id end,
      'count', coalesce(v_count, 0));

    v_jobs := v_jobs || jsonb_build_object(
      'id', 'sheet', 'label', 'Team sheet',
      'detail', case when v_id is null then 'No game coming up' else v_title || ' · ' || to_char(v_at at time zone v_tz, 'Dy') end,
      'href', case when v_id is null then '/calendar' else '/calendar/' || v_id || '?tab=sheet' end,
      'count', 0);

    v_id := null; v_title := null; v_count := null;
    select c.channel_id, c.name, c.unread_count into v_id, v_title, v_count
      from public.my_channels(v_academy) c
     where c.status = 'active' and c.type = 'team' and c.team_id = any (v_teams)
     order by c.unread_count desc limit 1;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'chat', 'label', 'Team chat',
      'detail', coalesce(v_title, 'The team''s chat'),
      'href', case when v_id is null then '/chat' else '/chat/' || v_id end,
      'count', coalesce(v_count, 0));

  -- ----------------------------------------------------------------- welfare
  elsif v_persona = 'welfare' then
    select count(*) into v_count from public.message_reports mr where mr.academy_id = v_academy and mr.status = 'open';
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'reports', 'label', 'Reports',
      'detail', case when coalesce(v_count, 0) = 0 then 'Nothing open' else v_count || ' open' end,
      'href', '/admin/safeguarding',
      'count', coalesce(v_count, 0));
    select count(*) into v_count from public.conduct_reports cr where cr.academy_id = v_academy and cr.status = 'open';
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'concerns', 'label', 'Concerns',
      'detail', case when coalesce(v_count, 0) = 0 then 'Nothing open' else v_count || ' open' end,
      'href', '/admin/safeguarding',
      'count', coalesce(v_count, 0));
    select count(*) into v_count
      from public.academy_members m
      left join public.staff_clearances c on c.academy_id = m.academy_id and c.profile_id = m.profile_id
     where m.academy_id = v_academy and m.status = 'active'
       and m.roles && array['coach', 'admin']::public.academy_role[]
       and (c.id is null or c.expires_on < current_date + 30 or c.outcome in ('barred', 'not_found'));
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'checks', 'label', 'Checks',
      'detail', case when coalesce(v_count, 0) = 0 then 'Everyone current' else v_count || ' to chase' end,
      'href', '/admin/clearances',
      'count', coalesce(v_count, 0));

  -- -------------------------------------------------------------- volunteers
  elsif v_persona = 'volunteers' then
    select count(*), coalesce(sum(j.spots - (select count(*) from public.event_job_helpers h where h.job_id = j.id)), 0)
      into v_count, v_count2
      from public.event_jobs j
      join public.events e on e.id = j.event_id
     where j.academy_id = v_academy and e.cancelled_at is null
       and e.starts_at between now() and now() + interval '7 days'
       and j.spots > (select count(*) from public.event_job_helpers h where h.job_id = j.id);
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'gaps', 'label', 'This weekend''s gaps',
      'detail', case when coalesce(v_count, 0) = 0 then 'Every job filled' else v_count2 || ' spots across ' || v_count || ' jobs' end,
      'href', '/calendar',
      'count', coalesce(v_count2, 0));
    select count(*) into v_count
      from public.events e
     where e.academy_id = v_academy and e.cancelled_at is null and e.private_to is null
       and e.starts_at between now() and now() + interval '7 days'
       and not exists (select 1 from public.event_jobs j where j.event_id = e.id);
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'rosters', 'label', 'Rosters',
      'detail', case when coalesce(v_count, 0) = 0 then 'Every event has its jobs' else v_count || ' events with no jobs yet' end,
      'href', '/calendar',
      'count', coalesce(v_count, 0));
    v_id := null; v_title := null;
    select c.channel_id, c.name into v_id, v_title
      from public.my_channels(v_academy) c
     where c.status = 'active' and c.type = 'academy_wide' limit 1;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'ask', 'label', 'Ask for help',
      'detail', coalesce(v_title, 'Club-wide chat'),
      'href', case when v_id is null then '/chat' else '/chat/' || v_id end,
      'count', 0);

  -- ------------------------------------------------------------------ league
  else
    select f.competition_id, count(*) into v_comp, v_count
      from public.fixtures f
      join public.competitions c on c.id = f.competition_id
     where c.organiser_id = v_academy and f.status in ('scheduled', 'in_progress')
       and (f.starts_at at time zone v_tz)::date between v_day and v_sun
     group by f.competition_id order by count(*) desc limit 1;
    if v_comp is null then
      select c.id into v_comp from public.competitions c
       where c.organiser_id = v_academy order by c.created_at desc limit 1;
    end if;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'draw', 'label', 'The draw',
      'detail', case when coalesce(v_count, 0) = 0 then 'Nothing this weekend'
                     else v_count || ' games this weekend' end,
      'href', case when v_comp is null then '/competitions' else '/competitions/' || v_comp || '?tab=run' end,
      'count', coalesce(v_count, 0));
    v_today := jsonb_build_object(
      'label', 'This weekend',
      'detail', case when coalesce(v_count, 0) = 0 then 'No games drawn'
                     else v_count || ' games, ' || to_char(v_day, 'Dy DD Mon') || ' to ' || to_char(v_sun, 'Dy DD Mon') end,
      'count', coalesce(v_count, 0),
      'href', case when v_comp is null then '/competitions' else '/competitions/' || v_comp || '?tab=run' end);

    v_comp2 := null; v_count2 := null;
    select f.competition_id, count(*) into v_comp2, v_count2
      from public.fixtures f
      join public.competitions c on c.id = f.competition_id
     where c.organiser_id = v_academy and f.status = 'scheduled'
       and f.starts_at between now() and now() + interval '7 days'
       and not exists (select 1 from public.referee_appointments ra
                        where ra.fixture_id = f.id and ra.role = 'referee' and ra.status = 'accepted')
     group by f.competition_id order by count(*) desc limit 1;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'referees', 'label', 'Referees',
      'detail', case when coalesce(v_count2, 0) = 0 then 'Every game covered'
                     else v_count2 || case when v_count2 = 1 then ' game' else ' games' end || ' without a referee' end,
      'href', case when coalesce(v_comp2, v_comp) is null then '/competitions'
                   else '/competitions/' || coalesce(v_comp2, v_comp) || '?tab=referees' end,
      'count', coalesce(v_count2, 0));

    v_comp2 := null; v_count2 := null; v_count := null;
    select f.competition_id,
           count(*) filter (where f.score_disputed),
           count(*) filter (where not f.score_disputed)
      into v_comp2, v_count, v_count2
      from public.fixtures f
      join public.competitions c on c.id = f.competition_id
     where c.organiser_id = v_academy
       and (
         f.score_disputed
         or (f.starts_at between now() - interval '7 days' and now()
             and f.status in ('scheduled', 'in_progress', 'final')
             and (select count(*) from public.match_sheets ms where ms.fixture_id = f.id) < 2)
       )
     group by f.competition_id order by count(*) desc limit 1;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'results', 'label', 'Results',
      'detail', case when coalesce(v_count, 0) + coalesce(v_count2, 0) = 0 then 'Nothing to resolve'
                     else concat_ws(' · ',
                            case when coalesce(v_count, 0) > 0 then v_count || ' disputed' end,
                            case when coalesce(v_count2, 0) > 0 then v_count2 || ' sheets missing' end) end,
      'href', case when coalesce(v_comp2, v_comp) is null then '/competitions'
                   else '/competitions/' || coalesce(v_comp2, v_comp) || '?tab=run' end,
      'count', coalesce(v_count, 0) + coalesce(v_count2, 0));
  end if;

  -- The latest announcement in a channel this person is in.
  select jsonb_build_object(
           'id', m.id, 'channel_id', m.channel_id, 'channel_name', c.name,
           'body', left(m.body, 280), 'sender_name', p.full_name, 'created_at', m.created_at,
           'relevant_until', m.relevant_until,
           'reply_count', (select count(*) from public.messages x
                            where x.reply_to_id = m.id and x.status = 'published' and x.deleted_at is null))
    into v_ann
    from public.messages m
    join public.channel_members cm on cm.channel_id = m.channel_id and cm.profile_id = v_me
    join public.channels c on c.id = m.channel_id
    left join public.profiles p on p.id = m.sender_id
   where m.academy_id = v_academy and m.is_announcement
     and m.status = 'published' and m.deleted_at is null
     and (m.relevant_until is null or m.relevant_until > now())
   order by m.created_at desc limit 1;

  -- Everywhere else this person belongs, for the one-tap switch.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id, 'name', o.name, 'type', o.type, 'role', o.role,
           'persona', (app_private.home_personas(o.id, v_me))[1],
           'primary_colour', o.primary_colour) order by o.name), '[]'::jsonb)
    into v_switch
    from public.my_organisations() o
   where o.id <> v_academy;

  return jsonb_build_object(
    'academy_id', v_academy,
    'role', v_role,
    'persona', v_persona,
    'hats', to_jsonb(v_personas),
    'jobs', v_jobs,
    'today', v_today,
    'announcement', v_ann,
    'switch', v_switch);
end;
$$;


-- The Roles screen's members carry their hats (0236's club_officials, with
-- `roles` beside `role`).
create or replace function public.club_officials(p_academy uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
begin
  if auth.uid() is null or not app_private.may_run_club(p_academy, 'club') then
    return null;
  end if;
  return jsonb_build_object(
    'club_mode', (select a.club_mode from public.academies a where a.id = p_academy),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'profile_id', r.profile_id, 'name', coalesce(p.full_name, 'Unnamed'),
               'role', r.role, 'scope_kind', r.scope_kind,
               'scope', case r.scope_kind
                          when 'club' then 'Whole club'
                          when 'stream' then (select s.name from public.streams s where s.id = r.stream_id)
                          when 'age_group' then r.age_group
                          when 'team' then (select t.name from public.teams t where t.id = r.team_id)
                        end,
               'cleared', app_private.has_current_clearance(p_academy, r.profile_id))
             order by p.full_name, r.role)
        from public.club_roles r join public.profiles p on p.id = r.profile_id
       where r.academy_id = p_academy), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('profile_id', m.profile_id, 'name', coalesce(p.full_name, 'Unnamed'), 'role', m.role, 'roles', to_jsonb(m.roles),
                                          'cleared', app_private.has_current_clearance(p_academy, m.profile_id))
             order by p.full_name)
        from public.academy_members m join public.profiles p on p.id = m.profile_id
       where m.academy_id = p_academy and m.status = 'active'), '[]'::jsonb),
    'streams', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by s.sort_order, s.name)
        from public.streams s where s.academy_id = p_academy), '[]'::jsonb),
    'age_groups', coalesce((
      select jsonb_agg(distinct t.age_group) from public.teams t where t.academy_id = p_academy and t.status = 'active'), '[]'::jsonb),
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'age_group', t.age_group) order by t.age_group, t.name)
        from public.teams t where t.academy_id = p_academy and t.status = 'active'), '[]'::jsonb));
end;
$fn$;

-- ================================================================== grants

revoke execute on function app_private.strongest_role(public.academy_role[]) from public, anon, authenticated;
revoke execute on function app_private.sync_member_roles() from public, anon, authenticated;
revoke execute on function app_private.on_club_role_channels() from public, anon, authenticated;
revoke execute on function app_private.home_personas(uuid, uuid) from public, anon, authenticated;
-- member_roles_of and holds_role sit behind helpers that policies call as the
-- signed-in role; like is_academy_staff they must be executable by it.
revoke execute on function app_private.member_roles_of(uuid) from public, anon;
grant execute on function app_private.member_roles_of(uuid) to authenticated;
revoke execute on function app_private.holds_role(uuid, public.academy_role) from public, anon;
grant execute on function app_private.holds_role(uuid, public.academy_role) to authenticated;

revoke execute on function public.home_jobs(uuid, text) from public, anon;
grant execute on function public.home_jobs(uuid, text) to authenticated;
revoke execute on function public.add_member_role(uuid, uuid, public.academy_role) from public, anon;
grant execute on function public.add_member_role(uuid, uuid, public.academy_role) to authenticated;
revoke execute on function public.remove_member_role(uuid, uuid, public.academy_role) from public, anon;
grant execute on function public.remove_member_role(uuid, uuid, public.academy_role) to authenticated;
