-- 0139: a new season starts from the old one.
--
-- R-12. Every February a club rebuilds itself by hand: the U8s become the
-- U9s, the same children, the same coach, the same WhatsApp group renamed;
-- numbers are reissued from a list someone kept; and the club has no way to
-- know who has re-registered except by asking. The season control (ended /
-- reopen) archived the old squad and did nothing about the new one.
--
-- ROLL OVER = clone, move, keep, ask, end:
--   clone  every active squad of the old season into the new one, an age
--          group up (U8 → U9, and "U8 SPL" → "U9 SPL");
--   move   every player on it to the new squad — the family's chat follows
--          (0098), the old one goes read-only;
--   keep   each player's number where it is still free in the new season
--          (the pool is per season, 0085), and say how many were not;
--   ask    by making the new season's squad program, so "re-registered"
--          has a definition — an approved registration in it — and the
--          prefilled invite is the signed-in programs screen, which already
--          offers a parent their own children;
--   end    the old squad.
--
-- Moving players BEFORE anyone has re-registered is deliberate. The
-- alternative — an empty U9 squad until each family re-registers — means a
-- coach with no squad list and families with no chat for the weeks the
-- club is chasing them, which is the period the chat is most needed. The
-- report says who has not re-registered; the nudge asks them; and a club
-- that wants them off the squad until they do can remove them.
--
-- Once per squad: a squad already rolled into the target season is refused,
-- so a double tap on a slow connection does not make two U9s.

alter table public.teams
  add column if not exists rolled_from uuid references public.teams(id) on delete set null;

create or replace function app_private.next_age_group(p_age_group text)
returns text
language sql immutable as $fn$
  select case when p_age_group ~ '^U\d{1,2}$'
              then 'U' || (substring(p_age_group from 2)::integer + 1)
              else p_age_group end;
$fn$;

-- "U8 SPL" → "U9 SPL", and a name with no age token is left alone.
create or replace function app_private.bump_squad_name(p_name text, p_from text, p_to text)
returns text
language sql immutable as $fn$
  select case when p_from ~ '^U\d{1,2}$' and p_from <> p_to
              then regexp_replace(p_name, '\m' || p_from || '\M', p_to)
              else p_name end;
$fn$;

create or replace function public.preview_season_rollover(p_academy uuid, p_from text, p_to text)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
begin
  if not coalesce(app_private.is_academy_staff(p_academy), false) then
    raise exception 'only an admin can roll a season over' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id',            t.id,
             'name',          t.name,
             'new_name',      app_private.bump_squad_name(t.name, t.age_group, app_private.next_age_group(t.age_group)),
             'age_group',     t.age_group,
             'new_age_group', app_private.next_age_group(t.age_group),
             'players',       (select count(*) from public.players pl where pl.team_id = t.id),
             'numbers',       (select count(*) from public.squad_numbers sn
                                join public.players pl on pl.id = sn.player_id
                               where pl.team_id = t.id and sn.season = p_from),
             'numbers_clashing', (select count(*) from public.squad_numbers sn
                                   join public.players pl on pl.id = sn.player_id
                                  where pl.team_id = t.id and sn.season = p_from
                                    and exists (select 1 from public.squad_numbers o
                                                 where o.academy_id = t.academy_id and o.season = p_to
                                                   and o.number = sn.number)),
             'already_rolled', exists (select 1 from public.teams n where n.rolled_from = t.id and n.season = p_to)
           ) order by t.age_group, t.name)
      from public.teams t
     where t.academy_id = p_academy and t.season = p_from and t.status = 'active'
  ), '[]'::jsonb);
end;
$fn$;

create or replace function public.roll_over_season(p_academy uuid, p_from text, p_to text)
returns jsonb
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_me        uuid := auth.uid();
  t           public.teams;
  v_new       uuid;
  v_new_name  text;
  v_new_age   text;
  v_teams     integer := 0;
  v_players   integer := 0;
  v_kept      integer := 0;
  v_clashed   integer := 0;
  n           integer;
begin
  if not coalesce(app_private.is_academy_staff(p_academy), false) then
    raise exception 'only an admin can roll a season over' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_to, '')), '') is null or btrim(p_to) = btrim(coalesce(p_from, '')) then
    raise exception 'the new season needs a name of its own' using errcode = '22023';
  end if;

  for t in
    select * from public.teams
     where academy_id = p_academy and season = p_from and status = 'active'
     order by age_group, name
  loop
    if exists (select 1 from public.teams n where n.rolled_from = t.id and n.season = p_to) then
      raise exception '% has already been rolled into %', t.name, p_to using errcode = '22023';
    end if;

    v_new_age  := app_private.next_age_group(t.age_group);
    v_new_name := app_private.bump_squad_name(t.name, t.age_group, v_new_age);

    insert into public.teams (academy_id, name, age_group, season, status, capacity, kit_home, kit_away, rolled_from, created_by)
    values (p_academy, v_new_name, v_new_age, btrim(p_to), 'active', t.capacity, t.kit_home, t.kit_away, t.id, v_me)
    returning id into v_new;
    v_teams := v_teams + 1;

    -- Numbers first, while the players still point at the old squad.
    insert into public.squad_numbers (academy_id, player_id, season, number, assigned_by)
    select sn.academy_id, sn.player_id, btrim(p_to), sn.number, v_me
      from public.squad_numbers sn
      join public.players pl on pl.id = sn.player_id
     where pl.team_id = t.id and sn.season = p_from
       and not exists (select 1 from public.squad_numbers o
                        where o.academy_id = sn.academy_id and o.season = btrim(p_to)
                          and (o.number = sn.number or o.player_id = sn.player_id));
    get diagnostics n = row_count;
    v_kept := v_kept + n;
    select count(*) into n from public.squad_numbers sn
      join public.players pl on pl.id = sn.player_id
     where pl.team_id = t.id and sn.season = p_from
       and not exists (select 1 from public.squad_numbers k
                        where k.player_id = sn.player_id and k.season = btrim(p_to));
    v_clashed := v_clashed + n;

    update public.players set team_id = v_new, updated_at = now() where team_id = t.id;
    get diagnostics n = row_count;
    v_players := v_players + n;

    -- The ask. An approved registration in this is what "re-registered"
    -- means, and the signed-in programs screen offers it to every family
    -- with an eligible child.
    insert into public.programs (academy_id, name, kind, status, season, team_id, capacity, created_by)
    values (p_academy, v_new_name || ' — ' || btrim(p_to) || ' season', 'squad', 'open', btrim(p_to), v_new, t.capacity, v_me);

    update public.teams set status = 'ended', ended_at = now() where id = t.id;
  end loop;

  return jsonb_build_object(
    'teams', v_teams, 'players', v_players,
    'numbers_kept', v_kept, 'numbers_not_kept', v_clashed
  );
