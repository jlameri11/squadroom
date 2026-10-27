-- 0126: B-01. A fee that belongs to a program, not to a team.
--
-- The repo's own plan says B-01 "becomes wiring": a registration flows
-- through the existing `payment_requests` and the existing checkout, and
-- there is no second payment path. That is right, and CLAUDE.md is blunt
-- about why — platform billing and academy collections never share a code
-- path, and a bug that crosses them charges the wrong party. So nothing here
-- touches Stripe.
--
-- The wiring turned out to be one missing relationship. `my_payment_requests`
-- already matches a parent's children to a fee by TEAM, so the moment a club
-- approves a registration and puts the child in a squad, that squad's fees
-- appear as owed with no new code at all. What it cannot express is the fee a
-- program carries:
--
--   `programs.payment_request_id` exists and points at a request. If that
--   request has no team, every child in the academy is billed for a camp
--   eighteen of them never registered for. If it has a team, a program that
--   draws from three age groups cannot be billed at all.
--
-- So a request gains `program_id`, and it is owed by the children with an
-- approved registration in that program. Narrower than a team, which is the
-- point: a camp is not an age group.
--
-- WHY THE FEE IS NOT TAKEN AT THE FORM. A public registration is a request a
-- club has not yet accepted. Charging a card before a human has said yes
-- means refunding every family a club turns away, and refunds are a second
-- money path with its own failure modes — for a signal that coach approval
-- already provides. The public page SHOWS the fee, so nobody is surprised,
-- and the charge happens through the proven checkout once the child is on
-- the roster and the family has an account.

alter table public.payment_requests
  add column if not exists program_id uuid;

-- Composite, like every other child relationship here, so a request cannot
-- point at another academy's program.
alter table public.payment_requests
  drop constraint if exists payment_requests_program_fk;
alter table public.payment_requests
  add constraint payment_requests_program_fk
  foreign key (program_id, academy_id)
  references public.programs(id, academy_id) on delete cascade;

-- A fee is scoped by a team OR a program, never both. Both would mean two
-- answers to "who owes this", and the one that applied would depend on which
-- clause a reader happened to write first.
alter table public.payment_requests
  drop constraint if exists payment_requests_one_scope;
alter table public.payment_requests
  add constraint payment_requests_one_scope
  check (team_id is null or program_id is null);

create index if not exists payment_requests_program_idx
  on public.payment_requests (program_id) where program_id is not null;

comment on column public.payment_requests.program_id is
  'A fee owed by the children registered in this program, rather than by a
   team. A camp is not an age group: a team-scoped fee bills eighteen children
   who never registered, and an academy-wide one bills everybody.';

/**
 * Is this child registered in this program?
 *
 * Approved only. A pending registration is a family a club has not accepted,
 * and billing them before saying yes is the thing 0126 exists not to do.
 */
create or replace function app_private.is_in_program(p_program uuid, p_player uuid)
returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.program_registrations r
     where r.program_id = p_program
       and r.player_id = p_player
       and r.status = 'approved'
  );
$fn$;

/**
 * What this parent owes. One row per child per request.
 *
 * 0061's version, with program-scoped fees added. The team clause is
 * untouched — a club's existing fees must keep behaving exactly as they did,
 * and the most expensive kind of mistake here is a family suddenly being
 * shown money they do not owe.
 */
create or replace function public.my_payment_requests(p_academy uuid)
returns table (
  request_id   uuid,
  title        text,
  description  text,
  amount_cents integer,
  currency     text,
  due_on       date,
  closes_at    timestamptz,
  team_name    text,
  player_id    uuid,
  player_name  text,
  status       text,
  paid_at      timestamptz,
  can_pay      boolean
)
language sql stable security definer set search_path = public as $fn$
  with mine as (
    select pl.id, pl.full_name, pl.team_id
      from public.players pl
      join public.player_guardians pg
        on pg.player_id = pl.id and pg.profile_id = auth.uid()
     where pl.academy_id = p_academy
  )
  select
    r.id, r.title, r.description, r.amount_cents, r.currency, r.due_on, r.closes_at,
    -- The program's name where there is one, so a parent reads "January
    -- Holiday Camp" rather than a blank where a squad would be.
    coalesce(t.name, pg2.name),
    case when r.per_player then m.id end,
    case when r.per_player then m.full_name end,
    coalesce(p.status, 'unpaid'),
    p.paid_at,
    -- An academy that has not finished Stripe onboarding must not be offered
    -- a Pay button that dead-ends. Better to show the amount and say it is
    -- not ready than to send someone into a broken checkout.
    coalesce(b.charges_enabled, false)
  from public.payment_requests r
  left join public.teams t on t.id = r.team_id
  left join public.programs pg2 on pg2.id = r.program_id
  left join public.academy_billing b on b.academy_id = r.academy_id
  left join mine m
    on r.per_player
   and (r.team_id is null or m.team_id = r.team_id)
   -- A program fee is owed by the children IN the program, and by nobody
   -- else — not by their squad and not by the academy.
   and (r.program_id is null or app_private.is_in_program(r.program_id, m.id))
  left join public.payments p
    on p.request_id = r.id
   and p.player_id is not distinct from (case when r.per_player then m.id end)
 where r.academy_id = p_academy
   and r.archived_at is null
   and (r.closes_at is null or r.closes_at > now())
   and (r.team_id is null
        or app_private.is_team_member(r.team_id))
   -- A per-player request with none of your children in that team is not
   -- your bill, so it should not appear at all.
   and (not r.per_player or m.id is not null)
   -- And neither is a program fee with none of your children registered in
   -- it. Separate from the clause above because a program fee is not
   -- necessarily per-player: a club may charge one amount per family.
   and (r.program_id is null or exists (
         select 1 from mine m2
          where app_private.is_in_program(r.program_id, m2.id)
       ))
   and app_private.is_academy_member(p_academy)
 order by r.due_on nulls last, r.created_at, m.full_name;
