-- 0279 — past seasons are always visitable; head to head (Joey, 15 Nov 2026).
--
-- 1. A finished season is read-only and nothing in it is ever deleted:
--    `end_season` closes a competition; from then on its fixtures, sheets,
--    events, appointments, entries, squads and adjustments refuse every
--    write and every delete, and the competition itself cannot be deleted.
--    `reopen_season` lifts it (the organiser's, for a correction).
-- 2. A season switcher: `competition_seasons` (in the app) and
--    `public_competition_seasons` (the match centre) list the organiser's
--    seasons, newest first. A new season remembers the one before it
--    (`previous_competition_id`) when made with `new_season_from`.
-- 3. A team's history: `team_history` follows the rollover lineage
--    (teams.rolled_from, R-19) in both directions and gives each season's
--    final position, W-D-L, goals and points, and how the finals went.
--    `my_seasons` and `season_fixtures` give a family's Fixtures a past
--    season of their squads' games, results included.
-- 4. Head to head on every game: `head_to_head` (participants) and
--    `public_head_to_head` (the match centre) — this season's meetings, then
--    every previous season's between the same two teams (by lineage, or the
--    same club in the same age group), a summary and the last five. Hidden
--    scores stay hidden (played, no score); no player's name is in it.

-- --------------------------------------------- 1. a finished season is read-only
alter table public.competitions
  add column if not exists previous_competition_id uuid references public.competitions(id) on delete set null,
  add column if not exists ended_at timestamptz;

create or replace function app_private.season_is_over(p_competition uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select c.status = 'ended' from public.competitions c where c.id = p_competition), false);
$$;

create or replace function public.end_season(p_competition uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c public.competitions;
  v_open integer;
begin
  select * into c from public.competitions where id = p_competition;
  if c.id is null or not coalesce(app_private.may_run(p_competition, 'competition'), false) then
    raise exception 'only the league ends a season' using errcode = '42501';
  end if;
  if c.status = 'ended' then
    return jsonb_build_object('status', 'ended', 'ended_at', c.ended_at);
  end if;
  select count(*) into v_open from public.fixtures f
   where f.competition_id = p_competition and f.status in ('scheduled', 'in_progress', 'postponed');
  update public.competitions
     set status = 'ended', ended_at = now(), ends_on = coalesce(ends_on, (now() at time zone app_private.competition_tz(p_competition))::date), entries_open = false
   where id = p_competition;
  perform app_private.log_activity(c.organiser_id, 'season.ended', 'competition', c.id, c.name, jsonb_build_object('open_games', v_open));
  return jsonb_build_object('status', 'ended', 'open_games', v_open);
end;
$$;
revoke execute on function public.end_season(uuid) from public, anon;
grant execute on function public.end_season(uuid) to authenticated, service_role;

create or replace function public.reopen_season(p_competition uuid, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  c public.competitions;
begin
  select * into c from public.competitions where id = p_competition;
  if c.id is null or not coalesce(app_private.may_run(p_competition, 'competition'), false) then
    raise exception 'only the league reopens a season' using errcode = '42501';
  end if;
  update public.competitions set status = 'active', ended_at = null where id = p_competition;
  perform app_private.log_activity(c.organiser_id, 'season.reopened', 'competition', c.id, c.name, jsonb_build_object('note', p_note));
end;
$$;
revoke execute on function public.reopen_season(uuid, text) from public, anon;
grant execute on function public.reopen_season(uuid, text) to authenticated, service_role;

-- Every write to a finished season is refused at the table, whoever asks.
create or replace function app_private.refuse_when_season_over()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_comp uuid;
  v_row  record;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  if tg_table_name = 'match_sheet_players' then
    select s.competition_id into v_comp from public.match_sheets s where s.id = v_row.sheet_id;
  elsif tg_table_name = 'competitions' then
    v_comp := v_row.id;
  else
    v_comp := v_row.competition_id;
  end if;
  if v_comp is not null and app_private.season_is_over(v_comp) then
    if tg_table_name = 'competitions' then
      if tg_op = 'DELETE' then
        raise exception 'a finished season is kept for good — it cannot be deleted' using errcode = '42501';
      end if;
      -- The competition row itself may still be reopened or renamed; only the
      -- status flip from ended is allowed to change while ended.
      if new.status = 'ended' and (old.name is distinct from new.name or old.season is distinct from new.season) then
        raise exception 'the season is over — reopen it to change it' using errcode = '42501';
      end if;
      return new;
    end if;
    raise exception 'the season is over — its games, results and tables are kept as they finished; the league can reopen it for a correction' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['fixtures', 'match_sheets', 'match_sheet_players', 'match_events', 'ladder_adjustments', 'referee_appointments', 'competition_entries', 'entry_squads', 'match_corrections', 'forfeit_requests', 'fixture_change_requests'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_season_over', t);
    execute format('create trigger %I before insert or update or delete on public.%I for each row execute function app_private.refuse_when_season_over()', t || '_season_over', t);
  end loop;
end $$;
drop trigger if exists competitions_season_over on public.competitions;
create trigger competitions_season_over before update or delete on public.competitions
  for each row execute function app_private.refuse_when_season_over();

-- ------------------------------------------------- 2. the seasons of a league
create or replace function public.competition_seasons(p_competition uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not app_private.is_competition_participant(p_competition) then null else coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', c2.id, 'name', c2.name, 'season', c2.season, 'status', c2.status,
             'starts_on', c2.starts_on, 'ends_on', c2.ends_on, 'public_slug', c2.public_slug,
             'current', c2.id = p_competition,
             'mine', app_private.is_competition_participant(c2.id))
           order by c2.starts_on desc nulls last, c2.created_at desc)
      from public.competitions c
      join public.competitions c2 on c2.organiser_id = c.organiser_id and c2.type = c.type
     where c.id = p_competition), '[]'::jsonb) end;