end;
$fn$;

create or replace function public.rollover_report(p_academy uuid, p_season text)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
begin
  if not coalesce(app_private.is_academy_staff(p_academy), false) then
    raise exception 'only an admin can see this' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'team_id', t.id,
             'team',    t.name,
             'total',   (select count(*) from public.players pl where pl.team_id = t.id),
             'registered', (select count(*) from public.players pl where pl.team_id = t.id
                             and exists (select 1 from public.program_registrations pr
                                           join public.programs p on p.id = pr.program_id
                                          where pr.player_id = pl.id and p.team_id = t.id
                                            and p.season = p_season and pr.status = 'approved')),
             'not_yet', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'player_id', pl.id,
                        'name',      pl.full_name,
                        'guardians', coalesce((
                          select jsonb_agg(jsonb_build_object('name', pr.full_name, 'phone', pr.phone::text))
                            from public.player_guardians pg
                            join public.profiles pr on pr.id = pg.profile_id
                           where pg.player_id = pl.id
                        ), '[]'::jsonb)
                      ) order by pl.full_name)
                 from public.players pl
                where pl.team_id = t.id
                  and not exists (select 1 from public.program_registrations pr
                                    join public.programs p on p.id = pr.program_id
                                   where pr.player_id = pl.id and p.team_id = t.id
                                     and p.season = p_season and pr.status = 'approved')
             ), '[]'::jsonb)
           ) order by t.age_group, t.name)
      from public.teams t
     where t.academy_id = p_academy and t.season = p_season and t.rolled_from is not null
  ), '[]'::jsonb);
end;
$fn$;

alter table public.notification_queue
  drop constraint if exists notification_queue_kind_check;
alter table public.notification_queue
  add constraint notification_queue_kind_check
  check (kind = any (array[
    'message', 'announcement', 'event_reminder', 'poll_opened', 'poll_closing',
    'rsvp_change', 'invite', 'event_cancelled', 'event_changed', 'event_back_on',
    'rsvp_nudge', 'announcement_repeat', 'wwcc_expiring', 'guardian_erased',
    'official_rego_pending', 'reregister_nudge'
  ]));

create or replace function public.nudge_unregistered(p_academy uuid, p_season text)
returns integer
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_sent integer := 0;
begin
  if not coalesce(app_private.is_academy_staff(p_academy), false) then
    raise exception 'only an admin can send this' using errcode = '42501';
  end if;
  with not_yet as (
    select pl.id as player_id, pl.full_name, t.name as team
      from public.teams t
      join public.players pl on pl.team_id = t.id
     where t.academy_id = p_academy and t.season = p_season and t.rolled_from is not null
       and not exists (select 1 from public.program_registrations pr
                         join public.programs p on p.id = pr.program_id
                        where pr.player_id = pl.id and p.team_id = t.id
                          and p.season = p_season and pr.status = 'approved')
  ),
  recipients as (
    select n.*, pg.profile_id as tell
      from not_yet n join public.player_guardians pg on pg.player_id = n.player_id
  ),
  fresh as (
    -- Once a week per child per parent, however often the button is pressed.
    select r.* from recipients r
     where not exists (select 1 from public.notification_queue q
                        where q.kind = 'reregister_nudge' and q.profile_id = r.tell
                          and q.payload->>'player_id' = r.player_id::text
                          and q.created_at > now() - interval '7 days')
  ),
  queued as (
    insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload)
    select p_academy, f.tell, 'reregister_nudge',
           'Re-register ' || split_part(f.full_name, ' ', 1) || ' for ' || p_season,
           f.full_name || ' has a place in ' || f.team || ' this season. Register them to keep it.',
           '/programs',
           jsonb_build_object('player_id', f.player_id, 'season', p_season)
      from fresh f
    returning 1
  )
  select count(*)::integer into v_sent from queued;
  return v_sent;
end;
$fn$;

revoke execute on function public.preview_season_rollover(uuid, text, text) from public, anon;
revoke execute on function public.roll_over_season(uuid, text, text) from public, anon;
revoke execute on function public.rollover_report(uuid, text) from public, anon;
revoke execute on function public.nudge_unregistered(uuid, text) from public, anon;
grant execute on function public.preview_season_rollover(uuid, text, text) to authenticated;
grant execute on function public.roll_over_season(uuid, text, text) to authenticated;
grant execute on function public.rollover_report(uuid, text) to authenticated;
grant execute on function public.nudge_unregistered(uuid, text) to authenticated;
