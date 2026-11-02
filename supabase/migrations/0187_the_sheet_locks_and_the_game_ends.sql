-- 0187: the sheet locks, and the game ends.
--
-- Three of the Squadi-parity rows the SPL will expect (SQUADI_INTEL §6A):
--
-- L-17  The team sheet LOCKS a set number of minutes before kick-off — 30 by
--       default, 15 for a youth division, set per division like every other
--       rule. After the lock only the appointed referee or the league can
--       change it, and every such change is logged as made after the lock.
--
-- L-19  A game is EDITABLE until it is ENDED, by the referee or the league,
--       and locked from then on: no sheet, no event, no score. What is wrong
--       after that is a CORRECTION REQUEST — from a manager, the referee or
--       the league — which the league applies or declines, with a note, and
--       all of it in the record. A score correction is applied by the
--       function; any other kind reopens the game for the league to make the
--       change on the sheet and end it again. The organiser's ruling on a
--       disputed score ends the game too.
--
-- L-21  FINALS ELIGIBILITY and BORROWING CAPS, both from the sheets and both
--       enforced on the sheet: a division can require a player to have been
--       on the sheet for N of the season's games before a final, and cap how
--       many games a player may play up from a lower squad.

-- ---------------------------------------------------------------- rules
alter table public.competition_divisions
  add column if not exists sheet_lock_mins integer not null default 30,
  add column if not exists finals_min_games integer,
  add column if not exists borrow_cap integer;
alter table public.competition_divisions
  drop constraint if exists competition_divisions_sheet_lock_mins_check,
  add constraint competition_divisions_sheet_lock_mins_check check (sheet_lock_mins between 0 and 180),
  drop constraint if exists competition_divisions_finals_min_games_check,
  add constraint competition_divisions_finals_min_games_check check (finals_min_games is null or finals_min_games between 1 and 50),
  drop constraint if exists competition_divisions_borrow_cap_check,
  add constraint competition_divisions_borrow_cap_check check (borrow_cap is null or borrow_cap between 0 and 50);

comment on column public.competition_divisions.sheet_lock_mins is
  'L-17: the sheet locks this many minutes before kick-off; after that only the referee or the league edits it.';
comment on column public.competition_divisions.finals_min_games is
  'L-21: a player must have been on a sheet for this many of the season''s games to play a final. Null: no rule.';
comment on column public.competition_divisions.borrow_cap is
  'L-21: how many games a player may play up from a lower squad in a season. Null: no cap.';

alter table public.fixtures
  add column if not exists ended_at timestamptz,
  add column if not exists ended_by uuid references public.profiles(id) on delete set null;

drop function if exists app_private.division_rules(uuid, text);
create function app_private.division_rules(p_competition uuid, p_division text)
returns table (
  scores_public boolean, ladder_enabled boolean,
  points_win integer, points_draw integer, points_loss integer, tie_break text,
  match_length_mins integer, squad_size_max integer,
  sheet_lock_mins integer, finals_min_games integer, borrow_cap integer
)
language sql stable as $$
  select coalesce(d.scores_public, true), coalesce(d.ladder_enabled, true),
         coalesce(d.points_win, 3), coalesce(d.points_draw, 1), coalesce(d.points_loss, 0),
         coalesce(d.tie_break, 'gd_then_gf'), d.match_length_mins, d.squad_size_max,
         coalesce(d.sheet_lock_mins, 30), d.finals_min_games, d.borrow_cap
    from (select 1) one
    left join public.competition_divisions d
      on d.competition_id = p_competition and d.division = p_division;
$$;

-- ------------------------------------------------------------- who and when
create or replace function app_private.is_fixture_referee(p_fixture uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.referee_appointments ra
    join public.referees r on r.id = ra.referee_id
   where ra.fixture_id = p_fixture and ra.status = 'accepted' and r.profile_id = auth.uid());
$$;

create or replace function app_private.sheet_lock_at(p_fixture uuid)
returns timestamptz language sql stable security definer set search_path = public as $$
  select f.starts_at - (r.sheet_lock_mins || ' minutes')::interval
    from public.fixtures f
    cross join lateral app_private.division_rules(f.competition_id, f.division) r
   where f.id = p_fixture;
$$;

