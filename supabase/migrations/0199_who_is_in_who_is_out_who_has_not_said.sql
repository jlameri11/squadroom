-- 0199: who is in, who is out, and who has not said.
--
-- E-05 and the half of E-06 that was missing.
--
--   the grid    A coach's week is a grid in their head: the squad down the
--               side, the next few games and sessions across the top, and in
--               each cell whether the family said yes, no, maybe, or nothing
--               — and for 'no', why (E-02 made the reason compulsory). Here
--               it is as one read, for the squad's coach, with the last
--               couple of sessions' register alongside so "said yes, did
--               not come" is visible too.
--   the push    0125's team sheet was published in silence: a coach picked
--               the side and then told WhatsApp. Publishing now tells each
--               selected player's family — in the side, or on the bench —
--               with the meet time, the ground and the kit, once per
--               player per role (a child moved from bench to starting is
--               told again; an unchanged sheet republished is not). The
--               families of children left out are told only if the coach
--               asks, and gently: "still come along and support".

-- ------------------------------------------------------------- notification kinds
do $$
declare
  v_name text;
begin
  select conname into v_name from pg_constraint
   where conrelid = 'public.notification_queue'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) like '%kind = ANY%';
  if v_name is not null then
    execute format('alter table public.notification_queue drop constraint %I', v_name);
  end if;
  alter table public.notification_queue add constraint notification_queue_kind_check check (kind = any (array[
    'message','announcement','event_reminder','poll_opened','poll_closing','rsvp_change','invite',
    'event_cancelled','event_changed','event_back_on','rsvp_nudge','announcement_repeat','wwcc_expiring',
    'guardian_erased','official_rego_pending','reregister_nudge','offer','referee_appointment',
    'referee_response','referee_withdrawn','fixture_change_proposed','fixture_change_answered',
    'fixture_change_decided','mention','match_correction_requested','match_correction_decided',
    'fixture_flowing_open','discipline_warning','discipline_suspension','forfeit_request','forfeit_decided',
    'nomination','fee_due','fee_overdue','player_report','player_clip','selected','not_selected']));
end $$;

-- ------------------------------------------------------------------ the grid
drop function if exists public.availability_grid(uuid, integer, integer);
create or replace function public.availability_grid(p_team uuid, p_upcoming integer default 4, p_past integer default 2)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_team public.teams;
  v_tz   text;
begin
  select * into v_team from public.teams where id = p_team;
  if v_team.id is null or not coalesce(app_private.is_team_coach(p_team), false) then
    raise exception 'only this squad''s coach can see who is available' using errcode = '42501';
  end if;
  select coalesce(a.timezone, 'Australia/Sydney') into v_tz from public.academies a where a.id = v_team.academy_id;

  return jsonb_build_object(
    'team', jsonb_build_object('id', v_team.id, 'name', v_team.name, 'season', v_team.season),
    'timezone', v_tz,
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'title', e.title, 'starts_at', e.starts_at, 'type', e.type,
               'opponent', e.opponent, 'past', e.starts_at < now(),
               'going', (select count(*) from public.event_rsvps r where r.event_id = e.id and r.status = 'yes'),
               'no_reply', (select count(*) from public.players pl where pl.team_id = p_team
                              and not exists (select 1 from public.event_rsvps r where r.event_id = e.id and r.player_id = pl.id)))
             order by e.starts_at)
        from (
          (select * from public.events e
            where e.team_id = p_team and e.cancelled_at is null and e.private_to is null
              and e.starts_at < now()
            order by e.starts_at desc limit greatest(coalesce(p_past, 0), 0))
          union all
          (select * from public.events e
            where e.team_id = p_team and e.cancelled_at is null and e.private_to is null
              and e.starts_at >= now()
            order by e.starts_at asc limit greatest(coalesce(p_upcoming, 4), 1))
        ) e), '[]'::jsonb),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', pl.id, 'name', pl.full_name, 'preferred_name', pl.preferred_name,
               'number', (select sn.number from public.squad_numbers sn where sn.player_id = pl.id and sn.season = v_team.season limit 1),
               'cells', coalesce((
                 select jsonb_object_agg(e.id, jsonb_build_object(
                          'status', r.status, 'note', r.note,
                          'by', (select pr.full_name from public.profiles pr where pr.id = r.profile_id),
                          'at', r.updated_at,
                          'attendance', (select a.status from public.event_attendance a where a.event_id = e.id and a.player_id = pl.id limit 1)))
                   from (
                     (select id from public.events e where e.team_id = p_team and e.cancelled_at is null and e.private_to is null and e.starts_at < now() order by e.starts_at desc limit greatest(coalesce(p_past, 0), 0))
                     union all
                     (select id from public.events e where e.team_id = p_team and e.cancelled_at is null and e.private_to is null and e.starts_at >= now() order by e.starts_at asc limit greatest(coalesce(p_upcoming, 4), 1))
                   ) e
                   left join lateral (
                     select r.status::text, r.note, r.profile_id, r.updated_at
                       from public.event_rsvps r
                      where r.event_id = e.id and r.player_id = pl.id
                      order by r.updated_at desc limit 1) r on true
               ), '{}'::jsonb))
             order by pl.full_name)
        from public.players pl where pl.team_id = p_team), '[]'::jsonb)
  );
