-- 0226: a bank payment clears.
--
-- B-08's bank half. A club's Stripe account asks for BECS direct debit at
-- onboarding (4 Nov), and Checkout stayed cards-only for two reasons: Stripe
-- has to switch BECS on for the club's account, and a debit takes two or
-- three business days to clear — with only pending/paid, the family would
-- be offered "Pay" again the moment they came back, while their bank was
-- still moving the money, and the club would chase them for it.
--
-- So a payment can be PROCESSING: the family has authorised the debit
-- (Checkout completed, payment_status 'unpaid'), the money is on its way.
-- It is not paid — the webhook still marks paid only on Stripe's word,
-- async_payment_succeeded — and it is not owed either:
--   needs_you          no "fee to pay" on Home while it clears;
--   outstanding_fees   the club's who-owes does not list them;
--   queue_fee_reminders  no reminder or overdue chase;
--   quote_payment      the part clearing is not outstanding (the checkout
--                      never offers it again; the next instalment it may);
--   redeem_voucher     no voucher on money already sent;
--   withdraw_registration  refused until it has cleared — a refund cannot
--                      be made of money not yet arrived, and withdrawing now
--                      would leave it landing for a place nobody holds.
-- A debit that fails goes from processing to failed, and the fee is owed
-- again, as it should be.
--
-- And academy_billing.becs_enabled: true once Stripe says the club's
-- au_becs_debit_payments capability is active (read back with the rest of
-- the account, lib/stripe/billing.ts). Checkout offers a bank account
-- beside the card only then, so BECS appears for a club the day Stripe
-- switches it on, with nothing to deploy.
--
-- Everything else is the function as it was; each says where it came from.

alter table public.academy_billing
  add column if not exists becs_enabled boolean not null default false;

do $$
declare
  v_name text;
begin
  select conname into v_name from pg_constraint
   where conrelid = 'public.payments'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) like '%status%pending%';
  if v_name is not null then
    execute format('alter table public.payments drop constraint %I', v_name);
  end if;
  alter table public.payments add constraint payments_status_check
    check (status = any (array['pending', 'processing', 'paid', 'failed', 'refunded', 'cancelled']));
end $$;

