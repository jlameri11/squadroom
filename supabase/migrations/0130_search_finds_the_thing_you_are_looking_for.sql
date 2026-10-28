-- 0130: search finds fixtures and squads, not only messages.
--
-- DRIBL_INTEL ranks the complaints against Dribl, and two of the top eight
-- are this one problem:
--
--   #1 "Navigation is confusing: finding teams, ladders and club points;
--       many taps to follow a team."
--   #8 "Search is broken."
--
-- Squadroom's search looked past both. It covered MESSAGES and PEOPLE, which
-- is what a chat app searches — so a parent typing "U10" to find out when
-- their child plays got back whatever somebody had said about the U10s in
-- a conversation, and had to go and navigate anyway. Typing "Gladesville"
-- found the chat about the game and not the game.
--
-- So the same box now also finds FIXTURES and SQUADS. One place to type what
-- you are looking for is the whole answer to "many taps to follow a team".
--
-- Nothing is widened. Every new branch is scoped by the same rules the
-- screens use:
--   · fixtures through `my_upcoming_events`, which already applies the four
--     visibility rules including `private_to` — a parent's own scanned
--     fixture is theirs, and another squad's game is not a parent's.
--   · squads to this academy's active teams, which everybody in the club can
--     already see in the directory.
--
-- A SEARCH RESULT IS A NAVIGATION, so each one carries the id its screen
-- needs. A result you cannot tap is a result that has not answered anything.

create or replace function public.search_chat(
  p_query   text,
  p_limit   integer default 20,
  p_academy uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public as $fn$
declare
  v_me      uuid := auth.uid();
  v_academy uuid;
  v_q       text := btrim(coalesce(p_query, ''));
begin
  if v_me is null then return null; end if;
  -- The organisation the browser is showing, validated against membership.
  v_academy := app_private.my_academy(p_academy);
  if v_academy is null or length(v_q) < 2 then
    return jsonb_build_object(
      'messages', '[]'::jsonb,
      'people', '[]'::jsonb,
      'fixtures', '[]'::jsonb,
      'squads', '[]'::jsonb
    );
  end if;

  return jsonb_build_object(
    -- FIXTURES FIRST in the object, and first on the screen. "When do we
    -- play" is the question this app exists to answer, and a message about
    -- a game is not an answer to it.
    'fixtures', coalesce((
      select jsonb_agg(f order by f.starts_at)
        from (
          select e.id, e.title, e.starts_at, e.venue, e.opponent,
                 e.team_name, e.type, e.cancelled_at
            from public.my_upcoming_events(v_academy, 120) e
           where e.title ilike '%' || v_q || '%'
              or coalesce(e.opponent, '') ilike '%' || v_q || '%'
              or coalesce(e.venue, '') ilike '%' || v_q || '%'
              or coalesce(e.team_name, '') ilike '%' || v_q || '%'
           order by e.starts_at
           limit 8
        ) f
    ), '[]'::jsonb),

    'squads', coalesce((
      select jsonb_agg(s order by s.name)
        from (
          select t.id, t.name, t.age_group, t.season,
                 (select count(*)::integer from public.players pl where pl.team_id = t.id) as players
            from public.teams t
           where t.academy_id = v_academy
             and t.status = 'active'
             and (t.name ilike '%' || v_q || '%' or coalesce(t.age_group, '') ilike '%' || v_q || '%')
           order by t.name
           limit 6
        ) s
    ), '[]'::jsonb),

    'messages', coalesce((
      select jsonb_agg(m order by m.created_at desc)
        from (
          select msg.id, msg.channel_id, msg.body, msg.created_at,
                 c.name as channel_name,
                 p.full_name as sender_name
            from public.channel_members cm
            join public.channels c
              on c.id = cm.channel_id and c.academy_id = v_academy
            join public.messages msg
              on msg.channel_id = cm.channel_id
            left join public.profiles p on p.id = msg.sender_id
           where cm.profile_id = v_me
             and msg.deleted_at is null
             and msg.status = 'published'
             and msg.body ilike '%' || v_q || '%'
           order by msg.created_at desc
           limit p_limit
        ) m
    ), '[]'::jsonb),

    'people', coalesce((
      select jsonb_agg(x order by x.full_name)
        from (
          select pr.id as profile_id, pr.full_name, am.role, pr.avatar_url
            from public.academy_members am
            join public.profiles pr on pr.id = am.profile_id
           where am.academy_id = v_academy
             and am.status = 'active'
             and am.profile_id <> v_me
             and pr.full_name ilike '%' || v_q || '%'
           order by pr.full_name
           limit 10
        ) x
    ), '[]'::jsonb)
  );
end;
$fn$;

revoke execute on function public.search_chat(text, integer, uuid) from public, anon;
grant execute on function public.search_chat(text, integer, uuid) to authenticated;
