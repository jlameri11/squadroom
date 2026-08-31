-- 0023_venues_fixtures_ladders.sql
--
-- Fixtures belong to the competition, not to either club. A game between two
-- academies has one authoritative row, so when the organiser moves it, it
-- moves for everyone at once and cannot drift.
--
-- But every club's parents should experience it exactly like a training
-- session: a card in their team channel, RSVP buttons, a 24h reminder. So a
-- trigger mirrors each fixture into an ordinary `events` row per involved
-- club. The organiser owns the truth; each club gets a local copy that all
-- the existing machinery already understands.

create table public.venues (
  id         uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id) on delete cascade,
  name       text not null check (length(btrim(name)) > 0),
  address    text,
  notes      text,
  created_at timestamptz not null default now(),
  constraint venues_id_academy_key unique (id, academy_id)
);
alter table public.venues enable row level security;

create type public.fixture_status as enum
  ('scheduled', 'in_progress', 'final', 'forfeit', 'bye', 'postponed', 'cancelled');

create table public.fixtures (
  id             uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  division       text not null,
  group_label    text,
  round          text,

  -- Null on a bye, which is unavoidable with odd-numbered groups: NRIFA's
  -- own U7s tournament runs three groups of seven.
  home_entry_id  uuid references public.competition_entries(id) on delete cascade,
  away_entry_id  uuid references public.competition_entries(id) on delete cascade,

  starts_at      timestamptz,
  duration_mins  integer check (duration_mins is null or duration_mins > 0),
  venue_id       uuid references public.venues(id) on delete set null,
  venue_label    text,
  field_label    text,

  home_score     integer check (home_score is null or home_score >= 0),
  away_score     integer check (away_score is null or away_score >= 0),
  status         public.fixture_status not null default 'scheduled',

  score_entered_by uuid references public.profiles(id) on delete set null,
  score_entered_at timestamptz,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint fixtures_not_self check (home_entry_id is null or home_entry_id <> away_entry_id),
  constraint fixtures_scores_together check ((home_score is null) = (away_score is null))
);
alter table public.fixtures enable row level security;

create trigger fixtures_set_updated_at
  before update on public.fixtures
  for each row execute function public.set_updated_at();

create index fixtures_comp_idx     on public.fixtures (competition_id, starts_at);
create index fixtures_home_idx     on public.fixtures (home_entry_id);
create index fixtures_away_idx     on public.fixtures (away_entry_id);
create index fixtures_division_idx on public.fixtures (competition_id, division, group_label);
-- Two games cannot occupy the same field at the same moment.
create unique index fixtures_no_field_clash
  on public.fixtures (venue_id, field_label, starts_at)
  where venue_id is not null and field_label is not null and starts_at is not null
    and status not in ('cancelled', 'postponed');

alter table public.events add column fixture_id uuid references public.fixtures(id) on delete cascade;
create unique index events_one_per_fixture_per_club
  on public.events (fixture_id, academy_id) where fixture_id is not null;

-- Mirror a fixture into each involved club's own calendar. See 0025 for the
-- final version of this function; the ON CONFLICT here needs the partial
-- index predicate restated.
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

create trigger fixtures_mirror_to_events
  after insert or update of starts_at, venue_id, venue_label, status, round, duration_mins
  on public.fixtures
  for each row execute function public.sync_fixture_to_events();

-- Ladders, computed rather than stored.
--
-- 3 / 1 / 0, ties split by goal difference then goals for - the rules NRIFA's
-- own tournament sheet already uses. Head-to-head is deliberately NOT applied
-- here: it needs a mini-league between the tied teams only, and quietly
-- guessing at it is worse than showing teams level and letting the organiser
-- rule on the day, which is what the spreadsheet does today.
create or replace function public.competition_ladder(p_competition uuid, p_division text)
returns table (
  entry_id uuid, team_name text, group_label text,
  played integer, won integer, drawn integer, lost integer,
  goals_for integer, goals_against integer, goal_difference integer, points integer
)
language sql stable security definer set search_path = public as $$
  with played as (
    select f.home_entry_id as entry_id, f.home_score as gf, f.away_score as ga, f.group_label
      from public.fixtures f
     where f.competition_id = p_competition and f.division = p_division
       and f.status in ('final','forfeit') and f.home_score is not null
    union all
    select f.away_entry_id, f.away_score, f.home_score, f.group_label
      from public.fixtures f
     where f.competition_id = p_competition and f.division = p_division
       and f.status in ('final','forfeit') and f.away_score is not null
  )
  select
    e.id, e.display_name, e.group_label,
    count(p.entry_id)::integer,
    count(*) filter (where p.gf > p.ga)::integer,
    count(*) filter (where p.gf = p.ga)::integer,
    count(*) filter (where p.gf < p.ga)::integer,
    coalesce(sum(p.gf), 0)::integer,
    coalesce(sum(p.ga), 0)::integer,
    coalesce(sum(p.gf) - sum(p.ga), 0)::integer,
    (count(*) filter (where p.gf > p.ga) * 3 + count(*) filter (where p.gf = p.ga))::integer
  from public.competition_entries e
  left join played p on p.entry_id = e.id
  where e.competition_id = p_competition and e.division = p_division
    and app_private.is_competition_participant(p_competition)
  group by e.id, e.display_name, e.group_label
  order by 11 desc, 10 desc, 8 desc, e.display_name;
$$;

grant execute on function public.competition_ladder(uuid, text) to authenticated;

create policy venues_select on public.venues for select to authenticated
  using ((select app_private.is_academy_member(academy_id)));
create policy venues_write on public.venues for all to authenticated
  using ((select app_private.is_academy_coach(academy_id)))
  with check ((select app_private.is_academy_coach(academy_id)));

-- Every participant reads every fixture. You need other groups' results to
-- read your own ladder, and a draw is not private within a competition.
create policy fixtures_select on public.fixtures for select to authenticated
  using ((select app_private.is_competition_participant(competition_id)));

create policy fixtures_write on public.fixtures for all to authenticated
  using ((select app_private.is_competition_organiser(competition_id)))
  with check ((select app_private.is_competition_organiser(competition_id)));

-- Scores are the one thing a club may write on a fixture it did not create,
-- and only for a game it is actually playing in.
create policy fixtures_score_entry on public.fixtures for update to authenticated
  using (
    (select app_private.can_manage_entry(home_entry_id))
    or (select app_private.can_manage_entry(away_entry_id))
  )
  with check (
    (select app_private.can_manage_entry(home_entry_id))
    or (select app_private.can_manage_entry(away_entry_id))
  );
