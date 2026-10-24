-- 0080: one person, several organisations.
--
-- Squadroom's own model already allows this — `academies` means ORGANISATION,
-- separated by `type`, so a league and an academy are two rows — and the
-- product has been quietly unable to express it. `app_private.my_first_academy`
-- picks the alphabetically first one you belong to and every screen uses it,
-- so somebody who runs Hills League and coaches at NRIFA sees Hills League
-- and has no way to reach the other. 0067's home_screen even returns an
-- `other_academies` list, which nothing has ever read.
--
-- This is not a rare case. It is the normal case for the people who matter
-- most: a league secretary whose own child plays, a coach at two clubs, an
-- academy that also runs a gala day as its own organising body. Dribl handles
-- it with a club picker, and so must we.
--
-- WHERE THE CHOICE LIVES: in a parameter, remembered by the browser — not in
-- a column on `profiles`. Two reasons, and the second is the real one:
--
--   1. A stored pointer goes stale. Leave an academy and the column names a
--      row you can no longer read; every screen then returns null and the app
--      looks broken rather than switched.
--   2. Two tabs can be two organisations. On a Saturday the person running
--      the gala day is also the parent of a child playing in it, and wants
--      the run sheet in one tab and their own kid's fixture in the other. A
--      single stored value makes those two tabs fight.
--
-- The server still decides what you may see: a passed id is validated against
-- active membership and ignored if it is not yours.

-- Resolve the organisation a request is about.
--
-- Passing an id you are not in is not an error — it falls back to your
-- default, which is what a stale localStorage value from an academy you left
-- should do. The important part is that it never returns an organisation you
-- are not an active member of.
create or replace function app_private.my_academy(p_academy uuid)
returns uuid
language sql stable security definer set search_path = public as $fn$
  select coalesce(
    (select am.academy_id
       from public.academy_members am
      where am.profile_id = auth.uid()
        and am.academy_id = p_academy
        and am.status = 'active'),
    app_private.my_first_academy()
  );
$fn$;

-- Every organisation this person belongs to, for the switcher itself.
--
-- Separate from home_screen's `other_academies` because a switcher needs the
-- CURRENT one in the list too — it is the row with the tick — and because the
-- switcher is opened rarely and should not make the home screen's payload
-- bigger for everyone who never opens it.
create or replace function public.my_organisations()
returns table (
  id             uuid,
  name           text,
  slug           text,
  type           public.org_type,
  role           public.academy_role,
  primary_colour text,
  logo_url       text
)
language sql stable security definer set search_path = public as $fn$
  select a.id, a.name, a.slug, a.type, am.role, a.primary_colour, a.logo_url
    from public.academy_members am
    join public.academies a on a.id = am.academy_id
   where am.profile_id = auth.uid() and am.status = 'active'
   order by a.name;
$fn$;

revoke execute on function public.my_organisations() from public, anon;
grant execute on function public.my_organisations() to authenticated;

-- Adding a defaulted argument does NOT replace a function.
--
-- `create or replace function home_screen(p_academy uuid default null)`
-- creates a SECOND function, and then `home_screen()` matches both and fails
-- with "function public.home_screen() is not unique" — which arrives as an
-- opaque 300 from PostgREST on the app's most-opened screen. The old
-- signatures have to go first.
drop function if exists public.home_screen();
drop function if exists public.chat_screen();
drop function if exists public.fixtures_screen(integer);
drop function if exists public.nav_badges();

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

create function public.chat_screen(p_academy uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_academy uuid;
begin
  if auth.uid() is null then
    return null;
  end if;

  v_academy := app_private.my_academy(p_academy);
  if v_academy is null then
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

revoke execute on function public.chat_screen(uuid) from public, anon;
grant execute on function public.chat_screen(uuid) to authenticated;

create function public.fixtures_screen(
  p_days    integer default 60,
  p_academy uuid default null
)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_academy uuid;
begin
  if auth.uid() is null then
    return null;
  end if;

  v_academy := app_private.my_academy(p_academy);
  if v_academy is null then
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

revoke execute on function public.fixtures_screen(integer, uuid) from public, anon;
grant execute on function public.fixtures_screen(integer, uuid) to authenticated;

create function public.nav_badges(p_academy uuid default null)
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
  v_academy := app_private.my_academy(p_academy);
  if v_academy is null then return null; end if;

  return jsonb_build_object(
    -- The id the counts are FOR. The tab bar passes whatever the browser
    -- remembered; if that organisation is not this person's any more the
    -- counts come back for their default instead, and the bar needs to know
    -- that so it can correct what it remembered.
    'academy_id', v_academy,
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
    'brand', (select a.primary_colour from public.academies a where a.id = v_academy),
    -- So the switcher can be hidden entirely for the many people who belong
    -- to exactly one organisation, without a second call.
    'org_count', (
      select count(*)::integer from public.academy_members am
       where am.profile_id = v_me and am.status = 'active'
    )
  );
end;
$fn$;

revoke execute on function public.nav_badges(uuid) from public, anon;
grant execute on function public.nav_badges(uuid) to authenticated;
