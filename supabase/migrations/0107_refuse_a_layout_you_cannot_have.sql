-- 0107: saving a section you are not entitled to silently ate the layout.
--
-- 0106 filtered 'owing' out of `home_layout` on the way OUT, which is the
-- right place for the safeguard — a stored layout outlives the role that
-- justified it, and somebody who stops being an admin should not get an
-- error where a section used to be.
--
-- But `set_home_sections` accepted it on the way IN. So a parent saving
-- ["owing", "upcoming"] was told it worked and got a home screen with one
-- section on it. Nothing leaked — the filter held, and `outstanding_fees`
-- refuses a parent anyway — but they would reasonably conclude the editor was
-- broken, and they would be half right.
--
-- Found by testing the save rather than the read. The read was the part I had
-- thought about.
--
-- Fail loudly on the write, keep filtering on the read. The two are not
-- redundant: the write protects somebody from saving nonsense now, and the
-- read protects them from a role change later.

create or replace function public.set_home_sections(p_sections jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_me       uuid := auth.uid();
  v_academy  uuid;
  v_is_admin boolean := false;
begin
  if v_me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if not app_private.home_sections_ok(p_sections) then
    raise exception 'that is not a layout this app can render' using errcode = '22023';
  end if;

  if p_sections is not null then
    v_academy := app_private.my_academy(null);
    if v_academy is not null then
      v_is_admin := app_private.is_academy_staff(v_academy);
    end if;

    -- Named in the message, because "that layout is not allowed" leaves
    -- somebody guessing which of six rows was the problem.
    if not v_is_admin and p_sections ? 'owing' then
      raise exception '“Owed to the club” is only for club admins'
        using errcode = '42501';
    end if;

    -- A layout with nothing on it is a blank screen somebody cannot get out
    -- of without finding the editor again.
    if jsonb_array_length(p_sections) = 0 then
      raise exception 'keep at least one section on your home screen'
        using errcode = '22023';
    end if;

    -- The same section twice would render it twice.
    if (select count(distinct s) from jsonb_array_elements_text(p_sections) s)
       <> jsonb_array_length(p_sections) then
      raise exception 'that layout repeats a section' using errcode = '22023';
    end if;
  end if;

  insert into public.user_settings (profile_id, home_sections)
  values (v_me, p_sections)
  on conflict (profile_id) do update
    set home_sections = excluded.home_sections,
        updated_at = now();

  return public.home_layout(null);
end;
$fn$;

revoke execute on function public.set_home_sections(jsonb) from public, anon;
grant execute on function public.set_home_sections(jsonb) to authenticated;
