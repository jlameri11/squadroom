-- 0143: the money, as a spreadsheet.
--
-- B-05. Everything a treasurer needs was on a screen and nothing could be
-- taken to a committee meeting or matched against Stripe's payout report.
-- `xlsx` was in the bundle for READING a Dribl export; the product wrote no
-- file of its own but the kit list.
--
-- One row per child per fee, for every fee that is not archived. The money
-- columns come from quote_payment (0102), which is the ONE place a price is
-- worked out — the checkout asks it, the parent's screen asks it, and a
-- spreadsheet that did its own arithmetic would be the third answer to
-- "what does this family owe". Who a fee applies to is payment_register's
-- rule (0126): the squad's players, the program's players, or everyone.
--
-- The Stripe payment-intent ids ride along because Stripe's own payout
-- export is keyed by them, and "match the bank statement to the app" is
-- the question this file exists to answer. Staff only, refused in the
-- function, so the route that serves it has nothing to decide.

create or replace function public.finance_export(p_academy uuid)
returns table (
  request_id    uuid,
  title         text,
  scope_kind    text,
  scope_name    text,
  due_on        date,
  instalments   integer,
  player_id     uuid,
  player_name   text,
  guardian_name text,
  guardian_phone text,
  fee_cents     integer,
  net_cents     integer,
  paid_cents    integer,
  outstanding_cents integer,
  status        text,
  paid_at       timestamptz,
  stripe_payment_intents text
)
language plpgsql stable security definer set search_path = public as $fn$
begin
  if not coalesce(app_private.is_academy_staff(p_academy), false) then
    raise exception 'only the club''s staff can export its finances' using errcode = '42501';
  end if;

  return query
    select
      r.id,
      r.title,
      case when r.program_id is not null then 'program'
           when r.team_id is not null then 'team'
           else 'academy' end,
      coalesce(
        (select p.name from public.programs p where p.id = r.program_id),
        (select t.name from public.teams t where t.id = r.team_id)
      ),
      r.due_on,
      r.instalments,
      pl.id,
      pl.full_name,
      g.full_name,
      g.phone::text,
      r.amount_cents,
      coalesce((q.quote->>'net_cents')::integer, r.amount_cents),
      coalesce((q.quote->>'net_cents')::integer, r.amount_cents)
        - coalesce((q.quote->>'outstanding_cents')::integer, r.amount_cents),
      coalesce((q.quote->>'outstanding_cents')::integer, r.amount_cents),
      coalesce(q.quote->>'status', 'unpaid'),
      (select max(p.paid_at) from public.payments p
        where p.request_id = r.id and p.player_id = pl.id and p.status = 'paid'),
      (select string_agg(p.stripe_payment_intent, ' ' order by p.instalment_seq)
         from public.payments p
        where p.request_id = r.id and p.player_id = pl.id and p.status = 'paid'
          and p.stripe_payment_intent is not null)
    from public.payment_requests r
    join public.players pl
      on pl.academy_id = r.academy_id
     and (r.team_id is null or pl.team_id = r.team_id)
     and (r.program_id is null or app_private.is_in_program(r.program_id, pl.id))
    left join lateral (
      select pr.full_name, pr.phone
        from public.player_guardians pg
        join public.profiles pr on pr.id = pg.profile_id
       where pg.player_id = pl.id
       order by pg.created_at
       limit 1
    ) g on true
    left join lateral (
      select public.quote_payment(r.id, pl.id) as quote
    ) q on true
    where r.academy_id = p_academy
      and r.archived_at is null
      and r.per_player
    order by r.created_at desc, pl.full_name;
end;
$fn$;

revoke execute on function public.finance_export(uuid) from public, anon;
grant execute on function public.finance_export(uuid) to authenticated;
