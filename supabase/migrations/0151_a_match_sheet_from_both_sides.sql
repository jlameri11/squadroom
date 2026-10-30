-- 0151: a match sheet, from both sides.
--
-- L-03 and L-05, the core of running a season without Dribl. A fixture had
-- a score and nothing else: no record of who played, no way for the other
-- team to say "that is not who played", no goals or cards, no way for two
-- managers to disagree about the score except by phoning the league.
--
-- SEASON SQUADS. Each entry in a competition has a squad list for the
-- season — seeded from the club's roster when the entry is a club's team,
-- editable by the club. Playing UP is allowed by division rank within the
-- same club's entries (a U10 may fill in for the U11s), never down, and
-- only where the division's rules allow it. ELIGIBILITY IS CHECKED BEFORE
-- A SHEET IS ACCEPTED, naming the first ineligible child: the Monday
-- dispute about an ineligible player is the thing leagues spend their
-- weeks on, and a sheet that cannot be submitted with one on it is the
-- whole point. Suspensions (0152) hook in here.
--
-- SHEETS. Each side submits its own — numbers, captain, keeper — and the
-- opposition CONFIRMS it, which is the signature on paper. Events (goals,
-- assists, yellow / red / blue, subs) are recorded against a player by
-- either side or the organiser. BOTH SIDES ENTER THE SCORE. When they
-- agree, the fixture is final and the ladder moves; when they disagree,
-- the fixture is DISPUTED and nothing moves until the organiser rules —
-- never averaged, never "home team wins". Every action is logged with who
-- and when, because a league's authority is its record.
--
-- Also here: 0132's resolve_finals guard broke scoring for club managers.
-- on_fixture_scored, a trigger, calls resolve_finals, which since 0132
-- refuses anyone but the organiser — and the caller, inside a club
-- manager's score update, is the manager. The trigger now calls an
-- internal version with no guard; the public RPC keeps its guard.

-- ---------------------------------------------------------------------------
-- The 0132 regression
-- ---------------------------------------------------------------------------

create or replace function app_private.resolve_finals_internal(p_competition uuid, p_division text)
returns integer
language plpgsql volatile security definer set search_path = public as $$
declare
  f        record;
  v_filled integer := 0;
begin
  for f in
    select * from public.fixtures
     where competition_id = p_competition and division = p_division and stage = 'final'
     order by starts_at
  loop
    if f.home_entry_id is null and f.home_source is not null then
      update public.fixtures
         set home_entry_id = public.resolve_source(p_competition, p_division, f.home_source)
       where id = f.id and home_entry_id is null;
    end if;
    if f.away_entry_id is null and f.away_source is not null then
      update public.fixtures
         set away_entry_id = public.resolve_source(p_competition, p_division, f.away_source)
       where id = f.id and away_entry_id is null;
    end if;
  end loop;
  select count(*) into v_filled
    from public.fixtures
   where competition_id = p_competition and division = p_division and stage = 'final'
     and home_entry_id is not null and away_entry_id is not null;
  return v_filled;
end;
$$;

create or replace function public.resolve_finals(p_competition uuid, p_division text)
returns integer
language plpgsql volatile security definer set search_path = public as $$
begin
  if not coalesce(app_private.is_competition_organiser(p_competition), false) then
    raise exception 'only the organiser can seed the finals' using errcode = '42501';
  end if;
  return app_private.resolve_finals_internal(p_competition, p_division);
end;
$$;

create or replace function public.on_fixture_scored()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('final','forfeit') and new.home_score is not null
     and (old.home_score is distinct from new.home_score
          or old.status is distinct from new.status) then
    perform app_private.resolve_finals_internal(new.competition_id, new.division);
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- L-03: season squads and eligibility
-- ---------------------------------------------------------------------------

alter table public.competition_divisions
  add column if not exists rank integer check (rank between 1 and 50),
  add column if not exists allow_playing_up boolean not null default true;

alter table public.fixtures
  add column if not exists score_disputed boolean not null default false;

create table if not exists public.entry_squads (
  id             uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  entry_id       uuid not null references public.competition_entries(id) on delete cascade,
  academy_id     uuid not null references public.academies(id) on delete cascade,
  player_id      uuid not null,
  number         integer check (number between 0 and 99),
  added_by       uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  constraint entry_squads_player_fkey foreign key (player_id, academy_id)
    references public.players (id, academy_id) on delete cascade,
  constraint entry_squads_once unique (entry_id, player_id)
);
alter table public.entry_squads enable row level security;
create policy entry_squads_select on public.entry_squads for select to authenticated
  using ((select app_private.is_competition_participant(entry_squads.competition_id)));
