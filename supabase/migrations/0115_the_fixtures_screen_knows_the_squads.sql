-- 0115: F-02. What the club-wide draw view needs that it did not have.
--
-- The DATA for a club-wide draw already existed and this was worth checking
-- before writing any: `my_upcoming_events` lets `is_academy_coach` past the
-- team filter, so a coach has always been reading every fixture in the
-- academy. The missing half was entirely in the UI — no day tabs, no team
-- filter — plus two small things the screen could not ask for:
--
--   the SLUG, so staff can share the public draw rather than screenshot it,
--   and the ACTIVE SQUADS, for the "add weekly training" sheet, which was
--   fetching them in a second round trip of its own.
--
-- NOT for the draw filter, which was the first plan and is wrong: the filter
-- is derived from the fixtures in view, so every chip has something behind
-- it. A squad with nothing on in the next 60 days must not be offered as a
-- filter that returns an empty list, and an ENDED squad with a fixture still
-- in the window must be — which is the opposite of what an active-squad list
-- would give. The add sheet wants the opposite too: you do not schedule
-- training for a squad that has finished its season.
--
-- The squad list is still scoped to what the person can see. Staff get every
-- active squad; a parent gets the squads their own children are in, and the
-- ones they are a member of themselves.

drop function if exists public.fixtures_screen(integer, uuid);

create function public.fixtures_screen(
  p_days    integer default 60,
  p_academy uuid default null
)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_academy uuid;
  v_me      uuid := auth.uid();
  v_staff   boolean;
begin
  if v_me is null then
    return null;
  end if;

  v_academy := app_private.my_academy(p_academy);
  if v_academy is null then
    return null;
  end if;

  -- coalesce, because a non-member gets NULL from the role lookup and
  -- `if not null` never fires. The same three-valued-logic hole that let an
  -- outsider write to another academy in 0092.
  v_staff := coalesce(app_private.is_academy_coach(v_academy), false);

  return jsonb_build_object(
    'academy', (select jsonb_build_object('id', a.id, 'name', a.name, 'slug', a.slug)
                  from public.academies a where a.id = v_academy),
    'is_staff', v_staff,
    'teams', coalesce((
      select jsonb_agg(x order by x.name)
        from (
          select distinct t.id, t.name
            from public.teams t
           where t.academy_id = v_academy
             and t.status = 'active'
             and (
               v_staff
               -- A parent's own squads: the ones their children are in, and
               -- the ones they are a member of themselves (a team manager
               -- with no child in the squad is a real person).
               or exists (
                 select 1 from public.players pl
                   join public.player_guardians pg
                     on pg.player_id = pl.id and pg.profile_id = v_me
                  where pl.team_id = t.id
               )
               or exists (
                 select 1 from public.team_members tm
                  where tm.team_id = t.id and tm.profile_id = v_me
               )
             )
        ) x
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(e order by e.starts_at)
        from (select * from public.my_upcoming_events(v_academy, p_days)) e
    ), '[]'::jsonb)
  );
end;
$fn$;

revoke execute on function public.fixtures_screen(integer, uuid) from public, anon;
grant execute on function public.fixtures_screen(integer, uuid) to authenticated;
