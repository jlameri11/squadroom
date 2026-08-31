-- 0019_competitions.sql
-- A container above events: "SPL Season 3" holding "U8s Championship",
-- "U8s" and "Premier", each with its own fixtures.
--
-- Modelled as competition + entries rather than parent/child events, because
-- a container is not an event: it has no kick-off time, no venue, and nobody
-- RSVPs to it. Trying to make one row serve both meanings puts a nullable
-- starts_at on every fixture and a fake time on every season.

create type public.competition_type as enum ('season', 'tournament', 'gala_day', 'friendly_series', 'other');

create table public.competitions (
  id         uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id) on delete cascade,
  name       text not null check (length(btrim(name)) > 0),
  type       public.competition_type not null default 'season',
  season     text,
  organiser  text,
  starts_on  date,
  ends_on    date,
  status     public.team_status not null default 'active',
  notes      text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint competitions_id_academy_key unique (id, academy_id),
  constraint competitions_ends_after_starts
    check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
alter table public.competitions enable row level security;

create trigger competitions_set_updated_at
  before update on public.competitions
  for each row execute function public.set_updated_at();

create unique index competitions_name_unique
  on public.competitions (academy_id, lower(name), coalesce(season, ''));

-- Which of our teams plays in which division. The division is a label from
-- the organiser's competition, not one of our own tables - "U8s Championship"
-- is Football NSW's name for a grade, and we do not own that vocabulary.
create table public.competition_teams (
  id             uuid primary key default gen_random_uuid(),
  academy_id     uuid not null references public.academies(id) on delete cascade,
  competition_id uuid not null,
  team_id        uuid not null,
  division       text not null check (length(btrim(division)) > 0),
  created_at     timestamptz not null default now(),

  constraint competition_teams_unique unique (competition_id, team_id, division),
  constraint competition_teams_competition_fkey foreign key (competition_id, academy_id)
    references public.competitions (id, academy_id) on delete cascade,
  constraint competition_teams_team_fkey foreign key (team_id, academy_id)
    references public.teams (id, academy_id) on delete cascade
);
alter table public.competition_teams enable row level security;

-- Fixtures gain their place in a competition. Nullable: a friendly or a
-- training session belongs to no competition, and always will.
alter table public.events add column competition_id uuid;
alter table public.events add column round text;
alter table public.events add constraint events_competition_fkey
  foreign key (competition_id, academy_id)
  references public.competitions (id, academy_id) on delete set null (competition_id);

create policy competitions_select on public.competitions for select to authenticated
  using ((select app_private.is_academy_member(academy_id)));

create policy competitions_insert on public.competitions for insert to authenticated
  with check ((select app_private.is_academy_coach(academy_id)));

create policy competitions_update on public.competitions for update to authenticated
  using ((select app_private.is_academy_coach(academy_id)))
  with check ((select app_private.is_academy_coach(academy_id)));

create policy competitions_delete on public.competitions for delete to authenticated
  using ((select app_private.is_academy_staff(academy_id)));

create policy competition_teams_select on public.competition_teams for select to authenticated
  using ((select app_private.is_academy_member(academy_id)));

create policy competition_teams_write on public.competition_teams for all to authenticated
  using ((select app_private.is_academy_staff(academy_id)) or (select app_private.is_team_coach(team_id)))
  with check ((select app_private.is_academy_staff(academy_id)) or (select app_private.is_team_coach(team_id)));

create index competitions_academy_idx      on public.competitions (academy_id) where status = 'active';
create index competition_teams_comp_idx    on public.competition_teams (competition_id);
create index competition_teams_team_idx    on public.competition_teams (team_id);
create index events_competition_idx        on public.events (competition_id, starts_at) where competition_id is not null;
