-- 0172: a day of games, appointed at once.
--
-- W-05. A referee secretary with twenty-four games on a Saturday does not
-- want to appoint them one at a time; they want a sensible first draft to
-- argue with. propose_referee_allocation makes one — nobody who is blocked
-- out or already on another pitch, the lightest load first, the same
-- referee kept at one ground when they have back-to-back games — and
-- changes NOTHING. apply_referee_allocation turns the draft into offers,
-- each the ordinary appoint_referee (so every rule and every push still
-- applies), stamped with a batch id. undo_referee_allocation withdraws the
-- batch's offers that nobody has accepted yet; an acceptance is a human's
-- word and is not undone by a button.

alter table public.referee_appointments add column if not exists batch_id uuid;
create index if not exists referee_appointments_batch_idx on public.referee_appointments (batch_id) where batch_id is not null;

create or replace function public.propose_referee_allocation(p_competition uuid, p_date date, p_division text default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_org uuid;
  v_tz text;
  f record;
  r record;
  v_pick uuid;
  v_pick_name text;
  v_pick_load integer;
  v_why text;
  v_taken_ref uuid[] := '{}';
  v_taken_win tstzrange[] := '{}';
  v_taken_venue text[] := '{}';
  v_window tstzrange;
  v_out jsonb := '[]'::jsonb;
  v_i integer;
  v_clash boolean;
  v_same_ground boolean;
begin
  select c.organiser_id, coalesce(a.timezone, 'Australia/Sydney') into v_org, v_tz
    from public.competitions c join public.academies a on a.id = c.organiser_id where c.id = p_competition;
  if v_org is null or not app_private.may_run(p_competition, 'referees') then
    raise exception 'only the referee coordinator proposes appointments' using errcode = '42501';
  end if;

  for f in
    select fx.id, fx.starts_at, fx.division, coalesce(v.name, fx.venue_label) as venue, fx.field_label,
           h.display_name as home, a.display_name as away
      from public.fixtures fx
      left join public.venues v on v.id = fx.venue_id
      left join public.competition_entries h on h.id = fx.home_entry_id
      left join public.competition_entries a on a.id = fx.away_entry_id
     where fx.competition_id = p_competition
       and fx.status = 'scheduled' and fx.starts_at is not null
       and (fx.starts_at at time zone v_tz)::date = p_date
       and (p_division is null or fx.division = p_division)
       and not exists (select 1 from public.referee_appointments ap
                        where ap.fixture_id = fx.id and ap.role = 'referee' and ap.status in ('offered', 'accepted'))
     order by fx.starts_at, fx.field_label
  loop
    v_window := app_private.fixture_window(f.id);
    v_pick := null; v_pick_name := null; v_pick_load := null; v_why := null;

    for r in
      select rf.id, rf.full_name,
             (select count(*) from public.referee_appointments ap
               where ap.referee_id = rf.id and ap.competition_id = p_competition and ap.status in ('offered', 'accepted')) as load
        from public.referees rf
       where rf.academy_id = v_org and rf.status = 'active'
       order by load, rf.full_name
    loop
      if app_private.referee_unavailable_reason(r.id, f.id) is not null then continue; end if;
      -- Already in this draft at an overlapping time?
      v_clash := false; v_same_ground := false;
      for v_i in 1..coalesce(array_length(v_taken_ref, 1), 0) loop
        if v_taken_ref[v_i] = r.id then
          if v_taken_win[v_i] && v_window then v_clash := true; end if;
          if v_taken_venue[v_i] is not distinct from f.venue
             and upper(v_taken_win[v_i]) between lower(v_window) - interval '45 minutes' and lower(v_window) + interval '5 minutes' then
            v_same_ground := true;
          end if;
        end if;
      end loop;
      if v_clash then continue; end if;
      -- First free referee by load wins, unless one is already at this
      -- ground straight before: keeping them there beats a car trip.
      if v_pick is null or (v_same_ground and v_pick_load is not null and r.load <= v_pick_load + 1) then
        v_pick := r.id; v_pick_name := r.full_name; v_pick_load := r.load;
        if v_same_ground then exit; end if;
      end if;
    end loop;

    if v_pick is null then
      v_why := 'nobody free';
    else
      v_taken_ref := v_taken_ref || v_pick;
      v_taken_win := v_taken_win || v_window;
      v_taken_venue := v_taken_venue || f.venue;
    end if;

    v_out := v_out || jsonb_build_object(
      'fixture_id', f.id, 'starts_at', f.starts_at, 'division', f.division, 'venue', f.venue, 'field', f.field_label,
      'home', f.home, 'away', f.away,
      'referee_id', v_pick, 'referee', v_pick_name, 'load', v_pick_load, 'why', v_why
    );
  end loop;
  return v_out;
end;
$fn$;

create or replace function public.apply_referee_allocation(p_competition uuid, p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_batch uuid := gen_random_uuid();
  r jsonb;
  v_id uuid;
  v_n integer := 0;
  v_failed jsonb := '[]'::jsonb;
begin
  if not app_private.may_run(p_competition, 'referees') then
    raise exception 'only the referee coordinator appoints' using errcode = '42501';
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    if coalesce(r->>'referee_id', '') = '' then continue; end if;
    begin
      v_id := public.appoint_referee((r->>'fixture_id')::uuid, (r->>'referee_id')::uuid, 'referee');
      update public.referee_appointments set batch_id = v_batch where id = v_id;
      v_n := v_n + 1;
    exception when others then
      v_failed := v_failed || jsonb_build_object('fixture_id', r->>'fixture_id', 'why', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('batch_id', v_batch, 'appointed', v_n, 'failed', v_failed);
end;
$fn$;

create or replace function public.undo_referee_allocation(p_batch uuid)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_comp uuid;
  ap record;
  v_undone integer := 0;
  v_kept integer := 0;
begin
  select competition_id into v_comp from public.referee_appointments where batch_id = p_batch limit 1;
  if v_comp is null then
    return jsonb_build_object('undone', 0, 'kept', 0);
  end if;
  if not app_private.may_run(v_comp, 'referees') then
    raise exception 'only the referee coordinator undoes a batch' using errcode = '42501';
  end if;
  for ap in select id, status from public.referee_appointments where batch_id = p_batch loop
    if ap.status = 'offered' then
      perform public.withdraw_appointment(ap.id, 'the day was re-done');
      v_undone := v_undone + 1;
    elsif ap.status = 'accepted' then
      v_kept := v_kept + 1;
    end if;
  end loop;
  return jsonb_build_object('undone', v_undone, 'kept', v_kept);
end;
$fn$;

grant execute on function public.propose_referee_allocation(uuid, date, text) to authenticated;
grant execute on function public.apply_referee_allocation(uuid, jsonb) to authenticated;
grant execute on function public.undo_referee_allocation(uuid) to authenticated;
