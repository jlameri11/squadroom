-- 0197: the new season is graded, not copied.
--
-- R-19 (Joey, 3 Nov 2026). 0139 rolls every squad up an age group with the
-- same children. A real February is messier: the U9 Sky player who should
-- be U10 Navy; one squad that has grown into two; two that have shrunk into
-- one; the player who is leaving; the U12s at a club that only runs to U12;
-- and the U7s who have not registered because there was nothing to register
-- for. So the preview becomes a PLAN the owner edits — nothing moves until
-- it is confirmed — and the same move, with the chat, the number and the
-- calendar following the child, is a tool of its own for mid-season.
--
-- What follows a child when their squad changes, and where that lives:
--   chat      0098: a trigger on players.team_id puts the guardians into
--             the new squad's channels. Not touched here, which is the
--             point of having put it there.
--   number    0085: the pool is per club per season. A mid-season move
--             keeps the number; at rollover it is carried where free.
--   calendar  events belong to the squad, and a family's calendar is
--             their children's squads — so it follows on its own.
--
-- The plan:
--   { "squads":  [ { "key": "t:<old id>" | "new:1" | "keep:<old id>",
--                    "name": "U10 Navy", "age_group": "U10",
--                    "from": ["<old team id>", …], "capacity": 14 } ],
--     "players": { "<player id>": "<squad key>" | null },     -- null = left out
--     "intake":  [ { "name": "U7 Rookies", "age_group": "U7", "capacity": 12 } ] }
--
-- Every player on an active squad of the old season must appear in
-- "players": a child with no destination is an error, never a silent drop.

-- "U12" → 12; anything else → null.
create or replace function app_private.age_number(p_age_group text)
returns integer
language sql immutable as $fn$
  select case when p_age_group ~ '^U\d{1,2}$' then substring(p_age_group from 2)::integer end;
$fn$;

-- The default plan: every active squad bumped, every player with it.
create or replace function app_private.default_season_plan(p_academy uuid, p_from text)
returns jsonb
language sql stable security definer set search_path = public as $fn$
  select jsonb_build_object(
    'squads', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', 't:' || t.id, 'from', jsonb_build_array(t.id),
               'name', app_private.bump_squad_name(t.name, t.age_group, app_private.next_age_group(t.age_group)),
               'age_group', app_private.next_age_group(t.age_group),
               'capacity', t.capacity) order by t.age_group, t.name)
        from public.teams t
       where t.academy_id = p_academy and t.season = p_from and t.status = 'active'), '[]'::jsonb),
    'players', coalesce((
      select jsonb_object_agg(pl.id, 't:' || pl.team_id)
        from public.players pl
        join public.teams t on t.id = pl.team_id
       where t.academy_id = p_academy and t.season = p_from and t.status = 'active'), '{}'::jsonb),
    'intake', '[]'::jsonb);
$fn$;

