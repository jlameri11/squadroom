-- 0251: game day — MiniRoos keep no score, a result reaches the squad's
-- chat, the manager is reminded of the team sheet, and the club sees its
-- Saturday in one place.
--
-- Big Club Mode item 9 (Joey, 9 Nov 2026): "NPL and association comps run
-- on Dribl … MiniRoos (U6–U11): no scores or ladder … 'Saturday' view:
-- every game today across the club by ground, call-offs, missing
-- managers/referees, roster gaps, results as they come in." And the plan:
-- results posted to the team chat by set_event_result; 'Submit your Dribl
-- team sheet' to managers the evening before.
--
-- MiniRoos in ONE place: app_private.scores_shown(team). False for a squad
-- in U5–U11 unless the club has turned scores on (academies.miniroos_scores,
-- Club settings). Every reader of a club game's score applies it:
-- event_result (the result screen and the share card read it), event_live
-- (the hero), live_tick (the lines in the chat), academy_results, team_form,
-- my_matchdays, division_table, and set_event_result refuses to record one.
-- Competition fixtures keep their own rule (competition_divisions, 0148).

-- ---------------------------------------------------------------------------
-- 1. New kinds of notification.
-- ---------------------------------------------------------------------------
do $$ begin
  alter table public.notification_queue drop constraint if exists notification_queue_kind_check;
  alter table public.notification_queue add constraint notification_queue_kind_check check (kind = any (array[
    'message', 'announcement', 'event_reminder', 'poll_opened', 'poll_closing', 'rsvp_change', 'invite',
    'event_cancelled', 'event_changed', 'event_back_on', 'rsvp_nudge', 'announcement_repeat', 'wwcc_expiring',
    'guardian_erased', 'official_rego_pending', 'reregister_nudge', 'offer', 'referee_appointment',
    'referee_response', 'referee_withdrawn', 'fixture_change_proposed', 'fixture_change_answered',
    'fixture_change_decided', 'mention', 'match_correction_requested', 'match_correction_decided',
    'fixture_flowing_open', 'discipline_warning', 'discipline_suspension', 'forfeit_request', 'forfeit_decided',
    'nomination', 'fee_due', 'fee_overdue', 'player_report', 'player_clip', 'selected', 'not_selected',
    'match_day', 'support_reply', 'match_video', 'match_photos', 'photo_hidden', 'helpers_wanted',
    'helper_reminder', 'helper_changed', 'report_filed', 'team_published', 'team_sheet_due']));
end $$;

-- ---------------------------------------------------------------------------
-- 2. MiniRoos: the rule, in one place.
-- ---------------------------------------------------------------------------
alter table public.academies
  add column if not exists miniroos_scores boolean not null default false;
comment on column public.academies.miniroos_scores is
  'MiniRoos (U5–U11) club games show no score and no ladder unless the club turns this on.';

create or replace function app_private.is_miniroos(p_age_group text)
returns boolean
language sql stable set search_path = public as $fn$
  select coalesce(app_private.age_number(p_age_group) between 5 and 11, false);
$fn$;

create or replace function app_private.scores_shown(p_team uuid)
returns boolean
language sql stable security definer set search_path = public as $fn$
  select case when p_team is null then true
              else coalesce((select (not app_private.is_miniroos(t.age_group)) or a.miniroos_scores
                               from public.teams t join public.academies a on a.id = t.academy_id
                              where t.id = p_team), true) end;
$fn$;

-- For the screens: may a score be shown for this squad? A stranger is told
-- yes, which gives nothing away — the readers below are what hide a score.
create or replace function public.scores_shown(p_team uuid)
returns boolean
language sql stable security definer set search_path = public as $fn$
  select case when p_team is null then true
              when not coalesce(app_private.is_academy_member((select t.academy_id from public.teams t where t.id = p_team)), false) then true
              else app_private.scores_shown(p_team) end;
