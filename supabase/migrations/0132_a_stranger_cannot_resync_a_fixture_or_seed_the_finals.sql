-- 0132: two write paths were open to anyone with a uuid, and a reason could
--       be null. Found by a sweep that asked the database, not the files:
--
--   select proname from pg_proc
--    where has_function_privilege('anon', oid, 'execute') …
--
-- and then CALLED each one with the anon key and no session. Most returned
-- nothing, because their bodies check auth.uid(). Two ran.
--
-- WHY THEY WERE OPEN. Supabase's default ACL for this project grants EXECUTE
-- on every new function in `public` to anon, authenticated and service_role
-- (pg_default_acl, role postgres). So a function is callable by a stranger
-- unless its migration says otherwise — and CLAUDE.md's "revoke … from
-- public, anon; grant … to authenticated" pattern is what says otherwise.
-- Two internal functions were written before that pattern was a habit.
--
-- 1. mirror_fixture(p_fixture) — security definer, no guard, returns void.
--    It is the trigger helper that copies a competition fixture into each
--    club's `events`. Its upsert sets `cancelled_at = case when f.status in
--    ('cancelled','postponed') then now() end`, so a stranger holding a
--    fixture id could UN-CANCEL a game a club had called off locally, and
--    0064's trigger would then push "back on" to every family in the squad.
--    Nothing in app/ calls it; its two callers are security definer triggers
--    owned by postgres, which also owns the function, so no role needs
--    EXECUTE for them to work.
--
-- 2. resolve_finals(p_competition, p_division) — security definer, writes
--    the finals' home/away entries from the ladder, granted to authenticated
--    in 0051 and never revoked from anon. Any signed-in person — or nobody —
--    could seed a league's finals before the group stage had finished, and
--    `where … entry_id is null` means the first caller's seeding sticks.
--    It now requires the competition's organiser, which is who the run sheet
--    offers the button to.
--
-- 3. call_off_day's `p_reason not in (…)` is the three-valued-logic trap
--    this project has already paid for: `null not in (…)` is null, `if null
--    then raise` does not raise, the column's check constraint permits null,
--    and every family gets a cancellation with no reason — the one thing the
--    notification exists to carry. A client cannot be stopped from sending
--    null, so the function must be.
--
-- 4. For every function from here on: the default is now CLOSED. New
--    functions in `public` grant EXECUTE to nobody until their migration
--    says so, which is the house pattern anyway. A function somebody forgot
--    to grant fails loudly in its own test; a function somebody forgot to
--    revoke fails silently to a stranger, years later. Existing functions
--    are untouched by this — default privileges apply only to objects
--    created afterwards.

-- 1. mirror_fixture: internal.
revoke execute on function public.mirror_fixture(uuid) from public, anon, authenticated;
-- The service role keeps it, for scripts/refresh-demo and the like.
grant execute on function public.mirror_fixture(uuid) to service_role;

-- 2. resolve_finals: the organiser's button, nobody else's.
create or replace function public.resolve_finals(p_competition uuid, p_division text)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  f        record;
  v_filled integer := 0;
begin
  -- coalesce, so that a null from a missing competition is a refusal and
  -- not a pass. `if not null` never raises.
  if not coalesce(app_private.is_competition_organiser(p_competition), false) then
    raise exception 'only the organiser can seed the finals' using errcode = '42501';
  end if;

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

revoke execute on function public.resolve_finals(uuid, text) from public, anon;
grant execute on function public.resolve_finals(uuid, text) to authenticated;

-- 3. call_off_day: a reason is required, and null is not one.
--
-- Rewritten rather than patched, because `create or replace` needs the whole
-- body; the only change is the guard, which now reads
--   if p_reason is null or p_reason not in (…)
-- The rest is 0101 verbatim.
create or replace function public.call_off_day(
  p_academy uuid,
  p_date    date,
  p_reason  text default 'ground_closed',
  p_note    text default null,
  -- Null means everything the academy has on that day, wherever it is.
  p_venue   text default null,
  p_team    uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_zone     text;
  v_from     timestamptz;
  v_to       timestamptz;
  v_affected integer;
  v_titles   text[];
begin
  if not app_private.is_academy_coach(p_academy) then
    raise exception 'only a coach can call off a day' using errcode = '42501';
  end if;

  -- The reason is a fixed set (0064) because the notification says different
  -- words for wet weather than for a forfeit, and a parent reading it in a
  -- car park deserves the difference. NULL is checked by name: `null not in
  -- (…)` is null, and `if null then raise` is silence.
  if p_reason is null
     or p_reason not in ('wet_weather', 'ground_closed', 'forfeit', 'not_enough_players', 'other') then
    raise exception 'that is not a reason this product knows' using errcode = '22023';
  end if;

  select timezone into v_zone from public.academies where id = p_academy;
  if v_zone is null then
    raise exception 'academy not found' using errcode = '22023';
  end if;

  -- The academy's own day, not UTC's. A Saturday in Sydney starts eleven
  -- hours before a Saturday in UTC, and getting this wrong would call off
  -- Friday evening training and leave Saturday afternoon running.
  v_from := (p_date::timestamp at time zone v_zone);
  v_to := ((p_date + 1)::timestamp at time zone v_zone);

  with hit as (
    update public.events e
       set cancelled_at = now(),
           cancellation_reason = p_reason,
           cancellation_note = nullif(btrim(coalesce(p_note, '')), ''),
           updated_at = now()
     where e.academy_id = p_academy
       and e.starts_at >= v_from
       and e.starts_at <  v_to
       -- Not already off, so a second press tells nobody twice.
       and e.cancelled_at is null
       -- Not already under way. This is for the morning ahead.
       and e.starts_at > now()
       and (p_team is null or e.team_id = p_team)
       -- Loose on purpose: see the comment above.
       and (
         p_venue is null
         or e.venue ilike '%' || btrim(p_venue) || '%'
         or btrim(p_venue) ilike '%' || e.venue || '%'
       )
    returning e.title
  )
  select count(*), coalesce(array_agg(title), '{}') into v_affected, v_titles from hit;

  return jsonb_build_object(
    'affected', v_affected,
    -- Named, so the screen can show what it did rather than a number. A coach
    -- pressing this wants to see the list before they believe it.
    'titles', to_jsonb(v_titles)
  );
end;
$fn$;

revoke execute on function public.call_off_day(uuid, date, text, text, text, uuid) from public, anon;
grant execute on function public.call_off_day(uuid, date, text, text, text, uuid) to authenticated;

-- 4. Closed by default from now on.
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;
