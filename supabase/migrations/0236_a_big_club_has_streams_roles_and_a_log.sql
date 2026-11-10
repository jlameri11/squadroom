-- 0236: a big club has streams, roles with a scope, and a log of who did what.
--
-- Big Club Mode, Phase 1, step 1 (Joey, 9 Nov 2026; docs/BIG_CLUB_MODE.md,
-- items 1, 2 and 13; the audit of 10 Nov decided what to reuse):
--   * Club mode (`academies.club_mode`): on for every club signed up from
--     now, switchable on by an owner anywhere. Streams (club-defined, e.g.
--     MiniRoos, Juniors, Girls, Women, NPL, Seniors, Over-35s) on teams; a
--     team's gender and home ground; age groups beyond U18 (Open, Over-35).
--   * Club roles, several per person, each with a scope — President,
--     Secretary (the whole club), Registrar, Treasurer, Welfare officer,
--     Volunteer coordinator (the whole club, their own area), Coordinator
--     (a stream or an age group), Team manager (one team) — in their own
--     table beside `academy_members`, as `league_roles` sits beside it for a
--     league. Rights flow through the helpers every policy already uses:
--     `is_team_coach` is true for a team's manager and a coordinator whose
--     scope covers it; the money policies accept a Treasurer; the
--     registration policies a Registrar; `is_safeguarding_officer` the
--     Welfare officer. Nothing new compares `academy_members.role`.
--   * An activity log: who changed what, when — roles, members, teams,
--     streams, fees, payments' status, refunds, call-offs — kept for the
--     committee after the committee changes.
--
-- Not club-only: an academy that never switches club mode on sees none of
-- it and loses nothing.

-- ================================================================ club mode

alter table public.academies add column if not exists club_mode boolean not null default false;

-- ================================================================== streams

create table if not exists public.streams (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 40),
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  constraint streams_name_unique unique (academy_id, name),
  constraint streams_id_academy_key unique (id, academy_id)
);
alter table public.streams enable row level security;
grant select, insert, update, delete on public.streams to authenticated;

-- ============================================================ team fields

alter table public.teams add column if not exists stream_id uuid;
alter table public.teams add column if not exists gender public.player_gender;
alter table public.teams add column if not exists home_venue_id uuid;
do $$ begin
  alter table public.teams add constraint teams_stream_fkey
    foreign key (stream_id, academy_id) references public.streams (id, academy_id) on delete set null;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.teams add constraint teams_home_venue_fkey
    foreign key (home_venue_id, academy_id) references public.venues (id, academy_id) on delete set null;
exception when duplicate_object then null; end $$;
create index if not exists teams_stream_idx on public.teams (academy_id, stream_id);

-- Age groups past U18: seniors, women, over-35s. The same shape wherever an
-- age group is written: U5…U99, Open, Over-30/35/…/95.
do $$
declare c record;
begin
  for c in
    select conname, conrelid::regclass as rel
      from pg_constraint
     where contype = 'c'
       and conrelid in ('public.teams'::regclass, 'public.channels'::regclass, 'public.pitch_size_rules'::regclass)
       and pg_get_constraintdef(oid) ilike '%age_group%~%'
  loop
    execute format('alter table %s drop constraint %I', c.rel, c.conname);
  end loop;
end $$;
alter table public.teams add constraint teams_age_group_shape
  check (age_group ~ '^(U([5-9]|[1-9][0-9])|Open|Over-[3-9][05])$');
alter table public.channels add constraint channels_age_group_shape
  check (age_group is null or age_group ~ '^(U([5-9]|[1-9][0-9])|Open|Over-[3-9][05])$');
alter table public.pitch_size_rules add constraint pitch_size_rules_age_group_shape
  check (age_group ~ '^(U([5-9]|[1-9][0-9])|Open|Over-[3-9][05])$');

-- ============================================================== club roles

do $$ begin
  create type public.club_role as enum (
    'president', 'secretary', 'registrar', 'treasurer',
    'coordinator', 'team_manager', 'welfare_officer', 'volunteer_coordinator');
exception when duplicate_object then null; end $$;

create table if not exists public.club_roles (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  role        public.club_role not null,
  -- The scope: the whole club, one stream, one age group, or one team.
  scope_kind  text not null default 'club' check (scope_kind in ('club', 'stream', 'age_group', 'team')),
  stream_id   uuid,
  age_group   text,
  team_id     uuid,
  granted_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint club_roles_scope_shape check (
       (scope_kind = 'club'      and stream_id is null     and age_group is null     and team_id is null)
    or (scope_kind = 'stream'    and stream_id is not null and age_group is null     and team_id is null)
    or (scope_kind = 'age_group' and stream_id is null     and age_group is not null and team_id is null)
    or (scope_kind = 'team'      and stream_id is null     and age_group is null     and team_id is not null)),
  -- A coordinator runs a stream or an age group; a manager one team; the
  -- rest run the whole club.
  constraint club_roles_fit check (
       (role = 'coordinator'  and scope_kind in ('stream', 'age_group'))
    or (role = 'team_manager' and scope_kind = 'team')
    or (role not in ('coordinator', 'team_manager') and scope_kind = 'club')),
  constraint club_roles_once unique nulls not distinct (academy_id, profile_id, role, scope_kind, stream_id, age_group, team_id),
  constraint club_roles_stream_fkey foreign key (stream_id, academy_id) references public.streams (id, academy_id) on delete cascade,
  constraint club_roles_team_fkey   foreign key (team_id, academy_id)   references public.teams (id, academy_id)   on delete cascade
);
alter table public.club_roles enable row level security;
create index if not exists club_roles_profile_idx on public.club_roles (profile_id);
create index if not exists club_roles_academy_idx on public.club_roles (academy_id, role);
grant select on public.club_roles to authenticated;
-- Writes go through grant_club_role / revoke_club_role only.

-- The caller's club roles here. People who run things prove their session
-- the way owners and admins do (0231/0232), and a lapsed Working With
-- Children Check takes every club role's rights away until renewed (0169).
create or replace function app_private.club_roles_of(p_academy uuid)
returns public.club_role[]
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_roles public.club_role[];
begin
  if auth.uid() is null then
    return '{}';
  end if;
  select coalesce(array_agg(distinct r.role), '{}') into v_roles
    from public.club_roles r
   where r.academy_id = p_academy and r.profile_id = auth.uid();
  if coalesce(array_length(v_roles, 1), 0) = 0 then
    return '{}';
  end if;
  if not app_private.two_step_ok_for(p_academy) or app_private.clearance_lapsed(p_academy, auth.uid()) then
    return '{}';
  end if;
  return v_roles;
end;
$fn$;

create or replace function app_private.has_club_role(p_academy uuid, p_role public.club_role)
returns boolean
language sql stable security definer set search_path = public as $fn$
  select p_role = any (app_private.club_roles_of(p_academy));
$fn$;

-- May I run this area of the club? Owners and admins: everything, as
-- before. Otherwise by role:
--   club           President, Secretary (roles, settings, the log)
--   money          + Treasurer       (fees, payments, vouchers, refunds, reports)
--   registrations  + Registrar       (registrations, offers, waitlists,
--                                     player records, PlayFootball status)
--   teams          + Coordinator     (the teams in their scope — runs_team
--                                     decides which)
--   volunteers     + Volunteer coordinator
--   welfare        President, Welfare officer (never the Secretary alone:
--                                     a report names a child)
--   comms          anyone holding a club role (what they may send to is
--                                     their own area — Message the club)
create or replace function app_private.may_run_club(p_academy uuid, p_area text)
returns boolean
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_roles public.club_role[];
begin
  if p_academy is null then
    return false;
  end if;
  if coalesce(app_private.is_academy_staff(p_academy), false) then
    return true;
  end if;
  v_roles := app_private.club_roles_of(p_academy);
  if coalesce(array_length(v_roles, 1), 0) = 0 then
    return false;
  end if;
  return case p_area
    when 'club'          then 'president' = any (v_roles) or 'secretary' = any (v_roles)
    when 'money'         then 'president' = any (v_roles) or 'secretary' = any (v_roles) or 'treasurer' = any (v_roles)
    when 'registrations' then 'president' = any (v_roles) or 'secretary' = any (v_roles) or 'registrar' = any (v_roles)
    when 'teams'         then 'president' = any (v_roles) or 'secretary' = any (v_roles) or 'coordinator' = any (v_roles)
    when 'volunteers'    then 'president' = any (v_roles) or 'secretary' = any (v_roles) or 'volunteer_coordinator' = any (v_roles)
    when 'welfare'       then 'president' = any (v_roles) or 'welfare_officer' = any (v_roles)
    when 'comms'         then true
    else false
  end;
end;
$fn$;

-- Does the caller run this team through a club role: its manager, or a
-- coordinator whose stream or age group it is in? (Owners, admins and the
-- team's coaches are is_team_coach's own business.)
create or replace function app_private.runs_team(p_team uuid, p_managers boolean default true)
returns boolean
language plpgsql stable security definer set search_path = public as $fn$
declare
  t public.teams;
