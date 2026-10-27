-- 0116: 0113 was right about the bug and wrong about the blast radius.
--
-- 0113 fixed a real defect — a child marked out injured and then marked
-- available kept "Injured" sitting next to "Going" — and fixed it with
-- `new.note := null` for every status that is not 'no'. Which also throws
-- away "leaving at half time" on a maybe, and "here for the morning games
-- only" on a yes. Both of those are in the seed, both are the kind of thing a
-- parent types once and a coach actually uses, and neither is a reason for
-- being absent.
--
-- Caught by test-polls, on an assertion written long before any of this
-- existed: the note has to survive a poll being turned into an event. That is
-- the test earning its keep — the feature under test was availability polls,
-- and what it caught was a trigger three migrations away.
--
-- THE RULE, stated properly this time. A note is cleared only when it was a
-- reason for being OUT and the answer has changed to something else without
-- a new note being supplied. Specifically:
--
--   'no'                      → required, kept, trimmed
--   insert of anything else   → kept as given (a poll answer, a parent's own
--                               note on a maybe)
--   'no' → something else, note untouched  → cleared; it was about absence
--   'no' → something else, note supplied   → the new note wins
--
-- The middle case is the one that needs `is not distinct from` rather than
-- `=`: both sides are nullable, and `null = null` is null, so an `=` test
-- would never fire for the plain status update this exists to handle.

create or replace function public.require_a_reason()
returns trigger
language plpgsql set search_path = public as $fn$
begin
  if new.status = 'no' then
    if nullif(btrim(coalesce(new.note, '')), '') is null then
      raise exception 'Say why they cannot play — the coach needs to know'
        using errcode = '22023';
    end if;
    -- Kept, but tidied. A reason is free text a parent typed in a car park.
    new.note := btrim(new.note);
    return new;
  end if;

  -- Moving off 'no' without saying anything new: whatever is there was a
  -- reason for being absent, and it is not true any more.
  if old is not null
     and old.status = 'no'
     and new.note is not distinct from old.note then
    new.note := null;
    return new;
  end if;

  -- Otherwise the note is this person's own, about an answer that is not
  -- absence. Trimmed, never discarded.
  new.note := nullif(btrim(coalesce(new.note, '')), '');
  return new;
end;
$fn$;