$$;
revoke execute on function public.competition_seasons(uuid) from public, anon;
grant execute on function public.competition_seasons(uuid) to authenticated, service_role;

create or replace function public.public_competition_seasons(p_slug text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_agg(jsonb_build_object(
             'name', c2.name, 'season', c2.season, 'slug', c2.public_slug, 'status', c2.status,
             'starts_on', c2.starts_on, 'current', c2.public_slug = p_slug)
           order by c2.starts_on desc nulls last, c2.created_at desc)
      from public.competitions c
      join public.competitions c2 on c2.organiser_id = c.organiser_id and c2.type = c.type
     where c.public_slug = p_slug and c.published_at is not null
       and c2.public_slug is not null and c2.published_at is not null), '[]'::jsonb);
$$;
grant execute on function public.public_competition_seasons(text) to anon, authenticated, service_role;

-- A new season from the last: the divisions and their rules, the fees, the
-- referee fees and the discipline rules copied; the clubs invited again; an
-- entry for each team that rolled over (teams.rolled_from), under its new
-- name, in the same division.
create or replace function public.new_season_from(p_competition uuid, p_name text, p_season text, p_starts_on date, p_ends_on date default null, p_slug text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c      public.competitions;
  v_new  uuid;
  v_entries integer := 0;
begin
  select * into c from public.competitions where id = p_competition;
  if c.id is null or not coalesce(app_private.may_run(p_competition, 'competition'), false) then
    raise exception 'only the league starts a new season' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_name, ''))) = 0 then
    raise exception 'the new season needs a name' using errcode = '22023';
  end if;
  insert into public.competitions (organiser_id, name, type, season, status, starts_on, ends_on, created_by, mode, visibility, public_slug, published_at, entries_open, previous_competition_id,
                                   late_decline_hours, self_appoint, self_appoint_grades, club_allocate_hours)
  values (c.organiser_id, btrim(p_name), c.type, p_season, 'active', p_starts_on, p_ends_on, auth.uid(), c.mode, c.visibility,
          nullif(btrim(coalesce(p_slug, '')), ''), case when nullif(btrim(coalesce(p_slug, '')), '') is not null then now() end, true, c.id,
          c.late_decline_hours, c.self_appoint, c.self_appoint_grades, c.club_allocate_hours)
  returning id into v_new;
  insert into public.competition_divisions (competition_id, division, age_group, scores_public, ladder_enabled, points_win, points_draw, points_loss, tie_break, match_length_mins, squad_size_max, grading_note, rank, allow_playing_up, forfeit_score, sheet_lock_mins, finals_min_games, borrow_cap, pitch_size, squad_size_min)
  select v_new, d.division, d.age_group, d.scores_public, d.ladder_enabled, d.points_win, d.points_draw, d.points_loss, d.tie_break, d.match_length_mins, d.squad_size_max, d.grading_note, d.rank, d.allow_playing_up, d.forfeit_score, d.sheet_lock_mins, d.finals_min_games, d.borrow_cap, d.pitch_size, d.squad_size_min
    from public.competition_divisions d where d.competition_id = c.id;
  insert into public.competition_fees (competition_id, division, fee_cents, instructions)
  select v_new, f.division, f.fee_cents, f.instructions from public.competition_fees f where f.competition_id = c.id;
  insert into public.competition_referee_fees (competition_id, role, fee_cents)
  select v_new, r.role, r.fee_cents from public.competition_referee_fees r where r.competition_id = c.id;
  insert into public.competition_discipline_rules (competition_id, yellows_per_suspension, games_per_yellow_suspension, games_per_red, blue_cards, blue_minutes)
  select v_new, r.yellows_per_suspension, r.games_per_yellow_suspension, r.games_per_red, r.blue_cards, r.blue_minutes
    from public.competition_discipline_rules r where r.competition_id = c.id;
  insert into public.competition_clubs (competition_id, academy_id, status, invited_by, joined_at)
  select v_new, cc.academy_id, cc.status, auth.uid(), now() from public.competition_clubs cc where cc.competition_id = c.id and cc.status = 'active';
  -- The teams that rolled over keep their place, under their new name.
  insert into public.competition_entries (competition_id, academy_id, team_id, display_name, division, nominated_at)
  select v_new, e.academy_id, nt.id,
         (select a.name from public.academies a where a.id = e.academy_id) || ' ' || nt.name,
         e.division, now()
    from public.competition_entries e
    join public.teams nt on nt.rolled_from = e.team_id and nt.status = 'active'
   where e.competition_id = c.id and e.team_id is not null and e.withdrawn_at is null;
  get diagnostics v_entries = row_count;
  perform app_private.log_activity(c.organiser_id, 'season.started', 'competition', v_new, btrim(p_name), jsonb_build_object('from', c.id, 'entries', v_entries));
  return jsonb_build_object('competition_id', v_new, 'entries', v_entries);
