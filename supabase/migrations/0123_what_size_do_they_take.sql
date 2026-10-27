-- 0123: R-05's last field, and R-09's kit list.
--
-- R-05 was "mostly done" with kit sizes the only part missing, and R-09 had
-- "kit export still to do". They are one job: a size nobody can record is a
-- size nobody can count, and a club orders kit by counting.
--
-- A FIXED VOCABULARY, not free text, and that is the whole decision here.
-- The value of this feature is the COUNT — "9 × size 10, 4 × size 12" on a
-- purchase order. Free text gives a club "10", "Size 10", "size10", "10Y"
-- and " 10", which is five sizes to a database and one size to a human, and
-- the export becomes a list to be retyped by hand. A constrained column is
-- the export working.
--
-- Shirts and shorts share a list because suppliers size them together.
-- SOCKS DO NOT: junior football socks are sold by shoe size, so a sock
-- column constrained to 'S/M/L' would force a club to invent a mapping and
-- then remember it. They get their own list.
--
-- Nullable, and no default. A roster imported last season has no sizes, and
-- guessing one is worse than leaving it blank: a blank is a question a club
-- can ask a family, and a wrong size is a shirt that does not fit discovered
-- on the first morning.

do $$ begin
  create type public.kit_size as enum (
    -- Junior numeric, as Australian suppliers print them.
    '4', '6', '8', '10', '12', '14', '16',
    -- Youth letter sizing, because some suppliers use it instead.
    'YXS', 'YS', 'YM', 'YL',
    -- Adults, for the older squads and for coaches' kit.
    'S', 'M', 'L', 'XL', '2XL', '3XL'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.sock_size as enum (
    -- Shoe-size ranges, which is how junior football socks are sold.
    'K9-12', 'K13-3', '2-7', '7-11', '11-14'
  );
exception when duplicate_object then null; end $$;

alter table public.players
  add column if not exists shirt_size  public.kit_size,
  add column if not exists shorts_size public.kit_size,
  add column if not exists socks_size  public.sock_size;

comment on column public.players.shirt_size is
  'A fixed vocabulary, not free text. The point of recording a size is the
   count on a purchase order, and "10" / "Size 10" / "10Y" is five sizes to a
   database and one size to a human.';

/**
 * What to order.
 *
 * Two shapes in one call, because a club needs both and they are the same
 * data: the COUNTS, which is what goes on the order, and the PLAYERS, which
 * is what somebody checks it against and how they find who has not answered.
 *
 * Staff only. A kit list is the whole roster with a measurement beside each
 * name, which is not a coach-of-another-squad's business and certainly not a
 * parent's.
 *
 * `missing` is deliberately part of the answer rather than something a
 * screen works out. A club ordering 20 shirts for a squad of 24 is the
 * failure this feature exists to prevent, and the number that prevents it is
 * the number of blanks.
 */
create or replace function public.kit_list(
  p_academy uuid default null,
  p_team    uuid default null
)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_academy uuid;
  v_result  jsonb;
begin
  v_academy := app_private.my_academy(p_academy);
  if v_academy is null or not coalesce(app_private.is_academy_staff(v_academy), false) then
    return null;
  end if;

  select jsonb_build_object(
    'team', (select jsonb_build_object('id', t.id, 'name', t.name)
               from public.teams t where t.id = p_team),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', pl.id,
               'name', pl.full_name,
               'team_name', t.name,
               'shirt_size', pl.shirt_size,
               'shorts_size', pl.shorts_size,
               'socks_size', pl.socks_size,
               'squad_number', (
                 select sn.number from public.squad_numbers sn
                  where sn.player_id = pl.id
                  order by sn.season desc nulls last
                  limit 1
               )
             ) order by t.name nulls last, pl.full_name)
        from public.players pl
        left join public.teams t on t.id = pl.team_id
       where pl.academy_id = v_academy
         and (p_team is null or pl.team_id = p_team)
    ), '[]'::jsonb),
    -- One row per garment and size, which is the order itself.
    'counts', coalesce((
      select jsonb_agg(c order by c.garment, c.size)
        from (
          select 'shirt' as garment, pl.shirt_size::text as size, count(*)::integer as n
            from public.players pl
           where pl.academy_id = v_academy
             and (p_team is null or pl.team_id = p_team)
             and pl.shirt_size is not null
           group by pl.shirt_size
          union all
          select 'shorts', pl.shorts_size::text, count(*)::integer
            from public.players pl
           where pl.academy_id = v_academy
             and (p_team is null or pl.team_id = p_team)
             and pl.shorts_size is not null
           group by pl.shorts_size
          union all
          select 'socks', pl.socks_size::text, count(*)::integer
            from public.players pl
           where pl.academy_id = v_academy
             and (p_team is null or pl.team_id = p_team)
             and pl.socks_size is not null
           group by pl.socks_size
        ) c
    ), '[]'::jsonb),
    'missing', jsonb_build_object(
      'shirt', (select count(*)::integer from public.players pl
                 where pl.academy_id = v_academy
                   and (p_team is null or pl.team_id = p_team)
                   and pl.shirt_size is null),
      'shorts', (select count(*)::integer from public.players pl
                  where pl.academy_id = v_academy
                    and (p_team is null or pl.team_id = p_team)
                    and pl.shorts_size is null),
      'socks', (select count(*)::integer from public.players pl
                 where pl.academy_id = v_academy
                   and (p_team is null or pl.team_id = p_team)
                   and pl.socks_size is null)
    )
  ) into v_result;

  return v_result;
end;
$fn$;

revoke execute on function public.kit_list(uuid, uuid) from public, anon;
grant execute on function public.kit_list(uuid, uuid) to authenticated;

/**
 * A coach writes down a size.
 *
 * There is no player edit screen in this product at all, which is why this
 * exists as its own function rather than relying on a table update: without
 * a way to record a size, a club whose roster was imported last season could
 * never produce a kit list, and the feature would only work for families who
 * registered after today.
 *
 * A team coach, not only academy staff — the person who asks a child what
 * size they take is the person standing in front of them.
 */
create or replace function public.set_kit_sizes(
  p_player uuid,
  p_shirt  public.kit_size default null,
  p_shorts public.kit_size default null,
  p_socks  public.sock_size default null
)
returns void
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_player public.players;
begin
  select * into v_player from public.players where id = p_player;
  if v_player.id is null then
    raise exception 'no such player' using errcode = '22023';
  end if;

  -- coalesce on both, because a non-member gets NULL and `if not NULL` never
  -- fires: the three-valued-logic hole 0092 exists to close.
  if not (coalesce(app_private.is_academy_staff(v_player.academy_id), false)
          or (v_player.team_id is not null
              and coalesce(app_private.is_team_coach(v_player.team_id), false))) then
    raise exception 'only a coach can record kit sizes' using errcode = '42501';
  end if;

  -- Every argument is written, including nulls. Clearing a size has to be
  -- possible: one typed into the wrong row is worse than a blank, because a
  -- blank is a question a club asks and a wrong size is a shirt discovered
  -- not to fit on the first morning.
  update public.players
     set shirt_size = p_shirt,
         shorts_size = p_shorts,
         socks_size = p_socks,
         updated_at = now()
   where id = p_player;
end;
$fn$;

revoke execute on function public.set_kit_sizes(
  uuid, public.kit_size, public.kit_size, public.sock_size
) from public, anon;
grant execute on function public.set_kit_sizes(
  uuid, public.kit_size, public.kit_size, public.sock_size
) to authenticated;
