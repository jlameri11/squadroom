-- 0102: term fees, in instalments, with the second child cheaper.
--
-- DRIBL_INTEL's list of gaps nobody fills for Australian academies has this
-- second: "academy billing: term fees, instalments, sibling discounts,
-- trials, make-up credits". Dribl does not do it — its own registration
-- product has no instalments and no sibling rules, and clubs "handle these
-- manually". Every academy I know of does it in a spreadsheet and then chases
-- parents by text.
--
-- It is also the feature an owner cares most about, because it is the money.
--
-- THE AMOUNT IS STILL READ FROM THE DATABASE. CLAUDE.md is explicit that
-- taking a price from the client is how somebody pays 50c for a $50 gala day.
-- This adds arithmetic on top of `amount_cents`, so the arithmetic has to
-- live in ONE place that the checkout route and the parent's screen both ask.
-- That place is `quote_payment` below. The route is changed in the same
-- commit; a discount the screen shows and the checkout ignores would charge
-- a family the wrong amount, which is worse than no discount at all.
--
-- INTEGER CENTS THROUGHOUT, and instalments are divided so they sum back to
-- the net exactly — the last one absorbs the remainder. 49.9 * 100 is
-- 4989.999999999999 and a season fee that is a cent out across four
-- instalments is a conversation nobody should have to have.

-- A ladder, not a single number: "2nd child 10% off, 3rd and beyond 20%".
-- Index 0 is the second child, index 1 the third, and the last entry applies
-- to every child beyond it — so {1000, 2000} covers a family of six.
alter table public.academies
  add column if not exists sibling_discount_bps integer[] not null default '{}';

comment on column public.academies.sibling_discount_bps is
  'Sibling discount in basis points, by child. Index 0 is the SECOND child,
   index 1 the third, and the final entry applies to all further children.
   {1000, 2000} is "second child 10% off, third and beyond 20%". Empty means
   no sibling discount.';

/**
 * Is every entry in a discount ladder a sane basis-point figure?
 *
 * A function because a CHECK constraint may not contain a subquery of any
 * kind, and there is no way to walk an array without one. Marked immutable so
 * the constraint is allowed to call it.
 */
create or replace function app_private.bps_ladder_ok(p_ladder integer[])
returns boolean
language sql immutable as $fn$
  select p_ladder is null
      or array_length(p_ladder, 1) is null
      or (
        array_length(p_ladder, 1) <= 10
        -- Nothing negative, and nothing over 100% off.
        and not exists (
          select 1 from unnest(p_ladder) v where v < 0 or v > 10000
        )
      );
$fn$;

do $$ begin
  alter table public.academies
    add constraint academies_sibling_discount_sane
    check (app_private.bps_ladder_ok(sibling_discount_bps));
exception when duplicate_object then null; end $$;

alter table public.payment_requests
  -- 1 means pay it all at once, which is what everything already created
  -- does.
  add column if not exists instalments integer not null default 1
    check (instalments between 1 and 12),
  add column if not exists instalment_every_days integer not null default 30
    check (instalment_every_days between 7 and 120);

-- One payment row per INSTALMENT, not per player.
--
-- 0060's `payments_one_per_player` made a second row for the same child
-- impossible, which is right when a request is paid once and wrong the
-- moment it is paid in four. The webhook is unaffected: it matches on
-- stripe_session_id, never on this pair.
alter table public.payments
  add column if not exists instalment_seq integer not null default 1
    check (instalment_seq >= 1);

do $$ begin
  alter table public.payments drop constraint payments_one_per_player;
exception when undefined_object then null; end $$;

do $$ begin
  alter table public.payments
    add constraint payments_one_per_instalment
    unique nulls not distinct (request_id, player_id, instalment_seq);
exception when duplicate_object then null; end $$;

/**
 * Which child this is, in their family, for this request.
 *
 * Ranked by date of birth, oldest first, among the guardian's children who
 * are IN SCOPE for this request — the whole academy if it has no team, that
 * squad if it does. So a club charging the U8s does not give a discount
 * because the family also has a U12 who is not being charged, and the oldest
 * child being charged pays full price, which is the convention every club
 * already uses.
 *
 * Returns 1 when there is nothing to rank, so the caller never has to handle
 * a null and accidentally treat it as a discount.
 */
create or replace function app_private.sibling_rank(
  p_request uuid,
  p_player  uuid,
  p_payer   uuid
)
returns integer
language sql stable security definer set search_path = public as $fn$
  with scope as (
    select r.academy_id, r.team_id
      from public.payment_requests r
     where r.id = p_request
  ),
  family as (
    select pl.id, pl.dob
      from public.players pl
      join public.player_guardians pg
        on pg.player_id = pl.id and pg.profile_id = p_payer
      join scope s on s.academy_id = pl.academy_id
     where s.team_id is null or pl.team_id = s.team_id
  )
  select coalesce(
    (select count(*)::integer + 1
       from family f
      where f.dob is not null
        and f.dob < (select dob from family where id = p_player)),
    1
  );
$fn$;

/**
 * What this family owes for this child, and when.
 *
 * The single source of truth for a price. The checkout route asks this and
 * charges what it says; the parent's screen asks this and shows what it says.
 * Two places computing the same number is how a family is charged one thing
 * and shown another.
 *
 * Callable by a guardian of the child, or by academy staff. A guardian asking
 * about somebody else's child gets nothing rather than a price.
 */
