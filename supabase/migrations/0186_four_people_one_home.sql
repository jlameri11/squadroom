-- 0186: four people, one home.
--
-- Joey's product direction (CLAUDE.md, 2 Nov 2026): the same five tabs for
-- everyone, and a Home that shows each role only its priorities, with that
-- role's top three jobs reachable in two taps or fewer.
--
-- `home_jobs` is the one call behind it. It works out which of the four
-- people is looking — parent, coach, owner / club admin, league organiser —
-- from their membership and the organisation's type, and answers with:
--
--   jobs          the three things this person is here to do, each with a
--                 count, a line of detail and the exact page that does it
--   today         the owner's "today across all teams" or the league's
--                 "this weekend", with where to look
--   announcement  the latest announcement in a channel they are in (the
--                 parent's third priority), with its reply count
--   switch        the other organisations they belong to, each with the
--                 persona they are there, for a one-tap switch
--
-- Everything reads through the functions the screens already use
-- (my_upcoming_events, my_channels, needs_you, outstanding_fees), so this
-- cannot describe a job the page it links to would then refuse.

create or replace function app_private.home_persona(
  p_academy uuid, p_profile uuid, p_role public.academy_role, p_type text
) returns text language sql stable as $$
  select case
    when p_type = 'league' and (
           p_role in ('owner', 'admin')
           or exists (select 1 from public.league_roles lr
                       where lr.academy_id = p_academy and lr.profile_id = p_profile))
      then 'league'
    when p_role in ('owner', 'admin') then 'owner'
    when p_role = 'coach' then 'coach'
    else 'parent'
  end;
$$;

create or replace function public.home_jobs(p_academy uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_me       uuid := auth.uid();
  v_academy  uuid;
  v_role     public.academy_role;
  v_type     text;
  v_tz       text;
  v_persona  text;
  v_jobs     jsonb := '[]'::jsonb;
  v_today    jsonb;
  v_ann      jsonb;
  v_switch   jsonb;
  v_id       uuid;
  v_title    text;
  v_at       timestamptz;
  v_count    integer;
  v_count2   integer;
  v_cents    bigint;
  v_detail   text;
  v_comp     uuid;
  v_comp2    uuid;
  v_day      date;
  v_sun      date;
begin
  if v_me is null then
    return null;
  end if;
  v_academy := app_private.my_academy(p_academy);
  if v_academy is null then
    return null;
  end if;

  select am.role into v_role
    from public.academy_members am
   where am.academy_id = v_academy and am.profile_id = v_me and am.status = 'active';
  select a.type::text, coalesce(a.timezone, 'Australia/Sydney') into v_type, v_tz
    from public.academies a where a.id = v_academy;
  v_persona := app_private.home_persona(v_academy, v_me, v_role, v_type);
  v_day := (now() at time zone v_tz)::date;

  -- ------------------------------------------------------------------ parent
  if v_persona = 'parent' then
    -- 1. Answer: the next game or session a child of theirs has not been
    --    answered for.
    select e.id, e.title, e.starts_at into v_id, v_title, v_at
      from public.my_upcoming_events(v_academy, 21) e
     where e.cancelled_at is null and coalesce(e.my_children, 0) > coalesce(e.my_replies, 0)
     order by e.starts_at limit 1;
    select count(*) into v_count
      from public.my_upcoming_events(v_academy, 21) e
     where e.cancelled_at is null and coalesce(e.my_children, 0) > coalesce(e.my_replies, 0);
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'rsvp', 'label', 'Answer',
      'detail', case when v_id is null then 'All answered'
                     else v_title || ' · ' || to_char(v_at at time zone v_tz, 'Dy') end,
      'href', case when v_id is null then '/calendar' else '/calendar/' || v_id end,
      'count', coalesce(v_count, 0));

    -- 2. Team chat: the squad channel with the most waiting.
    v_id := null; v_title := null; v_count := null;
    select c.channel_id, c.name, c.unread_count into v_id, v_title, v_count
      from public.my_channels(v_academy) c
     where c.status = 'active' and c.type = 'team'
     order by c.unread_count desc, c.last_message_at desc nulls last limit 1;
    if v_id is null then
      select c.channel_id, c.name, c.unread_count into v_id, v_title, v_count
        from public.my_channels(v_academy) c
       where c.status = 'active'
       order by c.unread_count desc, c.last_message_at desc nulls last limit 1;
    end if;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'chat', 'label', 'Team chat',
      'detail', coalesce(v_title, 'No chats yet'),
      'href', case when v_id is null then '/chat' else '/chat/' || v_id end,
      'count', coalesce(v_count, 0));

    -- 3. Pay: what needs_you already says about fees.
    v_count := null; v_detail := null;
    select (x->>'count')::integer, x->>'detail' into v_count, v_detail
      from jsonb_array_elements(coalesce(public.needs_you(v_academy), '[]'::jsonb)) x
     where x->>'kind' = 'fees' limit 1;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'pay', 'label', 'Pay',
      'detail', coalesce(v_detail, 'Nothing owing'),
      'href', '/payments',
      'count', coalesce(v_count, 0));

  -- ------------------------------------------------------------------- coach
  elsif v_persona = 'coach' then
    -- 1. Post: the squad channel they host.
    select c.channel_id, c.name, c.unread_count into v_id, v_title, v_count
      from public.my_channels(v_academy) c
     where c.status = 'active' and c.type = 'team'
     order by (c.my_role = 'host') desc, c.unread_count desc, c.last_message_at desc nulls last limit 1;
    if v_id is null then
      select c.channel_id, c.name, c.unread_count into v_id, v_title, v_count
        from public.my_channels(v_academy) c
       where c.status = 'active'
       order by c.unread_count desc, c.last_message_at desc nulls last limit 1;
    end if;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'post', 'label', 'Post',
      'detail', coalesce(v_title, 'No chats yet'),
      'href', case when v_id is null then '/chat' else '/chat/' || v_id end,
      'count', coalesce(v_count, 0));

    -- 2. Squad: the next game, with how many have not answered.
    v_id := null; v_title := null; v_count := null;
    select e.id, e.title, e.no_reply into v_id, v_title, v_count
      from public.my_upcoming_events(v_academy, 21) e
     where e.cancelled_at is null and e.type in ('match', 'tournament')
     order by e.starts_at limit 1;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'squad', 'label', 'Squad',
      'detail', case when v_id is null then 'No game coming up'
                     when coalesce(v_count, 0) > 0 then v_count || ' no reply · ' || v_title
                     else v_title end,
      'href', case when v_id is null then '/calendar' else '/calendar/' || v_id end,
      'count', coalesce(v_count, 0));

    -- 3. Attendance: the session whose register is open — one that started
    --    in the last twelve hours — else the next one, where the register
    --    appears at kick-off (X-19: attendance is a fact, taken at the ground).
    v_id := null; v_title := null; v_at := null;
    select e.id, e.title, e.starts_at into v_id, v_title, v_at
      from public.events e
     where e.academy_id = v_academy and e.type = 'training' and e.cancelled_at is null
       and e.private_to is null
       and e.starts_at between now() - interval '12 hours' and now()
       and (app_private.is_academy_coach(v_academy)
            or (e.team_id is not null and app_private.is_team_coach(e.team_id)))
     order by e.starts_at desc limit 1;
    if v_id is null then
      select e.id, e.title, e.starts_at into v_id, v_title, v_at
        from public.my_upcoming_events(v_academy, 7) e
       where e.cancelled_at is null and e.type = 'training'
       order by e.starts_at limit 1;
    end if;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'attendance', 'label', 'Attendance',
      'detail', case when v_id is null then 'No training this week'
                     when v_at <= now() then v_title || ' · register open'
                     else v_title || ' · ' || to_char(v_at at time zone v_tz, 'Dy HH12:MI am') end,
      'href', case when v_id is null then '/calendar' else '/calendar/' || v_id end,
      'count', 0);

  -- ------------------------------------------------------------------- owner
  elsif v_persona = 'owner' then
    -- 1. Registrations waiting, both kinds.
    select (select count(*) from public.registration_requests rr
             where rr.academy_id = v_academy and rr.status = 'pending')
         + (select count(*) from public.program_registrations pr
             where pr.academy_id = v_academy and pr.status = 'pending')
      into v_count;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'registrations', 'label', 'Registrations',
      'detail', case when coalesce(v_count, 0) = 0 then 'None waiting' else v_count || ' waiting' end,
      'href', '/admin/registrations',
      'count', coalesce(v_count, 0));

    -- 2. Who owes.
    select count(distinct o.player_id), coalesce(sum(o.outstanding_cents), 0) into v_count, v_cents
      from public.outstanding_fees(v_academy) o
     where o.outstanding_cents > 0;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'owing', 'label', 'Who owes',
      'detail', case when coalesce(v_count, 0) = 0 then 'Nobody owes'
                     else '$' || to_char(v_cents / 100.0, 'FM999999990') || ' · ' || v_count
                          || case when v_count = 1 then ' child' else ' children' end end,
      'href', '/admin/payments',
      'count', coalesce(v_count, 0));

    -- 3. Message everyone: the club-wide channel.
    v_id := null; v_title := null;
    select c.channel_id, c.name into v_id, v_title
      from public.my_channels(v_academy) c
     where c.status = 'active' and c.type = 'academy_wide' limit 1;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'everyone', 'label', 'Message everyone',
      'detail', coalesce(v_title, 'Club-wide chat'),
      'href', case when v_id is null then '/chat' else '/chat/' || v_id end,
      'count', 0);

    -- Today across all teams.
    select count(*) into v_count
      from public.events e
     where e.academy_id = v_academy and e.cancelled_at is null and e.private_to is null
       and (e.starts_at at time zone v_tz)::date = v_day;
    v_today := jsonb_build_object(
      'label', 'Today across all teams',
      'detail', case when coalesce(v_count, 0) = 0 then 'Nothing on today'
                     else v_count || case when v_count = 1 then ' session' else ' sessions' end end,
      'count', coalesce(v_count, 0),
      'href', '/calendar');

  -- ------------------------------------------------------------------ league
  else
    -- The coming weekend, today included if it is one.
    v_sun := v_day + ((7 - extract(dow from v_day)::integer) % 7);

    -- 1. The draw: the competition with the most games this weekend.
    select f.competition_id, count(*) into v_comp, v_count
      from public.fixtures f
      join public.competitions c on c.id = f.competition_id
     where c.organiser_id = v_academy and f.status in ('scheduled', 'in_progress')
       and (f.starts_at at time zone v_tz)::date between v_day and v_sun
     group by f.competition_id order by count(*) desc limit 1;
    if v_comp is null then
      select c.id into v_comp from public.competitions c
       where c.organiser_id = v_academy order by c.created_at desc limit 1;
    end if;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'draw', 'label', 'The draw',
      'detail', case when coalesce(v_count, 0) = 0 then 'Nothing this weekend'
                     else v_count || ' games this weekend' end,
      'href', case when v_comp is null then '/competitions' else '/competitions/' || v_comp || '?tab=run' end,
      'count', coalesce(v_count, 0));
    v_today := jsonb_build_object(
      'label', 'This weekend',
      'detail', case when coalesce(v_count, 0) = 0 then 'No games drawn'
                     else v_count || ' games, ' || to_char(v_day, 'Dy DD Mon') || ' to ' || to_char(v_sun, 'Dy DD Mon') end,
      'count', coalesce(v_count, 0),
      'href', case when v_comp is null then '/competitions' else '/competitions/' || v_comp || '?tab=run' end);

    -- 2. Referees: games in the next week with nobody accepted in the middle.
    v_comp2 := null; v_count2 := null;
    select f.competition_id, count(*) into v_comp2, v_count2
      from public.fixtures f
      join public.competitions c on c.id = f.competition_id
     where c.organiser_id = v_academy and f.status = 'scheduled'
       and f.starts_at between now() and now() + interval '7 days'
       and not exists (select 1 from public.referee_appointments ra
                        where ra.fixture_id = f.id and ra.role = 'referee' and ra.status = 'accepted')
     group by f.competition_id order by count(*) desc limit 1;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'referees', 'label', 'Referees',
      'detail', case when coalesce(v_count2, 0) = 0 then 'Every game covered'
                     else v_count2 || case when v_count2 = 1 then ' game' else ' games' end || ' without a referee' end,
      'href', case when coalesce(v_comp2, v_comp) is null then '/competitions'
                   else '/competitions/' || coalesce(v_comp2, v_comp) || '?tab=referees' end,
      'count', coalesce(v_count2, 0));

    -- 3. Results: disputed scores and sheets still missing from games played.
    v_comp2 := null; v_count2 := null; v_count := null;
    select f.competition_id,
           count(*) filter (where f.score_disputed),
           count(*) filter (where not f.score_disputed)
      into v_comp2, v_count, v_count2
      from public.fixtures f
      join public.competitions c on c.id = f.competition_id
     where c.organiser_id = v_academy
       and (
         f.score_disputed
         or (f.starts_at between now() - interval '7 days' and now()
             and f.status in ('scheduled', 'in_progress', 'final')
             and (select count(*) from public.match_sheets ms where ms.fixture_id = f.id) < 2)
       )
     group by f.competition_id order by count(*) desc limit 1;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'results', 'label', 'Results',
      'detail', case when coalesce(v_count, 0) + coalesce(v_count2, 0) = 0 then 'Nothing to resolve'
                     else concat_ws(' · ',
                            case when coalesce(v_count, 0) > 0 then v_count || ' disputed' end,
                            case when coalesce(v_count2, 0) > 0 then v_count2 || ' sheets missing' end) end,
      'href', case when coalesce(v_comp2, v_comp) is null then '/competitions'
                   else '/competitions/' || coalesce(v_comp2, v_comp) || '?tab=run' end,
      'count', coalesce(v_count, 0) + coalesce(v_count2, 0));
  end if;

  -- The latest announcement in a channel this person is in.
  select jsonb_build_object(
           'id', m.id, 'channel_id', m.channel_id, 'channel_name', c.name,
           'body', left(m.body, 280), 'sender_name', p.full_name, 'created_at', m.created_at,
           'reply_count', (select count(*) from public.messages x
                            where x.reply_to_id = m.id and x.status = 'published' and x.deleted_at is null))
    into v_ann
    from public.messages m
    join public.channel_members cm on cm.channel_id = m.channel_id and cm.profile_id = v_me
    join public.channels c on c.id = m.channel_id
    left join public.profiles p on p.id = m.sender_id
   where m.academy_id = v_academy and m.is_announcement
     and m.status = 'published' and m.deleted_at is null
   order by m.created_at desc limit 1;

  -- Everywhere else this person belongs, for the one-tap switch.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id, 'name', o.name, 'type', o.type, 'role', o.role,
           'persona', app_private.home_persona(o.id, v_me, o.role, o.type::text),
           'primary_colour', o.primary_colour) order by o.name), '[]'::jsonb)
    into v_switch
    from public.my_organisations() o
   where o.id <> v_academy;

  return jsonb_build_object(
    'academy_id', v_academy,
    'role', v_role,
    'persona', v_persona,
    'jobs', v_jobs,
    'today', v_today,
    'announcement', v_ann,
    'switch', v_switch);
end;
$$;

revoke execute on function public.home_jobs(uuid) from public, anon;
grant execute on function public.home_jobs(uuid) to authenticated;
