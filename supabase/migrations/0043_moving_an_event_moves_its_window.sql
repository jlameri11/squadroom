-- 0043_moving_an_event_moves_its_window.sql
--
-- Rescheduling by setting starts_at alone was rejected by
-- events_arrive_before_start, because arrive_at and ends_at stayed where they
-- were. That is the constraint being right and the interface being hostile:
-- "move the game to Sunday" is one intention, not three, and a coach doing it
-- on a phone should not have to restate the arrival time to satisfy a check.
--
-- It caught me twice while writing tests. Anything that traps the person who
-- wrote the schema will certainly trap a coach at 8pm on a Thursday.
--
-- So: when starts_at moves and the other two are not being set in the same
-- statement, they move with it by the same amount.

create or replace function public.shift_event_window()
returns trigger language plpgsql as $$
declare
  v_delta interval;
begin
  if new.starts_at is not distinct from old.starts_at then
    return new;
  end if;

  v_delta := new.starts_at - old.starts_at;

  -- Only shift what the caller has not deliberately changed.
  if new.ends_at is not distinct from old.ends_at and old.ends_at is not null then
    new.ends_at := old.ends_at + v_delta;
  end if;

  if new.arrive_at is not distinct from old.arrive_at and old.arrive_at is not null then
    new.arrive_at := old.arrive_at + v_delta;
  end if;

  return new;
end;
$$;

create trigger events_shift_window
  before update of starts_at on public.events
  for each row execute function public.shift_event_window();