$fn$;
revoke execute on function public.scores_shown(uuid) from public, anon;
grant execute on function public.scores_shown(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The readers.
-- ---------------------------------------------------------------------------
create or replace function public.event_result(p_event uuid)
returns table (
  ours     integer,
  theirs   integer,
  outcome  text,
  note     text,
  was_home boolean,
  source   text,
  entered_at timestamptz,
  entered_by text
)
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_event public.events;
  v_fix   public.fixtures;
  v_ours  integer;
  v_their integer;
  v_src   text;
begin
  select * into v_event from public.events where id = p_event;
  if v_event.id is null then
    return;
  end if;
  if not coalesce(app_private.can_read_event(p_event), false) then
    return;
  end if;
  -- 0251: a MiniRoos game has no result to read.
  if v_event.fixture_id is null and not app_private.scores_shown(v_event.team_id) then
    return;
  end if;

  if v_event.fixture_id is not null then
    select * into v_fix from public.fixtures where id = v_event.fixture_id;
    if v_fix.home_score is not null then
      if exists (
        select 1 from public.competition_entries ce
         where ce.id = v_fix.home_entry_id and ce.team_id = v_event.team_id
      ) then
        v_ours := v_fix.home_score; v_their := v_fix.away_score;
      else
        v_ours := v_fix.away_score; v_their := v_fix.home_score;
      end if;
      v_src := 'fixture';
    end if;
  end if;

  if v_ours is null then
    v_ours := v_event.our_score;
    v_their := v_event.their_score;
    v_src := 'event';
  end if;

  if v_ours is null then
    return;
  end if;

  return query select
    v_ours,
    v_their,
    case when v_ours > v_their then 'won'
         when v_ours < v_their then 'lost'
         else 'drew' end,
    v_event.result_note,
    v_event.was_home,
    v_src,
    v_event.score_entered_at,
    (select p.full_name from public.profiles p where p.id = v_event.score_entered_by);
end;
$fn$;

create or replace function public.event_live(p_event uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  e        public.events;
  v_coach  boolean;
  v_member boolean;
  v_ours   integer;
  v_theirs integer;
  v_last   public.event_ticker;
  v_show   boolean;
begin
  select * into e from public.events where id = p_event;
  if e.id is null then return null; end if;
  v_coach := coalesce(app_private.is_team_coach(e.team_id), false);
  v_member := coalesce(app_private.is_team_member(e.team_id), false);
  if not (v_coach or v_member) then
    raise exception 'that game is another squad''s' using errcode = '42501';
  end if;
  v_show := e.fixture_id is not null or app_private.scores_shown(e.team_id);
  select ours, theirs into v_ours, v_theirs from app_private.live_score(p_event);
  select * into v_last from public.event_ticker t where t.event_id = p_event and t.undone_at is null order by t.created_at desc limit 1;
  return jsonb_build_object(
    'taps_have_ids', true,
    'event_id', e.id, 'can_tap', v_coach, 'opponent', e.opponent,
    'window_open', now() >= e.starts_at - interval '30 minutes' and e.cancelled_at is null,
    'over', now() > coalesce(e.ends_at, e.starts_at + interval '2 hours') + interval '3 hours',
    'kicked_off', exists (select 1 from public.event_ticker t where t.event_id = p_event and t.kind = 'kick_off' and t.undone_at is null),
    'kick_off_at', (select min(t.created_at) from public.event_ticker t where t.event_id = p_event and t.kind = 'kick_off' and t.undone_at is null),
    'finished', exists (select 1 from public.event_ticker t where t.event_id = p_event and t.kind = 'full_time' and t.undone_at is null),
    'in_competition', e.fixture_id is not null,
    -- 0251: MiniRoos keep no score — the goals are still cheered, the tally is not kept on screen.
    'scores_shown', v_show,
    'score', case when v_show then jsonb_build_object('ours', v_ours, 'theirs', v_theirs) else null end,
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

-- live_tick as 0218 declared it (p_client_id and p_at): a different
-- signature would be a second overload PostgREST cannot choose between.
drop function if exists public.live_tick(uuid, text, uuid, uuid, integer, text);
create or replace function public.live_tick(
  p_event uuid, p_kind text, p_player uuid default null, p_assist uuid default null,
  p_minute integer default null, p_note text default null,
  p_client_id uuid default null, p_at timestamptz default null
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
  v_at     timestamptz := now();
  v_show   boolean;
  v_tally  text;
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
  -- 0218: a tap this phone sent before, sent again because its answer never came back.
  if p_client_id is not null
     and exists (select 1 from public.event_ticker t where t.event_id = p_event and t.client_id = p_client_id) then
    return public.event_live(p_event);
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

  v_minute := coalesce(p_minute, greatest(0, least(130, floor(extract(epoch from (now() - coalesce(
                (select min(t.created_at) from public.event_ticker t where t.event_id = p_event and t.kind = 'kick_off' and t.undone_at is null),
                e.starts_at))) / 60)::integer)));

  -- 0218: a kick-off tapped with no signal carries the time it was tapped.
  if p_kind = 'kick_off' and p_at is not null then
    v_at := least(now(), greatest(p_at, now() - interval '3 hours'));
  end if;

  insert into public.event_ticker (academy_id, event_id, kind, player_id, assist_id, minute, note, created_by, client_id, created_at)
  values (e.academy_id, p_event, p_kind, p_player, p_assist, v_minute, nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), p_client_id, v_at)
  on conflict (event_id, client_id) where client_id is not null do nothing
  returning id into v_id;
  if v_id is null then
    return public.event_live(p_event);
  end if;

  select ours, theirs into v_ours, v_theirs from app_private.live_score(p_event);
  v_opp := coalesce(e.opponent, 'the opposition');
  select pl.full_name into v_name from public.players pl where pl.id = p_player;
  select pl.full_name into v_assist from public.players pl where pl.id = p_assist;
  -- 0251: MiniRoos — the goal is cheered, the tally is not kept on screen.
  v_show := e.fixture_id is not null or app_private.scores_shown(e.team_id);
  v_tally := case when v_show then ' — ' || v_ours || '–' || v_theirs else '' end;
  v_body := case p_kind
    when 'kick_off'     then '🟢 Kick-off' || coalesce(' v ' || e.opponent, '') || '. Follow the game here.'
    when 'goal_for'     then '⚽ GOAL! ' || coalesce(v_name, 'Us') || ' (' || v_minute || '''' || ')' || coalesce(' — assist ' || v_assist, '') || v_tally
    when 'goal_against' then '⚽ ' || v_opp || ' score (' || v_minute || '''' || ')' || v_tally
    when 'half_time'    then '⏸ Half time' || case when v_show then ': ' || v_ours || '–' || v_theirs else '' end
    when 'full_time'    then case when v_show
                               then '🏁 Full time: ' || v_ours || '–' || v_theirs || ' — ' || case when v_ours > v_theirs then 'won' when v_ours < v_theirs then 'lost' else 'drew' end || coalesce(' v ' || e.opponent, '')
                               else '🏁 Full time' || coalesce(' v ' || e.opponent, '') || '. Well played, everyone.' end
    when 'yellow'       then '🟨 Yellow card: ' || coalesce(v_name, 'us') || ' (' || v_minute || '''' || ')'
    when 'red'          then '🟥 Red card: ' || coalesce(v_name, 'us') || ' (' || v_minute || '''' || ')'
    else '📣 ' || coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'From the sideline')
  end;
  if p_kind in ('goal_for', 'goal_against', 'half_time', 'full_time', 'yellow', 'red') and nullif(btrim(coalesce(p_note, '')), '') is not null then
    v_body := v_body || chr(10) || btrim(p_note);
  end if;

  select c.id into v_chan from public.channels c where c.team_id = e.team_id and c.type = 'team' and c.status = 'active' limit 1;
  if v_chan is not null then
    insert into public.messages (academy_id, channel_id, sender_id, body, event_id)
    values (e.academy_id, v_chan, auth.uid(), v_body, p_event)
    returning id into v_msg;
    update public.event_ticker set message_id = v_msg where id = v_id;
  end if;

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
revoke execute on function public.live_tick(uuid, text, uuid, uuid, integer, text, uuid, timestamptz) from public, anon;
grant execute on function public.live_tick(uuid, text, uuid, uuid, integer, text, uuid, timestamptz) to authenticated;

