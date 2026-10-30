-- 0145: withdrawing before the cut-off.
--
-- R-15. A family could not withdraw a child from anything, and a refund
-- was something the webhook could RECORD when Stripe mentioned one and
-- nothing in Squadroom could ISSUE. Dribl Connect does both, with a
-- cut-off date (DRIBL_PARITY #16).
--
-- THE POLICY IS THE PROGRAM'S: full refund until `withdraw_until`, and
-- `refund_bps_after` of it afterwards — 0 by default, because "no refund
-- after the cut-off" is what most clubs mean and the one that costs a club
-- money if it is wrong by default. No cut-off means a full refund while the
-- program is open.
--
-- WITHDRAWING IS ABOUT THE REGISTRATION AND THE MONEY, not the roster.
-- The child stays on the squad until the club takes them off: 0098 only
-- ever ADDS a family to a squad's chats, and removing people from a chat
-- is the club's explicit act, not a side effect of a parent's tap.
--
-- A REFUND IS REQUESTED HERE AND ISSUED BY A ROUTE. The amount is worked
-- out in the database from the payments actually made and the policy at
-- the moment of withdrawing, and written down; a staff member then presses
-- "Issue" and Stripe is told, on the club's own connected account — direct
-- charges are refunded where they were made. The webhook's charge.refunded
-- already marks the payment. Nobody writes `refunds` directly.

alter table public.programs
  add column if not exists withdraw_until date,
  add column if not exists refund_bps_after integer not null default 0
    check (refund_bps_after between 0 and 10000);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'payments_id_academy_key') then
    alter table public.payments add constraint payments_id_academy_key unique (id, academy_id);
  end if;
end $$;

do $$ begin
  create type public.refund_status as enum ('requested', 'issued', 'failed', 'declined');
exception when duplicate_object then null; end $$;

create table if not exists public.refunds (
  id               uuid primary key default gen_random_uuid(),
  academy_id       uuid not null references public.academies(id) on delete cascade,
  registration_id  uuid not null,
  player_id        uuid not null,
  payment_id       uuid not null,
  amount_cents     integer not null check (amount_cents > 0),
  reason           text,
  status           public.refund_status not null default 'requested',
  requested_by     uuid references public.profiles(id) on delete set null,
  requested_at     timestamptz not null default now(),
  issued_by        uuid references public.profiles(id) on delete set null,
  issued_at        timestamptz,
  stripe_refund_id text,
  note             text,

  constraint refunds_id_academy_key unique (id, academy_id),
  constraint refunds_registration_fkey foreign key (registration_id, academy_id)
    references public.program_registrations (id, academy_id) on delete cascade,
  constraint refunds_player_fkey foreign key (player_id, academy_id)
    references public.players (id, academy_id) on delete cascade,
  constraint refunds_payment_fkey foreign key (payment_id, academy_id)
    references public.payments (id, academy_id) on delete cascade
);

alter table public.refunds enable row level security;

create policy refunds_select on public.refunds for select to authenticated
  using (
    (select app_private.is_guardian_of(refunds.player_id))
    or (select app_private.is_academy_staff(refunds.academy_id))
  );

create index if not exists refunds_academy_status_idx on public.refunds (academy_id, status);

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
          or coalesce(app_private.is_academy_staff(v_reg.academy_id), false)) then
    raise exception 'only the family or the club can withdraw this' using errcode = '42501';
  end if;
  if v_reg.status not in ('pending', 'approved', 'waitlisted') then
    raise exception 'this registration is already %', v_reg.status using errcode = '22023';
  end if;
  select * into v_program from public.programs where id = v_reg.program_id;

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

/** For the treasurer: refunds waiting to be issued, with what they need to issue them. */
create or replace function public.refunds_to_issue(p_academy uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
begin
  if not coalesce(app_private.is_academy_staff(p_academy), false) then
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

revoke execute on function public.withdraw_registration(uuid, text) from public, anon;
revoke execute on function public.refunds_to_issue(uuid) from public, anon;
grant execute on function public.withdraw_registration(uuid, text) to authenticated;
grant execute on function public.refunds_to_issue(uuid) to authenticated;
