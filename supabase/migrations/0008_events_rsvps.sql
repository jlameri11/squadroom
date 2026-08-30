-- 0008_events_rsvps.sql
-- Fixtures, training, socials — and the per-player RSVP a parent answers
-- once per child.

create table public.events (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  team_id     uuid,
  type        public.event_type not null default 'training',
  title       text not null check (length(btrim(title)) > 0),
  description text,

  starts_at   timestamptz not null,
  ends_at     timestamptz,
  arrive_at   timestamptz,

  venue       text,
  address     text,
  opponent    text,
  kit_colour  text,
  notes       text,

  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  cancelled_at timestamptz,

  constraint events_id_academy_key unique (id, academy_id),
  constraint events_team_fkey foreign key (team_id, academy_id)
    references public.teams (id, academy_id) on delete cascade,
  constraint events_ends_after_starts check (ends_at is null or ends_at >= starts_at),
  constraint events_arrive_before_start check (arrive_at is null or arrive_at <= starts_at)
);
alter table public.events enable row level security;

create trigger events_set_updated_at
  before update on public.events
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- event_rsvps — one row per (event, responder, player). A parent with two
-- kids writes two rows; a coach answering for themselves writes one with a
-- null player_id.
--
-- NULLS NOT DISTINCT (Postgres 15+) is what makes that unique constraint
-- actually bite on the coach's null-player row.
-- ---------------------------------------------------------------------------
create table public.event_rsvps (
  id         uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id) on delete cascade,
  event_id   uuid not null,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  player_id  uuid,
  status     public.rsvp_status not null,
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint event_rsvps_unique unique nulls not distinct (event_id, profile_id, player_id),
  constraint event_rsvps_event_fkey foreign key (event_id, academy_id)
    references public.events (id, academy_id) on delete cascade,
  constraint event_rsvps_player_fkey foreign key (player_id, academy_id)
    references public.players (id, academy_id) on delete cascade
);
alter table public.event_rsvps enable row level security;

create trigger event_rsvps_set_updated_at
  before update on public.event_rsvps
  for each row execute function public.set_updated_at();
