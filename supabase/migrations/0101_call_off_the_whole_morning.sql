-- 0101: X-13. Wet weather does not arrive one fixture at a time.
--
-- Calling a game off has worked per event since 0064, and that is the wrong
-- shape for the thing that actually happens: at 6:40 on a Saturday the ground
-- is closed, and there are nine games and four training sessions on it across
-- six squads. Thirteen separate cancellations, each with its own confirmation,
-- while parents are already in cars.
--
-- So: one call, one reason, every affected session. It goes through
-- `cancelled_at` exactly as a single cancellation does, which means the
-- existing trigger does all the work — the whole-team notification that
-- cannot be muted, the reason travelling with the message, and the SMS
-- escalation inside 24 hours. Nothing new decides who to tell.
--
-- WHAT IT WILL NOT DO. It never touches a session that has already started,
-- and it never touches one already called off. Both are the same principle:
-- this is for the morning ahead, not for rewriting the morning behind. A
-- re-run after somebody adds a late fixture catches only the new one, so
-- pressing it twice does not notify three hundred families twice.
--
-- The venue is matched LOOSELY on purpose. `venue` is free text typed by
-- whoever created the event — "ELS Hall Park", "ELS Hall", "ELS Hall Park,
-- Field 3" — and an organiser calling off ELS Hall means all of them. An
-- exact match would leave half the morning live, which is the failure that
-- gets a family to a closed ground.

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
  -- car park deserves the difference.
  if p_reason not in ('wet_weather', 'ground_closed', 'forfeit', 'not_enough_players', 'other') then
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

revoke execute on function public.call_off_day(uuid, date, text, text, text, uuid)
  from public, anon;
grant execute on function public.call_off_day(uuid, date, text, text, text, uuid)
  to authenticated;

/**
 * What is on, on one day, so a coach can see what they are about to call off.
 *
 * The confirmation screen needs this. "Call off 13 sessions" is a number
 * somebody has to trust; a list of thirteen titles with their venues is a
 * number they can check.
 */
create or replace function public.whats_on(p_academy uuid, p_date date)
returns table (
  event_id   uuid,
  title      text,
  starts_at  timestamptz,
  venue      text,
  team_name  text,
  type       public.event_type,
  cancelled  boolean,
  started    boolean
)
language sql stable security definer set search_path = public as $fn$
  select e.id, e.title, e.starts_at, e.venue, t.name, e.type,
         e.cancelled_at is not null,
         e.starts_at <= now()
    from public.events e
    left join public.teams t on t.id = e.team_id
    join public.academies a on a.id = e.academy_id
   where e.academy_id = p_academy
     and e.starts_at >= (p_date::timestamp at time zone a.timezone)
     and e.starts_at <  ((p_date + 1)::timestamp at time zone a.timezone)
     and (select app_private.is_academy_coach(p_academy))
     -- A private scan belongs to the family who made it and is not the
     -- academy's to call off or to list.
     and e.private_to is null
   order by e.starts_at, e.venue nulls last;
$fn$;

revoke execute on function public.whats_on(uuid, date) from public, anon;
grant execute on function public.whats_on(uuid, date) to authenticated;