create policy entry_squads_insert on public.entry_squads for insert to authenticated
  with check ((select app_private.can_manage_entry(entry_squads.entry_id))
              or (select app_private.is_competition_organiser(entry_squads.competition_id)));
create policy entry_squads_delete on public.entry_squads for delete to authenticated
  using ((select app_private.can_manage_entry(entry_squads.entry_id))
         or (select app_private.is_competition_organiser(entry_squads.competition_id)));
create index if not exists entry_squads_entry_idx on public.entry_squads (entry_id);

/** Fill an entry's season squad from the club's roster for that team. */
create or replace function public.seed_entry_squad(p_entry uuid)
returns integer
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_entry public.competition_entries;
  n integer;
begin
  select * into v_entry from public.competition_entries where id = p_entry;
  if v_entry.id is null or not (coalesce(app_private.can_manage_entry(p_entry), false)
       or coalesce(app_private.is_competition_organiser(v_entry.competition_id), false)) then
    raise exception 'only the club or the organiser can set a squad' using errcode = '42501';
  end if;
  if v_entry.team_id is null or v_entry.academy_id is null then
    raise exception 'this entry is a name on the draw with no squad behind it yet' using errcode = '22023';
  end if;
  insert into public.entry_squads (competition_id, entry_id, academy_id, player_id, number, added_by)
  select v_entry.competition_id, v_entry.id, v_entry.academy_id, pl.id,
         (select sn.number from public.squad_numbers sn
           where sn.player_id = pl.id
           order by sn.created_at desc limit 1),
         auth.uid()
    from public.players pl
   where pl.team_id = v_entry.team_id and pl.academy_id = v_entry.academy_id
  on conflict (entry_id, player_id) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$fn$;

/**
 * May this child play for this entry in this competition?
 *   · on the entry's season squad, or
 *   · playing UP: on a lower-ranked division's squad for the SAME club in
 *     the same competition, where the higher division allows it;
 *   · and not suspended (hook, filled by 0152).
 * Returns null when eligible, else the reason in words.
 */
create or replace function app_private.ineligibility(p_entry uuid, p_player uuid, p_on date default current_date)
returns text
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_entry public.competition_entries;
  v_rank  integer;
  v_up    boolean;
  v_name  text;
  v_from  text;
begin
  select * into v_entry from public.competition_entries where id = p_entry;
  select full_name into v_name from public.players where id = p_player;
  if v_name is null then return 'no such player'; end if;

  if exists (select 1 from public.entry_squads s where s.entry_id = p_entry and s.player_id = p_player) then
    return app_private.suspension_reason(v_entry.competition_id, p_player, p_on);
  end if;

  select d.rank, d.allow_playing_up into v_rank, v_up
    from public.competition_divisions d
   where d.competition_id = v_entry.competition_id and d.division = v_entry.division;

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

  if v_from is not null then
    if coalesce(v_up, true) then
      return app_private.suspension_reason(v_entry.competition_id, p_player, p_on);
    end if;
    return v_name || ' is on the ' || v_from || ' squad and this division does not allow playing up';
  end if;

  return v_name || ' is not on this squad';
end;
$fn$;

-- The hook 0152 fills. Until then nobody is suspended.
create or replace function app_private.suspension_reason(p_competition uuid, p_player uuid, p_on date)
returns text
language sql stable as $fn$
  select null::text;
$fn$;