create or replace function public.academy_results(p_academy uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
begin
  if not coalesce(app_private.is_academy_member(p_academy), false) then
    raise exception 'that club''s results are its own people''s' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(row order by (row ->> 'age_group'), row ->> 'name')
      from (
        select case when app_private.scores_shown(t.id) then jsonb_build_object(
                 'team_id', t.id, 'name', t.name, 'age_group', t.age_group, 'season', t.season, 'scores_shown', true,
                 'played', count(e.id), 'won', count(*) filter (where e.our_score > e.their_score),
                 'drawn', count(*) filter (where e.our_score = e.their_score),
                 'lost', count(*) filter (where e.our_score < e.their_score),
                 'gf', coalesce(sum(e.our_score), 0), 'ga', coalesce(sum(e.their_score), 0),
                 'last', coalesce((select jsonb_agg(x.o order by x.starts_at desc) from (
                            select e2.starts_at, case when e2.our_score > e2.their_score then 'W' when e2.our_score < e2.their_score then 'L' else 'D' end as o
                              from public.events e2
                             where e2.team_id = t.id and e2.type in ('match', 'tournament') and e2.cancelled_at is null
                               and e2.our_score is not null and e2.their_score is not null
                             order by e2.starts_at desc limit 5) x), '[]'::jsonb),
                 'latest', (select jsonb_build_object('event_id', e3.id, 'opponent', e3.opponent, 'ours', e3.our_score, 'theirs', e3.their_score, 'starts_at', e3.starts_at)
                              from public.events e3
                             where e3.team_id = t.id and e3.type in ('match', 'tournament') and e3.cancelled_at is null
                               and e3.our_score is not null and e3.their_score is not null
                             order by e3.starts_at desc limit 1)
               )
               -- 0251: MiniRoos — the games, never the score.
               else jsonb_build_object(
                 'team_id', t.id, 'name', t.name, 'age_group', t.age_group, 'season', t.season, 'scores_shown', false,
                 'played', count(e.id), 'last', '[]'::jsonb,
                 'latest', (select jsonb_build_object('event_id', e3.id, 'opponent', e3.opponent, 'starts_at', e3.starts_at)
                              from public.events e3
                             where e3.team_id = t.id and e3.type in ('match', 'tournament') and e3.cancelled_at is null
                               and e3.starts_at <= now()
                             order by e3.starts_at desc limit 1))
               end as row
          from public.teams t
          left join public.events e on e.team_id = t.id and e.type in ('match', 'tournament') and e.cancelled_at is null
                                    and e.our_score is not null and e.their_score is not null
         where t.academy_id = p_academy and t.status = 'active'
         group by t.id
      ) rows), '[]'::jsonb);
