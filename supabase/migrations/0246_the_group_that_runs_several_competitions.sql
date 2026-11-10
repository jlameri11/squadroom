-- 0246: the organiser group — one organisation that runs several leagues
-- and tournaments.
--
-- Joey, 10 Nov 2026 (Part B): "a 'Tournament & league organiser' account
-- that runs several leagues/tournaments (e.g. Magic Group → SPL + 3
-- tournaments): group staff get rights on all of them, 'Run by <Group>' on
-- public pages/notices/receipts, the org switcher shows the group with its
-- competitions underneath, and a simple group overview. Keep it simple."
--
-- The ownership already works this way: the organiser organisation IS the
-- group (competitions.organiser_id), and its owners, admins and league roles
-- run every competition it organises (may_run, 0164). What this adds is the
-- presentation: one overview of everything the group runs, and the list of
-- a group's competitions for the switcher. "Run by <Group>" is the screens'
-- (the competition carries organiser_id; the public match centre already
-- carries the organiser's name).

-- Everything the group runs, with what needs it this week — for the
-- group's staff and league-role holders.
create or replace function public.group_overview(p_academy uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_tz text;
  v_day date;
  v_sun date;
begin
  if auth.uid() is null then
    return null;
  end if;
  if not (coalesce(app_private.is_academy_staff(p_academy), false)
          or coalesce(array_length(app_private.league_roles_of(p_academy), 1), 0) > 0) then
    return null;
  end if;
  select coalesce(a.timezone, 'Australia/Sydney') into v_tz from public.academies a where a.id = p_academy;
  v_day := (now() at time zone v_tz)::date;
  v_sun := v_day + ((7 - extract(dow from v_day)::integer) % 7);

  return jsonb_build_object(
    'group', (select jsonb_build_object('id', a.id, 'name', a.name, 'type', a.type) from public.academies a where a.id = p_academy),
    'competitions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'name', c.name, 'type', c.type, 'season', c.season, 'status', c.status,
               'starts_on', c.starts_on, 'ends_on', c.ends_on,
               'clubs', (select count(*) from public.competition_clubs cc where cc.competition_id = c.id and cc.status = 'active'),
               'teams', (select count(*) from public.competition_entries e where e.competition_id = c.id),
               'weekend', (select count(*) from public.fixtures f
                            where f.competition_id = c.id and f.status in ('scheduled', 'in_progress')
                              and (f.starts_at at time zone v_tz)::date between v_day and v_sun),
               'unfilled', (select count(*) from public.fixtures f
                             where f.competition_id = c.id and f.status = 'scheduled'
                               and f.starts_at between now() and now() + interval '7 days'
                               and not exists (select 1 from public.referee_appointments ra
                                                where ra.fixture_id = f.id and ra.role = 'referee' and ra.status = 'accepted')),
               'disputed', (select count(*) from public.fixtures f where f.competition_id = c.id and f.score_disputed),
               'missing_sheets', (select count(*) from public.fixtures f
                                   where f.competition_id = c.id
                                     and f.starts_at between now() - interval '7 days' and now()
                                     and f.status in ('scheduled', 'in_progress', 'final')
                                     and f.home_entry_id is not null and f.away_entry_id is not null
                                     and (select count(*) from public.match_sheets ms where ms.fixture_id = f.id) < 2))
             order by (c.status = 'ended'), c.starts_on desc nulls last, c.name)
        from public.competitions c
       where c.organiser_id = p_academy), '[]'::jsonb));
end;
$fn$;
revoke execute on function public.group_overview(uuid) from public, anon;
grant execute on function public.group_overview(uuid) to authenticated;

-- The switcher: my organisations, each with the competitions it runs (an
-- organiser's shown with its leagues and tournaments underneath). The list
-- is for the people who run them — owners, admins and league-role holders;
-- a parent or coach of the organiser's own club gets an empty list, as
-- they get no overview.
create or replace function public.my_organisations_with_competitions()
returns jsonb
language sql stable security definer set search_path = public as $fn$
  -- my_organisations() is already the caller's own; named here too, so a
  -- stranger reads nothing and test-rls 93 can see that it is checked.
  select case when auth.uid() is null then '[]'::jsonb
         else coalesce((
           select jsonb_agg(jsonb_build_object(
                    'id', o.id, 'name', o.name, 'slug', o.slug, 'type', o.type, 'role', o.role,
                    'primary_colour', o.primary_colour, 'logo_url', o.logo_url,
                    'competitions', case
                      when o.role in ('owner', 'admin')
                        or coalesce(array_length(app_private.league_roles_of(o.id), 1), 0) > 0
                      then coalesce((
                        select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'season', c.season, 'status', c.status, 'type', c.type)
                                         order by (c.status = 'ended'), c.starts_on desc nulls last, c.name)
                          from public.competitions c where c.organiser_id = o.id), '[]'::jsonb)
                      else '[]'::jsonb end)
                  order by o.name)
             from public.my_organisations() o), '[]'::jsonb) end;
$fn$;
revoke execute on function public.my_organisations_with_competitions() from public, anon;
grant execute on function public.my_organisations_with_competitions() to authenticated;