-- ------------------------------------------------------------ the preview
-- The default plan with everything the editor needs: each squad's players
-- (name, birth date, number, whether the number clashes next season), and
-- the players ageing out of the club's oldest age group listed on their own.
drop function if exists public.preview_season_plan(uuid, text, text);
create or replace function public.preview_season_plan(p_academy uuid, p_from text, p_to text)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_oldest integer;
begin
  if not coalesce(app_private.is_academy_staff(p_academy), false) then
    raise exception 'only an admin can roll a season over' using errcode = '42501';
  end if;
  select max(app_private.age_number(t.age_group)) into v_oldest
    from public.teams t
   where t.academy_id = p_academy and t.season = p_from and t.status = 'active';

  return jsonb_build_object(
    'from', p_from, 'to', p_to,
    'oldest_age_group', case when v_oldest is not null then 'U' || v_oldest end,
    'squads', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key',            't:' || t.id,
               'from',           jsonb_build_array(t.id),
               'from_name',      t.name,
               'from_age_group', t.age_group,
               'name',           app_private.bump_squad_name(t.name, t.age_group, app_private.next_age_group(t.age_group)),
               'age_group',      app_private.next_age_group(t.age_group),
               'capacity',       t.capacity,
               'oldest',         app_private.age_number(t.age_group) is not null and app_private.age_number(t.age_group) = v_oldest,
               'already_rolled', exists (select 1 from public.teams n where n.rolled_from = t.id and n.season = p_to),
               'players', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'id', pl.id, 'name', pl.full_name, 'dob', pl.dob,
                          'number', (select sn.number from public.squad_numbers sn where sn.player_id = pl.id and sn.season = p_from limit 1),
                          'clash', exists (select 1 from public.squad_numbers sn
                                            join public.squad_numbers o on o.academy_id = sn.academy_id and o.season = p_to and o.number = sn.number
                                           where sn.player_id = pl.id and sn.season = p_from),
                          'ageing_out', app_private.age_number(t.age_group) is not null and app_private.age_number(t.age_group) = v_oldest)
                        order by pl.full_name)
                   from public.players pl where pl.team_id = t.id), '[]'::jsonb)
             ) order by t.age_group, t.name)
        from public.teams t
       where t.academy_id = p_academy and t.season = p_from and t.status = 'active'), '[]'::jsonb),
    'ageing_out', coalesce((
      select jsonb_agg(jsonb_build_object('id', pl.id, 'name', pl.full_name, 'dob', pl.dob, 'from_key', 't:' || t.id, 'from_name', t.name, 'from_age_group', t.age_group)
                       order by t.name, pl.full_name)
        from public.players pl
        join public.teams t on t.id = pl.team_id
       where t.academy_id = p_academy and t.season = p_from and t.status = 'active'
         and app_private.age_number(t.age_group) is not null and app_private.age_number(t.age_group) = v_oldest), '[]'::jsonb)
  );
end;
$fn$;
revoke execute on function public.preview_season_plan(uuid, text, text) from public, anon;
grant execute on function public.preview_season_plan(uuid, text, text) to authenticated;

-- ----------------------------------------------------------- the rollover
-- 0139's roll_over_season, now taking the plan. Called without one it does
-- exactly what it did: every squad up, everyone with it.
drop function if exists public.roll_over_season(uuid, text, text);
drop function if exists public.roll_over_season(uuid, text, text, jsonb);
create or replace function public.roll_over_season(p_academy uuid, p_from text, p_to text, p_plan jsonb default null)
returns jsonb
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_me        uuid := auth.uid();
  v_to        text := btrim(coalesce(p_to, ''));
  v_plan      jsonb;
  v_squad     jsonb;
  v_intake    jsonb;
  v_key       text;
  v_dest      text;
  v_pid       uuid;
  v_first     public.teams;
  v_new       uuid;
  v_year      integer;
  v_age       integer;
  v_keys      jsonb := '{}'::jsonb;    -- key → new team id
  v_teams     integer := 0;
  v_players   integer := 0;
  v_left      integer := 0;
  v_kept      integer := 0;
  v_clashed   integer := 0;
  v_made      jsonb := '[]'::jsonb;
  n           integer;
  r           record;
