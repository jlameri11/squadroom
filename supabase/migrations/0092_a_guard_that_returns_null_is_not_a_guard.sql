-- 0092: `if not is_academy_coach(...)` never fired for an outsider.
--
-- A CROSS-TENANT HOLE, found by test-recurring's last assertion — the one
-- that checks an outsider cannot schedule training in somebody else's
-- academy. Rachel Ng, who is only ever a member of Ravens FC, created a
-- training series inside NRIFA.
--
-- THE CAUSE IS THREE-VALUED LOGIC.
--
--   academy_role_of(p) returns NULL when you are not a member — there is no
--   row, so the scalar is NULL, which is correct.
--
--   is_academy_coach(p) is `academy_role_of(p) in ('owner','admin','coach')`.
--   `NULL in (...)` is NULL, not false. So for a NON-MEMBER the function
--   returns NULL.
--
--   `if not NULL then raise` evaluates to NULL, which is not true, so the
--   branch is skipped and the function carries on as though authorised.
--
-- The guard fired correctly for a PARENT (false → not false → true) and was
-- skipped entirely for a stranger. Exactly backwards, and invisible in any
-- test that only checks the parent case — which is what every test of these
-- functions did.
--
-- WHY RLS DID NOT SAVE US. In a policy, `using (...)` treats NULL as "not
-- permitted", so every policy built on these helpers has always been safe.
-- That is why this survived: the same helper is correct in a policy and
-- broken in an `if`. Only the procedural callers were exposed, and only the
-- two helpers below can return NULL — is_academy_member, is_team_coach,
-- is_channel_member, is_competition_organiser and is_event_coach are all
-- built on `exists`, which is never NULL.
--
-- FIXED AT THE ROOT, not at the call sites. There are five functions using
-- these in an `if not` today — create_academy, the competition invites,
-- create_channel, the program-registration trigger and 0090's series
-- scheduling — and the next person to write a sixth will not know about this
-- comment. coalesce here closes all of them at once, including the ones not
-- yet written.
--
-- What was actually reachable, in order of seriousness: an outsider could
-- create a channel inside another academy (0073), schedule training in it
-- (0090), and invite clubs to a competition on its behalf (0029). None of
-- those read another academy's data — every SELECT is policy-governed — but
-- writing into somebody else's club is bad enough on its own.

create or replace function app_private.is_academy_coach(p_academy uuid)
returns boolean language sql stable security definer set search_path = public as $$
  -- coalesce, because a non-member gets NULL from academy_role_of and
  -- `NULL in (...)` is NULL. A function used as a guard must answer the
  -- question, and "I don't know" is not an answer a guard can act on.
  select coalesce(
    app_private.academy_role_of(p_academy) in ('owner', 'admin', 'coach'),
    false
  );
$$;

create or replace function app_private.is_academy_staff(p_academy uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    app_private.academy_role_of(p_academy) in ('owner', 'admin'),
    false
  );
$$;

-- And the second bug test-recurring found: ending a series that has not
-- started yet clamped ends_on back to today, below starts_on, which violates
-- event_series_dates_ordered. A coach cancelling next season's training before
-- it begins is an ordinary thing to do.
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
  v_start   date;
  v_cut     timestamptz;
  v_touched integer := 0;
  v_kept    integer := 0;
begin
  select es.academy_id, a.timezone, es.starts_on
    into v_academy, v_zone, v_start
    from public.event_series es
    join public.academies a on a.id = es.academy_id
   where es.id = p_series;

  if v_academy is null then
    raise exception 'no such series' using errcode = '22023';
  end if;
  if not app_private.is_academy_coach(v_academy) then
    raise exception 'only a coach can change the schedule' using errcode = '42501';
  end if;

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

  -- Never below starts_on. A series that has not begun is ended by closing it
  -- on its own first day, which reads as "zero sessions" rather than as a
  -- date range that cannot exist.
  update public.event_series
     set ends_on = greatest(v_start, least(ends_on, (v_cut at time zone v_zone)::date)),
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