create or replace function app_private.competition_tz(p_competition uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(a.timezone, 'Australia/Sydney')
    from public.competitions c join public.academies a on a.id = c.organiser_id
   where c.id = p_competition;
$$;

-- Everybody who runs an area of a competition: the league's staff, and the
-- holders of the league role for that area (0164's mapping).
create or replace function app_private.area_holders(p_competition uuid, p_area text)
returns setof uuid language sql stable security definer set search_path = public as $$
  select am.profile_id
    from public.competitions c
    join public.academy_members am on am.academy_id = c.organiser_id and am.status = 'active' and am.role in ('owner', 'admin')
   where c.id = p_competition
  union
  select lr.profile_id
    from public.competitions c
    join public.league_roles lr on lr.academy_id = c.organiser_id
   where c.id = p_competition
     and (
       (p_area = 'competition' and lr.role = 'competition_manager')
       or (p_area = 'referees' and lr.role = 'referee_coordinator')
       or (p_area = 'discipline' and lr.role = 'discipline_officer')
       or (p_area = 'grounds' and lr.role in ('ground_manager', 'competition_manager'))
     );
$$;

-- --------------------------------------------------------------- eligibility
-- The fixture is now part of the question: whether it is a final, and which
-- sheet is being re-submitted (so a sheet does not count against itself).
create or replace function app_private.ineligibility(p_entry uuid, p_player uuid, p_on date, p_fixture uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v_entry   public.competition_entries;
  v_fx      public.fixtures;
  v_rank    integer;
  v_up      boolean;
  v_name    text;
  v_from    text;
  v_head    text;
  v_own     boolean;
  v_cap     integer;
  v_min     integer;
  v_n       integer;
  v_why     text;
begin
  select * into v_entry from public.competition_entries where id = p_entry;
  select full_name into v_name from public.players where id = p_player;
  if v_name is null then return 'no such player'; end if;
  if p_fixture is not null then
    select * into v_fx from public.fixtures where id = p_fixture;
  end if;

  v_head := app_private.concussion_reason(p_player);
  if v_head is not null then return v_head; end if;

  v_own := exists (select 1 from public.entry_squads s where s.entry_id = p_entry and s.player_id = p_player);

  select d.rank, d.allow_playing_up, d.borrow_cap, d.finals_min_games into v_rank, v_up, v_cap, v_min
    from public.competition_divisions d
   where d.competition_id = v_entry.competition_id and d.division = v_entry.division;

  if not v_own then
    select lower_e.division into v_from
      from public.entry_squads s
      join public.competition_entries lower_e on lower_e.id = s.entry_id
      join public.competition_divisions ld
        on ld.competition_id = lower_e.competition_id and ld.division = lower_e.division
     where s.player_id = p_player
       and lower_e.competition_id = v_entry.competition_id
       and lower_e.academy_id = v_entry.academy_id
       and lower_e.id <> v_entry.id
       and v_rank is not null and ld.rank is not null and ld.rank < v_rank
     limit 1;
    if v_from is null then
      return v_name || ' is not on this squad';
    end if;
    if not coalesce(v_up, true) then
      return v_name || ' is on the ' || v_from || ' squad and this division does not allow playing up';
    end if;
    -- L-21: the borrowing cap. Games already played for a squad they are not on.
    if v_cap is not null then
      select count(distinct s.fixture_id) into v_n
        from public.match_sheet_players sp
        join public.match_sheets s on s.id = sp.sheet_id
       where s.competition_id = v_entry.competition_id and sp.player_id = p_player
         and (p_fixture is null or s.fixture_id <> p_fixture)
         and not exists (select 1 from public.entry_squads q where q.entry_id = s.entry_id and q.player_id = p_player);
      if v_n >= v_cap then
        return v_name || ' has already played up ' || v_n || case when v_n = 1 then ' time' else ' times' end
               || ' this season; this division allows ' || v_cap;
      end if;
    end if;
  end if;

  v_why := app_private.suspension_reason(v_entry.competition_id, p_player, p_on);
  if v_why is not null then return v_why; end if;

  -- L-21: finals need a season behind them.
  if v_fx.id is not null and v_fx.stage = 'final' and v_min is not null then
    select count(distinct s.fixture_id) into v_n
      from public.match_sheet_players sp
      join public.match_sheets s on s.id = sp.sheet_id
      join public.fixtures fx on fx.id = s.fixture_id
     where s.competition_id = v_entry.competition_id and sp.player_id = p_player
       and coalesce(fx.stage, 'group') <> 'final';
    if v_n < v_min then
      return v_name || ' has played ' || v_n || ' of the season''s games; a final needs ' || v_min;
    end if;
  end if;

  return null;
end;
$$;

create or replace function app_private.ineligibility(p_entry uuid, p_player uuid, p_on date default current_date)
returns text language sql stable security definer set search_path = public as $$
  select app_private.ineligibility(p_entry, p_player, p_on, null::uuid);
$$;

-- ------------------------------------------------------------------ the sheet
create or replace function public.submit_match_sheet(p_fixture uuid, p_entry uuid, p_players jsonb, p_captain uuid default null, p_keeper uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  f          public.fixtures;
  v_side     text;
  v_max      integer;
  v_lock_m   integer;
  v_n        integer;
  v_sheet    uuid;
  v_row      jsonb;
  v_why      text;
  v_on       date;
  v_lock     timestamptz;
  v_official boolean;
  v_manager  boolean;
  v_after    boolean := false;
begin
  select * into f from public.fixtures where id = p_fixture;
  if f.id is null then
    raise exception 'no such game' using errcode = '22023';
  end if;
  v_side := app_private.fixture_side(p_fixture, p_entry);
  v_manager  := coalesce(app_private.can_manage_entry(p_entry), false);
  v_official := coalesce(app_private.is_fixture_referee(p_fixture), false)
                or coalesce(app_private.is_competition_organiser(f.competition_id), false);
  if not (v_manager or v_official) then
    raise exception 'only the team''s manager or coach can submit its sheet' using errcode = '42501';
  end if;
  if f.ended_at is not null then
    raise exception 'this game has ended; ask the league for a correction' using errcode = '22023';
  end if;
  if f.status in ('final', 'forfeit', 'bye', 'cancelled') then
    raise exception 'this game is %; the sheet is closed', f.status using errcode = '22023';
  end if;
  select r.squad_size_max, r.sheet_lock_mins into v_max, v_lock_m
    from app_private.division_rules(f.competition_id, f.division) r;
  v_lock := app_private.sheet_lock_at(p_fixture);
  if v_lock is not null and now() >= v_lock then
    v_after := true;
    if not v_official then
      raise exception 'the sheet locked at % (% minutes before kick-off); only the referee or the league can change it now',
        to_char(v_lock at time zone app_private.competition_tz(f.competition_id), 'HH12:MI am'), v_lock_m
        using errcode = '22023';
    end if;
  end if;
  if p_players is null or jsonb_typeof(p_players) <> 'array' or jsonb_array_length(p_players) = 0 then
    raise exception 'a sheet needs players on it' using errcode = '22023';
  end if;
  v_n := jsonb_array_length(p_players);
  if v_max is not null and v_n > v_max then
    raise exception '% players on the sheet; this division allows %', v_n, v_max using errcode = '22023';
  end if;
  v_on := coalesce(f.starts_at::date, current_date);

  for v_row in select * from jsonb_array_elements(p_players) loop
    v_why := app_private.ineligibility(p_entry, (v_row->>'player_id')::uuid, v_on, p_fixture);
    if v_why is not null then
      raise exception '%', v_why using errcode = '22023';
    end if;
  end loop;

  insert into public.match_sheets (competition_id, fixture_id, entry_id, captain_player_id, keeper_player_id, submitted_by)
  values (f.competition_id, p_fixture, p_entry, p_captain, p_keeper, auth.uid())
  on conflict (fixture_id, entry_id) do update
    set captain_player_id = excluded.captain_player_id,
        keeper_player_id  = excluded.keeper_player_id,
        submitted_by = excluded.submitted_by,
        submitted_at = now(),
        status = 'submitted', confirmed_by = null, confirmed_at = null
  returning id into v_sheet;

  delete from public.match_sheet_players where sheet_id = v_sheet;
  insert into public.match_sheet_players (sheet_id, player_id, number, starting)
  select v_sheet, (x->>'player_id')::uuid, (x->>'number')::integer, coalesce((x->>'starting')::boolean, true)
    from jsonb_array_elements(p_players) x;

  perform app_private.log_sheet(f.competition_id, p_fixture, p_entry,
    case when v_after then 'sheet_changed_after_lock' else 'sheet_submitted' end,
    jsonb_build_object('players', v_n, 'side', v_side, 'after_lock', v_after,
                       'by_official', v_official));
  return v_sheet;
end;
$$;

create or replace function public.confirm_match_sheet(p_fixture uuid, p_entry uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  f        public.fixtures;
  v_other  uuid;
begin
  select * into f from public.fixtures where id = p_fixture;
  perform app_private.fixture_side(p_fixture, p_entry);
  v_other := case when f.home_entry_id = p_entry then f.away_entry_id else f.home_entry_id end;
  if not (coalesce(app_private.can_manage_entry(v_other), false)
          or coalesce(app_private.is_fixture_referee(p_fixture), false)
          or coalesce(app_private.is_competition_organiser(f.competition_id), false)) then
    raise exception 'a sheet is confirmed by the other team, the referee, or the organiser' using errcode = '42501';
  end if;
  if f.ended_at is not null then
    raise exception 'this game has ended; ask the league for a correction' using errcode = '22023';
  end if;
  update public.match_sheets
     set status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now()
   where fixture_id = p_fixture and entry_id = p_entry and status = 'submitted';
  if not found then
    raise exception 'there is no submitted sheet to confirm' using errcode = '22023';
  end if;
  perform app_private.log_sheet(f.competition_id, p_fixture, p_entry, 'sheet_confirmed');
end;
$$;

create or replace function public.record_match_event(p_fixture uuid, p_entry uuid, p_kind public.match_event_kind, p_player uuid default null, p_minute integer default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  f    public.fixtures;
  v_id uuid;
  v_other uuid;
begin
  select * into f from public.fixtures where id = p_fixture;
  perform app_private.fixture_side(p_fixture, p_entry);
  v_other := case when f.home_entry_id = p_entry then f.away_entry_id else f.home_entry_id end;
  if not (coalesce(app_private.can_manage_entry(p_entry), false)
          or coalesce(app_private.can_manage_entry(v_other), false)
          or coalesce(app_private.is_fixture_referee(p_fixture), false)
          or coalesce(app_private.is_competition_organiser(f.competition_id), false)) then
    raise exception 'only the teams in this game, the referee or the organiser can record events' using errcode = '42501';
  end if;
  if f.ended_at is not null then
    raise exception 'this game has ended; ask the league for a correction' using errcode = '22023';
  end if;
  if p_player is not null and not exists (
       select 1 from public.match_sheet_players sp
         join public.match_sheets s on s.id = sp.sheet_id
        where s.fixture_id = p_fixture and s.entry_id = p_entry and sp.player_id = p_player) then
    raise exception 'that player is not on this team''s sheet for this game' using errcode = '22023';
  end if;
  insert into public.match_events (competition_id, fixture_id, entry_id, player_id, kind, minute, note, created_by)
  values (f.competition_id, p_fixture, p_entry, p_player, p_kind, p_minute, nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_id;
  perform app_private.log_sheet(f.competition_id, p_fixture, p_entry, 'event_' || p_kind::text,
    jsonb_build_object('player_id', p_player, 'minute', p_minute));
  return v_id;
end;
$$;

create or replace function public.enter_sheet_score(p_fixture uuid, p_entry uuid, p_ours integer, p_theirs integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  f        public.fixtures;
  v_side   text;
  v_other  uuid;
  o        public.match_sheets;
  v_home   integer;
  v_away   integer;
begin
  if not coalesce(app_private.can_manage_entry(p_entry), false) then
    raise exception 'only the team''s manager or coach can enter its score' using errcode = '42501';
  end if;
  v_side := app_private.fixture_side(p_fixture, p_entry);
  select * into f from public.fixtures where id = p_fixture;
  if f.ended_at is not null then
    raise exception 'this game has ended; ask the league for a correction' using errcode = '22023';
  end if;
  if f.status in ('final', 'forfeit', 'bye', 'cancelled') then
    raise exception 'this game is already %', f.status using errcode = '22023';
  end if;
  if p_ours is null or p_theirs is null then
    raise exception 'both scores are needed' using errcode = '22023';
  end if;

  insert into public.match_sheets (competition_id, fixture_id, entry_id, our_score, their_score, submitted_by)
  values (f.competition_id, p_fixture, p_entry, p_ours, p_theirs, auth.uid())
  on conflict (fixture_id, entry_id) do update
    set our_score = excluded.our_score, their_score = excluded.their_score;
  perform app_private.log_sheet(f.competition_id, p_fixture, p_entry, 'score_entered',
    jsonb_build_object('ours', p_ours, 'theirs', p_theirs));

  v_other := case when v_side = 'home' then f.away_entry_id else f.home_entry_id end;
  select * into o from public.match_sheets where fixture_id = p_fixture and entry_id = v_other;
  if o.our_score is null then
    return jsonb_build_object('state', 'waiting', 'for', 'the other team');
  end if;

  if o.our_score = p_theirs and o.their_score = p_ours then
    v_home := case when v_side = 'home' then p_ours else p_theirs end;
    v_away := case when v_side = 'home' then p_theirs else p_ours end;
    update public.fixtures
       set home_score = v_home, away_score = v_away, status = 'final',
           score_disputed = false, score_entered_by = auth.uid(), score_entered_at = now()
     where id = p_fixture;
    update public.match_sheets set status = case when status = 'disputed' then 'submitted' else status end
     where fixture_id = p_fixture;
    perform app_private.log_sheet(f.competition_id, p_fixture, null, 'score_agreed',
      jsonb_build_object('home', v_home, 'away', v_away));
    return jsonb_build_object('state', 'final', 'home', v_home, 'away', v_away);
  end if;

  update public.fixtures set score_disputed = true where id = p_fixture;
  update public.match_sheets set status = 'disputed' where fixture_id = p_fixture;
  perform app_private.log_sheet(f.competition_id, p_fixture, null, 'score_disputed',
    jsonb_build_object('this_side', jsonb_build_object('ours', p_ours, 'theirs', p_theirs),
                       'other_side', jsonb_build_object('ours', o.our_score, 'theirs', o.their_score)));
  return jsonb_build_object('state', 'disputed');
end;
$$;

-- A ruling is final: it ends the game as well.
create or replace function public.rule_on_score(p_fixture uuid, p_home integer, p_away integer, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  f public.fixtures;
begin
  select * into f from public.fixtures where id = p_fixture;
  if f.id is null or not coalesce(app_private.is_competition_organiser(f.competition_id), false) then
    raise exception 'only the organiser can rule on a score' using errcode = '42501';
  end if;
  update public.fixtures
     set home_score = p_home, away_score = p_away, status = 'final',
         score_disputed = false, score_entered_by = auth.uid(), score_entered_at = now(),
         ended_at = coalesce(ended_at, now()), ended_by = coalesce(ended_by, auth.uid()),
         notes = coalesce(nullif(btrim(coalesce(p_note, '')), ''), notes)
   where id = p_fixture;
  update public.match_sheets set status = 'confirmed' where fixture_id = p_fixture and status = 'disputed';
  perform app_private.log_sheet(f.competition_id, p_fixture, null, 'score_ruled',
    jsonb_build_object('home', p_home, 'away', p_away, 'note', p_note));
end;
$$;

-- ----------------------------------------------------------------- lifecycle
create or replace function public.end_match(p_fixture uuid, p_note text default null)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  f public.fixtures;
begin
  select * into f from public.fixtures where id = p_fixture;
  if f.id is null then
    raise exception 'no such game' using errcode = '22023';
  end if;
  if not (coalesce(app_private.is_fixture_referee(p_fixture), false)
          or coalesce(app_private.may_run(f.competition_id, 'competition'), false)) then
    raise exception 'only the referee or the league ends a game' using errcode = '42501';
  end if;
  if f.ended_at is not null then
    return f.ended_at;
  end if;
  if f.starts_at is null or f.starts_at > now() then
    raise exception 'this game has not kicked off yet' using errcode = '22023';
  end if;
  if f.status in ('bye', 'cancelled', 'postponed') then
    raise exception 'this game is %', f.status using errcode = '22023';
  end if;
  update public.fixtures set ended_at = now(), ended_by = auth.uid(), updated_at = now() where id = p_fixture;
  perform app_private.log_sheet(f.competition_id, p_fixture, null, 'match_ended',
    jsonb_build_object('note', nullif(btrim(coalesce(p_note, '')), '')));
  return now();
end;
$$;

create or replace function public.reopen_match(p_fixture uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare
  f public.fixtures;
begin
  select * into f from public.fixtures where id = p_fixture;
  if f.id is null or not coalesce(app_private.may_run(f.competition_id, 'competition'), false) then
    raise exception 'only the league reopens a game' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_note, ''))) = 0 then
    raise exception 'say why' using errcode = '22023';
  end if;
  if f.ended_at is null then
    return;
  end if;
  update public.fixtures set ended_at = null, ended_by = null, updated_at = now() where id = p_fixture;
  perform app_private.log_sheet(f.competition_id, p_fixture, null, 'match_reopened', jsonb_build_object('note', btrim(p_note)));
end;
$$;

-- --------------------------------------------------------------- corrections
create table if not exists public.match_corrections (
  id              uuid primary key default gen_random_uuid(),
  competition_id  uuid not null references public.competitions(id) on delete cascade,
  fixture_id      uuid not null references public.fixtures(id) on delete cascade,
  entry_id        uuid references public.competition_entries(id) on delete set null,
  kind            text not null check (kind in ('score', 'event', 'sheet', 'other')),
  detail          text not null check (btrim(detail) <> ''),
  proposed_home   integer check (proposed_home is null or proposed_home >= 0),
  proposed_away   integer check (proposed_away is null or proposed_away >= 0),
  status          text not null default 'open' check (status in ('open', 'applied', 'declined')),
  requested_by    uuid not null references public.profiles(id) on delete cascade,
  created_at      timestamptz not null default now(),
  decided_by      uuid references public.profiles(id) on delete set null,
  decided_at      timestamptz,
  decision_note   text
);
create index if not exists match_corrections_fixture on public.match_corrections (fixture_id, status);
create index if not exists match_corrections_competition on public.match_corrections (competition_id, status);
alter table public.match_corrections enable row level security;

-- Read by the league and by the managers of either side. Never by a parent,
-- never by the public page: a correction is somebody saying what went wrong.
drop policy if exists match_corrections_select on public.match_corrections;
create policy match_corrections_select on public.match_corrections for select to authenticated
  using (
    (select app_private.may_run(competition_id, 'competition'))
    or exists (
      select 1 from public.fixtures f
       where f.id = fixture_id
         and (app_private.can_manage_entry(f.home_entry_id) or app_private.can_manage_entry(f.away_entry_id)))
  );
-- No insert, update or delete for anyone: the functions below are the way.

create or replace function app_private.correction_push(p_correction uuid, p_to uuid, p_kind text, p_title text, p_body text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_c   public.match_corrections;
  v_org uuid;
begin
  select * into v_c from public.match_corrections where id = p_correction;
  select organiser_id into v_org from public.competitions where id = v_c.competition_id;
  insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload, dedupe_key)
  values (v_org, p_to, p_kind, p_title, left(p_body, 200),
          '/competitions/' || v_c.competition_id || '/match/' || v_c.fixture_id,
          jsonb_build_object('correction_id', p_correction, 'fixture_id', v_c.fixture_id),
          'mcorr-' || p_correction || '-' || p_to || '-' || p_kind || '-' || extract(epoch from now())::bigint);
end;
$$;

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
    'fixture_change_decided','mention','match_correction_requested','match_correction_decided']));
end $$;

create or replace function public.request_match_correction(p_fixture uuid, p_kind text, p_detail text, p_home integer default null, p_away integer default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  f       public.fixtures;
  v_entry uuid;
  v_id    uuid;
  v_who   uuid;
  v_home  text;
  v_away  text;
begin
  select * into f from public.fixtures where id = p_fixture;
  if f.id is null then
    raise exception 'no such game' using errcode = '22023';
  end if;
  if coalesce(app_private.can_manage_entry(f.home_entry_id), false) then
    v_entry := f.home_entry_id;
  elsif coalesce(app_private.can_manage_entry(f.away_entry_id), false) then
    v_entry := f.away_entry_id;
  elsif coalesce(app_private.is_fixture_referee(p_fixture), false)
        or coalesce(app_private.may_run(f.competition_id, 'competition'), false) then
    v_entry := null;
  else
    raise exception 'only the teams in this game, the referee or the league ask for a correction' using errcode = '42501';
  end if;
  if p_kind not in ('score', 'event', 'sheet', 'other') then
    raise exception 'a correction is to the score, an event, the sheet, or other' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_detail, ''))) = 0 then
    raise exception 'say what is wrong' using errcode = '22023';
  end if;
  if p_kind = 'score' and (p_home is null or p_away is null) then
    raise exception 'a score correction needs both scores' using errcode = '22023';
  end if;
  if f.ended_at is null and f.status not in ('final', 'forfeit') then
    raise exception 'this game has not ended; change it on the sheet' using errcode = '22023';
  end if;
  if exists (select 1 from public.match_corrections c where c.fixture_id = p_fixture and c.status = 'open' and c.kind = p_kind) then
    raise exception 'there is already an open % correction for this game', p_kind using errcode = '23505';
  end if;

  insert into public.match_corrections (competition_id, fixture_id, entry_id, kind, detail, proposed_home, proposed_away, requested_by)
  values (f.competition_id, p_fixture, v_entry, p_kind, btrim(p_detail), p_home, p_away, auth.uid())
  returning id into v_id;
  perform app_private.log_sheet(f.competition_id, p_fixture, v_entry, 'correction_requested',
    jsonb_build_object('kind', p_kind, 'correction_id', v_id, 'home', p_home, 'away', p_away));

  select h.display_name, a.display_name into v_home, v_away
    from public.fixtures x
    left join public.competition_entries h on h.id = x.home_entry_id
    left join public.competition_entries a on a.id = x.away_entry_id
   where x.id = p_fixture;
  for v_who in select * from app_private.area_holders(f.competition_id, 'competition') loop
    if v_who <> auth.uid() then
      perform app_private.correction_push(v_id, v_who, 'match_correction_requested',
        'Correction asked for: ' || coalesce(v_home, '?') || ' v ' || coalesce(v_away, '?'),
        p_kind || case when p_kind = 'score' then ' ' || p_home || '–' || p_away else '' end || ' — ' || btrim(p_detail));
    end if;
  end loop;
  return v_id;
end;
$$;

create or replace function public.decide_match_correction(p_correction uuid, p_apply boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  c public.match_corrections;
  f public.fixtures;
begin
  select * into c from public.match_corrections where id = p_correction;
  if c.id is null or not coalesce(app_private.may_run(c.competition_id, 'competition'), false) then
    raise exception 'only the league decides a correction' using errcode = '42501';
  end if;
  if c.status <> 'open' then
    raise exception 'already %', c.status using errcode = '22023';
  end if;
  select * into f from public.fixtures where id = c.fixture_id;

  if p_apply then
    if c.kind = 'score' then
      update public.fixtures
         set home_score = c.proposed_home, away_score = c.proposed_away, status = 'final',
             score_disputed = false, score_entered_by = auth.uid(), score_entered_at = now(),
             ended_at = coalesce(ended_at, now()), ended_by = coalesce(ended_by, auth.uid()),
             updated_at = now()
       where id = c.fixture_id;
      update public.match_sheets set status = 'confirmed' where fixture_id = c.fixture_id and status = 'disputed';
      perform app_private.log_sheet(c.competition_id, c.fixture_id, null, 'score_corrected',
        jsonb_build_object('home', c.proposed_home, 'away', c.proposed_away, 'correction_id', c.id, 'note', p_note));
    else
      -- Reopened for the league to make the change on the sheet, then end it again.
      update public.fixtures set ended_at = null, ended_by = null, updated_at = now() where id = c.fixture_id;
      perform app_private.log_sheet(c.competition_id, c.fixture_id, null, 'match_reopened',
        jsonb_build_object('correction_id', c.id, 'note', coalesce(p_note, 'to apply a ' || c.kind || ' correction')));
    end if;
  end if;

  update public.match_corrections
     set status = case when p_apply then 'applied' else 'declined' end,
         decided_by = auth.uid(), decided_at = now(),
         decision_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_correction;
  perform app_private.log_sheet(c.competition_id, c.fixture_id, c.entry_id,
    case when p_apply then 'correction_applied' else 'correction_declined' end,
    jsonb_build_object('correction_id', c.id, 'note', p_note));

  if c.requested_by <> auth.uid() then
    perform app_private.correction_push(c.id, c.requested_by, 'match_correction_decided',
      case when p_apply then 'The league applied your correction' else 'The league declined your correction' end,
      coalesce(nullif(btrim(coalesce(p_note, '')), ''), c.kind || ' — ' || c.detail));
  end if;
end;
$$;

-- The league's list, and a club's own; RLS does the filtering.
create or replace function public.match_corrections_view(p_competition uuid)
returns table (
  id uuid, fixture_id uuid, kind text, detail text, proposed_home integer, proposed_away integer,
  status text, requested_by_name text, entry_name text, home text, away text, round text, division text,
  created_at timestamptz, decided_at timestamptz, decision_note text
)
language sql stable set search_path = public as $$
  select c.id, c.fixture_id, c.kind, c.detail, c.proposed_home, c.proposed_away, c.status,
         (select pr.full_name from public.profiles pr where pr.id = c.requested_by),
         (select e.display_name from public.competition_entries e where e.id = c.entry_id),
         (select e.display_name from public.competition_entries e where e.id = f.home_entry_id),
         (select e.display_name from public.competition_entries e where e.id = f.away_entry_id),
         f.round, f.division, c.created_at, c.decided_at, c.decision_note
    from public.match_corrections c
    join public.fixtures f on f.id = c.fixture_id
   where c.competition_id = p_competition
   order by (c.status = 'open') desc, c.created_at desc;
$$;

-- ------------------------------------------------------------------ the view
create or replace function public.match_sheet_view(p_fixture uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  f        public.fixtures;
  v_lock   timestamptz;
  v_ref    boolean;
  v_run    boolean;
  v_inside boolean;
begin
  select * into f from public.fixtures where id = p_fixture;
  if f.id is null or not coalesce(app_private.is_competition_participant(f.competition_id), false) then
    raise exception 'not yours to see' using errcode = '42501';
  end if;
  v_lock := app_private.sheet_lock_at(p_fixture);
  v_ref  := coalesce(app_private.is_fixture_referee(p_fixture), false);
  v_run  := coalesce(app_private.may_run(f.competition_id, 'competition'), false);
  v_inside := v_run or v_ref
              or coalesce(app_private.can_manage_entry(f.home_entry_id), false)
              or coalesce(app_private.can_manage_entry(f.away_entry_id), false);
  return jsonb_build_object(
    'fixture', jsonb_build_object(
      'id', f.id, 'division', f.division, 'round', f.round, 'starts_at', f.starts_at, 'stage', f.stage,
      'status', f.status, 'home_score', f.home_score, 'away_score', f.away_score,
      'score_disputed', f.score_disputed, 'notes', f.notes,
      'home_entry_id', f.home_entry_id, 'away_entry_id', f.away_entry_id,
      'home', (select e.display_name from public.competition_entries e where e.id = f.home_entry_id),
      'away', (select e.display_name from public.competition_entries e where e.id = f.away_entry_id),
      'ended_at', f.ended_at,
      'lock_at', v_lock,
      'locked', (v_lock is not null and now() >= v_lock)
    ),
    'can_manage_home', coalesce(app_private.can_manage_entry(f.home_entry_id), false),
    'can_manage_away', coalesce(app_private.can_manage_entry(f.away_entry_id), false),
    'is_organiser', coalesce(app_private.is_competition_organiser(f.competition_id), false),
    'is_referee', v_ref,
    'may_end', f.ended_at is null and (v_ref or v_run) and f.starts_at is not null and f.starts_at <= now()
               and f.status not in ('bye', 'cancelled', 'postponed'),
    'may_reopen', f.ended_at is not null and v_run,
    'rules', (select to_jsonb(r) from app_private.division_rules(f.competition_id, f.division) r),
    'sheets', coalesce((
      select jsonb_object_agg(case when s.entry_id = f.home_entry_id then 'home' else 'away' end,
        jsonb_build_object(
          'status', s.status, 'our_score', s.our_score, 'their_score', s.their_score,
          'captain_player_id', s.captain_player_id, 'keeper_player_id', s.keeper_player_id,
          'submitted_at', s.submitted_at, 'confirmed_at', s.confirmed_at,
          'players', coalesce((
            select jsonb_agg(jsonb_build_object('player_id', sp.player_id, 'number', sp.number, 'starting', sp.starting,
                     'name', (select pl.full_name from public.players pl where pl.id = sp.player_id))
                     order by sp.starting desc, sp.number nulls last)
              from public.match_sheet_players sp where sp.sheet_id = s.id), '[]'::jsonb)
        ))
        from public.match_sheets s where s.fixture_id = p_fixture
    ), '{}'::jsonb),
    'squads', jsonb_build_object(
      'home', coalesce((select jsonb_agg(jsonb_build_object('player_id', q.player_id, 'number', q.number,
                         'name', (select pl.full_name from public.players pl where pl.id = q.player_id),
                         'ineligible', app_private.ineligibility(f.home_entry_id, q.player_id, coalesce(f.starts_at::date, current_date), f.id))
                         order by q.number nulls last)
                  from public.entry_squads q where q.entry_id = f.home_entry_id), '[]'::jsonb),
      'away', coalesce((select jsonb_agg(jsonb_build_object('player_id', q.player_id, 'number', q.number,
                         'name', (select pl.full_name from public.players pl where pl.id = q.player_id),
                         'ineligible', app_private.ineligibility(f.away_entry_id, q.player_id, coalesce(f.starts_at::date, current_date), f.id))
                         order by q.number nulls last)
                  from public.entry_squads q where q.entry_id = f.away_entry_id), '[]'::jsonb)
    ),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'entry_id', e.entry_id, 'player_id', e.player_id,
               'name', (select pl.full_name from public.players pl where pl.id = e.player_id),
               'kind', e.kind, 'minute', e.minute, 'note', e.note) order by e.minute nulls last, e.created_at)
        from public.match_events e where e.fixture_id = p_fixture), '[]'::jsonb),
    'corrections', case when v_inside then coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'detail', c.detail,
               'proposed_home', c.proposed_home, 'proposed_away', c.proposed_away, 'status', c.status,
               'requested_by', (select pr.full_name from public.profiles pr where pr.id = c.requested_by),
               'created_at', c.created_at, 'decided_at', c.decided_at, 'decision_note', c.decision_note)
               order by (c.status = 'open') desc, c.created_at desc)
        from public.match_corrections c where c.fixture_id = p_fixture), '[]'::jsonb) else '[]'::jsonb end,
    'log', coalesce((
      select jsonb_agg(jsonb_build_object('action', l.action, 'detail', l.detail, 'at', l.at,
               'by', (select pr.full_name from public.profiles pr where pr.id = l.actor)) order by l.at)
        from public.match_sheet_log l where l.fixture_id = p_fixture), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.end_match(uuid, text) from public, anon;
grant execute on function public.end_match(uuid, text) to authenticated;
revoke execute on function public.reopen_match(uuid, text) from public, anon;
grant execute on function public.reopen_match(uuid, text) to authenticated;
revoke execute on function public.request_match_correction(uuid, text, text, integer, integer) from public, anon;
grant execute on function public.request_match_correction(uuid, text, text, integer, integer) to authenticated;
revoke execute on function public.decide_match_correction(uuid, boolean, text) from public, anon;
grant execute on function public.decide_match_correction(uuid, boolean, text) to authenticated;
revoke execute on function public.match_corrections_view(uuid) from public, anon;
grant execute on function public.match_corrections_view(uuid) to authenticated;
grant select on public.match_corrections to authenticated;