end;
$fn$;

create or replace function public.team_form(p_team uuid, p_n integer default 5)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_team public.teams;
begin
  select * into v_team from public.teams where id = p_team;
  if v_team.id is null or not (coalesce(app_private.is_team_member(p_team), false) or coalesce(app_private.is_team_coach(p_team), false)) then
    raise exception 'that squad''s form is its own people''s' using errcode = '42501';
  end if;
  -- 0251: MiniRoos — no form, no table.
  if not app_private.scores_shown(p_team) then
    return jsonb_build_object(
      'team', jsonb_build_object('id', v_team.id, 'name', v_team.name, 'season', v_team.season),
      'scores_shown', false, 'last', '[]'::jsonb,
      'season', jsonb_build_object('played', 0, 'won', 0, 'drawn', 0, 'lost', 0, 'gf', 0, 'ga', 0));
  end if;
  return jsonb_build_object(
    'team', jsonb_build_object('id', v_team.id, 'name', v_team.name, 'season', v_team.season),
    'scores_shown', true,
    'last', coalesce((
      select jsonb_agg(jsonb_build_object(
               'event_id', e.id, 'starts_at', e.starts_at, 'opponent', e.opponent, 'was_home', e.was_home,
               'ours', e.our_score, 'theirs', e.their_score,
               'outcome', case when e.our_score > e.their_score then 'won' when e.our_score < e.their_score then 'lost' else 'drew' end,
               'source', e.source)
             order by e.starts_at desc)
        from (select * from public.events e
               where e.team_id = p_team and e.type = 'match' and e.cancelled_at is null
                 and e.our_score is not null and e.their_score is not null
               order by e.starts_at desc limit greatest(coalesce(p_n, 5), 1)) e), '[]'::jsonb),
    'season', (
      select jsonb_build_object(
               'played', count(*), 'won', count(*) filter (where e.our_score > e.their_score),
               'drawn', count(*) filter (where e.our_score = e.their_score),
               'lost', count(*) filter (where e.our_score < e.their_score),
               'gf', coalesce(sum(e.our_score), 0), 'ga', coalesce(sum(e.their_score), 0))
        from public.events e
       where e.team_id = p_team and e.type = 'match' and e.cancelled_at is null
         and e.our_score is not null and e.their_score is not null)
  );
end;
$fn$;

