-- 0290 — a script may delete a squad (22 Nov 2026, the first full test run
-- after 0285).
--
-- 0285 made a squad with players, games, members, money or entries on record
-- undeletable, so that an admin tidying up in the app cannot take a season's
-- history with it ("end its season instead"). The rule is for people. The
-- service role — the test suites' tidy-up, an operator's script — is trusted
-- past every policy already, and the 39 suites that make a throwaway squad
-- and remove it at the end were each leaving one behind ("left the demo
-- changed"). No route in the app deletes a squad with the service role, so
-- nobody in the app gets past the rule.

create or replace function public.teams_refuse_delete_with_history()
returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  v_players integer; v_games integer; v_members integer; v_money integer; v_entries integer;
begin
  -- The service role: a script or an operator, never a person in the app.
  if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role' then
    return old;
  end if;
  select count(*) into v_players from public.players where team_id = old.id;
  select count(*) into v_games from public.events where team_id = old.id;
  select count(*) into v_members from public.team_members where team_id = old.id;
  select count(*) into v_money from public.payments pm join public.payment_requests pr on pr.id = pm.request_id where pr.team_id = old.id;
  select count(*) into v_entries from public.competition_entries where team_id = old.id;
  if v_players + v_games + v_members + v_money + v_entries > 0 then
    raise exception 'This squad has % on record — end its season instead (Admin → Teams → End the season); nothing is lost. A squad can only be deleted while it is empty.',
      concat_ws(', ',
        case when v_players > 0 then v_players || ' players' end,
        case when v_games > 0 then v_games || ' games' end,
        case when v_members > 0 then v_members || ' members' end,
        case when v_money > 0 then v_money || ' payments' end,
        case when v_entries > 0 then v_entries || ' competition entries' end)
      using errcode = '23503';
  end if;
  return old;
end;
$fn$;
revoke execute on function public.teams_refuse_delete_with_history() from public, anon, authenticated;
