-- 0274 — Home's Competitions card and the Admin hub in one call each (the
-- "Feels instant" pass; Joey, 11 Nov 2026; BUILD_PLAN item 16).
--
-- Home's Competitions card made one request for the competitions and then
-- three for each of them — up to thirteen, in two rounds — and the Admin hub
-- three counts, each its own trip, before a single orange card could show.
-- One function each, so the screen cache (lib/hooks/use-screen) can hold the
-- answer and paint it at once the next time.
--
-- Both are SECURITY INVOKER on purpose: they read exactly what the person's
-- own policies let them read — the competitions they organise or their club
-- has entered, the requests their role may see — so nothing here is a second
-- opinion about visibility. A stranger gets an empty answer from the
-- policies, not from this file.

create or replace function public.home_competitions(p_academy uuid default null)
returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc), '[]'::jsonb)
    from (
      select c.id, c.name, c.season, c.status, c.created_at,
             (select a.name from public.academies a where a.id = c.organiser_id) as organiser,
             (select count(distinct e.division) from public.competition_entries e where e.competition_id = c.id and e.division is not null)::integer as divisions,
             (select count(*) from public.fixtures f where f.competition_id = c.id and f.status = 'final')::integer as played,
             (select count(*) from public.fixtures f where f.competition_id = c.id)::integer as total
        from public.competitions c
       where c.status <> 'ended'
       order by c.created_at desc
       limit 4
    ) x;
$$;
revoke execute on function public.home_competitions(uuid) from public, anon;
grant execute on function public.home_competitions(uuid) to authenticated;

create or replace function public.admin_hub(p_academy uuid)
returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'pending', (select count(*) from public.join_requests j where j.academy_id = p_academy and j.status = 'pending')::integer,
    'pending_registrations', (select count(*) from public.program_registrations r where r.academy_id = p_academy and r.status = 'pending')::integer,
    -- Families who used the public register link: the only queue holding
    -- people the club has never met.
    'pending_signups', (select count(*) from public.registration_requests q where q.academy_id = p_academy and q.status = 'pending')::integer,
    'two_step_required', (select a.two_step_required from public.academies a where a.id = p_academy)
  );
$$;
revoke execute on function public.admin_hub(uuid) from public, anon;
grant execute on function public.admin_hub(uuid) to authenticated;