end;
$$;
revoke execute on function public.new_season_from(uuid, text, text, date, date, text) from public, anon;
grant execute on function public.new_season_from(uuid, text, text, date, date, text) to authenticated, service_role;

-- --------------------------------------------------------- 3. a team's history
create or replace function app_private.team_lineage(p_team uuid)
returns setof uuid
language sql stable security definer set search_path = public as $$
  with recursive back as (
    select t.id, t.rolled_from from public.teams t where t.id = p_team
    union
    select t.id, t.rolled_from from public.teams t join back b on t.id = b.rolled_from
  ), fwd as (
    select t.id from public.teams t where t.id = p_team
    union
    select t.id from public.teams t join fwd f on t.rolled_from = f.id
  )
  select id from back union select id from fwd;
$$;

-- How a team's finals went in a competition: champions, runners-up, a semi-final, or nothing.
create or replace function app_private.finals_outcome(p_competition uuid, p_entry uuid)
returns text
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.fixtures f where f.competition_id = p_competition and f.stage = 'final' and f.round = 'Final' and f.status in ('final', 'forfeit')
                   and ((f.home_entry_id = p_entry and (f.home_score > f.away_score or (f.home_score = f.away_score and f.pens_home > f.pens_away)))
                     or (f.away_entry_id = p_entry and (f.away_score > f.home_score or (f.home_score = f.away_score and f.pens_away > f.pens_home))))) then 'Champions'
    when exists (select 1 from public.fixtures f where f.competition_id = p_competition and f.stage = 'final' and f.round = 'Final' and f.status in ('final', 'forfeit')
                   and p_entry in (f.home_entry_id, f.away_entry_id)) then 'Runners-up'
    when exists (select 1 from public.fixtures f where f.competition_id = p_competition and f.stage = 'final' and f.round like 'Semi%'
                   and p_entry in (f.home_entry_id, f.away_entry_id)) then 'Semi-finalist'
  end;