begin
  select * into t from public.teams where id = p_team;
  if t.id is null or auth.uid() is null then
    return false;
  end if;
  if coalesce(array_length(app_private.club_roles_of(t.academy_id), 1), 0) = 0 then
    return false;
  end if;
  return exists (
    select 1 from public.club_roles r
     where r.academy_id = t.academy_id and r.profile_id = auth.uid()
       and (
         (r.role = 'coordinator' and r.scope_kind = 'stream' and r.stream_id = t.stream_id)
         or (r.role = 'coordinator' and r.scope_kind = 'age_group' and r.age_group = t.age_group)
         or (p_managers and r.role = 'team_manager' and r.team_id = t.id)));
end;
$fn$;

-- A team's tools follow the people who run it: its coaches (as before),
-- club staff, its manager and the coordinator over it.
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
  if coalesce(app_private.is_academy_staff(v_academy), false) then
    return true;
  end if;
  return app_private.runs_team(p_team, true);
end;
$fn$;

-- Player development (reports, ratings) is coaching: the team's coaches,
-- club staff and the coordinator over the team — not the team manager,
-- whose job is the running of the team (Joey: "not coaching settings").
create or replace function app_private.may_develop(p_player uuid)
returns boolean language plpgsql stable security definer set search_path = public as $fn$
declare
  p public.players;
begin
  select * into p from public.players where id = p_player;
  if p.id is null then
    return false;
  end if;
  if coalesce(app_private.is_academy_staff(p.academy_id), false) then
    return true;
  end if;
  if p.team_id is null then
    return false;
  end if;
  if app_private.clearance_lapsed(p.academy_id, auth.uid()) then
    return false;
  end if;
  if exists (select 1 from public.team_members m
              where m.team_id = p.team_id and m.profile_id = auth.uid() and m.role = 'coach')
     and app_private.two_step_ok() then
    return true;
  end if;
  return app_private.runs_team(p.team_id, false);
end;
$fn$;

-- The Welfare officer is the safeguarding officer under the brief's name;
-- the appointment also goes into safeguarding_officers (0108), which every
-- existing screen and policy reads.
create or replace function app_private.is_safeguarding_officer(p_academy uuid)
returns boolean
language sql stable security definer set search_path = public as $fn$
  select coalesce(
    exists (
      select 1 from public.safeguarding_officers o
       where o.academy_id = p_academy and o.profile_id = auth.uid()
    )
    or app_private.academy_role_of(p_academy) = 'owner'
    or app_private.has_club_role(p_academy, 'welfare_officer'),
    false
  );
$fn$;

-- ------------------------------------------------------------- granting

-- Owners, admins, the President and the Secretary hand out roles. The
-- person must already be a member. A role around children needs a current
-- Working With Children Check on record (the 0120 rule for coaches and
-- admins): everyone but the Treasurer, who sees money, not children.
create or replace function public.grant_club_role(
  p_academy    uuid,
  p_profile    uuid,
  p_role       public.club_role,
  p_scope_kind text default 'club',
  p_stream     uuid default null,
  p_age_group  text default null,
  p_team       uuid default null
) returns uuid
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_id uuid;
begin
  if auth.uid() is null or not app_private.may_run_club(p_academy, 'club') then
    raise exception 'only the club''s owners, admins, President or Secretary hand out roles' using errcode = '42501';
  end if;
  if not exists (select 1 from public.academy_members m
                  where m.academy_id = p_academy and m.profile_id = p_profile and m.status = 'active') then
    raise exception 'they need to join the club first — send them the club''s join link' using errcode = '22023';
  end if;
  if p_role <> 'treasurer' and not app_private.has_current_clearance(p_academy, p_profile) then
    raise exception 'That person has no current Working With Children Check recorded. Record it under Admin → Working With Children Checks first.'
      using errcode = '42501';
  end if;
  if p_scope_kind = 'team' and not exists (select 1 from public.teams t where t.id = p_team and t.academy_id = p_academy) then
    raise exception 'that team is not this club''s' using errcode = '22023';
  end if;
  if p_scope_kind = 'stream' and not exists (select 1 from public.streams s where s.id = p_stream and s.academy_id = p_academy) then
    raise exception 'that stream is not this club''s' using errcode = '22023';
  end if;

  insert into public.club_roles (academy_id, profile_id, role, scope_kind, stream_id, age_group, team_id, granted_by)
  values (p_academy, p_profile, p_role, coalesce(p_scope_kind, 'club'),
          case when p_scope_kind = 'stream' then p_stream end,
          case when p_scope_kind = 'age_group' then p_age_group end,
          case when p_scope_kind = 'team' then p_team end,
          auth.uid())
  on conflict on constraint club_roles_once do update set granted_by = excluded.granted_by
  returning id into v_id;

  if p_role = 'welfare_officer' then
    insert into public.safeguarding_officers (academy_id, profile_id, appointed_by)
    values (p_academy, p_profile, auth.uid())
    on conflict do nothing;
  end if;
  return v_id;
end;
$fn$;

create or replace function public.revoke_club_role(p_role_id uuid)
returns void
language plpgsql volatile security definer set search_path = public as $fn$
declare
  r public.club_roles;
begin
  select * into r from public.club_roles where id = p_role_id;
  if r.id is null then
    return;
  end if;
  if auth.uid() is null or not app_private.may_run_club(r.academy_id, 'club') then
    raise exception 'only the club''s owners, admins, President or Secretary take roles away' using errcode = '42501';
  end if;
  delete from public.club_roles where id = p_role_id;
  if r.role = 'welfare_officer' and not exists (
      select 1 from public.club_roles x where x.academy_id = r.academy_id and x.profile_id = r.profile_id and x.role = 'welfare_officer') then
    delete from public.safeguarding_officers where academy_id = r.academy_id and profile_id = r.profile_id;
  end if;
end;
$fn$;

