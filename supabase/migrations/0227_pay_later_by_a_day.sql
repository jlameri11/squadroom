-- 0227: pay later, by a day.
--
-- B-08's last piece. A family that cannot pay a fee today had two choices:
-- pay it, or go quiet and be chased — three days before it is due, then at
-- 3, 7 and 14 days overdue (0193). Dribl and Squadi both let a family say
-- "I'll pay by the 21st". Now so does this: on the fee, "Can't pay today?
-- Pick a day" — from tomorrow, within sixty days, before the fee closes —
-- and the family is reminded the day before their own day, the chase holds
-- until it, and the club sees "promised by Fri 21 Nov" beside the name
-- instead of ringing them.
--
-- A PROMISE IS NOT A PAYMENT. Nothing about what is owed changes: Home still
-- says the fee is to pay, who-owes still lists it, the quote is the same.
-- What changes is the chasing, which is the part that costs a family its
-- dignity and a treasurer their evenings. After the promised day, unpaid,
-- the ordinary overdue chase resumes on its own schedule.
--
-- Only the family makes one — a guardian of the child, or a member for a
-- fee per family — only on a fee they still owe (nothing paid or clearing,
-- 0226), and a new day replaces the old. Nobody writes the table by hand.
-- A fee per family is not swept by 0193's reminders, and so is not nudged
-- about its day either; the club still sees it.

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'payment_requests_id_academy_key') then
    alter table public.payment_requests add constraint payment_requests_id_academy_key unique (id, academy_id);
  end if;
end $$;

