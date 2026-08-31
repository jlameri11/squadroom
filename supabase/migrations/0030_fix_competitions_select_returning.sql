-- 0030_fix_competitions_select_returning.sql
--
-- Creating a competition worked. Creating one and reading it back did not.
--
-- competitions_select called is_competition_participant(id), which looks the
-- row up in `competitions` to find its organiser. That function is STABLE,
-- and a STABLE function sees the snapshot from the START of the statement -
-- so during INSERT ... RETURNING it cannot see the row being inserted. The
-- policy was asking "does this row exist?" about a row that did not exist
-- yet, and every client doing .insert().select() got a flat RLS denial.
--
-- Marking the function VOLATILE would fix it and cost the per-statement
-- caching that keeps RLS fast at hundreds of academies. The real error was
-- re-reading a row the policy already has in front of it: `organiser_id` is
-- a column on the row being checked, so use it directly.

create or replace function app_private.is_club_in_competition(p_competition uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.competition_clubs cc
      join public.academy_members am
        on am.academy_id = cc.academy_id
       and am.profile_id = auth.uid()
       and am.status = 'active'
     where cc.competition_id = p_competition
       and cc.status = 'active'
  );
$$;

revoke execute on function app_private.is_club_in_competition(uuid) from public, anon;
grant execute on function app_private.is_club_in_competition(uuid) to authenticated, service_role;

drop policy competitions_select on public.competitions;

create policy competitions_select on public.competitions for select to authenticated
  using (
    -- Straight off the row. No self-read, so it works under RETURNING.
    (select app_private.is_academy_member(organiser_id))
    or (select app_private.is_club_in_competition(id))
    or visibility = 'public'
  );