-- The Roles screen: who holds what, with its scope spelt out; the members
-- who could; the streams, age groups and teams a scope can name. For the
-- people who hand out roles.
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
      select jsonb_agg(jsonb_build_object('profile_id', m.profile_id, 'name', coalesce(p.full_name, 'Unnamed'), 'role', m.role,
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

-- What may I do here? The screens ask once; every function checks for itself.
create or replace function public.my_club_access(p_academy uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_areas text[] := '{}';
  a text;
begin
  if auth.uid() is null then
    return jsonb_build_object('areas', '[]'::jsonb, 'roles', '[]'::jsonb);
  end if;
  if coalesce(app_private.is_academy_staff(p_academy), false) then v_areas := array_append(v_areas, 'staff'); end if;
  foreach a in array array['club', 'money', 'registrations', 'teams', 'volunteers', 'welfare', 'comms'] loop
    if app_private.may_run_club(p_academy, a) then v_areas := array_append(v_areas, a); end if;
  end loop;
  return jsonb_build_object(
    'areas', to_jsonb(v_areas),
    'roles', to_jsonb(app_private.club_roles_of(p_academy)),
    'scopes', coalesce((
      select jsonb_agg(jsonb_build_object('role', r.role, 'scope_kind', r.scope_kind, 'stream_id', r.stream_id, 'age_group', r.age_group, 'team_id', r.team_id))
        from public.club_roles r where r.academy_id = p_academy and r.profile_id = auth.uid()), '[]'::jsonb),
    'club_mode', (select x.club_mode from public.academies x where x.id = p_academy));
end;
$fn$;

-- Club mode, switched on: the brief's streams are offered ready-named, and
-- the committee's tools appear. Owners (and the President) only; one way
-- here — turning it off again is a Settings question for later.
create or replace function public.enable_club_mode(p_academy uuid)
returns boolean
language plpgsql volatile security definer set search_path = public as $fn$
begin
  if not (app_private.academy_role_of(p_academy) = 'owner' or app_private.has_club_role(p_academy, 'president')) then
    raise exception 'only an owner switches club mode on' using errcode = '42501';
  end if;
  update public.academies set club_mode = true where id = p_academy;
  insert into public.streams (academy_id, name, sort_order)
  select p_academy, s.name, s.n
    from (values ('MiniRoos', 1), ('Juniors', 2), ('Girls', 3), ('Women', 4), ('NPL', 5), ('Community', 6), ('Seniors', 7), ('Over-35s', 8)) s (name, n)
   where not exists (select 1 from public.streams x where x.academy_id = p_academy)
  on conflict do nothing;
  return true;
end;
$fn$;

-- A club signed up from now starts in club mode with the streams ready.
create or replace function app_private.on_academy_club_mode()
returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if new.type = 'club' then
    update public.academies set club_mode = true where id = new.id and not club_mode;
    insert into public.streams (academy_id, name, sort_order)
    select new.id, s.name, s.n
      from (values ('MiniRoos', 1), ('Juniors', 2), ('Girls', 3), ('Women', 4), ('NPL', 5), ('Community', 6), ('Seniors', 7), ('Over-35s', 8)) s (name, n)
    on conflict do nothing;
  end if;
  return new;
end;
$fn$;
drop trigger if exists academies_club_mode on public.academies;
create trigger academies_club_mode
  after insert on public.academies
  for each row execute function app_private.on_academy_club_mode();

-- ================================================================= policies

-- Streams: everyone in the club reads them; the people who run teams write them.
drop policy if exists streams_select on public.streams;
create policy streams_select on public.streams for select to authenticated
  using ((select app_private.is_academy_member(academy_id)));
drop policy if exists streams_write on public.streams;
create policy streams_insert on public.streams for insert to authenticated
  with check ((select app_private.may_run_club(academy_id, 'teams')));
create policy streams_update on public.streams for update to authenticated
  using ((select app_private.may_run_club(academy_id, 'teams')))
  with check ((select app_private.may_run_club(academy_id, 'teams')));
create policy streams_delete on public.streams for delete to authenticated
  using ((select app_private.may_run_club(academy_id, 'teams')));

-- Club roles: everyone in the club may see who holds what (a family finds
-- its Welfare officer that way). Writes only through the functions.
drop policy if exists club_roles_select on public.club_roles;
create policy club_roles_select on public.club_roles for select to authenticated
  using ((select app_private.is_academy_member(academy_id)));

-- Teams: a FOR ALL policy was also a SELECT policy (CLAUDE.md); split, and
-- the people who run a team may change it.
drop policy if exists teams_write on public.teams;
drop policy if exists teams_insert on public.teams;
drop policy if exists teams_update on public.teams;
drop policy if exists teams_delete on public.teams;
create policy teams_insert on public.teams for insert to authenticated
  with check ((select app_private.may_run_club(academy_id, 'club')));
create policy teams_update on public.teams for update to authenticated
  using ((select app_private.may_run_club(academy_id, 'club')) or (select app_private.runs_team(id)))
  with check ((select app_private.may_run_club(academy_id, 'club')) or (select app_private.runs_team(id)));
create policy teams_delete on public.teams for delete to authenticated
  using ((select app_private.may_run_club(academy_id, 'club')));

-- The safeguarding officers' table: the President appoints as staff do.
drop policy if exists safeguarding_officers_write on public.safeguarding_officers;
create policy safeguarding_officers_write on public.safeguarding_officers for all to authenticated
  using ((select app_private.may_run_club(academy_id, 'club')))
  with check ((select app_private.may_run_club(academy_id, 'club')));

-- Money: the Treasurer, beside owners and admins. Billing (the Stripe
-- connection) stays the owner's. Medical records are untouched: a
-- Treasurer is not staff and never reads them.
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments for select to authenticated
  using (profile_id = (select auth.uid()) or (select app_private.may_run_club(academy_id, 'money')));
drop policy if exists payment_requests_insert on public.payment_requests;
create policy payment_requests_insert on public.payment_requests for insert to authenticated
  with check ((select app_private.may_run_club(academy_id, 'money')));
drop policy if exists payment_requests_update on public.payment_requests;
create policy payment_requests_update on public.payment_requests for update to authenticated
  using ((select app_private.may_run_club(academy_id, 'money')))
  with check ((select app_private.may_run_club(academy_id, 'money')));
drop policy if exists payment_requests_delete on public.payment_requests;
create policy payment_requests_delete on public.payment_requests for delete to authenticated
  using ((select app_private.may_run_club(academy_id, 'money')));
drop policy if exists vouchers_staff on public.vouchers;
create policy vouchers_staff on public.vouchers for all to authenticated
  using ((select app_private.may_run_club(academy_id, 'money')))
  with check ((select app_private.may_run_club(academy_id, 'money')));
drop policy if exists voucher_redemptions_select on public.voucher_redemptions;
create policy voucher_redemptions_select on public.voucher_redemptions for select to authenticated
  using ((select app_private.may_run_club(academy_id, 'money')) or profile_id = (select auth.uid()));
drop policy if exists refunds_select on public.refunds;
create policy refunds_select on public.refunds for select to authenticated
  using ((select app_private.is_guardian_of(refunds.player_id)) or (select app_private.may_run_club(refunds.academy_id, 'money')));

-- Registrations: the Registrar, beside owners and admins; coaches still
-- read their club's queue as before. Not money: a Registrar's checkout,
-- quotes and refunds are refused by the money checks above.
drop policy if exists programs_insert on public.programs;
create policy programs_insert on public.programs for insert to authenticated
  with check ((select app_private.may_run_club(academy_id, 'registrations')));
drop policy if exists programs_update on public.programs;
create policy programs_update on public.programs for update to authenticated
  using ((select app_private.may_run_club(academy_id, 'registrations')))
  with check ((select app_private.may_run_club(academy_id, 'registrations')));
drop policy if exists programs_delete on public.programs;
create policy programs_delete on public.programs for delete to authenticated
  using ((select app_private.may_run_club(academy_id, 'registrations')));
drop policy if exists program_registrations_select on public.program_registrations;
create policy program_registrations_select on public.program_registrations for select to authenticated
  using (
    (select app_private.is_guardian_of(player_id))
    or (select app_private.is_academy_coach(academy_id))
    or (select app_private.may_run_club(academy_id, 'registrations'))
  );
drop policy if exists program_registrations_insert on public.program_registrations;
create policy program_registrations_insert on public.program_registrations for insert to authenticated
  with check (
    submitted_by = (select auth.uid())
    and ((select app_private.is_guardian_of(player_id)) or (select app_private.may_run_club(academy_id, 'registrations')))
  );
drop policy if exists program_registrations_update on public.program_registrations;
create policy program_registrations_update on public.program_registrations for update to authenticated
  using ((select app_private.is_guardian_of(player_id)) or (select app_private.may_run_club(academy_id, 'registrations')))
  with check (
    (select app_private.may_run_club(academy_id, 'registrations'))
    or ((select app_private.is_guardian_of(player_id)) and status in ('pending', 'withdrawn', 'waitlisted'))
  );
drop policy if exists program_registrations_delete on public.program_registrations;
create policy program_registrations_delete on public.program_registrations for delete to authenticated
  using ((select app_private.may_run_club(academy_id, 'registrations')));

-- ============================================================= activity log

create table if not exists public.activity_log (
  id           bigserial primary key,
  academy_id   uuid not null references public.academies(id) on delete cascade,
  actor_id     uuid references public.profiles(id) on delete set null,
  action       text not null,
  subject_kind text,
  subject_id   uuid,
  subject_name text,
  detail       jsonb not null default '{}'::jsonb,
  at           timestamptz not null default now()
);
create index if not exists activity_log_academy_at on public.activity_log (academy_id, at desc);
alter table public.activity_log enable row level security;
grant select on public.activity_log to authenticated;
drop policy if exists activity_log_select on public.activity_log;
create policy activity_log_select on public.activity_log for select to authenticated
  using ((select app_private.may_run_club(academy_id, 'club')));
-- Written by triggers only; never updated or deleted by a client.

create or replace function app_private.log_activity(
  p_academy uuid, p_action text, p_kind text, p_id uuid, p_name text, p_detail jsonb default '{}'::jsonb
) returns void
language plpgsql volatile security definer set search_path = public as $fn$
begin
  insert into public.activity_log (academy_id, actor_id, action, subject_kind, subject_id, subject_name, detail)
  values (p_academy, auth.uid(), p_action, p_kind, p_id, left(p_name, 120), coalesce(p_detail, '{}'::jsonb));
end;
$fn$;

create or replace function app_private.log_member_change()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_name text;
begin
  select full_name into v_name from public.profiles where id = coalesce(new.profile_id, old.profile_id);
  if tg_op = 'INSERT' then
    perform app_private.log_activity(new.academy_id, 'member.added', 'member', new.profile_id, v_name, jsonb_build_object('role', new.role, 'status', new.status));
  elsif tg_op = 'DELETE' then
    perform app_private.log_activity(old.academy_id, 'member.removed', 'member', old.profile_id, v_name, jsonb_build_object('role', old.role));
  elsif new.role is distinct from old.role then
    perform app_private.log_activity(new.academy_id, 'member.role_changed', 'member', new.profile_id, v_name, jsonb_build_object('from', old.role, 'to', new.role));
  elsif new.status is distinct from old.status then
    perform app_private.log_activity(new.academy_id, 'member.status_changed', 'member', new.profile_id, v_name, jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  return null;
end;
$fn$;
drop trigger if exists academy_members_log on public.academy_members;
create trigger academy_members_log
  after insert or update of role, status or delete on public.academy_members
  for each row execute function app_private.log_member_change();

create or replace function app_private.log_club_role_change()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_name text; r public.club_roles;
begin
  r := coalesce(new, old);
  select full_name into v_name from public.profiles where id = r.profile_id;
  perform app_private.log_activity(r.academy_id,
    case when tg_op = 'INSERT' then 'role.granted' else 'role.revoked' end,
    'member', r.profile_id, v_name,
    jsonb_build_object('role', r.role, 'scope_kind', r.scope_kind, 'stream_id', r.stream_id, 'age_group', r.age_group, 'team_id', r.team_id));
  return null;
end;
$fn$;
drop trigger if exists club_roles_log on public.club_roles;
create trigger club_roles_log
  after insert or delete on public.club_roles
  for each row execute function app_private.log_club_role_change();

create or replace function app_private.log_team_change()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if tg_op = 'INSERT' then
    perform app_private.log_activity(new.academy_id, 'team.created', 'team', new.id, new.name, jsonb_build_object('age_group', new.age_group, 'season', new.season));
  elsif tg_op = 'DELETE' then
    perform app_private.log_activity(old.academy_id, 'team.deleted', 'team', old.id, old.name, '{}'::jsonb);
  elsif new.status is distinct from old.status then
    perform app_private.log_activity(new.academy_id, 'team.' || new.status::text, 'team', new.id, new.name, '{}'::jsonb);
  else
    perform app_private.log_activity(new.academy_id, 'team.changed', 'team', new.id, new.name,
      jsonb_strip_nulls(jsonb_build_object(
        'name', case when new.name is distinct from old.name then jsonb_build_object('from', old.name, 'to', new.name) end,
        'age_group', case when new.age_group is distinct from old.age_group then jsonb_build_object('from', old.age_group, 'to', new.age_group) end,
        'stream_id', case when new.stream_id is distinct from old.stream_id then jsonb_build_object('from', old.stream_id, 'to', new.stream_id) end,
        'gender', case when new.gender is distinct from old.gender then jsonb_build_object('from', old.gender, 'to', new.gender) end,
        'home_venue_id', case when new.home_venue_id is distinct from old.home_venue_id then jsonb_build_object('from', old.home_venue_id, 'to', new.home_venue_id) end)));
  end if;
  return null;
end;
$fn$;
drop trigger if exists teams_log on public.teams;
create trigger teams_log
  after insert or update of name, age_group, stream_id, gender, home_venue_id, status or delete on public.teams
  for each row execute function app_private.log_team_change();

create or replace function app_private.log_stream_change()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare s public.streams;
begin
  s := coalesce(new, old);
  perform app_private.log_activity(s.academy_id,
    case tg_op when 'INSERT' then 'stream.created' when 'DELETE' then 'stream.deleted' else 'stream.renamed' end,
    'stream', s.id, s.name,
    case when tg_op = 'UPDATE' then jsonb_build_object('from', old.name, 'to', new.name) else '{}'::jsonb end);
  return null;
end;
$fn$;
drop trigger if exists streams_log on public.streams;
create trigger streams_log
  after insert or update of name or delete on public.streams
  for each row execute function app_private.log_stream_change();

create or replace function app_private.log_fee_change()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare f public.payment_requests;
begin
  f := coalesce(new, old);
  perform app_private.log_activity(f.academy_id,
    case tg_op when 'INSERT' then 'fee.created' when 'DELETE' then 'fee.deleted' else 'fee.changed' end,
    'fee', f.id, f.title,
    jsonb_build_object('amount_cents', f.amount_cents, 'due_on', f.due_on));
  return null;
end;
$fn$;
drop trigger if exists payment_requests_log on public.payment_requests;
create trigger payment_requests_log
  after insert or update of amount_cents, due_on, title or delete on public.payment_requests
  for each row execute function app_private.log_fee_change();

-- A payment's status is written by the webhook (the service role, so no
-- actor); the log still says when it moved and to what.
create or replace function app_private.log_payment_change()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if new.status is distinct from old.status then
    perform app_private.log_activity(new.academy_id, 'payment.' || new.status::text, 'payment', new.id, null,
      jsonb_build_object('amount_cents', new.amount_cents, 'profile_id', new.profile_id, 'from', old.status));
  end if;
  return null;
end;
$fn$;
drop trigger if exists payments_log on public.payments;
create trigger payments_log
  after update of status on public.payments
  for each row execute function app_private.log_payment_change();

create or replace function app_private.log_refund_change()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if tg_op = 'INSERT' then
    perform app_private.log_activity(new.academy_id, 'refund.requested', 'refund', new.id, null, jsonb_build_object('amount_cents', new.amount_cents, 'status', new.status));
  elsif new.status is distinct from old.status then
    perform app_private.log_activity(new.academy_id, 'refund.' || new.status::text, 'refund', new.id, null, jsonb_build_object('amount_cents', new.amount_cents, 'from', old.status));
  end if;
  return null;
end;
$fn$;
drop trigger if exists refunds_log on public.refunds;
create trigger refunds_log
  after insert or update of status on public.refunds
  for each row execute function app_private.log_refund_change();

create or replace function app_private.log_event_call_off()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if new.cancelled_at is not null and old.cancelled_at is null then
    perform app_private.log_activity(new.academy_id, 'event.called_off', 'event', new.id, new.title, jsonb_build_object('starts_at', new.starts_at, 'reason', new.cancellation_reason));
  elsif new.cancelled_at is null and old.cancelled_at is not null then
    perform app_private.log_activity(new.academy_id, 'event.back_on', 'event', new.id, new.title, jsonb_build_object('starts_at', new.starts_at));
  end if;
  return null;
end;
$fn$;
drop trigger if exists events_log_call_off on public.events;
create trigger events_log_call_off
  after update of cancelled_at on public.events
  for each row execute function app_private.log_event_call_off();

-- ================================================================== grants

revoke execute on function app_private.club_roles_of(uuid) from public, anon, authenticated;
revoke execute on function app_private.has_club_role(uuid, public.club_role) from public, anon, authenticated;
-- may_run_club and runs_team sit inside policies, which run as the signed-in
-- role, so that role must be able to execute them (as it can is_academy_staff).
revoke execute on function app_private.may_run_club(uuid, text) from public, anon;
grant execute on function app_private.may_run_club(uuid, text) to authenticated;
revoke execute on function app_private.runs_team(uuid, boolean) from public, anon;
grant execute on function app_private.runs_team(uuid, boolean) to authenticated;
revoke execute on function app_private.log_activity(uuid, text, text, uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function app_private.on_academy_club_mode() from public, anon, authenticated;
revoke execute on function app_private.log_member_change() from public, anon, authenticated;
revoke execute on function app_private.log_club_role_change() from public, anon, authenticated;
revoke execute on function app_private.log_team_change() from public, anon, authenticated;
revoke execute on function app_private.log_stream_change() from public, anon, authenticated;
revoke execute on function app_private.log_fee_change() from public, anon, authenticated;
revoke execute on function app_private.log_payment_change() from public, anon, authenticated;
revoke execute on function app_private.log_refund_change() from public, anon, authenticated;
revoke execute on function app_private.log_event_call_off() from public, anon, authenticated;

revoke execute on function public.grant_club_role(uuid, uuid, public.club_role, text, uuid, text, uuid) from public, anon;
grant execute on function public.grant_club_role(uuid, uuid, public.club_role, text, uuid, text, uuid) to authenticated;
revoke execute on function public.revoke_club_role(uuid) from public, anon;
grant execute on function public.revoke_club_role(uuid) to authenticated;
revoke execute on function public.club_officials(uuid) from public, anon;
grant execute on function public.club_officials(uuid) to authenticated;
revoke execute on function public.my_club_access(uuid) from public, anon;
grant execute on function public.my_club_access(uuid) to authenticated;
revoke execute on function public.enable_club_mode(uuid) from public, anon;
grant execute on function public.enable_club_mode(uuid) to authenticated;

-- ========================================== the functions that gate on staff
-- Below: the live definitions of the money and registration functions with
-- the one guard swapped (is_academy_staff → may_run_club, 'money' or
-- 'registrations'), generated from the migrations so nothing else moved.

-- finance_export (from 0144_paid_means_nothing_is_outstanding.sql): 1 guard(s) swapped
create or replace function public.finance_export(p_academy uuid)
returns table (
  request_id    uuid,
  title         text,
  scope_kind    text,
  scope_name    text,
  due_on        date,
  instalments   integer,
  player_id     uuid,
  player_name   text,
  guardian_name text,
  guardian_phone text,
  fee_cents     integer,
  net_cents     integer,
  paid_cents    integer,
  outstanding_cents integer,
  status        text,
  paid_at       timestamptz,
  stripe_payment_intents text
)
language plpgsql stable security definer set search_path = public as $fn$
begin
  if not coalesce(app_private.may_run_club(p_academy, 'money'), false) then
    raise exception 'only the club''s staff can export its finances' using errcode = '42501';
  end if;

  return query
    with rows_ as (
      select
        r.id as request_id, r.title, r.program_id, r.team_id, r.due_on, r.instalments, r.amount_cents,
        r.created_at,
        pl.id as player_id, pl.full_name as player_name,
        g.full_name as guardian_name, g.phone::text as guardian_phone,
        coalesce((q.quote->>'net_cents')::integer, r.amount_cents) as net_cents,
        coalesce((q.quote->>'outstanding_cents')::integer, r.amount_cents) as outstanding_cents
      from public.payment_requests r
      join public.players pl
        on pl.academy_id = r.academy_id
       and (r.team_id is null or pl.team_id = r.team_id)
       and (r.program_id is null or app_private.is_in_program(r.program_id, pl.id))
      left join lateral (
        select pr.full_name, pr.phone
          from public.player_guardians pg
          join public.profiles pr on pr.id = pg.profile_id
         where pg.player_id = pl.id
         order by pg.created_at
         limit 1
      ) g on true
      left join lateral (
        select public.quote_payment(r.id, pl.id) as quote
      ) q on true
      where r.academy_id = p_academy
        and r.archived_at is null
        and r.per_player
    )
    select
      x.request_id,
      x.title,
      case when x.program_id is not null then 'program'
           when x.team_id is not null then 'team'
           else 'academy' end,
      coalesce(
        (select p.name from public.programs p where p.id = x.program_id),
        (select t.name from public.teams t where t.id = x.team_id)
      ),
      x.due_on,
      x.instalments,
      x.player_id,
      x.player_name,
      x.guardian_name,
      x.guardian_phone,
      x.amount_cents,
      x.net_cents,
      x.net_cents - x.outstanding_cents,
      x.outstanding_cents,
      case when x.outstanding_cents <= 0 then 'paid'
           when x.net_cents - x.outstanding_cents > 0 then 'part paid'
           else 'unpaid' end,
      (select max(p.paid_at) from public.payments p
        where p.request_id = x.request_id and p.player_id = x.player_id and p.status = 'paid'),
      (select string_agg(p.stripe_payment_intent, ' ' order by p.instalment_seq)
         from public.payments p
        where p.request_id = x.request_id and p.player_id = x.player_id and p.status = 'paid'
          and p.stripe_payment_intent is not null)
    from rows_ x
    order by x.created_at desc, x.player_name;
end;
$fn$;

-- refunds_to_issue (from 0145_withdrawing_before_the_cut_off.sql): 1 guard(s) swapped
create or replace function public.refunds_to_issue(p_academy uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
begin
  if not coalesce(app_private.may_run_club(p_academy, 'money'), false) then
    raise exception 'only the club''s staff can see refunds' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id',            r.id,
             'status',        r.status,
             'amount_cents',  r.amount_cents,
             'reason',        r.reason,
             'requested_at',  r.requested_at,
             'issued_at',     r.issued_at,
             'note',          r.note,
             'player',        pl.full_name,
             'program',       (select p.name from public.programs p join public.program_registrations pr on pr.program_id = p.id where pr.id = r.registration_id),
             'paid_cents',    pay.amount_cents,
             'payment_intent', pay.stripe_payment_intent
           ) order by (r.status = 'requested') desc, r.requested_at desc)
      from public.refunds r
      join public.players pl on pl.id = r.player_id
      join public.payments pay on pay.id = r.payment_id
     where r.academy_id = p_academy
  ), '[]'::jsonb);
end;
$fn$;

-- outstanding_fees (from 0227_pay_later_by_a_day.sql): 1 guard(s) swapped
create or replace function public.outstanding_fees(p_academy uuid)
returns table(request_id uuid, title text, player_id uuid, player_name text, guardian_name text, guardian_phone text, net_cents integer, paid_cents integer, outstanding_cents integer, next_due date, days_overdue integer, promised_by date)
language plpgsql stable security definer set search_path = public as $$
begin
  if not app_private.may_run_club(p_academy, 'money') then
    raise exception 'only club admins can see who owes money' using errcode = '42501';
  end if;
  return query
  with charged as (
    select r.id as request_id, r.title,
           coalesce(r.due_on, r.created_at::date) as due_on,
           pl.id as player_id,
           coalesce(nullif(btrim(pl.preferred_name), ''), pl.full_name) as player_name,
           app_private.fee_base_cents(r.id, pl.id, null) - app_private.voucher_cents(r.id, pl.id) as net
      from public.payment_requests r
      join public.players pl
        on pl.academy_id = r.academy_id
       and (r.team_id is null or pl.team_id = r.team_id)
       and (r.program_id is null or app_private.is_in_program(r.program_id, pl.id))
     where r.academy_id = p_academy
       and r.archived_at is null
       and r.per_player
  ),
  payer as (
    select c.*, pg.profile_id as guardian_id
      from charged c
      left join lateral (
        select g.profile_id from public.player_guardians g
         where g.player_id = c.player_id
         order by g.is_primary desc nulls last, g.created_at limit 1
      ) pg on true
  )
  select n.request_id, n.title, n.player_id, n.player_name,
         gp.full_name, gp.phone::text,
         greatest(0, n.net)::integer,
         coalesce(paid.cents, 0)::integer,
         (greatest(0, n.net) - coalesce(paid.cents, 0))::integer,
         n.due_on,
         greatest(0, (current_date - n.due_on))::integer,
         (select pp.by_date from public.payment_promises pp
           where pp.request_id = n.request_id and pp.player_id is not distinct from n.player_id)
    from payer n
    left join public.profiles gp on gp.id = n.guardian_id
    left join lateral (
      select sum(pay.amount_cents) as cents
        from public.payments pay
       where pay.request_id = n.request_id
         and pay.player_id is not distinct from n.player_id
         and pay.status in ('paid', 'processing')
    ) paid on true
   where greatest(0, n.net) - coalesce(paid.cents, 0) > 0
   order by greatest(0, (current_date - n.due_on)) desc, n.title, n.player_name;
end;
$$;

-- payment_register (from 0227_pay_later_by_a_day.sql): 1 guard(s) swapped
create or replace function public.payment_register(p_request uuid)
returns table (
  player_id    uuid,
  player_name  text,
  guardian     text,
  guardian_phone text,
  status       text,
  paid_at      timestamptz,
  amount_cents integer,
  promised_by  date
)
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_academy uuid;
  v_team    uuid;
  v_program uuid;
  v_per     boolean;
begin
  select r.academy_id, r.team_id, r.program_id, r.per_player
    into v_academy, v_team, v_program, v_per
    from public.payment_requests r where r.id = p_request;

  if v_academy is null or not coalesce(app_private.may_run_club(v_academy, 'money'), false) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  return query
    select
      pl.id, pl.full_name,
      g.full_name, g.phone::text,
      coalesce(p.status, 'unpaid'), p.paid_at,
      coalesce(p.amount_cents, r.amount_cents),
      (select pp.by_date from public.payment_promises pp where pp.request_id = p_request and pp.player_id = pl.id)
    from public.players pl
    join public.payment_requests r on r.id = p_request
    left join lateral (
      select pr.full_name, pr.phone
        from public.player_guardians pg
        join public.profiles pr on pr.id = pg.profile_id
       where pg.player_id = pl.id
       order by pg.created_at
       limit 1
    ) g on true
    left join public.payments p on p.request_id = p_request and p.player_id = pl.id
   where pl.academy_id = v_academy
     and (v_team is null or pl.team_id = v_team)
     and (v_program is null or app_private.is_in_program(v_program, pl.id))
     and v_per
   order by (p.status is not null), pl.full_name;
end;
$fn$;

-- quote_payment (from 0226_a_bank_payment_clears.sql): 1 guard(s) swapped
create or replace function public.quote_payment(p_request uuid, p_player uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_req       public.payment_requests;
  v_payer     uuid := auth.uid();
  v_rank      integer := 1;
  v_bps       integer := 0;
  v_ladder    integer[];
  v_gross     integer;
  v_net       integer;
  v_voucher   integer := 0;
  v_base      integer;
  v_schedule  jsonb := '[]'::jsonb;
  v_start     date;
  v_i         integer;
  v_amount    integer;
  v_paid      jsonb;
begin
  select * into v_req from public.payment_requests where id = p_request;
  if v_req.id is null then
    return null;
  end if;
  if not (
    app_private.may_run_club(v_req.academy_id, 'money')
    or (p_player is not null and app_private.is_guardian_of(p_player))
    or (p_player is null and app_private.is_academy_member(v_req.academy_id))
  ) then
    return null;
  end if;

  v_gross := v_req.amount_cents;
  if p_player is not null then
    select sibling_discount_bps into v_ladder from public.academies where id = v_req.academy_id;
    if coalesce(array_length(v_ladder, 1), 0) > 0 then
      v_rank := app_private.sibling_rank(p_request, p_player, v_payer);
      if v_rank > 1 then
        v_bps := v_ladder[least(v_rank - 1, array_length(v_ladder, 1))];
      end if;
    end if;
  end if;
  v_net := v_gross - round(v_gross::numeric * v_bps / 10000)::integer;
  v_voucher := app_private.voucher_cents(p_request, p_player);
  v_net := greatest(0, v_net - v_voucher);

  v_base := v_net / v_req.instalments;
  v_start := coalesce(v_req.due_on, current_date);
  for v_i in 1..v_req.instalments loop
    v_amount := case
      when v_i = v_req.instalments then v_net - (v_base * (v_req.instalments - 1))
      else v_base
    end;
    select to_jsonb(p) into v_paid
      from (
        select pay.status, pay.paid_at
          from public.payments pay
         where pay.request_id = p_request
           and pay.player_id is not distinct from p_player
           and pay.instalment_seq = v_i
         limit 1
      ) p;
    v_schedule := v_schedule || jsonb_build_object(
      'seq', v_i,
      'due_on', v_start + ((v_i - 1) * v_req.instalment_every_days),
      'amount_cents', v_amount,
      'status', coalesce(v_paid->>'status', 'unpaid'),
      'paid_at', v_paid->>'paid_at'
    );
  end loop;

  return jsonb_build_object(
    'request_id', p_request,
    'player_id', p_player,
    'title', v_req.title,
    'currency', v_req.currency,
    'gross_cents', v_gross,
    'sibling_rank', v_rank,
    'discount_bps', v_bps,
    'discount_cents', v_gross - (v_gross - round(v_gross::numeric * v_bps / 10000)::integer),
    'voucher_cents', v_voucher,
    'voucher', (select jsonb_build_object('label', v.label, 'kind', v.kind, 'code', v.code::text)
                  from public.voucher_redemptions r join public.vouchers v on v.id = r.voucher_id
                 where r.request_id = p_request and r.player_id is not distinct from p_player limit 1),
    'net_cents', v_net,
    'instalments', v_req.instalments,
    'schedule', v_schedule,
    'outstanding_cents', (
      select coalesce(sum((s->>'amount_cents')::integer), 0)
        from jsonb_array_elements(v_schedule) s
       where s->>'status' not in ('paid', 'processing')
    )
  );
end;
$$;

-- redeem_voucher (from 0226_a_bank_payment_clears.sql): 1 guard(s) swapped
create or replace function public.redeem_voucher(p_code text, p_request uuid, p_player uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_req   public.payment_requests;
  v       public.vouchers;
  v_base  integer;
  v_paid  integer;
  v_off   integer;
begin
  select * into v_req from public.payment_requests where id = p_request;
  if v_req.id is null then
    raise exception 'no such fee' using errcode = '22023';
  end if;
  if not (coalesce(app_private.is_guardian_of(p_player), false) or coalesce(app_private.may_run_club(v_req.academy_id, 'money'), false)) then
    raise exception 'only the child''s family uses a voucher on their fee' using errcode = '42501';
  end if;
  select * into v from public.vouchers x
   where x.academy_id = v_req.academy_id and x.code = btrim(coalesce(p_code, ''))::citext;
  if v.id is null or not v.active then
    raise exception 'that code is not one of this club''s' using errcode = '22023';
  end if;
  if v.expires_on is not null and v.expires_on < current_date then
    raise exception 'that code expired on %', to_char(v.expires_on, 'FMDD Mon YYYY') using errcode = '22023';
  end if;
  if v.max_uses is not null and v.used_count >= v.max_uses then
    raise exception 'that code has been used as many times as it can be' using errcode = '22023';
  end if;
  if v.program_id is not null and v_req.program_id is distinct from v.program_id then
    raise exception 'that code is for a different program' using errcode = '22023';
  end if;
  if exists (select 1 from public.voucher_redemptions r where r.request_id = p_request and r.player_id is not distinct from p_player) then
    raise exception 'a voucher is already on this fee' using errcode = '23505';
  end if;
  v_base := app_private.fee_base_cents(p_request, p_player, auth.uid());
  select coalesce(sum(p.amount_cents), 0) into v_paid from public.payments p
   where p.request_id = p_request and p.player_id is not distinct from p_player and p.status in ('paid', 'processing');
  if v_base - v_paid <= 0 then
    raise exception 'this fee is already paid' using errcode = '22023';
  end if;
  v_off := case when v.amount_cents is not null then least(v.amount_cents, v_base - v_paid)
                else round((v_base - v_paid)::numeric * v.percent_bps / 10000)::integer end;
  insert into public.voucher_redemptions (academy_id, voucher_id, request_id, player_id, profile_id, amount_cents)
  values (v_req.academy_id, v.id, p_request, p_player, auth.uid(), v_off);
  update public.vouchers set used_count = used_count + 1 where id = v.id;
  return jsonb_build_object('voucher', v.label, 'kind', v.kind, 'off_cents', v_off, 'left_cents', v_base - v_paid - v_off);
end;
$$;

-- set_program_fee (from 0126_a_fee_that_belongs_to_a_program.sql): 1 guard(s) swapped
create or replace function public.set_program_fee(
  p_program      uuid,
  p_amount_cents integer,
  p_title        text default null,
  p_due_on       date default null,
  p_instalments  integer default 1,
  p_every_days   integer default 30
)
returns uuid
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_program public.programs;
  v_request uuid;
begin
  select * into v_program from public.programs where id = p_program;
  if v_program.id is null then
    raise exception 'no such program' using errcode = '22023';
  end if;
  if not coalesce(app_private.may_run_club(v_program.academy_id, 'money'), false) then
    raise exception 'only a club admin can set a fee' using errcode = '42501';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'a fee needs an amount' using errcode = '22023';
  end if;

  -- Reuse the request this program already points at, so setting a fee twice
  -- corrects it rather than leaving the old one owed as well.
  select payment_request_id into v_request from public.programs where id = p_program;

  if v_request is null then
    insert into public.payment_requests (
      academy_id, program_id, title, amount_cents,
      currency, per_player, due_on, instalments, instalment_every_days, created_by
    ) values (
      v_program.academy_id, p_program,
      coalesce(nullif(btrim(coalesce(p_title, '')), ''), v_program.name),
      p_amount_cents,
      coalesce((select currency from public.academy_billing where academy_id = v_program.academy_id), 'aud'),
      true, p_due_on, greatest(coalesce(p_instalments, 1), 1), coalesce(p_every_days, 30),
      auth.uid()
    )
    returning id into v_request;

    update public.programs
       set payment_request_id = v_request, payment_required = true, updated_at = now()
     where id = p_program;
  else
    update public.payment_requests
       set title = coalesce(nullif(btrim(coalesce(p_title, '')), ''), title),
           amount_cents = p_amount_cents,
           due_on = p_due_on,
           instalments = greatest(coalesce(p_instalments, 1), 1),
           instalment_every_days = coalesce(p_every_days, 30),
           -- Linked here too, because a request created before this function
           -- existed will have a program_id of null and would otherwise
           -- stay owed by the whole academy.
           program_id = p_program,
           team_id = null,
           updated_at = now()
     where id = v_request;

    update public.programs
       set payment_required = true, updated_at = now()
     where id = p_program;
  end if;

  return v_request;
end;
$fn$;

-- set_official_status (from 0137_registered_with_playfootball_or_not_yet.sql): 1 guard(s) swapped
create or replace function public.set_official_status(
  p_player    uuid,
  p_status    public.official_rego_status,
  p_ff_number text default null
)
returns void
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_player public.players;
begin
  select * into v_player from public.players where id = p_player;
  if v_player.id is null then
    raise exception 'no such player' using errcode = '22023';
  end if;
  if not (coalesce(app_private.may_run_club(v_player.academy_id, 'registrations'), false)
          or (v_player.team_id is not null
              and coalesce(app_private.is_team_coach(v_player.team_id), false))) then
    raise exception 'only a coach can record official registration' using errcode = '42501';
  end if;

  update public.players
     set official_status    = p_status,
         official_status_at = now(),
         official_status_by = auth.uid(),
         -- Only replaced when one is given; blank leaves the number alone.
         ff_number          = coalesce(nullif(btrim(p_ff_number), ''), ff_number),
         updated_at         = now()
   where id = p_player;
end;
$fn$;

-- import_official_status (from 0162_playfootball_first.sql): 1 guard(s) swapped
create or replace function public.import_official_status(p_academy uuid, p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  r jsonb;
  v_name text; v_dob date; v_ffa text; v_fifa text; v_status_text text;
  v_status public.official_rego_status;
  v_player uuid;
  v_matched integer := 0;
  v_confirmed integer := 0;
  v_unmatched jsonb := '[]'::jsonb;
begin
  if not coalesce(app_private.may_run_club(p_academy, 'registrations'), false) then
    raise exception 'only the club''s staff import PlayFootball exports' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be an array' using errcode = '22023';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_name := nullif(btrim(coalesce(r->>'full_name',
                        btrim(coalesce(r->>'first_name', '') || ' ' || coalesce(r->>'last_name', '')))), '');
    v_dob := case when coalesce(r->>'dob', '') ~ '^\d{4}-\d{2}-\d{2}$' then (r->>'dob')::date end;
    v_ffa := nullif(regexp_replace(coalesce(r->>'ffa_number', ''), '\D', '', 'g'), '');
    v_fifa := nullif(regexp_replace(coalesce(r->>'fifa_id', ''), '\D', '', 'g'), '');
    v_status_text := lower(coalesce(r->>'status', ''));
    -- PlayFootball's own words for "done" and "not yet", loosely, and a
    -- blank status on an export row means the row is a registration.
    v_status := case
      when v_status_text ~ '(pending|await|incomplete|submitted|unpaid|in progress|review)' then 'pending'
      when v_status_text ~ '(cancel|withdraw|reject|declin|inactive|expired)' then 'unknown'
      else 'registered'
    end;

    v_player := null;
    if v_ffa is not null then
      select id into v_player from public.players where academy_id = p_academy and ff_number = v_ffa limit 1;
    end if;
    if v_player is null and v_fifa is not null then
      select id into v_player from public.players where academy_id = p_academy and fifa_id = v_fifa limit 1;
    end if;
    if v_player is null and v_name is not null and v_dob is not null then
      select id into v_player from public.players
       where academy_id = p_academy and dob = v_dob and lower(btrim(full_name)) = lower(v_name)
       limit 1;
    end if;

    if v_player is null then
      v_unmatched := v_unmatched || jsonb_build_object('name', coalesce(v_name, v_ffa, v_fifa, '?'), 'dob', v_dob);
      continue;
    end if;

    v_matched := v_matched + 1;
    update public.players
       set official_status = v_status,
           ff_number = coalesce(v_ffa, ff_number),
           fifa_id = coalesce(v_fifa, fifa_id),
           updated_at = now()
     where id = v_player;

    -- A pending request for the same child is confirmed by the export
    -- too, so the queue does not ask the club to tick what the file said.
    if v_status = 'registered' then
      update public.registration_requests q
         set official_confirmed_at = now(),
             official_confirmed_by = auth.uid(),
             ffa_number = coalesce(q.ffa_number, v_ffa),
             fifa_id = coalesce(q.fifa_id, v_fifa)
       where q.academy_id = p_academy
         and q.status = 'pending'
         and q.official_confirmed_at is null
         and ((v_dob is not null and q.child_dob = v_dob and lower(btrim(q.child_name)) = lower(coalesce(v_name, '')))
              or (v_ffa is not null and q.ffa_number = v_ffa)
              or (v_fifa is not null and q.fifa_id = v_fifa));
      get diagnostics v_confirmed = row_count;
    end if;
  end loop;

  return jsonb_build_object('matched', v_matched, 'confirmed_requests', v_confirmed, 'unmatched', v_unmatched);
end;
$fn$;

-- offer_returning_places (from 0221_last_seasons_players_are_offered_their_places.sql): 1 guard(s) swapped
create or replace function public.offer_returning_places(
  p_academy uuid, p_season text, p_until date, p_players uuid[] default null)
returns jsonb
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_me      uuid := auth.uid();
  v_tz      text;
  v_today   date;
  v_expires timestamptz;
  v_offered integer := 0;
  v_same    integer := 0;
  v_skipped integer := 0;
  v_nobody  integer := 0;
  v_closed  jsonb := '[]'::jsonb;
  v_old     public.offers;
  v_id      uuid;
  n         integer;
  r         record;
begin
  if not coalesce(app_private.may_run_club(p_academy, 'registrations'), false) then
    raise exception 'only an admin can offer next season''s places' using errcode = '42501';
  end if;
  select a.timezone into v_tz from public.academies a where a.id = p_academy;
  v_tz := coalesce(v_tz, 'Australia/Sydney');
  v_today := (now() at time zone v_tz)::date;
  if p_until is null or p_until < v_today then
    raise exception 'the day to accept by has to be today or later' using errcode = '22023';
  end if;
  if p_until > v_today + 60 then
    raise exception 'an offer lasts at most sixty days' using errcode = '22023';
  end if;
  -- The end of that day, at the club.
  v_expires := ((p_until + 1)::timestamp at time zone v_tz) - interval '1 second';

  for r in
    select t.name as team, sp.id as program_id, pl.id as player_id, pl.full_name
      from public.teams t
      join public.players pl on pl.team_id = t.id
      left join lateral (
        select p.id from public.programs p
         where p.team_id = t.id and p.kind = 'squad' and p.season = t.season and p.status = 'open'
         order by p.created_at
         limit 1
      ) sp on true
     where t.academy_id = p_academy and t.season = p_season and t.status = 'active'
       and t.rolled_from is not null
       and (p_players is null or pl.id = any(p_players))
    union all
    -- Asked again: a child whose family said no is off the squad, so they
    -- are found through the offer they declined.
    select t.name, o.squad_program_id, pl.id, pl.full_name
      from public.offers o
      join public.programs sp on sp.id = o.squad_program_id
      join public.teams t on t.id = sp.team_id
      join public.players pl on pl.id = o.player_id
     where p_players is not null and o.player_id = any(p_players)
       and o.academy_id = p_academy and o.kind = 'returning' and o.status = 'declined'
       and t.season = p_season and t.status = 'active' and sp.status = 'open'
       and pl.team_id is distinct from t.id
  loop
    if r.program_id is null then
      -- No open program for the squad: nothing to accept into.
      if not (v_closed ? r.team) then
        v_closed := v_closed || to_jsonb(r.team);
      end if;
      continue;
    end if;
    if exists (select 1 from public.program_registrations pr
                where pr.program_id = r.program_id and pr.player_id = r.player_id
                  and (pr.status in ('approved', 'pending') or p_players is null)) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select * into v_old from public.offers o
     where o.player_id = r.player_id and o.squad_program_id = r.program_id and o.kind = 'returning';
    if v_old.id is not null then
      if v_old.status = 'accepted' or (v_old.status = 'declined' and p_players is null) then
        v_skipped := v_skipped + 1;
        continue;
      end if;
      if v_old.status = 'open' and v_old.expires_at = v_expires then
        v_same := v_same + 1;
        continue;
      end if;
      update public.offers
         set expires_at = v_expires, status = 'open', decided_at = null, created_by = v_me
       where id = v_old.id;
      v_id := v_old.id;
    else
      insert into public.offers (academy_id, kind, player_id, squad_program_id, expires_at, created_by)
      values (p_academy, 'returning', r.player_id, r.program_id, v_expires, v_me)
      returning id into v_id;
    end if;

    -- Every guardian, through the queue. The link is the offer.
    insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload)
    select p_academy, pg.profile_id, 'offer',
           split_part(r.full_name, ' ', 1) || '''s place for ' || p_season,
           r.team || ' — accept by ' || to_char(v_expires at time zone v_tz, 'FMDay FMDD Mon'),
           '/offer/' || v_id,
           jsonb_build_object('offer_id', v_id, 'player_id', r.player_id)
      from public.player_guardians pg
     where pg.player_id = r.player_id;
    get diagnostics n = row_count;
    if n = 0 then
      v_nobody := v_nobody + 1;
    end if;
    v_offered := v_offered + 1;
  end loop;

  return jsonb_build_object(
    'offered', v_offered, 'unchanged', v_same, 'skipped', v_skipped,
    'no_family', v_nobody, 'closed', v_closed, 'expires_at', v_expires);
end;
$fn$;

-- rollover_report (from 0221_last_seasons_players_are_offered_their_places.sql): 1 guard(s) swapped
create or replace function public.rollover_report(p_academy uuid, p_season text)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
begin
  if not coalesce(app_private.may_run_club(p_academy, 'registrations'), false) then
    raise exception 'only an admin can see this' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'team_id',    t.id,
             'team',       t.name,
             'program_id', sp.id,
             'total',      (select count(*) from public.players pl where pl.team_id = t.id),
             'registered', (select count(*) from public.players pl where pl.team_id = t.id
                             and exists (select 1 from public.program_registrations pr
                                           join public.programs p on p.id = pr.program_id
                                          where pr.player_id = pl.id and p.team_id = t.id
                                            and p.season = p_season and pr.status = 'approved')),
             'not_yet', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'player_id', pl.id,
                        'name',      pl.full_name,
                        'guardians', coalesce((
                          select jsonb_agg(jsonb_build_object('name', pr.full_name, 'phone', pr.phone::text))
                            from public.player_guardians pg
                            join public.profiles pr on pr.id = pg.profile_id
                           where pg.player_id = pl.id
                        ), '[]'::jsonb),
                        'registration', (
                          select pr.status from public.program_registrations pr
                            join public.programs p on p.id = pr.program_id
                           where pr.player_id = pl.id and p.team_id = t.id and p.season = p_season
                           order by pr.created_at desc
                           limit 1),
                        'offer', (
                          select jsonb_build_object('id', o.id, 'state', app_private.offer_state(o.status, o.expires_at),
                                                    'expires_at', o.expires_at)
                            from public.offers o
                            join public.programs p on p.id = o.squad_program_id
                           where o.player_id = pl.id and p.team_id = t.id and o.kind = 'returning'
                           order by o.created_at desc
                           limit 1)
                      ) order by pl.full_name)
                 from public.players pl
                where pl.team_id = t.id
                  and not exists (select 1 from public.program_registrations pr
                                    join public.programs p on p.id = pr.program_id
                                   where pr.player_id = pl.id and p.team_id = t.id
                                     and p.season = p_season and pr.status = 'approved')
             ), '[]'::jsonb),
             'declined', coalesce((
               select jsonb_agg(jsonb_build_object('player_id', pl.id, 'name', pl.full_name, 'decided_at', o.decided_at)
                                order by pl.full_name)
                 from public.offers o
                 join public.programs p on p.id = o.squad_program_id
                 join public.players pl on pl.id = o.player_id
                where p.team_id = t.id and o.kind = 'returning' and o.status = 'declined'
                  and pl.team_id is distinct from t.id
             ), '[]'::jsonb)
           ) order by t.age_group, t.name)
      from public.teams t
      left join lateral (
        select p.id from public.programs p
         where p.team_id = t.id and p.kind = 'squad' and p.season = t.season and p.status = 'open'
         order by p.created_at
         limit 1
      ) sp on true
     where t.academy_id = p_academy and t.season = p_season and t.rolled_from is not null
  ), '[]'::jsonb);
end;
$fn$;

-- nudge_unregistered (from 0221_last_seasons_players_are_offered_their_places.sql): 1 guard(s) swapped
create or replace function public.nudge_unregistered(p_academy uuid, p_season text)
returns integer
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_sent integer := 0;
  v_tz   text;
begin
  if not coalesce(app_private.may_run_club(p_academy, 'registrations'), false) then
    raise exception 'only an admin can send this' using errcode = '42501';
  end if;
  select coalesce(a.timezone, 'Australia/Sydney') into v_tz from public.academies a where a.id = p_academy;
  with not_yet as (
    select pl.id as player_id, pl.full_name, t.name as team, o.id as offer_id, o.expires_at
      from public.teams t
      join public.players pl on pl.team_id = t.id
      left join lateral (
        select o.id, o.expires_at from public.offers o
          join public.programs p on p.id = o.squad_program_id
         where o.player_id = pl.id and p.team_id = t.id and o.kind = 'returning'
           and o.status = 'open' and o.expires_at >= now()
         order by o.created_at desc
         limit 1
      ) o on true
     where t.academy_id = p_academy and t.season = p_season and t.rolled_from is not null
       and not exists (select 1 from public.program_registrations pr
                         join public.programs p on p.id = pr.program_id
                        where pr.player_id = pl.id and p.team_id = t.id
                          and p.season = p_season and pr.status in ('approved', 'pending'))
  ),
  recipients as (
    select n.*, pg.profile_id as tell
      from not_yet n join public.player_guardians pg on pg.player_id = n.player_id
  ),
  fresh as (
    -- Once a week per child per parent, however often the button is pressed.
    select r.* from recipients r
     where not exists (select 1 from public.notification_queue q
                        where q.kind = 'reregister_nudge' and q.profile_id = r.tell
                          and q.payload->>'player_id' = r.player_id::text
                          and q.created_at > now() - interval '7 days')
  ),
  queued as (
    insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload)
    select p_academy, f.tell, 'reregister_nudge',
           case when f.offer_id is not null
                then split_part(f.full_name, ' ', 1) || '''s place for ' || p_season || ' is waiting'
                else 'Re-register ' || split_part(f.full_name, ' ', 1) || ' for ' || p_season end,
           case when f.offer_id is not null
                then f.full_name || ' has a place in ' || f.team || '. Accept it by '
                     || to_char(f.expires_at at time zone v_tz, 'FMDay FMDD Mon') || ' to keep it.'
                else f.full_name || ' has a place in ' || f.team || ' this season. Register them to keep it.' end,
           case when f.offer_id is not null then '/offer/' || f.offer_id else '/programs' end,
           jsonb_build_object('player_id', f.player_id, 'season', p_season)
             || case when f.offer_id is not null then jsonb_build_object('offer_id', f.offer_id) else '{}'::jsonb end
      from fresh f
    returning 1
  )
  select count(*)::integer into v_sent from queued;
  return v_sent;
