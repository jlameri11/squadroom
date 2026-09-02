-- 0068: chat and fixtures in one round trip each.
--
-- Both screens did the same two-step as the home screen used to: look up
-- which academy this person is in, then fetch the thing. Two trips to Sydney
-- at 250ms each, and the first exists only to learn an id the second needs.
--
-- These are the two most-opened screens in the product — a coach bounces
-- between the team chat and Saturday's fixtures all week — so halving them is
-- worth more than the same work on any admin page.

create or replace function app_private.my_first_academy()
returns uuid
language sql stable security definer set search_path = public as $fn$
  select am.academy_id
    from public.academy_members am
    join public.academies a on a.id = am.academy_id
   where am.profile_id = auth.uid() and am.status = 'active'
   order by a.name
   limit 1;
$fn$;

create or replace function public.chat_screen()
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_academy uuid := app_private.my_first_academy();
begin
  if auth.uid() is null or v_academy is null then
    return null;
  end if;

  return jsonb_build_object(
    'academy', (select jsonb_build_object('id', a.id, 'name', a.name,
                                          'primary_colour', a.primary_colour)
                  from public.academies a where a.id = v_academy),
    'is_staff', app_private.is_academy_coach(v_academy),
    'channels', coalesce((
      select jsonb_agg(c) from (select * from public.my_channels(v_academy)) c
    ), '[]'::jsonb)
  );
end;
$fn$;

create or replace function public.fixtures_screen(p_days integer default 60)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_academy uuid := app_private.my_first_academy();
begin
  if auth.uid() is null or v_academy is null then
    return null;
  end if;

  return jsonb_build_object(
    'academy', (select jsonb_build_object('id', a.id, 'name', a.name)
                  from public.academies a where a.id = v_academy),
    'is_staff', app_private.is_academy_coach(v_academy),
    'events', coalesce((
      select jsonb_agg(e order by e.starts_at)
        from (select * from public.my_upcoming_events(v_academy, p_days)) e
    ), '[]'::jsonb)
  );
end;
$fn$;

revoke execute on function public.chat_screen() from public, anon;
revoke execute on function public.fixtures_screen(integer) from public, anon;
grant execute on function public.chat_screen() to authenticated;
grant execute on function public.fixtures_screen(integer) to authenticated;
