-- 0119: what a real Dribl export actually says.
--
-- The importer was built and tested against files I made up, and a real
-- export (SPL Season 3 2026, U7 Premier) disagreed with every assumption in
-- two rows:
--
--   DURATION, NOT A FINISH TIME. Dribl gives "30 min". The importer looked
--   for an end time, found none, and gave every game the 90-minute default —
--   so a U7 game that runs half an hour sat in a parent's calendar for an
--   hour and a half, and the game after it looked like a clash.
--
--   HOME AND AWAY, NOT AN OPPONENT. There is no opponent column. There is
--   Home Team and Away Team, and which one is the opposition depends on
--   which side your club is on: in a two-row file our club was the AWAY team
--   in one and the HOME team in the other. The old mapping guessed "Away
--   Team" and would have imported a game against ourselves.
--
-- So the row payload gains `duration_mins` and `was_home`, and
-- `resolve_import_row` prefers a duration over the default. The client works
-- out which side is ours and sends the answer; it is not guessed here,
-- because the club name in the file ("NRFA") is not the academy's name in the
-- app ("NRIFA") and a fuzzy match that got that right would get the next club
-- wrong.
--
-- `was_home` lands in the column 0118 added, so a result reads "2-4 · away"
-- without anybody typing it.

/**
 * How one row of a spreadsheet becomes a fixture.
 *
 * Still the single source of truth for the preview and the write, now with
 * three ways to end a game and a stated order of preference.
 */
create or replace function app_private.resolve_import_row(
  p_team uuid,
  p_item jsonb,
  p_tz   text
)
returns table (ref text, starts_at timestamptz, ends_at timestamptz)
language plpgsql immutable set search_path = public as $fn$
declare
  v_date  date;
  v_start timestamptz;
  v_end   timestamptz;
  v_mins  integer;
begin
  if coalesce(p_item->>'local_date','') = '' or coalesce(p_item->>'local_time','') = '' then
    return query select null::text, null::timestamptz, null::timestamptz;
    return;
  end if;

  v_date  := (p_item->>'local_date')::date;
  v_start := (v_date + (p_item->>'local_time')::time) at time zone p_tz;

  -- An explicit finish time wins: it is the file stating the answer rather
  -- than stating a length to add. Then a duration. Then the default, which
  -- is a guess and is the last resort rather than the first.
  if coalesce(p_item->>'end_time','') <> '' then
    v_end := (v_date + (p_item->>'end_time')::time) at time zone p_tz;
    if v_end < v_start then v_end := v_end + interval '1 day'; end if;
  else
    v_mins := nullif(btrim(coalesce(p_item->>'duration_mins','')), '')::integer;
    -- Bounded here as well as in the client, because this function is also
    -- reachable by anything that calls the RPC directly. Ten minutes is not
    -- a game and five hours is a misread column.
    if v_mins is not null and v_mins between 10 and 300 then
      v_end := v_start + make_interval(mins => v_mins);
    else
      v_end := v_start + interval '90 minutes';
    end if;
  end if;

  return query select
    -- No id column in the file? Fall back to the fixture's own identity: one
    -- team does not play twice at the same moment.
    coalesce(
      nullif(btrim(coalesce(p_item->>'external_ref','')), ''),
      coalesce(p_team::text, 'academy') || ':' || to_char(v_start, 'YYYYMMDDHH24MI')
    ),
    v_start,
    v_end;
end;
$fn$;

/**
 * The writer, now recording which end of the ground we were at.
 *
 * `was_home` comes from the file via the client, which knows which club the
 * coach said was theirs. It is nullable and stays null for a derby, because
 * when both teams are yours the file contains no fact about which one this
 * import is for and inventing one would print a result backwards.
 */
create or replace function public.create_imported_events(
  p_academy        uuid,
  p_team           uuid,
  p_events         jsonb,
  p_cancel_missing boolean default false
)
returns table (created integer, updated integer, skipped integer, cancelled integer)
language plpgsql
volatile
security definer set search_path = public as $fn$
declare
  v_tz       text;
  v_item     jsonb;
  v_r        record;
  v_existing uuid;
  v_refs     text[] := '{}';
  v_min      timestamp;
  v_max      timestamp;
  v_created  integer := 0;
  v_updated  integer := 0;
  v_skipped  integer := 0;
  v_off      integer := 0;