$$;

create or replace function public.team_history(p_team uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_academy uuid;
  v_me uuid := auth.uid();
begin
  select t.academy_id into v_academy from public.teams t where t.id = p_team;
  if v_academy is null then return null; end if;
  if not (coalesce(app_private.is_academy_staff(v_academy), false)
          or exists (select 1 from public.team_members tm where tm.profile_id = v_me and tm.team_id in (select app_private.team_lineage(p_team)))
          or exists (select 1 from public.players pl join public.player_guardians g on g.player_id = pl.id
                      where g.profile_id = v_me and pl.team_id in (select app_private.team_lineage(p_team)))) then
    return null;
  end if;
  return jsonb_build_object(
    'team_id', p_team,
    'lineage', (select jsonb_agg(jsonb_build_object('team_id', t.id, 'name', t.name, 'age_group', t.age_group, 'season', t.season, 'status', t.status) order by t.season desc, t.name)
                  from public.teams t where t.id in (select app_private.team_lineage(p_team))),
    'seasons', coalesce((
      select jsonb_agg(jsonb_build_object(
               'competition_id', c.id, 'competition', c.name, 'season', coalesce(c.season, t.season), 'status', c.status,
               'public_slug', c.public_slug, 'entry_id', e.id, 'team_id', t.id, 'team', t.name, 'division', e.division,
               'position', case when r.ladder_enabled then x.pos end,
               'teams', x.n,
               'played', x.played, 'won', case when r.scores_public then x.won end, 'drawn', case when r.scores_public then x.drawn end,
               'lost', case when r.scores_public then x.lost end,
               'goals_for', case when r.scores_public then x.gf end, 'goals_against', case when r.scores_public then x.ga end,
               'points', case when r.ladder_enabled then x.points end,
               'finals', app_private.finals_outcome(c.id, e.id),
               'withdrawn', e.withdrawn_at is not null)
             order by c.starts_on desc nulls last, c.created_at desc)
        from public.competition_entries e
        join public.teams t on t.id = e.team_id
        join public.competitions c on c.id = e.competition_id
        cross join lateral app_private.division_rules(c.id, e.division) r
        left join lateral (
          select l.played, l.won, l.drawn, l.lost, l.goals_for as gf, l.goals_against as ga, l.points, l.pos, l.n
            from (select ld.*, row_number() over () as pos, count(*) over () as n from app_private.ladder(c.id, e.division) ld) l
           where l.entry_id = e.id
        ) x on true
       where e.team_id in (select app_private.team_lineage(p_team))), '[]'::jsonb));
end;
$$;
revoke execute on function public.team_history(uuid) from public, anon;
grant execute on function public.team_history(uuid) to authenticated, service_role;

-- A family's seasons, and a past season's games with their results.
create or replace function public.my_seasons(p_academy uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_academy uuid := app_private.my_academy(p_academy);
  v_me uuid := auth.uid();
begin
  if v_academy is null or v_me is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('season', s.season, 'teams', s.teams, 'current', s.season = (select max(t2.season) from public.teams t2 where t2.academy_id = v_academy and t2.status = 'active')) order by s.season desc)
      from (
        select t.season, count(*)::int as teams
          from public.teams t
         where t.academy_id = v_academy and t.season is not null
           and (coalesce(app_private.is_academy_staff(v_academy), false)
                or exists (select 1 from public.team_members tm where tm.team_id = t.id and tm.profile_id = v_me)
                or exists (select 1 from public.players pl join public.player_guardians g on g.player_id = pl.id where g.profile_id = v_me and pl.team_id = t.id))
         group by t.season
      ) s), '[]'::jsonb);
