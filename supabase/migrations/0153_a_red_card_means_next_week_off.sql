-- 0153: a red card means next week off.
--
-- L-08. Cards were recorded on the sheet (0151) and nothing happened to
-- them. In a league, cards accumulate into suspensions by rules the league
-- sets, a red is a suspension on the spot, and a suspended child must not
-- be on next week's sheet — a suspension nothing enforces is a note in a
-- minute book, and the dispute it produces on the Monday is worse than
-- the one it was meant to replace.
--
-- RULES PER COMPETITION, because every league's are different and change
-- between seasons: how many yellows earn a suspension, how many games that
-- is, how many games a red is. Defaults are the common ones (5 yellows → 1
-- game; red → 1 game).
--
-- AUTOMATIC FROM THE SHEET. A red card recorded on a sheet creates the
-- suspension; the fifth (tenth, …) yellow does too. The organiser can add
-- one by hand (a tribunal), overturn one (an appeal upheld), and the club
-- can note an appeal. Nothing is deleted.
--
-- SERVED BY MISSING GAMES. A suspension is served one game at a time as the
-- player's team plays fixtures after the one it came from, counted when
-- those fixtures go final with the player not on the sheet — which is the
-- only honest definition, and the one that makes "blocked from the sheet"
-- and "served" the same fact seen from two sides.
--
-- BLOCKED FROM THE SHEET through the hook 0151 left: suspension_reason now
-- answers, so submit_match_sheet refuses the sheet naming the child and
-- what is left to serve, and the match page greys them out with the
-- reason before anyone tries.

create table if not exists public.competition_discipline_rules (
  competition_id uuid primary key references public.competitions(id) on delete cascade,
  yellows_per_suspension integer not null default 5 check (yellows_per_suspension between 2 and 20),
  games_per_yellow_suspension integer not null default 1 check (games_per_yellow_suspension between 1 and 10),
  games_per_red integer not null default 1 check (games_per_red between 1 and 20),
  updated_at timestamptz not null default now()
);
alter table public.competition_discipline_rules enable row level security;
create policy discipline_rules_select on public.competition_discipline_rules for select to authenticated
  using ((select app_private.is_competition_participant(competition_discipline_rules.competition_id)));
create policy discipline_rules_insert on public.competition_discipline_rules for insert to authenticated
  with check ((select app_private.is_competition_organiser(competition_discipline_rules.competition_id)));
create policy discipline_rules_update on public.competition_discipline_rules for update to authenticated
  using ((select app_private.is_competition_organiser(competition_discipline_rules.competition_id)));

do $$ begin
  create type public.suspension_status as enum ('active', 'served', 'overturned');
exception when duplicate_object then null; end $$;

create table if not exists public.suspensions (
  id              uuid primary key default gen_random_uuid(),
  competition_id  uuid not null references public.competitions(id) on delete cascade,
  player_id       uuid not null,
  academy_id      uuid not null references public.academies(id) on delete cascade,
  entry_id        uuid references public.competition_entries(id) on delete set null,
  reason          text not null,
  games           integer not null check (games between 1 and 50),
  served          integer not null default 0 check (served >= 0),
  status          public.suspension_status not null default 'active',
  from_fixture_id uuid references public.fixtures(id) on delete set null,
  from_event_id   uuid references public.match_events(id) on delete set null,
  issued_by       uuid references public.profiles(id) on delete set null,
  issued_at       timestamptz not null default now(),
  note            text,
  appeal_note     text,
  appealed_at     timestamptz,
  decided_by      uuid references public.profiles(id) on delete set null,
  decided_at      timestamptz,
  constraint suspensions_player_fkey foreign key (player_id, academy_id)
    references public.players (id, academy_id) on delete cascade
);
alter table public.suspensions enable row level security;
create policy suspensions_select on public.suspensions for select to authenticated
  using ((select app_private.is_competition_participant(suspensions.competition_id)));
create index if not exists suspensions_player_idx on public.suspensions (competition_id, player_id, status);

create or replace function app_private.discipline_rules(p_competition uuid)
returns table (yellows_per_suspension integer, games_per_yellow_suspension integer, games_per_red integer)
language sql stable as $fn$
  select coalesce(r.yellows_per_suspension, 5), coalesce(r.games_per_yellow_suspension, 1), coalesce(r.games_per_red, 1)
    from (select 1) one
    left join public.competition_discipline_rules r on r.competition_id = p_competition;
