-- 0154: a served suspension is served.
--
-- 0153's serve_suspensions set `status = case … then 'served' else
-- 'active' end` — a text expression into an enum column, the same
-- refusal 0141 met on offers. The trigger raised, the score update it
-- rode on was rolled back, and the suite's "served by missing games" step
-- read 0 served. Found by running the trigger by hand on real rows: the
-- error was "column status is of type suspension_status but expression is
-- of type text". Cast, nothing else.

create or replace function public.serve_suspensions()
returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if new.status not in ('final', 'forfeit') or old.status in ('final', 'forfeit') then
    return new;
  end if;
  update public.suspensions s
     set served = s.served + 1,
         status = (case when s.served + 1 >= s.games then 'served' else 'active' end)::public.suspension_status
   where s.status = 'active'
     and s.competition_id = new.competition_id
     and s.entry_id in (new.home_entry_id, new.away_entry_id)
     and coalesce((select f.starts_at from public.fixtures f where f.id = s.from_fixture_id), s.issued_at)
         < coalesce(new.starts_at, now())
     and not exists (
       select 1 from public.match_sheet_players sp
         join public.match_sheets sh on sh.id = sp.sheet_id
        where sh.fixture_id = new.id and sp.player_id = s.player_id
     );
  return new;
end;
$fn$;