end;
$fn$;

-- guard_program_registration (from 0221_last_seasons_players_are_offered_their_places.sql): 1 guard(s) swapped
create or replace function public.guard_program_registration()
returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  v_program  public.programs;
  v_player   public.players;
  v_taken    integer;
  v_queue    integer;
  v_year     integer;
  v_offered  boolean;
begin
  select * into v_program from public.programs where id = new.program_id;
  select * into v_player  from public.players  where id = new.player_id;

  -- academy_id is carried on the row rather than derived, and the composite
  -- foreign keys above already make a cross-tenant pairing impossible. This
  -- catches the row being inserted with the wrong one of two academies the
  -- submitter does belong to.
  if v_program.academy_id <> new.academy_id or v_player.academy_id <> new.academy_id then
    raise exception 'that program and that player are not in the same academy'
      using errcode = '42501';
  end if;

  -- 0221: a place the club has offered this child, still open. The club
  -- decided when it offered.
  v_offered := exists (
    select 1 from public.offers o
     where o.squad_program_id = new.program_id and o.player_id = new.player_id
       and o.status = 'open' and o.expires_at >= now());

  -- Staff may add anybody at any time: a late entry agreed on the phone is a
  -- normal part of running an academy, and refusing it would just push the
  -- academy back into a spreadsheet.
  if not app_private.may_run_club(new.academy_id, 'registrations') and not v_offered then
    if v_program.status <> 'open' then
      raise exception 'registrations for % are not open', v_program.name
        using errcode = '22023';
    end if;
    if v_program.opens_at is not null and now() < v_program.opens_at then
      raise exception 'registrations for % open %', v_program.name,
        to_char(v_program.opens_at, 'FMDay FMDD FMMonth')
        using errcode = '22023';
    end if;
    if v_program.closes_at is not null and now() > v_program.closes_at then
      raise exception 'registrations for % closed on %', v_program.name,
        to_char(v_program.closes_at, 'FMDD FMMonth')
        using errcode = '22023';
    end if;
  end if;

  -- Birth year, never age — unless the club has placed the child itself.
  if not v_offered then
    v_year := extract(year from v_player.dob)::integer;
    if v_program.born_from_year is not null and v_year < v_program.born_from_year then
      raise exception '% is for players born % to %, and % was born in %',
        v_program.name, v_program.born_from_year,
        coalesce(v_program.born_to_year::text, 'later'),
        v_player.full_name, v_year
        using errcode = '22023';
    end if;
    if v_program.born_to_year is not null and v_year > v_program.born_to_year then
      raise exception '% is for players born % to %, and % was born in %',
        v_program.name, coalesce(v_program.born_from_year::text, 'earlier'),
        v_program.born_to_year, v_player.full_name, v_year
        using errcode = '22023';
    end if;
  end if;

  if v_program.gender is not null and v_player.gender is not null
     and v_program.gender <> v_player.gender then
    raise exception '% is a % program', v_program.name, v_program.gender
      using errcode = '22023';
  end if;

  -- The race. SERIALIZABLE is not in play here, so take the program row's
  -- lock: whoever gets it counts and decides, and the next transaction counts
  -- again afterwards rather than against a stale number.
  if v_program.capacity is not null and new.status = 'pending' then
    perform 1 from public.programs where id = new.program_id for update;

    select count(*) into v_taken
      from public.program_registrations
     where program_id = new.program_id
       and status in ('pending', 'approved');
    -- 0221: and the places held by other children's open offers.
    v_taken := v_taken + app_private.places_held_by_offers(new.program_id, new.player_id);

    if v_taken >= v_program.capacity then
      if not v_program.waitlist_enabled then
        raise exception '% is full', v_program.name using errcode = '22023';
      end if;
      select coalesce(max(waitlist_position), 0) + 1 into v_queue
        from public.program_registrations
       where program_id = new.program_id and status = 'waitlisted';
      new.status := 'waitlisted';
      new.waitlist_position := v_queue;
    end if;
  end if;

  return new;