begin
  if not coalesce(app_private.is_academy_staff(p_academy), false) then
    raise exception 'only an admin can roll a season over' using errcode = '42501';
  end if;
  if v_to = '' or v_to = btrim(coalesce(p_from, '')) then
    raise exception 'the new season needs a name of its own' using errcode = '22023';
  end if;
  v_plan := coalesce(p_plan, app_private.default_season_plan(p_academy, p_from));
  if jsonb_typeof(v_plan -> 'squads') <> 'array' or jsonb_typeof(coalesce(v_plan -> 'players', '{}'::jsonb)) <> 'object' then
    raise exception 'the plan needs a list of squads and a map of players' using errcode = '22023';
  end if;
  v_year := case when v_to ~ '^\d{4}$' then v_to::integer end;

  -- ---- check everything before touching anything
  for v_squad in select * from jsonb_array_elements(v_plan -> 'squads') loop
    v_key := v_squad ->> 'key';
    if coalesce(v_key, '') = '' or v_keys ? v_key then
      raise exception 'every squad in the plan needs a key of its own' using errcode = '22023';
    end if;
    if btrim(coalesce(v_squad ->> 'name', '')) = '' then
      raise exception 'the squad "%" needs a name', v_key using errcode = '22023';
    end if;
    for r in select value::text as id from jsonb_array_elements_text(coalesce(v_squad -> 'from', '[]'::jsonb)) loop
      if not exists (select 1 from public.teams t where t.id = r.id::uuid and t.academy_id = p_academy and t.season = p_from and t.status = 'active') then
        raise exception 'squad % is not an active squad of % at this club', r.id, p_from using errcode = '22023';
      end if;
      if exists (select 1 from public.teams nt where nt.rolled_from = r.id::uuid and nt.season = v_to) then
        raise exception '% has already been rolled into %', (select t.name from public.teams t where t.id = r.id::uuid), v_to using errcode = '22023';
      end if;
    end loop;
    v_keys := v_keys || jsonb_build_object(v_key, null);
  end loop;

  -- Every child on an active squad has a destination, even if it is "out".
  select pl.full_name into r
    from public.players pl
    join public.teams t on t.id = pl.team_id
   where t.academy_id = p_academy and t.season = p_from and t.status = 'active'
     and not (coalesce(v_plan -> 'players', '{}'::jsonb) ? pl.id::text)
   limit 1;
  if found then
    raise exception '% has no destination in the plan: move them up, keep them, or leave them out — say which', r.full_name using errcode = '22023';
  end if;
  for v_pid, v_dest in select key::uuid, value from jsonb_each_text(coalesce(v_plan -> 'players', '{}'::jsonb)) loop
    if not exists (select 1 from public.players pl join public.teams t on t.id = pl.team_id
                    where pl.id = v_pid and t.academy_id = p_academy and t.season = p_from and t.status = 'active') then
      raise exception 'player % is not on an active squad of % at this club', v_pid, p_from using errcode = '22023';
    end if;
    if v_dest is not null and not (v_keys ? v_dest) then
      raise exception 'player % is sent to squad "%", which is not in the plan', v_pid, v_dest using errcode = '22023';
    end if;
  end loop;
  for v_intake in select * from jsonb_array_elements(coalesce(v_plan -> 'intake', '[]'::jsonb)) loop
    if btrim(coalesce(v_intake ->> 'name', '')) = '' then
      raise exception 'an intake squad needs a name' using errcode = '22023';
    end if;
  end loop;

  -- ---- the new squads
  for v_squad in select * from jsonb_array_elements(v_plan -> 'squads') loop
    v_key := v_squad ->> 'key';
    v_first := null;
    select t.* into v_first from public.teams t
     where t.id = (select (value)::uuid from jsonb_array_elements_text(coalesce(v_squad -> 'from', '[]'::jsonb)) limit 1);
    insert into public.teams (academy_id, name, age_group, season, status, capacity, kit_home, kit_away, rolled_from, created_by)
    values (p_academy, btrim(v_squad ->> 'name'), coalesce(nullif(btrim(v_squad ->> 'age_group'), ''), v_first.age_group),
            v_to, 'active', coalesce((v_squad ->> 'capacity')::integer, v_first.capacity), v_first.kit_home, v_first.kit_away, v_first.id, v_me)
    returning id into v_new;
    v_teams := v_teams + 1;
    v_keys := v_keys || jsonb_build_object(v_key, v_new);
    v_made := v_made || jsonb_build_object('key', v_key, 'id', v_new, 'name', btrim(v_squad ->> 'name'));

    -- The ask: an approved registration in this is what "re-registered" means.
    v_age := app_private.age_number(coalesce(nullif(btrim(v_squad ->> 'age_group'), ''), v_first.age_group));
    insert into public.programs (academy_id, name, kind, status, season, team_id, capacity, born_from_year, born_to_year, created_by)
    values (p_academy, btrim(v_squad ->> 'name') || ' — ' || v_to || ' season', 'squad', 'open', v_to, v_new,
            coalesce((v_squad ->> 'capacity')::integer, v_first.capacity),
            case when v_year is not null and v_age is not null then v_year - v_age end,
            case when v_year is not null and v_age is not null then v_year - v_age end,
            v_me);
  end loop;

  -- ---- the new intake: a squad with nobody on it yet, and its registration open
  for v_intake in select * from jsonb_array_elements(coalesce(v_plan -> 'intake', '[]'::jsonb)) loop
    insert into public.teams (academy_id, name, age_group, season, status, capacity, created_by)
    values (p_academy, btrim(v_intake ->> 'name'), nullif(btrim(coalesce(v_intake ->> 'age_group', '')), ''), v_to, 'active',
            (v_intake ->> 'capacity')::integer, v_me)
    returning id into v_new;
    v_age := app_private.age_number(v_intake ->> 'age_group');
    insert into public.programs (academy_id, name, kind, status, season, team_id, capacity, born_from_year, born_to_year, created_by)
    values (p_academy, btrim(v_intake ->> 'name') || ' — ' || v_to || ' season (new players)', 'squad', 'open', v_to, v_new,
            (v_intake ->> 'capacity')::integer,
            case when v_year is not null and v_age is not null then v_year - v_age end,
            case when v_year is not null and v_age is not null then v_year - v_age end,
            v_me);
    v_made := v_made || jsonb_build_object('key', 'intake', 'id', v_new, 'name', btrim(v_intake ->> 'name'), 'intake', true);
  end loop;

  -- ---- numbers first, while the players still point at the old squads
  insert into public.squad_numbers (academy_id, player_id, season, number, assigned_by)
  select sn.academy_id, sn.player_id, v_to, sn.number, v_me
    from public.squad_numbers sn
   where sn.season = p_from
     and sn.player_id in (select key::uuid from jsonb_each_text(coalesce(v_plan -> 'players', '{}'::jsonb)) where value is not null)
     and not exists (select 1 from public.squad_numbers o
                      where o.academy_id = sn.academy_id and o.season = v_to
                        and (o.number = sn.number or o.player_id = sn.player_id));
  get diagnostics n = row_count;
  v_kept := n;
  select count(*) into v_clashed from public.squad_numbers sn
   where sn.season = p_from
     and sn.player_id in (select key::uuid from jsonb_each_text(coalesce(v_plan -> 'players', '{}'::jsonb)) where value is not null)
     and not exists (select 1 from public.squad_numbers k where k.player_id = sn.player_id and k.season = v_to);

  -- ---- the players: to their squad, or out. The chat follows (0098).
  for v_pid, v_dest in select key::uuid, value from jsonb_each_text(coalesce(v_plan -> 'players', '{}'::jsonb)) loop
    if v_dest is null then
      update public.players set team_id = null, updated_at = now() where id = v_pid;
      v_left := v_left + 1;
    else
      update public.players set team_id = (v_keys ->> v_dest)::uuid, updated_at = now() where id = v_pid;
      v_players := v_players + 1;
    end if;
  end loop;

  -- ---- the old season ends
  update public.teams set status = 'ended', ended_at = now()
   where academy_id = p_academy and season = p_from and status = 'active';

  return jsonb_build_object(
    'teams', v_teams, 'players', v_players, 'left_out', v_left,
    'intake', jsonb_array_length(coalesce(v_plan -> 'intake', '[]'::jsonb)),
    'numbers_kept', v_kept, 'numbers_not_kept', v_clashed,
    'squads', v_made
  );