create or replace function public.my_matchdays(p_academy uuid, p_limit integer default 40)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  v_staff boolean := coalesce(app_private.is_academy_coach(p_academy), false);
begin
  if not coalesce(app_private.is_academy_member(p_academy), false) then
    raise exception 'not a member of that club' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', e.id, 'title', e.title, 'starts_at', e.starts_at, 'opponent', e.opponent, 'venue', e.venue,
             'team_id', e.team_id, 'team', (select t.name from public.teams t where t.id = e.team_id),
             -- 0251: MiniRoos — a game, never a score or a scorer.
             'scores_shown', e.shown,
             'ours', case when e.shown then coalesce(e.our_score, case when e.fixture_id is not null then (select case when ce.id = f.home_entry_id then f.home_score else f.away_score end from public.fixtures f join public.competition_entries ce on ce.team_id = e.team_id and ce.competition_id = f.competition_id where f.id = e.fixture_id) end) end,
             'theirs', case when e.shown then coalesce(e.their_score, case when e.fixture_id is not null then (select case when ce.id = f.home_entry_id then f.away_score else f.home_score end from public.fixtures f join public.competition_entries ce on ce.team_id = e.team_id and ce.competition_id = f.competition_id where f.id = e.fixture_id) end) end,
             'scorers', case when e.shown then coalesce((select jsonb_agg(jsonb_build_object('name', pl.full_name, 'goals', s.goals) order by s.goals desc, pl.full_name)
                                    from public.event_player_stats s join public.players pl on pl.id = s.player_id
                                   where s.event_id = e.id and s.goals > 0), '[]'::jsonb) else '[]'::jsonb end,
             'videos', (select count(*) from public.event_videos v where v.event_id = e.id),
             'photos', (select count(*) from public.event_photos p where p.event_id = e.id and p.hidden_at is null))
           order by e.starts_at desc)
      from (
        select e.*, (e.fixture_id is not null or app_private.scores_shown(e.team_id)) as shown
          from public.events e
         where e.academy_id = p_academy and e.type in ('match', 'tournament') and e.cancelled_at is null
           and e.private_to is null and e.starts_at <= now()
           and (v_staff or exists (select 1 from public.team_members tm where tm.team_id = e.team_id and tm.profile_id = auth.uid()))
         order by e.starts_at desc limit greatest(coalesce(p_limit, 40), 1)
      ) e), '[]'::jsonb);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. A result is recorded, and the squad hears it.
-- ---------------------------------------------------------------------------
create or replace function public.set_event_result(
  p_event  uuid,
  p_ours   integer default null,
  p_theirs integer default null,
  p_note   text    default null,
  p_home   boolean default null
)
returns void
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_event public.events;
  v_chan  uuid;
  v_had   boolean;
begin
  select * into v_event from public.events where id = p_event;
  if v_event.id is null then
    raise exception 'no such game' using errcode = '22023';
  end if;
  if not (coalesce(app_private.is_academy_staff(v_event.academy_id), false)
          or (v_event.team_id is not null
              and coalesce(app_private.is_team_coach(v_event.team_id), false))) then
    raise exception 'only a coach can record a result' using errcode = '42501';
  end if;
  if v_event.fixture_id is not null then
    raise exception 'this game is in a competition — the score goes on the fixture, where the table reads it'
      using errcode = '22023';
  end if;
  if v_event.type not in ('match', 'tournament') then
    raise exception 'only a match has a result' using errcode = '22023';
  end if;
  -- 0251: MiniRoos keep no score.
  if p_ours is not null and not app_private.scores_shown(v_event.team_id) then
    raise exception 'MiniRoos games keep no score here. A club that wants them can turn scores on in Club settings.'
      using errcode = '22023';
  end if;
  if p_ours is not null and v_event.starts_at > now() then
    raise exception 'that game has not been played yet' using errcode = '22023';
  end if;

  v_had := v_event.our_score is not null;
  update public.events
     set our_score   = p_ours,
         their_score = p_theirs,
         was_home    = coalesce(p_home, was_home),
         result_note = nullif(btrim(coalesce(p_note, '')), ''),
         score_entered_by = case when p_ours is null then null else auth.uid() end,
         score_entered_at = case when p_ours is null then null else now() end
   where id = p_event;

  -- 0251: the squad hears it where they talk, once per result; a changed
  -- score says so. Clearing a score says nothing — there is nothing to say.
  if p_ours is not null and (not v_had or v_event.our_score is distinct from p_ours or v_event.their_score is distinct from p_theirs) then
    select c.id into v_chan from public.channels c where c.team_id = v_event.team_id and c.type = 'team' and c.status = 'active' limit 1;
    if v_chan is not null then
      insert into public.messages (academy_id, channel_id, sender_id, body, event_id)
      values (v_event.academy_id, v_chan, auth.uid(),
              case when v_had then 'Result corrected: ' else '🏁 Full time: ' end
              || p_ours || '–' || p_theirs || ' — '
              || case when p_ours > p_theirs then 'won' when p_ours < p_theirs then 'lost' else 'drew' end
              || coalesce(' v ' || v_event.opponent, '')
              || coalesce(chr(10) || nullif(btrim(coalesce(p_note, '')), ''), ''),
              p_event);
    end if;
  end if;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 5. The team sheet, the evening before.