create table if not exists public.payment_promises (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  request_id  uuid not null,
  player_id   uuid,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  by_date     date not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint payment_promises_request_fkey foreign key (request_id, academy_id)
    references public.payment_requests (id, academy_id) on delete cascade,
  constraint payment_promises_player_fkey foreign key (player_id, academy_id)
    references public.players (id, academy_id) on delete cascade
);
-- One day per fee per child (per family when the fee is per family).
create unique index if not exists payment_promises_once
  on public.payment_promises (request_id, coalesce(player_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists payment_promises_player_idx on public.payment_promises (player_id);
drop trigger if exists payment_promises_set_updated_at on public.payment_promises;
create trigger payment_promises_set_updated_at
  before update on public.payment_promises
  for each row execute function public.set_updated_at();

-- Read by the family and the club's staff; written only through promise_to_pay.
alter table public.payment_promises enable row level security;
drop policy if exists payment_promises_read on public.payment_promises;
create policy payment_promises_read on public.payment_promises for select to authenticated
  using (profile_id = (select auth.uid())
         or (player_id is not null and (select app_private.is_guardian_of(player_id)))
         or (select app_private.is_academy_staff(academy_id)));
grant select on public.payment_promises to authenticated;

/**
 * The family's day: from tomorrow, within sixty days, before the fee closes,
 * on a fee they still owe. A new day replaces the old, and a reminder queued
 * for the old day goes with it.
 */
create or replace function public.promise_to_pay(p_request uuid, p_player uuid default null, p_by date default null)
returns jsonb
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_req   public.payment_requests;
  v_tz    text;
  v_today date;
  v_last  date;
  v_owed  integer;
  v_id    uuid;
begin
  select * into v_req from public.payment_requests where id = p_request;
  if v_req.id is null or not coalesce(app_private.is_academy_member(v_req.academy_id), false) then
    raise exception 'that fee is not one of yours' using errcode = '42501';
  end if;
  if v_req.per_player then
    if p_player is null or not coalesce(app_private.is_guardian_of(p_player), false) then
      raise exception 'that fee is not one of yours' using errcode = '42501';
    end if;
  elsif p_player is not null then
    raise exception 'this fee is per family' using errcode = '22023';
  end if;
  if v_req.archived_at is not null or (v_req.closes_at is not null and v_req.closes_at <= now()) then
    raise exception 'this fee is closed' using errcode = '22023';
  end if;
  -- Still owed: the quote's own arithmetic, with what is paid or clearing taken off.
  v_owed := (public.quote_payment(p_request, p_player) ->> 'outstanding_cents')::integer;
  if coalesce(v_owed, 0) <= 0 then
    raise exception 'there is nothing left to pay on this' using errcode = '22023';
  end if;
  select coalesce(a.timezone, 'Australia/Sydney') into v_tz from public.academies a where a.id = v_req.academy_id;
  v_today := (now() at time zone v_tz)::date;
  v_last := least(v_today + 60, coalesce((v_req.closes_at at time zone v_tz)::date, v_today + 60));
  if p_by is null or p_by <= v_today then
    raise exception 'pick a day from tomorrow' using errcode = '22023';
  end if;
  if p_by > v_last then
    raise exception 'the latest day you can pick is %', to_char(v_last, 'FMDay FMDD Mon') using errcode = '22023';
  end if;

  insert into public.payment_promises (academy_id, request_id, player_id, profile_id, by_date)
  values (v_req.academy_id, p_request, p_player, auth.uid(), p_by)
  on conflict (request_id, coalesce(player_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set by_date = excluded.by_date, profile_id = excluded.profile_id
  returning id into v_id;
  -- A reminder queued for a day no longer promised goes; the sweep makes the new one.
  delete from public.notification_queue q
   where q.kind = 'fee_due' and q.sent_at is null and q.dedupe_key like 'promise:' || v_id || ':%';

  return jsonb_build_object('id', v_id, 'by_date', p_by, 'latest', v_last);
end;
$fn$;

-- my_payment_requests, from 0193_a_voucher_and_a_chase.sql, with the promised day
drop function if exists public.my_payment_requests(uuid);
create or replace function public.my_payment_requests(p_academy uuid)
returns table(request_id uuid, title text, description text, amount_cents integer, currency text, due_on date, closes_at timestamptz, team_name text, player_id uuid, player_name text, status text, paid_at timestamptz, can_pay boolean, voucher_cents integer, voucher_label text, promised_by date)
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
      where vr.request_id = r.id and vr.player_id is not distinct from (case when r.per_player then m.id end) limit 1),
    (select pp.by_date from public.payment_promises pp
      where pp.request_id = r.id and pp.player_id is not distinct from (case when r.per_player then m.id end))
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

-- payment_register, from 0126_a_fee_that_belongs_to_a_program.sql, with the promised day
drop function if exists public.payment_register(uuid);
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

  if v_academy is null or not coalesce(app_private.is_academy_staff(v_academy), false) then
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

-- outstanding_fees, from 0226_a_bank_payment_clears.sql, with the promised day
drop function if exists public.outstanding_fees(uuid);
create or replace function public.outstanding_fees(p_academy uuid)
returns table(request_id uuid, title text, player_id uuid, player_name text, guardian_name text, guardian_phone text, net_cents integer, paid_cents integer, outstanding_cents integer, next_due date, days_overdue integer, promised_by date)
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

-- queue_fee_reminders, from 0226_a_bank_payment_clears.sql, with the promised day
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
    select c.*, (current_date - c.due_on) as days, pp.id as promise_id, pp.by_date,
           case
             -- 0227: the family named a day. A nudge the day before it, and
             -- no chase until it has passed.
             when pp.by_date is not null and pp.by_date >= current_date then
               case when pp.by_date - current_date = 1 then 'promise' end
             when current_date - c.due_on = -3 then 'due3'
             when current_date - c.due_on in (3, 7, 14) then 'late' || (current_date - c.due_on)
             when current_date - c.due_on > 14 and (current_date - c.due_on) % 14 = 0 then 'late' || (current_date - c.due_on)
           end as bucket
      from charged c
      left join public.payment_promises pp
        on pp.request_id = c.request_id and pp.player_id is not distinct from c.player_id
     where c.outstanding > 0
  ),
  queued as (
    insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload, dedupe_key)
    select d.academy_id, pg.profile_id,
           case when d.bucket = 'promise' or d.days < 0 then 'fee_due' else 'fee_overdue' end,
           case when d.bucket = 'promise' then d.title || ' — you said you''d pay by tomorrow'
                when d.days < 0 then d.title || ' is due ' || to_char(d.due_on, 'FMDay')
                else d.title || ' is ' || d.days || ' days overdue' end,
           d.full_name || ' — $' || to_char(d.outstanding / 100.0, 'FM999999990.00') || ' to pay'
             || case when d.bucket = 'promise' then '. Pay in the app, or pick another day if you need to.'
                     when d.days < 0 then '. Pay in the app, or tell the club if there is a problem.'
                     else '. The club chases what is overdue; pay in the app or talk to them.' end,
           '/payments',
           jsonb_build_object('request_id', d.request_id, 'player_id', d.player_id, 'days', d.days)
             || case when d.bucket = 'promise' then jsonb_build_object('promise_id', d.promise_id, 'by_date', d.by_date) else '{}'::jsonb end,
           case when d.bucket = 'promise' then 'promise:' || d.promise_id || ':' || d.by_date || ':' || pg.profile_id
                else 'fee:' || d.request_id || ':' || d.player_id || ':' || pg.profile_id || ':' || d.bucket end
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

revoke execute on function public.promise_to_pay(uuid, uuid, date) from public, anon;
revoke execute on function public.my_payment_requests(uuid) from public, anon;
revoke execute on function public.payment_register(uuid) from public, anon;
revoke execute on function public.outstanding_fees(uuid) from public, anon;
grant execute on function public.promise_to_pay(uuid, uuid, date) to authenticated;
grant execute on function public.my_payment_requests(uuid) to authenticated;
grant execute on function public.payment_register(uuid) to authenticated;
grant execute on function public.outstanding_fees(uuid) to authenticated;
