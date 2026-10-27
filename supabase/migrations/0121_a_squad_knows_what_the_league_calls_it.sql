-- 0121: R-08. A squad knows what the league calls it.
--
-- Our U8s are "U8 SPL" in this app and "NRFA U7  navy" in Dribl — two
-- spaces and a different age group, because the league counts differently.
-- Nothing in the product knew those were the same team, and that one missing
-- fact is what made the importer worse than it needed to be:
--
--   ONE TEAM PER IMPORT. `create_imported_events` takes a single p_team for
--   the whole file, so a club exporting its whole draw had to split the
--   spreadsheet by squad or import eight times.
--
--   AND IT HAD TO ASK WHICH CLUB YOU ARE. 0119 added that question because
--   there is no opponent column, only Home Team and Away Team. But if a squad
--   records what the league calls it, the file answers the question itself:
--   a row whose home team is one of ours was played at home. The question
--   stays for the first import, and stops being asked once the names are in.
--
-- Also the rest of R-08: capacity, kit colours, and a flag for the squad a
-- club does not want imported at all. That last one is not tidiness — NRIFA
-- runs a U7 Orange side that exists in the league draw and is not a squad
-- anybody in this app answers for, and importing its games puts fixtures in
-- the calendars of families who have nothing to do with it.

alter table public.teams
  -- What the league calls this squad, exactly as the export writes it. Not
  -- normalised and not trimmed to a tidy form: the match has to be against
  -- the string that actually arrives, and "NRFA U7  navy" has two spaces in
  -- it because somebody typed two spaces.
  add column if not exists external_ref text,
  add column if not exists capacity     integer,
  add column if not exists kit_home     text,
  add column if not exists kit_away     text,
  -- Default FALSE, so a new squad imports. An opt-out that defaults to on is
  -- a squad whose draw silently never appears.
  add column if not exists skip_import  boolean not null default false;

-- One squad per league name per academy. Two squads claiming "NRFA U7 navy"
-- would make routing a coin toss, and the row that lost would quietly get no
-- fixtures.
create unique index if not exists teams_external_ref_unique
  on public.teams (academy_id, external_ref)
  where external_ref is not null;

alter table public.teams
  drop constraint if exists teams_capacity_is_plausible;
alter table public.teams
  add constraint teams_capacity_is_plausible
  check (capacity is null or (capacity > 0 and capacity <= 200));

comment on column public.teams.external_ref is
  'What the league calls this squad, exactly as its export writes it. Used to
   route imported fixtures and to work out which side of a game was ours.';

comment on column public.teams.skip_import is
  'A squad in the league draw that nobody in this app answers for. Its games
   are left out of an import rather than put in families' calendars.';

/**
 * Which of our squads is this league name?
 *
 * Case and whitespace insensitive on purpose. The match has to survive a
 * league secretary adding a trailing space, and nothing downstream cares
 * about the difference — but the STORED value stays exactly as typed, so a
 * club can see what it entered.
 */
create or replace function app_private.team_for_external_ref(
  p_academy uuid,
  p_name    text
)
returns uuid
language sql stable security definer set search_path = public as $fn$
  select t.id
    from public.teams t
   where t.academy_id = p_academy
     and t.external_ref is not null
     and lower(regexp_replace(btrim(t.external_ref), '\s+', ' ', 'g'))
       = lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'))
   limit 1;
$fn$;

/**
 * Everything the import screen needs, and nothing else.
 *
 * It had been resolving the academy server-side as `academies[0]` ordered by
 * name — ignoring the organisation switcher entirely. A coach at two clubs
 * importing a draw would import it into whichever one came first
 * alphabetically, which is the same defect 0105 fixed for the home screen and
 * which nothing had checked here. The org lives in the browser (see 0080), so
 * the fix is for the page to ask, like every other screen.
 */
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
               'skip_import', t.skip_import
             ) order by t.name)
        from public.teams t
       where t.academy_id = v_academy and t.status = 'active'
    ), '[]'::jsonb)
  );
end;
$fn$;

