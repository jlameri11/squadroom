-- Receipts and the card fee (the registration brief, gaps 9 and 10).
--
-- 9. A receipt the moment a payment lands: a push to the payer — "Receipt:
--    $70.00 to NRIFA" — that opens the on-screen receipt (0265), raised by
--    a trigger on payments (never by a client), and again when a payment
--    is refunded. The emailed copy is the webhook's, once Resend exists.
-- 10. The card-fee pass-through: a club setting, default OFF, that adds
--    Stripe's standard Australian card rate (1.7% + A$0.30) to what the
--    family pays, as its own line shown before paying — one total, the
--    fee inside it. The database works the figure out in one place and the
--    charge routes ask it; the payment keeps what the fee was.

-- ---------------------------------------------------------------- 9. receipts
do $$ begin
  alter table public.notification_queue drop constraint if exists notification_queue_kind_check;
  alter table public.notification_queue add constraint notification_queue_kind_check check (kind = any (array[
    'message', 'announcement', 'event_reminder', 'poll_opened', 'poll_closing', 'rsvp_change', 'invite',
    'event_cancelled', 'event_changed', 'event_back_on', 'rsvp_nudge', 'announcement_repeat', 'wwcc_expiring',
    'guardian_erased', 'official_rego_pending', 'reregister_nudge', 'offer', 'referee_appointment',
    'referee_response', 'referee_withdrawn', 'fixture_change_proposed', 'fixture_change_answered',
    'fixture_change_decided', 'mention', 'match_correction_requested', 'match_correction_decided',
    'fixture_flowing_open', 'discipline_warning', 'discipline_suspension', 'forfeit_request', 'forfeit_decided',
    'nomination', 'fee_due', 'fee_overdue', 'player_report', 'player_clip', 'selected', 'not_selected',
    'match_day', 'support_reply', 'match_video', 'match_photos', 'photo_hidden', 'helpers_wanted',
    'helper_reminder', 'helper_changed', 'report_filed', 'team_published', 'team_sheet_due',
    'accreditation_expiring', 'role_request', 'role_decided', 'ban',
    'receipt'
  ]));
end $$;

alter table public.payments
  add column if not exists card_fee_cents integer not null default 0 check (card_fee_cents >= 0);

create or replace function app_private.payment_receipt_notify()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_club  text;
  v_title text;
  v_child text;
  v_total integer := new.amount_cents + coalesce(new.card_fee_cents, 0);
  v_money text;
begin
  if new.profile_id is null then return new; end if;
  if not (new.status in ('paid', 'refunded') and new.status is distinct from old.status) then return new; end if;
  select name into v_club from public.academies where id = new.academy_id;
  select title into v_title from public.payment_requests where id = new.request_id;
  select full_name into v_child from public.players where id = new.player_id;
  v_money := '$' || to_char(v_total / 100.0, 'FM999999990.00');
  insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload, dedupe_key)
  values (
    new.academy_id, new.profile_id, 'receipt',
    case when new.status = 'paid' then 'Receipt: ' || v_money || ' to ' || coalesce(v_club, 'the club')
         else 'Refunded: ' || v_money || ' from ' || coalesce(v_club, 'the club') end,
    coalesce(v_title, 'A fee') || case when v_child is not null then ' — ' || v_child else '' end
      || case when new.status = 'paid' then '. Tap for your receipt.' else '. Back to the card it was paid with in a few days.' end,
    '/receipts/' || new.id::text,
    jsonb_build_object('payment_id', new.id, 'status', new.status),
    'receipt:' || new.id::text || ':' || new.status
  )
  on conflict (dedupe_key) do nothing;
  return new;
end;
$fn$;
drop trigger if exists on_payment_receipt on public.payments;
create trigger on_payment_receipt
  after update of status on public.payments
  for each row execute function app_private.payment_receipt_notify();

-- ------------------------------------------------------------ 10. the card fee
alter table public.academies
  add column if not exists card_fee_passthrough boolean not null default false;

-- Stripe's standard Australian domestic card rate, 1.7% + A$0.30 a
-- payment: the surcharge that leaves the club the amount it set. The one
-- place the sum lives on the server; lib/stripe/card-fee.ts is the page's
-- copy for showing a figure before a route is asked.
create or replace function app_private.card_fee_cents(p_academy uuid, p_amount integer)
returns integer
language sql stable security definer set search_path = public as $fn$
  select case
    when coalesce(p_amount, 0) <= 0 then 0
    when not coalesce((select a.card_fee_passthrough from public.academies a where a.id = p_academy), false) then 0
    when not app_private.feature_on(p_academy, 'card_fee_passthrough') then 0
    else greatest(0, ceil((p_amount + 30) / (1 - 170 / 10000.0))::integer - p_amount)
  end;
$fn$;
grant execute on function app_private.card_fee_cents(uuid, integer) to authenticated;

-- The charge routes ask through this (service role); a member may too.
create or replace function public.card_fee_cents(p_academy uuid, p_amount integer)
returns integer
language sql stable security definer set search_path = public as $fn$
  select case when app_private.is_academy_member(p_academy) or auth.uid() is null
              then app_private.card_fee_cents(p_academy, p_amount) else 0 end;
$fn$;
revoke all on function public.card_fee_cents(uuid, integer) from public, anon;
grant execute on function public.card_fee_cents(uuid, integer) to authenticated, service_role;

-- quote_payment (from 0236): the card fee on what is next to pay.
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
  v_next      integer := 0;
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
    if v_next = 0 and coalesce(v_paid->>'status', 'unpaid') not in ('paid', 'processing') then
      v_next := v_amount;
    end if;
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
    ),
    -- 0270: the card fee on the next part to pay, where the club passes it on.
    'card_fee_cents', app_private.card_fee_cents(v_req.academy_id, v_next)
  );