-- ---------------------------------------------------------------------------
-- L-05: match sheets, events, scores, dispute, log
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.sheet_status as enum ('submitted', 'confirmed', 'disputed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.match_event_kind as enum ('goal', 'assist', 'yellow', 'red', 'blue', 'sub_on', 'sub_off', 'own_goal');
exception when duplicate_object then null; end $$;

create table if not exists public.match_sheets (
  id             uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  fixture_id     uuid not null references public.fixtures(id) on delete cascade,
  entry_id       uuid not null references public.competition_entries(id) on delete cascade,
  status         public.sheet_status not null default 'submitted',
  captain_player_id uuid,
  keeper_player_id  uuid,
  our_score      integer check (our_score between 0 and 99),
  their_score    integer check (their_score between 0 and 99),
  submitted_by   uuid references public.profiles(id) on delete set null,
  submitted_at   timestamptz not null default now(),
  confirmed_by   uuid references public.profiles(id) on delete set null,
  confirmed_at   timestamptz,
  constraint match_sheets_once unique (fixture_id, entry_id)
);
create table if not exists public.match_sheet_players (
  sheet_id   uuid not null references public.match_sheets(id) on delete cascade,
  player_id  uuid not null,
  number     integer check (number between 0 and 99),
  starting   boolean not null default true,
  primary key (sheet_id, player_id)
);
create table if not exists public.match_events (
  id             uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  fixture_id     uuid not null references public.fixtures(id) on delete cascade,
  entry_id       uuid not null references public.competition_entries(id) on delete cascade,
  player_id      uuid,
  kind           public.match_event_kind not null,
  minute         integer check (minute between 0 and 150),
  note           text,
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);
create table if not exists public.match_sheet_log (
  id             bigserial primary key,
  competition_id uuid not null references public.competitions(id) on delete cascade,
  fixture_id     uuid not null references public.fixtures(id) on delete cascade,
  entry_id       uuid,
  actor          uuid references public.profiles(id) on delete set null,
  action         text not null,
  detail         jsonb not null default '{}'::jsonb,
  at             timestamptz not null default now()
);

alter table public.match_sheets enable row level security;
alter table public.match_sheet_players enable row level security;
alter table public.match_events enable row level security;
alter table public.match_sheet_log enable row level security;

-- Readable by everyone in the competition: the opposition has to see a
-- sheet to confirm it, and the organiser has to see everything. Written by
-- nobody directly.
create policy match_sheets_select on public.match_sheets for select to authenticated
  using ((select app_private.is_competition_participant(match_sheets.competition_id)));
create policy match_sheet_players_select on public.match_sheet_players for select to authenticated
  using (exists (select 1 from public.match_sheets s where s.id = match_sheet_players.sheet_id
                   and (select app_private.is_competition_participant(s.competition_id))));
create policy match_events_select on public.match_events for select to authenticated
  using ((select app_private.is_competition_participant(match_events.competition_id)));
create policy match_sheet_log_select on public.match_sheet_log for select to authenticated
  using ((select app_private.is_competition_participant(match_sheet_log.competition_id)));

create index if not exists match_sheets_fixture_idx on public.match_sheets (fixture_id);
create index if not exists match_events_fixture_idx on public.match_events (fixture_id);
create index if not exists match_events_player_idx on public.match_events (competition_id, player_id, kind);
create index if not exists match_sheet_log_fixture_idx on public.match_sheet_log (fixture_id);

create or replace function app_private.log_sheet(p_competition uuid, p_fixture uuid, p_entry uuid, p_action text, p_detail jsonb default '{}'::jsonb)
returns void
language sql volatile security definer set search_path = public as $fn$
  insert into public.match_sheet_log (competition_id, fixture_id, entry_id, actor, action, detail)
  values (p_competition, p_fixture, p_entry, auth.uid(), p_action, coalesce(p_detail, '{}'::jsonb));
$fn$;

/** Which side of the fixture an entry is, raising if neither. */
create or replace function app_private.fixture_side(p_fixture uuid, p_entry uuid)
returns text
language plpgsql stable security definer set search_path = public as $fn$
declare
  f public.fixtures;
begin
  select * into f from public.fixtures where id = p_fixture;
  if f.id is null then raise exception 'no such fixture' using errcode = '22023'; end if;
  if f.home_entry_id = p_entry then return 'home'; end if;
  if f.away_entry_id = p_entry then return 'away'; end if;
  raise exception 'that team is not in this game' using errcode = '22023';
end;
$fn$;

create or replace function public.submit_match_sheet(
  p_fixture uuid, p_entry uuid, p_players jsonb,
  p_captain uuid default null, p_keeper uuid default null
)
returns uuid
language plpgsql volatile security definer set search_path = public as $fn$
declare
  f        public.fixtures;
  v_side   text;
  v_max    integer;
  v_n      integer;
  v_sheet  uuid;
  p        jsonb;
  v_why    text;
  v_on     date;
begin
  if not coalesce(app_private.can_manage_entry(p_entry), false) then
    raise exception 'only the team''s manager or coach can submit its sheet' using errcode = '42501';
  end if;
  v_side := app_private.fixture_side(p_fixture, p_entry);
  select * into f from public.fixtures where id = p_fixture;
  if f.status in ('final', 'forfeit', 'bye', 'cancelled') then
    raise exception 'this game is %; the sheet is closed', f.status using errcode = '22023';
  end if;
  if p_players is null or jsonb_typeof(p_players) <> 'array' or jsonb_array_length(p_players) = 0 then
    raise exception 'a sheet needs players on it' using errcode = '22023';
  end if;
  select r.squad_size_max into v_max from app_private.division_rules(f.competition_id, f.division) r;
  v_n := jsonb_array_length(p_players);
  if v_max is not null and v_n > v_max then
    raise exception '% players on the sheet; this division allows %', v_n, v_max using errcode = '22023';
  end if;
  v_on := coalesce(f.starts_at::date, current_date);

  -- Every player eligible, or the sheet is refused naming the first who is not.
  for p in select * from jsonb_array_elements(p_players) loop
    v_why := app_private.ineligibility(p_entry, (p->>'player_id')::uuid, v_on);
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
        -- A resubmitted sheet needs confirming again.
        status = 'submitted', confirmed_by = null, confirmed_at = null
  returning id into v_sheet;

  delete from public.match_sheet_players where sheet_id = v_sheet;
  insert into public.match_sheet_players (sheet_id, player_id, number, starting)
  select v_sheet, (p->>'player_id')::uuid, (p->>'number')::integer, coalesce((p->>'starting')::boolean, true)
    from jsonb_array_elements(p_players) p;

  perform app_private.log_sheet(f.competition_id, p_fixture, p_entry, 'sheet_submitted',
    jsonb_build_object('players', v_n, 'side', v_side));
  return v_sheet;
end;
$fn$;

/** The OTHER side confirms this entry's sheet — the signature on paper. */
create or replace function public.confirm_match_sheet(p_fixture uuid, p_entry uuid)
returns void
language plpgsql volatile security definer set search_path = public as $fn$
declare
  f        public.fixtures;
  v_other  uuid;
begin
  select * into f from public.fixtures where id = p_fixture;
  perform app_private.fixture_side(p_fixture, p_entry);
  v_other := case when f.home_entry_id = p_entry then f.away_entry_id else f.home_entry_id end;
  if not (coalesce(app_private.can_manage_entry(v_other), false)
          or coalesce(app_private.is_competition_organiser(f.competition_id), false)) then
    raise exception 'a sheet is confirmed by the other team, or the organiser' using errcode = '42501';
  end if;
  update public.match_sheets
     set status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now()
   where fixture_id = p_fixture and entry_id = p_entry and status = 'submitted';
  if not found then
    raise exception 'there is no submitted sheet to confirm' using errcode = '22023';
  end if;
  perform app_private.log_sheet(f.competition_id, p_fixture, p_entry, 'sheet_confirmed');
end;
$fn$;

create or replace function public.record_match_event(
  p_fixture uuid, p_entry uuid, p_kind public.match_event_kind,
  p_player uuid default null, p_minute integer default null, p_note text default null
)
returns uuid
language plpgsql volatile security definer set search_path = public as $fn$
declare
  f    public.fixtures;
  v_id uuid;
  v_other uuid;
begin
  select * into f from public.fixtures where id = p_fixture;
  perform app_private.fixture_side(p_fixture, p_entry);
  v_other := case when f.home_entry_id = p_entry then f.away_entry_id else f.home_entry_id end;
  -- Either side may record an event — a card against the opposition is
  -- exactly what the other manager will want written down — or the organiser.
  if not (coalesce(app_private.can_manage_entry(p_entry), false)
          or coalesce(app_private.can_manage_entry(v_other), false)
          or coalesce(app_private.is_competition_organiser(f.competition_id), false)) then
    raise exception 'only the teams in this game or the organiser can record events' using errcode = '42501';
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
$fn$;

/**
 * This side's score, as this side saw it. When both sides have entered and
 * agree, the fixture is final; when they disagree, it is disputed and the
 * ladder does not move until the organiser rules.
 */
create or replace function public.enter_sheet_score(p_fixture uuid, p_entry uuid, p_ours integer, p_theirs integer)
returns jsonb
language plpgsql volatile security definer set search_path = public as $fn$
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
$fn$;

/** The organiser rules on a disputed score. */
create or replace function public.rule_on_score(p_fixture uuid, p_home integer, p_away integer, p_note text default null)
returns void
language plpgsql volatile security definer set search_path = public as $fn$
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
         notes = coalesce(nullif(btrim(coalesce(p_note, '')), ''), notes)
   where id = p_fixture;
  update public.match_sheets set status = 'confirmed' where fixture_id = p_fixture and status = 'disputed';
  perform app_private.log_sheet(f.competition_id, p_fixture, null, 'score_ruled',
    jsonb_build_object('home', p_home, 'away', p_away, 'note', p_note));
end;
$fn$;

/** Everything about a game's sheets, for the match page. */
create or replace function public.match_sheet_view(p_fixture uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  f public.fixtures;
begin
  select * into f from public.fixtures where id = p_fixture;
  if f.id is null or not coalesce(app_private.is_competition_participant(f.competition_id), false) then
    raise exception 'not yours to see' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'fixture', jsonb_build_object(
      'id', f.id, 'division', f.division, 'round', f.round, 'starts_at', f.starts_at,
      'status', f.status, 'home_score', f.home_score, 'away_score', f.away_score,
      'score_disputed', f.score_disputed, 'notes', f.notes,
      'home_entry_id', f.home_entry_id, 'away_entry_id', f.away_entry_id,
      'home', (select e.display_name from public.competition_entries e where e.id = f.home_entry_id),
      'away', (select e.display_name from public.competition_entries e where e.id = f.away_entry_id)
    ),
    'can_manage_home', coalesce(app_private.can_manage_entry(f.home_entry_id), false),
    'can_manage_away', coalesce(app_private.can_manage_entry(f.away_entry_id), false),
    'is_organiser', coalesce(app_private.is_competition_organiser(f.competition_id), false),
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
                         'ineligible', app_private.ineligibility(f.home_entry_id, q.player_id, coalesce(f.starts_at::date, current_date)))
                         order by q.number nulls last)
                  from public.entry_squads q where q.entry_id = f.home_entry_id), '[]'::jsonb),
      'away', coalesce((select jsonb_agg(jsonb_build_object('player_id', q.player_id, 'number', q.number,
                         'name', (select pl.full_name from public.players pl where pl.id = q.player_id),
                         'ineligible', app_private.ineligibility(f.away_entry_id, q.player_id, coalesce(f.starts_at::date, current_date)))
                         order by q.number nulls last)
                  from public.entry_squads q where q.entry_id = f.away_entry_id), '[]'::jsonb)
    ),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'entry_id', e.entry_id, 'player_id', e.player_id,
               'name', (select pl.full_name from public.players pl where pl.id = e.player_id),
               'kind', e.kind, 'minute', e.minute, 'note', e.note) order by e.minute nulls last, e.created_at)
        from public.match_events e where e.fixture_id = p_fixture), '[]'::jsonb),
    'log', coalesce((
      select jsonb_agg(jsonb_build_object('action', l.action, 'detail', l.detail, 'at', l.at,
               'by', (select pr.full_name from public.profiles pr where pr.id = l.actor)) order by l.at)
        from public.match_sheet_log l where l.fixture_id = p_fixture), '[]'::jsonb)
  );