-- needs_you, from 0222_a_place_waiting_is_on_home.sql
create or replace function public.needs_you(p_academy uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_me       uuid := auth.uid();
  v_academy  uuid;
  v_items    jsonb := '[]'::jsonb;
  v_is_staff boolean;
  v_count    integer;
  v_cents    bigint;
  v_next     text;
  v_until    timestamptz;
  v_offer    uuid;
  v_tz       text;
begin
  if v_me is null then return null; end if;
  v_academy := app_private.my_academy(p_academy);
  if v_academy is null then return '[]'::jsonb; end if;

  v_is_staff := app_private.is_academy_coach(v_academy);
  select coalesce(a.timezone, 'Australia/Sydney') into v_tz from public.academies a where a.id = v_academy;

  -- ---------------------------------------------------------------- a parent

  -- Money first. It is the thing with a deadline attached and the thing a
  -- club is least comfortable chasing.
  select count(*), coalesce(sum(outstanding), 0)
    into v_count, v_cents
    from (
      select greatest(
               0,
               (r.amount_cents - round(
                  r.amount_cents::numeric
                  * coalesce(
                      case
                        when coalesce(array_length(a.sibling_discount_bps, 1), 0) = 0
                          or app_private.sibling_rank(r.id, pl.id, v_me) <= 1 then 0
                        else a.sibling_discount_bps[
                          least(app_private.sibling_rank(r.id, pl.id, v_me) - 1,
                                array_length(a.sibling_discount_bps, 1))]
                      end, 0) / 10000)::integer)
               - coalesce((
                   select sum(pay.amount_cents) from public.payments pay
                    where pay.request_id = r.id and pay.player_id = pl.id
                      -- 0226: a bank payment clearing is not owed.
                      and pay.status in ('paid', 'processing')
                 ), 0)
             ) as outstanding
        from public.payment_requests r
        join public.academies a on a.id = r.academy_id
        join public.players pl
          on pl.academy_id = r.academy_id
         and (r.team_id is null or pl.team_id = r.team_id)
        join public.player_guardians pg
          on pg.player_id = pl.id and pg.profile_id = v_me
       where r.academy_id = v_academy
         and r.archived_at is null
         and r.per_player
    ) owed
   where outstanding > 0;

  if v_count > 0 then
    v_items := v_items || jsonb_build_object(
      'kind', 'fees',
      'title', case when v_count = 1 then 'A fee to pay' else v_count || ' fees to pay' end,
      'detail', '$' || to_char(v_cents / 100.0, 'FM999999990.00') || ' outstanding',
      'href', '/payments',
      'count', v_count,
      'urgent', true
    );
  end if;

  -- Consents, which are the other thing with a legal edge to it.
  select count(*) into v_count
    from public.players pl
    join public.player_guardians pg
      on pg.player_id = pl.id and pg.profile_id = v_me
   where pl.academy_id = v_academy
     and exists (
       select 1 from public.outstanding_consents(pl.id) c where c.required
     );

  if v_count > 0 then
    v_items := v_items || jsonb_build_object(
      'kind', 'consents',
      'title', 'Something to agree to',
      'detail', case when v_count = 1 then 'For one child' else 'For ' || v_count || ' children' end,
      'href', '/settings',
      'count', v_count,
      'urgent', true
    );
  end if;

  -- 0222: a place offered to a child of theirs (0140 after a trial, 0221
  -- for next season), not yet answered. It has a date, and after the date
  -- the place can go to someone else — so it is urgent, and with one offer
  -- the row opens it.
  select count(*), min(o.expires_at),
         (array_agg(o.id order by o.expires_at))[1],
         (array_agg(split_part(pl.full_name, ' ', 1) || ' — ' || coalesce(t.name, sp.name) order by o.expires_at))[1]
    into v_count, v_until, v_offer, v_next
    from public.offers o
    join public.player_guardians pg
      on pg.player_id = o.player_id and pg.profile_id = v_me
    join public.players pl on pl.id = o.player_id
    join public.programs sp on sp.id = o.squad_program_id
    left join public.teams t on t.id = sp.team_id
   where o.academy_id = v_academy
     and o.status = 'open'
     and o.expires_at >= now();

  if v_count > 0 then
    v_items := v_items || jsonb_build_object(
      'kind', 'offers',
      'title', case when v_count = 1 then 'A place to accept' else v_count || ' places to accept' end,
      'detail', case when v_count = 1
                     then v_next || ' · by ' || to_char(v_until at time zone v_tz, 'FMDy FMDD Mon')
                     else 'The first by ' || to_char(v_until at time zone v_tz, 'FMDy FMDD Mon') end,
      'href', case when v_count = 1 then '/offer/' || v_offer else '/programs' end,
      'count', v_count,
      'urgent', true
    );
  end if;

  -- An unanswered fixture in the next week. Not every unanswered one ever:
  -- a coach wants Saturday's answer, and a list of forty is a list nobody
  -- acts on.
  select count(*), min(e.title)
    into v_count, v_next
    from public.players pl
    join public.player_guardians pg
      on pg.player_id = pl.id and pg.profile_id = v_me
    join public.events e
      on e.academy_id = pl.academy_id
     and (e.team_id is null or pl.team_id = e.team_id)
   where pl.academy_id = v_academy
     and e.cancelled_at is null
     and e.starts_at between now() and now() + interval '7 days'
     and (e.private_to is null or e.private_to = v_me)
     and not exists (
       select 1 from public.event_rsvps r
        where r.event_id = e.id and r.player_id = pl.id
     );

  if v_count > 0 then
    v_items := v_items || jsonb_build_object(
      'kind', 'rsvps',
      'title', case
                 when v_count = 1 then 'One game to answer'
                 else v_count || ' games to answer'
               end,
      'detail', v_next,
      'href', '/calendar',
      'count', v_count,
      'urgent', false
    );
  end if;

  -- Something open to sign up to, but only if a child is actually eligible
  -- and not already in it. An invitation to something they cannot join is
  -- noise.
  select count(distinct p.id) into v_count
    from public.programs p
    join public.players pl
      on pl.academy_id = p.academy_id
    join public.player_guardians pg
      on pg.player_id = pl.id and pg.profile_id = v_me
   where p.academy_id = v_academy
     and p.status = 'open'
     and (p.closes_at is null or p.closes_at > now())
     and (p.born_from_year is null
          or extract(year from pl.dob)::integer >= p.born_from_year)
     and (p.born_to_year is null
          or extract(year from pl.dob)::integer <= p.born_to_year)
     and not exists (
       select 1 from public.program_registrations pr
        where pr.program_id = p.id and pr.player_id = pl.id
     )
     -- 0222: nor one they have a place waiting in (the row above says so),
     -- or turned down.
     and not exists (
       select 1 from public.offers o
        where o.squad_program_id = p.id and o.player_id = pl.id
          and (o.status = 'declined' or (o.status = 'open' and o.expires_at >= now()))
     );

  if v_count > 0 then
    v_items := v_items || jsonb_build_object(
      'kind', 'programs',
      'title', case when v_count = 1 then 'Something to sign up to' else v_count || ' things to sign up to' end,
      'detail', 'Camps, trials and squads',
      'href', '/programs',
      'count', v_count,
      'urgent', false
    );
  end if;

  -- ----------------------------------------------------------------- a coach

  if v_is_staff then
    select count(*) into v_count
      from public.join_requests jr
     where jr.academy_id = v_academy and jr.status = 'pending';
    if v_count > 0 then
      v_items := v_items || jsonb_build_object(
        'kind', 'join_requests',
        'title', case when v_count = 1 then 'A family is waiting' else v_count || ' families are waiting' end,
        'detail', 'They see nothing until you approve them',
        'href', '/admin/requests',
        'count', v_count,
        'urgent', true
      );
    end if;

    select count(*) into v_count
      from public.program_registrations pr
     where pr.academy_id = v_academy and pr.status = 'pending';
    if v_count > 0 then
      v_items := v_items || jsonb_build_object(
        'kind', 'registrations',
        'title', case when v_count = 1 then 'A registration to decide' else v_count || ' registrations to decide' end,
        'detail', 'Families see “pending” until you do',
        'href', '/admin/programs',
        'count', v_count,
        'urgent', false
      );
    end if;

    -- A register nobody took. Only sessions that have FINISHED, and only in
    -- the last fortnight — chasing a coach about a session from August is
    -- noise, and one that is still running is not late yet.
    select count(*) into v_count
      from public.events e
     where e.academy_id = v_academy
       and e.team_id is not null
       and e.cancelled_at is null
       and e.ends_at < now()
       and e.starts_at > now() - interval '14 days'
       and app_private.is_team_coach(e.team_id)
       and not exists (
         select 1 from public.event_attendance a where a.event_id = e.id
       );
    if v_count > 0 then
      v_items := v_items || jsonb_build_object(
        'kind', 'registers',
        'title', case when v_count = 1 then 'A register to take' else v_count || ' registers to take' end,
        'detail', 'Sessions that have finished with nobody marked',
        'href', '/calendar',
        'count', v_count,
        'urgent', false
      );
    end if;
  end if;

  return v_items;
end;
$fn$;

-- outstanding_fees, from 0193_a_voucher_and_a_chase.sql
create or replace function public.outstanding_fees(p_academy uuid)
returns table(request_id uuid, title text, player_id uuid, player_name text, guardian_name text, guardian_phone text, net_cents integer, paid_cents integer, outstanding_cents integer, next_due date, days_overdue integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not app_private.is_academy_staff(p_academy) then
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
         greatest(0, (current_date - n.due_on))::integer
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

-- queue_fee_reminders, from 0193_a_voucher_and_a_chase.sql
create or replace function public.queue_fee_reminders()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_sent integer := 0;
begin
  with charged as (
    select r.id as request_id, r.academy_id, r.title,
           coalesce(r.due_on, r.created_at::date) as due_on,
           pl.id as player_id, pl.full_name,
           app_private.fee_base_cents(r.id, pl.id, null) - app_private.voucher_cents(r.id, pl.id)
             - coalesce((select sum(p.amount_cents) from public.payments p
                          where p.request_id = r.id and p.player_id = pl.id and p.status in ('paid', 'processing')), 0) as outstanding
      from public.payment_requests r
      join public.academies a on a.id = r.academy_id and a.fee_reminders
      join public.players pl
        on pl.academy_id = r.academy_id
       and (r.team_id is null or pl.team_id = r.team_id)
       and (r.program_id is null or app_private.is_in_program(r.program_id, pl.id))
     where r.archived_at is null and r.per_player
       and (r.closes_at is null or r.closes_at > now())
  ),
  due as (
    select c.*, (current_date - c.due_on) as days,
           case
             when current_date - c.due_on = -3 then 'due3'
             when current_date - c.due_on in (3, 7, 14) then 'late' || (current_date - c.due_on)
             when current_date - c.due_on > 14 and (current_date - c.due_on) % 14 = 0 then 'late' || (current_date - c.due_on)
           end as bucket
      from charged c
     where c.outstanding > 0
  ),
  queued as (
    insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload, dedupe_key)
    select d.academy_id, pg.profile_id,
           case when d.days < 0 then 'fee_due' else 'fee_overdue' end,
           case when d.days < 0 then d.title || ' is due ' || to_char(d.due_on, 'FMDay')
                else d.title || ' is ' || d.days || ' days overdue' end,
           d.full_name || ' — $' || to_char(d.outstanding / 100.0, 'FM999999990.00') || ' to pay'
             || case when d.days < 0 then '. Pay in the app, or tell the club if there is a problem.'
                     else '. The club chases what is overdue; pay in the app or talk to them.' end,
           '/payments',
           jsonb_build_object('request_id', d.request_id, 'player_id', d.player_id, 'days', d.days),
           'fee:' || d.request_id || ':' || d.player_id || ':' || pg.profile_id || ':' || d.bucket
      from due d
      join public.player_guardians pg on pg.player_id = d.player_id
     where d.bucket is not null
    on conflict (dedupe_key) do nothing
    returning 1
  )
  select count(*)::integer into v_sent from queued;
  return v_sent;
end;
$$;

-- redeem_voucher, from 0193_a_voucher_and_a_chase.sql
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
  if not (coalesce(app_private.is_guardian_of(p_player), false) or coalesce(app_private.is_academy_staff(v_req.academy_id), false)) then
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

-- quote_payment, from 0193_a_voucher_and_a_chase.sql
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
    app_private.is_academy_staff(v_req.academy_id)
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

-- withdraw_registration, from 0145_withdrawing_before_the_cut_off.sql
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
