-- 0164: who does what at the league.
--
-- L-13. A league is run by more than its owner: a referee secretary, a
-- discipline officer, a ground manager, a competition manager. Until now
-- every one of them had to be made an admin of the league to do their job,
-- which let the referee secretary adjust a ladder and the ground manager
-- overturn a suspension. Nobody wants that, least of all them.
--
-- ROLES ARE HELD AT THE LEAGUE, so they apply to every competition it runs,
-- and are given only to MEMBERS of the league (joined with its link). A role
-- never shows anyone a club's families: officials see the draw, which
-- members of the league already do (0022), and nothing a role grants
-- touches messages, members or players.
--
-- AREAS. Every write that used to ask "is this the organiser?" now asks
-- may_run(competition, area):
--   competition — staff or a competition manager: the draw, scores, ladders,
--                 finals, division rules, announcements, entries, clubs.
--                 is_competition_organiser now means exactly this, so every
--                 existing policy and function keeps its meaning for staff
--                 and gains a competition manager.
--   referees    — staff or the referee coordinator.
--   discipline  — staff or the discipline officer.
--   grounds     — staff, a ground manager, or a competition manager.
-- The area functions below are the live definitions with the one guard
-- swapped, generated from the database so nothing else about them moved.

do $$ begin
  create type public.league_role as enum ('competition_manager', 'referee_coordinator', 'discipline_officer', 'ground_manager');
exception when duplicate_object then null; end $$;

create table if not exists public.league_roles (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  role        public.league_role not null,
  granted_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint league_roles_once unique (academy_id, profile_id, role)
);
alter table public.league_roles enable row level security;
create policy league_roles_select on public.league_roles for select to authenticated
  using ((select app_private.is_academy_staff(league_roles.academy_id)) or profile_id = (select auth.uid()));
-- Writes go through grant_league_role / revoke_league_role, which check
-- membership; no insert policy, so nobody writes the table directly.
create index if not exists league_roles_profile_idx on public.league_roles (profile_id);

create or replace function app_private.league_roles_of(p_academy uuid)
returns public.league_role[]
language sql stable security definer set search_path = public as $fn$
  select coalesce(array_agg(role), '{}')
    from public.league_roles
   where academy_id = p_academy and profile_id = auth.uid();
$fn$;

create or replace function app_private.may_run(p_competition uuid, p_area text)
returns boolean
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_org uuid;
  v_roles public.league_role[];
begin
  select organiser_id into v_org from public.competitions where id = p_competition;
  if v_org is null then return false; end if;
  if coalesce(app_private.is_academy_staff(v_org), false) then return true; end if;
  v_roles := app_private.league_roles_of(v_org);
  return case p_area
    when 'competition' then 'competition_manager' = any (v_roles)
    when 'referees'    then 'referee_coordinator' = any (v_roles)
    when 'discipline'  then 'discipline_officer' = any (v_roles)
    when 'grounds'     then 'ground_manager' = any (v_roles) or 'competition_manager' = any (v_roles)
    else false
  end;
end;
$fn$;

