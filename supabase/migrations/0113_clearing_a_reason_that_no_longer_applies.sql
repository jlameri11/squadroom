-- 0113: 0111 said it cleared the reason. It did not.
--
-- The trigger's own comment claimed that changing away from 'no' clears the
-- note, and the code underneath it ran
--
--   new.note := nullif(btrim(coalesce(new.note, '')), '');
--
-- which normalises whitespace and nothing else. On the path the app takes it
-- looked right by accident: the client upserts the whole row, so `note` comes
-- in as null and the row ends up with no reason either way. On an UPDATE that
-- touches only the status — which the app now does, and which anybody writing
-- against the API would do — `new.note` is still the old reason and the
-- normalisation hands it straight back.
--
-- So a parent who marked a child out injured and then marked them available
-- left "Injured" attached to a 'yes', and a coach picking a team reads it.
-- Worse than no reason at all, because it is a reason that was once true.
--
-- Found by writing the test for the documented behaviour rather than for the
-- behaviour of the code. The comment was the spec and the comment was right.

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

  -- Not 'no', so there is nothing a reason could be about. Cleared outright
  -- rather than normalised: "Injured" next to "Going" is a coach misreading
  -- their own team sheet. This runs on INSERT as well, so a 'yes' arriving
  -- with a note attached does not get to keep it either.
  new.note := null;
  return new;
end;
$fn$;