-- ---------------------------------------------------------------------------
-- Hourly. From five in the afternoon, the club's time, every game tomorrow
-- reminds its team manager (else its coaches) once: a game in one of our
-- competitions has its sheet in Squadroom; any other game — association,
-- NPL — has it with the league, on Dribl. p_now is for the tests.
create or replace function public.queue_team_sheet_reminders(p_now timestamptz default now())
returns integer
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_n integer := 0;
  v_k integer;
  r   record;
begin
  for r in
    select e.id, e.academy_id, e.team_id, e.opponent, e.starts_at, e.fixture_id, t.name as team_name,
           coalesce(a.timezone, 'Australia/Sydney') as tz
      from public.events e
      join public.teams t on t.id = e.team_id
      join public.academies a on a.id = e.academy_id
     where e.type in ('match', 'tournament') and e.cancelled_at is null and e.private_to is null
       and (e.starts_at at time zone coalesce(a.timezone, 'Australia/Sydney'))::date
           = (p_now at time zone coalesce(a.timezone, 'Australia/Sydney'))::date + 1
       and extract(hour from p_now at time zone coalesce(a.timezone, 'Australia/Sydney')) >= 17
  loop
    insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload, dedupe_key)
    select r.academy_id, x.profile_id, 'team_sheet_due',
           'Team sheet: ' || r.team_name || coalesce(' v ' || r.opponent, '') || ' tomorrow',
           'Kick-off ' || to_char(r.starts_at at time zone r.tz, 'FMHH12:MI am') || '. '
           || case when r.fixture_id is not null then 'Submit the team sheet in Squadroom before kick-off.'
                   else 'Submit the team sheet with the league (Dribl) tonight.' end,
           '/calendar/' || r.id,
           jsonb_build_object('event_id', r.id),
           'team_sheet:' || r.id || ':' || x.profile_id
      from (
        select cr.profile_id from public.club_roles cr where cr.team_id = r.team_id and cr.role = 'team_manager'
        union
        select tm.profile_id from public.team_members tm
         where tm.team_id = r.team_id and tm.role = 'coach'
           and not exists (select 1 from public.club_roles cr where cr.team_id = r.team_id and cr.role = 'team_manager')
      ) x
    on conflict (dedupe_key) do nothing;
    get diagnostics v_k = row_count;
    v_n := v_n + v_k;
  end loop;
  return v_n;
end;
$fn$;
revoke execute on function public.queue_team_sheet_reminders(timestamptz) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.queue_team_sheet_reminders(timestamptz) to service_role;
  end if;
end $$;

select cron.unschedule('queue-team-sheet')
 where exists (select 1 from cron.job where jobname = 'queue-team-sheet');
select cron.schedule(
  'queue-team-sheet',
  '5 * * * *',
  $cron$select public.queue_team_sheet_reminders()$cron$
);