-- The organiser, now: staff, or a competition manager.
create or replace function app_private.is_competition_organiser(p_competition uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select app_private.may_run(p_competition, 'competition');
$fn$;

create or replace function public.grant_league_role(p_competition uuid, p_profile uuid, p_role public.league_role)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_org uuid;
begin
  select organiser_id into v_org from public.competitions where id = p_competition;
  if v_org is null or not coalesce(app_private.is_academy_staff(v_org), false) then
    raise exception 'only the league''s owners and admins hand out roles' using errcode = '42501';
  end if;
  if not exists (select 1 from public.academy_members m where m.academy_id = v_org and m.profile_id = p_profile and m.status = 'active') then
    raise exception 'they need to join the league first — send them the league''s join link' using errcode = '22023';
  end if;
  insert into public.league_roles (academy_id, profile_id, role, granted_by)
  values (v_org, p_profile, p_role, auth.uid())
  on conflict (academy_id, profile_id, role) do nothing;
end;
$fn$;

create or replace function public.revoke_league_role(p_competition uuid, p_profile uuid, p_role public.league_role)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_org uuid;
begin
  select organiser_id into v_org from public.competitions where id = p_competition;
  if v_org is null or not coalesce(app_private.is_academy_staff(v_org), false) then
    raise exception 'only the league''s owners and admins take roles away' using errcode = '42501';
  end if;
  delete from public.league_roles where academy_id = v_org and profile_id = p_profile and role = p_role;
end;
$fn$;

-- Staff's view: who holds what, and who could.
create or replace function public.league_officials(p_competition uuid)
returns jsonb
language sql stable security definer set search_path = public as $fn$
  select case
    when not coalesce(app_private.is_academy_staff((select organiser_id from public.competitions where id = p_competition)), false) then null
    else jsonb_build_object(
      'officials', coalesce((
        select jsonb_agg(jsonb_build_object('profile_id', s.profile_id, 'name', s.name, 'roles', s.roles) order by s.name)
          from (
            select lr.profile_id, coalesce(p.full_name, 'Unnamed') as name, array_agg(lr.role order by lr.role) as roles
              from public.league_roles lr
              join public.profiles p on p.id = lr.profile_id
             where lr.academy_id = (select organiser_id from public.competitions where id = p_competition)
             group by lr.profile_id, p.full_name
          ) s
      ), '[]'::jsonb),
      'members', coalesce((
        select jsonb_agg(jsonb_build_object('profile_id', m.profile_id, 'name', coalesce(p.full_name, 'Unnamed'), 'role', m.role) order by p.full_name)
          from public.academy_members m
          join public.profiles p on p.id = m.profile_id
         where m.academy_id = (select organiser_id from public.competitions where id = p_competition)
           and m.status = 'active'
      ), '[]'::jsonb)
    )
  end;
$fn$;

-- What may I do here? The page asks once and shows the right controls;
-- every function checks for itself regardless.
create or replace function public.my_competition_access(p_competition uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_org uuid;
  v_areas text[] := '{}';
begin
  select organiser_id into v_org from public.competitions where id = p_competition;
  if v_org is null then return jsonb_build_object('areas', to_jsonb(v_areas)); end if;
  -- array_append, not ||: with a bare literal Postgres reads || as
  -- array-concat-array and tries to parse 'staff' as an array (0165).
  if coalesce(app_private.is_academy_staff(v_org), false) then v_areas := array_append(v_areas, 'staff'); end if;
  if app_private.may_run(p_competition, 'competition') then v_areas := array_append(v_areas, 'competition'); end if;
  if app_private.may_run(p_competition, 'referees')    then v_areas := array_append(v_areas, 'referees'); end if;
  if app_private.may_run(p_competition, 'discipline')  then v_areas := array_append(v_areas, 'discipline'); end if;
  if app_private.may_run(p_competition, 'grounds')     then v_areas := array_append(v_areas, 'grounds'); end if;
  return jsonb_build_object('areas', to_jsonb(v_areas));
end;
$fn$;

grant execute on function public.grant_league_role(uuid, uuid, public.league_role) to authenticated;
grant execute on function public.revoke_league_role(uuid, uuid, public.league_role) to authenticated;
grant execute on function public.league_officials(uuid) to authenticated;
grant execute on function public.my_competition_access(uuid) to authenticated;

-- Policies in the referees' and discipline officer's areas.
drop policy if exists discipline_rules_insert on public.competition_discipline_rules;
create policy discipline_rules_insert on public.competition_discipline_rules for insert to authenticated
  with check ((select app_private.may_run(competition_discipline_rules.competition_id, 'discipline')));
drop policy if exists discipline_rules_update on public.competition_discipline_rules;
create policy discipline_rules_update on public.competition_discipline_rules for update to authenticated
  using ((select app_private.may_run(competition_discipline_rules.competition_id, 'discipline')));
drop policy if exists referee_fees_select on public.competition_referee_fees;
create policy referee_fees_select on public.competition_referee_fees for select to authenticated
  using ((select app_private.may_run(competition_referee_fees.competition_id, 'referees')));
drop policy if exists referee_fees_insert on public.competition_referee_fees;
create policy referee_fees_insert on public.competition_referee_fees for insert to authenticated
  with check ((select app_private.may_run(competition_referee_fees.competition_id, 'referees')));
drop policy if exists referee_fees_update on public.competition_referee_fees;
create policy referee_fees_update on public.competition_referee_fees for update to authenticated
  using ((select app_private.may_run(competition_referee_fees.competition_id, 'referees')));
drop policy if exists referee_fees_delete on public.competition_referee_fees;
create policy referee_fees_delete on public.competition_referee_fees for delete to authenticated
  using ((select app_private.may_run(competition_referee_fees.competition_id, 'referees')));
drop policy if exists referee_payment_runs_select on public.referee_payment_runs;
create policy referee_payment_runs_select on public.referee_payment_runs for select to authenticated
  using ((select app_private.may_run(referee_payment_runs.competition_id, 'referees')));

-- ---------------------------------------------------------------------
-- The area functions, regenerated from the live definitions with the
-- organiser guard swapped for may_run(…, area).
-- ---------------------------------------------------------------------
-- add_referee: the organiser check becomes may_run(…, 'referees').
CREATE OR REPLACE FUNCTION public.add_referee(p_competition uuid, p_full_name text, p_phone text DEFAULT NULL::text, p_grade text DEFAULT NULL::text, p_profile uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_academy uuid;
  v_id uuid;
begin
  select organiser_id into v_academy from public.competitions where id = p_competition;
  if v_academy is null or not app_private.may_run(p_competition, 'referees') then
    raise exception 'only the organiser keeps the referee pool' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_full_name, ''))) = 0 then
    raise exception 'a referee needs a name' using errcode = '22023';
  end if;
  insert into public.referees (academy_id, profile_id, full_name, phone, grade, claimed_at, created_by)
  values (v_academy, p_profile, btrim(p_full_name), nullif(btrim(coalesce(p_phone, '')), ''),
          nullif(btrim(coalesce(p_grade, '')), ''),
          case when p_profile is not null then now() end, auth.uid())
  returning id into v_id;
  return v_id;
