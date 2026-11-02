-- 0193: a voucher, and a chase.
--
-- The money polish that needs no Stripe key (STEP 3 item 4; the card charge
-- itself still waits — NEEDS JOEY #1):
--
-- B-07 / B-12  VOUCHERS. A code with a dollar value or a percentage — a
--              government voucher the club redeems with Service NSW, or the
--              club's own (coach, volunteer, scholarship, sibling) — with
--              uses and an expiry, applied by a family to one child's fee.
--              The code, the value and the net are recorded per fee, so the
--              treasurer's export and the club's books agree. One voucher per
--              fee per child; the arithmetic is in the one price function,
--              so the checkout charges the right amount the day a key exists.
--
-- B-04         OVERDUE REMINDERS, SENT. A fee was surfaced as overdue and
--              never chased. A daily sweep now tells the family three days
--              before it is due, and at 3, 7 and 14 days overdue, then every
--              fortnight — each once, each a push that opens their fees.
--              A club can switch it off.

alter table public.academies
  add column if not exists fee_reminders boolean not null default true;

-- ------------------------------------------------------------- notification kinds
do $$
declare
  v_name text;
begin
  select conname into v_name from pg_constraint
   where conrelid = 'public.notification_queue'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) like '%kind = ANY%';
  if v_name is not null then
    execute format('alter table public.notification_queue drop constraint %I', v_name);
  end if;
  alter table public.notification_queue add constraint notification_queue_kind_check check (kind = any (array[
    'message','announcement','event_reminder','poll_opened','poll_closing','rsvp_change','invite',
    'event_cancelled','event_changed','event_back_on','rsvp_nudge','announcement_repeat','wwcc_expiring',
    'guardian_erased','official_rego_pending','reregister_nudge','offer','referee_appointment',
    'referee_response','referee_withdrawn','fixture_change_proposed','fixture_change_answered',
    'fixture_change_decided','mention','match_correction_requested','match_correction_decided',
    'fixture_flowing_open','discipline_warning','discipline_suspension','forfeit_request','forfeit_decided',
    'nomination','fee_due','fee_overdue']));
end $$;

-- ------------------------------------------------------------------- vouchers
create table if not exists public.vouchers (
  id            uuid primary key default gen_random_uuid(),
  academy_id    uuid not null references public.academies(id) on delete cascade,
  code          citext not null,
  label         text not null check (btrim(label) <> ''),
  kind          text not null default 'club' check (kind in ('club', 'government', 'coach', 'volunteer', 'scholarship', 'sibling')),
  amount_cents  integer check (amount_cents is null or amount_cents > 0),
  percent_bps   integer check (percent_bps is null or percent_bps between 1 and 10000),
  max_uses      integer check (max_uses is null or max_uses > 0),
  used_count    integer not null default 0,
  expires_on    date,
  program_id    uuid references public.programs(id) on delete set null,
  active        boolean not null default true,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint vouchers_one_value check ((amount_cents is null) <> (percent_bps is null)),
  constraint vouchers_code_per_club unique (academy_id, code)
);
create table if not exists public.voucher_redemptions (
  id            uuid primary key default gen_random_uuid(),
  academy_id    uuid not null references public.academies(id) on delete cascade,
  voucher_id    uuid not null references public.vouchers(id) on delete cascade,
  request_id    uuid not null references public.payment_requests(id) on delete cascade,
  player_id     uuid references public.players(id) on delete cascade,
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  amount_cents  integer not null check (amount_cents >= 0),
  created_at    timestamptz not null default now(),
  constraint voucher_redemptions_one_per_fee unique (request_id, player_id)
);
alter table public.vouchers enable row level security;
alter table public.voucher_redemptions enable row level security;

-- Vouchers are the club's: staff read and write them; a family types a code
-- and never lists them.
drop policy if exists vouchers_staff on public.vouchers;
create policy vouchers_staff on public.vouchers for all to authenticated
  using ((select app_private.is_academy_staff(academy_id)))
  with check ((select app_private.is_academy_staff(academy_id)));
