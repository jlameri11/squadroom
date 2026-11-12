-- Register as (the registration brief, gap 6): the public form takes a
-- coach, a team manager, a volunteer or a referee as well as a player. An
-- adult registering for a role gives their Working With Children Check
-- number and its expiry (S-03) and, where the club asks, a photo; the club
-- checks the number on the Service NSW register and ticks it; approval
-- then gives them the role — the coach's hat and squad, the manager's or
-- volunteer's club role, the referee's place in the pool — and records the
-- clearance. A role is not for a program, so a request may have none.

alter table public.registration_requests
  add column if not exists register_as text not null default 'player',
  add column if not exists wwcc_number text,
  add column if not exists wwcc_expires_on date,
  add column if not exists wwcc_checked_at timestamptz,
  add column if not exists wwcc_checked_by uuid references public.profiles(id) on delete set null,
  add column if not exists role_note text;
alter table public.registration_requests drop constraint if exists registration_requests_register_as_check;
alter table public.registration_requests
  add constraint registration_requests_register_as_check
  check (register_as in ('player', 'coach', 'team_manager', 'volunteer', 'referee'));
alter table public.registration_requests alter column program_id drop not null;
alter table public.registration_requests drop constraint if exists registration_requests_player_has_program;
alter table public.registration_requests
  add constraint registration_requests_player_has_program
  check (register_as <> 'player' or program_id is not null);

-- The rules for a role's registration, the way check_registration holds a
-- player's: the club exists and is not a league, the person is an adult,
-- every required document is agreed to at its published version. Called by
-- the route with the service role; nobody else needs it.
create or replace function public.check_role_registration(p_academy_slug text, p_dob date, p_consents jsonb)
returns uuid
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_academy uuid;
  v_missing integer;
begin
  select id into v_academy from public.academies where slug = lower(btrim(p_academy_slug)) and type <> 'league';
  if v_academy is null then
    raise exception 'That isn''t open for registrations.' using errcode = '22023';
  end if;
  if p_dob is null or p_dob > (current_date - interval '18 years')::date then
    raise exception 'Registering as a coach, manager, volunteer or referee needs you to be 18 or over.' using errcode = '22023';
  end if;
  if p_dob < (current_date - interval '100 years')::date then
    raise exception 'That date of birth does not look right.' using errcode = '22023';
  end if;
  select count(*) into v_missing
    from public.consent_documents c
   where c.academy_id = v_academy
     and c.published_at is not null
     and c.retired_at is null
     and c.required
     and not exists (
       select 1 from jsonb_array_elements(coalesce(p_consents, '[]'::jsonb)) a
        where (a->>'id')::uuid = c.id
          and (a->>'version') = c.version::text
     );
  if v_missing > 0 then
    raise exception 'Please agree to the % required %.',
      v_missing, case when v_missing = 1 then 'document' else 'documents' end
      using errcode = '22023';
  end if;
  return v_academy;
end;
$fn$;
revoke all on function public.check_role_registration(text, date, jsonb) from public, anon, authenticated;
grant execute on function public.check_role_registration(text, date, jsonb) to service_role;

-- The club ticks the Working With Children Check as checked on the
-- register (as it ticks PlayFootball): the club's coaches and whoever runs
-- registrations. Approval of a coach, manager or referee waits on it.
create or replace function public.confirm_wwcc_check(p_request uuid, p_checked boolean default true)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_req public.registration_requests;
begin
  select * into v_req from public.registration_requests where id = p_request;
  if v_req.id is null
     or not (coalesce(app_private.is_academy_coach(v_req.academy_id), false)
             or coalesce(app_private.may_run_club(v_req.academy_id, 'registrations'), false)) then
    raise exception 'that registration is not yours to check' using errcode = '42501';
  end if;
  if p_checked and (v_req.wwcc_number is null or v_req.wwcc_expires_on is null) then
    raise exception 'there is no Working With Children Check number on this registration' using errcode = '22023';
  end if;
  update public.registration_requests
     set wwcc_checked_at = case when p_checked then now() end,
         wwcc_checked_by = case when p_checked then auth.uid() end
   where id = p_request;
