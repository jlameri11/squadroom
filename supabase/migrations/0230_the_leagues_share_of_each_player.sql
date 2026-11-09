-- 0230: the league's share of each player, and what each club owes it.
--
-- B-09 as Joey decided it (9 Nov 2026, NEEDS JOEY #23). The spec said "one
-- checkout, two transfers": the family pays once and the league's share
-- moves to the league's Stripe account. Stripe will not move money between
-- two connected accounts, and Squadroom is never in the flow of funds (the
-- 30 Oct rule), so that cannot be built. Instead, the way entry fees work
-- (0167): THE CLUB COLLECTS THE WHOLE FEE, and the league sees what each
-- club owes it — a levy per registered player, set per division — ticked
-- off by the league's treasurer when the club pays, by bank or in cash.
--
-- WHAT A CLUB OWES is worked out when asked, never stored: the players on
-- the club's entered squads today, times the levy for each squad's division
-- (a division's own rate, else the rate for all). Players come and go
-- through a season; a stored figure would be wrong by Saturday. Payments
-- are the stored part, so the balance is honest about what has moved.
--
-- The league sees every club's statement; a club's staff see only their
-- own; a family sees nothing of it. Squadroom takes nothing.

create table if not exists public.competition_levies (
  competition_id uuid not null references public.competitions(id) on delete cascade,
  -- '' means every division without its own rate.
  division       text not null default '',
  levy_cents     integer not null check (levy_cents between 0 and 100000),
  instructions   text,
  updated_at     timestamptz not null default now(),
  primary key (competition_id, division)
);
alter table public.competition_levies enable row level security;
drop policy if exists competition_levies_select on public.competition_levies;
create policy competition_levies_select on public.competition_levies for select to authenticated
  using ((select app_private.is_competition_participant(competition_levies.competition_id)));
grant select on public.competition_levies to authenticated;

create table if not exists public.levy_payments (
  id              uuid primary key default gen_random_uuid(),
  competition_id  uuid not null references public.competitions(id) on delete cascade,
  club_academy_id uuid not null references public.academies(id) on delete cascade,
  amount_cents    integer not null check (amount_cents > 0),
  method          text not null check (method in ('bank', 'cash')),
  note            text,
  paid_on         date not null default current_date,
  recorded_by     uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists levy_payments_competition_idx on public.levy_payments (competition_id, club_academy_id);
alter table public.levy_payments enable row level security;
drop policy if exists levy_payments_select on public.levy_payments;
create policy levy_payments_select on public.levy_payments for select to authenticated
  using ((select app_private.may_run(levy_payments.competition_id, 'competition'))
         or (select app_private.is_academy_staff(levy_payments.club_academy_id)));
-- Written only through record_levy_payment / undo_levy_payment.
grant select on public.levy_payments to authenticated;

/** The levy for a division: its own rate, else the rate for all; null when none is set. */
create or replace function app_private.levy_for(p_competition uuid, p_division text)
returns integer
language sql stable security definer set search_path = public as $fn$
  select l.levy_cents from public.competition_levies l
   where l.competition_id = p_competition and l.division in (coalesce(p_division, ''), '')
   order by (l.division = coalesce(p_division, '')) desc
   limit 1;
$fn$;

/**
 * One club's statement: its entered squads' players by division, the levy
 * each attracts, what has been paid, the balance. The organiser's view and
 * the club's own are the same figures.
 */
create or replace function app_private.levy_statement_for(p_competition uuid, p_club uuid)
returns jsonb
language sql stable security definer set search_path = public as $fn$
  with lines as (
    select ce.division,
           count(pl.id)::integer as players,
           app_private.levy_for(ce.competition_id, ce.division) as levy_cents
      from public.competition_entries ce
      left join public.players pl on pl.team_id = ce.team_id
     where ce.competition_id = p_competition and ce.academy_id = p_club and ce.team_id is not null
     group by ce.competition_id, ce.division
  ),
  paid as (
    select coalesce(sum(p.amount_cents), 0)::integer as cents,
           coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'amount_cents', p.amount_cents, 'method', p.method, 'paid_on', p.paid_on, 'note', p.note)
                              order by p.paid_on desc, p.created_at desc), '[]'::jsonb) as list
      from public.levy_payments p
     where p.competition_id = p_competition and p.club_academy_id = p_club
  )
  select jsonb_build_object(
    'club_id', p_club,
    'club', (select a.name from public.academies a where a.id = p_club),
    'players', coalesce((select sum(l.players) from lines l where l.levy_cents is not null), 0),
    'owed_cents', coalesce((select sum(l.players * l.levy_cents) from lines l where l.levy_cents is not null), 0),
    'paid_cents', (select cents from paid),
    'balance_cents', coalesce((select sum(l.players * l.levy_cents) from lines l where l.levy_cents is not null), 0) - (select cents from paid),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('division', l.division, 'players', l.players, 'levy_cents', l.levy_cents,
                                                           'owed_cents', l.players * coalesce(l.levy_cents, 0))
                                        order by l.division)
                         from lines l), '[]'::jsonb),
    'payments', (select list from paid));
$fn$;

