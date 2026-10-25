-- 0094: "Teo" is not enough; "Teo W." is.
--
-- 0093's initials mode took the first word and the last word's initial of
-- whichever name it was using. With a preferred name that is a single word —
-- which is the normal case, because a preferred name IS usually just the
-- given name — it returned "Teo" and dropped the surname entirely.
--
-- On a public team sheet that is ambiguous the moment two Teos play in the
-- same division, and the surname initial is the entire reason the mode
-- exists. The given name comes from the preferred name when there is one;
-- the initial always comes from the registered surname.

create or replace function app_private.public_player_name(
  p_full      text,
  p_preferred text,
  p_mode      public.public_names_mode,
  p_hidden    boolean
)
returns text
language plpgsql immutable set search_path = public as $fn$
declare
  v_full   text := btrim(coalesce(p_full, ''));
  v_pref   text := btrim(coalesce(p_preferred, ''));
  v_parts  text[];
  v_given  text;
  v_surname text;
begin
  -- A child who has opted out is never named, whatever the club has set.
  if p_hidden or p_mode = 'off' then
    return null;
  end if;

  if v_full = '' and v_pref = '' then
    return null;
  end if;

  if p_mode = 'full' then
    return coalesce(nullif(v_pref, ''), v_full);
  end if;

  -- initials: the name they are called by, plus the registered surname's
  -- first letter.
  v_parts := string_to_array(nullif(v_full, ''), ' ');
  v_given := coalesce(
    nullif(split_part(v_pref, ' ', 1), ''),
    nullif(v_parts[1], ''),
    v_full
  );
  v_surname := case
    when v_parts is null or array_length(v_parts, 1) < 2 then null
    else v_parts[array_length(v_parts, 1)]
  end;

  -- One-word registered name and nothing to abbreviate: return it as it is
  -- rather than inventing an initial.
  if v_surname is null or v_surname = '' then
    return v_given;
  end if;

  return v_given || ' ' || upper(left(v_surname, 1)) || '.';
end;
$fn$;
