-- 0163: the referee gets paid.
--
-- L-07. A referee who turned up is owed a match fee, and the league's
-- treasurer pays a fortnight's worth at a time. Squadi does this with
-- Stripe Connect payouts; Dribl does not do it at all. Everything here
-- except the Stripe transfer itself works without a Stripe key: the fee
-- schedule, the run, the amounts, marking a run paid by bank transfer,
-- and the export the treasurer actually uses.
--
-- FEES PER COMPETITION AND ROLE, because the U8s pay a referee less than
-- the Premier League does and an assistant less than the referee.
--
-- A RUN IS A SNAPSHOT. Building one collects every accepted appointment
-- in the window that the referee CHECKED IN to (0161) and is not already
-- in a run, writes the amount from the schedule at that moment, and locks
-- it onto the appointment. Changing the schedule later changes future
-- runs, never a run already built — a payment that moves after it is
-- written is a reconciliation problem.
--
-- PAID is a fact the treasurer records: by bank transfer today, by a
-- Stripe transfer once the league's account and the referee's exist
-- (L-25 for the referee side). Referees are paid BY THE LEAGUE, so this
-- rides the league's connected account, never a club's.

create table if not exists public.competition_referee_fees (
  competition_id uuid not null references public.competitions(id) on delete cascade,
  role           public.referee_role not null,
  fee_cents      integer not null check (fee_cents >= 0),
  updated_at     timestamptz not null default now(),
  primary key (competition_id, role)
);
alter table public.competition_referee_fees enable row level security;
create policy referee_fees_select on public.competition_referee_fees for select to authenticated
  using ((select app_private.is_competition_organiser(competition_referee_fees.competition_id)));
create policy referee_fees_insert on public.competition_referee_fees for insert to authenticated
  with check ((select app_private.is_competition_organiser(competition_referee_fees.competition_id)));
create policy referee_fees_update on public.competition_referee_fees for update to authenticated
  using ((select app_private.is_competition_organiser(competition_referee_fees.competition_id)));
create policy referee_fees_delete on public.competition_referee_fees for delete to authenticated
  using ((select app_private.is_competition_organiser(competition_referee_fees.competition_id)));

-- Where the money goes. Typed by the referee on their own page, read by
-- the league's staff and nobody else (the referees table's own policy).
alter table public.referees
  add column if not exists bank_details text,
  add column if not exists stripe_account_id text;

do $$ begin
  create type public.payment_run_status as enum ('draft', 'paid');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.payment_item_status as enum ('pending', 'paid', 'void');
exception when duplicate_object then null; end $$;

create table if not exists public.referee_payment_runs (
  id             uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  academy_id     uuid not null references public.academies(id) on delete cascade,
  period_from    date not null,
  period_to      date not null,
  status         public.payment_run_status not null default 'draft',
  total_cents    integer not null default 0,
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  paid_at        timestamptz,
  paid_method    text check (paid_method is null or paid_method in ('bank', 'stripe', 'cash')),
  note           text,
  constraint referee_payment_runs_period check (period_to >= period_from)
);
alter table public.referee_payment_runs enable row level security;
create policy referee_payment_runs_select on public.referee_payment_runs for select to authenticated
  using ((select app_private.is_competition_organiser(referee_payment_runs.competition_id)));

create table if not exists public.referee_payment_items (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid not null references public.referee_payment_runs(id) on delete cascade,
  appointment_id uuid not null unique references public.referee_appointments(id) on delete cascade,
  referee_id     uuid not null references public.referees(id) on delete cascade,
  academy_id     uuid not null references public.academies(id) on delete cascade,
  amount_cents   integer not null check (amount_cents >= 0),
  status         public.payment_item_status not null default 'pending',
  paid_at        timestamptz,
  stripe_transfer_id text,
  created_at     timestamptz not null default now()
);
alter table public.referee_payment_items enable row level security;
create policy referee_payment_items_select on public.referee_payment_items for select to authenticated
  using ((select app_private.is_academy_staff(referee_payment_items.academy_id))
         or (select app_private.is_this_referee(referee_payment_items.referee_id)));
create index if not exists referee_payment_items_run_idx on public.referee_payment_items (run_id);

-- ---------------------------------------------------------------------
create or replace function public.set_referee_fee(p_competition uuid, p_role public.referee_role, p_fee_cents integer)
returns void
language plpgsql security definer set search_path = public as $fn$
begin
  if not app_private.is_competition_organiser(p_competition) then
    raise exception 'only the organiser sets referee fees' using errcode = '42501';
  end if;
  if p_fee_cents is null or p_fee_cents < 0 or p_fee_cents > 100000 then
    raise exception 'a match fee is between $0 and $1,000' using errcode = '22023';
  end if;
  insert into public.competition_referee_fees (competition_id, role, fee_cents)
  values (p_competition, p_role, p_fee_cents)
  on conflict (competition_id, role) do update set fee_cents = excluded.fee_cents, updated_at = now();
end;
$fn$;

create or replace function public.set_my_bank_details(p_referee uuid, p_details text)
returns void
language plpgsql security definer set search_path = public as $fn$
begin
  if not app_private.is_this_referee(p_referee) then
    raise exception 'that is not your referee record' using errcode = '42501';
  end if;
  update public.referees set bank_details = nullif(btrim(coalesce(p_details, '')), '') where id = p_referee;
end;
$fn$;

-- Build a run: every accepted, checked-in appointment on a game in the
-- window that is not in a run yet. Returns the run id, or null when there
-- was nothing to pay.
create or replace function public.build_referee_payment_run(p_competition uuid, p_from date, p_to date, p_note text default null)
returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  v_org uuid;
  v_run uuid;
  v_total integer;
