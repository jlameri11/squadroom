-- 0117: F-03. Say what the import is about to do, before it does it.
--
-- `create_imported_events` reports "12 added, 3 updated" AFTERWARDS, which is
-- the wrong end of the decision. A coach dropping Friday's export in has no
-- way to see that it moved Saturday's U10 game from 9am to 11am until forty
-- families have already been notified — and no way at all to see that a
-- fixture they imported last week is missing from this file.
--
-- THE PREVIEW AND THE WRITE MUST NOT BE ABLE TO DISAGREE. A preview computed
-- by a second copy of the resolution logic is a preview of a different
-- import: the external_ref fallback and the local-time conversion are where
-- every subtle bug in this feature has lived, and two copies of them is two
-- places for the next one. So the resolution moves into one helper and both
-- functions call it. That is the point of this migration; the reporting is
-- the easy half.
--
-- WHAT "MISSING" MEANS, and why it is narrow. A fixture is reported missing
-- only when it is in the same academy, for the same team, came from an
-- IMPORT, and falls on one of the DAYS the file itself covers. A coach who
-- exports one team must never be told the other squads' games have vanished,
-- and a file covering one weekend must not accuse the rest of the season.
--
-- DAYS, not the span between the first and last kick-off, which is what this
-- was first written as and is wrong in a way its own test caught: a file
-- whose remaining Saturday games run 9am to 11am would have had a window of
-- 9am-11am, so an 8am game dropped from the draw fell outside it and was
-- never reported. The window is the whole of every local day the file
-- mentions — and nothing beyond, because a fixture on a day the file says
-- nothing about cannot be called withdrawn on its evidence.
--
-- AND MISSING IS NOT DELETED. An event a family has answered is not a row to
-- remove — it is a Saturday somebody has planned around. The caller may ask
-- for missing fixtures to be CALLED OFF, which runs them through the ordinary
-- cancellation path so everyone who can see the game is told, with a reason.
-- Deleting would be silent, and silence is how a family ends up at a ground
-- for a game that is not happening.

/**
 * How one row of a spreadsheet becomes a fixture.
 *
 * The single source of truth for the two things that are easy to get wrong:
 *
 *  - the local date and time are combined and THEN given the academy's
 *    timezone. Never `toISOString()`; a local midnight in Sydney is the
 *    previous day in UTC, which moves every Saturday game to Friday.
 *  - a finish time earlier than the kick-off has crossed midnight.
 *
 * Returns nulls rather than raising for an unreadable row, because the caller
 * counts those as skipped and the preview has to be able to show them.
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
begin
  if coalesce(p_item->>'local_date','') = '' or coalesce(p_item->>'local_time','') = '' then
    return query select null::text, null::timestamptz, null::timestamptz;
    return;
  end if;

  v_date  := (p_item->>'local_date')::date;
  v_start := (v_date + (p_item->>'local_time')::time) at time zone p_tz;

  if coalesce(p_item->>'end_time','') <> '' then
    v_end := (v_date + (p_item->>'end_time')::time) at time zone p_tz;
    if v_end < v_start then v_end := v_end + interval '1 day'; end if;
  else
    v_end := v_start + interval '90 minutes';
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
 * What this file would do. Changes nothing.
 *
 * Deliberately a separate call rather than a flag on the writer. A function
 * that sometimes writes and sometimes does not is one somebody calls with the
 * flag defaulted wrong, and the failure mode is forty families notified about
 * a draw nobody confirmed.
 */
create or replace function public.preview_imported_events(
  p_academy uuid,
  p_team    uuid,
  p_events  jsonb
)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_tz       text;
  v_item     jsonb;
  v_r        record;
  v_existing public.events;
  v_rows     jsonb := '[]'::jsonb;
  v_refs     text[] := '{}';
  -- Local days, not instants: `timestamp` without a zone, because they are
  -- compared back against `starts_at at time zone v_tz`.
  v_min      timestamp;
  v_max      timestamp;
  v_verdict  text;
