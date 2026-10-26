-- 0100: a club arrives with two hundred players in a spreadsheet.
--
-- Typing them in is the single biggest reason a club gives up halfway through
-- setup, and DRIBL_INTEL lists bulk import as table stakes. The fixture
-- importer has existed since 0063; the roster had nothing.
--
-- GUARDIANS ARE DELIBERATELY NOT IMPORTED, and that is not an omission.
-- CLAUDE.md: "There is no bulk address-book upload and there must never be
-- one. A coach's phone holds people with no relationship to the academy, and
-- putting them on our servers is a Privacy Act problem and exactly the kind of
-- thing that ends a product built around other people's children." A
-- spreadsheet column of parent phone numbers is that upload wearing a
-- different hat. Parents arrive through a join code and a coach's approval,
-- which is the identity gate this whole product rests on. The roster is the
-- children; the families let themselves in.
--
-- DEDUPE IS DRIBL'S RULE: name + gender + date of birth, through
-- app_private.find_existing_player. Re-importing an updated spreadsheet is
-- the normal case — a club exports again after adding ten players — and it
-- must not create two hundred duplicates. A match UPDATES the blank fields
-- and leaves the ones that already have values alone, because the database
-- has been edited by a coach since the export and the spreadsheet is not
-- more authoritative than they are.

/**
 * Import a roster. Returns what it did, per row, so the screen can show it.
 *
 * `p_rows` is [{full_name, dob, gender, preferred_name, ff_number,
 * squad_number, school}]. Everything but the first two is optional.
 *
 * Nothing is written unless the whole call succeeds: the function runs in one
 * statement, so a bad row two hundred lines in rolls back the hundred and
 * ninety-nine before it rather than leaving a half-imported squad nobody can
 * tell from a complete one.
 */
create or replace function public.import_players(
  p_academy uuid,
  p_team    uuid,
  p_rows    jsonb,
  p_season  text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_row       jsonb;
  v_name      text;
  v_dob       date;
  v_gender    public.player_gender;
  v_existing  uuid;
  v_player    uuid;
  v_number    integer;
  v_created   integer := 0;
  v_matched   integer := 0;
  v_numbered  integer := 0;
  v_problems  jsonb := '[]'::jsonb;
  v_index     integer := 0;
begin
  if not app_private.is_academy_coach(p_academy) then
    raise exception 'only a coach can import a roster' using errcode = '42501';
  end if;
  if p_team is not null and not exists (
    select 1 from public.teams where id = p_team and academy_id = p_academy
  ) then
    raise exception 'that team is not in this academy' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception 'that is % rows — split the file', jsonb_array_length(p_rows)
      using errcode = '22023';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_index := v_index + 1;
    v_name := btrim(coalesce(v_row->>'full_name', ''));
    v_gender := nullif(btrim(coalesce(v_row->>'gender', '')), '')::public.player_gender;

    -- A row with no name is a blank line at the bottom of a spreadsheet, which
    -- every spreadsheet has. Skipped quietly rather than failing the import.
    if v_name = '' then
      continue;
    end if;

    begin
      v_dob := (v_row->>'dob')::date;
    exception when others then
      v_problems := v_problems || jsonb_build_object(
        'row', v_index, 'name', v_name,
        'problem', 'could not read the date of birth: ' || coalesce(v_row->>'dob', '(blank)')
      );
      continue;
    end;

    if v_dob is null then
      v_problems := v_problems || jsonb_build_object(
        'row', v_index, 'name', v_name, 'problem', 'no date of birth'
      );
      continue;
    end if;

    -- A child born in the future, or a hundred years ago, is a date read the
    -- wrong way round. Worth stopping on rather than importing.
    if v_dob > current_date or v_dob < current_date - interval '100 years' then
      v_problems := v_problems || jsonb_build_object(
        'row', v_index, 'name', v_name,
        'problem', 'date of birth reads as ' || v_dob::text || ' — check day/month order'
      );
      continue;
    end if;

    v_existing := app_private.find_existing_player(p_academy, v_name, v_dob, v_gender);

    if v_existing is not null then
      v_player := v_existing;
      v_matched := v_matched + 1;
      -- Fill the blanks only. A coach has edited this row since the export,
      -- and the spreadsheet is not more authoritative than they are.
      update public.players pl
         set gender         = coalesce(pl.gender, v_gender),
             preferred_name = coalesce(pl.preferred_name, nullif(btrim(coalesce(v_row->>'preferred_name', '')), '')),
             ff_number      = coalesce(pl.ff_number, nullif(btrim(coalesce(v_row->>'ff_number', '')), '')),
             school         = coalesce(pl.school, nullif(btrim(coalesce(v_row->>'school', '')), '')),
             team_id        = coalesce(pl.team_id, p_team),
             updated_at     = now()
       where pl.id = v_existing;
    else
      insert into public.players (
        academy_id, team_id, full_name, dob, gender, preferred_name, ff_number, school
      ) values (
        p_academy, p_team, v_name, v_dob, v_gender,
        nullif(btrim(coalesce(v_row->>'preferred_name', '')), ''),
        nullif(btrim(coalesce(v_row->>'ff_number', '')), ''),
        nullif(btrim(coalesce(v_row->>'school', '')), '')
      )
      returning id into v_player;
      v_created := v_created + 1;
    end if;

    -- Shirt numbers, if the file has them and a season was named. A clash is
    -- reported rather than thrown: one duplicated number must not cost the
    -- club its whole import.
    v_number := nullif(btrim(coalesce(v_row->>'squad_number', '')), '')::integer;
    if v_number is not null and p_season is not null then
      begin
        insert into public.squad_numbers (academy_id, player_id, season, number, assigned_by)
        values (p_academy, v_player, p_season, v_number, auth.uid())
        on conflict (academy_id, season, player_id) do update set number = excluded.number;
        v_numbered := v_numbered + 1;
      exception when unique_violation then
        v_problems := v_problems || jsonb_build_object(
          'row', v_index, 'name', v_name,
          'problem', 'shirt number ' || v_number || ' is already taken this season'
        );
      end;
    end if;
  end loop;

  return jsonb_build_object(
    'created', v_created,
    'matched', v_matched,
    'numbered', v_numbered,
    'problems', v_problems
  );
end;
$fn$;

revoke execute on function public.import_players(uuid, uuid, jsonb, text) from public, anon;
grant execute on function public.import_players(uuid, uuid, jsonb, text) to authenticated;
