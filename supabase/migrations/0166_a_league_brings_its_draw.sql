-- 0166: a league brings its draw.
--
-- L-14. A league switching to Squadroom already has a season drawn — in
-- Dribl, in a spreadsheet, somewhere. The club importer (0080 onwards) reads
-- a file a club exports from its own account and writes that club's events;
-- this does the same for a LEAGUE: teams become competition entries, games
-- become fixtures, and the 0031 mirror then puts each game into every
-- entered club's calendar the way a game drawn here would be.
--
-- A FILE A HUMAN HANDS US, never a fetch (CLAUDE.md Rules). The file's own
-- id for a game, when it has one, is kept as fixtures.external_ref so a
-- re-import of a moved game moves it instead of doubling the season; with no
-- id, a game is matched on division, both teams and the day, because one
-- team cannot play the same opponent twice on one day.
--
-- TEAMS ARE NAMES ON THE DRAW until a club signs up. An entry is created per
-- (division, name); when a club already entered in the competition has that
-- name, or the row names the club, the entry is linked to it so the club's
-- staff can score and sheet from day one.

alter table public.fixtures add column if not exists external_ref text;
create unique index if not exists fixtures_external_ref_idx
  on public.fixtures (competition_id, external_ref) where external_ref is not null;

create or replace function public.import_league_draw(p_competition uuid, p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_org uuid;
  v_tz text;
  r jsonb;
  i integer := 0;
  v_division text; v_home text; v_away text; v_ref text;
  v_date date; v_time time; v_at timestamptz;
  v_home_entry uuid; v_away_entry uuid; v_fixture uuid;
  v_entries integer := 0; v_created integer := 0; v_updated integer := 0;
  v_skipped jsonb := '[]'::jsonb;
begin
  select c.organiser_id, coalesce(a.timezone, 'Australia/Sydney') into v_org, v_tz
    from public.competitions c join public.academies a on a.id = c.organiser_id
   where c.id = p_competition;
  if v_org is null or not app_private.may_run(p_competition, 'competition') then
    raise exception 'only the organiser imports a draw' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be an array' using errcode = '22023';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    v_division := nullif(btrim(coalesce(r->>'division', '')), '');
    v_home := nullif(btrim(coalesce(r->>'home', '')), '');
    v_away := nullif(btrim(coalesce(r->>'away', '')), '');
    v_ref := nullif(btrim(coalesce(r->>'external_ref', '')), '');
    if v_division is null then
      v_skipped := v_skipped || jsonb_build_object('row', i, 'why', 'no division');
      continue;
    end if;
    if coalesce(r->>'bye', '') <> '' or v_home is null or v_away is null then
      v_skipped := v_skipped || jsonb_build_object('row', i, 'why', case when v_home is null and v_away is null then 'no teams' when coalesce(r->>'bye', '') <> '' then 'a bye' else 'one team missing' end);
      continue;
    end if;
    if lower(v_home) = lower(v_away) then
      v_skipped := v_skipped || jsonb_build_object('row', i, 'why', 'a team against itself');
      continue;
    end if;
    begin
      v_date := nullif(r->>'local_date', '')::date;
      v_time := nullif(r->>'local_time', '')::time;
    exception when others then
      v_skipped := v_skipped || jsonb_build_object('row', i, 'why', 'could not read the date or time');
      continue;
    end;
    -- The file's clock is the league's local time. Never UTC midnight (CLAUDE.md).
    v_at := case when v_date is not null then ((v_date + coalesce(v_time, time '00:00')) at time zone v_tz) end;

    v_home_entry := app_private.import_entry(p_competition, v_division, v_home, nullif(btrim(coalesce(r->>'home_club', '')), ''));
    v_away_entry := app_private.import_entry(p_competition, v_division, v_away, nullif(btrim(coalesce(r->>'away_club', '')), ''));
    if v_home_entry is null or v_away_entry is null then
      v_skipped := v_skipped || jsonb_build_object('row', i, 'why', 'could not create a team');
      continue;
    end if;

    v_fixture := null;
    if v_ref is not null then
      select id into v_fixture from public.fixtures where competition_id = p_competition and external_ref = v_ref;
    end if;
    if v_fixture is null and v_at is not null then
      select id into v_fixture from public.fixtures
       where competition_id = p_competition and division = v_division
         and home_entry_id = v_home_entry and away_entry_id = v_away_entry
         and (starts_at at time zone v_tz)::date = v_date
       limit 1;
    end if;

    if v_fixture is null then
      insert into public.fixtures (competition_id, division, round, home_entry_id, away_entry_id, starts_at, venue_label, field_label, stage, status, external_ref)
      values (p_competition, v_division, nullif(btrim(coalesce(r->>'round', '')), ''), v_home_entry, v_away_entry, v_at,
              nullif(btrim(coalesce(r->>'venue', '')), ''), nullif(btrim(coalesce(r->>'field', '')), ''), 'group', 'scheduled', v_ref);
      v_created := v_created + 1;
    else
      -- A game that has been played keeps its result; everything else follows the file.
      update public.fixtures
         set round = coalesce(nullif(btrim(coalesce(r->>'round', '')), ''), round),
             starts_at = coalesce(v_at, starts_at),
             venue_label = coalesce(nullif(btrim(coalesce(r->>'venue', '')), ''), venue_label),
             field_label = coalesce(nullif(btrim(coalesce(r->>'field', '')), ''), field_label),
             external_ref = coalesce(v_ref, external_ref),
             updated_at = now()
       where id = v_fixture and status in ('scheduled', 'postponed');
      v_updated := v_updated + 1;
    end if;
  end loop;

  select count(*) into v_entries from public.competition_entries where competition_id = p_competition;
  return jsonb_build_object('entries', v_entries, 'created', v_created, 'updated', v_updated, 'skipped', v_skipped);
end;
$fn$;

-- The entry for a name in a division, created if new, linked to an entered
-- club when the name (or the club column) matches one.
create or replace function app_private.import_entry(p_competition uuid, p_division text, p_name text, p_club text)
returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  v_id uuid;
  v_academy uuid;
begin
  select id into v_id from public.competition_entries
   where competition_id = p_competition and division = p_division and lower(display_name) = lower(p_name)
   limit 1;
  if v_id is not null then return v_id; end if;

  select cc.academy_id into v_academy
    from public.competition_clubs cc join public.academies a on a.id = cc.academy_id
   where cc.competition_id = p_competition and cc.status = 'active'
     and (lower(a.name) = lower(coalesce(p_club, p_name)) or lower(a.name) = lower(p_name))
   limit 1;

  insert into public.competition_entries (competition_id, academy_id, team_id, display_name, division)
  values (p_competition, v_academy, null, p_name, p_division)
  returning id into v_id;
  return v_id;
end;
$fn$;

grant execute on function public.import_league_draw(uuid, jsonb) to authenticated;
