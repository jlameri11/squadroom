-- 0079_public_match_centre.sql
--
-- Children do not have accounts (0078), and they still need to know when
-- they are playing and whether they won. So: a public page, no login, the
-- way Dribl already does it — fv.dribl.com and nsfa.dribl.com are ordinary
-- websites and FNSW publishes lineups on one before kick-off.
--
-- This is the only unauthenticated read in the entire product, so it is
-- built as a single function with a hard boundary rather than as policies
-- loosened for anon. Policies are additive and someone will eventually
-- widen one; a function returns exactly what it was written to return.
--
-- WHAT IT MUST NEVER RETURN, and the test asserts each one:
--   * a child's name — R-16 exists because other products got this wrong,
--     and a public page listing children by name and ground is a worse
--     problem than an incomplete feature
--   * a phone number, an email, a profile
--   * a message, a channel, an RSVP
--   * anything about a family at all
--
-- It returns clubs and scores. A nine-year-old wants to know if their team
-- won; they do not need the squad list to find that out.
--
-- The organiser opts in per competition. A tournament is not public because
-- somebody built a public page.

alter table public.competitions
  add column public_slug text unique
    check (public_slug is null or public_slug ~ '^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$'),
  add column published_at timestamptz;

comment on column public.competitions.public_slug is
  'Set to publish this competition at /c/<slug> with no login. Null means not
   published. Clubs and scores only — never a child''s name (R-16).';

-- ---------------------------------------------------------------------------
-- The whole page, in one call
-- ---------------------------------------------------------------------------
create or replace function public.public_match_centre(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public as $fn$
declare
  v_comp public.competitions;
begin
  select * into v_comp
    from public.competitions
   where public_slug = p_slug
     and published_at is not null;

  -- Unpublished and non-existent answer identically. Otherwise the endpoint
  -- tells anyone who asks which competitions exist but are private.
  if v_comp is null then
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
               -- venue_label is what the organiser typed on the run sheet;
               -- venue_id is the tidy version they may never have filled in.
               'venue', coalesce(v.name, f.venue_label),
               'field', f.field_label,
               'home', home.display_name,
               'away', away.display_name,
               'home_score', f.home_score,
               'away_score', f.away_score,
               'status', f.status
             ) order by f.starts_at nulls last, f.field_label)
        from public.fixtures f
        left join public.venues v on v.id = f.venue_id
        left join public.competition_entries home on home.id = f.home_entry_id
        left join public.competition_entries away on away.id = f.away_entry_id
       where f.competition_id = v_comp.id
    ), '[]'::jsonb),

    -- app_private.ladder was split from the authorised version in 0051 so it
    -- could be computed without a caller. This is the other use that split
    -- was for. It takes ONE division, so the divisions drive the loop.
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
        ) d
    ), '{}'::jsonb),

    'divisions', coalesce((
      select jsonb_agg(distinct e.division order by e.division)
        from public.competition_entries e
       where e.competition_id = v_comp.id and e.division is not null
    ), '[]'::jsonb)
  );
end;
$fn$;

-- The one function in the product that anon may call.
revoke all on function public.public_match_centre(text) from public;
grant execute on function public.public_match_centre(text) to anon, authenticated;
