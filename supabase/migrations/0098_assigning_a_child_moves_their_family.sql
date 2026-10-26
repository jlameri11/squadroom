-- 0098: approving a child into a team left their family outside the team chat.
--
-- My own bug, in the feature I built two migrations ago, and 0083's comment
-- claimed the opposite: "the existing triggers on team_members then create the
-- channel membership and the calendar entries. Nothing new to build for that."
--
-- True, and the approval screen does not insert a `team_members` row. It sets
-- `players.team_id`, because that is what puts the CHILD in the squad. The
-- trigger that joins the team and age-group channels fires on `team_members`,
-- which is about ADULTS — a child has no account to add. So a coach approving
-- a registration moved the child into the squad and left the parent outside
-- the conversation: approved, and still seeing nothing, which is the exact
-- state the approval queue exists to end.
--
-- FIXED IN THE DATABASE, not in the screen. A child's team is set from at
-- least four places — the program approval queue, the join approval route, the
-- admin roster screen, and the bulk importer — and a fix in one of them is a
-- bug in the other three. A trigger on `players.team_id` is true for all of
-- them, including the ones not written yet.
--
-- The guardians follow the child, which is the rule this product runs on
-- everywhere else: a parent is in a channel because their child is in that
-- squad, never because somebody added them.

/**
 * When a child joins a squad, their guardians join its conversations.
 *
 * Only on a real change of team, and only for guardians who are active
 * members of the academy — a second parent who has never accepted their
 * invitation is not quietly given access by their co-parent's child being
 * graded.
 *
 * The old team is deliberately NOT cleaned up here. A guardian may have
 * another child in it, and working that out is what `team_members_leave_
 * channels` already does when a team_members row is actually removed. Guessing
 * at it from this side would take a parent out of a channel their other child
 * is still in — which is how you lose somebody's trust in one tap.
 */
create or replace function public.guardians_follow_their_child()
returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if new.team_id is null or new.team_id is not distinct from old.team_id then
    return new;
  end if;

  insert into public.team_members (academy_id, team_id, profile_id, role)
  -- Cast explicitly: a bare literal in a SELECT list is text, and `role` is
  -- academy_role. In a VALUES clause Postgres infers it; here it does not.
  select new.academy_id, new.team_id, pg.profile_id, 'parent'::public.academy_role
    from public.player_guardians pg
    join public.academy_members am
      on am.academy_id = new.academy_id
     and am.profile_id = pg.profile_id
     and am.status = 'active'
   where pg.player_id = new.id
     and pg.academy_id = new.academy_id
  on conflict (team_id, profile_id) do nothing;

  return new;
end;
$fn$;

drop trigger if exists players_guardians_follow on public.players;
create trigger players_guardians_follow
  after insert or update of team_id on public.players
  for each row execute function public.guardians_follow_their_child();

/**
 * And the same when a guardian is linked to a child who is already in a team.
 *
 * The other order of events, and just as common: the child is on the roster
 * first and the parent arrives afterwards — through a join code, or because a
 * second guardian was added later. Without this they are in the academy and
 * not in their own child's squad.
 */
create or replace function public.guardian_joins_their_childs_team()
returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  v_team uuid;
begin
  select team_id into v_team
    from public.players
   where id = new.player_id and academy_id = new.academy_id;

  if v_team is null then
    return new;
  end if;

  insert into public.team_members (academy_id, team_id, profile_id, role)
  select new.academy_id, v_team, new.profile_id, 'parent'::public.academy_role
   where exists (
     select 1 from public.academy_members am
      where am.academy_id = new.academy_id
        and am.profile_id = new.profile_id
        and am.status = 'active'
   )
  on conflict (team_id, profile_id) do nothing;

  return new;
end;
$fn$;

drop trigger if exists player_guardians_join_team on public.player_guardians;
create trigger player_guardians_join_team
  after insert on public.player_guardians
  for each row execute function public.guardian_joins_their_childs_team();

-- Backfill: every guardian whose child is already in a squad they are not in.
-- This is the damage the gap has already done to the demo data, and would
-- have done to a real club's first season.
do $$
declare
  v_added integer;
begin
  with missing as (
    insert into public.team_members (academy_id, team_id, profile_id, role)
    select distinct pl.academy_id, pl.team_id, pg.profile_id, 'parent'::public.academy_role
      from public.players pl
      join public.player_guardians pg
        on pg.player_id = pl.id and pg.academy_id = pl.academy_id
      join public.academy_members am
        on am.academy_id = pl.academy_id
       and am.profile_id = pg.profile_id
       and am.status = 'active'
     where pl.team_id is not null
    on conflict (team_id, profile_id) do nothing
    returning 1
  )
  select count(*) into v_added from missing;

  if v_added > 0 then
    raise notice 'guardians added to their children''s squads: %', v_added;
  end if;
end $$;
