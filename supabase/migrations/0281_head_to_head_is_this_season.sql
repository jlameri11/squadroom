-- 0281 — head to head is this season's (Joey, 15 Nov 2026, replacing the
-- cross-season rule of 0279 the same day). On a match, head to head shows
-- ONLY the two teams' meetings in the season the game belongs to: a summary
-- (played, each side's wins, draws, goals) and the list of those meetings,
-- each a tap away. Past seasons stay reachable through the season switcher
-- and are never mixed in. Hidden scores stay hidden; no player's name.
create or replace function app_private.meetings(p_fixture uuid)
returns table(fixture_id uuid, competition_id uuid, competition text, season text, public_slug text, round text, stage text, starts_at timestamptz,
              venue text, home text, away text, home_score integer, away_score integer, pens_home integer, pens_away integer, scores_hidden boolean,
              status text, home_is_first boolean, this_season boolean)
language sql stable security definer set search_path = public as $$
  with f as (select fx.* from public.fixtures fx where fx.id = p_fixture)
  select g.id, g.competition_id, c.name, c.season, c.public_slug, g.round, g.stage, g.starts_at,
         coalesce(v.name, g.venue_label) || coalesce(' · ' || g.field_label, ''),
         he.display_name, ae.display_name,
         case when r.scores_public then g.home_score end, case when r.scores_public then g.away_score end,
         case when r.scores_public then g.pens_home end, case when r.scores_public then g.pens_away end,
         not r.scores_public,
         g.status::text,
         g.home_entry_id = f.home_entry_id,
         true
    from f
    join public.fixtures g
      on g.competition_id = f.competition_id and g.id <> f.id
     and ((g.home_entry_id = f.home_entry_id and g.away_entry_id = f.away_entry_id)
       or (g.home_entry_id = f.away_entry_id and g.away_entry_id = f.home_entry_id))
    join public.competitions c on c.id = g.competition_id
    left join public.venues v on v.id = g.venue_id
    left join public.competition_entries he on he.id = g.home_entry_id
    left join public.competition_entries ae on ae.id = g.away_entry_id
    cross join lateral app_private.division_rules(g.competition_id, g.division) r
   where f.home_entry_id is not null and f.away_entry_id is not null
     and g.status in ('final', 'forfeit', 'scheduled', 'in_progress', 'postponed')
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
    'season', (select c.season from public.fixtures f join public.competitions c on c.id = f.competition_id where f.id = p_fixture),
    'competition', (select c.name from public.fixtures f join public.competitions c on c.id = f.competition_id where f.id = p_fixture),
    'summary', jsonb_build_object(
      'played', (select count(*) from played),
      'first_wins', (select count(*) from scored where not scores_hidden and us > them),
      'second_wins', (select count(*) from scored where not scores_hidden and us < them),
      'draws', (select count(*) from scored where not scores_hidden and us = them),
      'first_goals', (select coalesce(sum(us), 0) from scored where not scores_hidden),
      'second_goals', (select coalesce(sum(them), 0) from scored where not scores_hidden),
      'hidden', (select count(*) from scored where scores_hidden)),
    -- This season's meetings, newest first: played ones and the ones still to come.
    'meetings', coalesce((select jsonb_agg(to_jsonb(x) order by x.starts_at desc) from m x), '[]'::jsonb),
    'last5', coalesce((select jsonb_agg(to_jsonb(x) order by x.starts_at desc) from (select * from played order by starts_at desc limit 5) x), '[]'::jsonb));
$$;