end;
$$;
revoke execute on function public.my_seasons(uuid) from public, anon;
grant execute on function public.my_seasons(uuid) to authenticated, service_role;

create or replace function public.season_fixtures(p_academy uuid, p_season text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_academy uuid := app_private.my_academy(p_academy);
  v_me uuid := auth.uid();
  v_staff boolean;
begin
  if v_academy is null or v_me is null then return null; end if;
  v_staff := coalesce(app_private.is_academy_coach(v_academy), false);
  return jsonb_build_object(
    'season', p_season,
    'teams', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'age_group', t.age_group, 'status', t.status) order by t.name)
                         from public.teams t where t.academy_id = v_academy and t.season = p_season
                          and (v_staff or exists (select 1 from public.team_members tm where tm.team_id = t.id and tm.profile_id = v_me)
                               or exists (select 1 from public.players pl join public.player_guardians g on g.player_id = pl.id where g.profile_id = v_me and pl.team_id = t.id))), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'team_id', e.team_id, 'team', t.name, 'type', e.type, 'title', e.title, 'starts_at', e.starts_at,
               'venue', e.venue, 'opponent', e.opponent, 'round', e.round, 'cancelled_at', e.cancelled_at, 'cancellation_reason', e.cancellation_reason,
               'competition_id', e.competition_id, 'fixture_id', e.fixture_id,
               'ours', case when f.id is null then e.our_score when r.scores_public then case when f.home_entry_id = ce.id then f.home_score else f.away_score end end,
               'theirs', case when f.id is null then e.their_score when r.scores_public then case when f.home_entry_id = ce.id then f.away_score else f.home_score end end,
               'scores_hidden', f.id is not null and not r.scores_public,
               'status', f.status)
             order by e.starts_at)
        from public.events e
        join public.teams t on t.id = e.team_id and t.academy_id = v_academy and t.season = p_season
        left join public.fixtures f on f.id = e.fixture_id
        left join public.competition_entries ce on ce.team_id = t.id and ce.competition_id = f.competition_id
        left join lateral app_private.division_rules(f.competition_id, f.division) r on f.id is not null
       where e.academy_id = v_academy and e.type in ('match', 'tournament') and e.private_to is null
         and (v_staff or exists (select 1 from public.team_members tm where tm.team_id = t.id and tm.profile_id = v_me)
              or exists (select 1 from public.players pl join public.player_guardians g on g.player_id = pl.id where g.profile_id = v_me and pl.team_id = t.id))), '[]'::jsonb));
