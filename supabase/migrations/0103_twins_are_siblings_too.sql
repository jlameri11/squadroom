-- 0103: twins got no sibling discount.
--
-- 0102 ranked a family's children by date of birth and counted how many were
-- born earlier. Leo and Zoe Whitfield share a birthday, so neither was born
-- before the other, both came out as child 1, and the family paid full price
-- twice.
--
-- Twins are not an edge case in a junior club. They are one of the commonest
-- reasons a family has two children in the same age group, which is exactly
-- the family a sibling discount is for — and this would have quietly
-- overcharged them every term while the test for "second child 10% off"
-- passed, because the test used a family with children of different ages.
--
-- THE FIX IS A TOTAL ORDERING. Date of birth, then created_at, then id. The
-- last one is arbitrary but STABLE, which is the property that matters: the
-- same child must get the same rank every time it is asked, or the price on
-- the parent's screen and the price at the checkout disagree — and they ask
-- at different moments.
--
-- Also makes `outstanding_fees` call this function instead of repeating the
-- ranking inline, which is how the two would have drifted apart: the owner
-- chasing one number while the parent is charged another.

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
    select pl.id, pl.dob, pl.created_at
      from public.players pl
      join public.player_guardians pg
        on pg.player_id = pl.id and pg.profile_id = p_payer
      join scope s on s.academy_id = pl.academy_id
     where s.team_id is null or pl.team_id = s.team_id
  ),
  me as (select * from family where id = p_player)
  select coalesce(
    (
      -- A total ordering, so twins are ranked 1 and 2 rather than both 1.
      -- Nulls last on dob: a child with no birthday recorded sorts after one
      -- who has, and pays full price rather than displacing a sibling.
      select count(*)::integer + 1
        from family f, me
       where (f.dob, f.created_at, f.id) < (me.dob, me.created_at, me.id)
          or (f.dob is not null and me.dob is null)
    ),
    1
  );
$fn$;

/**
 * Who owes what — now ranking through the same function the price uses.
 *
 * 0102 repeated the ranking inline here, which is how the owner's list and
 * the parent's invoice drift apart: one says a family owes $600 and the other
 * charges $540, and nobody can tell which is wrong.
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
    select r.id as request_id, r.title, r.amount_cents,
           coalesce(r.due_on, r.created_at::date) as due_on,
           pl.id as player_id,
           coalesce(nullif(btrim(pl.preferred_name), ''), pl.full_name) as player_name
      from public.payment_requests r
      join public.players pl
        on pl.academy_id = r.academy_id
       and (r.team_id is null or pl.team_id = r.team_id)
     where r.academy_id = p_academy
       and r.archived_at is null
       and r.per_player
  ),
  -- The payer is whichever guardian is primary, falling back to any of them:
  -- the discount and the chasing both follow one adult.
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
  priced as (
    select p.*,
           case
             when p.guardian_id is null then 1
             else app_private.sibling_rank(p.request_id, p.player_id, p.guardian_id)
           end as sibling_rank,
           (select sibling_discount_bps from public.academies where id = p_academy) as ladder
      from payer p
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
