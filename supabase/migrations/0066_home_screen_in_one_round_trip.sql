-- 0066_home_screen_in_one_round_trip.sql
--
-- Measured, not guessed: Netlify runs this app's functions in us-east-2 and
-- Supabase is in Sydney. One database round trip costs 240-350ms. That is the
-- Pacific Ocean, and no amount of index tuning touches it.
--
-- The home screen was making SEVEN separate calls — profile, academies,
-- membership, upcoming, channels, pending requests, platform admin — several
-- of them serial because each needed the academy id from the one before. Even
-- perfectly parallelised that is two ocean crossings; as written it was more
-- like five, which is the 1.4 seconds a person waited before seeing anything.
--
-- So the whole screen is assembled inside Postgres, where the joins cost
-- microseconds, and crosses the ocean once.
--
-- The region is worth naming as the real fix. Moving the functions to Sydney
-- would take every page under 100ms and needs a paid Netlify plan; this makes
-- the free tier behave until that is worth paying for.

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

  -- The first academy this person belongs to, same rule the page used.
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
                                'logo_url', a.logo_url)
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
      select jsonb_agg(e order by e.starts_at)
        from (
          select * from public.my_upcoming_events(v_academy, 21) limit 4
        ) e
    ), '[]'::jsonb),
    'channels', coalesce((
      select jsonb_agg(c)
        from (select * from public.my_channels(v_academy)) c
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$fn$;

revoke execute on function public.home_screen() from public, anon;
grant execute on function public.home_screen() to authenticated;
