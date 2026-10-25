-- 0093: squads on the public match centre, the way Dribl does it.
--
-- Asked for directly: the public page needs player names. Dribl publishes
-- them — FNSW puts lineups on fv.dribl.com before kick-off — and a match
-- centre with no team sheet is a worse match centre. 0079 shipped with no
-- names at all, which was the safe default to start from and is not where it
-- should end.
--
-- THREE CONTROLS, because this is the only place in the product that writes
-- to the open internet and the Children's Online Privacy Code is due in
-- December 2026.
--
--   1. `academies.public_player_names` — off, initials, or full. Per
--      ACADEMY, so a club that wants its U17s named and its U8s not can run
--      two academies, and so a club that wants none is not opted in by
--      somebody else's decision.
--
--   2. `players.public_name_hidden` — one child, never published, whatever
--      the academy setting says. Always wins. Dribl calls the same thing
--      alias/photo exclusion, and it exists because a family in a refuge, or
--      with a court order, or simply uncomfortable, must be able to say no
--      without leaving the club.
--
--   3. EACH PLAYER'S OWN ACADEMY GOVERNS. A competition spans tenants, so
--      the organiser's setting must not reach the visiting clubs' children.
--      NRIFA running a gala day cannot publish Ravens' squad because NRIFA
--      ticked a box. This is the same rule as everywhere else in the schema:
--      being in a competition together lets you see the DRAW, not each
--      other's people.
--
-- 'initials' is the default when a club turns this on — "Leo W." is enough
-- for a parent reading a team sheet and is not a child's full name on a page
-- Google can index. Clubs that want full names can say so.

do $$ begin
  create type public.public_names_mode as enum ('off', 'initials', 'full');
exception when duplicate_object then null; end $$;

alter table public.academies
  add column if not exists public_player_names public.public_names_mode
    not null default 'off';

comment on column public.academies.public_player_names is
  'Whether this academy''s players are named on public competition pages.
   off = nobody, initials = "Leo W.", full = the registered name. A player''s
   own public_name_hidden flag overrides this and is never overridden by it.';

alter table public.players
  add column if not exists public_name_hidden boolean not null default false;

comment on column public.players.public_name_hidden is
  'This child is never named on a public page, whatever the academy setting
   says. Set by a guardian or by academy staff. Dribl calls the equivalent
   alias exclusion.';

/**
 * A guardian deciding about their own child.
 *
 * A function rather than a policy on `players`, because `players` is written
 * by coaches for a dozen reasons and widening its update policy to let
 * guardians in would let them change a team, a date of birth or a name. This
 * lets them change exactly one boolean about exactly their own child.
 */
create or replace function public.set_public_name_hidden(
  p_player uuid,
  p_hidden boolean
)
returns boolean
language plpgsql security definer set search_path = public as $fn$
declare
  v_academy uuid;
begin
  select academy_id into v_academy from public.players where id = p_player;
  if v_academy is null then
    raise exception 'no such player' using errcode = '22023';
  end if;

  if not (app_private.is_guardian_of(p_player) or app_private.is_academy_staff(v_academy)) then
    raise exception 'only this child''s guardian or the academy can change that'
      using errcode = '42501';
  end if;

  update public.players
     set public_name_hidden = p_hidden, updated_at = now()
   where id = p_player;

  return p_hidden;
end;
$fn$;

revoke execute on function public.set_public_name_hidden(uuid, boolean) from public, anon;
grant execute on function public.set_public_name_hidden(uuid, boolean) to authenticated;

/**
 * How a player is named in public, or not at all.
 *
 * One place, so the rule cannot be applied differently by two readers. Returns
 * NULL when the player must not be named, and every caller is expected to drop
 * a NULL rather than render it.
 */
create or replace function app_private.public_player_name(
  p_full      text,
  p_preferred text,
  p_mode      public.public_names_mode,
  p_hidden    boolean
)
returns text
language sql immutable set search_path = public as $fn$
  select case
    when p_hidden then null
    when p_mode = 'off' then null
    when p_mode = 'full' then coalesce(nullif(btrim(p_preferred), ''), p_full)
    else
      -- "Leo W." — the given name, then the first letter of the last word of
      -- the surname. A one-word name stays as it is rather than becoming a
      -- lone initial.
      case
        when array_length(string_to_array(btrim(coalesce(nullif(btrim(p_preferred), ''), p_full)), ' '), 1) < 2
          then coalesce(nullif(btrim(p_preferred), ''), p_full)
        else
          split_part(btrim(coalesce(nullif(btrim(p_preferred), ''), p_full)), ' ', 1)
            || ' '
            || upper(left(
                 (string_to_array(btrim(coalesce(nullif(btrim(p_preferred), ''), p_full)), ' '))[
                   array_length(string_to_array(btrim(coalesce(nullif(btrim(p_preferred), ''), p_full)), ' '), 1)
                 ], 1))
            || '.'
      end
  end;
$fn$;

-- ---------------------------------------------------------------------------
-- The public page, now with squads
-- ---------------------------------------------------------------------------
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
    ), '[]'::jsonb),

    -- The team sheets. Keyed by entry id so the page can show a squad beside
    -- the club it belongs to.
    --
    -- An entry with no team_id is a visiting club that has never heard of
    -- Squadroom — a name on the draw and nothing else — so it simply has no
    -- squad, which is correct rather than empty.
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
                -- THE PLAYER'S OWN academy decides, not the organiser's.
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