end;
$fn$;
revoke execute on function public.availability_grid(uuid, integer, integer) from public, anon;
grant execute on function public.availability_grid(uuid, integer, integer) to authenticated;

-- ------------------------------------------------------------------ the push
drop function if exists public.publish_lineup(uuid, boolean);
drop function if exists public.publish_lineup(uuid, boolean, boolean);
create or replace function public.publish_lineup(p_event uuid, p_published boolean default true, p_tell_out boolean default false)
returns void
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_event  public.events;
  v_lineup public.event_lineups;
  v_tz     text;
  v_when   text;
  v_meet   text;
begin
  if not coalesce(app_private.can_pick_lineup(p_event), false) then
    raise exception 'only this squad''s coach can publish the side' using errcode = '42501';
  end if;

  update public.event_lineups
     set published_at = case when p_published then coalesce(published_at, now()) else null end,
         updated_at = now()
   where event_id = p_event
  returning * into v_lineup;
  if v_lineup.id is null then
    raise exception 'there is no team sheet for that game yet' using errcode = '22023';
  end if;
  if not p_published then
    return;
  end if;

  select * into v_event from public.events where id = p_event;
  select coalesce(a.timezone, 'Australia/Sydney') into v_tz from public.academies a where a.id = v_event.academy_id;
  v_when := to_char(v_event.starts_at at time zone v_tz, 'Dy FMDD Mon');
  v_meet := concat_ws(' · ',
              case when v_event.arrive_at is not null then 'meet ' || to_char(v_event.arrive_at at time zone v_tz, 'FMHH12:MI am') else 'kick-off ' || to_char(v_event.starts_at at time zone v_tz, 'FMHH12:MI am') end,
              v_event.venue,
              case when v_event.kit_colour is not null then v_event.kit_colour || ' kit' end);

  -- In the side, or on the bench: told once per player per role.
  insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload, dedupe_key)
  select v_event.academy_id, pg.profile_id, 'selected',
         coalesce(nullif(pl.preferred_name, ''), split_part(pl.full_name, ' ', 1))
           || case when lp.role = 'starting' then ' is in the side for ' else ' is in the squad for ' end
           || v_when || coalesce(' v ' || v_event.opponent, ''),
         concat_ws(' · ', case when lp.role = 'bench' then 'On the bench to start' end, nullif(lp.position, ''), v_meet),
         '/calendar/' || p_event,
         jsonb_build_object('event_id', p_event, 'player_id', pl.id, 'role', lp.role),
         'lineup:' || p_event || ':' || pl.id || ':' || pg.profile_id || ':' || lp.role
    from public.event_lineup_players lp
    join public.players pl on pl.id = lp.player_id
    join public.player_guardians pg on pg.player_id = pl.id
    join public.academy_members am on am.academy_id = v_event.academy_id and am.profile_id = pg.profile_id and am.status = 'active'
   where lp.lineup_id = v_lineup.id and lp.role in ('starting', 'bench')
  on conflict (dedupe_key) do nothing;

  -- Left out: only when the coach asks, and gently.
  if p_tell_out then
    insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload, dedupe_key)
    select v_event.academy_id, pg.profile_id, 'not_selected',
           coalesce(nullif(pl.preferred_name, ''), split_part(pl.full_name, ' ', 1)) || ' is not in the side for ' || v_when,
           'Everyone gets their turn. Still come along and support if you can — and see you at training.',
           '/calendar/' || p_event,
           jsonb_build_object('event_id', p_event, 'player_id', pl.id, 'role', lp.role),
           'lineup:' || p_event || ':' || pl.id || ':' || pg.profile_id || ':' || lp.role
      from public.event_lineup_players lp
      join public.players pl on pl.id = lp.player_id
      join public.player_guardians pg on pg.player_id = pl.id
      join public.academy_members am on am.academy_id = v_event.academy_id and am.profile_id = pg.profile_id and am.status = 'active'
     where lp.lineup_id = v_lineup.id and lp.role = 'out'
    on conflict (dedupe_key) do nothing;
  end if;
end;
$fn$;
revoke execute on function public.publish_lineup(uuid, boolean, boolean) from public, anon;
grant execute on function public.publish_lineup(uuid, boolean, boolean) to authenticated;
