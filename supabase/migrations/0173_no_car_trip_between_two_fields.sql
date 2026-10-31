-- 0173: no car trip between two fields.
--
-- 0161's clash rule gave every game a 30-minute buffer for getting across
-- town, and applied it to the game on the next field over. A referee could
-- never take 9:00 on Field 1 and 10:00 on Field 2 at the same ground,
-- which is the one thing every referee secretary relies on. The buffer
-- now applies only between DIFFERENT grounds; at the same ground a game
-- ends at full time. The proposal (0172) counts the games it has already
-- drafted for a referee toward their load, so a day spreads out instead
-- of piling onto whoever had the fewest last week.

create or replace function app_private.fixture_span(p_fixture uuid)
returns tstzrange language sql stable security definer set search_path = public as $fn$
  select tstzrange(f.starts_at, f.starts_at + make_interval(mins => coalesce(r.match_length_mins, 60)), '[)')
    from public.fixtures f
    cross join lateral app_private.division_rules(f.competition_id, f.division) r
   where f.id = p_fixture and f.starts_at is not null;
$fn$;

-- Do these two games need the same person in two places?
create or replace function app_private.fixtures_clash(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select case
    when a.id is null or b.id is null or a.starts_at is null or b.starts_at is null then false
    when coalesce(va.name, a.venue_label) is not distinct from coalesce(vb.name, b.venue_label)
      then app_private.fixture_span(a.id) && app_private.fixture_span(b.id)
    else app_private.fixture_window(a.id) && app_private.fixture_window(b.id)
  end
    from public.fixtures a
    left join public.venues va on va.id = a.venue_id,
         public.fixtures b
    left join public.venues vb on vb.id = b.venue_id
   where a.id = p_a and b.id = p_b;
$fn$;

create or replace function app_private.referee_unavailable_reason(p_referee uuid, p_fixture uuid)
returns text language plpgsql stable security definer set search_path = public as $fn$
declare
  v_window tstzrange := app_private.fixture_window(p_fixture);
  v_reason text;
  v_other  text;
begin
  if v_window is null then
    return null;
  end if;
  select coalesce(nullif(b.reason, ''), 'not available') into v_reason
    from public.referee_blockouts b
   where b.referee_id = p_referee
     and tstzrange(b.starts_at, b.ends_at, '[)') && v_window
   limit 1;
  if v_reason is not null then
    return 'blocked out: ' || v_reason;
  end if;
  select h.display_name || ' v ' || a.display_name into v_other
    from public.referee_appointments ap
    join public.fixtures f on f.id = ap.fixture_id
    left join public.competition_entries h on h.id = f.home_entry_id
    left join public.competition_entries a on a.id = f.away_entry_id
   where ap.referee_id = p_referee
     and ap.fixture_id <> p_fixture
     and ap.status in ('offered', 'accepted')
     and app_private.fixtures_clash(f.id, p_fixture)
   limit 1;
  if v_other is not null then
    return 'already on ' || v_other;
  end if;
  return null;
end;
$fn$;

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
  v_taken_fx uuid[] := '{}';
  v_out jsonb := '[]'::jsonb;
  v_i integer;
  v_clash boolean;
  v_same_ground boolean;
  v_draft integer;
  v_score integer;
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
    v_pick := null; v_pick_name := null; v_pick_load := null; v_why := null;

    for r in
      select rf.id, rf.full_name,
             (select count(*) from public.referee_appointments ap
               where ap.referee_id = rf.id and ap.competition_id = p_competition and ap.status in ('offered', 'accepted')) as load
        from public.referees rf
       where rf.academy_id = v_org and rf.status = 'active'
       order by rf.full_name
    loop
      if app_private.referee_unavailable_reason(r.id, f.id) is not null then continue; end if;
      v_clash := false; v_same_ground := false; v_draft := 0;
      for v_i in 1..coalesce(array_length(v_taken_ref, 1), 0) loop
        if v_taken_ref[v_i] = r.id then
          v_draft := v_draft + 1;
          if app_private.fixtures_clash(v_taken_fx[v_i], f.id) then v_clash := true; end if;
          -- Straight before, at this ground: keeping them here beats a car trip.
          if (select coalesce(vv.name, x.venue_label) from public.fixtures x left join public.venues vv on vv.id = x.venue_id where x.id = v_taken_fx[v_i]) is not distinct from f.venue
             and upper(app_private.fixture_span(v_taken_fx[v_i])) between f.starts_at - interval '45 minutes' and f.starts_at + interval '5 minutes' then
            v_same_ground := true;
          end if;
        end if;
      end loop;
      if v_clash then continue; end if;
      -- Lightest load wins, counting today's draft; a referee already at
      -- this ground straight before wins a tie and beats a one-game gap.
      v_score := (r.load + v_draft) * 2 - case when v_same_ground then 3 else 0 end;
      if v_pick is null or v_score < v_pick_load then
        v_pick := r.id; v_pick_name := r.full_name; v_pick_load := v_score;
      end if;
    end loop;

    if v_pick is null then
      v_why := 'nobody free';
    else
      v_taken_ref := v_taken_ref || v_pick;
      v_taken_fx := v_taken_fx || f.id;
    end if;

    v_out := v_out || jsonb_build_object(
      'fixture_id', f.id, 'starts_at', f.starts_at, 'division', f.division, 'venue', f.venue, 'field', f.field_label,
      'home', f.home, 'away', f.away,
      'referee_id', v_pick, 'referee', v_pick_name,
      'load', (select count(*) from public.referee_appointments ap where ap.referee_id = v_pick and ap.competition_id = p_competition and ap.status in ('offered', 'accepted')),
      'why', v_why
    );
  end loop;
  return v_out;
end;
$fn$;