revoke execute on function public.import_screen(uuid) from public, anon;
grant execute on function public.import_screen(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Routing each row to its own squad
-- ---------------------------------------------------------------------------

/**
 * The writer, now able to put each game with the right squad.
 *
 * A row may carry `team_id`. p_team stays as the fallback for a file that is
 * one squad's draw, which is still the common case.
 *
 * EVERY ROW'S TEAM IS CHECKED, not just the fallback. Without that, a coach
 * of the U8s could send a payload naming the U12s and write fixtures into
 * another coach's squad — the authorisation would have been done once, on an
 * argument, while the rows went somewhere else.
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
  v_team     uuid;
  v_staff    boolean;
  v_refs     text[] := '{}';
  v_teams    uuid[] := '{}';
  v_min      timestamp;
  v_max      timestamp;
  v_created  integer := 0;
  v_updated  integer := 0;
  v_skipped  integer := 0;
  v_off      integer := 0;
begin
  v_staff := coalesce(app_private.is_academy_staff(p_academy), false);

  -- Importing a draw creates events the whole team is notified about, so this
  -- is a coach's action, never a parent's.
  if not (v_staff or (p_team is not null and coalesce(app_private.is_team_coach(p_team), false))) then
    raise exception 'only a coach can import fixtures' using errcode = '42501';
  end if;

  select timezone into v_tz from public.academies where id = p_academy;

  for v_item in select * from jsonb_array_elements(p_events)
  loop
    -- The row's own squad, or the one chosen for the whole file.
    v_team := coalesce(nullif(v_item->>'team_id','')::uuid, p_team);

    if v_team is not null then
      -- Same tenant. A composite check rather than trust, because team_id
      -- arrives from a browser.
      if not exists (
        select 1 from public.teams t where t.id = v_team and t.academy_id = p_academy
      ) then
        raise exception 'that squad is not at this academy' using errcode = '42501';
      end if;

      -- Per row, for the reason in the comment above the function.
      if not (v_staff or coalesce(app_private.is_team_coach(v_team), false)) then
        raise exception 'you do not coach one of the squads in this file' using errcode = '42501';
      end if;

      -- A squad the club has asked not to import. Counted as skipped so the
      -- numbers still add up to the rows that were sent.
      if exists (select 1 from public.teams t where t.id = v_team and t.skip_import) then
        v_skipped := v_skipped + 1;
        continue;
      end if;
    end if;

    select * into v_r from app_private.resolve_import_row(v_team, v_item, v_tz);

    if v_r.ref is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_refs := v_refs || v_r.ref;
    if v_team is not null and not (v_team = any (v_teams)) then
      v_teams := v_teams || v_team;
    end if;
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
             team_id    = coalesce(v_team, team_id),
             title      = coalesce(nullif(btrim(v_item->>'title'),''), title),
             venue      = nullif(btrim(coalesce(v_item->>'venue','')), ''),
             opponent   = nullif(btrim(coalesce(v_item->>'opponent','')), ''),
             round      = nullif(btrim(coalesce(v_item->>'round','')), ''),
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
        p_academy, v_team,
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

  -- Called off, never deleted, and only when asked.
  --
  -- Scoped to the squads this file actually mentions, not to p_team. With
  -- per-row routing a club-wide import has no single team, and falling back
  -- to "every squad in the window" would call off the U12s' game because the
  -- U8s' file did not mention it.
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
         and (
           case
             when array_length(v_teams, 1) > 0 then e.team_id = any (v_teams)
             when p_team is not null then e.team_id = p_team
             else true
           end
         )
         and (e.starts_at at time zone v_tz) >= v_min
         and (e.starts_at at time zone v_tz) < v_max + interval '1 day'
      returning 1
    )
    select count(*)::integer into v_off from gone;
  end if;

  return query select v_created, v_updated, v_skipped, v_off;
end;
$fn$;

/**
 * And the preview, matching it row for row.
 *
 * Same routing, same per-row authorisation, same squads-in-this-file scope
 * for what counts as missing. The two have to agree or the preview describes
 * a different import — the whole reason 0117 put the resolution in one
 * helper.
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
  v_team     uuid;
  v_staff    boolean;
  v_rows     jsonb := '[]'::jsonb;
  v_refs     text[] := '{}';
  v_teams    uuid[] := '{}';
  v_min      timestamp;
  v_max      timestamp;
  v_verdict  text;
begin
  v_staff := coalesce(app_private.is_academy_staff(p_academy), false);

  if not (v_staff or (p_team is not null and coalesce(app_private.is_team_coach(p_team), false))) then
    raise exception 'only a coach can import fixtures' using errcode = '42501';
  end if;

  select timezone into v_tz from public.academies where id = p_academy;

  for v_item in select * from jsonb_array_elements(p_events)
  loop
    v_team := coalesce(nullif(v_item->>'team_id','')::uuid, p_team);

    if v_team is not null then
      if not exists (
        select 1 from public.teams t where t.id = v_team and t.academy_id = p_academy
      ) then
        raise exception 'that squad is not at this academy' using errcode = '42501';
      end if;
      if not (v_staff or coalesce(app_private.is_team_coach(v_team), false)) then
        raise exception 'you do not coach one of the squads in this file' using errcode = '42501';
      end if;
      if exists (select 1 from public.teams t where t.id = v_team and t.skip_import) then
        v_rows := v_rows || jsonb_build_object(
          'verdict', 'skipped',
          'title', coalesce(nullif(btrim(v_item->>'title'), ''), 'Match'),
          'reason', 'That squad is set to be left out of imports'
        );
        continue;
      end if;
    end if;

    select * into v_r from app_private.resolve_import_row(v_team, v_item, v_tz);

    if v_r.ref is null then
      v_rows := v_rows || jsonb_build_object(
        'verdict', 'skipped',
        'title', coalesce(nullif(btrim(v_item->>'title'), ''), 'Match'),
        'reason', 'The date or the time could not be read'
      );
      continue;
    end if;

    v_refs := v_refs || v_r.ref;
    if v_team is not null and not (v_team = any (v_teams)) then
      v_teams := v_teams || v_team;
    end if;
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
       or v_existing.round is distinct from nullif(btrim(coalesce(v_item->>'round','')), '')
       or v_existing.team_id is distinct from coalesce(v_team, v_existing.team_id) then
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
      'was_venue', v_existing.venue,
      'team', (select t.name from public.teams t where t.id = v_team)
    );
  end loop;

  return jsonb_build_object(
    'rows', v_rows,
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
         and (
           case
             when array_length(v_teams, 1) > 0 then e.team_id = any (v_teams)
             when p_team is not null then e.team_id = p_team
             else true
           end
         )
         and v_min is not null
         and (e.starts_at at time zone v_tz) >= v_min
         and (e.starts_at at time zone v_tz) < v_max + interval '1 day'
    ), '[]'::jsonb),
    'covers', case when v_min is null then null
                   else jsonb_build_object('from', v_min::date, 'to', v_max::date) end
  );
end;
$fn$;