$fn$;

-- The hook 0151 left, now answering.
create or replace function app_private.suspension_reason(p_competition uuid, p_player uuid, p_on date)
returns text
language sql stable security definer set search_path = public as $fn$
  select pl.full_name || ' is suspended — ' || s.reason || ', ' ||
         (s.games - s.served) || case when s.games - s.served = 1 then ' game' else ' games' end || ' still to serve'
    from public.suspensions s
    join public.players pl on pl.id = s.player_id
   where s.competition_id = p_competition and s.player_id = p_player
     and s.status = 'active' and s.served < s.games
   order by s.issued_at
   limit 1;
$fn$;

/** A card on a sheet becomes a suspension by the competition's rules. */
create or replace function public.suspend_on_card()
returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  r        record;
  v_acad   uuid;
  v_yellows integer;
begin
  if new.player_id is null or new.kind not in ('red', 'yellow') then
    return new;
  end if;
  select * into r from app_private.discipline_rules(new.competition_id);
  select academy_id into v_acad from public.players where id = new.player_id;

  if new.kind = 'red' then
    insert into public.suspensions (competition_id, player_id, academy_id, entry_id, reason, games, from_fixture_id, from_event_id)
    values (new.competition_id, new.player_id, v_acad, new.entry_id, 'red card', r.games_per_red, new.fixture_id, new.id);
    return new;
  end if;

  select count(*) into v_yellows
    from public.match_events e
   where e.competition_id = new.competition_id and e.player_id = new.player_id and e.kind = 'yellow';
  if v_yellows > 0 and v_yellows % r.yellows_per_suspension = 0 then
    insert into public.suspensions (competition_id, player_id, academy_id, entry_id, reason, games, from_fixture_id, from_event_id)
    values (new.competition_id, new.player_id, v_acad, new.entry_id,
            v_yellows || ' yellow cards', r.games_per_yellow_suspension, new.fixture_id, new.id);
  end if;
  return new;
end;
$fn$;

drop trigger if exists match_events_suspend on public.match_events;
create trigger match_events_suspend
  after insert on public.match_events
  for each row execute function public.suspend_on_card();

/**
 * A suspension is served as the player's team plays on without them.
 * When a fixture goes final, every active suspension of a player of either
 * side who was NOT on that side's sheet serves one game — provided the
 * fixture is after the one the suspension came from.
 */
create or replace function public.serve_suspensions()
returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  v_from_at timestamptz;
begin
  if new.status not in ('final', 'forfeit') or old.status in ('final', 'forfeit') then
    return new;
  end if;
  update public.suspensions s
     set served = s.served + 1,
         status = case when s.served + 1 >= s.games then 'served' else 'active' end
   where s.status = 'active'
     and s.competition_id = new.competition_id
     and s.entry_id in (new.home_entry_id, new.away_entry_id)
     and coalesce((select f.starts_at from public.fixtures f where f.id = s.from_fixture_id), s.issued_at)
         < coalesce(new.starts_at, now())
     and not exists (
       select 1 from public.match_sheet_players sp
         join public.match_sheets sh on sh.id = sp.sheet_id
        where sh.fixture_id = new.id and sp.player_id = s.player_id
     );
  return new;
end;
$fn$;

drop trigger if exists fixtures_serve_suspensions on public.fixtures;
create trigger fixtures_serve_suspensions
  after update of status on public.fixtures
  for each row execute function public.serve_suspensions();

/** The organiser's own suspension — a tribunal decision. */
create or replace function public.add_suspension(p_competition uuid, p_player uuid, p_games integer, p_reason text, p_note text default null)
returns uuid
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_id uuid;
  v_acad uuid;
  v_entry uuid;
begin
  if not coalesce(app_private.is_competition_organiser(p_competition), false) then
    raise exception 'only the organiser can suspend a player' using errcode = '42501';
  end if;
  select academy_id into v_acad from public.players where id = p_player;
  if v_acad is null then raise exception 'no such player' using errcode = '22023'; end if;
  select q.entry_id into v_entry from public.entry_squads q join public.competition_entries e on e.id = q.entry_id
   where q.player_id = p_player and e.competition_id = p_competition limit 1;
  insert into public.suspensions (competition_id, player_id, academy_id, entry_id, reason, games, issued_by, note)
  values (p_competition, p_player, v_acad, v_entry, coalesce(nullif(btrim(p_reason), ''), 'tribunal'), p_games, auth.uid(), p_note)
  returning id into v_id;
  return v_id;
