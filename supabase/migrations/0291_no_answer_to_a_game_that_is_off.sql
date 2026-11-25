-- 0291 — no answer to a game that is off (the final sweep's edge cases,
-- 25 Nov 2026). The game page hides the Going / Maybe / Out buttons once a
-- game is called off, but the database took the answer anyway — from a page
-- left open, or an answer queued offline before the call-off. The coach's
-- tally for a game that is not happening then moved. A new answer, or a
-- changed one, to a called-off game is refused with a sentence; a game put
-- back on takes answers again, and existing answers are untouched.
create or replace function public.rsvp_refuse_called_off()
returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;
  if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role' then
    return new;
  end if;
  if exists (select 1 from public.events e where e.id = new.event_id and e.cancelled_at is not null) then
    raise exception 'This one has been called off — there is nothing to answer.' using errcode = '22023';
  end if;
  return new;
end;
$fn$;
revoke execute on function public.rsvp_refuse_called_off() from public, anon, authenticated;
drop trigger if exists event_rsvps_refuse_called_off on public.event_rsvps;
create trigger event_rsvps_refuse_called_off before insert or update of status on public.event_rsvps
  for each row execute function public.rsvp_refuse_called_off();
