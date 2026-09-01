-- 0061_payments_reads.sql
--
-- Two reads, deliberately shaped around the two questions people actually
-- ask: a parent asks "what do I owe, and for which child", and a coach asks
-- "who has not paid".
--
-- Both are RPCs rather than client-side joins for the reason in CLAUDE.md:
-- RLS costs are per row scanned, so every read filters on an index first.

-- What this parent owes. One row per child per request, because a family with
-- three children needs to see which of the three is still outstanding — a
-- single "unpaid" against the household is useless for chasing.
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
    t.name,
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
  left join public.academy_billing b on b.academy_id = r.academy_id
  left join mine m
    on r.per_player and (r.team_id is null or m.team_id = r.team_id)
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
   and app_private.is_academy_member(p_academy)
 order by r.due_on nulls last, r.created_at, m.full_name;
$fn$;

revoke execute on function public.my_payment_requests(uuid) from public, anon;
grant execute on function public.my_payment_requests(uuid) to authenticated;

-- Who has not paid. Staff only, and it returns names because chasing is the
-- whole point — a count of "9 of 14" tells a coach nothing they can act on.
create or replace function public.payment_register(p_request uuid)
returns table (
  player_id   uuid,
  player_name text,
  guardian    text,
  guardian_phone text,
  status      text,
  paid_at     timestamptz,
  amount_cents integer
)
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_academy uuid;
  v_team    uuid;
  v_per     boolean;
begin
  select r.academy_id, r.team_id, r.per_player
    into v_academy, v_team, v_per
    from public.payment_requests r where r.id = p_request;

  if v_academy is null or not app_private.is_academy_staff(v_academy) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  return query
    select
      pl.id, pl.full_name,
      g.full_name, g.phone,
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
     and v_per
   order by (p.status is not null), pl.full_name;
end;
$fn$;

revoke execute on function public.payment_register(uuid) from public, anon;
grant execute on function public.payment_register(uuid) to authenticated;