end;
$function$;

-- appoint_referee: the organiser check becomes may_run(…, 'referees').
CREATE OR REPLACE FUNCTION public.appoint_referee(p_fixture uuid, p_referee uuid, p_role referee_role DEFAULT 'referee'::referee_role)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_fx   public.fixtures;
  v_ref  public.referees;
  v_org  uuid;
  v_why  text;
  v_id   uuid;
  v_home text;
  v_away text;
begin
  select * into v_fx from public.fixtures where id = p_fixture;
  if v_fx.id is null or not app_private.may_run(v_fx.competition_id, 'referees') then
    raise exception 'only the organiser appoints referees' using errcode = '42501';
  end if;
  if v_fx.status not in ('scheduled', 'in_progress') or v_fx.starts_at is null then
    raise exception 'that game is not on, or has no kick-off time yet' using errcode = '22023';
  end if;
  select organiser_id into v_org from public.competitions where id = v_fx.competition_id;
  select * into v_ref from public.referees where id = p_referee;
  if v_ref.id is null or v_ref.academy_id <> v_org then
    raise exception 'that referee is not in this league''s pool' using errcode = '22023';
  end if;
  if v_ref.status <> 'active' then
    raise exception '% is not active in the pool', v_ref.full_name using errcode = '22023';
  end if;
  v_why := app_private.referee_unavailable_reason(p_referee, p_fixture);
  if v_why is not null then
    raise exception '% is %', v_ref.full_name, v_why using errcode = '22023';
  end if;
  if p_role = 'referee' and exists (
    select 1 from public.referee_appointments ap
     where ap.fixture_id = p_fixture and ap.role = 'referee' and ap.status in ('offered', 'accepted')
  ) then
    raise exception 'that game already has a referee — withdraw them first' using errcode = '23505';
  end if;

  select h.display_name, a.display_name into v_home, v_away
    from public.fixtures f
    left join public.competition_entries h on h.id = f.home_entry_id
    left join public.competition_entries a on a.id = f.away_entry_id
   where f.id = p_fixture;

  insert into public.referee_appointments (competition_id, fixture_id, referee_id, academy_id, role, offered_by)
  values (v_fx.competition_id, p_fixture, p_referee, v_org, p_role, auth.uid())
  on conflict (fixture_id, referee_id) do update
    set role = excluded.role, status = 'offered', offered_by = excluded.offered_by, offered_at = now(),
        responded_at = null, response_note = null, withdrawn_note = null
  returning id into v_id;

  if v_ref.profile_id is not null then
    insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload, dedupe_key)
    values (v_org, v_ref.profile_id, 'referee_appointment',
            'Can you ' || case p_role when 'referee' then 'referee' when 'assistant' then 'run the line at' else 'be fourth official at' end
              || ' ' || coalesce(v_home, 'TBC') || ' v ' || coalesce(v_away, 'TBC') || '?',
            to_char(v_fx.starts_at at time zone 'Australia/Sydney', 'FMDay FMDD Mon, FMHH12:MIam')
              || coalesce(' · ' || nullif(coalesce((select name from public.venues where id = v_fx.venue_id), v_fx.venue_label), ''), '')
              || coalesce(' ' || v_fx.field_label, ''),
            '/referee',
            jsonb_build_object('appointment_id', v_id, 'fixture_id', p_fixture),
            'ref-appt-' || v_id || '-' || extract(epoch from now())::bigint);
  end if;
  return v_id;
end;
$function$;

