-- 0156: a wet Saturday, in one tap.
--
-- L-09. X-13 let a club call off its own morning in one tap. A league has
-- the same Saturday across forty squads at six grounds, and until now the
-- organiser's only tools were a score box and a status column. This is
-- the organiser's match-day set: call off a day or a ground, postpone or
-- cancel a game, reschedule it, award a forfeit, give a bye.
--
-- EVERY CHANGE REACHES EVERY AFFECTED CLUB CHAT, and nothing here sends a
-- notification itself. A fixture update is mirrored into each entered
-- club's `events` row (0031), and 0064's trigger on events is what tells
-- the squad: cancelled, changed, back on — with the reason, which is why
-- `cancel_reason` now rides on the fixture and through the mirror. One
-- path for "the game moved", whether the club moved it or the league did.
--
-- A FORFEIT IS SCORED, so the ladder counts it: the division's forfeit
-- score (3–0 by default) to the side that turned up, status 'forfeit',
-- which the ladder already treats as played. A BYE is not a game and the
-- ladder already ignores it.
--
-- All organiser-only. A club postpones nothing in a league; it asks.

alter table public.fixtures
  add column if not exists cancel_reason text
    check (cancel_reason is null or cancel_reason in ('wet_weather', 'ground_closed', 'forfeit', 'not_enough_players', 'other'));

alter table public.competition_divisions
  add column if not exists forfeit_score integer not null default 3 check (forfeit_score between 0 and 10);