end;
$fn$;

revoke execute on function public.seed_entry_squad(uuid) from public, anon;
revoke execute on function public.submit_match_sheet(uuid, uuid, jsonb, uuid, uuid) from public, anon;
revoke execute on function public.confirm_match_sheet(uuid, uuid) from public, anon;
revoke execute on function public.record_match_event(uuid, uuid, public.match_event_kind, uuid, integer, text) from public, anon;
revoke execute on function public.enter_sheet_score(uuid, uuid, integer, integer) from public, anon;
revoke execute on function public.rule_on_score(uuid, integer, integer, text) from public, anon;
revoke execute on function public.match_sheet_view(uuid) from public, anon;
grant execute on function public.seed_entry_squad(uuid) to authenticated;
grant execute on function public.submit_match_sheet(uuid, uuid, jsonb, uuid, uuid) to authenticated;
grant execute on function public.confirm_match_sheet(uuid, uuid) to authenticated;
grant execute on function public.record_match_event(uuid, uuid, public.match_event_kind, uuid, integer, text) to authenticated;
grant execute on function public.enter_sheet_score(uuid, uuid, integer, integer) to authenticated;
grant execute on function public.rule_on_score(uuid, integer, integer, text) to authenticated;
grant execute on function public.match_sheet_view(uuid) to authenticated;
