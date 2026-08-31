-- 0031_mirror_fixtures_on_entry_claim.sql
--
-- A club claims its invite and sees the draw - but its parents' calendars
-- stay empty.
--
-- The mirror fires on changes to a FIXTURE. Claiming an invite changes an
-- ENTRY. Every game the organiser scheduled before that club signed up -
-- which, for a season built in advance, is all of them - never reached the
-- club's own calendar, so no RSVPs, no reminders, no channel cards.
--
-- The mirroring logic moves into a function both triggers call, rather than
-- living inside one trigger and being unreachable from the other.

create or replace function public.mirror_fixture(p_fixture uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  f         public.fixtures%rowtype;
  e         record;
  opponent_name text;
  comp_name text;
begin
  select * into f from public.fixtures where id = p_fixture;
  if f.id is null then return; end if;

  select name into comp_name from public.competitions where id = f.competition_id;

  for e in
    select ce.*, (case when ce.id = f.home_entry_id then f.away_entry_id else f.home_entry_id end) as other_id
      from public.competition_entries ce
     where ce.id in (f.home_entry_id, f.away_entry_id)
       and ce.academy_id is not null
       and ce.team_id is not null
  loop
    select display_name into opponent_name from public.competition_entries where id = e.other_id;

    insert into public.events (
      academy_id, team_id, competition_id, fixture_id, type, title,
      starts_at, ends_at, venue, opponent, round
    )
    values (
      e.academy_id, e.team_id, f.competition_id, f.id, 'match',
      coalesce(comp_name, 'Fixture') || ' — vs ' || coalesce(opponent_name, 'TBC'),
      coalesce(f.starts_at, now()),
      case when f.starts_at is not null and f.duration_mins is not null
           then f.starts_at + (f.duration_mins || ' minutes')::interval end,
      coalesce(f.venue_label, (select name from public.venues where id = f.venue_id)),
      opponent_name, f.round
    )
    on conflict (fixture_id, academy_id) where fixture_id is not null do update
      set starts_at    = excluded.starts_at,
          ends_at      = excluded.ends_at,
          venue        = excluded.venue,
          opponent     = excluded.opponent,
          round        = excluded.round,
          title        = excluded.title,
          cancelled_at = case when f.status in ('cancelled','postponed') then now() end;
  end loop;
end;
$$;

create or replace function public.sync_fixture_to_events()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.mirror_fixture(new.id);
  return new;
end;
$$;

-- When a name on the draw becomes a real team, every game already scheduled
-- for that name becomes that club's problem - and belongs in their calendar.
create or replace function public.on_entry_claimed()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  f uuid;
begin
  if new.team_id is null or new.academy_id is null then
    return new;
  end if;
  if new.team_id is not distinct from old.team_id
     and new.academy_id is not distinct from old.academy_id then
    return new;
  end if;

  for f in
    select id from public.fixtures
     where home_entry_id = new.id or away_entry_id = new.id
  loop
    perform public.mirror_fixture(f);
  end loop;

  return new;
end;
$$;

create trigger competition_entries_claimed
  after update of academy_id, team_id on public.competition_entries
  for each row execute function public.on_entry_claimed();