end;
$fn$;
revoke execute on function public.confirm_wwcc_check(uuid, boolean) from public, anon;
grant execute on function public.confirm_wwcc_check(uuid, boolean) to authenticated;

-- The queue carries the role and the check; a role has no program.
drop function if exists public.registration_queue(uuid, text);
create function public.registration_queue(
  p_academy uuid default null,
  p_status  text default 'pending'
)
returns table (
  request_id    uuid,
  program_id    uuid,
  program_name  text,
  guardian_name text,
  guardian_phone text,
  guardian_email text,
  child_name    text,
  child_dob     date,
  child_gender  text,
  answers       jsonb,
  consents      jsonb,
  status        text,
  created_at    timestamptz,
  decided_by    text,
  decided_at    timestamptz,
  decision_note text,
  existing_player_id uuid,
  spots_left    integer,
  -- R-18
  ffa_number    text,
  fifa_id       text,
  requires_official boolean,
  official_confirmed_at timestamptz,
  existing_official_status text,
  -- 0263: where the pending photo sits in player-photos, or null.
  photo_path    text,
  -- 0267: the role, and the Working With Children Check.
  register_as   text,
  wwcc_number   text,
  wwcc_expires_on date,
  wwcc_checked_at timestamptz,
  role_note     text
)
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_academy uuid;
begin
  v_academy := app_private.my_academy(p_academy);
  if v_academy is null or not coalesce(app_private.is_academy_coach(v_academy), false) then
    return;
  end if;

  return query
  select
    q.id, q.program_id, p.name,
    q.guardian_name, q.guardian_phone, q.guardian_email,
    q.child_name, q.child_dob, q.child_gender,
    q.answers, q.consents, q.status, q.created_at,
    d.full_name, q.decided_at, q.decision_note,
    m.id,
    case when q.program_id is null then null else app_private.program_spots_left(q.program_id) end,
    q.ffa_number, q.fifa_id, coalesce(p.requires_official_rego, false), q.official_confirmed_at,
    m.official_status::text,
    q.photo_path,
    q.register_as, q.wwcc_number, q.wwcc_expires_on, q.wwcc_checked_at, q.role_note
  from public.registration_requests q
  left join public.programs p on p.id = q.program_id
  left join public.profiles d on d.id = q.decided_by
  left join lateral (
    select pl.id, pl.official_status from public.players pl
     where pl.academy_id = v_academy
       and pl.dob = q.child_dob
       and lower(btrim(pl.full_name)) = lower(btrim(q.child_name))
     limit 1
  ) m on true
  where q.academy_id = v_academy
    and (p_status is null or q.status = p_status)
    and q.expires_at > now()
  order by q.created_at;
end;
$fn$;
revoke execute on function public.registration_queue(uuid, text) from public, anon;
grant execute on function public.registration_queue(uuid, text) to authenticated;

-- A role's photo moves to <club>/staff/<profile>/… on approval: the person
-- themselves, the club's staff and whoever runs registrations may see it.
create or replace function app_private.may_see_photo(p_name text)
returns boolean
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_player uuid := app_private.photo_path_player(p_name);
  v_academy uuid;
  v_folder text[] := storage.foldername(p_name);
begin
  if coalesce(v_folder[2], '') = 'pending' then
    begin
      v_academy := v_folder[1]::uuid;
    exception when others then
      return false;
    end;
    return coalesce(app_private.is_academy_coach(v_academy), false) or app_private.may_run_club(v_academy, 'registrations');
  end if;
  if coalesce(v_folder[2], '') = 'staff' then
    begin
      v_academy := v_folder[1]::uuid;
    exception when others then
      return false;
    end;
    return (v_folder[3] is not null and v_folder[3] = auth.uid()::text)
        or coalesce(app_private.is_academy_staff(v_academy), false)
        or app_private.may_run_club(v_academy, 'registrations');
  end if;
  if v_player is null then return false; end if;
  select academy_id into v_academy from public.players where id = v_player;
  if v_academy is null or v_folder[1] <> v_academy::text then
    return false;
  end if;
  return app_private.may_see_card(v_player);