drop policy if exists voucher_redemptions_select on public.voucher_redemptions;
create policy voucher_redemptions_select on public.voucher_redemptions for select to authenticated
  using ((select app_private.is_academy_staff(academy_id)) or profile_id = (select auth.uid()));
grant select, insert, update, delete on public.vouchers to authenticated;
grant select on public.voucher_redemptions to authenticated;

-- A fee's value after the family discount, before any voucher — the base a
-- voucher is applied to. The payer is the guardian asking, or the primary one.
create or replace function app_private.fee_base_cents(p_request uuid, p_player uuid, p_payer uuid)
returns integer language plpgsql stable security definer set search_path = public as $$
declare
  v_req    public.payment_requests;
  v_ladder integer[];
  v_rank   integer := 1;
  v_bps    integer := 0;
  v_payer  uuid := p_payer;
begin
  select * into v_req from public.payment_requests where id = p_request;
  if v_req.id is null then return null; end if;
  if p_player is null then return v_req.amount_cents; end if;
  if v_payer is null then
    select g.profile_id into v_payer from public.player_guardians g
     where g.player_id = p_player order by g.is_primary desc nulls last, g.created_at limit 1;
  end if;
  select sibling_discount_bps into v_ladder from public.academies where id = v_req.academy_id;
  if v_payer is not null and coalesce(array_length(v_ladder, 1), 0) > 0 then
    v_rank := app_private.sibling_rank(p_request, p_player, v_payer);
    if v_rank > 1 then
      v_bps := v_ladder[least(v_rank - 1, array_length(v_ladder, 1))];
    end if;
  end if;
  return v_req.amount_cents - round(v_req.amount_cents::numeric * v_bps / 10000)::integer;
end;
$$;

create or replace function app_private.voucher_cents(p_request uuid, p_player uuid)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(sum(r.amount_cents), 0)::integer
    from public.voucher_redemptions r
   where r.request_id = p_request and r.player_id is not distinct from p_player;
$$;

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
   where p.request_id = p_request and p.player_id is not distinct from p_player and p.status = 'paid';
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

-- The one price function, with the voucher taken off.
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
       where s->>'status' <> 'paid'
    )
  );
end;
$$;

-- Who owes, with the voucher off.
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
         and pay.status = 'paid'
    ) paid on true
   where greatest(0, n.net) - coalesce(paid.cents, 0) > 0
   order by greatest(0, (current_date - n.due_on)) desc, n.title, n.player_name;
end;
$$;

-- The family's own list, with the voucher shown.
drop function if exists public.my_payment_requests(uuid);
create function public.my_payment_requests(p_academy uuid)
returns table(request_id uuid, title text, description text, amount_cents integer, currency text, due_on date, closes_at timestamptz, team_name text, player_id uuid, player_name text, status text, paid_at timestamptz, can_pay boolean, voucher_cents integer, voucher_label text)
language sql stable security definer set search_path = public as $$
  with mine as (
    select pl.id, pl.full_name, pl.team_id
      from public.players pl
      join public.player_guardians pg
        on pg.player_id = pl.id and pg.profile_id = auth.uid()
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
      where vr.request_id = r.id and vr.player_id is not distinct from (case when r.per_player then m.id end) limit 1)
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

-- ------------------------------------------------------------ the chase
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
                          where p.request_id = r.id and p.player_id = pl.id and p.status = 'paid'), 0) as outstanding
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

select cron.unschedule('queue-fee-reminders')
 where exists (select 1 from cron.job where jobname = 'queue-fee-reminders');
select cron.schedule(
  'queue-fee-reminders',
  '25 19 * * *',  -- 19:25 UTC is 06:25 in Sydney, after the other morning sweeps
  $cron$select public.queue_fee_reminders()$cron$
);

revoke execute on function public.redeem_voucher(text, uuid, uuid) from public, anon;
grant execute on function public.redeem_voucher(text, uuid, uuid) to authenticated;
revoke execute on function public.queue_fee_reminders() from public, anon, authenticated;
