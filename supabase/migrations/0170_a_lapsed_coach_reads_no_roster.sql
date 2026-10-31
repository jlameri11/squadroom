-- 0170: a lapsed coach reads no roster.
--
-- 0169 removed a lapsed coach's coaching rights, and the suite showed the
-- roster still readable: players_select also lets any TEAM MEMBER read the
-- team's players — which is what lets a parent see the squad list — and a
-- coach is a team member too. The team-member clause now excludes anyone
-- whose check at that club has lapsed. Parents have no check on record and
-- are untouched. (The live policy uses the app_private helpers; 0013's
-- public ones are long gone.)
drop policy if exists players_select on public.players;
create policy players_select on public.players for select to authenticated
  using (
    (select app_private.is_academy_coach(players.academy_id))
    or (select app_private.is_guardian_of(players.id))
    or (team_id is not null
        and (select app_private.is_team_member(players.team_id))
        and not (select app_private.clearance_lapsed(players.academy_id, auth.uid())))
  );