end;
$fn$;

-- The family dashboard (0265) names the role where there is no program.
create or replace function public.my_registrations()
returns jsonb
language sql stable security definer set search_path = public as $fn$
  with me as (
    select auth.uid() as id,
           (select p.phone::text from public.profiles p where p.id = auth.uid()) as phone,
           lower((select e.email::text from public.account_emails e where e.profile_id = auth.uid())) as email
  ),
  mine as (
    select pl.id, pl.full_name, pl.dob, pl.academy_id, pl.team_id, coalesce(pl.profile_id = (select id from me), false) as self
      from public.players pl
     where pl.profile_id = (select id from me)
        or exists (select 1 from public.player_guardians g where g.player_id = pl.id and g.profile_id = (select id from me))
  )
  select jsonb_build_object(
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', q.id,
               'club', a.name,
               'slug', a.slug,
               'program', coalesce(p.name, case q.register_as when 'coach' then 'Coach' when 'team_manager' then 'Team manager' when 'volunteer' then 'Volunteer' when 'referee' then 'Referee' end),
               'register_as', q.register_as,
               'child', q.child_name,
               'child_dob', q.child_dob,
               'status', q.status,
               'created_at', q.created_at,
               'decided_at', q.decided_at,
               'decision_note', q.decision_note,
               'paid_cents', (select coalesce(sum(pay.amount_cents), 0) from public.payments pay where pay.registration_request_id = q.id and pay.status in ('paid', 'processing')),
               'refunded', exists (select 1 from public.payments pay where pay.registration_request_id = q.id and pay.status = 'refunded')
             ) order by q.created_at desc)
        from public.registration_requests q
        join public.academies a on a.id = q.academy_id
        left join public.programs p on p.id = q.program_id
       where q.status <> 'approved'
         and (q.profile_id = (select id from me)
              or (q.guardian_phone is not null and q.guardian_phone = (select phone from me))
              or (q.guardian_email is not null and lower(q.guardian_email) = (select email from me)))
    ), '[]'::jsonb),
    'registrations', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id,
               'club', a.name,
               'academy_id', r.academy_id,
               'program', p.name,
               'program_id', p.id,
               'kind', p.kind,
               'season', p.season,
               'child', m.full_name,
               'player_id', m.id,
               'status', r.status::text,
               'waitlist_position', r.waitlist_position,
               'created_at', r.created_at,
               'decided_at', r.decided_at,
               'decision_note', r.decision_note,
               'withdraw_until', p.withdraw_until,
               'refund_bps_after', p.refund_bps_after
             ) order by r.created_at desc)
        from public.program_registrations r
        join mine m on m.id = r.player_id
        join public.academies a on a.id = r.academy_id
        join public.programs p on p.id = r.program_id
    ), '[]'::jsonb),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id,
               'full_name', m.full_name,
               'dob', m.dob,
               'self', m.self,
               'club', a.name,
               'academy_id', m.academy_id,
               'squad', (select t.name from public.teams t where t.id = m.team_id)
             ) order by m.self desc, m.full_name)
        from mine m
        join public.academies a on a.id = m.academy_id
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', pay.id,
               'club', a.name,
               'title', r.title,
               'child', (select m.full_name from mine m where m.id = pay.player_id),
               'amount_cents', pay.amount_cents,
               'currency', pay.currency,
               'status', pay.status,
               'paid_at', pay.paid_at,
               'refunded_at', pay.refunded_at,
               'instalment_seq', pay.instalment_seq
             ) order by coalesce(pay.paid_at, pay.created_at) desc)
        from public.payments pay
        join public.academies a on a.id = pay.academy_id
        join public.payment_requests r on r.id = pay.request_id
       where pay.status in ('paid', 'processing', 'refunded')
         and (pay.profile_id = (select id from me) or pay.player_id in (select m.id from mine m))
    ), '[]'::jsonb)
  );
$fn$;