end;
$fn$;
revoke execute on function public.roll_over_season(uuid, text, text, jsonb) from public, anon;
grant execute on function public.roll_over_season(uuid, text, text, jsonb) to authenticated;

-- ------------------------------------------------- moving players mid-season
-- The same move outside rollover: a list of (player, squad or null). The
-- preview says, per child, what follows them; nothing changes until the
-- second call. Staff only; a player or squad from another club is refused
-- before anything is touched.
drop function if exists public.preview_player_moves(uuid, jsonb);
create or replace function public.preview_player_moves(p_academy uuid, p_moves jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_move jsonb;
  v_pid  uuid;
  v_tid  uuid;
  v_out  jsonb := '[]'::jsonb;
  v_pl   public.players;
  v_to   public.teams;
begin
  if not coalesce(app_private.is_academy_staff(p_academy), false) then
    raise exception 'only an admin can move players' using errcode = '42501';
  end if;
  if jsonb_typeof(p_moves) <> 'array' then
    raise exception 'moves are a list' using errcode = '22023';
  end if;
  for v_move in select * from jsonb_array_elements(p_moves) loop
    v_pid := (v_move ->> 'player_id')::uuid;
    v_tid := nullif(v_move ->> 'team_id', '')::uuid;
    select * into v_pl from public.players where id = v_pid and academy_id = p_academy;
    if v_pl.id is null then
      raise exception 'player % is not at this club', v_pid using errcode = '22023';
    end if;
    v_to := null;
    if v_tid is not null then
      select * into v_to from public.teams where id = v_tid and academy_id = p_academy;
      if v_to.id is null then
        raise exception 'squad % is not at this club', v_tid using errcode = '22023';
      end if;
      if v_to.status <> 'active' then
        raise exception '% has ended; pick an active squad', v_to.name using errcode = '22023';
      end if;
    end if;
    v_out := v_out || jsonb_build_object(
      'player_id', v_pl.id, 'name', v_pl.full_name,
      'from', (select jsonb_build_object('id', t.id, 'name', t.name) from public.teams t where t.id = v_pl.team_id),
      'to', case when v_to.id is null then null else jsonb_build_object('id', v_to.id, 'name', v_to.name, 'season', v_to.season) end,
      'same', v_pl.team_id is not distinct from v_tid,
      -- Who joins the new squad's chat: the active guardians (0098).
      'guardians_follow', case when v_to.id is null then 0 else (
        select count(*) from public.player_guardians pg
          join public.academy_members am on am.academy_id = p_academy and am.profile_id = pg.profile_id and am.status = 'active'
         where pg.player_id = v_pl.id
           and not exists (select 1 from public.team_members tm where tm.team_id = v_to.id and tm.profile_id = pg.profile_id)) end,
      'number', case when v_to.id is null then null else
        (select sn.number from public.squad_numbers sn where sn.player_id = v_pl.id and sn.season = v_to.season limit 1) end,
      'number_kept', v_to.id is not null and exists (select 1 from public.squad_numbers sn where sn.player_id = v_pl.id and sn.season = v_to.season),
      'upcoming_events', case when v_to.id is null then 0 else
        (select count(*) from public.events e where e.team_id = v_to.id and e.starts_at >= now() and e.cancelled_at is null) end
    );
  end loop;
  return v_out;
end;
$fn$;
revoke execute on function public.preview_player_moves(uuid, jsonb) from public, anon;
grant execute on function public.preview_player_moves(uuid, jsonb) to authenticated;

drop function if exists public.move_players(uuid, jsonb);
create or replace function public.move_players(p_academy uuid, p_moves jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_check  jsonb;
  v_move   jsonb;
  v_pid    uuid;
  v_tid    uuid;
  v_moved  integer := 0;
  v_left   integer := 0;
  v_before integer;
  v_after  integer;
begin
  if not coalesce(app_private.is_academy_staff(p_academy), false) then
    raise exception 'only an admin can move players' using errcode = '42501';
  end if;
  -- The preview's checks are the checks: it raises before anything moves.
  v_check := public.preview_player_moves(p_academy, p_moves);
  select count(*) into v_before from public.team_members tm
    join public.teams t on t.id = tm.team_id where t.academy_id = p_academy;
  for v_move in select * from jsonb_array_elements(p_moves) loop
    v_pid := (v_move ->> 'player_id')::uuid;
    v_tid := nullif(v_move ->> 'team_id', '')::uuid;
    update public.players set team_id = v_tid, updated_at = now()
     where id = v_pid and academy_id = p_academy and team_id is distinct from v_tid;
    if found then
      if v_tid is null then v_left := v_left + 1; else v_moved := v_moved + 1; end if;
    end if;
  end loop;
  select count(*) into v_after from public.team_members tm
    join public.teams t on t.id = tm.team_id where t.academy_id = p_academy;
  return jsonb_build_object('moved', v_moved, 'left_out', v_left, 'guardians_joined', v_after - v_before, 'preview', v_check);
end;
$fn$;
revoke execute on function public.move_players(uuid, jsonb) from public, anon;
grant execute on function public.move_players(uuid, jsonb) to authenticated;
