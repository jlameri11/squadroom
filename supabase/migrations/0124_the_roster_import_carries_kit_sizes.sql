-- 0124: the roster import carries kit sizes too.
--
-- 0123 gave players a shirt, shorts and socks size and gave a coach somewhere
-- to type one. That leaves the clubs this matters most to doing it one child
-- at a time: a club with sizes already in a spreadsheet — which is most of
-- them, because that is where this lived before Squadroom — has to retype
-- twenty-four of them to get a kit list.
--
-- Same shape as every other field here: a BLANK existing value is filled and
-- an existing one is left alone, because a coach's edit is not less
-- authoritative than a spreadsheet. The client drops anything the enum does
-- not recognise before sending, so an import never fails over a field nobody
-- needs — and a dropped size arrives as a blank, which is a question a club
-- can ask rather than a wrong shirt.
--
-- The cast is guarded rather than bare. `'MED'::kit_size` raises 22P02 and
-- would take the whole import down with it, so a value that is not one of
-- the enum's labels is treated as absent here as well as in the client. Two
-- places, deliberately: the client is what makes the preview honest, and
-- this is what makes the function safe to call from anywhere else.

create or replace function app_private.as_kit_size(p_value text)
returns public.kit_size
language plpgsql immutable set search_path = public as $fn$
begin
  return nullif(btrim(upper(coalesce(p_value, ''))), '')::public.kit_size;
exception when invalid_text_representation then
  return null;
end;
$fn$;

create or replace function app_private.as_sock_size(p_value text)
returns public.sock_size
language plpgsql immutable set search_path = public as $fn$
begin
  return nullif(btrim(upper(coalesce(p_value, ''))), '')::public.sock_size;
exception when invalid_text_representation then
  return null;
end;
$fn$;

-- The whole function again, because `create or replace` replaces it wholly.
-- Only the three columns above and below are new; everything else is 0100
-- unchanged, and is repeated here so this file is the readable version.

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
             -- 0124. Blank filled, existing left alone: a coach's edit is
             -- not less authoritative than a spreadsheet.
             shirt_size     = coalesce(pl.shirt_size,  app_private.as_kit_size(v_row->>'shirt_size')),
             shorts_size    = coalesce(pl.shorts_size, app_private.as_kit_size(v_row->>'shorts_size')),
             socks_size     = coalesce(pl.socks_size,  app_private.as_sock_size(v_row->>'socks_size')),
             preferred_name = coalesce(pl.preferred_name, nullif(btrim(coalesce(v_row->>'preferred_name', '')), '')),
             ff_number      = coalesce(pl.ff_number, nullif(btrim(coalesce(v_row->>'ff_number', '')), '')),
             school         = coalesce(pl.school, nullif(btrim(coalesce(v_row->>'school', '')), '')),
             team_id        = coalesce(pl.team_id, p_team),
             updated_at     = now()
       where pl.id = v_existing;
    else
      insert into public.players (
        academy_id, team_id, full_name, dob, gender, preferred_name, ff_number, school,
        shirt_size, shorts_size, socks_size
      ) values (
        p_academy, p_team, v_name, v_dob, v_gender,
        nullif(btrim(coalesce(v_row->>'preferred_name', '')), ''),
        nullif(btrim(coalesce(v_row->>'ff_number', '')), ''),
        nullif(btrim(coalesce(v_row->>'school', '')), ''),
        -- Guarded casts: 'MED'::kit_size raises 22P02 and would take the
        -- whole import down over a field nobody needs.
        app_private.as_kit_size(v_row->>'shirt_size'),
        app_private.as_kit_size(v_row->>'shorts_size'),
        app_private.as_sock_size(v_row->>'socks_size')
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
