-- 0260: the ladder breakdown — tap a row to see every point
--
-- Part C (Joey, 10 Nov 2026), item 6: a ladder breakdown — tap a row to see
-- every point: results, adjustments, forfeits. One reader does the sum the
-- way app_private.ladder does it (0158: games final or forfeit with a score
-- on them, the division's points for a win, a draw and a loss, the
-- adjustments with their reasons), game by game, so what the row says and
-- what the breakdown adds up to are the same number by construction.
--
-- Three doors: the participants' (a club in the competition, the league),
-- the public match centre's (a published competition whose division shows
-- scores and a ladder — teams and scores only, as the centre is), and the
-- switch: the organiser's `ladder_breakdown` off, and every door answers
-- null, so nothing appears.

create or replace function app_private.ladder_breakdown(p_competition uuid, p_division text, p_entry uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  e        public.competition_entries;
  r        record;
  v_games  jsonb;
  v_adj    jsonb;
  v_from_games integer;
  v_from_adj   integer;
  v_played integer; v_won integer; v_drawn integer; v_lost integer; v_gf integer; v_ga integer;
begin
  select * into e from public.competition_entries where id = p_entry and competition_id = p_competition and division = p_division;
  if e.id is null then
    return null;
  end if;
  select * into r from app_private.division_rules(p_competition, p_division);

  with played as (
    select f.id, f.round, f.starts_at, f.stage, f.status, true as home,
           f.home_score as ours, f.away_score as theirs, away.display_name as opponent
      from public.fixtures f
      left join public.competition_entries away on away.id = f.away_entry_id
     where f.competition_id = p_competition and f.division = p_division
       and f.home_entry_id = p_entry and f.status in ('final', 'forfeit') and f.home_score is not null
    union all
    select f.id, f.round, f.starts_at, f.stage, f.status, false,
           f.away_score, f.home_score, home.display_name
      from public.fixtures f
      left join public.competition_entries home on home.id = f.home_entry_id
     where f.competition_id = p_competition and f.division = p_division
       and f.away_entry_id = p_entry and f.status in ('final', 'forfeit') and f.away_score is not null
  ),
  scored as (
    select p.*,
           case when p.ours > p.theirs then 'W' when p.ours = p.theirs then 'D' else 'L' end as result,
           case when p.ours > p.theirs then r.points_win when p.ours = p.theirs then r.points_draw else r.points_loss end as points
      from played p
  )
  select coalesce(jsonb_agg(jsonb_build_object(
             'fixture_id', s.id, 'round', s.round, 'starts_at', s.starts_at, 'stage', s.stage,
             'home', s.home, 'opponent', coalesce(s.opponent, 'Bye'),
             'ours', s.ours, 'theirs', s.theirs, 'result', s.result, 'points', s.points,
             'forfeit', s.status = 'forfeit') order by s.starts_at nulls last, s.round), '[]'::jsonb),
         coalesce(sum(s.points), 0)::integer, count(*)::integer,
         count(*) filter (where s.result = 'W')::integer, count(*) filter (where s.result = 'D')::integer, count(*) filter (where s.result = 'L')::integer,
         coalesce(sum(s.ours), 0)::integer, coalesce(sum(s.theirs), 0)::integer
    into v_games, v_from_games, v_played, v_won, v_drawn, v_lost, v_gf, v_ga
    from scored s;

  select coalesce(jsonb_agg(jsonb_build_object('points', a.points, 'reason', a.reason, 'made_at', a.made_at) order by a.made_at), '[]'::jsonb),
         coalesce(sum(a.points), 0)::integer
    into v_adj, v_from_adj
    from public.ladder_adjustments a
   where a.competition_id = p_competition and a.division = p_division and a.entry_id = p_entry;

  return jsonb_build_object(
    'entry_id', e.id, 'team_name', e.display_name, 'division', p_division, 'group_label', e.group_label,
    'rules', jsonb_build_object('win', r.points_win, 'draw', r.points_draw, 'loss', r.points_loss, 'tie_break', r.tie_break),
    'games', v_games, 'adjustments', v_adj,
    'totals', jsonb_build_object(
      'played', v_played, 'won', v_won, 'drawn', v_drawn, 'lost', v_lost,
      'goals_for', v_gf, 'goals_against', v_ga, 'goal_difference', v_gf - v_ga,
      'from_games', v_from_games, 'from_adjustments', v_from_adj, 'points', v_from_games + v_from_adj));
end;
$fn$;
revoke execute on function app_private.ladder_breakdown(uuid, text, uuid) from public, anon, authenticated;

-- The participants' door.
create or replace function public.competition_ladder_breakdown(p_competition uuid, p_division text, p_entry uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_org uuid;
begin
  if auth.uid() is null or not app_private.is_competition_participant(p_competition) then
    return null;
  end if;
  select organiser_id into v_org from public.competitions where id = p_competition;
  if not app_private.feature_on(v_org, 'ladder_breakdown') then
    return null;
  end if;
  return app_private.ladder_breakdown(p_competition, p_division, p_entry);
end;
$fn$;
revoke execute on function public.competition_ladder_breakdown(uuid, text, uuid) from public, anon;
grant execute on function public.competition_ladder_breakdown(uuid, text, uuid) to authenticated;

-- The public door: a published competition, a division that shows scores
-- and a ladder; teams and scores, nobody's name.
create or replace function public.public_ladder_breakdown(p_slug text, p_entry uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_comp public.competitions;
  e      public.competition_entries;
  r      record;
begin
  select * into v_comp from public.competitions
   where public_slug = p_slug and published_at is not null and public_slug is not null;
  if v_comp.id is null then
    return null;
  end if;
  if not app_private.feature_on(v_comp.organiser_id, 'ladder_breakdown') then
    return null;
  end if;
  select * into e from public.competition_entries where id = p_entry and competition_id = v_comp.id;
  if e.id is null or e.division is null then
    return null;
  end if;
  select * into r from app_private.division_rules(v_comp.id, e.division);
  if not (r.ladder_enabled and r.scores_public) then
    return null;
  end if;
  return app_private.ladder_breakdown(v_comp.id, e.division, e.id);
end;
$fn$;
revoke all on function public.public_ladder_breakdown(text, uuid) from public;
grant execute on function public.public_ladder_breakdown(text, uuid) to anon, authenticated;

-- What the public page may offer, by the organiser's switches — read once
-- with the page, so a switched-off breakdown shows no tap at all.
create or replace function public.public_switches(p_slug text)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_org uuid;
begin
  select organiser_id into v_org from public.competitions
   where public_slug = p_slug and published_at is not null and public_slug is not null;
  if v_org is null then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('ladder_breakdown', app_private.feature_on(v_org, 'ladder_breakdown'));
end;
$fn$;
revoke all on function public.public_switches(text) from public;
grant execute on function public.public_switches(text) to anon, authenticated;

-- The two public doors on the stranger's allow-list (0185), with why.
insert into app_private.anon_callable (proname, why) values
  ('public_ladder_breakdown', 'the public match centre''s ladder breakdown: a published competition''s games, points and adjustments — teams and scores, nobody''s name'),
  ('public_switches', 'what the organiser''s switches let the public page offer — a boolean or two, nothing about anyone')
on conflict (proname) do update set why = excluded.why;
