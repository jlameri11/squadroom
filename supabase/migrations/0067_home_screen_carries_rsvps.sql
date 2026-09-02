-- 0067: the home screen carries each child's RSVP with the fixture.
--
-- The prototype answers RSVPs on the home screen — Going / Maybe / Out, one
-- row per child, without opening anything. That is the single biggest reason
-- it feels like an app: the most common action in the product costs a tap
-- instead of a navigation, and a navigation here is a 250ms trip to Sydney.
--
-- So the per-child answers travel with the events in the same payload. Adding
-- a call per fixture would have undone the whole point of 0066.

create or replace function public.home_screen()
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

  select am.academy_id into v_academy
    from public.academy_members am
    join public.academies a on a.id = am.academy_id
   where am.profile_id = v_me and am.status = 'active'
   order by a.name
   limit 1;

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

revoke execute on function public.home_screen() from public, anon;
grant execute on function public.home_screen() to authenticated;
