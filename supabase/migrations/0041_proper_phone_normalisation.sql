-- 0041_proper_phone_normalisation.sql
--
-- normalise_phone was written for one job: auth.users.phone arrives from
-- Supabase as bare digits, so prepending '+' was enough. It was never meant
-- to parse what a human types, and "0400 111 222" came out as
-- "+0400 111 222" and failed validation.
--
-- The client already does this properly in lib/join.ts. Having the rule in
-- one language and not the other is how the two drift apart, so the database
-- gets the same logic and the client can rely on it.

create or replace function public.to_e164(p_raw text, p_default_country text default '61')
returns text
language plpgsql immutable as $$
declare
  v text := regexp_replace(coalesce(p_raw, ''), '[^0-9+]', '', 'g');
begin
  if v = '' then
    return null;
  end if;

  if left(v, 1) = '+' then
    return case when v ~ '^\+[1-9][0-9]{7,14}$' then v else null end;
  end if;

  -- 00 as an international prefix, which some people still type.
  if left(v, 2) = '00' then
    v := '+' || substr(v, 3);
    return case when v ~ '^\+[1-9][0-9]{7,14}$' then v else null end;
  end if;

  -- Australian national format: a leading 0 is the trunk prefix and is
  -- replaced by the country code, not kept.
  if left(v, 1) = '0' then
    v := '+' || p_default_country || substr(v, 2);
    return case when v ~ '^\+[1-9][0-9]{7,14}$' then v else null end;
  end if;

  if left(v, length(p_default_country)) = p_default_country then
    v := '+' || v;
    return case when v ~ '^\+[1-9][0-9]{7,14}$' then v else null end;
  end if;

  -- Anything else we cannot place with confidence. Returning null rather
  -- than guessing: a half-parsed number reaches the wrong person.
  return null;
end;
$$;

create or replace function public.set_my_profile(p_full_name text, p_phone text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_raw   text := nullif(btrim(coalesce(p_phone, '')), '');
  v_phone text := public.to_e164(v_raw);
begin
  if auth.uid() is null then
    raise exception 'must be signed in' using errcode = '42501';
  end if;

  if v_raw is not null and v_phone is null then
    raise exception 'That does not look like an Australian mobile number.'
      using errcode = '22023';
  end if;

  if v_phone is not null and exists (
    select 1 from public.profiles where phone = v_phone::citext and id <> auth.uid()
  ) then
    raise exception 'That number is already used by another account.' using errcode = '23505';
  end if;

  update public.profiles
     set full_name = coalesce(nullif(btrim(p_full_name), ''), full_name),
         phone     = coalesce(v_phone::citext, phone)
   where id = auth.uid();
end;
$$;

grant execute on function public.to_e164(text, text) to authenticated;
grant execute on function public.set_my_profile(text, text) to authenticated;
