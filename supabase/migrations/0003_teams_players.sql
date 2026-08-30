-- 0003_teams_players.sql
-- Teams, their rosters, and the players themselves.
--
-- Tenant integrity is enforced with composite foreign keys, not triggers:
-- every child table carries academy_id and points at (id, academy_id) on its
-- parent, so a row that straddles two academies cannot be written at all.

create table public.teams (
  id         uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id) on delete cascade,
  name       text not null check (length(btrim(name)) > 0),
  age_group  text not null check (age_group ~ '^U([5-9]|1[0-8])$'),
  season     text not null default to_char(now(), 'YYYY'),
  status     public.team_status not null default 'active',
  ended_at   timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint teams_name_unique_per_season unique (academy_id, name, season),
  -- Target for child tables' composite FKs.
  constraint teams_id_academy_key unique (id, academy_id)
);
alter table public.teams enable row level security;

create trigger teams_set_updated_at
  before update on public.teams
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- players — a child on a roster. Separate from profiles: under-16s do not have
-- logins, and a player's history outlives any one account.
-- ---------------------------------------------------------------------------
create table public.players (
  id         uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id) on delete cascade,
  team_id    uuid,
  -- Set when a 16+ player gets their own login; they inherit this roster row.
  profile_id uuid references public.profiles(id) on delete set null,
  full_name  text not null check (length(btrim(full_name)) > 0),
  dob        date check (dob is null or dob > current_date - interval '25 years'),
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint players_id_academy_key unique (id, academy_id),
  -- Deleting a team orphans its players rather than deleting children.
  -- (Postgres 15+ column-list action; teams are archived, not deleted, anyway.)
  constraint players_team_fkey foreign key (team_id, academy_id)
    references public.teams (id, academy_id) on delete set null (team_id)
);
alter table public.players enable row level security;

create trigger players_set_updated_at
  before update on public.players
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- team_members — who is attached to a team. Replaces teams.coach_ids[]:
-- arrays cannot cascade, cannot be indexed usefully for RLS, and cannot
-- carry a role.
-- ---------------------------------------------------------------------------
create table public.team_members (
  id         uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id) on delete cascade,
  team_id    uuid not null,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role       public.academy_role not null default 'parent'
               check (role in ('coach', 'parent', 'player')),
  created_at timestamptz not null default now(),

  constraint team_members_unique unique (team_id, profile_id),
  constraint team_members_team_fkey foreign key (team_id, academy_id)
    references public.teams (id, academy_id) on delete cascade
);
alter table public.team_members enable row level security;

-- ---------------------------------------------------------------------------
-- player_guardians — replaces players.guardian_profile_ids[]. A player can
-- have two guardians; a guardian can have several players.
-- ---------------------------------------------------------------------------
create table public.player_guardians (
  id           uuid primary key default gen_random_uuid(),
  academy_id   uuid not null references public.academies(id) on delete cascade,
  player_id    uuid not null,
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  relationship text,
  is_primary   boolean not null default false,
  created_at   timestamptz not null default now(),

  constraint player_guardians_unique unique (player_id, profile_id),
  constraint player_guardians_player_fkey foreign key (player_id, academy_id)
    references public.players (id, academy_id) on delete cascade
);
alter table public.player_guardians enable row level security;
