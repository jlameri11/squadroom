-- 0021_organisations_and_competition_participation.sql
--
-- A competition spans tenants. SPL Season 3 is run by a league, entered by a
-- hundred clubs, and each of those clubs brings its own coaches and parents
-- who must never see each other's data.
--
-- The model in 0019 assumed one academy owned the whole competition. That is
-- fine for NRIFA's own gala day and wrong for everything else, so it is
-- replaced here rather than worked around.
--
-- The tenant table keeps the name `academies` - renaming it would touch every
-- policy, helper and foreign key in the schema for no behavioural gain - but
-- it now means ORGANISATION. An academy, a one-team club, a school or a
-- league are all rows in it, separated by `type`.

create type public.org_type as enum ('academy', 'club', 'league', 'school', 'other');

alter table public.academies add column type public.org_type not null default 'academy';

comment on table public.academies is
  'Tenant root. Despite the name this is any organisation: an academy, a
   single-team club, a school or a competition-running league. See type.';

alter table public.competitions rename column academy_id to organiser_id;
alter table public.competitions rename constraint competitions_id_academy_key
  to competitions_id_organiser_key;

alter table public.competitions add column visibility text not null default 'participants'
  check (visibility in ('participants', 'public'));
comment on column public.competitions.visibility is
  'participants: only entered clubs see the draw. public: anyone with the
   link can read fixtures and ladders, for a league that publishes them.';

-- An organisation invited into a competition. This is the ONLY thing that
-- crosses the tenant boundary, and it grants a narrow, read-mostly slice:
-- fixtures, ladders, venues, results. It grants nothing about the other
-- clubs' members, messages, children or contact details.
create table public.competition_clubs (
  id             uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  academy_id     uuid not null references public.academies(id) on delete cascade,
  status         text not null default 'invited'
                   check (status in ('invited', 'active', 'withdrawn')),
  invited_by     uuid references public.profiles(id) on delete set null,
  joined_at      timestamptz,
  created_at     timestamptz not null default now(),

  constraint competition_clubs_unique unique (competition_id, academy_id)
);
alter table public.competition_clubs enable row level security;

-- team_id is nullable on purpose. A tournament is mostly teams that are not
-- in our system at all - a visiting club that has not signed up yet is just a
-- name on the draw, and the fixture still has to exist. When that club does
-- join, the entry is pointed at their real team and nothing else changes.
create table public.competition_entries (
  id             uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  academy_id     uuid references public.academies(id) on delete set null,
  team_id        uuid,
  display_name   text not null check (length(btrim(display_name)) > 0),
  division       text not null check (length(btrim(division)) > 0),
  group_label    text,
  seed           integer,
  created_at     timestamptz not null default now(),

  constraint competition_entries_team_fkey foreign key (team_id, academy_id)
    references public.teams (id, academy_id) on delete set null (team_id),
  constraint competition_entries_unique unique (competition_id, division, display_name)
);
alter table public.competition_entries enable row level security;

-- 0019's table assumed our own teams only. Entries replace it.
drop table public.competition_teams;

create index competition_clubs_academy_idx    on public.competition_clubs (academy_id) where status = 'active';
create index competition_clubs_comp_idx       on public.competition_clubs (competition_id);
create index competition_entries_comp_idx     on public.competition_entries (competition_id, division);
create index competition_entries_academy_idx  on public.competition_entries (academy_id) where academy_id is not null;
create index competition_entries_team_idx     on public.competition_entries (team_id) where team_id is not null;
