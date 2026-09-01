-- 0040_contact_card_and_own_phone.sql
--
-- Tapping a name in chat should offer to call, text or WhatsApp them. Three
-- things had to change for that to be possible.
--
-- 1. Nobody could read their OWN number. 0012 revoked table-level select on
--    profiles and re-granted a column list that deliberately excluded phone.
--    Correct for other people's numbers, wrong for your own - it meant a
--    settings screen could not show you what we hold about you, and you
--    could not correct it.
-- 2. Nobody could CHANGE their number either, for the same reason.
-- 3. There was no single place that answered "may this person see that
--    person's number", so every screen would have re-implemented it.

create or replace function public.my_profile()
returns table (id uuid, full_name text, phone text, avatar_url text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.phone::text, p.avatar_url
    from public.profiles p
   where p.id = auth.uid();
$$;

grant execute on function public.my_profile() to authenticated;

-- Superseded by 0041, which parses what a human actually types.
create or replace function public.set_my_profile(p_full_name text, p_phone text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_phone text := public.normalise_phone(nullif(btrim(coalesce(p_phone, '')), ''));
begin
  if auth.uid() is null then
    raise exception 'must be signed in' using errcode = '42501';
  end if;
  if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'that does not look like a mobile number' using errcode = '22023';
  end if;

  -- One number, one person. Sharing a handset is common in families, but two
  -- accounts on one number makes "who sent this" unanswerable.
  if v_phone is not null and exists (
    select 1 from public.profiles where phone = v_phone::citext and id <> auth.uid()
  ) then
    raise exception 'that number is already used by another account' using errcode = '23505';
  end if;

  update public.profiles
     set full_name = coalesce(nullif(btrim(p_full_name), ''), full_name),
         phone     = coalesce(v_phone::citext, phone)
   where id = auth.uid();
end;
$$;

grant execute on function public.set_my_profile(text, text) to authenticated;

-- The contact card behind a name in chat.
--
-- One place decides whether a number comes back, so no screen can accidentally
-- be more generous than the academy allowed. Staff are always contactable -
-- that is the job. Everyone else follows directory_visibility.
create or replace function public.member_contact(p_academy uuid, p_profile uuid)
returns table (
  profile_id uuid,
  full_name  text,
  role       public.academy_role,
  teams      text[],
  phone      text,
  can_dm     boolean,
  is_me      boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_me       uuid := auth.uid();
  v_can_see  boolean;
  v_policy   public.dm_policy;
  v_me_staff boolean;
  v_them_staff boolean;
begin
  if not app_private.is_academy_member(p_academy) then
    raise exception 'not a member of this academy' using errcode = '42501';
  end if;

  v_can_see := app_private.can_see_contact_details(p_academy);
  select a.dm_policy into v_policy from public.academies a where a.id = p_academy;
  select am.role in ('owner','admin','coach') into v_me_staff
    from public.academy_members am where am.academy_id = p_academy and am.profile_id = v_me;
  select am.role in ('owner','admin','coach') into v_them_staff
    from public.academy_members am where am.academy_id = p_academy and am.profile_id = p_profile;

  return query
    select
      p.id, p.full_name, am.role,
      coalesce(array_agg(t.name order by t.name) filter (where t.id is not null), '{}'),
      case when v_can_see or coalesce(v_them_staff, false)
           then p.phone::text else null end,
      -- Same rule open_direct_channel enforces, so the button is only shown
      -- when pressing it would actually work.
      (p_profile <> v_me
       and (v_policy = 'open' or coalesce(v_me_staff,false) or coalesce(v_them_staff,false))),
      p_profile = v_me
    from public.academy_members am
    join public.profiles p on p.id = am.profile_id
    left join public.team_members tm on tm.profile_id = p.id and tm.academy_id = p_academy
    left join public.teams t on t.id = tm.team_id and t.status = 'active'
   where am.academy_id = p_academy
     and am.profile_id = p_profile
     and am.status = 'active'
   group by p.id, p.full_name, am.role, p.phone;
end;
$$;

grant execute on function public.member_contact(uuid, uuid) to authenticated;