end;
$fn$;

-- withdraw_registration (from 0226_a_bank_payment_clears.sql): 1 guard(s) swapped
create or replace function public.withdraw_registration(p_registration uuid, p_reason text default null)
returns jsonb
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_me      uuid := auth.uid();
  v_reg     public.program_registrations;
  v_program public.programs;
  v_share   integer;
  v_policy  text;
  v_total   integer := 0;
  v_rows    integer := 0;
  p         record;
  v_amount  integer;
begin
  select * into v_reg from public.program_registrations where id = p_registration;
  if v_reg.id is null then
    raise exception 'no such registration' using errcode = '22023';
  end if;
  if not (coalesce(app_private.is_guardian_of(v_reg.player_id), false)
          or coalesce((app_private.may_run_club(v_reg.academy_id, 'money') or app_private.may_run_club(v_reg.academy_id, 'registrations')), false)) then
    raise exception 'only the family or the club can withdraw this' using errcode = '42501';
  end if;
  if v_reg.status not in ('pending', 'approved', 'waitlisted') then
    raise exception 'this registration is already %', v_reg.status using errcode = '22023';
  end if;
  select * into v_program from public.programs where id = v_reg.program_id;
  -- 0226: money still on its way from the bank cannot be refunded yet, and
  -- a withdrawal now would leave it arriving for a place nobody holds.
  if v_program.payment_request_id is not null and exists (
       select 1 from public.payments pay
        where pay.request_id = v_program.payment_request_id and pay.player_id = v_reg.player_id
          and pay.status = 'processing') then
    raise exception 'a bank payment for this is still clearing — withdraw once it has arrived (two or three business days), and it can be refunded'
      using errcode = '22023';
  end if;

  if v_program.withdraw_until is null or current_date <= v_program.withdraw_until then
    v_share := 10000;
    v_policy := 'full';
  else
    v_share := v_program.refund_bps_after;
    v_policy := case when v_share = 0 then 'none' else 'partial' end;
  end if;

  update public.program_registrations
     set status = 'withdrawn',
         decision_note = nullif(btrim(coalesce(p_reason, '')), ''),
         decided_by = v_me,
         decided_at = now()
   where id = p_registration;

  -- What was actually paid toward this program's fee, for this child, each
  -- payment refunded in its own right so Stripe is told per charge.
  if v_share > 0 and v_program.payment_request_id is not null then
    for p in
      select pay.id, pay.amount_cents
        from public.payments pay
       where pay.request_id = v_program.payment_request_id
         and pay.player_id = v_reg.player_id
         and pay.status = 'paid'
    loop
      -- Integer cents; round half up on the club's side is a cent the
      -- family gets, which is the direction to err.
      v_amount := ((p.amount_cents::bigint * v_share + 5000) / 10000)::integer;
      if v_amount > 0 then
        insert into public.refunds (academy_id, registration_id, player_id, payment_id, amount_cents, reason, requested_by)
        values (v_reg.academy_id, v_reg.id, v_reg.player_id, p.id, v_amount, nullif(btrim(coalesce(p_reason, '')), ''), v_me);
        v_total := v_total + v_amount;
        v_rows := v_rows + 1;
      end if;
    end loop;
  end if;

  return jsonb_build_object('policy', v_policy, 'refund_cents', v_total, 'refunds', v_rows,
                            'withdraw_until', v_program.withdraw_until, 'refund_bps_after', v_program.refund_bps_after);
end;
$fn$;
