-- 0188: the draw builder checks the caller itself.
--
-- 0185 took `generate_fixtures` away from authenticated on the grounds that
-- it was an internal wrapper. It is not: it is the function the organiser's
-- screen and three suites call, and the organiser check lived one call down
-- in generate_fixtures_managed. The full test run found it within the hour.
-- The check now lives here as well, so the function passes test-rls 93 on
-- its own merits, and the grant comes back.

create or replace function public.generate_fixtures(
  p_competition uuid, p_division text, p_start_at timestamptz,
  p_game_mins integer default 20, p_gap_mins integer default 5,
  p_fields text[] default array['Field 1'::text], p_venue_label text default null,
  p_replace boolean default false, p_round_every_days integer default 0
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_mode public.competition_mode;
begin
  if not coalesce(app_private.is_competition_organiser(p_competition), false) then
    raise exception 'only the organiser can build the draw' using errcode = '42501';
  end if;
  select mode into v_mode from public.competitions where id = p_competition;
  if v_mode = 'comms_only' then
    raise exception 'This competition is run elsewhere. Squadroom handles its messages and reminders, not its draw.'
      using errcode = '22023';
  end if;
  return public.generate_fixtures_managed(
    p_competition, p_division, p_start_at, p_game_mins, p_gap_mins, p_fields, p_venue_label, p_replace, p_round_every_days);
end;
$$;

revoke execute on function public.generate_fixtures(uuid, text, timestamptz, integer, integer, text[], text, boolean, integer) from public, anon;
grant execute on function public.generate_fixtures(uuid, text, timestamptz, integer, integer, text[], text, boolean, integer) to authenticated;
