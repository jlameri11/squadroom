-- 0176: scan to check in.
--
-- W-06. 0161's check-in is a tap on the referee's own page, which proves
-- the referee's phone said so, not that the referee was at the ground.
-- A QR on the home manager's (or the league's) phone, scanned by the
-- referee, proves both were in the same place. The code is a per-game key;
-- knowing it does nothing unless you are the appointed referee, inside the
-- same window 0161 enforces, so a key in a screenshot is worth nothing.

alter table public.fixtures add column if not exists checkin_key uuid not null default gen_random_uuid();

create or replace function public.referee_check_in_by_key(p_fixture uuid, p_key uuid)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_fx public.fixtures;
  v_ap public.referee_appointments;
begin
  select * into v_fx from public.fixtures where id = p_fixture;
  if v_fx.id is null or v_fx.checkin_key <> p_key then
    raise exception 'that code is not for this game' using errcode = '22023';
  end if;
  select ap.* into v_ap from public.referee_appointments ap
   where ap.fixture_id = p_fixture and ap.status = 'accepted' and app_private.is_this_referee(ap.referee_id)
   limit 1;
  if v_ap.id is null then
    raise exception 'you are not appointed to this game' using errcode = '42501';
  end if;
  if v_fx.starts_at is null or now() < v_fx.starts_at - interval '3 hours' or now() > v_fx.starts_at + interval '2 hours' then
    raise exception 'check-in opens three hours before kick-off' using errcode = '22023';
  end if;
  update public.referee_appointments set checked_in_at = coalesce(checked_in_at, now()) where id = v_ap.id;
  return jsonb_build_object(
    'checked_in_at', (select checked_in_at from public.referee_appointments where id = v_ap.id),
    'game', (select h.display_name || ' v ' || a.display_name
               from public.fixtures f left join public.competition_entries h on h.id = f.home_entry_id left join public.competition_entries a on a.id = f.away_entry_id
              where f.id = p_fixture),
    'competition_id', v_fx.competition_id
  );
end;
$fn$;

-- The key, for whoever may show it: the game's managers and the league.
create or replace function public.fixture_checkin_key(p_fixture uuid)
returns uuid
language sql stable security definer set search_path = public as $fn$
  select f.checkin_key from public.fixtures f
   where f.id = p_fixture
     and (app_private.may_run(f.competition_id, 'grounds')
          or app_private.may_run(f.competition_id, 'referees')
          or coalesce(app_private.can_manage_entry(f.home_entry_id), false)
          or coalesce(app_private.can_manage_entry(f.away_entry_id), false));
$fn$;

grant execute on function public.referee_check_in_by_key(uuid, uuid) to authenticated;
grant execute on function public.fixture_checkin_key(uuid) to authenticated;
