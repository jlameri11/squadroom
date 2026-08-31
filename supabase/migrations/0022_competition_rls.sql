-- 0022_competition_rls.sql
--
-- The rule this file exists to enforce:
--
--   Being in a competition together lets you see the DRAW. It does not let
--   you see each other's PEOPLE.
--
-- A visiting coach at a gala day can read every fixture, every result and
-- every ladder. They cannot read another club's messages, members, children
-- or phone numbers, because none of the policies on those tables mention
-- competitions at all. That separation is the whole design.

create or replace function app_private.is_competition_organiser(p_competition uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.competitions c
     where c.id = p_competition
       and app_private.is_academy_staff(c.organiser_id)
  );
$$;

create or replace function app_private.is_competition_participant(p_competition uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.competitions c
     where c.id = p_competition and app_private.is_academy_member(c.organiser_id)
  ) or exists (
    select 1
      from public.competition_clubs cc
      join public.academy_members am
        on am.academy_id = cc.academy_id
       and am.profile_id = auth.uid()
       and am.status = 'active'
     where cc.competition_id = p_competition
       and cc.status = 'active'
  ) or exists (
    select 1 from public.competitions c
     where c.id = p_competition and c.visibility = 'public'
  );
$$;

-- May I speak for this club inside this competition - enter scores, manage
-- our entries? Club staff and the coach of the entered team.
create or replace function app_private.can_manage_entry(p_entry uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.competition_entries e
     where e.id = p_entry
       and (
         app_private.is_competition_organiser(e.competition_id)
         or (e.academy_id is not null and app_private.is_academy_staff(e.academy_id))
         or (e.team_id is not null and app_private.is_team_coach(e.team_id))
       )
  );
$$;

revoke execute on function
  app_private.is_competition_organiser(uuid),
  app_private.is_competition_participant(uuid),
  app_private.can_manage_entry(uuid)
  from public, anon;
grant execute on function
  app_private.is_competition_organiser(uuid),
  app_private.is_competition_participant(uuid),
  app_private.can_manage_entry(uuid)
  to authenticated, service_role;

-- Competitions: the old policies scoped everything to the owning academy,
-- which was the single-tenant assumption. Replace them.
drop policy if exists competitions_select on public.competitions;
drop policy if exists competitions_insert on public.competitions;
drop policy if exists competitions_update on public.competitions;
drop policy if exists competitions_delete on public.competitions;

create policy competitions_select on public.competitions for select to authenticated
  using ((select app_private.is_competition_participant(id)));
create policy competitions_insert on public.competitions for insert to authenticated
  with check ((select app_private.is_academy_coach(organiser_id)));
create policy competitions_update on public.competitions for update to authenticated
  using ((select app_private.is_competition_organiser(id)))
  with check ((select app_private.is_competition_organiser(id)));
create policy competitions_delete on public.competitions for delete to authenticated
  using ((select app_private.is_competition_organiser(id)));

-- Every participant can see the list of clubs - you cannot run a draw without
-- knowing who you are playing - but that is a club NAME, not its membership.
create policy competition_clubs_select on public.competition_clubs for select to authenticated
  using (
    (select app_private.is_competition_participant(competition_id))
    or (select app_private.is_academy_member(academy_id))
  );
create policy competition_clubs_insert on public.competition_clubs for insert to authenticated
  with check ((select app_private.is_competition_organiser(competition_id)));
create policy competition_clubs_update on public.competition_clubs for update to authenticated
  using (
    (select app_private.is_competition_organiser(competition_id))
    or (select app_private.is_academy_staff(academy_id))
  )
  with check (
    (select app_private.is_competition_organiser(competition_id))
    or (select app_private.is_academy_staff(academy_id))
  );
create policy competition_clubs_delete on public.competition_clubs for delete to authenticated
  using ((select app_private.is_competition_organiser(competition_id)));

create policy competition_entries_select on public.competition_entries for select to authenticated
  using ((select app_private.is_competition_participant(competition_id)));
create policy competition_entries_insert on public.competition_entries for insert to authenticated
  with check (
    (select app_private.is_competition_organiser(competition_id))
    or (academy_id is not null and (select app_private.is_academy_staff(academy_id)))
  );
create policy competition_entries_update on public.competition_entries for update to authenticated
  using ((select app_private.can_manage_entry(id)))
  with check ((select app_private.can_manage_entry(id)));
create policy competition_entries_delete on public.competition_entries for delete to authenticated
  using ((select app_private.is_competition_organiser(competition_id)));
