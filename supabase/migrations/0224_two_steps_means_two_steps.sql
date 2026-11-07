-- 0224: two steps means two steps.
--
-- S-07, the database's half. Settings → Two-step sign-in (4 Nov) turns it
-- on, and the app puts a gate above every page until the six digits are
-- typed — but nothing in the database asked. A script holding the password
-- alone signs in at "aal1" and calls the same functions the app does, so an
-- owner's two-step protected the screens and not the club.
--
-- ONE RULE, IN THE HELPERS EVERY POLICY ALREADY USES: a person who has
-- turned two-step on, in a session that has not done the second step, has
-- no staff, coaching, league or platform powers. They stay a member — they
-- read what any member reads, and a parent's own child is still theirs — so
-- someone who coaches one squad and is a parent in another loses only the
-- coaching until they type the six digits.
--   academy_role_of   — owner, admin and coach come back as no role; every
--                       is_academy_staff and is_academy_coach goes through it.
--   is_team_coach     — its own team_members path asks too.
--   league_roles_of   — no league role (may_run, so every league power).
--   is_platform_admin — not a platform admin.
-- Chat hosting follows channel membership and is not covered here; the
-- app's gate stands in front of it.
--
-- NOT YET "MANDATORY". A staff member who has never turned two-step on
-- keeps working with a password, as today. Making it mandatory for owners
-- and admins is a date for Joey (NEEDS JOEY): on that day every owner
-- without it is locked out of their own admin until they enrol.
--
-- The service role (no person), and everyone without a verified factor, are
-- untouched.
--
-- IN PL/pgSQL, ON PURPOSE. These are the most-called functions in the
-- database. A SQL-language function is planned again on every call (Postgres
-- 17), and the nested check made each staff test 44 µs, from 19; PL/pgSQL
-- keeps its plans for the session, and the same rule costs 6 µs — less than
-- before (measured on the demo copy, 100,000 calls; docs/SCALE.md).

/** True when this session may use a person's powers: the second step was done, or they never turned it on. */
create or replace function app_private.two_step_ok()
returns boolean
language plpgsql stable security definer set search_path = public as $fn$
begin
  return coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      or not exists (
        select 1 from auth.mfa_factors f
         where f.user_id = auth.uid() and f.status = 'verified');
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
  -- The factor is looked up only for a staff role.
  if v_role in ('owner', 'admin', 'coach') and not app_private.two_step_ok() then
    return null;
  end if;
  return v_role;
end;
$fn$;

-- 0169's rule (a coach of the squad, or the club's staff; never with a
-- lapsed check), with the squad's coach asked for the second step too.
create or replace function app_private.is_team_coach(p_team uuid)
returns boolean
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_academy uuid;
begin
  select t.academy_id into v_academy from public.teams t where t.id = p_team;
  if v_academy is null or app_private.clearance_lapsed(v_academy, auth.uid()) then
    return false;
  end if;
  if exists (select 1 from public.team_members m
              where m.team_id = p_team and m.profile_id = auth.uid() and m.role = 'coach')
     and app_private.two_step_ok() then
    return true;
  end if;
  return coalesce(app_private.is_academy_staff(v_academy), false);
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
  if cardinality(v_roles) > 0 and not app_private.two_step_ok() then
    return '{}';
  end if;
  return v_roles;
end;
$fn$;

create or replace function app_private.is_platform_admin()
returns boolean
language plpgsql stable security definer set search_path = public as $fn$
begin
  return exists (select 1 from public.platform_admins where profile_id = auth.uid())
     and app_private.two_step_ok();
end;
$fn$;

/**
 * The database's own answer to "does this session still owe the six
 * digits?" — true when the person has turned two-step on and this session
 * has not done it. For the app's gate, and for the suites to know 0224 is in.
 */
create or replace function public.two_step_needed()
returns boolean
language plpgsql stable security definer set search_path = public as $fn$
begin
  return auth.uid() is not null and not app_private.two_step_ok();
end;
$fn$;
revoke execute on function public.two_step_needed() from public, anon;
grant execute on function public.two_step_needed() to authenticated;
