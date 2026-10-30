-- 0165: areas are appended, not parsed.
--
-- 0164's my_competition_access wrote `v_areas || 'staff'`, which Postgres
-- resolved as array || array and then failed to parse "staff" as an array
-- literal — so every signed-in caller got an error and the page showed
-- nobody any controls. array_append says what was meant.
create or replace function public.my_competition_access(p_competition uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_org uuid;
  v_areas text[] := '{}';
begin
  select organiser_id into v_org from public.competitions where id = p_competition;
  if v_org is null then return jsonb_build_object('areas', to_jsonb(v_areas)); end if;
  if coalesce(app_private.is_academy_staff(v_org), false) then v_areas := array_append(v_areas, 'staff'); end if;
  if app_private.may_run(p_competition, 'competition') then v_areas := array_append(v_areas, 'competition'); end if;
  if app_private.may_run(p_competition, 'referees')    then v_areas := array_append(v_areas, 'referees'); end if;
  if app_private.may_run(p_competition, 'discipline')  then v_areas := array_append(v_areas, 'discipline'); end if;
  if app_private.may_run(p_competition, 'grounds')     then v_areas := array_append(v_areas, 'grounds'); end if;
  return jsonb_build_object('areas', to_jsonb(v_areas));
end;
$fn$;
grant execute on function public.my_competition_access(uuid) to authenticated;