end;
$fn$;

create or replace function public.overturn_suspension(p_suspension uuid, p_note text)
returns void
language plpgsql volatile security definer set search_path = public as $fn$
declare
  s public.suspensions;
begin
  select * into s from public.suspensions where id = p_suspension;
  if s.id is null or not coalesce(app_private.is_competition_organiser(s.competition_id), false) then
    raise exception 'only the organiser can overturn a suspension' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception 'say why — an overturned suspension with no reason is one nobody can defend later' using errcode = '22023';
  end if;
  update public.suspensions
     set status = 'overturned', decided_by = auth.uid(), decided_at = now(), note = btrim(p_note)
   where id = p_suspension;
end;
$fn$;

create or replace function public.note_appeal(p_suspension uuid, p_note text)
returns void
language plpgsql volatile security definer set search_path = public as $fn$
declare
  s public.suspensions;
begin
  select * into s from public.suspensions where id = p_suspension;
  if s.id is null or not (coalesce(app_private.is_academy_staff(s.academy_id), false)
                          or (s.entry_id is not null and coalesce(app_private.can_manage_entry(s.entry_id), false))
                          or coalesce(app_private.is_competition_organiser(s.competition_id), false)) then
    raise exception 'only the player''s club or the organiser can note an appeal' using errcode = '42501';
  end if;
  update public.suspensions set appeal_note = nullif(btrim(coalesce(p_note, '')), ''), appealed_at = now()
   where id = p_suspension;
end;
$fn$;

/** The discipline report: every carded player, their cards and suspensions. */
create or replace function public.discipline_report(p_competition uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
begin
  if not coalesce(app_private.is_competition_participant(p_competition), false) then
    raise exception 'not yours to see' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'rules', (select to_jsonb(r) from app_private.discipline_rules(p_competition) r),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
               'player_id', x.player_id,
               'name',      (select pl.full_name from public.players pl where pl.id = x.player_id),
               'club',      (select a.name from public.players pl join public.academies a on a.id = pl.academy_id where pl.id = x.player_id),
               'entry',     (select e.display_name from public.competition_entries e where e.id = x.entry_id),
               'yellows',   x.yellows, 'reds', x.reds, 'blues', x.blues,
               'suspensions', coalesce((
                 select jsonb_agg(jsonb_build_object('id', s.id, 'reason', s.reason, 'games', s.games, 'served', s.served,
                          'status', s.status, 'issued_at', s.issued_at, 'note', s.note, 'appeal_note', s.appeal_note)
                          order by s.issued_at desc)
                   from public.suspensions s where s.competition_id = p_competition and s.player_id = x.player_id), '[]'::jsonb)
             ) order by x.reds desc, x.yellows desc, x.player_id)
        from (
          select e.player_id, min(e.entry_id) as entry_id,
                 count(*) filter (where e.kind = 'yellow')::integer as yellows,
                 count(*) filter (where e.kind = 'red')::integer as reds,
                 count(*) filter (where e.kind = 'blue')::integer as blues
            from public.match_events e
           where e.competition_id = p_competition and e.player_id is not null and e.kind in ('yellow', 'red', 'blue')
           group by e.player_id
          union
          select s.player_id, min(s.entry_id), 0, 0, 0
            from public.suspensions s
           where s.competition_id = p_competition
             and not exists (select 1 from public.match_events e where e.competition_id = p_competition and e.player_id = s.player_id and e.kind in ('yellow','red','blue'))
           group by s.player_id
        ) x
    ), '[]'::jsonb)
  );
end;
$fn$;

revoke execute on function public.add_suspension(uuid, uuid, integer, text, text) from public, anon;
revoke execute on function public.overturn_suspension(uuid, text) from public, anon;
revoke execute on function public.note_appeal(uuid, text) from public, anon;
revoke execute on function public.discipline_report(uuid) from public, anon;
grant execute on function public.add_suspension(uuid, uuid, integer, text, text) to authenticated;
grant execute on function public.overturn_suspension(uuid, text) to authenticated;
grant execute on function public.note_appeal(uuid, text) to authenticated;
grant execute on function public.discipline_report(uuid) to authenticated;
