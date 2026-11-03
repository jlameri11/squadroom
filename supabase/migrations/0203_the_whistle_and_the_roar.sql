-- 0203: the whistle and the roar.
--
-- X-01 / G-06. The grandparents are not at the ground; the other parent is
-- at the U10s' game on the next pitch. A coach taps "+1 us" and names the
-- scorer, and the squad's chat says "⚽ GOAL! Leo Whitfield (12') — 1–0"
-- — which 0088 pushes to every family in the chat, as it happens. Half
-- time, full time, a card, a word from the sideline: each one a line in
-- the chat and a row here, so the game can be read back as a timeline.
--
-- A tap can be undone for a minute. The chat line it made is taken down,
-- and the score re-derives from the rows that stand.
--
-- Full time writes the result on the game (set_event_result's rule) and
-- the goals and assists into the stats (0202), so the coach who kept the
-- ticker has nothing to type afterwards. A game in one of OUR competitions
-- keeps its official score on the fixture's sheet (0187), so full time
-- there is a line in the chat and nothing more — the sheet is the record.

create table if not exists public.event_ticker (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  event_id    uuid not null,
  kind        text not null check (kind in ('kick_off', 'goal_for', 'goal_against', 'half_time', 'full_time', 'yellow', 'red', 'note')),
  player_id   uuid,
  assist_id   uuid,
  minute      integer check (minute is null or minute between 0 and 130),
  note        text,
  message_id  uuid references public.messages(id) on delete set null,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  undone_at   timestamptz,
  foreign key (event_id, academy_id) references public.events(id, academy_id) on delete cascade,
  foreign key (player_id, academy_id) references public.players(id, academy_id) on delete set null,
  foreign key (assist_id, academy_id) references public.players(id, academy_id) on delete set null
);
create index if not exists event_ticker_event_idx on public.event_ticker (event_id, created_at);

alter table public.event_ticker enable row level security;
drop policy if exists event_ticker_read on public.event_ticker;
create policy event_ticker_read on public.event_ticker for select to authenticated
  using ((select app_private.is_team_member(app_private.event_team(event_id)))
         or (select app_private.is_team_coach(app_private.event_team(event_id))));
-- Written only through live_tick / undo_last_tick.
grant select on public.event_ticker to authenticated;

-- The score as the rows that stand say it.
create or replace function app_private.live_score(p_event uuid)
returns table (ours integer, theirs integer)
language sql stable security definer set search_path = public as $$
  select count(*) filter (where kind = 'goal_for')::integer,
         count(*) filter (where kind = 'goal_against')::integer
    from public.event_ticker where event_id = p_event and undone_at is null;
$$;

-- ----------------------------------------------------------------- reading
drop function if exists public.event_live(uuid);
create or replace function public.event_live(p_event uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  e        public.events;
  v_coach  boolean;
  v_member boolean;
  v_ours   integer;
  v_theirs integer;
  v_last   public.event_ticker;
begin
  select * into e from public.events where id = p_event;
  if e.id is null then return null; end if;
  v_coach := coalesce(app_private.is_team_coach(e.team_id), false);
  v_member := coalesce(app_private.is_team_member(e.team_id), false);
  if not (v_coach or v_member) then
    raise exception 'that game is another squad''s' using errcode = '42501';
  end if;
  select ours, theirs into v_ours, v_theirs from app_private.live_score(p_event);
  select * into v_last from public.event_ticker t where t.event_id = p_event and t.undone_at is null order by t.created_at desc limit 1;
  return jsonb_build_object(
    'event_id', e.id, 'can_tap', v_coach, 'opponent', e.opponent,
    'window_open', now() >= e.starts_at - interval '30 minutes' and e.cancelled_at is null,
    -- Long over: a game that finished hours ago with no ticker is not
    -- offered a kick-off button; one with a ticker may still be finished.
    'over', now() > coalesce(e.ends_at, e.starts_at + interval '2 hours') + interval '3 hours',
    'kicked_off', exists (select 1 from public.event_ticker t where t.event_id = p_event and t.kind = 'kick_off' and t.undone_at is null),
    'kick_off_at', (select min(t.created_at) from public.event_ticker t where t.event_id = p_event and t.kind = 'kick_off' and t.undone_at is null),
    'finished', exists (select 1 from public.event_ticker t where t.event_id = p_event and t.kind = 'full_time' and t.undone_at is null),
    'in_competition', e.fixture_id is not null,
    'score', jsonb_build_object('ours', v_ours, 'theirs', v_theirs),
    'undoable', case when v_coach and v_last.id is not null and v_last.created_at > now() - interval '60 seconds' then v_last.id end,
    'ticks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'kind', t.kind, 'minute', t.minute, 'note', t.note, 'at', t.created_at,
               'player', (select pl.full_name from public.players pl where pl.id = t.player_id),
               'assist', (select pl.full_name from public.players pl where pl.id = t.assist_id))
             order by t.created_at)
        from public.event_ticker t where t.event_id = p_event and t.undone_at is null), '[]'::jsonb),
    'players', case when v_coach then coalesce((
      select jsonb_agg(jsonb_build_object('id', pl.id, 'name', pl.full_name, 'preferred_name', pl.preferred_name) order by pl.full_name)
        from public.players pl where pl.team_id = e.team_id), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$fn$;
revoke execute on function public.event_live(uuid) from public, anon;
grant execute on function public.event_live(uuid) to authenticated;

-- ------------------------------------------------------------------ a tap
drop function if exists public.live_tick(uuid, text, uuid, uuid, integer, text);
create or replace function public.live_tick(
  p_event uuid, p_kind text, p_player uuid default null, p_assist uuid default null,
  p_minute integer default null, p_note text default null
) returns jsonb
language plpgsql volatile security definer set search_path = public as $fn$
declare
  e        public.events;
  v_chan   uuid;
  v_ours   integer;
  v_theirs integer;
  v_minute integer;
  v_name   text;
  v_assist text;
  v_body   text;
  v_msg    uuid;
  v_id     uuid;
  v_opp    text;
begin
  select * into e from public.events where id = p_event;
  if e.id is null or not coalesce(app_private.is_team_coach(e.team_id), false) then
    raise exception 'only the squad''s coach keeps the ticker' using errcode = '42501';
  end if;
  if e.type not in ('match', 'tournament') or e.cancelled_at is not null then
    raise exception 'only a game that is on has a ticker' using errcode = '22023';
  end if;
  if p_kind not in ('kick_off', 'goal_for', 'goal_against', 'half_time', 'full_time', 'yellow', 'red', 'note') then
    raise exception 'that is not a thing that happens in a game' using errcode = '22023';
  end if;
  if now() < e.starts_at - interval '30 minutes' then
    raise exception 'the ticker opens half an hour before kick-off' using errcode = '22023';
  end if;
  if exists (select 1 from public.event_ticker t where t.event_id = p_event and t.kind = 'full_time' and t.undone_at is null) then
    raise exception 'the game is over — undo full time within a minute if it was a slip' using errcode = '22023';
  end if;
  if p_kind = 'kick_off' and exists (select 1 from public.event_ticker t where t.event_id = p_event and t.kind = 'kick_off' and t.undone_at is null) then
    raise exception 'kick-off is already in' using errcode = '22023';
  end if;
  if p_player is not null and not exists (select 1 from public.players pl where pl.id = p_player and pl.team_id = e.team_id) then
    raise exception 'that player is not on this squad' using errcode = '22023';
  end if;
  if p_assist is not null and not exists (select 1 from public.players pl where pl.id = p_assist and pl.team_id = e.team_id) then
    raise exception 'that player is not on this squad' using errcode = '22023';
  end if;

  -- The minute: as given, else from kick-off, else from the scheduled start.
  v_minute := coalesce(p_minute, greatest(0, least(130, floor(extract(epoch from (now() - coalesce(
                (select min(t.created_at) from public.event_ticker t where t.event_id = p_event and t.kind = 'kick_off' and t.undone_at is null),
                e.starts_at))) / 60)::integer)));

  insert into public.event_ticker (academy_id, event_id, kind, player_id, assist_id, minute, note, created_by)
  values (e.academy_id, p_event, p_kind, p_player, p_assist, v_minute, nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_id;

  select ours, theirs into v_ours, v_theirs from app_private.live_score(p_event);
  v_opp := coalesce(e.opponent, 'the opposition');
  select pl.full_name into v_name from public.players pl where pl.id = p_player;
  select pl.full_name into v_assist from public.players pl where pl.id = p_assist;
  v_body := case p_kind
    when 'kick_off'     then '🟢 Kick-off' || coalesce(' v ' || e.opponent, '') || '. Follow the game here.'
    when 'goal_for'     then '⚽ GOAL! ' || coalesce(v_name, 'Us') || ' (' || v_minute || '''' || ')' || coalesce(' — assist ' || v_assist, '') || ' — ' || v_ours || '–' || v_theirs
    when 'goal_against' then '⚽ ' || v_opp || ' score (' || v_minute || '''' || ') — ' || v_ours || '–' || v_theirs
    when 'half_time'    then '⏸ Half time: ' || v_ours || '–' || v_theirs
    when 'full_time'    then '🏁 Full time: ' || v_ours || '–' || v_theirs || ' — ' || case when v_ours > v_theirs then 'won' when v_ours < v_theirs then 'lost' else 'drew' end || coalesce(' v ' || e.opponent, '')
    when 'yellow'       then '🟨 Yellow card: ' || coalesce(v_name, 'us') || ' (' || v_minute || '''' || ')'
    when 'red'          then '🟥 Red card: ' || coalesce(v_name, 'us') || ' (' || v_minute || '''' || ')'
    else '📣 ' || coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'From the sideline')
  end;
  if p_kind in ('goal_for', 'goal_against', 'half_time', 'full_time', 'yellow', 'red') and nullif(btrim(coalesce(p_note, '')), '') is not null then
    v_body := v_body || chr(10) || btrim(p_note);
  end if;

  -- The line in the squad's chat, from the coach; 0088 pushes it.
  select c.id into v_chan from public.channels c where c.team_id = e.team_id and c.type = 'team' and c.status = 'active' limit 1;
  if v_chan is not null then
    insert into public.messages (academy_id, channel_id, sender_id, body, event_id)
    values (e.academy_id, v_chan, auth.uid(), v_body, p_event)
    returning id into v_msg;
    update public.event_ticker set message_id = v_msg where id = v_id;
  end if;

  -- Full time: the result on the game and the goals in the stats, unless
  -- the game is in one of our competitions, where the sheet is the record.
  if p_kind = 'full_time' and e.fixture_id is null then
    update public.events
       set our_score = v_ours, their_score = v_theirs,
           score_entered_by = auth.uid(), score_entered_at = now(), updated_at = now()
     where id = p_event;
    insert into public.event_player_stats (academy_id, event_id, player_id, goals, assists, entered_by)
    select e.academy_id, p_event, pl.id,
           (select count(*) from public.event_ticker t where t.event_id = p_event and t.kind = 'goal_for' and t.player_id = pl.id and t.undone_at is null),
           (select count(*) from public.event_ticker t where t.event_id = p_event and t.kind = 'goal_for' and t.assist_id = pl.id and t.undone_at is null),
           auth.uid()
      from public.players pl
     where pl.id in (select t.player_id from public.event_ticker t where t.event_id = p_event and t.undone_at is null and t.player_id is not null
                     union select t.assist_id from public.event_ticker t where t.event_id = p_event and t.undone_at is null and t.assist_id is not null)
    on conflict (event_id, player_id) do update
      set goals = excluded.goals, assists = excluded.assists, entered_by = excluded.entered_by, updated_at = now();
  end if;

  return public.event_live(p_event);
