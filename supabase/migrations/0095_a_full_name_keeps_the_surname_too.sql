-- 0095: and the same mistake in the other branch.
--
-- 0094 fixed the initials mode dropping the surname when a preferred name was
-- a single word. Full mode had exactly the same bug and I shipped 0094
-- without checking it: `coalesce(preferred, full_name)` returns "Teo" for a
-- child registered as Leo Whitfield who goes by Teo, so the FULL team sheet
-- was less informative than the abbreviated one.
--
-- The rule, stated once for both modes: the GIVEN name is what the child is
-- called, and the SURNAME always comes from the registered name. A preferred
-- name of two or more words is treated as a complete name and used as it is —
-- that is somebody who has given a full alternative, not a nickname.
--
--   registered          preferred   full                 initials
--   Leo Whitfield       —           Leo Whitfield        Leo W.
--   Leo Whitfield       Teo         Teo Whitfield        Teo W.
--   Leo Whitfield       Teo Jones   Teo Jones            Teo J.
--   Ronaldinho          —           Ronaldinho           Ronaldinho
--   Mohamed Al Rashid   —           Mohamed Al Rashid    Mohamed R.

create or replace function app_private.public_player_name(
  p_full      text,
  p_preferred text,
  p_mode      public.public_names_mode,
  p_hidden    boolean
)
returns text
language plpgsql immutable set search_path = public as $fn$
declare
  v_full     text := btrim(coalesce(p_full, ''));
  v_pref     text := btrim(coalesce(p_preferred, ''));
  v_parts    text[];
  v_given    text;
  v_surname  text;
begin
  -- A child who has opted out is never named, whatever the club has set.
  if p_hidden or p_mode = 'off' then
    return null;
  end if;
  if v_full = '' and v_pref = '' then
    return null;
  end if;

  -- A preferred name of two or more words is a complete name, not a nickname.
  if array_length(string_to_array(v_pref, ' '), 1) >= 2 then
    if p_mode = 'full' then
      return v_pref;
    end if;
    v_parts := string_to_array(v_pref, ' ');
  else
    v_parts := string_to_array(nullif(v_full, ''), ' ');
  end if;

  v_given := coalesce(
    nullif(split_part(v_pref, ' ', 1), ''),
    nullif(v_parts[1], ''),
    v_full
  );

  v_surname := case
    when v_parts is null or array_length(v_parts, 1) < 2 then null
    else v_parts[array_length(v_parts, 1)]
  end;

  -- Nothing to abbreviate: a one-word registered name is returned as it is
  -- rather than having an initial invented for it.
  if v_surname is null or v_surname = '' then
    return v_given;
  end if;

  if p_mode = 'full' then
    -- Everything after the given name comes from the registered name, so a
    -- double-barrelled surname survives.
    return v_given || ' ' ||
           array_to_string(v_parts[2:array_length(v_parts, 1)], ' ');
  end if;

  return v_given || ' ' || upper(left(v_surname, 1)) || '.';
end;
$fn$;
