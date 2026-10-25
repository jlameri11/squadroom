-- 0091: end_event_series wrote free text into a constrained column.
--
-- 0064 made `cancellation_reason` a fixed set — wet_weather, ground_closed,
-- forfeit, not_enough_players, other — with the human sentence going in
-- `cancellation_note`. The split is deliberate and the comment in 0064 says
-- why: "wet weather is not the same message as a forfeit, and a parent
-- reading it in a car park deserves the difference." A fixed reason is what
-- lets the notification say the right thing; the note is what adds the detail.
--
-- 0090 put the coach's sentence straight into the reason, so every call to
-- end_event_series failed the check constraint. Caught by test-recurring
-- rather than by a family finding out their training was still on.
--
-- Worth noting the pattern: I reached for the column whose NAME matched what I
-- had rather than reading what it holds. The constraint caught it, which is
-- the argument for having put one there.

create or replace function public.end_event_series(
  p_series uuid,
  p_from   date default null,
  p_reason text default null,
  p_delete boolean default false
)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_academy uuid;
  v_zone    text;
  v_cut     timestamptz;
  v_touched integer := 0;
  v_kept    integer := 0;
begin
  select es.academy_id, a.timezone
    into v_academy, v_zone
    from public.event_series es
    join public.academies a on a.id = es.academy_id
   where es.id = p_series;

  if v_academy is null then
    raise exception 'no such series' using errcode = '22023';
  end if;
  if not app_private.is_academy_coach(v_academy) then
    raise exception 'only a coach can change the schedule' using errcode = '42501';
  end if;

  -- Default to now, so "end this series" never reaches into the past. A date
  -- in the past is clamped for the same reason: a coach ending Thursday
  -- training in August must not erase June's attendance.
  v_cut := coalesce((p_from::timestamp at time zone v_zone), now());
  if v_cut < now() then
    v_cut := now();
  end if;

  if p_delete then
    select count(*) into v_kept
      from public.events e
     where e.series_id = p_series and e.starts_at >= v_cut
       and exists (select 1 from public.event_rsvps r where r.event_id = e.id);

    with gone as (
      delete from public.events e
       where e.series_id = p_series
         and e.starts_at >= v_cut
         and not exists (select 1 from public.event_rsvps r where r.event_id = e.id)
      returning 1
    )
    select count(*) into v_touched from gone;
  else
    with called_off as (
      update public.events e
         set cancelled_at = now(),
             -- 'other' from the fixed set, and the coach's sentence in the
             -- note beside it. Ending a series is not wet weather, a forfeit
             -- or a ground closure, and claiming one of those would put the
             -- wrong words in a push notification.
             cancellation_reason = 'other',
             cancellation_note = coalesce(nullif(btrim(p_reason), ''), 'This series has ended.'),
             updated_at = now()
       where e.series_id = p_series
         and e.starts_at >= v_cut
         and e.cancelled_at is null
      returning 1
    )
    select count(*) into v_touched from called_off;
  end if;

  update public.event_series
     set ends_on = least(ends_on, (v_cut at time zone v_zone)::date),
         updated_at = now()
   where id = p_series;

  return jsonb_build_object(
    'affected', v_touched,
    'kept_because_answered', v_kept
  );
end;
$fn$;

revoke execute on function public.end_event_series(uuid, date, text, boolean)
  from public, anon;
grant execute on function public.end_event_series(uuid, date, text, boolean)
  to authenticated;