-- ----------------------------------------------------------- the organiser
create or replace function public.levy_statement(p_competition uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
begin
  if not app_private.may_run(p_competition, 'competition') then
    raise exception 'only the organiser sees what the clubs owe' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'levies', coalesce((select jsonb_agg(jsonb_build_object('division', l.division, 'levy_cents', l.levy_cents, 'instructions', l.instructions) order by l.division)
                          from public.competition_levies l where l.competition_id = p_competition), '[]'::jsonb),
    'clubs', coalesce((
      select jsonb_agg(s order by s ->> 'club')
        from (select app_private.levy_statement_for(p_competition, cc.academy_id) as s
                from public.competition_clubs cc
               where cc.competition_id = p_competition and cc.status = 'active') x), '[]'::jsonb));
end;
$fn$;

create or replace function public.set_competition_levy(p_competition uuid, p_division text, p_levy_cents integer, p_instructions text default null)
returns jsonb
language plpgsql volatile security definer set search_path = public as $fn$
begin
  if not app_private.may_run(p_competition, 'competition') then
    raise exception 'only the organiser sets the levy' using errcode = '42501';
  end if;
  if p_levy_cents is null or p_levy_cents < 0 or p_levy_cents > 100000 then
    raise exception 'a levy is between nothing and $1,000 a player' using errcode = '22023';
  end if;
  insert into public.competition_levies (competition_id, division, levy_cents, instructions)
  values (p_competition, coalesce(p_division, ''), p_levy_cents, nullif(btrim(coalesce(p_instructions, '')), ''))
  on conflict (competition_id, division) do update
    set levy_cents = excluded.levy_cents,
        instructions = coalesce(excluded.instructions, public.competition_levies.instructions),
        updated_at = now();
  return public.levy_statement(p_competition);
end;
$fn$;

create or replace function public.record_levy_payment(p_competition uuid, p_club uuid, p_amount_cents integer, p_method text default 'bank', p_note text default null, p_paid_on date default null)
returns jsonb
language plpgsql volatile security definer set search_path = public as $fn$
begin
  if not app_private.may_run(p_competition, 'competition') then
    raise exception 'only the organiser records what a club has paid' using errcode = '42501';
  end if;
  if not exists (select 1 from public.competition_clubs cc where cc.competition_id = p_competition and cc.academy_id = p_club and cc.status = 'active') then
    raise exception 'that club is not in this competition' using errcode = '22023';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'an amount, in whole cents' using errcode = '22023';
  end if;
  if p_method not in ('bank', 'cash') then
    raise exception 'paid how? bank or cash' using errcode = '22023';
  end if;
  insert into public.levy_payments (competition_id, club_academy_id, amount_cents, method, note, paid_on, recorded_by)
  values (p_competition, p_club, p_amount_cents, p_method, nullif(btrim(coalesce(p_note, '')), ''), coalesce(p_paid_on, current_date), auth.uid());
  return public.levy_statement(p_competition);
end;
$fn$;

create or replace function public.undo_levy_payment(p_payment uuid)
returns jsonb
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v public.levy_payments;
begin
  select * into v from public.levy_payments where id = p_payment;
  if v.id is null or not app_private.may_run(v.competition_id, 'competition') then
    raise exception 'only the organiser undoes a recorded payment' using errcode = '42501';
  end if;
  delete from public.levy_payments where id = p_payment;
  return public.levy_statement(v.competition_id);
end;
$fn$;

-- ---------------------------------------------------------------- the club
/** What this club owes the league here, with the league's payment instructions. Staff of the club only. */
create or replace function public.my_levy_statement(p_competition uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_club uuid;
begin
  select cc.academy_id into v_club
    from public.competition_clubs cc
   where cc.competition_id = p_competition and cc.status = 'active'
     and coalesce(app_private.is_academy_staff(cc.academy_id), false)
   order by cc.created_at
   limit 1;
  if v_club is null then
    raise exception 'only a club''s staff see what their club owes' using errcode = '42501';
  end if;
  return app_private.levy_statement_for(p_competition, v_club)
    || jsonb_build_object(
         'league', (select o.name from public.competitions c join public.academies o on o.id = c.organiser_id where c.id = p_competition),
         'instructions', coalesce(
           (select l.instructions from public.competition_levies l where l.competition_id = p_competition and l.division = ''),
           (select l.instructions from public.competition_levies l where l.competition_id = p_competition and l.instructions is not null order by l.division limit 1)),
         'levies', coalesce((select jsonb_agg(jsonb_build_object('division', l.division, 'levy_cents', l.levy_cents) order by l.division)
                               from public.competition_levies l where l.competition_id = p_competition), '[]'::jsonb));
end;
$fn$;

revoke execute on function public.levy_statement(uuid) from public, anon;
revoke execute on function public.set_competition_levy(uuid, text, integer, text) from public, anon;
revoke execute on function public.record_levy_payment(uuid, uuid, integer, text, text, date) from public, anon;
revoke execute on function public.undo_levy_payment(uuid) from public, anon;
revoke execute on function public.my_levy_statement(uuid) from public, anon;
grant execute on function public.levy_statement(uuid) to authenticated;
grant execute on function public.set_competition_levy(uuid, text, integer, text) to authenticated;
grant execute on function public.record_levy_payment(uuid, uuid, integer, text, text, date) to authenticated;
grant execute on function public.undo_levy_payment(uuid) to authenticated;
grant execute on function public.my_levy_statement(uuid) to authenticated;
