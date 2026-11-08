-- 0228: the file says who leads.
--
-- F-05's last piece. A results export from a league still on Dribl carries
-- every game in the division. The other clubs' games came along in the
-- file and the importer reported them as "Neither team is yours" and left
-- them out — rightly, because a game nobody at this club plays in is noise
-- in every family's calendar. But those rows ARE the division table. Kept
-- here instead, they make one: 3/1/0, goal difference then goals for, the
-- same arithmetic as our own competitions (app_private.ladder), on the
-- squad's page under its form and on a game's Preview.
--
-- WHICH GAMES ARE THE DIVISION. The file may say (a Division column); a
-- club's export often does not, and may mix age groups. So the division is
-- worked out the way a round robin defines it: the teams our squad plays,
-- the teams they play, and so on — the connected set of teams around our
-- squad's league name (teams.external_ref, 0121), within the season, and
-- within the division column when the file has one. A U8 file that also
-- carried the U9s gives the U8s their own table.
--
-- NOTHING ABOUT A PERSON. Team names and scores — what the league prints
-- on its own public match centre. Readable by the club's members; written
-- by its staff and coaches through the importer; a re-import updates the
-- same game (the file's reference, else the day and the two names), which
-- is how next week's file fills in last week's scores.

/** A team's name as the file spells it, made comparable. */
create or replace function app_private.team_key(p_name text)
returns text language sql immutable as $fn$
  select lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'));
$fn$;

create table if not exists public.imported_games (
  id           uuid primary key default gen_random_uuid(),
  academy_id   uuid not null references public.academies(id) on delete cascade,
  season       text not null,
  division     text,
  round        text,
  local_date   date not null,
  home         text not null check (char_length(btrim(home)) between 1 and 120),
  away         text not null check (char_length(btrim(away)) between 1 and 120),
  home_score   integer check (home_score is null or home_score between 0 and 99),
  away_score   integer check (away_score is null or away_score between 0 and 99),
  external_ref text,
  imported_by  uuid references public.profiles(id) on delete set null,
  imported_at  timestamptz not null default now(),
  constraint imported_games_scores_together check ((home_score is null) = (away_score is null)),
  constraint imported_games_two_sides check (app_private.team_key(home) <> app_private.team_key(away))
);
-- The file's own id for a game, else the day and the two names.
create unique index if not exists imported_games_ref_idx
  on public.imported_games (academy_id, season, external_ref) where external_ref is not null;
create unique index if not exists imported_games_day_idx
  on public.imported_games (academy_id, season, local_date, app_private.team_key(home), app_private.team_key(away));
create index if not exists imported_games_season_idx on public.imported_games (academy_id, season);

alter table public.imported_games enable row level security;
drop policy if exists imported_games_read on public.imported_games;
create policy imported_games_read on public.imported_games for select to authenticated
  using ((select app_private.is_academy_member(academy_id)));
-- Written only through store_imported_games.
grant select on public.imported_games to authenticated;

-- ------------------------------------------------------------------ storing
/**
 * Every game in a file with two named sides, ours and the other clubs':
 * [{division, round, local_date, home, away, home_score, away_score,
 * external_ref}]. Staff and coaches, through the importer. A score in the
 * file wins; a row with none leaves last week's alone.
 */
create or replace function public.store_imported_games(p_academy uuid, p_season text, p_rows jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = public as $fn$
declare
  r        jsonb;
  v_id     uuid;
  v_ref    text;
  v_home   text;
  v_away   text;
  v_date   date;
  v_hs     integer;
  v_as     integer;
  v_new    integer := 0;
  v_upd    integer := 0;
  v_bad    integer := 0;
  v_scored integer := 0;
begin
  if not coalesce(app_private.is_academy_coach(p_academy), false) then
    raise exception 'only the club''s staff or coaches import a draw' using errcode = '42501';
  end if;
  if coalesce(btrim(p_season), '') = '' then
    raise exception 'a season to file the games under' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 5000 then
    raise exception 'a list of up to five thousand games' using errcode = '22023';
  end if;

  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_home := nullif(btrim(coalesce(r->>'home', '')), '');
    v_away := nullif(btrim(coalesce(r->>'away', '')), '');
    begin v_date := (r->>'local_date')::date; exception when others then v_date := null; end;
    if v_home is null or v_away is null or v_date is null
       or char_length(v_home) > 120 or char_length(v_away) > 120
       or app_private.team_key(v_home) = app_private.team_key(v_away) then
      v_bad := v_bad + 1;
      continue;
    end if;
    v_hs := case when coalesce(r->>'home_score', '') ~ '^\d{1,2}$' then (r->>'home_score')::integer end;
    v_as := case when coalesce(r->>'away_score', '') ~ '^\d{1,2}$' then (r->>'away_score')::integer end;
    if v_hs is null or v_as is null then
      v_hs := null; v_as := null;
    end if;
    v_ref := nullif(btrim(coalesce(r->>'external_ref', '')), '');

    v_id := null;
    if v_ref is not null then
      select g.id into v_id from public.imported_games g
       where g.academy_id = p_academy and g.season = p_season and g.external_ref = v_ref;
    end if;
    if v_id is null then
      select g.id into v_id from public.imported_games g
       where g.academy_id = p_academy and g.season = p_season and g.local_date = v_date
         and app_private.team_key(g.home) = app_private.team_key(v_home)
         and app_private.team_key(g.away) = app_private.team_key(v_away);
    end if;
    if v_id is null then
      insert into public.imported_games (academy_id, season, division, round, local_date, home, away, home_score, away_score, external_ref, imported_by)
      values (p_academy, p_season, nullif(btrim(coalesce(r->>'division', '')), ''), nullif(btrim(coalesce(r->>'round', '')), ''),
              v_date, v_home, v_away, v_hs, v_as, v_ref, auth.uid());
      v_new := v_new + 1;
    else
      update public.imported_games g
         set division = coalesce(nullif(btrim(coalesce(r->>'division', '')), ''), g.division),
             round = coalesce(nullif(btrim(coalesce(r->>'round', '')), ''), g.round),
             local_date = v_date, home = v_home, away = v_away,
             home_score = coalesce(v_hs, g.home_score), away_score = coalesce(v_as, g.away_score),
             external_ref = coalesce(v_ref, g.external_ref),
             imported_by = auth.uid(), imported_at = now()
       where g.id = v_id;
      v_upd := v_upd + 1;
    end if;
    if v_hs is not null then
      v_scored := v_scored + 1;
    end if;
  end loop;

  return jsonb_build_object('added', v_new, 'updated', v_upd, 'unreadable', v_bad, 'with_scores', v_scored);
end;
$fn$;

-- ----------------------------------------------------------------- the table
create or replace function public.division_table(p_team uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_team  public.teams;
  v_me    text;
  v_div   text;
  v_names text[];
begin
  select * into v_team from public.teams where id = p_team;
  if v_team.id is null or not (coalesce(app_private.is_team_member(p_team), false) or coalesce(app_private.is_team_coach(p_team), false)) then
    raise exception 'that squad''s table is its own people''s' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(v_team.external_ref, '')), '') is null then
    return jsonb_build_object('team', jsonb_build_object('id', v_team.id, 'name', v_team.name),
                              'reason', 'no_league_name', 'rows', '[]'::jsonb, 'games', 0);
  end if;
  v_me := app_private.team_key(v_team.external_ref);

  -- The division column, when the file had one, from any of our games.
  select g.division into v_div from public.imported_games g
   where g.academy_id = v_team.academy_id and g.season = v_team.season and g.division is not null
     and (app_private.team_key(g.home) = v_me or app_private.team_key(g.away) = v_me)
   order by g.imported_at desc
   limit 1;

  -- The teams around ours: who we play, who they play, and so on.
  with recursive games as (
    select app_private.team_key(g.home) as h, app_private.team_key(g.away) as a
      from public.imported_games g
     where g.academy_id = v_team.academy_id and g.season = v_team.season
       and (v_div is null or g.division is not distinct from v_div)
  ), reach as (
    select v_me as k
    union
    select case when g.h = r.k then g.a else g.h end
      from reach r
      join games g on g.h = r.k or g.a = r.k
  )
  select array_agg(k) into v_names from reach;

  return jsonb_build_object(
    'team', jsonb_build_object('id', v_team.id, 'name', v_team.name, 'league_name', v_team.external_ref),
    'division', v_div,
    'season', v_team.season,
    'updated_at', (select max(g.imported_at) from public.imported_games g
                    where g.academy_id = v_team.academy_id and g.season = v_team.season
                      and app_private.team_key(g.home) = any (v_names) and app_private.team_key(g.away) = any (v_names)),
    'games', (select count(*) from public.imported_games g
               where g.academy_id = v_team.academy_id and g.season = v_team.season and g.home_score is not null
                 and app_private.team_key(g.home) = any (v_names) and app_private.team_key(g.away) = any (v_names)),
    'rows', coalesce((
      with sides as (
        select app_private.team_key(g.home) as k, g.home as name, g.home_score as gf, g.away_score as ga
          from public.imported_games g
         where g.academy_id = v_team.academy_id and g.season = v_team.season
           and app_private.team_key(g.home) = any (v_names) and app_private.team_key(g.away) = any (v_names)
        union all
        select app_private.team_key(g.away), g.away, g.away_score, g.home_score
          from public.imported_games g
         where g.academy_id = v_team.academy_id and g.season = v_team.season
           and app_private.team_key(g.home) = any (v_names) and app_private.team_key(g.away) = any (v_names)
      ), tally as (
        select s.k, min(s.name) as name,
               count(*) filter (where s.gf is not null) as p,
               count(*) filter (where s.gf > s.ga) as w,
               count(*) filter (where s.gf = s.ga) as d,
               count(*) filter (where s.gf < s.ga) as l,
               coalesce(sum(s.gf), 0) as gf,
               coalesce(sum(s.ga), 0) as ga
          from sides s
         group by s.k
      )
      select jsonb_agg(jsonb_build_object(
               'team', t.name, 'ours', t.k = v_me,
               'p', t.p, 'w', t.w, 'd', t.d, 'l', t.l, 'gf', t.gf, 'ga', t.ga,
               'gd', t.gf - t.ga, 'pts', t.w * 3 + t.d)
             order by (t.w * 3 + t.d) desc, (t.gf - t.ga) desc, t.gf desc, t.name)
        from tally t
    ), '[]'::jsonb));
end;
$fn$;

-- 0121's import screen, with each squad's season.
create or replace function public.import_screen(p_academy uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_academy uuid;
begin
  if auth.uid() is null then
    return null;
  end if;

  v_academy := app_private.my_academy(p_academy);
  if v_academy is null then
    return null;
  end if;

  -- Importing a draw notifies whole teams, so this screen is for staff.
  if not coalesce(app_private.is_academy_coach(v_academy), false) then
    return jsonb_build_object('academy', null);
  end if;

  return jsonb_build_object(
    'academy', (select jsonb_build_object('id', a.id, 'name', a.name, 'timezone', a.timezone)
                  from public.academies a where a.id = v_academy),
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id,
               'name', t.name,
               'external_ref', t.external_ref,
               'skip_import', t.skip_import,
               -- 0228: the season the division table is filed under.
               'season', t.season
             ) order by t.name)
        from public.teams t
       where t.academy_id = v_academy and t.status = 'active'
    ), '[]'::jsonb)
  );
end;
$fn$;

revoke execute on function public.store_imported_games(uuid, text, jsonb) from public, anon;
revoke execute on function public.division_table(uuid) from public, anon;
grant execute on function public.store_imported_games(uuid, text, jsonb) to authenticated;
grant execute on function public.division_table(uuid) to authenticated;
