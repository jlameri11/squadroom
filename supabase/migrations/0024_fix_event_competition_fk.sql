-- 0024_fix_event_competition_fk.sql
--
-- The composite foreign key pattern used everywhere else in this schema says
-- "this child row and its parent belong to the same tenant". That is exactly
-- right for a message in a channel, and exactly wrong here.
--
-- An event belongs to a CLUB. Its competition belongs to the ORGANISER. When
-- SPL runs the league those are different organisations, so the composite key
-- was asserting something untrue and blocking legitimate rows.

alter table public.events drop constraint events_competition_fkey;

alter table public.events
  add constraint events_competition_fkey
  foreign key (competition_id) references public.competitions(id) on delete set null;

comment on column public.events.competition_id is
  'Crosses the tenant boundary on purpose: the club owns the event, the
   organiser owns the competition, and for a league they are different
   organisations. Read access is still governed by events RLS, which is
   scoped to the club - being in a competition does not grant access to
   another club''s events.';
