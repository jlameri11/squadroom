-- 0152: a sheet with a loop variable called p.
--
-- 0151's submit_match_sheet declared a plpgsql variable `p` for the loop
-- over the players and then used `p` again as the alias of
-- jsonb_array_elements in the insert that follows. Postgres saw two things
-- called p in one statement and refused: 'column reference "p" is
-- ambiguous'. Caught by the suite's first run, on the first real sheet.
-- The loop variable is v_row now; nothing else changes.

create or replace function public.submit_match_sheet(
  p_fixture uuid, p_entry uuid, p_players jsonb,
  p_captain uuid default null, p_keeper uuid default null
)
returns uuid
language plpgsql volatile security definer set search_path = public as $fn$
declare
  f        public.fixtures;
  v_side   text;
  v_max    integer;
  v_n      integer;
  v_sheet  uuid;
  v_row    jsonb;
  v_why    text;
  v_on     date;
begin
  if not coalesce(app_private.can_manage_entry(p_entry), false) then
    raise exception 'only the team''s manager or coach can submit its sheet' using errcode = '42501';
  end if;
  v_side := app_private.fixture_side(p_fixture, p_entry);
  select * into f from public.fixtures where id = p_fixture;
  if f.status in ('final', 'forfeit', 'bye', 'cancelled') then
    raise exception 'this game is %; the sheet is closed', f.status using errcode = '22023';
  end if;
  if p_players is null or jsonb_typeof(p_players) <> 'array' or jsonb_array_length(p_players) = 0 then
    raise exception 'a sheet needs players on it' using errcode = '22023';
  end if;
  select r.squad_size_max into v_max from app_private.division_rules(f.competition_id, f.division) r;
  v_n := jsonb_array_length(p_players);
  if v_max is not null and v_n > v_max then
    raise exception '% players on the sheet; this division allows %', v_n, v_max using errcode = '22023';
  end if;
  v_on := coalesce(f.starts_at::date, current_date);

  for v_row in select * from jsonb_array_elements(p_players) loop
    v_why := app_private.ineligibility(p_entry, (v_row->>'player_id')::uuid, v_on);
    if v_why is not null then
      raise exception '%', v_why using errcode = '22023';
    end if;
  end loop;

  insert into public.match_sheets (competition_id, fixture_id, entry_id, captain_player_id, keeper_player_id, submitted_by)
  values (f.competition_id, p_fixture, p_entry, p_captain, p_keeper, auth.uid())
  on conflict (fixture_id, entry_id) do update
    set captain_player_id = excluded.captain_player_id,
        keeper_player_id  = excluded.keeper_player_id,
        submitted_by = excluded.submitted_by,
        submitted_at = now(),
        status = 'submitted', confirmed_by = null, confirmed_at = null
  returning id into v_sheet;

  delete from public.match_sheet_players where sheet_id = v_sheet;
  insert into public.match_sheet_players (sheet_id, player_id, number, starting)
  select v_sheet, (x->>'player_id')::uuid, (x->>'number')::integer, coalesce((x->>'starting')::boolean, true)
    from jsonb_array_elements(p_players) x;

  perform app_private.log_sheet(f.competition_id, p_fixture, p_entry, 'sheet_submitted',
    jsonb_build_object('players', v_n, 'side', v_side));
  return v_sheet;
end;
$fn$;
