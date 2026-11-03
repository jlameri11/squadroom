-- 0201: the file says who won.
--
-- F-05. A league's results export carries scores. 0121 imports the games;
-- this fills in the results on the games it just imported (or imported
-- last week), by the same rule set_event_result uses: ours and theirs,
-- never home and away, and the outcome worked out once in the database.
-- A row with no score leaves the result alone — a re-import of next week's
-- draw must not blank last week's win.
--
-- And the form, for the squad's own people: the last few results as W/D/L
-- with the totals, read by any member of the squad, written by nobody here.

drop function if exists public.apply_imported_results(uuid, uuid, jsonb);
create or replace function public.apply_imported_results(p_academy uuid, p_team uuid, p_events jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_staff   boolean;
  v_tz      text;
  v_item    jsonb;
  v_team    uuid;
  v_ours    integer;
  v_theirs  integer;
  v_home    boolean;
  v_event   uuid;
  v_ref     text;
  v_start   timestamptz;
  v_set     integer := 0;
  v_missed  integer := 0;
begin
  v_staff := coalesce(app_private.is_academy_staff(p_academy), false);
  if not (v_staff or (p_team is not null and coalesce(app_private.is_team_coach(p_team), false))) then
    raise exception 'only the club''s staff or the squad''s coach can import results' using errcode = '42501';
  end if;
  select coalesce(timezone, 'Australia/Sydney') into v_tz from public.academies where id = p_academy;

  for v_item in select * from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) loop
    v_ours := nullif(btrim(coalesce(v_item ->> 'our_score', '')), '')::integer;
    v_theirs := nullif(btrim(coalesce(v_item ->> 'their_score', '')), '')::integer;
    if v_ours is null or v_theirs is null then
      continue;   -- no result in this row: nothing to say
    end if;
    v_team := coalesce(nullif(v_item ->> 'team_id', '')::uuid, p_team);
    if v_team is null or not exists (select 1 from public.teams t where t.id = v_team and t.academy_id = p_academy) then
      v_missed := v_missed + 1; continue;
    end if;
    if not (v_staff or coalesce(app_private.is_team_coach(v_team), false)) then
      v_missed := v_missed + 1; continue;
    end if;
    v_home := nullif(v_item ->> 'was_home', '')::boolean;

    -- The game: by the file's reference first (what makes a re-import an
    -- update), else the squad's game on that local day against that side.
    v_ref := nullif(btrim(coalesce(v_item ->> 'external_ref', '')), '');
    v_event := null;
    if v_ref is not null then
      select e.id into v_event from public.events e
       where e.academy_id = p_academy and e.external_ref = v_ref limit 1;
    end if;
    if v_event is null and nullif(v_item ->> 'local_date', '') is not null then
      v_start := ((v_item ->> 'local_date') || ' ' || coalesce(nullif(v_item ->> 'local_time', ''), '00:00'))::timestamp at time zone v_tz;
      select e.id into v_event from public.events e
       where e.team_id = v_team and e.type = 'match' and e.cancelled_at is null
         and (e.starts_at at time zone v_tz)::date = (v_item ->> 'local_date')::date
         and (nullif(v_item ->> 'opponent', '') is null or lower(coalesce(e.opponent, '')) = lower(v_item ->> 'opponent'))
       order by abs(extract(epoch from (e.starts_at - v_start))) limit 1;
    end if;
    if v_event is null then
      v_missed := v_missed + 1; continue;
    end if;

    update public.events
       set our_score = v_ours, their_score = v_theirs,
           was_home = coalesce(v_home, was_home),
           score_entered_by = auth.uid(), score_entered_at = now(),
           updated_at = now()
     where id = v_event
       and (our_score is distinct from v_ours or their_score is distinct from v_theirs or was_home is distinct from coalesce(v_home, was_home));
    if found then v_set := v_set + 1; end if;
  end loop;
  return jsonb_build_object('results', v_set, 'unmatched', v_missed);
end;
$fn$;
revoke execute on function public.apply_imported_results(uuid, uuid, jsonb) from public, anon;
grant execute on function public.apply_imported_results(uuid, uuid, jsonb) to authenticated;

-- ------------------------------------------------------------------- the form
drop function if exists public.team_form(uuid, integer);
create or replace function public.team_form(p_team uuid, p_n integer default 5)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_team public.teams;
begin
  select * into v_team from public.teams where id = p_team;
  if v_team.id is null or not (coalesce(app_private.is_team_member(p_team), false) or coalesce(app_private.is_team_coach(p_team), false)) then
    raise exception 'that squad''s form is its own people''s' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'team', jsonb_build_object('id', v_team.id, 'name', v_team.name, 'season', v_team.season),
    'last', coalesce((
      select jsonb_agg(jsonb_build_object(
               'event_id', e.id, 'starts_at', e.starts_at, 'opponent', e.opponent, 'was_home', e.was_home,
               'ours', e.our_score, 'theirs', e.their_score,
               'outcome', case when e.our_score > e.their_score then 'won' when e.our_score < e.their_score then 'lost' else 'drew' end,
               'source', e.source)
             order by e.starts_at desc)
        from (select * from public.events e
               where e.team_id = p_team and e.type = 'match' and e.cancelled_at is null
                 and e.our_score is not null and e.their_score is not null
               order by e.starts_at desc limit greatest(coalesce(p_n, 5), 1)) e), '[]'::jsonb),
    'season', (
      select jsonb_build_object(
               'played', count(*), 'won', count(*) filter (where e.our_score > e.their_score),
               'drawn', count(*) filter (where e.our_score = e.their_score),
               'lost', count(*) filter (where e.our_score < e.their_score),
               'gf', coalesce(sum(e.our_score), 0), 'ga', coalesce(sum(e.their_score), 0))
        from public.events e
       where e.team_id = p_team and e.type = 'match' and e.cancelled_at is null
         and e.our_score is not null and e.their_score is not null)
  );
end;
$fn$;
revoke execute on function public.team_form(uuid, integer) from public, anon;
grant execute on function public.team_form(uuid, integer) to authenticated;
