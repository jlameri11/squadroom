-- 0114: E-04. The family view knows who the family is.
--
-- Home already shows a row per child on every fixture, which is right, and
-- for a parent with three children in two age groups it is also a wall. The
-- fix is a filter — tap a child, see their Saturday — and a filter needs a
-- stable list of children to offer.
--
-- IT CANNOT BE DERIVED FROM THE FIXTURES, which is the obvious shortcut and
-- is wrong twice. A child with nothing on this week would have no chip, so
-- the row of chips would rearrange itself as games pass; and tapping a chip
-- that then vanishes is a control that punishes being used. The list is who
-- the family IS, not what is coming up.
--
-- Deliberately part of home_screen rather than a second call: this is the
-- first paint of the first screen, 250ms from Sydney, and a round trip to
-- find out whether to render a row of chips would be a round trip spent
-- deciding whether to show something.
--
-- A colour is NOT stored. It is derived from the child's id in the client, so
-- it is stable without a column, a default, a migration for existing rows, or
-- a settings screen for a preference nobody asked to set.

drop function if exists public.home_screen(uuid);

create function public.home_screen(p_academy uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public as $fn$
declare
  v_me      uuid := auth.uid();
  v_academy uuid;
  v_result  jsonb;
begin
  if v_me is null then
    return null;
  end if;

  v_academy := app_private.my_academy(p_academy);

  if v_academy is null then
    return jsonb_build_object('academy', null);
  end if;

  select jsonb_build_object(
    'profile', (
      select jsonb_build_object('id', p.id, 'full_name', p.full_name,
                                'phone', p.phone::text, 'avatar_url', p.avatar_url)
        from public.profiles p where p.id = v_me
    ),
    'academy', (
      select jsonb_build_object('id', a.id, 'name', a.name, 'slug', a.slug,
                                'type', a.type, 'primary_colour', a.primary_colour,
                                'logo_url', a.logo_url, 'timezone', a.timezone)
        from public.academies a where a.id = v_academy
    ),
    'role', (
      select am.role from public.academy_members am
       where am.academy_id = v_academy and am.profile_id = v_me and am.status = 'active'
    ),
    -- Kept for the switcher's first paint: it can show the list before
    -- my_organisations() comes back, and a count tells it whether to render a
    -- switcher at all.
    'other_academies', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'type', a.type)
                       order by a.name)
        from public.academy_members am
        join public.academies a on a.id = am.academy_id
       where am.profile_id = v_me and am.status = 'active' and a.id <> v_academy
    ), '[]'::jsonb),
    'is_platform_admin', exists (
      select 1 from public.platform_admins pa where pa.profile_id = v_me
    ),
    'pending_requests', (
      select count(*)::integer from public.join_requests jr
       where jr.academy_id = v_academy and jr.status = 'pending'
         and app_private.is_academy_coach(v_academy)
    ),
    -- 0114: this person's own children in this academy, and nobody else's.
    -- The guardian join is the whole access rule: there is no branch here for
    -- staff, because a coach opening their own home screen wants their own
    -- family, not a second roster.
    --
    -- The short name is what a chip can fit. `preferred_name` first because a
    -- family that typed one meant it; otherwise the first word of the full
    -- name, which is the same thing the fixture rows already show.
    'children', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', pl.id,
               'name', pl.full_name,
               'short_name', coalesce(nullif(btrim(pl.preferred_name), ''),
                                      split_part(pl.full_name, ' ', 1)),
               'team_id', pl.team_id,
               'team_name', t.name
             ) order by pl.full_name)
        from public.players pl
        join public.player_guardians pg
          on pg.player_id = pl.id and pg.profile_id = v_me
        left join public.teams t
          on t.id = pl.team_id and t.academy_id = pl.academy_id
       where pl.academy_id = v_academy
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(
               to_jsonb(e) || jsonb_build_object(
                 'rsvps', coalesce((
                   -- Only this person's own children, and only the ones this
                   -- fixture is actually for. A parent with a child in two
                   -- teams must not be asked about the wrong one.
                   select jsonb_agg(jsonb_build_object(
                            'player_id', pl.id,
                            'player_name', pl.full_name,
                            'status', r.status
                          ) order by pl.full_name)
                     from public.players pl
                     join public.player_guardians pg
                       on pg.player_id = pl.id and pg.profile_id = v_me
                     left join public.event_rsvps r
                       on r.event_id = e.id and r.player_id = pl.id and r.profile_id = v_me
                    where pl.academy_id = v_academy
                      and (e.team_id is null or pl.team_id = e.team_id)
                 ), '[]'::jsonb)
               ) order by e.starts_at)
        from (select * from public.my_upcoming_events(v_academy, 21) limit 5) e
    ), '[]'::jsonb),
    'channels', coalesce((
      select jsonb_agg(c) from (select * from public.my_channels(v_academy)) c
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$fn$;

revoke execute on function public.home_screen(uuid) from public, anon;
grant execute on function public.home_screen(uuid) to authenticated;