-- withdraw_appointment: the organiser check becomes may_run(…, 'referees').
CREATE OR REPLACE FUNCTION public.withdraw_appointment(p_appointment uuid, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ap  public.referee_appointments;
  v_ref public.referees;
  v_home text; v_away text; v_when timestamptz;
begin
  select * into v_ap from public.referee_appointments where id = p_appointment;
  if v_ap.id is null or not app_private.may_run(v_ap.competition_id, 'referees') then
    raise exception 'only the organiser withdraws an appointment' using errcode = '42501';
  end if;
  update public.referee_appointments
     set status = 'withdrawn', withdrawn_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_appointment;
  select * into v_ref from public.referees where id = v_ap.referee_id;
  if v_ref.profile_id is not null and v_ap.status in ('offered', 'accepted') then
    select h.display_name, a.display_name, f.starts_at into v_home, v_away, v_when
      from public.fixtures f
      left join public.competition_entries h on h.id = f.home_entry_id
      left join public.competition_entries a on a.id = f.away_entry_id
     where f.id = v_ap.fixture_id;
    insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload, dedupe_key)
    values (v_ap.academy_id, v_ref.profile_id, 'referee_withdrawn',
            'You are no longer on ' || coalesce(v_home, 'TBC') || ' v ' || coalesce(v_away, 'TBC'),
            to_char(v_when at time zone 'Australia/Sydney', 'FMDay FMDD Mon, FMHH12:MIam')
              || coalesce(' — ' || nullif(btrim(coalesce(p_note, '')), ''), ''),
            '/referee',
            jsonb_build_object('appointment_id', p_appointment, 'fixture_id', v_ap.fixture_id),
            'ref-wd-' || p_appointment || '-' || extract(epoch from now())::bigint);
  end if;
end;
$function$;

-- referee_pool: the organiser check becomes may_run(…, 'referees').
CREATE OR REPLACE FUNCTION public.referee_pool(p_competition uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when not app_private.may_run(p_competition, 'referees') then null
    else coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id,
               'full_name', r.full_name,
               'phone', r.phone,
               'grade', r.grade,
               'status', r.status,
               'claimed', r.profile_id is not null,
               'claim_token', case when r.profile_id is null then r.claim_token end,
               'upcoming', (select count(*) from public.referee_appointments ap
                             join public.fixtures f on f.id = ap.fixture_id
                            where ap.referee_id = r.id and ap.status in ('offered', 'accepted')
                              and f.starts_at >= now()),
               'games', (select count(*) from public.referee_appointments ap
                          join public.fixtures f on f.id = ap.fixture_id
                         where ap.referee_id = r.id and ap.status = 'accepted' and ap.checked_in_at is not null),
               'declined', (select count(*) from public.referee_appointments ap
                             where ap.referee_id = r.id and ap.status = 'declined'),
               'blockouts', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'starts_at', b.starts_at, 'ends_at', b.ends_at, 'reason', b.reason) order by b.starts_at)
                                       from public.referee_blockouts b where b.referee_id = r.id and b.ends_at >= now()), '[]'::jsonb)
             ) order by r.status, r.full_name)
        from public.referees r
       where r.academy_id = (select organiser_id from public.competitions where id = p_competition)
    ), '[]'::jsonb)
  end;
$function$;

-- referee_availability: the organiser check becomes may_run(…, 'referees').
CREATE OR REPLACE FUNCTION public.referee_availability(p_fixture uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when not app_private.may_run((select competition_id from public.fixtures where id = p_fixture), 'referees') then null
    else coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id,
               'full_name', r.full_name,
               'grade', r.grade,
               'claimed', r.profile_id is not null,
               'unavailable', app_private.referee_unavailable_reason(r.id, p_fixture),
               'already', (select ap.status::text from public.referee_appointments ap
                            where ap.fixture_id = p_fixture and ap.referee_id = r.id)
             ) order by (app_private.referee_unavailable_reason(r.id, p_fixture) is null) desc, r.full_name)
        from public.referees r
       where r.status = 'active'
         and r.academy_id = (select c.organiser_id from public.fixtures f
                               join public.competitions c on c.id = f.competition_id
                              where f.id = p_fixture)
    ), '[]'::jsonb)
  end;
$function$;