$fn$;

revoke execute on function public.my_payment_requests(uuid) from public, anon;
grant execute on function public.my_payment_requests(uuid) to authenticated;

/**
 * Who has not paid. Staff only, and it returns names because chasing is the
 * whole point — a count of "9 of 14" tells a coach nothing they can act on.
 *
 * 0061's version, scoped by program as well as by team.
 */
create or replace function public.payment_register(p_request uuid)
returns table (
  player_id    uuid,
  player_name  text,
  guardian     text,
  guardian_phone text,
  status       text,
  paid_at      timestamptz,
  amount_cents integer
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
      coalesce(p.amount_cents, r.amount_cents)
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

revoke execute on function public.payment_register(uuid) from public, anon;
grant execute on function public.payment_register(uuid) to authenticated;

/**
 * Give a program its fee, in one call.
 *
 * A club setting up a camp should not have to create a payment request, find
 * its id, and then remember to set two columns in the right order — which is
 * the only way these could otherwise be linked, and leaves a half-linked fee
 * if they stop halfway.
 *
 * The amount is INTEGER CENTS. Dollars typed in a form are
 * `Math.round(x * 100)` on the way in: 49.9 * 100 is 4989.999999999999.
 */
create or replace function public.set_program_fee(
  p_program      uuid,
  p_amount_cents integer,
  p_title        text default null,
  p_due_on       date default null,
  p_instalments  integer default 1,
  p_every_days   integer default 30
)
returns uuid
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_program public.programs;
  v_request uuid;
begin
  select * into v_program from public.programs where id = p_program;
  if v_program.id is null then
    raise exception 'no such program' using errcode = '22023';
  end if;
  if not coalesce(app_private.is_academy_staff(v_program.academy_id), false) then
    raise exception 'only a club admin can set a fee' using errcode = '42501';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'a fee needs an amount' using errcode = '22023';
  end if;

  -- Reuse the request this program already points at, so setting a fee twice
  -- corrects it rather than leaving the old one owed as well.
  select payment_request_id into v_request from public.programs where id = p_program;

  if v_request is null then
    insert into public.payment_requests (
      academy_id, program_id, title, amount_cents,
      currency, per_player, due_on, instalments, instalment_every_days, created_by
    ) values (
      v_program.academy_id, p_program,
      coalesce(nullif(btrim(coalesce(p_title, '')), ''), v_program.name),
      p_amount_cents,
      coalesce((select currency from public.academy_billing where academy_id = v_program.academy_id), 'aud'),
      true, p_due_on, greatest(coalesce(p_instalments, 1), 1), coalesce(p_every_days, 30),
      auth.uid()
    )
    returning id into v_request;

    update public.programs
       set payment_request_id = v_request, payment_required = true, updated_at = now()
     where id = p_program;
  else
    update public.payment_requests
       set title = coalesce(nullif(btrim(coalesce(p_title, '')), ''), title),
           amount_cents = p_amount_cents,
           due_on = p_due_on,
           instalments = greatest(coalesce(p_instalments, 1), 1),
           instalment_every_days = coalesce(p_every_days, 30),
           -- Linked here too, because a request created before this function
           -- existed will have a program_id of null and would otherwise
           -- stay owed by the whole academy.
           program_id = p_program,
           team_id = null,
           updated_at = now()
     where id = v_request;

    update public.programs
       set payment_required = true, updated_at = now()
     where id = p_program;
  end if;

  return v_request;
end;
$fn$;

revoke execute on function public.set_program_fee(uuid, integer, text, date, integer, integer)
  from public, anon;
grant execute on function public.set_program_fee(uuid, integer, text, date, integer, integer)
  to authenticated;
