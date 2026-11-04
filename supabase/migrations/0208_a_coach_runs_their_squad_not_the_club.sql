-- 0208 — a coach runs their squad, not the club.
--
-- Joey, 4 Nov 2026: "why does Marcus (coach-only) see the full Admin
-- tab?" The hub offered a coach what the database refuses them (rolling
-- the season over, laying out grounds) and one thing it did not refuse:
-- starting a competition. 0019/0022 let any coach of an organisation
-- insert a competition under its name; the product direction gives
-- competitions to the club's staff and a league's organiser, and the
-- Admin hub now hides "Start a competition" from a coach. This makes the
-- database agree. Organising an existing competition is unchanged
-- (competitions_update / competitions_delete already name the organiser).
--
-- Written while the Supabase access token was dead (NIGHT_LOG, NEEDS JOEY
-- #12); applied by `npm run db:migrate` the day a new one exists, then
-- scripts/test-rls.sql (check 111) proves it.

drop policy if exists competitions_insert on public.competitions;
create policy competitions_insert on public.competitions for insert to authenticated
  with check ((select app_private.is_academy_staff(organiser_id)));
