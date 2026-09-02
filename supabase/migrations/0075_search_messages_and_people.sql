-- 0075: search messages and people.
--
-- The thing a WhatsApp group is genuinely good at is that everything ever
-- said is still there and findable. "What time did Joey say Saturday was?"
-- is the most common question in a team chat, and until now Squadroom's
-- answer was to scroll.
--
-- Two rules that shape this more than the query does.
--
-- 1. RLS COSTS ARE PER ROW SCANNED. An unfiltered ILIKE across messages runs
--    the channel-membership policy once per row — measured at 836ms on 60k
--    messages in CLAUDE.md. So this resolves the caller's channels FIRST,
--    into a small list of ids, and only then looks at message bodies.
--
-- 2. IT SEARCHES WHAT YOU CAN ALREADY SEE, AND NOTHING ELSE. Not other
--    teams, not deleted messages, not the archive of what a host removed.
--    A search box is exactly the place someone would discover a leak, and it
--    is the kind of leak that would be found by a parent rather than by us.

create extension if not exists pg_trgm;

-- Trigram index so ILIKE '%...%' can use an index rather than reading every
-- row once a club has a season of chat in it.
create index if not exists messages_body_trgm_idx
  on public.messages using gin (body gin_trgm_ops)
  where deleted_at is null and status = 'published';

create or replace function public.search_chat(p_query text, p_limit integer default 20)
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
  v_academy := app_private.my_first_academy();
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

revoke execute on function public.search_chat(text, integer) from public, anon;
grant execute on function public.search_chat(text, integer) to authenticated;
