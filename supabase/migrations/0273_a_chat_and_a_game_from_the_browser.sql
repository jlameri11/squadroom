-- 0273 — A chat and a game load from the browser, in one call each (the
-- "Feels instant" pass; Joey, 11 Nov 2026; BUILD_PLAN item 16).
--
-- Opening a chat or a game was a server render in us-east-2 that made three
-- or four trips to Sydney before it could draw anything — the two screens
-- people open most, and the only main ones still paying for the Pacific.
-- Netlify will not let this plan move its functions ("You cannot edit
-- functions regions", 13 Nov 2026), so the pages become shells and the
-- browser, a few milliseconds from the database, asks for the screen itself:
-- one function, one round trip, cached by lib/hooks/use-screen (memory and
-- IndexedDB) so a chat or a game opened before paints at once and refreshes
-- quietly.
--
-- Nothing new may be read. Each function answers only what the page already
-- showed, under the same rules: the chat through is_channel_member (what
-- channel_messages itself checks) or the club's staff; the game through
-- can_read_event, with the roster only for the game's coach — the page used
-- to get that from RLS, which a definer function does not have.
--
-- null means "not signed in" (use-screen sends them to sign in); a signed-in
-- person who may not see it gets {denied: true}, a missing id {missing: true}.

create or replace function public.channel_screen(p_channel uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_me      uuid := auth.uid();
  c         public.channels%rowtype;
  m         public.channel_members%rowtype;
  v_kind    text;
  v_is_host boolean := false;
  v_notices jsonb := null;
  v_group   jsonb := null;
  v_comp    record;
begin
  if v_me is null then
    return null;
  end if;
  select * into c from public.channels where id = p_channel;
  if c.id is null then
    return jsonb_build_object('missing', true);
  end if;
  if not (coalesce(app_private.is_channel_member(p_channel), false) or coalesce(app_private.is_academy_staff(c.academy_id), false)) then
    return jsonb_build_object('denied', true);
  end if;

  select * into m from public.channel_members where channel_id = p_channel and profile_id = v_me;
  v_kind := c.type::text;

  if v_kind in ('clubs', 'referees', 'committee', 'managers') then
    -- A computed room (0235, 0245): who is in it, and whether I host it.
    v_group := public.group_channel_info(p_channel);
    v_is_host := coalesce((v_group->>'is_host')::boolean, false);
  elsif v_kind = 'notices' and c.competition_id is not null then
    -- A competition's Notices (0213): the league posts; everyone else reads.
    v_is_host := coalesce(public.can_post_in_channel(p_channel), false);
    select co.name, co.organiser, a.name as league
      into v_comp
      from public.competitions co
      left join public.academies a on a.id = co.organiser_id
     where co.id = c.competition_id;
    v_notices := jsonb_build_object(
      'competitionId', c.competition_id,
      'competition', coalesce(v_comp.name, c.name, 'This competition'),
      'league', coalesce(v_comp.league, v_comp.organiser, 'The league'));
  else
    -- Academy staff host every channel, whether or not they hold a host row.
    v_is_host := coalesce(m.role::text in ('host', 'co_host'), false)
              or coalesce(app_private.is_academy_staff(c.academy_id), false);
  end if;

  return jsonb_build_object(
    'channel', jsonb_build_object(
      'id', c.id, 'academy_id', c.academy_id, 'team_id', c.team_id,
      'name', c.name, 'type', v_kind, 'posting_mode', c.posting_mode,
      'archived', c.status = 'archived',
      'restrictions', coalesce(c.restrictions, '{}'::jsonb),
      'competition_id', c.competition_id),
    'membership', case when m.channel_id is null then null else jsonb_build_object('role', m.role, 'muted', m.muted) end,
    'is_host', v_is_host,
    'notices', v_notices,
    'group', v_group,
    -- Newest first, as channel_messages pages; the screen reverses it.
    'messages', coalesce((select jsonb_agg(to_jsonb(x)) from public.channel_messages(p_channel, null, 50) x), '[]'::jsonb)
  );
end;
$fn$;
revoke execute on function public.channel_screen(uuid) from public, anon;
grant execute on function public.channel_screen(uuid) to authenticated;

create or replace function public.game_screen(p_event uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_me    uuid := auth.uid();
  e       public.events%rowtype;
  v_coach boolean;
begin
  if v_me is null then
    return null;
  end if;
  select * into e from public.events where id = p_event;
  if e.id is null then
    return jsonb_build_object('missing', true);
  end if;
  if not coalesce(app_private.can_read_event(p_event), false) then
    return jsonb_build_object('denied', true);
  end if;
  v_coach := coalesce(app_private.is_event_coach(p_event), false);

  return jsonb_build_object(
    'event', (select to_jsonb(x) from (
                select id, academy_id, team_id, series_id, type, title, description, starts_at, ends_at,
                       arrive_at, venue, address, opponent, kit_colour, round, notes, cancelled_at,
                       cancellation_reason, cancellation_note, competition_id, fixture_id
                  from public.events where id = p_event) x),
    'mine', coalesce((select jsonb_agg(to_jsonb(r)) from public.my_rsvps_for_event(p_event) r), '[]'::jsonb),
    -- Nothing for a parent: the function itself returns no row to anyone but the game's coach.
    'summary', (select to_jsonb(s) from public.event_rsvp_summary(p_event) s limit 1),
    -- The whole squad's answers are the coach's. A family's own are in `mine`.
    'roster', case when v_coach then coalesce((
                select jsonb_agg(jsonb_build_object('player_id', r.player_id, 'name', coalesce(p.full_name, 'Player'), 'status', r.status, 'note', r.note))
                  from public.event_rsvps r
                  left join public.players p on p.id = r.player_id
                 where r.event_id = p_event), '[]'::jsonb)
              else '[]'::jsonb end,
    -- The venue's timezone (the club's) and our side for the hero.
    'club', (select jsonb_build_object('name', a.name, 'logo_url', a.logo_url, 'timezone', a.timezone, 'miniroos_scores', a.miniroos_scores)
               from public.academies a where a.id = e.academy_id),
    'team', (select jsonb_build_object('name', t.name, 'age_group', t.age_group) from public.teams t where t.id = e.team_id),
    'is_coach', v_coach
  );
end;
$fn$;
revoke execute on function public.game_screen(uuid) from public, anon;
grant execute on function public.game_screen(uuid) to authenticated;
