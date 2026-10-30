-- 0144: paid means nothing is outstanding.
--
-- 0143 copied quote_payment's `status` into the export, and that key is
-- not the per-child state the column name promised: a child with the fee
-- paid in full and nothing outstanding came out as 'unpaid'. The suite's
-- first run read it off the row.
--
-- The state is derived from the two numbers already on the row, which
-- cannot disagree with each other: nothing outstanding is paid, something
-- paid is part paid, else unpaid. The rest of the function is 0143.

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
    with rows_ as (
      select
        r.id as request_id, r.title, r.program_id, r.team_id, r.due_on, r.instalments, r.amount_cents,
        r.created_at,
        pl.id as player_id, pl.full_name as player_name,
        g.full_name as guardian_name, g.phone::text as guardian_phone,
        coalesce((q.quote->>'net_cents')::integer, r.amount_cents) as net_cents,
        coalesce((q.quote->>'outstanding_cents')::integer, r.amount_cents) as outstanding_cents
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
    )
    select
      x.request_id,
      x.title,
      case when x.program_id is not null then 'program'
           when x.team_id is not null then 'team'
           else 'academy' end,
      coalesce(
        (select p.name from public.programs p where p.id = x.program_id),
        (select t.name from public.teams t where t.id = x.team_id)
      ),
      x.due_on,
      x.instalments,
      x.player_id,
      x.player_name,
      x.guardian_name,
      x.guardian_phone,
      x.amount_cents,
      x.net_cents,
      x.net_cents - x.outstanding_cents,
      x.outstanding_cents,
      case when x.outstanding_cents <= 0 then 'paid'
           when x.net_cents - x.outstanding_cents > 0 then 'part paid'
           else 'unpaid' end,
      (select max(p.paid_at) from public.payments p
        where p.request_id = x.request_id and p.player_id = x.player_id and p.status = 'paid'),
      (select string_agg(p.stripe_payment_intent, ' ' order by p.instalment_seq)
         from public.payments p
        where p.request_id = x.request_id and p.player_id = x.player_id and p.status = 'paid'
          and p.stripe_payment_intent is not null)
    from rows_ x
    order by x.created_at desc, x.player_name;
end;
$fn$;
