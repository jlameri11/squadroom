-- 0105: "alphabetically first" is a terrible default organisation.
--
-- 0068 resolved a person's default academy with `order by a.name limit 1`.
-- That was fine while everybody was in exactly one. It is not fine now, and
-- the failure arrived in the demo data within a day of the switcher shipping:
-- somebody tried the sign-up flow and created an empty academy called
-- "NRIFA", which sorts before "NRIFA Football Academy" — so the owner of a
-- twenty-five-member club was defaulted into a club with nothing in it. The
-- home screen, chat, fixtures and `needs_you` all dutifully showed an empty
-- club and were all correct.
--
-- The browser remembers a choice once the switcher is used (0080), so this
-- default only decides the FIRST load on a device. That is precisely why it
-- matters: it is the only impression a new session gets, and "your club is
-- empty" is a bad one.
--
-- THE HEURISTIC: the organisation with the most active members, then the
-- oldest. Both parts earn their place. Member count beats a one-person shell
-- every time without needing to know what a shell is. Oldest-first breaks the
-- tie towards the club somebody has been in longest rather than whatever they
-- made most recently by accident.
--
-- Deliberately NOT "most recently used": that would need a column written on
-- every page load, and 0080 already explains why a stored pointer is the
-- wrong place for this — two tabs can be two organisations.

create or replace function app_private.my_first_academy()
returns uuid
language sql stable security definer set search_path = public as $fn$
  select am.academy_id
    from public.academy_members am
    join public.academies a on a.id = am.academy_id
   where am.profile_id = auth.uid() and am.status = 'active'
   order by
     -- The club with people in it wins. Counted over active members, so an
     -- academy somebody founded and abandoned does not outrank one they
     -- actually coach at.
     (
       select count(*)
         from public.academy_members other
        where other.academy_id = a.id and other.status = 'active'
     ) desc,
     -- Then the one they have been in longest, rather than the one they
     -- created last.
     a.created_at,
     -- And a stable tiebreak, so the answer never changes between two calls
     -- in the same session.
     a.id
   limit 1;
$fn$;
