-- 0275 — home_competitions in one pass over the fixtures (the "Feels instant"
-- pass, measured: 0274's version was the slowest call on Home at 650 ms on
-- the dev data, because it counted a competition's fixtures twice — once for
-- the total, once for the played — each a scan under the caller's policies).
-- One lateral pass per competition does both counts; the divisions likewise.
-- Still SECURITY INVOKER: the caller's own policies decide what is seen.

create or replace function public.home_competitions(p_academy uuid default null)
returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc), '[]'::jsonb)
    from (
      select c.id, c.name, c.season, c.status, c.created_at,
             (select a.name from public.academies a where a.id = c.organiser_id) as organiser,
             coalesce(en.divisions, 0)::integer as divisions,
             coalesce(fx.played, 0)::integer as played,
             coalesce(fx.total, 0)::integer as total
        from (select * from public.competitions where status <> 'ended' order by created_at desc limit 4) c
        left join lateral (
          select count(*) filter (where f.status = 'final') as played, count(*) as total
            from public.fixtures f where f.competition_id = c.id
        ) fx on true
        left join lateral (
          select count(distinct e.division) as divisions
            from public.competition_entries e where e.competition_id = c.id and e.division is not null
        ) en on true
    ) x;
$$;
revoke execute on function public.home_competitions(uuid) from public, anon;
grant execute on function public.home_competitions(uuid) to authenticated;
