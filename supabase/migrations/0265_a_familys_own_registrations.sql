-- The family dashboard (the registration brief, gap 4): Settings → My
-- registrations. Every registration a family has made with its status —
-- Submitted, Approved, Waitlisted, Rejected, Withdrawn, Lapsed — their
-- people (the children and themselves, to sign up again or edit), and their
-- payments with a receipt each.
--
-- A registration made from the public form before the family had an
-- account is theirs by their mobile or their email (the form asked for
-- both); one made signed in is theirs by the account. The receipt is the
-- payer's, the child's family's, and the club's staff and Treasurer's.

create or replace function public.my_registrations()
returns jsonb
language sql stable security definer set search_path = public as $fn$
  with me as (
    select auth.uid() as id,
           (select p.phone::text from public.profiles p where p.id = auth.uid()) as phone,
           lower((select e.email::text from public.account_emails e where e.profile_id = auth.uid())) as email
  ),
  mine as (
    -- The children I am a guardian of, and myself where I play.
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
               'program', p.name,
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
        join public.programs p on p.id = q.program_id
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
revoke execute on function public.my_registrations() from public, anon;
grant execute on function public.my_registrations() to authenticated;

-- One payment's receipt. The payer, the child's family, the club's staff
-- and its Treasurer. What was paid, for whom, to whom, when, and Stripe's
-- id for it — the money went to the club, Squadroom took none of it.
create or replace function public.payment_receipt(p_payment uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_pay public.payments;
  v_req public.payment_requests;
begin
  select * into v_pay from public.payments where id = p_payment;
  if v_pay.id is null then
    raise exception 'no such payment' using errcode = '22023';
  end if;
  if not (v_pay.profile_id = auth.uid()
          or (v_pay.player_id is not null and coalesce(app_private.is_guardian_of(v_pay.player_id), false))
          or coalesce(app_private.is_academy_staff(v_pay.academy_id), false)
          or coalesce(app_private.may_run_club(v_pay.academy_id, 'money'), false)) then
    raise exception 'this receipt is not yours to see' using errcode = '42501';
  end if;
  select * into v_req from public.payment_requests where id = v_pay.request_id;
  return jsonb_build_object(
    'id', v_pay.id,
    'club', (select jsonb_build_object('name', a.name, 'logo_url', a.logo_url, 'slug', a.slug) from public.academies a where a.id = v_pay.academy_id),
    'payer', (select pr.full_name from public.profiles pr where pr.id = v_pay.profile_id),
    'child', (select pl.full_name from public.players pl where pl.id = v_pay.player_id),
    'title', v_req.title,
    'description', v_req.description,
    'program', (select p.name from public.programs p where p.id = v_req.program_id),
    'amount_cents', v_pay.amount_cents,
    'currency', v_pay.currency,
    'status', v_pay.status,
    'paid_at', v_pay.paid_at,
    'refunded_at', v_pay.refunded_at,
    'instalment_seq', v_pay.instalment_seq,
    'instalments', v_req.instalments,
    'stripe_payment_intent', v_pay.stripe_payment_intent,
    'voucher_cents', app_private.voucher_cents(v_pay.request_id, v_pay.player_id),
    'voucher_label', (select v.label from public.voucher_redemptions vr join public.vouchers v on v.id = vr.voucher_id
                       where vr.request_id = v_pay.request_id and vr.player_id is not distinct from v_pay.player_id limit 1)
  );
end;
$fn$;
revoke execute on function public.payment_receipt(uuid) from public, anon;
grant execute on function public.payment_receipt(uuid) to authenticated;