begin
  -- Importing a draw creates events the whole team is notified about, so this
  -- is a coach's action, never a parent's.
  if not (coalesce(app_private.is_academy_staff(p_academy), false)
          or (p_team is not null and coalesce(app_private.is_team_coach(p_team), false))) then
    raise exception 'only a coach can import fixtures' using errcode = '42501';
  end if;

  select timezone into v_tz from public.academies where id = p_academy;

  for v_item in select * from jsonb_array_elements(p_events)
  loop
    select * into v_r from app_private.resolve_import_row(p_team, v_item, v_tz);

    if v_r.ref is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_refs := v_refs || v_r.ref;
    v_min := least(v_min, date_trunc('day', v_r.starts_at at time zone v_tz));
    v_max := greatest(v_max, date_trunc('day', v_r.starts_at at time zone v_tz));

    select id into v_existing
      from public.events
     where academy_id = p_academy and external_ref = v_r.ref;

    if v_existing is not null then
      -- A moved game must move, not appear twice. arrive_at is cleared rather
      -- than left pointing at the old kick-off, which would be worse than
      -- absent: it would tell a family to arrive after the whistle.
      update public.events
         set starts_at  = v_r.starts_at,
             ends_at    = v_r.ends_at,
             arrive_at  = null,
             title      = coalesce(nullif(btrim(v_item->>'title'),''), title),
             venue      = nullif(btrim(coalesce(v_item->>'venue','')), ''),
             opponent   = nullif(btrim(coalesce(v_item->>'opponent','')), ''),
             round      = nullif(btrim(coalesce(v_item->>'round','')), ''),
             -- coalesce, so a re-import of a file WITHOUT the home/away
             -- columns does not erase what an earlier one established.
             was_home   = coalesce((v_item->>'was_home')::boolean, was_home),
             cancelled_at = case when coalesce(v_item->>'cancelled','') in ('true','1','yes')
                                 then coalesce(cancelled_at, now()) end
       where id = v_existing;
      v_updated := v_updated + 1;
    else
      insert into public.events (
        academy_id, team_id, type, title,
        starts_at, ends_at,
        venue, address, opponent, round, was_home,
        source, external_ref, created_by
      ) values (
        p_academy, p_team,
        coalesce(nullif(v_item->>'type',''), 'match')::public.event_type,
        coalesce(nullif(btrim(v_item->>'title'), ''), 'Match'),
        v_r.starts_at, v_r.ends_at,
        nullif(btrim(coalesce(v_item->>'venue','')), ''),
        nullif(btrim(coalesce(v_item->>'address','')), ''),
        nullif(btrim(coalesce(v_item->>'opponent','')), ''),
        nullif(btrim(coalesce(v_item->>'round','')), ''),
        (v_item->>'was_home')::boolean,
        'import', v_r.ref, auth.uid()
      );
      v_created := v_created + 1;
    end if;
  end loop;

  -- Called off, never deleted, and only when asked. The update goes through
  -- the ordinary events table so `events_notify_change` fires and everyone
  -- who can see the game is told — with a reason, because "withdrawn" and
  -- "wet weather" are different things to somebody loading the car.
  if p_cancel_missing and v_min is not null then
    with gone as (
      update public.events e
         set cancelled_at = now(),
             cancellation_reason = 'other',
             cancellation_note = 'No longer in the league draw'
       where e.academy_id = p_academy
         and e.source = 'import'
         and e.cancelled_at is null
         and e.external_ref is not null
         and not (e.external_ref = any (v_refs))
         and (p_team is null or e.team_id = p_team)
         and (e.starts_at at time zone v_tz) >= v_min
         and (e.starts_at at time zone v_tz) < v_max + interval '1 day'
      returning 1
    )
    select count(*)::integer into v_off from gone;
  end if;

  return query select v_created, v_updated, v_skipped, v_off;
end;
$fn$;