-- set_referee_fee: the organiser check becomes may_run(…, 'referees').
CREATE OR REPLACE FUNCTION public.set_referee_fee(p_competition uuid, p_role referee_role, p_fee_cents integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not app_private.may_run(p_competition, 'referees') then
    raise exception 'only the organiser sets referee fees' using errcode = '42501';
  end if;
  if p_fee_cents is null or p_fee_cents < 0 or p_fee_cents > 100000 then
    raise exception 'a match fee is between $0 and $1,000' using errcode = '22023';
  end if;
  insert into public.competition_referee_fees (competition_id, role, fee_cents)
  values (p_competition, p_role, p_fee_cents)
  on conflict (competition_id, role) do update set fee_cents = excluded.fee_cents, updated_at = now();
end;
$function$;

-- build_referee_payment_run: the organiser check becomes may_run(…, 'referees').
CREATE OR REPLACE FUNCTION public.build_referee_payment_run(p_competition uuid, p_from date, p_to date, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid;
  v_run uuid;
  v_total integer;
begin
  select organiser_id into v_org from public.competitions where id = p_competition;
  if v_org is null or not app_private.may_run(p_competition, 'referees') then
    raise exception 'only the organiser pays referees' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'the period runs from a day to a later day' using errcode = '22023';
  end if;

  insert into public.referee_payment_runs (competition_id, academy_id, period_from, period_to, created_by, note)
  values (p_competition, v_org, p_from, p_to, auth.uid(), nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_run;

  insert into public.referee_payment_items (run_id, appointment_id, referee_id, academy_id, amount_cents)
  select v_run, ap.id, ap.referee_id, v_org,
         coalesce(ap.fee_cents, (select f.fee_cents from public.competition_referee_fees f
                                  where f.competition_id = p_competition and f.role = ap.role), 0)
    from public.referee_appointments ap
    join public.fixtures f on f.id = ap.fixture_id
   where ap.competition_id = p_competition
     and ap.status = 'accepted'
     and ap.checked_in_at is not null
     and (f.starts_at at time zone 'Australia/Sydney')::date between p_from and p_to
     and not exists (select 1 from public.referee_payment_items i where i.appointment_id = ap.id);

  -- Lock the amount onto the appointment, so the referee's page and a
  -- later export say what was actually paid.
  update public.referee_appointments ap
     set fee_cents = i.amount_cents
    from public.referee_payment_items i
   where i.appointment_id = ap.id and i.run_id = v_run;

  select coalesce(sum(amount_cents), 0) into v_total from public.referee_payment_items where run_id = v_run;
  if v_total = 0 and not exists (select 1 from public.referee_payment_items where run_id = v_run) then
    delete from public.referee_payment_runs where id = v_run;
    return null;
  end if;
  update public.referee_payment_runs set total_cents = v_total where id = v_run;
  return v_run;
end;
$function$;

-- mark_referee_run_paid: the organiser check becomes may_run(…, 'referees').
CREATE OR REPLACE FUNCTION public.mark_referee_run_paid(p_run uuid, p_method text DEFAULT 'bank'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_run public.referee_payment_runs;
begin
  select * into v_run from public.referee_payment_runs where id = p_run;
  if v_run.id is null or not app_private.may_run(v_run.competition_id, 'referees') then
    raise exception 'only the organiser marks a run paid' using errcode = '42501';
  end if;
  if p_method not in ('bank', 'stripe', 'cash') then
    raise exception 'paid how? bank, stripe or cash' using errcode = '22023';
  end if;
  update public.referee_payment_items set status = 'paid', paid_at = now()
   where run_id = p_run and status = 'pending';
  update public.referee_payment_runs set status = 'paid', paid_at = now(), paid_method = p_method where id = p_run;
end;
$function$;

-- void_referee_run: the organiser check becomes may_run(…, 'referees').
CREATE OR REPLACE FUNCTION public.void_referee_run(p_run uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_run public.referee_payment_runs;
begin
  select * into v_run from public.referee_payment_runs where id = p_run;
  if v_run.id is null or not app_private.may_run(v_run.competition_id, 'referees') then
    raise exception 'only the organiser voids a run' using errcode = '42501';
  end if;
  if v_run.status = 'paid' then
    raise exception 'a paid run stays on the books' using errcode = '22023';
  end if;
  update public.referee_appointments ap set fee_cents = null
    from public.referee_payment_items i where i.appointment_id = ap.id and i.run_id = p_run;
  delete from public.referee_payment_runs where id = p_run;
end;
$function$;

-- referee_payments: the organiser check becomes may_run(…, 'referees').
CREATE OR REPLACE FUNCTION public.referee_payments(p_competition uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when not app_private.may_run(p_competition, 'referees') then null
    else jsonb_build_object(
      'fees', coalesce((
        select jsonb_object_agg(f.role, f.fee_cents) from public.competition_referee_fees f where f.competition_id = p_competition
      ), '{}'::jsonb),
      'unpaid', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'appointment_id', ap.id, 'referee', r.full_name, 'role', ap.role,
                 'starts_at', f.starts_at, 'home', h.display_name, 'away', a.display_name,
                 'fee_cents', coalesce((select x.fee_cents from public.competition_referee_fees x where x.competition_id = p_competition and x.role = ap.role), 0)
               ) order by f.starts_at)
          from public.referee_appointments ap
          join public.referees r on r.id = ap.referee_id
          join public.fixtures f on f.id = ap.fixture_id
          left join public.competition_entries h on h.id = f.home_entry_id
          left join public.competition_entries a on a.id = f.away_entry_id
         where ap.competition_id = p_competition and ap.status = 'accepted' and ap.checked_in_at is not null
           and not exists (select 1 from public.referee_payment_items i where i.appointment_id = ap.id)
      ), '[]'::jsonb),
      'runs', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', run.id, 'period_from', run.period_from, 'period_to', run.period_to,
                 'status', run.status, 'total_cents', run.total_cents, 'created_at', run.created_at,
                 'paid_at', run.paid_at, 'paid_method', run.paid_method, 'note', run.note,
                 'by_referee', (
                   select jsonb_agg(jsonb_build_object('referee_id', s.referee_id, 'referee', s.name, 'bank_details', s.bank_details, 'games', s.games, 'amount_cents', s.amount) order by s.name)
                     from (
                       select r.id as referee_id, r.full_name as name, r.bank_details, count(*) as games, sum(i.amount_cents) as amount
                         from public.referee_payment_items i join public.referees r on r.id = i.referee_id
                        where i.run_id = run.id
                        group by r.id, r.full_name, r.bank_details
                     ) s
                 )
               ) order by run.created_at desc)
          from public.referee_payment_runs run
         where run.competition_id = p_competition
      ), '[]'::jsonb)
    )
  end;
