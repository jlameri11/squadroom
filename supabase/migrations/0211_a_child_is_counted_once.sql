-- 0211: a child is counted once.
--
-- A child with two guardians can have two answers for the same game — one
-- parent says yes, the other maybe — and both are kept: each guardian's own
-- row. The coach's tally (event_rsvp_summary, 0037) and the availability
-- grid's column counts (0199) counted ROWS, so a child answered by both
-- parents was "2 in", or "1 in · 1 maybe", in what is one child. Found on
-- 5 Nov 2026 when the demo refresh seeded exactly that and test-availability
-- noticed a cell and a row disagreeing.
--
-- Both now take each child's LATEST answer — the rule the grid's cells
-- already used (order by updated_at desc, limit 1) — and count children. A
-- coach reading "11 in" before picking a side is reading eleven children.
--
-- `create or replace` keeps both functions' grants as they are (0185 and
-- 0199); nothing about who may call them changes. Unapplied until the
-- Supabase access token is back (NEEDS JOEY #12); test-rls check 114.

create or replace function public.event_rsvp_summary(p_event uuid)
returns table (going integer, maybe integer, out_count integer, no_reply integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not app_private.is_event_coach(p_event) then
    return;
  end if;

  return query
    with roster as (
      select pl.id
        from public.events e
        join public.players pl
          on pl.academy_id = e.academy_id
         and (e.team_id is null or pl.team_id = e.team_id)
       where e.id = p_event
    ),
    -- One answer per child: the most recent, whichever guardian gave it.
    answers as (
      select distinct on (er.player_id) er.player_id, er.status
        from public.event_rsvps er
       where er.event_id = p_event and er.player_id is not null
       order by er.player_id, er.updated_at desc
    )
    select
      count(*) filter (where a.status = 'yes')::integer,
      count(*) filter (where a.status = 'maybe')::integer,
      count(*) filter (where a.status = 'no')::integer,
      count(*) filter (where a.status is null)::integer
    from roster r
    left join answers a on a.player_id = r.id;
end;
$$;

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
               -- Children whose latest answer is yes, not rows that say yes.
               'going', (select count(*) from (
                           select distinct on (r.player_id) r.status
                             from public.event_rsvps r
                            where r.event_id = e.id and r.player_id is not null
                            order by r.player_id, r.updated_at desc) latest
                          where latest.status = 'yes'),
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