end;
$fn$;
revoke execute on function public.live_tick(uuid, text, uuid, uuid, integer, text) from public, anon;
grant execute on function public.live_tick(uuid, text, uuid, uuid, integer, text) to authenticated;

-- Undo, within a minute: the row stands aside, its chat line comes down.
drop function if exists public.undo_last_tick(uuid);
create or replace function public.undo_last_tick(p_event uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $fn$
declare
  e      public.events;
  v_last public.event_ticker;
begin
  select * into e from public.events where id = p_event;
  if e.id is null or not coalesce(app_private.is_team_coach(e.team_id), false) then
    raise exception 'only the squad''s coach keeps the ticker' using errcode = '42501';
  end if;
  select * into v_last from public.event_ticker t where t.event_id = p_event and t.undone_at is null order by t.created_at desc limit 1;
  if v_last.id is null then
    raise exception 'nothing to undo' using errcode = '22023';
  end if;
  if v_last.created_at < now() - interval '60 seconds' then
    raise exception 'that was more than a minute ago — it stands; add a note if it was wrong' using errcode = '22023';
  end if;
  update public.event_ticker set undone_at = now() where id = v_last.id;
  if v_last.message_id is not null then
    update public.messages set deleted_at = now(), deleted_by = auth.uid() where id = v_last.message_id and deleted_at is null;
  end if;
  if v_last.kind = 'full_time' and e.fixture_id is null then
    update public.events set our_score = null, their_score = null, score_entered_by = null, score_entered_at = null, updated_at = now() where id = p_event;
  end if;
  return public.event_live(p_event);
end;
$fn$;
revoke execute on function public.undo_last_tick(uuid) from public, anon;
grant execute on function public.undo_last_tick(uuid) to authenticated;
