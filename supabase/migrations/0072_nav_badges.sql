-- 0072: what the tab bar needs to know, in one small call.
--
-- The bar was told its unread count by whichever page happened to render it,
-- and only the home screen actually passed one. So the dot on Chat appeared
-- on Home and vanished everywhere else — which is worse than never showing
-- it, because it reads as "no unread messages" rather than "not counted
-- here".
--
-- The bar now asks for itself. Deliberately tiny: two integers, no joins
-- beyond what the counts need, called once per navigation from the browser.

create or replace function public.nav_badges()
returns jsonb
language plpgsql
stable
security definer
set search_path = public as $fn$
declare
  v_me      uuid := auth.uid();
  v_academy uuid;
begin
  if v_me is null then return null; end if;
  v_academy := app_private.my_first_academy();
  if v_academy is null then return null; end if;

  return jsonb_build_object(
    'unread', (
      -- Muted channels are excluded. Muting says "do not buzz me", and a
      -- number on a tab is a quieter form of the same thing — but it is still
      -- the app asking for attention, which is what was declined.
      select coalesce(sum(c.unread_count), 0)::integer
        from public.my_channels(v_academy) c
       where not c.muted
    ),
    'pending', (
      select count(*)::integer
        from public.join_requests jr
       where jr.academy_id = v_academy
         and jr.status = 'pending'
         and app_private.is_academy_coach(v_academy)
    ),
    'is_staff', app_private.is_academy_coach(v_academy),
    'brand', (select a.primary_colour from public.academies a where a.id = v_academy)
  );
end;
$fn$;

revoke execute on function public.nav_badges() from public, anon;
grant execute on function public.nav_badges() to authenticated;