-- ---------------------------------------------------------------------------
-- 6. The club's Saturday, in one place.
-- ---------------------------------------------------------------------------
create or replace function public.saturday_view(p_academy uuid, p_date date default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_tz   text;
  v_day  date;
  v_from timestamptz;
  v_to   timestamptz;
  v_games jsonb;
  v_next date;
begin
  if auth.uid() is null then
    return null;
  end if;
  if not (coalesce(app_private.is_academy_staff(p_academy), false) or coalesce(app_private.may_run_club(p_academy, 'teams'), false)) then
    return null;
  end if;
  select coalesce(timezone, 'Australia/Sydney') into v_tz from public.academies where id = p_academy;
  v_day := coalesce(p_date, (now() at time zone v_tz)::date);
  v_from := (v_day::timestamp at time zone v_tz);
  v_to := ((v_day + 1)::timestamp at time zone v_tz);

  select coalesce(jsonb_agg(g order by (g->>'venue') nulls last, g->>'starts_at'), '[]'::jsonb) into v_games
    from (
      select jsonb_build_object(
               'event_id', e.id, 'starts_at', e.starts_at, 'team_id', t.id, 'team', t.name, 'age_group', t.age_group,
               'opponent', e.opponent, 'was_home', e.was_home,
               'venue', coalesce((select v.name from public.venues v where v.id = e.venue_id), e.venue),
               'venue_id', e.venue_id,
               'off', e.cancelled_at is not null, 'reason', e.cancellation_reason,
               'kicked_off', exists (select 1 from public.event_ticker k where k.event_id = e.id and k.kind = 'kick_off' and k.undone_at is null),
               'finished', e.our_score is not null
                           or exists (select 1 from public.event_ticker k where k.event_id = e.id and k.kind = 'full_time' and k.undone_at is null)
                           or exists (select 1 from public.fixtures f where f.id = e.fixture_id and f.status = 'final'),
               'in_competition', e.fixture_id is not null,
               'scores_shown', s.shown,
               'ours', case when s.shown then coalesce(e.our_score, (select case when ce.id = f.home_entry_id then f.home_score else f.away_score end
                                                                        from public.fixtures f join public.competition_entries ce on ce.team_id = e.team_id and ce.competition_id = f.competition_id
                                                                       where f.id = e.fixture_id)) end,
               'theirs', case when s.shown then coalesce(e.their_score, (select case when ce.id = f.home_entry_id then f.away_score else f.home_score end
                                                                            from public.fixtures f join public.competition_entries ce on ce.team_id = e.team_id and ce.competition_id = f.competition_id
                                                                           where f.id = e.fixture_id)) end,
               'manager', (select string_agg(p.full_name, ', ' order by p.full_name) from public.club_roles r join public.profiles p on p.id = r.profile_id where r.team_id = t.id and r.role = 'team_manager'),
               'coaches', (select string_agg(p.full_name, ', ' order by p.full_name) from public.team_members tm join public.profiles p on p.id = tm.profile_id where tm.team_id = t.id and tm.role = 'coach'),
               'yes', (select count(*) from public.event_rsvps r where r.event_id = e.id and r.status = 'yes'),
               'squad', (select count(*) from public.players pl where pl.team_id = t.id),
               'min_players', m.min_players,
               'referee', case when e.fixture_id is null then null
                               when exists (select 1 from public.referee_appointments ra where ra.fixture_id = e.fixture_id and ra.role = 'referee' and ra.status = 'accepted') then 'appointed'
                               else 'none' end,
               'sheet', case when e.fixture_id is null then null
                             else exists (select 1 from public.match_sheets ms join public.competition_entries ce on ce.id = ms.entry_id
                                           where ms.fixture_id = e.fixture_id and ce.team_id = t.id) end
             ) as g
        from public.events e
        join public.teams t on t.id = e.team_id
        cross join lateral (select (e.fixture_id is not null or app_private.scores_shown(t.id)) as shown) s
        cross join lateral (select case when app_private.age_number(t.age_group) <= 7 then 4
                                        when app_private.age_number(t.age_group) <= 9 then 7
                                        when app_private.age_number(t.age_group) <= 11 then 9
                                        else 11 end as min_players) m
       where e.academy_id = p_academy and e.type in ('match', 'tournament') and e.private_to is null
         and e.starts_at >= v_from and e.starts_at < v_to
    ) x;

  select min((e.starts_at at time zone v_tz)::date) into v_next
    from public.events e
   where e.academy_id = p_academy and e.type in ('match', 'tournament') and e.private_to is null
     and e.cancelled_at is null and e.starts_at >= v_to and e.starts_at < v_to + interval '21 days';

  return jsonb_build_object(
    'date', v_day,
    'next_with_games', v_next,
    'games', v_games,
    'counts', jsonb_build_object(
      'games', jsonb_array_length(v_games),
      'off', (select count(*) from jsonb_array_elements(v_games) g where (g->>'off')::boolean),
      'live', (select count(*) from jsonb_array_elements(v_games) g where (g->>'kicked_off')::boolean and not (g->>'finished')::boolean and not (g->>'off')::boolean),
      'final', (select count(*) from jsonb_array_elements(v_games) g where (g->>'finished')::boolean),
      'nobody_in_charge', (select count(*) from jsonb_array_elements(v_games) g where g->>'manager' is null and g->>'coaches' is null and not (g->>'off')::boolean),
      'short', (select count(*) from jsonb_array_elements(v_games) g where (g->>'yes')::int < (g->>'min_players')::int and not (g->>'off')::boolean and not (g->>'finished')::boolean),
      'no_referee', (select count(*) from jsonb_array_elements(v_games) g where g->>'referee' = 'none' and not (g->>'off')::boolean),
      'sheets_missing', (select count(*) from jsonb_array_elements(v_games) g where g->>'sheet' = 'false' and not (g->>'off')::boolean)));
end;
$fn$;
revoke execute on function public.saturday_view(uuid, date) from public, anon;
grant execute on function public.saturday_view(uuid, date) to authenticated;

-- The imported division table: a MiniRoos squad has none to show.
create or replace function public.division_table(p_team uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_team  public.teams;
  v_me    text;
  v_div   text;
  v_names text[];
begin
  select * into v_team from public.teams where id = p_team;
  if v_team.id is null or not (coalesce(app_private.is_team_member(p_team), false) or coalesce(app_private.is_team_coach(p_team), false)) then
    raise exception 'that squad''s table is its own people''s' using errcode = '42501';
  end if;
  -- 0251: MiniRoos — no ladder.
  if not app_private.scores_shown(p_team) then
    return jsonb_build_object('team', jsonb_build_object('id', v_team.id, 'name', v_team.name),
                              'reason', 'miniroos', 'rows', '[]'::jsonb, 'games', 0);
  end if;
  if nullif(btrim(coalesce(v_team.external_ref, '')), '') is null then
    return jsonb_build_object('team', jsonb_build_object('id', v_team.id, 'name', v_team.name),
                              'reason', 'no_league_name', 'rows', '[]'::jsonb, 'games', 0);
  end if;
  v_me := app_private.team_key(v_team.external_ref);

  select g.division into v_div from public.imported_games g
   where g.academy_id = v_team.academy_id and g.season = v_team.season and g.division is not null
     and (app_private.team_key(g.home) = v_me or app_private.team_key(g.away) = v_me)
   order by g.imported_at desc
   limit 1;

  with recursive games as (
    select app_private.team_key(g.home) as h, app_private.team_key(g.away) as a
      from public.imported_games g
     where g.academy_id = v_team.academy_id and g.season = v_team.season
       and (v_div is null or g.division is not distinct from v_div)
  ), reach as (
    select v_me as k
    union
    select case when g.h = r.k then g.a else g.h end
      from reach r
      join games g on g.h = r.k or g.a = r.k
  )
  select array_agg(k) into v_names from reach;

  return jsonb_build_object(
    'team', jsonb_build_object('id', v_team.id, 'name', v_team.name, 'league_name', v_team.external_ref),
    'division', v_div,
    'season', v_team.season,
    'updated_at', (select max(g.imported_at) from public.imported_games g
                    where g.academy_id = v_team.academy_id and g.season = v_team.season
                      and app_private.team_key(g.home) = any (v_names) and app_private.team_key(g.away) = any (v_names)),
    'games', (select count(*) from public.imported_games g
               where g.academy_id = v_team.academy_id and g.season = v_team.season and g.home_score is not null
                 and app_private.team_key(g.home) = any (v_names) and app_private.team_key(g.away) = any (v_names)),
    'rows', coalesce((
      with sides as (
        select app_private.team_key(g.home) as k, g.home as name, g.home_score as gf, g.away_score as ga
          from public.imported_games g
         where g.academy_id = v_team.academy_id and g.season = v_team.season
           and app_private.team_key(g.home) = any (v_names) and app_private.team_key(g.away) = any (v_names)
        union all
        select app_private.team_key(g.away), g.away, g.away_score, g.home_score
          from public.imported_games g
         where g.academy_id = v_team.academy_id and g.season = v_team.season
           and app_private.team_key(g.home) = any (v_names) and app_private.team_key(g.away) = any (v_names)
      ), tally as (
        select s.k, min(s.name) as name,
               count(*) filter (where s.gf is not null) as p,
               count(*) filter (where s.gf > s.ga) as w,
               count(*) filter (where s.gf = s.ga) as d,
               count(*) filter (where s.gf < s.ga) as l,
               coalesce(sum(s.gf), 0) as gf,
               coalesce(sum(s.ga), 0) as ga
          from sides s
         group by s.k
      )
      select jsonb_agg(jsonb_build_object(
               'team', t.name, 'ours', t.k = v_me,
               'p', t.p, 'w', t.w, 'd', t.d, 'l', t.l, 'gf', t.gf, 'ga', t.ga,
               'gd', t.gf - t.ga, 'pts', t.w * 3 + t.d)
             order by (t.w * 3 + t.d) desc, (t.gf - t.ga) desc, t.gf desc, t.name)
        from tally t
    ), '[]'::jsonb));
end;
$fn$;
