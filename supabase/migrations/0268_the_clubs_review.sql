-- The club's review (the registration brief, gap 7). The queue gets
-- filters, "Needs info" — a note back to the family, who answer it from
-- their registration page — the jersey number in the same step as the
-- squad, and Deregister on an accepted registration (R-15's withdrawal,
-- by the club) instead of a Reject that no longer means anything.

alter table public.registration_requests
  add column if not exists info_requested_at timestamptz,
  add column if not exists info_requested_by uuid references public.profiles(id) on delete set null,
  add column if not exists info_note text,
  add column if not exists family_reply text,
  add column if not exists family_replied_at timestamptz;

-- The club asks the family for something, in a sentence. The request stays
-- pending; the note is on the family's page and their dashboard, and their
-- answer comes back onto the request. An empty note takes the question
-- back.
create or replace function public.request_registration_info(p_request uuid, p_note text)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_req public.registration_requests;
begin
  select * into v_req from public.registration_requests where id = p_request;
  if v_req.id is null
     or not (coalesce(app_private.is_academy_coach(v_req.academy_id), false)
             or coalesce(app_private.may_run_club(v_req.academy_id, 'registrations'), false)) then
    raise exception 'that registration is not yours to decide' using errcode = '42501';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'this registration is already %', v_req.status using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_note, '')), '') is null then
    update public.registration_requests
       set info_requested_at = null, info_requested_by = null, info_note = null
     where id = p_request;
  else
    update public.registration_requests
       set info_requested_at = now(), info_requested_by = auth.uid(), info_note = left(btrim(p_note), 1000),
           family_reply = null, family_replied_at = null
     where id = p_request;
  end if;
end;
$fn$;
revoke execute on function public.request_registration_info(uuid, text) from public, anon;
grant execute on function public.request_registration_info(uuid, text) to authenticated;

-- The queue carries the question and the answer, and — for an accepted
-- registration — the registration itself and where it stands, so the club
-- can deregister from the same screen.
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
  role_note     text,
  -- 0268: the question to the family and their answer; the registration an
  -- accepted request became, and where it stands.
  info_requested_at timestamptz,
  info_note     text,
  family_reply  text,
  family_replied_at timestamptz,
  registration_id uuid,
  registration_status text
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
    q.register_as, q.wwcc_number, q.wwcc_expires_on, q.wwcc_checked_at, q.role_note,
    q.info_requested_at, q.info_note, q.family_reply, q.family_replied_at,
    q.registration_id, pr.status::text
  from public.registration_requests q
  left join public.programs p on p.id = q.program_id
  left join public.profiles d on d.id = q.decided_by
  left join public.program_registrations pr on pr.id = q.registration_id
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

-- The family dashboard (0265) shows the club's question and the answer.
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
               'info_requested_at', q.info_requested_at,
               'info_note', q.info_note,
               'family_reply', q.family_reply,
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