$function$;

-- referee_payments_export: the organiser check becomes may_run(…, 'referees').
CREATE OR REPLACE FUNCTION public.referee_payments_export(p_competition uuid)
 RETURNS TABLE(run_period text, run_status text, paid_at timestamp with time zone, paid_method text, referee text, grade text, bank_details text, game text, played_on timestamp with time zone, role text, amount_cents integer, item_status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select run.period_from::text || ' to ' || run.period_to::text, run.status::text, run.paid_at, run.paid_method,
         r.full_name, r.grade, r.bank_details,
         coalesce(h.display_name, 'TBC') || ' v ' || coalesce(a.display_name, 'TBC'), f.starts_at, ap.role::text,
         i.amount_cents, i.status::text
    from public.referee_payment_items i
    join public.referee_payment_runs run on run.id = i.run_id
    join public.referees r on r.id = i.referee_id
    join public.referee_appointments ap on ap.id = i.appointment_id
    join public.fixtures f on f.id = ap.fixture_id
    left join public.competition_entries h on h.id = f.home_entry_id
    left join public.competition_entries a on a.id = f.away_entry_id
   where run.competition_id = p_competition
     and app_private.may_run(p_competition, 'referees')
   order by run.created_at desc, r.full_name, f.starts_at;
$function$;

-- competition_appointments: the organiser check becomes may_run(…, 'referees').
CREATE OR REPLACE FUNCTION public.competition_appointments(p_competition uuid, p_division text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when not app_private.is_competition_participant(p_competition) then null
    else jsonb_build_object(
      'fixtures', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'fixture_id', f.id,
                 'starts_at', f.starts_at,
                 'division', f.division,
                 'round', f.round,
                 'venue', coalesce(v.name, f.venue_label),
                 'field', f.field_label,
                 'status', f.status,
                 'home', h.display_name,
                 'away', aw.display_name,
                 'appointments', coalesce((
                   select jsonb_agg(jsonb_build_object(
                            'id', ap.id,
                            'referee_id', ap.referee_id,
                            'name', r.full_name,
                            'grade', r.grade,
                            'claimed', r.profile_id is not null,
                            'role', ap.role,
                            'status', ap.status,
                            'response_note', ap.response_note,
                            'checked_in_at', ap.checked_in_at,
                            'reported_at', ap.reported_at,
                            'report', case when app_private.may_run(p_competition, 'referees') then ap.report end
                          ) order by ap.role, ap.offered_at)
                     from public.referee_appointments ap
                     join public.referees r on r.id = ap.referee_id
                    where ap.fixture_id = f.id and ap.status <> 'withdrawn'
                 ), '[]'::jsonb)
               ) order by f.starts_at nulls last, f.field_label)
          from public.fixtures f
          left join public.venues v on v.id = f.venue_id
          left join public.competition_entries h on h.id = f.home_entry_id
          left join public.competition_entries aw on aw.id = f.away_entry_id
         where f.competition_id = p_competition
           and (p_division is null or f.division = p_division)
           and f.status in ('scheduled', 'in_progress', 'final', 'forfeit')
      ), '[]'::jsonb),
      -- Per referee across the competition, for the organiser's eye and
      -- L-15's export: offered, accepted, declined, turned up, reported.
      'summary', case when app_private.may_run(p_competition, 'referees') then coalesce((
        select jsonb_agg(jsonb_build_object(
                 'referee_id', s.referee_id, 'name', s.name, 'grade', s.grade,
                 'offered', s.offered, 'accepted', s.accepted, 'declined', s.declined,
                 'checked_in', s.checked_in, 'reported', s.reported
               ) order by s.name)
          from (
            -- Grouped first: an aggregate cannot sit inside another.
            select r.id as referee_id, r.full_name as name, r.grade,
                   count(*) filter (where ap.status = 'offered')         as offered,
                   count(*) filter (where ap.status = 'accepted')        as accepted,
                   count(*) filter (where ap.status = 'declined')        as declined,
                   count(*) filter (where ap.checked_in_at is not null)  as checked_in,
                   count(*) filter (where ap.reported_at is not null)    as reported
              from public.referee_appointments ap
              join public.referees r on r.id = ap.referee_id
             where ap.competition_id = p_competition
             group by r.id, r.full_name, r.grade
          ) s
      ), '[]'::jsonb) else '[]'::jsonb end
    )
  end;
