-- 0160: who scored.
--
-- L-12. Goals are recorded on the sheet (0151) against a player, and the
-- public page showed only the score. Top scorers are the one list a child
-- actually opens the page for, and Dribl's is empty for juniors because
-- Football NSW records goals for seniors only; ours is whatever the two
-- managers wrote down.
--
-- Named by the player's OWN club's rule (0093–0096): off, "Leo W.", or full
-- name, and a family's opt-out always wins. A club that publishes no names
-- has its scorers counted as "a <club> player" so the table still adds up
-- without naming anyone. Hidden-score divisions publish no scorers either.

create or replace function app_private.public_top_scorers(p_competition uuid, p_division text, p_limit integer default 10)
returns jsonb
language sql stable security definer set search_path = public as $fn$
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', coalesce(x.name, 'A ' || x.team || ' player'),
           'team', x.team,
           'goals', x.goals
         ) order by x.goals desc, x.name nulls last), '[]'::jsonb)
    from (
      select
        app_private.public_player_name(pl.full_name, pl.preferred_name, a.public_player_names, pl.public_name_hidden) as name,
        ce.display_name as team,
        count(*)::integer as goals
      from public.match_events e
      join public.fixtures f on f.id = e.fixture_id
      join public.competition_entries ce on ce.id = e.entry_id
      join public.players pl on pl.id = e.player_id
      join public.academies a on a.id = pl.academy_id
      where e.competition_id = p_competition
        and f.division = p_division
        and e.kind = 'goal'
        and f.status in ('final', 'forfeit')
      group by pl.id, pl.full_name, pl.preferred_name, a.public_player_names, pl.public_name_hidden, ce.display_name
      order by goals desc
      limit p_limit
    ) x;
$fn$;

-- public_match_centre: 0150's body plus 'top_scorers' per public division.
create or replace function public.public_match_centre(p_slug text)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_comp public.competitions;
begin
  select * into v_comp
    from public.competitions
   where public_slug = p_slug
     and published_at is not null
     and public_slug is not null;
  if v_comp.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'competition', jsonb_build_object(
      'name', v_comp.name,
      'season', v_comp.season,
      'organiser', (select a.name from public.academies a where a.id = v_comp.organiser_id)
    ),

    'fixtures', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', f.id,
               'starts_at', f.starts_at,
               'round', f.round,
               'division', f.division,
               'group_label', f.group_label,
               'venue', coalesce(v.name, f.venue_label),
               'field', f.field_label,
               'home', home.display_name,
               'away', away.display_name,
               'home_entry_id', f.home_entry_id,
               'away_entry_id', f.away_entry_id,
               'home_score', case when r.scores_public then f.home_score end,
               'away_score', case when r.scores_public then f.away_score end,
               'scores_hidden', not r.scores_public,
               'status', f.status
             ) order by f.starts_at nulls last, f.field_label)
        from public.fixtures f
        left join public.venues v on v.id = f.venue_id
        left join public.competition_entries home on home.id = f.home_entry_id
        left join public.competition_entries away on away.id = f.away_entry_id
        cross join lateral app_private.division_rules(v_comp.id, f.division) r
       where f.competition_id = v_comp.id
    ), '[]'::jsonb),

    'ladder', coalesce((
      select jsonb_object_agg(d.division, d.table)
        from (
          select e.division,
                 coalesce((
                   select jsonb_agg(to_jsonb(l))
                     from app_private.ladder(v_comp.id, e.division) l
                 ), '[]'::jsonb) as table
            from (select distinct division from public.competition_entries
                   where competition_id = v_comp.id and division is not null) e
            cross join lateral app_private.division_rules(v_comp.id, e.division) r
           where r.ladder_enabled and r.scores_public
        ) d
    ), '{}'::jsonb),

    'top_scorers', coalesce((
      select jsonb_object_agg(d.division, app_private.public_top_scorers(v_comp.id, d.division))
        from (select distinct division from public.competition_entries
               where competition_id = v_comp.id and division is not null) d
        cross join lateral app_private.division_rules(v_comp.id, d.division) r
       where r.scores_public
    ), '{}'::jsonb),

    'divisions', coalesce((
      select jsonb_agg(distinct e.division order by e.division)
        from public.competition_entries e
       where e.competition_id = v_comp.id and e.division is not null
    ), '[]'::jsonb),

    'squads', coalesce((
      select jsonb_object_agg(s.entry_id, s.players)
        from (
          select e.id as entry_id,
                 jsonb_agg(
                   jsonb_build_object('name', pub.name, 'number', pub.number)
                   order by pub.number nulls last, pub.name
                 ) as players
            from public.competition_entries e
            join lateral (
              select app_private.public_player_name(
                       pl.full_name, pl.preferred_name,
                       a.public_player_names, pl.public_name_hidden
                     ) as name,
                     (select sn.number
                        from public.squad_numbers sn
                       where sn.player_id = pl.id
                         and sn.season = coalesce(v_comp.season, sn.season)
                       limit 1) as number
                from public.players pl
                join public.academies a on a.id = pl.academy_id
               where pl.team_id = e.team_id
                 and pl.academy_id = e.academy_id
            ) pub on pub.name is not null
           where e.competition_id = v_comp.id
             and e.team_id is not null
           group by e.id
        ) s
    ), '{}'::jsonb)
  );
end;
$fn$;

revoke all on function public.public_match_centre(text) from public;
grant execute on function public.public_match_centre(text) to anon, authenticated;
