-- 0150: the public page names its squads again.
--
-- 0148 rewrote public_match_centre to honour a division's rules and, in
-- copying 0096's body, replaced the squads subquery with a call to a helper
-- that does not exist. Every public competition page then returned null —
-- "Not found" — for the minutes between the two migrations. Caught by the
-- division suite's public-page checks on their first run.
--
-- This is 0148's function with 0096's squads block restored verbatim: the
-- name through app_private.public_player_name (off / "Leo W." / full, and
-- a family's opt-out always wins), the number for the season.

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
