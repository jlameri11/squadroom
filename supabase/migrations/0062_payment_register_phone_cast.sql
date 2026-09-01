-- profiles.phone is a DOMAIN, not text (0041 gave it its own type so a
-- half-parsed number cannot be stored). A set-returning function declaring
-- `text` and returning the domain fails with "structure of query does not
-- match function result type", which names neither the column nor the type
-- and sends you looking in the wrong place entirely.
--
-- Cast explicitly at the boundary. Note this is SECURITY DEFINER and so
-- bypasses the column grants that hide phone numbers from parents — which is
-- exactly why the staff check above it is not optional.
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
      pl.id, pl.full_name::text,
      g.full_name::text, g.phone::text,
      coalesce(p.status, 'unpaid')::text, p.paid_at,
      coalesce(p.amount_cents, r.amount_cents)::integer
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