begin
  select organiser_id into v_org from public.competitions where id = p_competition;
  if v_org is null or not app_private.is_competition_organiser(p_competition) then
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
$fn$;

-- The treasurer paid it — by bank transfer, cash, or (through the route)
-- Stripe. Every pending item in the run becomes paid.
create or replace function public.mark_referee_run_paid(p_run uuid, p_method text default 'bank')
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_run public.referee_payment_runs;
begin
  select * into v_run from public.referee_payment_runs where id = p_run;
  if v_run.id is null or not app_private.is_competition_organiser(v_run.competition_id) then
    raise exception 'only the organiser marks a run paid' using errcode = '42501';
  end if;
  if p_method not in ('bank', 'stripe', 'cash') then
    raise exception 'paid how? bank, stripe or cash' using errcode = '22023';
  end if;
  update public.referee_payment_items set status = 'paid', paid_at = now()
   where run_id = p_run and status = 'pending';
  update public.referee_payment_runs set status = 'paid', paid_at = now(), paid_method = p_method where id = p_run;
end;
$fn$;

-- A run that was built by mistake, before anyone was paid.
create or replace function public.void_referee_run(p_run uuid)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_run public.referee_payment_runs;
begin
  select * into v_run from public.referee_payment_runs where id = p_run;
  if v_run.id is null or not app_private.is_competition_organiser(v_run.competition_id) then
    raise exception 'only the organiser voids a run' using errcode = '42501';
  end if;
  if v_run.status = 'paid' then
    raise exception 'a paid run stays on the books' using errcode = '22023';
  end if;
  update public.referee_appointments ap set fee_cents = null
    from public.referee_payment_items i where i.appointment_id = ap.id and i.run_id = p_run;
  delete from public.referee_payment_runs where id = p_run;
end;
$fn$;

-- The organiser's view: fees, runs with their items, and what is owed but
-- not yet in a run.
create or replace function public.referee_payments(p_competition uuid)
returns jsonb
language sql stable security definer set search_path = public as $fn$
  select case
    when not app_private.is_competition_organiser(p_competition) then null
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
$fn$;

-- The export: one row per paid-or-pending game fee.
create or replace function public.referee_payments_export(p_competition uuid)
returns table (
  run_period text, run_status text, paid_at timestamptz, paid_method text,
  referee text, grade text, bank_details text, game text, played_on timestamptz, role text,
  amount_cents integer, item_status text
)
language sql stable security definer set search_path = public as $fn$
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
     and app_private.is_competition_organiser(p_competition)
   order by run.created_at desc, r.full_name, f.starts_at;
$fn$;

-- The referee's page carries the fee and whether it was paid.
create or replace function public.my_appointments()
returns jsonb
language sql stable security definer set search_path = public as $fn$
  select jsonb_build_object(
    'pools', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'league', a.name, 'grade', r.grade, 'status', r.status, 'bank_details', r.bank_details) order by a.name)
        from public.referees r join public.academies a on a.id = r.academy_id
       where r.profile_id = auth.uid()
    ), '[]'::jsonb),
    'appointments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', ap.id,
               'role', ap.role,
               'status', ap.status,
               'offered_at', ap.offered_at,
               'checked_in_at', ap.checked_in_at,
               'reported_at', ap.reported_at,
               'report', ap.report,
               'withdrawn_note', ap.withdrawn_note,
               'fixture_id', f.id,
               'starts_at', f.starts_at,
               'fixture_status', f.status,
               'competition', c.name,
               'competition_id', c.id,
               'league', a.name,
               'division', f.division,
               'round', f.round,
               'venue', coalesce(v.name, f.venue_label),
               'address', v.address,
               'field', f.field_label,
               'home', h.display_name,
               'away', aw.display_name,
               'home_score', f.home_score,
               'away_score', f.away_score,
               'fee_cents', coalesce(ap.fee_cents, (select x.fee_cents from public.competition_referee_fees x where x.competition_id = c.id and x.role = ap.role)),
               'paid_at', (select i.paid_at from public.referee_payment_items i where i.appointment_id = ap.id and i.status = 'paid')
             ) order by f.starts_at desc nulls last)
        from public.referee_appointments ap
        join public.referees r on r.id = ap.referee_id
        join public.fixtures f on f.id = ap.fixture_id
        join public.competitions c on c.id = f.competition_id
        join public.academies a on a.id = ap.academy_id
        left join public.venues v on v.id = f.venue_id
        left join public.competition_entries h on h.id = f.home_entry_id
        left join public.competition_entries aw on aw.id = f.away_entry_id
       where r.profile_id = auth.uid()
    ), '[]'::jsonb),
    'blockouts', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'referee_id', b.referee_id, 'starts_at', b.starts_at, 'ends_at', b.ends_at, 'reason', b.reason) order by b.starts_at)
        from public.referee_blockouts b
        join public.referees r on r.id = b.referee_id
       where r.profile_id = auth.uid() and b.ends_at >= now() - interval '30 days'
    ), '[]'::jsonb)
  );
$fn$;

grant execute on function public.set_referee_fee(uuid, public.referee_role, integer) to authenticated;
grant execute on function public.set_my_bank_details(uuid, text) to authenticated;
grant execute on function public.build_referee_payment_run(uuid, date, date, text) to authenticated;
grant execute on function public.mark_referee_run_paid(uuid, text) to authenticated;
grant execute on function public.void_referee_run(uuid) to authenticated;
grant execute on function public.referee_payments(uuid) to authenticated;
grant execute on function public.referee_payments_export(uuid) to authenticated;
grant execute on function public.my_appointments() to authenticated;