end;
$$;
revoke execute on function public.season_fixtures(uuid, text) from public, anon;
grant execute on function public.season_fixtures(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------- 4. head to head
-- Every meeting of the two teams in a game, across the organiser's
-- competitions: the same team by lineage, or the same club in the same age
-- group when a team is only a name on a draw. Newest first.
create or replace function app_private.meetings(p_fixture uuid)
returns table(fixture_id uuid, competition_id uuid, competition text, season text, public_slug text, round text, stage text, starts_at timestamptz,
              venue text, home text, away text, home_score integer, away_score integer, pens_home integer, pens_away integer, scores_hidden boolean,
              status text, home_is_first boolean, this_season boolean)
language sql stable security definer set search_path = public as $$
  with f as (
    select fx.*, c.organiser_id,
           ha.team_id as home_team, ha.academy_id as home_club, aa.team_id as away_team, aa.academy_id as away_club,
           app_private.age_number(coalesce(d.age_group, substring(fx.division from '\mU\d{1,2}\M'))) as age
      from public.fixtures fx
      join public.competitions c on c.id = fx.competition_id
      left join public.competition_entries ha on ha.id = fx.home_entry_id
      left join public.competition_entries aa on aa.id = fx.away_entry_id
      left join public.competition_divisions d on d.competition_id = fx.competition_id and d.division = fx.division
     where fx.id = p_fixture
  ),
  a as (select app_private.team_lineage(home_team) as t from f where home_team is not null),
  b as (select app_private.team_lineage(away_team) as t from f where away_team is not null),
  side as (
    -- Which side of a past game is "the first team" (this game's home side).
    select g.id as gid,
           case
             when (ea.team_id in (select t from a)) or (ea.team_id is null and ea.academy_id = f.home_club) then 'home'
             when (ea.team_id in (select t from b)) or (ea.team_id is null and ea.academy_id = f.away_club) then 'away'
           end as home_entry_is,
           case
             when (eb.team_id in (select t from a)) or (eb.team_id is null and eb.academy_id = f.home_club) then 'home'
             when (eb.team_id in (select t from b)) or (eb.team_id is null and eb.academy_id = f.away_club) then 'away'
           end as away_entry_is
      from f
      join public.competitions c2 on c2.organiser_id = f.organiser_id
      join public.fixtures g on g.competition_id = c2.id and g.id <> f.id
      join public.competition_entries ea on ea.id = g.home_entry_id
      join public.competition_entries eb on eb.id = g.away_entry_id
      left join public.competition_divisions gd on gd.competition_id = g.competition_id and gd.division = g.division
     where g.status in ('final', 'forfeit', 'scheduled', 'in_progress')
       and (ea.academy_id in (f.home_club, f.away_club) and eb.academy_id in (f.home_club, f.away_club))
       and app_private.age_number(coalesce(gd.age_group, substring(g.division from '\mU\d{1,2}\M'))) is not distinct from f.age
       -- lineage decides when a team exists; otherwise same club, same age group
       and ((ea.team_id in (select t from a) and eb.team_id in (select t from b))
            or (ea.team_id in (select t from b) and eb.team_id in (select t from a))
            or (ea.team_id is null or eb.team_id is null or not exists (select 1 from a) or not exists (select 1 from b)))
  )
  select g.id, g.competition_id, c2.name, c2.season, c2.public_slug, g.round, g.stage, g.starts_at,
         coalesce(v.name, g.venue_label) || coalesce(' · ' || g.field_label, ''),
         he.display_name, ae.display_name,
         case when r.scores_public then g.home_score end, case when r.scores_public then g.away_score end,
         case when r.scores_public then g.pens_home end, case when r.scores_public then g.pens_away end,
         not r.scores_public,
         g.status::text,
         s.home_entry_is = 'home',
         g.competition_id = (select competition_id from f)
    from side s
    join public.fixtures g on g.id = s.gid
    join public.competitions c2 on c2.id = g.competition_id
    left join public.venues v on v.id = g.venue_id
    left join public.competition_entries he on he.id = g.home_entry_id
    left join public.competition_entries ae on ae.id = g.away_entry_id
    cross join lateral app_private.division_rules(g.competition_id, g.division) r
   where s.home_entry_is is not null and s.away_entry_is is not null and s.home_entry_is <> s.away_entry_is
   order by g.starts_at desc nulls last;
$$;

create or replace function app_private.head_to_head_json(p_fixture uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  with m as (select * from app_private.meetings(p_fixture)),
  played as (select * from m where status in ('final', 'forfeit')),
  -- Counted from the first team's side (this game's home team).
  scored as (
    select case when home_is_first then home_score else away_score end as us,
           case when home_is_first then away_score else home_score end as them,
           scores_hidden
      from played
  )
  select jsonb_build_object(
    'first', (select h.display_name from public.fixtures f join public.competition_entries h on h.id = f.home_entry_id where f.id = p_fixture),
    'second', (select a.display_name from public.fixtures f join public.competition_entries a on a.id = f.away_entry_id where f.id = p_fixture),
    'summary', jsonb_build_object(
      'played', (select count(*) from played),
      'first_wins', (select count(*) from scored where not scores_hidden and us > them),
      'second_wins', (select count(*) from scored where not scores_hidden and us < them),
      'draws', (select count(*) from scored where not scores_hidden and us = them),
      'first_goals', (select coalesce(sum(us), 0) from scored where not scores_hidden),
      'second_goals', (select coalesce(sum(them), 0) from scored where not scores_hidden),
      'hidden', (select count(*) from scored where scores_hidden)),
    'this_season', coalesce((select jsonb_agg(to_jsonb(x) order by x.starts_at desc) from m x where x.this_season), '[]'::jsonb),
    'previous', coalesce((select jsonb_agg(to_jsonb(x) order by x.starts_at desc) from m x where not x.this_season), '[]'::jsonb),
    'last5', coalesce((select jsonb_agg(to_jsonb(x) order by x.starts_at desc) from (select * from played order by starts_at desc limit 5) x), '[]'::jsonb));
$$;

create or replace function public.head_to_head(p_fixture uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from public.fixtures f where f.id = p_fixture and app_private.is_competition_participant(f.competition_id))
              then app_private.head_to_head_json(p_fixture) end;
$$;
revoke execute on function public.head_to_head(uuid) from public, anon;
grant execute on function public.head_to_head(uuid) to authenticated, service_role;

create or replace function public.public_head_to_head(p_slug text, p_fixture uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from public.fixtures f join public.competitions c on c.id = f.competition_id
                            where f.id = p_fixture and c.public_slug = p_slug and c.published_at is not null)
              then app_private.head_to_head_json(p_fixture) end;
$$;
grant execute on function public.public_head_to_head(text, uuid) to anon, authenticated, service_role;

-- The public game: one fixture of a published competition, for the match centre's game page.
create or replace function public.public_fixture(p_slug text, p_fixture uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select (
    select jsonb_build_object(
             'id', f.id, 'competition', c.name, 'season', c.season, 'organiser', (select a.name from public.academies a where a.id = c.organiser_id),
             'division', f.division, 'round', f.round, 'stage', f.stage, 'starts_at', f.starts_at,
             'venue', coalesce(v.name, f.venue_label), 'field', f.field_label, 'address', v.address,
             'home', h.display_name, 'away', a.display_name,
             'home_score', case when r.scores_public then f.home_score end, 'away_score', case when r.scores_public then f.away_score end,
             'pens_home', case when r.scores_public then f.pens_home end, 'pens_away', case when r.scores_public then f.pens_away end,
             'scores_hidden', not r.scores_public, 'status', f.status)
      from public.fixtures f
      join public.competitions c on c.id = f.competition_id
      left join public.venues v on v.id = f.venue_id
      left join public.competition_entries h on h.id = f.home_entry_id
      left join public.competition_entries a on a.id = f.away_entry_id
      cross join lateral app_private.division_rules(f.competition_id, f.division) r
     where f.id = p_fixture and c.public_slug = p_slug and c.published_at is not null);
$$;
grant execute on function public.public_fixture(text, uuid) to anon, authenticated, service_role;

insert into app_private.anon_callable (proname, why) values
  ('public_competition_seasons', 'the season switcher on a public match centre: a league''s published seasons — names and slugs, nothing about anyone'),
  ('public_head_to_head', 'head to head on a public match centre''s game: teams and scores (hidden where the division hides them), never a person'),
  ('public_fixture', 'one game of a published competition for its public page: teams, time, ground and score — nobody''s name')
on conflict (proname) do update set why = excluded.why;