create or replace function public.quote_payment(
  p_request uuid,
  p_player  uuid default null
)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_req       public.payment_requests;
  v_payer     uuid := auth.uid();
  v_rank      integer := 1;
  v_bps       integer := 0;
  v_ladder    integer[];
  v_gross     integer;
  v_net       integer;
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

  -- A guardian may ask about their own child; staff may ask about anyone.
  if not (
    app_private.is_academy_staff(v_req.academy_id)
    or (p_player is not null and app_private.is_guardian_of(p_player))
    or (p_player is null and app_private.is_academy_member(v_req.academy_id))
  ) then
    return null;
  end if;

  v_gross := v_req.amount_cents;

  if p_player is not null then
    select sibling_discount_bps into v_ladder
      from public.academies where id = v_req.academy_id;

    if coalesce(array_length(v_ladder, 1), 0) > 0 then
      v_rank := app_private.sibling_rank(p_request, p_player, v_payer);
      if v_rank > 1 then
        -- The ladder runs out at the last entry, which then applies to every
        -- further child.
        v_bps := v_ladder[least(v_rank - 1, array_length(v_ladder, 1))];
      end if;
    end if;
  end if;

  -- Rounded to the cent, never a float.
  v_net := v_gross - round(v_gross::numeric * v_bps / 10000)::integer;

  -- The schedule. Divided so the parts sum back to the net exactly: the last
  -- one absorbs the remainder rather than every part carrying a rounding
  -- error.
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
      -- The first part is due when the request is; each later one a month on.
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
    'discount_cents', v_gross - v_net,
    'net_cents', v_net,
    'instalments', v_req.instalments,
    'schedule', v_schedule,
    -- What is left to pay, which is the number a parent actually reads.
    'outstanding_cents', (
      select coalesce(sum((s->>'amount_cents')::integer), 0)
        from jsonb_array_elements(v_schedule) s
       where s->>'status' <> 'paid'
    )
  );
end;
$fn$;

revoke execute on function public.quote_payment(uuid, uuid) from public, anon;
grant execute on function public.quote_payment(uuid, uuid) to authenticated;

/**
 * Who owes what, for the person running the club.
 *
 * The question an academy owner asks more than any other, and the one that
 * currently takes a spreadsheet and an evening. One row per child per
 * request, with what is outstanding and how overdue it is.
 *
 * Staff only. A list of which families are behind on fees is not something
 * other parents get to read.
 */
create or replace function public.outstanding_fees(p_academy uuid)
returns table (
  request_id    uuid,
  title         text,
  player_id     uuid,
  player_name   text,
  guardian_name text,
  guardian_phone text,
  net_cents     integer,
  paid_cents    integer,
  outstanding_cents integer,
  next_due      date,
  days_overdue  integer
)
language plpgsql stable security definer set search_path = public as $fn$
begin
  if not app_private.is_academy_staff(p_academy) then
    raise exception 'only club admins can see who owes money' using errcode = '42501';
  end if;

  return query
  with charged as (
    select r.id as request_id, r.title, r.amount_cents, r.instalments,
           r.instalment_every_days, coalesce(r.due_on, r.created_at::date) as due_on,
           pl.id as player_id,
           coalesce(nullif(btrim(pl.preferred_name), ''), pl.full_name) as player_name,
           pl.dob,
           r.team_id
      from public.payment_requests r
      join public.players pl
        on pl.academy_id = r.academy_id
       and (r.team_id is null or pl.team_id = r.team_id)
     where r.academy_id = p_academy
       and r.archived_at is null
       and r.per_player
  ),
  -- The payer is whichever guardian is primary, falling back to any of them,
  -- because the discount and the chasing both follow one adult.
  payer as (
    select c.*, pg.profile_id as guardian_id
      from charged c
      left join lateral (
        select g.profile_id
          from public.player_guardians g
         where g.player_id = c.player_id
         order by g.is_primary desc nulls last, g.created_at
         limit 1
      ) pg on true
  ),
  ranked as (
    select p.*,
           case
             when p.guardian_id is null or p.dob is null then 1
             else (
               select count(*)::integer + 1
                 from public.players sib
                 join public.player_guardians sg
                   on sg.player_id = sib.id and sg.profile_id = p.guardian_id
                where sib.academy_id = p_academy
                  and (p.team_id is null or sib.team_id = p.team_id)
                  and sib.dob is not null
                  and sib.dob < p.dob
             )
           end as sibling_rank
      from payer p
  ),
  priced as (
    select r.*,
           (select sibling_discount_bps from public.academies where id = p_academy) as ladder
      from ranked r
  ),
  netted as (
    select p.*,
           case
             when coalesce(array_length(p.ladder, 1), 0) = 0 or p.sibling_rank <= 1 then 0
             else p.ladder[least(p.sibling_rank - 1, array_length(p.ladder, 1))]
           end as bps
      from priced p
  )
  select n.request_id, n.title, n.player_id, n.player_name,
         gp.full_name, gp.phone::text,
         (n.amount_cents - round(n.amount_cents::numeric * n.bps / 10000)::integer)::integer,
         coalesce(paid.cents, 0)::integer,
         ((n.amount_cents - round(n.amount_cents::numeric * n.bps / 10000)::integer)
           - coalesce(paid.cents, 0))::integer,
         n.due_on,
         greatest(0, (current_date - n.due_on))::integer
    from netted n
    left join public.profiles gp on gp.id = n.guardian_id
    left join lateral (
      select sum(pay.amount_cents) as cents
        from public.payments pay
       where pay.request_id = n.request_id
         and pay.player_id is not distinct from n.player_id
         and pay.status = 'paid'
    ) paid on true
   where (n.amount_cents - round(n.amount_cents::numeric * n.bps / 10000)::integer)
         - coalesce(paid.cents, 0) > 0
   order by greatest(0, (current_date - n.due_on)) desc, n.title, n.player_name;
end;
$fn$;

revoke execute on function public.outstanding_fees(uuid) from public, anon;
grant execute on function public.outstanding_fees(uuid) to authenticated;
