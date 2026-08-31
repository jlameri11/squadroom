-- 0025_fix_fixture_mirror_upsert.sql
-- events_one_per_fixture_per_club is a partial unique index, so ON CONFLICT
-- has to restate the predicate before Postgres will use it as an arbiter.
-- Folded into 0023's definition above; kept as its own migration so the
-- applied history matches the files.

create or replace function public.sync_fixture_to_events()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  e record;
  opponent_name text;
  comp_name text;
begin
  select name into comp_name from public.competitions where id = new.competition_id;

  for e in
    select ce.*, (case when ce.id = new.home_entry_id then new.away_entry_id else new.home_entry_id end) as other_id
      from public.competition_entries ce
     where ce.id in (new.home_entry_id, new.away_entry_id)
       and ce.academy_id is not null
       and ce.team_id is not null
  loop
    select display_name into opponent_name from public.competition_entries where id = e.other_id;

    insert into public.events (
      academy_id, team_id, competition_id, fixture_id, type, title,
      starts_at, ends_at, venue, opponent, round
    )
    values (
      e.academy_id, e.team_id, new.competition_id, new.id, 'match',
      coalesce(comp_name, 'Fixture') || ' — vs ' || coalesce(opponent_name, 'TBC'),
      coalesce(new.starts_at, now()),
      case when new.starts_at is not null and new.duration_mins is not null
           then new.starts_at + (new.duration_mins || ' minutes')::interval end,
      coalesce(new.venue_label, (select name from public.venues where id = new.venue_id)),
      opponent_name, new.round
    )
    on conflict (fixture_id, academy_id) where fixture_id is not null do update
      set starts_at    = excluded.starts_at,
          ends_at      = excluded.ends_at,
          venue        = excluded.venue,
          opponent     = excluded.opponent,
          round        = excluded.round,
          title        = excluded.title,
          cancelled_at = case when new.status in ('cancelled','postponed') then now() end;
  end loop;

  return new;
end;
$$;
