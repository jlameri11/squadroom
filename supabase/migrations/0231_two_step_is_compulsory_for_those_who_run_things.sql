-- 0231: two-step sign-in is compulsory for the people who run a club or a league.
--
-- Joey, 9 Nov 2026 (NEEDS JOEY #22): compulsory for owners, admins and
-- league staff; optional for coaches and parents.
--
-- 0224 made the database honour two-step for everyone who had turned it on.
-- The hole it left: an owner who never turned it on kept every power with a
-- password alone. Now an organisation can REQUIRE it: at such an
-- organisation its owners, admins and league staff have their powers only
-- in a session that has done the second step — no authenticator app, or a
-- password alone, and the powers are not there. Coaches are asked, never
-- forced (0224 still holds anyone to a choice they made); families are
-- untouched.
--
-- NEW ORGANISATIONS REQUIRE IT FROM THE DAY THEY ARE MADE. The ones that
-- exist already do not, until an owner turns it on in Settings — one way,
-- with the consequence said plainly: every owner and admin without an
-- authenticator app meets a wall on their next open until they set one up.
-- Switching the demo's clubs and the SPL on is Joey's call.
--
-- The app's half: components/two-step-wall.tsx asks two_step_status() and
-- walls a person who is required and not enrolled until they enrol; the
-- 0224 gate still takes the six digits from one who is.

alter table public.academies add column if not exists two_step_required boolean not null default true;
-- Grandfathered: what exists today keeps working until its owner turns it on.
update public.academies set two_step_required = false;

/** Whether this session may use a person's powers AT this organisation: where two-step is required, only with the second step done. */
create or replace function app_private.two_step_ok_for(p_academy uuid)
returns boolean
language plpgsql stable security definer set search_path = public as $fn$
begin
  if exists (select 1 from public.academies a where a.id = p_academy and a.two_step_required) then
    return coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
  end if;
  return app_private.two_step_ok();
end;
$fn$;

create or replace function app_private.academy_role_of(p_academy uuid)
returns public.academy_role
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_role public.academy_role;
begin
  select m.role into v_role from public.academy_members m
   where m.academy_id = p_academy and m.profile_id = auth.uid() and m.status = 'active';
  -- Owners and admins: the organisation's rule. Coaches: their own choice.
  if v_role in ('owner', 'admin') then
    if not app_private.two_step_ok_for(p_academy) then
      return null;
    end if;
  elsif v_role = 'coach' then
    if not app_private.two_step_ok() then
      return null;
    end if;
  end if;
  return v_role;
end;
$fn$;

create or replace function app_private.league_roles_of(p_academy uuid)
returns public.league_role[]
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_roles public.league_role[];
begin
  select coalesce(array_agg(role), '{}') into v_roles
    from public.league_roles
   where academy_id = p_academy and profile_id = auth.uid();
  if cardinality(v_roles) > 0 and not app_private.two_step_ok_for(p_academy) then
    return '{}';
  end if;
  return v_roles;
end;
$fn$;

-- A competition's Notices (0213) work out who the league is from the
-- tables themselves; the league's standing follows the same rule.
create or replace function app_private.notices_standing(p_competition uuid, p_profile uuid)
returns text
language sql stable security definer set search_path = public as $$
  with c as (
    select id, organiser_id from public.competitions where id = p_competition
  ),
  clubs as (
    select cc.academy_id from public.competition_clubs cc
     where cc.competition_id = p_competition and cc.status = 'active'
    union
    select organiser_id from c
  ),
  teams as (
    select ce.team_id from public.competition_entries ce
     where ce.competition_id = p_competition
       and ce.team_id is not null
       and ce.academy_id in (select academy_id from clubs)
  )
  select case
    when p_profile is null or not exists (select 1 from c) then null
    when (exists (select 1 from public.academy_members am join c on am.academy_id = c.organiser_id
                   where am.profile_id = p_profile and am.status = 'active' and am.role in ('owner', 'admin'))
          or exists (select 1 from public.league_roles lr join c on lr.academy_id = c.organiser_id
                      where lr.profile_id = p_profile and lr.role = 'competition_manager'))
         and (p_profile <> auth.uid() or app_private.two_step_ok_for((select organiser_id from c)))
      then 'league'
    when exists (select 1 from public.league_roles lr join c on lr.academy_id = c.organiser_id
                  where lr.profile_id = p_profile)
      or exists (select 1 from public.academy_members am
                  where am.profile_id = p_profile and am.status = 'active' and am.role in ('owner', 'admin', 'coach')
                    and am.academy_id in (select academy_id from clubs))
      or exists (select 1 from public.team_members tm
                  where tm.profile_id = p_profile and tm.role = 'coach'
                    and tm.team_id in (select team_id from teams))
      then 'staff'
    when exists (select 1 from public.team_members tm
                  where tm.profile_id = p_profile and tm.role in ('parent', 'player')
                    and tm.team_id in (select team_id from teams))
      then 'family'
    when exists (select 1 from public.referees r join c on r.academy_id = c.organiser_id
                  where r.profile_id = p_profile and r.status = 'active')
      then 'referee'
  end;
$$;

/** An owner turns the requirement on for their organisation. One way: there is no turning it off. */
create or replace function public.require_two_step(p_academy uuid)
returns boolean
language plpgsql volatile security definer set search_path = public as $fn$
begin
  if app_private.academy_role_of(p_academy) is distinct from 'owner' then
    raise exception 'only an owner makes two-step sign-in compulsory for the club' using errcode = '42501';
  end if;
  update public.academies set two_step_required = true where id = p_academy;
  return true;
end;
$fn$;

/**
 * For the app's wall: is this person required to have two-step on (an owner,
 * admin or league staff somewhere that requires it), have they enrolled,
 * and has this session done the second step. Read from the tables
 * themselves, so the rule that hides their powers cannot hide the reason.
 */
create or replace function public.two_step_status()
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_where text;
begin
  if auth.uid() is null then
    return null;
  end if;
  select a.name into v_where from public.academies a
   where a.two_step_required
     and (exists (select 1 from public.academy_members am
                   where am.academy_id = a.id and am.profile_id = auth.uid() and am.status = 'active' and am.role in ('owner', 'admin'))
          or exists (select 1 from public.league_roles lr where lr.academy_id = a.id and lr.profile_id = auth.uid()))
   order by a.name
   limit 1;
  return jsonb_build_object(
    'required', v_where is not null,
    'where', v_where,
    'enrolled', exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified'),
    'aal2', coalesce(auth.jwt() ->> 'aal', '') = 'aal2');
end;
$fn$;

revoke execute on function public.require_two_step(uuid) from public, anon;
revoke execute on function public.two_step_status() from public, anon;
grant execute on function public.require_two_step(uuid) to authenticated;
grant execute on function public.two_step_status() to authenticated;