begin
  -- Same gate as the writer. A preview of somebody else's draw would leak
  -- their fixtures through a function that claims to change nothing.
  if not (coalesce(app_private.is_academy_staff(p_academy), false)
          or (p_team is not null and coalesce(app_private.is_team_coach(p_team), false))) then
    raise exception 'only a coach can import fixtures' using errcode = '42501';
  end if;

  select timezone into v_tz from public.academies where id = p_academy;

  for v_item in select * from jsonb_array_elements(p_events)
  loop
    select * into v_r from app_private.resolve_import_row(p_team, v_item, v_tz);

    if v_r.ref is null then
      v_rows := v_rows || jsonb_build_object(
        'verdict', 'skipped',
        'title', coalesce(nullif(btrim(v_item->>'title'), ''), 'Match'),
        'reason', 'The date or the time could not be read'
      );
      continue;
    end if;

    v_refs := v_refs || v_r.ref;
    v_min := least(v_min, date_trunc('day', v_r.starts_at at time zone v_tz));
    v_max := greatest(v_max, date_trunc('day', v_r.starts_at at time zone v_tz));

    select * into v_existing
      from public.events
     where academy_id = p_academy and external_ref = v_r.ref;

    if v_existing.id is null then
      v_verdict := 'new';
    elsif v_existing.starts_at <> v_r.starts_at then
      v_verdict := 'moved';
    elsif v_existing.venue is distinct from nullif(btrim(coalesce(v_item->>'venue','')), '')
       or v_existing.opponent is distinct from nullif(btrim(coalesce(v_item->>'opponent','')), '')
       or v_existing.round is distinct from nullif(btrim(coalesce(v_item->>'round','')), '') then
      -- A venue change is not a time change, and a coach reading "3 moved"
      -- will check the times. Named separately so they check the right thing.
      v_verdict := 'changed';
    else
      v_verdict := 'unchanged';
    end if;

    v_rows := v_rows || jsonb_build_object(
      'verdict', v_verdict,
      'event_id', v_existing.id,
      'title', coalesce(nullif(btrim(v_item->>'title'), ''), v_existing.title, 'Match'),
      'round', nullif(btrim(coalesce(v_item->>'round','')), ''),
      'venue', nullif(btrim(coalesce(v_item->>'venue','')), ''),
      'was_at', v_existing.starts_at,
      'now_at', v_r.starts_at,
      'was_venue', v_existing.venue
    );
  end loop;

  return jsonb_build_object(
    'rows', v_rows,
    -- Fixtures this academy imported for this team, inside the window the
    -- file covers, that the file does not mention. Narrow on purpose: see
    -- the note at the top.
    'missing', coalesce((
      select jsonb_agg(jsonb_build_object(
               'event_id', e.id,
               'title', e.title,
               'starts_at', e.starts_at,
               'venue', e.venue,
               'answered', (select count(*) from public.event_rsvps r where r.event_id = e.id)
             ) order by e.starts_at)
        from public.events e
       where e.academy_id = p_academy
         and e.source = 'import'
         and e.cancelled_at is null
         and e.external_ref is not null
         and not (e.external_ref = any (v_refs))
         and (p_team is null or e.team_id = p_team)
         and v_min is not null
         and (e.starts_at at time zone v_tz) >= v_min
         and (e.starts_at at time zone v_tz) < v_max + interval '1 day'
    ), '[]'::jsonb),
    'covers', case when v_min is null then null
                   else jsonb_build_object('from', v_min::date, 'to', v_max::date) end
  );
end;
$fn$;

revoke execute on function public.preview_imported_events(uuid, uuid, jsonb) from public, anon;
grant execute on function public.preview_imported_events(uuid, uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- The writer, now sharing the resolution and able to call off what is gone
-- ---------------------------------------------------------------------------

-- Adding a column to the return type means a DROP: `create or replace` cannot
-- change a function's signature. Dropping the old 3-argument form too, rather
-- than leaving it beside a 4-argument one with a default — two overloads is
-- an ambiguous call waiting to happen, and the one that would win is the one
-- that notifies nobody about a cancelled game.
drop function if exists public.create_imported_events(uuid, uuid, jsonb);

create function public.create_imported_events(
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
             cancelled_at = case when coalesce(v_item->>'cancelled','') in ('true','1','yes')
                                 then coalesce(cancelled_at, now()) end
       where id = v_existing;
      v_updated := v_updated + 1;
    else
      insert into public.events (
        academy_id, team_id, type, title,
        starts_at, ends_at,
        venue, address, opponent, round,
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
             -- `cancellation_reason` is a fixed vocabulary, not free text:
             -- wet weather is not the same message as a forfeit. A fixture
             -- pulled from the draw is none of the named ones, so it is
             -- 'other' and the explanation goes in the note, which is where
             -- the notification reads it from.
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

revoke execute on function public.create_imported_events(uuid, uuid, jsonb, boolean)
  from public, anon;
grant execute on function public.create_imported_events(uuid, uuid, jsonb, boolean)
  to authenticated;
