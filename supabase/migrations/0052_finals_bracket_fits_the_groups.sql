-- 0052_finals_bracket_fits_the_groups.sql
--
-- create_finals assumed three groups, because that is what NRIFA's U7s runs.
-- With two groups there is no "third-best group winner", so one semi-final
-- could never be filled and simply sat there blank for ever - the worst
-- possible failure, because it looks like patience rather than a mistake.
--
-- The bracket now follows the number of groups:
--
--   1 group    the top two play the final. No semis.
--   2 groups   A1 v B2 and B1 v A2, which is the standard crossover and
--              stops the two group winners meeting before the final.
--   3+ groups  best winner v best runner-up, second winner v third winner -
--              the structure the tournament sheet already uses.

create or replace function public.create_finals(
  p_competition uuid,
  p_division    text,
  p_start_at    timestamptz,
  p_game_mins   integer default 20,
  p_gap_mins    integer default 15,
  p_fields      text[] default array['Field 1', 'Field 2'],
  p_venue_label text default null
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_mode   public.competition_mode;
  v_groups integer;
  v_sf1    uuid;
  v_sf2    uuid;
  v_final_at timestamptz;
  v_made   integer := 0;
begin
  if not app_private.is_competition_organiser(p_competition) then
    raise exception 'only the organiser can set up the finals' using errcode = '42501';
  end if;

  select mode into v_mode from public.competitions where id = p_competition;
  if v_mode = 'comms_only' then
    raise exception 'This competition is run elsewhere. Its finals live there.'
      using errcode = '22023';
  end if;

  select count(distinct coalesce(group_label, '')) into v_groups
    from public.competition_entries
   where competition_id = p_competition and division = p_division;

  if v_groups = 0 then
    raise exception 'no teams entered in this division' using errcode = '22023';
  end if;

  delete from public.fixtures
   where competition_id = p_competition and division = p_division
     and stage = 'final' and home_score is null;

  v_final_at := p_start_at;

  if v_groups >= 2 then
    insert into public.fixtures (competition_id, division, round, stage,
      home_source, away_source, starts_at, duration_mins, venue_label, field_label)
    values (p_competition, p_division, 'Semi-final 1', 'final',
      'P:1:1',
      -- Two groups: cross over, so the winners cannot meet early.
      case when v_groups = 2 then 'P:2:2' else 'P:2:1' end,
      p_start_at, p_game_mins, p_venue_label, p_fields[1])
    returning id into v_sf1;

    insert into public.fixtures (competition_id, division, round, stage,
      home_source, away_source, starts_at, duration_mins, venue_label, field_label)
    values (p_competition, p_division, 'Semi-final 2', 'final',
      'P:1:2',
      case when v_groups = 2 then 'P:2:1' else 'P:1:3' end,
      p_start_at, p_game_mins, p_venue_label, coalesce(p_fields[2], p_fields[1]))
    returning id into v_sf2;

    v_made := 2;
    v_final_at := p_start_at + ((p_game_mins + p_gap_mins) || ' minutes')::interval;
  end if;

  insert into public.fixtures (competition_id, division, round, stage,
    home_source, away_source, starts_at, duration_mins, venue_label, field_label)
  values (p_competition, p_division, 'Final', 'final',
    -- One group: the top two go straight through.
    case when v_groups = 1 then 'P:1:1' else 'W:' || v_sf1 end,
    case when v_groups = 1 then 'P:2:1' else 'W:' || v_sf2 end,
    v_final_at, p_game_mins, p_venue_label, p_fields[1]);

  return v_made + 1;
end;
$$;

revoke execute on function public.create_finals(uuid, text, timestamptz, integer, integer, text[], text) from public, anon;
grant execute on function public.create_finals(uuid, text, timestamptz, integer, integer, text[], text) to authenticated;
