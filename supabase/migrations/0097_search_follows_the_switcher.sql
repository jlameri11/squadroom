-- 0097: search ignored the organisation switcher.
--
-- 0080 parameterised home_screen, chat_screen, fixtures_screen and nav_badges
-- on the organisation, and search_chat was missed. It called
-- app_private.my_first_academy() directly — the alphabetically first academy
-- you belong to — so somebody viewing Sydney Premier League and searching for
-- a message found NRIFA's instead.
--
-- Not a leak: every row is still gated on channel_members, so it only ever
-- returned conversations the searcher is in. But it is the wrong answer to
-- the question asked, and in a product where the whole point of the switcher
-- is "this is the club I am looking at", the wrong answer looks exactly like
-- a leak to whoever is holding the phone.
--
-- Found by the demo walkthrough, which asked a simpler question than the
-- tests do: is there anything here. Searching a term that exists in the
-- academy's messages returned nothing at all.

create or replace function public.search_chat(
  p_query text,
  p_limit integer default 20,
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
  -- my_first_academy() ignored the switcher entirely, so somebody looking at
  -- their league searched their academy and found nothing — or worse, found
  -- the wrong club's messages and read it as a leak.
  v_academy := app_private.my_academy(p_academy);
  if v_academy is null or length(v_q) < 2 then
    return jsonb_build_object('messages', '[]'::jsonb, 'people', '[]'::jsonb);
  end if;

  return jsonb_build_object(
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

-- The two-argument version would otherwise still exist and shadow this one.
drop function if exists public.search_chat(text, integer);
