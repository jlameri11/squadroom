-- 0289 — a team manager's past seasons (found by the simulation's Season 5
-- screens, 19 Nov 2026).
--
-- A squad's manager holds a club role on the squad (0236), not a membership
-- row, so my_seasons and season_fixtures (0279) — which asked "staff, member
-- or a parent of a player" — showed them no past season at all: Fixtures had
-- no 2027 chip for the person who ran the squad all year. Both now count a
-- club role on the squad (team manager, coordinator) the same as a membership.

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
                -- 0289: the squad's manager or coordinator (a club role on the squad, 0236), who never had a membership row
                or exists (select 1 from public.club_roles cr where cr.team_id = t.id and cr.profile_id = v_me)
                or exists (select 1 from public.players pl join public.player_guardians g on g.player_id = pl.id where g.profile_id = v_me and pl.team_id = t.id))
         group by t.season
      ) s), '[]'::jsonb);
end;
$$;

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
                -- 0289: the squad's manager or coordinator (a club role on the squad, 0236), who never had a membership row
                or exists (select 1 from public.club_roles cr where cr.team_id = t.id and cr.profile_id = v_me)
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
                -- 0289: the squad's manager or coordinator (a club role on the squad, 0236), who never had a membership row
                or exists (select 1 from public.club_roles cr where cr.team_id = t.id and cr.profile_id = v_me)
              or exists (select 1 from public.players pl join public.player_guardians g on g.player_id = pl.id where g.profile_id = v_me and pl.team_id = t.id))), '[]'::jsonb));
end;
$$;
