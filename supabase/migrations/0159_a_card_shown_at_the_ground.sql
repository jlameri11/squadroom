-- 0159: a card shown at the ground.
--
-- L-04. The player card (0146) opens for a child's family and the club's
-- coaches, and nobody else — right for a club, and useless at a league
-- ground, where the people who need to check it are the referee, the
-- organiser's official and the OPPOSITION manager, none of whom belong to
-- the club.
--
-- Two more may open it, each tied to a sheet:
--   · the organiser of a competition in which the child is on a season
--     squad — the league's own officials, for the season;
--   · the manager of the OTHER side of a fixture on which the child is on
--     a sheet, from the day before kick-off to the day after — the
--     opposition, on match day, which is exactly when "that's not the kid
--     on the card" gets said.
-- The photo follows the same rule (may_see_photo), because a card without
-- its photo checks nothing.

create or replace function app_private.may_see_card(p_player uuid)
returns boolean
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_academy uuid;
begin
  select academy_id into v_academy from public.players where id = p_player;
  if v_academy is null then return false; end if;
  if coalesce(app_private.is_guardian_of(p_player), false)
     or coalesce(app_private.is_academy_coach(v_academy), false) then
    return true;
  end if;
  -- The league's officials, for the season.
  if exists (
    select 1 from public.entry_squads q
     where q.player_id = p_player
       and app_private.is_competition_organiser(q.competition_id)
  ) then
    return true;
  end if;
  -- The opposition, on match day.
  return exists (
    select 1
      from public.match_sheet_players sp
      join public.match_sheets s on s.id = sp.sheet_id
      join public.fixtures f on f.id = s.fixture_id
     where sp.player_id = p_player
       and coalesce(f.starts_at, now()) between now() - interval '1 day' and now() + interval '1 day'
       and app_private.can_manage_entry(case when f.home_entry_id = s.entry_id then f.away_entry_id else f.home_entry_id end)
  );
end;
$fn$;

create or replace function app_private.may_see_photo(p_name text)
returns boolean
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_player uuid := app_private.photo_path_player(p_name);
  v_academy uuid;
begin
  if v_player is null then return false; end if;
  select academy_id into v_academy from public.players where id = v_player;
  if v_academy is null or (storage.foldername(p_name))[1] <> v_academy::text then
    return false;
  end if;
  return app_private.may_see_card(v_player);
end;
$fn$;

create or replace function public.player_card(p_player uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_player public.players;
begin
  select * into v_player from public.players where id = p_player;
  if v_player.id is null or not app_private.may_see_card(p_player) then
    raise exception 'that card is not yours to see' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'id',              v_player.id,
    'full_name',       v_player.full_name,
    'preferred_name',  v_player.preferred_name,
    'dob',             v_player.dob,
    'photo_path',      v_player.photo_url,
    'ff_number',       v_player.ff_number,
    'official_status', v_player.official_status,
    'squad', (select jsonb_build_object('name', t.name, 'season', t.season, 'age_group', t.age_group)
                from public.teams t where t.id = v_player.team_id),
    'number', (select sn.number from public.squad_numbers sn
                where sn.player_id = v_player.id
                order by (sn.season = (select t.season from public.teams t where t.id = v_player.team_id)) desc,
                         sn.created_at desc
                limit 1),
    'club', (select jsonb_build_object('name', a.name, 'colour', a.primary_colour, 'logo_url', a.logo_url, 'slug', a.slug)
               from public.academies a where a.id = v_player.academy_id),
    -- Only the family and the club change anything on it.
    'can_edit', coalesce(app_private.is_guardian_of(p_player), false)
                or coalesce(app_private.is_academy_coach(v_player.academy_id), false)
  );
end;
$fn$;