end;
$$;

-- my_payment_requests (from 0239): each paid row's payment, for its receipt,
-- and the card fee the family will see before paying.
drop function if exists public.my_payment_requests(uuid);
create function public.my_payment_requests(p_academy uuid)
returns table(request_id uuid, title text, description text, amount_cents integer, currency text, due_on date, closes_at timestamptz, team_name text, player_id uuid, player_name text, status text, paid_at timestamptz, can_pay boolean, voucher_cents integer, voucher_label text, promised_by date, payment_id uuid, card_fee_cents integer)
language sql stable security definer set search_path = public as $$
  with mine as (
    select pl.id, pl.full_name, pl.team_id
      from public.players pl
      join lateral (select 1) self_or_guardian on (pl.profile_id = auth.uid() or exists (select 1 from public.player_guardians pg where pg.player_id = pl.id and pg.profile_id = auth.uid()))
     where pl.academy_id = p_academy
  )
  select
    r.id, r.title, r.description, r.amount_cents, r.currency, r.due_on, r.closes_at,
    coalesce(t.name, pg2.name),
    case when r.per_player then m.id end,
    case when r.per_player then m.full_name end,
    coalesce(p.status, 'unpaid'),
    p.paid_at,
    coalesce(b.charges_enabled, false),
    app_private.voucher_cents(r.id, case when r.per_player then m.id end),
    (select v.label from public.voucher_redemptions vr join public.vouchers v on v.id = vr.voucher_id
      where vr.request_id = r.id and vr.player_id is not distinct from (case when r.per_player then m.id end) limit 1),
    (select pp.by_date from public.payment_promises pp
      where pp.request_id = r.id and pp.player_id is not distinct from (case when r.per_player then m.id end)),
    p.id,
    app_private.card_fee_cents(r.academy_id, greatest(0, r.amount_cents - app_private.voucher_cents(r.id, case when r.per_player then m.id end)))
  from public.payment_requests r
  left join public.teams t on t.id = r.team_id
  left join public.programs pg2 on pg2.id = r.program_id
  left join public.academy_billing b on b.academy_id = r.academy_id
  left join mine m
    on r.per_player
   and (r.team_id is null or m.team_id = r.team_id)
   and (r.program_id is null or app_private.is_in_program(r.program_id, m.id))
  left join public.payments p
    on p.request_id = r.id
   and p.player_id is not distinct from (case when r.per_player then m.id end)
 where r.academy_id = p_academy
   and r.archived_at is null
   and (r.closes_at is null or r.closes_at > now())
   and (r.team_id is null or app_private.is_team_member(r.team_id))
   and (not r.per_player or m.id is not null)
   and (r.program_id is null or exists (
         select 1 from mine m2 where app_private.is_in_program(r.program_id, m2.id)))
   and app_private.is_academy_member(p_academy)
 order by r.due_on nulls last, r.created_at, m.full_name;
$$;
revoke execute on function public.my_payment_requests(uuid) from public, anon;
grant execute on function public.my_payment_requests(uuid) to authenticated;

-- The receipt names the card fee and the total.
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
    'card_fee_cents', coalesce(v_pay.card_fee_cents, 0),
    'total_cents', v_pay.amount_cents + coalesce(v_pay.card_fee_cents, 0),
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

-- The public page says whether the club passes the card fee on, so the
-- register form can show it before Pay now.
create or replace function public.public_programs(p_slug text)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_academy public.academies;
begin
  select * into v_academy from public.academies where slug = lower(btrim(p_slug));
  if v_academy.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'academy', jsonb_build_object(
      'id', v_academy.id,
      'name', v_academy.name,
      'slug', v_academy.slug,
      'primary_colour', v_academy.primary_colour,
      'logo_url', v_academy.logo_url,
      'timezone', v_academy.timezone,
      'photo_required', v_academy.photo_required,
      'active_kids', app_private.takes_active_kids(v_academy.id),
      'card_fee_passthrough', v_academy.card_fee_passthrough and app_private.feature_on(v_academy.id, 'card_fee_passthrough')
    ),
    'programs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id,
               'name', p.name,
               'kind', p.kind,
               'description', p.description,
               'season', p.season,
               'born_from_year', p.born_from_year,
               'born_to_year', p.born_to_year,
               'gender', p.gender,
               'starts_on', p.starts_on,
               'ends_on', p.ends_on,
               'closes_at', p.closes_at,
               'questions', p.questions,
               'payment_required', p.payment_required,
               'pay_timing', p.pay_timing,
               'amount_cents', (
                 select pr.amount_cents from public.payment_requests pr
                  where pr.id = p.payment_request_id
               ),
               'spots_left', app_private.program_spots_left(p.id),
               'waitlist_enabled', p.waitlist_enabled,
               'requires_official_rego', p.requires_official_rego
             ) order by p.starts_on nulls last, p.name)
        from public.programs p
       where p.academy_id = v_academy.id
         and p.status = 'open'
         and (p.opens_at is null or p.opens_at <= now())
         and (p.closes_at is null or p.closes_at > now())
    ), '[]'::jsonb),
    'consents', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id,
               'kind', c.kind,
               'title', c.title,
               'version', c.version,
               'body', c.body,
               'required', c.required
             ) order by c.required desc, c.title)
        from public.consent_documents c
       where c.academy_id = v_academy.id
         and c.published_at is not null
         and c.retired_at is null
    ), '[]'::jsonb)
  );
end;
$fn$;
