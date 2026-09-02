-- 0063_fixture_import.sql
--
-- The Dribl importer. Dribl has no API and no ICS feed, so the supported way
-- out of it is a spreadsheet export — and a coach typing a whole season into
-- two systems is the exact drudgery this product exists to remove.
--
-- CLAUDE.md said the column mapping must be built against a real export file
-- and never guessed. This honours that by not having a fixed mapping at all:
-- the interface reads whatever headers are in the file, SUGGESTS a mapping,
-- and a human confirms it before a single row is created. A suggestion a
-- person approves is not a guess, and it works for a Dribl export, a league
-- secretary's spreadsheet, or a format that changes next season.
--
-- The thing that makes re-importing safe is external_ref. A draw gets
-- re-exported every time a game moves, and an importer without a natural key
-- turns that into a second copy of the season.

alter table public.events add column external_ref text;

comment on column public.events.external_ref is
  'The row id from whatever system this fixture was imported from. Unique per
   academy, so re-importing an updated draw updates rather than duplicates.';

create unique index events_external_ref_key
  on public.events (academy_id, external_ref)
  where external_ref is not null;

-- ---------------------------------------------------------------------------
-- create_imported_events
--
-- Same shape and the same rules as create_scanned_events: the client sends
-- local wall-clock strings exactly as they appear in the spreadsheet, and the
-- timezone maths happens here. A spreadsheet cell is even more dangerous than
-- a screenshot in this respect - Excel will happily hand JavaScript a date
-- that is already been shifted by the reader's own timezone.
--
-- Deliberately NOT merged with create_scanned_events. That function is tested
-- and working, and the two differ in the ways that matter: this one upserts
-- on a natural key and never creates a private event.
-- ---------------------------------------------------------------------------
create or replace function public.create_imported_events(
  p_academy uuid,
  p_team    uuid,
  p_events  jsonb
)
returns table (created integer, updated integer, skipped integer)
language plpgsql
volatile
security definer set search_path = public as $fn$
declare
  v_tz      text;
  v_item    jsonb;
  v_date    date;
  v_start   timestamptz;
  v_end     timestamptz;
  v_ref     text;
  v_existing uuid;
  v_created integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
begin
  -- Importing a draw creates events the whole team is notified about, so this
  -- is a coach's action, never a parent's.
  if not (app_private.is_academy_staff(p_academy)
          or (p_team is not null and app_private.is_team_coach(p_team))) then
    raise exception 'only a coach can import fixtures' using errcode = '42501';
  end if;

  select timezone into v_tz from public.academies where id = p_academy;

  for v_item in select * from jsonb_array_elements(p_events)
  loop
    if coalesce(v_item->>'local_date','') = '' or coalesce(v_item->>'local_time','') = '' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_date  := (v_item->>'local_date')::date;
    v_start := (v_date + (v_item->>'local_time')::time) at time zone v_tz;

    if coalesce(v_item->>'end_time','') <> '' then
      v_end := (v_date + (v_item->>'end_time')::time) at time zone v_tz;
      if v_end < v_start then v_end := v_end + interval '1 day'; end if;
    else
      v_end := v_start + interval '90 minutes';
    end if;

    -- No id column in the file? Fall back to the fixture's own identity: one
    -- team does not play twice at the same moment.
    v_ref := coalesce(
      nullif(btrim(coalesce(v_item->>'external_ref','')), ''),
      coalesce(p_team::text, 'academy') || ':' || to_char(v_start, 'YYYYMMDDHH24MI')
    );

    select id into v_existing
      from public.events
     where academy_id = p_academy and external_ref = v_ref;

    if v_existing is not null then
      -- A moved game must move, not appear twice. arrive_at is cleared rather
      -- than left pointing at the old kick-off, which would be worse than
      -- absent: it would tell a family to arrive after the whistle.
      update public.events
         set starts_at  = v_start,
             ends_at    = v_end,
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
        v_start, v_end,
        nullif(btrim(coalesce(v_item->>'venue','')), ''),
        nullif(btrim(coalesce(v_item->>'address','')), ''),
        nullif(btrim(coalesce(v_item->>'opponent','')), ''),
        nullif(btrim(coalesce(v_item->>'round','')), ''),
        'import', v_ref, auth.uid()
      );
      v_created := v_created + 1;
    end if;
  end loop;

  return query select v_created, v_updated, v_skipped;
end;
$fn$;

revoke execute on function public.create_imported_events(uuid, uuid, jsonb) from public, anon;
grant execute on function public.create_imported_events(uuid, uuid, jsonb) to authenticated;