-- The mirror carries the reason and the note, so 0064's push can say
-- "wet weather" rather than nothing. 0031's body otherwise.
create or replace function public.mirror_fixture(p_fixture uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  f         public.fixtures%rowtype;
  e         record;
  opponent_name text;
  comp_name text;
begin
  select * into f from public.fixtures where id = p_fixture;
  if f.id is null then return; end if;

  select name into comp_name from public.competitions where id = f.competition_id;

  for e in
    select ce.*, (case when ce.id = f.home_entry_id then f.away_entry_id else f.home_entry_id end) as other_id
      from public.competition_entries ce
     where ce.id in (f.home_entry_id, f.away_entry_id)
       and ce.academy_id is not null
       and ce.team_id is not null
  loop
    select display_name into opponent_name from public.competition_entries where id = e.other_id;

    insert into public.events (
      academy_id, team_id, competition_id, fixture_id, type, title,
      starts_at, ends_at, venue, opponent, round
    )
    values (
      e.academy_id, e.team_id, f.competition_id, f.id, 'match',
      coalesce(comp_name, 'Fixture') || ' — vs ' || coalesce(opponent_name, 'TBC'),
      coalesce(f.starts_at, now()),
      case when f.starts_at is not null and f.duration_mins is not null
           then f.starts_at + (f.duration_mins || ' minutes')::interval end,
      coalesce(f.venue_label, (select name from public.venues where id = f.venue_id)),
      opponent_name, f.round
    )
    on conflict (fixture_id, academy_id) where fixture_id is not null do update
      set starts_at    = excluded.starts_at,
          ends_at      = excluded.ends_at,
          venue        = excluded.venue,
          opponent     = excluded.opponent,
          round        = excluded.round,
          title        = excluded.title,
          -- Keep the original cancellation time on a game that stays off;
          -- clear it when the game is back on.
          cancelled_at = case when f.status in ('cancelled','postponed')
                              then coalesce(public.events.cancelled_at, now()) end,
          cancellation_reason = case when f.status in ('cancelled','postponed') then f.cancel_reason end,
          cancellation_note   = case when f.status in ('cancelled','postponed') then f.notes end;
  end loop;
end;
$$;

/**
 * Call off every game on a day — or at one ground on that day — in the
 * organiser's zone. Postponed (the default: a washout comes back) or
 * cancelled. Says what it did, by name.
 */
create or replace function public.call_off_fixtures(
  p_competition uuid, p_date date, p_reason text,
  p_venue text default null, p_cancel boolean default false, p_note text default null
)
returns jsonb
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_zone  text;
  v_from  timestamptz;
  v_to    timestamptz;
  v_n     integer;
  v_names text[];
begin
  if not coalesce(app_private.is_competition_organiser(p_competition), false) then
    raise exception 'only the organiser can call games off' using errcode = '42501';
  end if;
  if p_reason is null or p_reason not in ('wet_weather', 'ground_closed', 'forfeit', 'not_enough_players', 'other') then
    raise exception 'that is not a reason this product knows' using errcode = '22023';
  end if;
  select coalesce(a.timezone, 'Australia/Sydney') into v_zone
    from public.competitions c join public.academies a on a.id = c.organiser_id
   where c.id = p_competition;
  v_from := (p_date::timestamp at time zone v_zone);
  v_to   := ((p_date + 1)::timestamp at time zone v_zone);

  with hit as (
    update public.fixtures f
       set status = case when p_cancel then 'cancelled' else 'postponed' end::public.fixture_status,
           cancel_reason = p_reason,
           notes = coalesce(nullif(btrim(coalesce(p_note, '')), ''), f.notes),
           updated_at = now()
     where f.competition_id = p_competition
       and f.starts_at >= v_from and f.starts_at < v_to
       and f.status in ('scheduled', 'in_progress')
       and (p_venue is null
            or coalesce(f.venue_label, (select v.name from public.venues v where v.id = f.venue_id), '') ilike '%' || btrim(p_venue) || '%')
    returning coalesce((select h.display_name from public.competition_entries h where h.id = f.home_entry_id), '?')
              || ' v ' || coalesce((select a.display_name from public.competition_entries a where a.id = f.away_entry_id), '?') as game
  )
  select count(*), coalesce(array_agg(game), '{}') into v_n, v_names from hit;

  return jsonb_build_object('affected', v_n, 'games', to_jsonb(v_names),
                            'status', case when p_cancel then 'cancelled' else 'postponed' end);
end;
$fn$;

/** One game: postpone or cancel, with the reason. */
create or replace function public.postpone_fixture(p_fixture uuid, p_reason text, p_cancel boolean default false, p_note text default null)
returns void
language plpgsql volatile security definer set search_path = public as $fn$
declare
  f public.fixtures;
begin
  select * into f from public.fixtures where id = p_fixture;
  if f.id is null or not coalesce(app_private.is_competition_organiser(f.competition_id), false) then
    raise exception 'only the organiser can postpone a game' using errcode = '42501';
  end if;
  if p_reason is null or p_reason not in ('wet_weather', 'ground_closed', 'forfeit', 'not_enough_players', 'other') then
    raise exception 'that is not a reason this product knows' using errcode = '22023';
  end if;
  if f.status in ('final', 'forfeit') then
    raise exception 'this game has been played' using errcode = '22023';
  end if;
  update public.fixtures
     set status = case when p_cancel then 'cancelled' else 'postponed' end::public.fixture_status,
         cancel_reason = p_reason,
         notes = coalesce(nullif(btrim(coalesce(p_note, '')), ''), notes),
         updated_at = now()
   where id = p_fixture;
end;
$fn$;

/** Back on the calendar, at a new time and (optionally) a new ground. */
create or replace function public.reschedule_fixture(p_fixture uuid, p_starts_at timestamptz, p_venue_label text default null, p_field text default null)
returns void
language plpgsql volatile security definer set search_path = public as $fn$
declare
  f public.fixtures;
begin
  select * into f from public.fixtures where id = p_fixture;
  if f.id is null or not coalesce(app_private.is_competition_organiser(f.competition_id), false) then
    raise exception 'only the organiser can reschedule a game' using errcode = '42501';
  end if;
  if f.status in ('final', 'forfeit') then
    raise exception 'this game has been played' using errcode = '22023';
  end if;
  if p_starts_at is null then
    raise exception 'a rescheduled game needs a time' using errcode = '22023';
  end if;
  update public.fixtures
     set status = 'scheduled', cancel_reason = null,
         starts_at = p_starts_at,
         venue_label = coalesce(nullif(btrim(coalesce(p_venue_label, '')), ''), venue_label),
         field_label = coalesce(nullif(btrim(coalesce(p_field, '')), ''), field_label),
         updated_at = now()
   where id = p_fixture;
end;
$fn$;

/** A forfeit: the division's forfeit score to the side that turned up. */
create or replace function public.forfeit_fixture(p_fixture uuid, p_forfeiting_entry uuid, p_note text default null)
returns void
language plpgsql volatile security definer set search_path = public as $fn$
declare
  f      public.fixtures;
  v_goal integer;
begin
  select * into f from public.fixtures where id = p_fixture;
  if f.id is null or not coalesce(app_private.is_competition_organiser(f.competition_id), false) then
    raise exception 'only the organiser can award a forfeit' using errcode = '42501';
  end if;
  if p_forfeiting_entry not in (f.home_entry_id, f.away_entry_id) then
    raise exception 'that team is not in this game' using errcode = '22023';
  end if;
  select coalesce(d.forfeit_score, 3) into v_goal
    from (select 1) one
    left join public.competition_divisions d on d.competition_id = f.competition_id and d.division = f.division;
  update public.fixtures
     set status = 'forfeit',
         home_score = case when p_forfeiting_entry = f.home_entry_id then 0 else v_goal end,
         away_score = case when p_forfeiting_entry = f.away_entry_id then 0 else v_goal end,
         cancel_reason = 'forfeit',
         score_disputed = false,
         score_entered_by = auth.uid(), score_entered_at = now(),
         notes = coalesce(nullif(btrim(coalesce(p_note, '')), ''), notes),
         updated_at = now()
   where id = p_fixture;
end;
$fn$;

/** A bye: not a game. The ladder ignores it. */
create or replace function public.set_bye(p_fixture uuid)
returns void
language plpgsql volatile security definer set search_path = public as $fn$
declare
  f public.fixtures;
begin
  select * into f from public.fixtures where id = p_fixture;
  if f.id is null or not coalesce(app_private.is_competition_organiser(f.competition_id), false) then
    raise exception 'only the organiser can give a bye' using errcode = '42501';
  end if;
  update public.fixtures
     set status = 'bye', home_score = null, away_score = null, cancel_reason = null, updated_at = now()
   where id = p_fixture;
end;
$fn$;

revoke execute on function public.call_off_fixtures(uuid, date, text, text, boolean, text) from public, anon;
revoke execute on function public.postpone_fixture(uuid, text, boolean, text) from public, anon;
revoke execute on function public.reschedule_fixture(uuid, timestamptz, text, text) from public, anon;
revoke execute on function public.forfeit_fixture(uuid, uuid, text) from public, anon;
revoke execute on function public.set_bye(uuid) from public, anon;
grant execute on function public.call_off_fixtures(uuid, date, text, text, boolean, text) to authenticated;
grant execute on function public.postpone_fixture(uuid, text, boolean, text) to authenticated;
grant execute on function public.reschedule_fixture(uuid, timestamptz, text, text) to authenticated;
grant execute on function public.forfeit_fixture(uuid, uuid, text) to authenticated;
grant execute on function public.set_bye(uuid) to authenticated;

-- The run sheet carries the entry ids, so a per-game control can name who
-- forfeited. A `returns table` cannot be widened with `create or replace`;
-- dropped and recreated with the two columns on the end, so every existing
-- reader by name is unaffected.
drop function if exists public.competition_run_sheet(uuid, text);
create function public.competition_run_sheet(p_competition uuid, p_division text default null)
returns table (
  fixture_id  uuid,
  starts_at   timestamptz,
  field_label text,
  division    text,
  group_label text,
  round       text,
  home_name   text,
  away_name   text,
  home_score  integer,
  away_score  integer,
  status      public.fixture_status,
  can_score   boolean,
  home_entry_id uuid,
  away_entry_id uuid
)
language sql stable security definer set search_path = public as $$
  select
    f.id, f.starts_at, f.field_label, f.division, f.group_label, f.round,
    h.display_name, a.display_name,
    f.home_score, f.away_score, f.status,
    (app_private.is_competition_organiser(f.competition_id)
      or app_private.can_manage_entry(f.home_entry_id)
      or app_private.can_manage_entry(f.away_entry_id)),
    f.home_entry_id, f.away_entry_id
  from public.fixtures f
  left join public.competition_entries h on h.id = f.home_entry_id
  left join public.competition_entries a on a.id = f.away_entry_id
  where f.competition_id = p_competition
    and (p_division is null or f.division = p_division)
    and app_private.is_competition_participant(f.competition_id)
  order by f.starts_at, f.field_label;
$$;
revoke execute on function public.competition_run_sheet(uuid, text) from public, anon;
grant execute on function public.competition_run_sheet(uuid, text) to authenticated;
