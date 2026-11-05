-- 0210: both sides of the game, crests and all.
--
-- Joey, 4 Nov 2026 (game page polish, benchmark: a match preview): the hero
-- at the top of a game shows both crests — "the opponent's crest if known,
-- else initials". A parent can already read the draw (fixtures and entries
-- are visible to everyone in the competition, 0022), but not the other
-- club's row in `academies`, which is members-only — and should stay so.
--
-- So one function returns exactly what a team sheet in a programme shows:
-- each side's display name, its club's name, crest and colour. Nothing else
-- about the other club — no members, no people — and only to someone who
-- can see the game already (app_private.is_competition_participant).
--
-- Unapplied until the Supabase access token is back (NEEDS JOEY #12). The
-- game page calls it and falls back to initials while it does not exist.

create or replace function public.fixture_sides(p_fixture uuid)
returns jsonb
language sql stable security definer set search_path = public as $fn$
  select case when app_private.is_competition_participant(f.competition_id) then
    jsonb_build_object(
      'home', (select jsonb_build_object(
                 'entry_id', e.id, 'name', e.display_name,
                 'club', a.name, 'logo', a.logo_url, 'colour', a.primary_colour)
                 from public.competition_entries e
                 left join public.academies a on a.id = e.academy_id
                where e.id = f.home_entry_id),
      'away', (select jsonb_build_object(
                 'entry_id', e.id, 'name', e.display_name,
                 'club', a.name, 'logo', a.logo_url, 'colour', a.primary_colour)
                 from public.competition_entries e
                 left join public.academies a on a.id = e.academy_id
                where e.id = f.away_entry_id))
  end
  from public.fixtures f
  where f.id = p_fixture;
$fn$;

revoke execute on function public.fixture_sides(uuid) from public, anon;
grant execute on function public.fixture_sides(uuid) to authenticated;