$function$;

-- add_suspension: the organiser check becomes may_run(…, 'discipline').
CREATE OR REPLACE FUNCTION public.add_suspension(p_competition uuid, p_player uuid, p_games integer, p_reason text, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
  v_acad uuid;
  v_entry uuid;
begin
  if not coalesce(app_private.may_run(p_competition, 'discipline'), false) then
    raise exception 'only the organiser can suspend a player' using errcode = '42501';
  end if;
  select academy_id into v_acad from public.players where id = p_player;
  if v_acad is null then raise exception 'no such player' using errcode = '22023'; end if;
  select q.entry_id into v_entry from public.entry_squads q join public.competition_entries e on e.id = q.entry_id
   where q.player_id = p_player and e.competition_id = p_competition limit 1;
  insert into public.suspensions (competition_id, player_id, academy_id, entry_id, reason, games, issued_by, note)
  values (p_competition, p_player, v_acad, v_entry, coalesce(nullif(btrim(p_reason), ''), 'tribunal'), p_games, auth.uid(), p_note)
  returning id into v_id;
  return v_id;
end;
$function$;

-- overturn_suspension: the organiser check becomes may_run(…, 'discipline').
CREATE OR REPLACE FUNCTION public.overturn_suspension(p_suspension uuid, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s public.suspensions;
begin
  select * into s from public.suspensions where id = p_suspension;
  if s.id is null or not coalesce(app_private.may_run(s.competition_id, 'discipline'), false) then
    raise exception 'only the organiser can overturn a suspension' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception 'say why — an overturned suspension with no reason is one nobody can defend later' using errcode = '22023';
  end if;
  update public.suspensions
     set status = 'overturned', decided_by = auth.uid(), decided_at = now(), note = btrim(p_note)
   where id = p_suspension;
end;
$function$;

-- note_appeal: the organiser check becomes may_run(…, 'discipline').
CREATE OR REPLACE FUNCTION public.note_appeal(p_suspension uuid, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s public.suspensions;
begin
  select * into s from public.suspensions where id = p_suspension;
  if s.id is null or not (coalesce(app_private.is_academy_staff(s.academy_id), false)
                          or (s.entry_id is not null and coalesce(app_private.can_manage_entry(s.entry_id), false))
                          or coalesce(app_private.may_run(s.competition_id, 'discipline'), false)) then
    raise exception 'only the player''s club or the organiser can note an appeal' using errcode = '42501';
  end if;
  update public.suspensions set appeal_note = nullif(btrim(coalesce(p_note, '')), ''), appealed_at = now()
   where id = p_suspension;
end;
$function$;

-- call_off_fixtures: the organiser check becomes may_run(…, 'grounds').
CREATE OR REPLACE FUNCTION public.call_off_fixtures(p_competition uuid, p_date date, p_reason text, p_venue text DEFAULT NULL::text, p_cancel boolean DEFAULT false, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_zone  text;
  v_from  timestamptz;
  v_to    timestamptz;
  v_n     integer;
  v_names text[];
begin
  if not coalesce(app_private.may_run(p_competition, 'grounds'), false) then
    raise exception 'only the organiser can call games off' using errcode = '42501';
  end if;
  if p_reason is null or p_reason not in ('wet_weather', 'ground_closed', 'forfeit', 'not_enough_players', 'other') then
    raise exception 'that is not a reason this product knows' using errcode = '22023';
  end if;
  select coalesce(a.timezone, 'Australia/Sydney') into v_zone
    from public.competitions c join public.academies a on a.id = c.organiser_id
   where c.id = p_competition;
  v_from := (p_date::timestamp at time zone v_zone);
  v_to   := ((p_date + 1)::timestamp at time zone v_zone);

  with hit as (
    update public.fixtures f
       set status = case when p_cancel then 'cancelled' else 'postponed' end::public.fixture_status,
           cancel_reason = p_reason,
           notes = coalesce(nullif(btrim(coalesce(p_note, '')), ''), f.notes),
           updated_at = now()
     where f.competition_id = p_competition
       and f.starts_at >= v_from and f.starts_at < v_to
       and f.status in ('scheduled', 'in_progress')
       and (p_venue is null
            or coalesce(f.venue_label, (select v.name from public.venues v where v.id = f.venue_id), '') ilike '%' || btrim(p_venue) || '%')
    returning coalesce((select h.display_name from public.competition_entries h where h.id = f.home_entry_id), '?')
              || ' v ' || coalesce((select a.display_name from public.competition_entries a where a.id = f.away_entry_id), '?') as game
  )
  select count(*), coalesce(array_agg(game), '{}') into v_n, v_names from hit;

  return jsonb_build_object('affected', v_n, 'games', to_jsonb(v_names),
                            'status', case when p_cancel then 'cancelled' else 'postponed' end);
end;
$function$;

-- postpone_fixture: the organiser check becomes may_run(…, 'grounds').
CREATE OR REPLACE FUNCTION public.postpone_fixture(p_fixture uuid, p_reason text, p_cancel boolean DEFAULT false, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  f public.fixtures;
begin
  select * into f from public.fixtures where id = p_fixture;
  if f.id is null or not coalesce(app_private.may_run(f.competition_id, 'grounds'), false) then
    raise exception 'only the organiser can postpone a game' using errcode = '42501';
  end if;
  if p_reason is null or p_reason not in ('wet_weather', 'ground_closed', 'forfeit', 'not_enough_players', 'other') then
    raise exception 'that is not a reason this product knows' using errcode = '22023';
  end if;
  if f.status in ('final', 'forfeit') then
    raise exception 'this game has been played' using errcode = '22023';
  end if;
  update public.fixtures
     set status = case when p_cancel then 'cancelled' else 'postponed' end::public.fixture_status,
         cancel_reason = p_reason,
         notes = coalesce(nullif(btrim(coalesce(p_note, '')), ''), notes),
         updated_at = now()
   where id = p_fixture;
end;
$function$;

-- reschedule_fixture: the organiser check becomes may_run(…, 'grounds').
CREATE OR REPLACE FUNCTION public.reschedule_fixture(p_fixture uuid, p_starts_at timestamp with time zone, p_venue_label text DEFAULT NULL::text, p_field text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  f public.fixtures;
begin
  select * into f from public.fixtures where id = p_fixture;
  if f.id is null or not coalesce(app_private.may_run(f.competition_id, 'grounds'), false) then
    raise exception 'only the organiser can reschedule a game' using errcode = '42501';
  end if;
  if f.status in ('final', 'forfeit') then
    raise exception 'this game has been played' using errcode = '22023';
  end if;
  if p_starts_at is null then
    raise exception 'a rescheduled game needs a time' using errcode = '22023';
  end if;
  update public.fixtures
     set status = 'scheduled', cancel_reason = null,
         starts_at = p_starts_at,
         venue_label = coalesce(nullif(btrim(coalesce(p_venue_label, '')), ''), venue_label),
         field_label = coalesce(nullif(btrim(coalesce(p_field, '')), ''), field_label),
         updated_at = now()
   where id = p_fixture;
end;
$function$;

-- forfeit_fixture: the organiser check becomes may_run(…, 'grounds').
CREATE OR REPLACE FUNCTION public.forfeit_fixture(p_fixture uuid, p_forfeiting_entry uuid, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  f      public.fixtures;
  v_goal integer;
begin
  select * into f from public.fixtures where id = p_fixture;
  if f.id is null or not coalesce(app_private.may_run(f.competition_id, 'grounds'), false) then
    raise exception 'only the organiser can award a forfeit' using errcode = '42501';
  end if;
  if p_forfeiting_entry not in (f.home_entry_id, f.away_entry_id) then
    raise exception 'that team is not in this game' using errcode = '22023';
  end if;
  select coalesce(d.forfeit_score, 3) into v_goal
    from (select 1) one
    left join public.competition_divisions d on d.competition_id = f.competition_id and d.division = f.division;
  update public.fixtures
     set status = 'forfeit',
         home_score = case when p_forfeiting_entry = f.home_entry_id then 0 else v_goal end,
         away_score = case when p_forfeiting_entry = f.away_entry_id then 0 else v_goal end,
         cancel_reason = 'forfeit',
         score_disputed = false,
         score_entered_by = auth.uid(), score_entered_at = now(),
         notes = coalesce(nullif(btrim(coalesce(p_note, '')), ''), notes),
         updated_at = now()
   where id = p_fixture;
end;
$function$;

-- set_bye: the organiser check becomes may_run(…, 'grounds').
CREATE OR REPLACE FUNCTION public.set_bye(p_fixture uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  f public.fixtures;
begin
  select * into f from public.fixtures where id = p_fixture;
  if f.id is null or not coalesce(app_private.may_run(f.competition_id, 'grounds'), false) then
    raise exception 'only the organiser can give a bye' using errcode = '42501';
  end if;
  update public.fixtures
     set status = 'bye', home_score = null, away_score = null, cancel_reason = null, updated_at = now()
   where id = p_fixture;
end;
$function$;

