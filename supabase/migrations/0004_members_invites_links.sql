-- 0004_members_invites_links.sql
-- Academy membership and the two ways in: an invite addressed to a phone
-- number, or a shareable per-team join link a coach drops into WhatsApp.

-- ---------------------------------------------------------------------------
-- academy_members — the membership edge. invited_by records who brought whom,
-- so an owner can trace (and revoke) a coach's whole tree.
-- ---------------------------------------------------------------------------
create table public.academy_members (
  id         uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role       public.academy_role not null default 'parent',
  status     public.member_status not null default 'active',
  invited_by uuid references public.profiles(id) on delete set null,
  joined_at  timestamptz not null default now(),
  removed_at timestamptz,

  constraint academy_members_unique unique (academy_id, profile_id),
  constraint academy_members_id_academy_key unique (id, academy_id)
);
alter table public.academy_members enable row level security;

-- An academy must keep at least one active owner. Enforced in the delete/update
-- policies and in the app; a constraint cannot see across rows.
create index academy_members_owner_idx
  on public.academy_members (academy_id)
  where role = 'owner' and status = 'active';

-- ---------------------------------------------------------------------------
-- invites — addressed to a phone number. Created before the person exists;
-- attaches when that number completes OTP sign-in.
-- ---------------------------------------------------------------------------
create table public.invites (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  phone       citext not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  full_name   text,
  role        public.academy_role not null default 'parent',
  invited_by  uuid not null references public.profiles(id) on delete cascade,
  token       text not null unique default encode(gen_random_bytes(16), 'hex'),
  status      public.invite_status not null default 'pending',
  expires_at  timestamptz not null default now() + interval '30 days',
  accepted_by uuid references public.profiles(id) on delete set null,
  accepted_at timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now(),

  constraint invites_id_academy_key unique (id, academy_id)
);
alter table public.invites enable row level security;

-- One live invite per number per academy; re-inviting reuses or replaces it.
create unique index invites_one_pending_per_phone
  on public.invites (academy_id, phone)
  where status = 'pending';

-- Teams the invitee lands in on acceptance.
create table public.invite_teams (
  invite_id  uuid not null,
  team_id    uuid not null,
  academy_id uuid not null references public.academies(id) on delete cascade,

  primary key (invite_id, team_id),
  constraint invite_teams_invite_fkey foreign key (invite_id, academy_id)
    references public.invites (id, academy_id) on delete cascade,
  constraint invite_teams_team_fkey foreign key (team_id, academy_id)
    references public.teams (id, academy_id) on delete cascade
);
alter table public.invite_teams enable row level security;

-- ---------------------------------------------------------------------------
-- join_links — /join/<token>. Revocable, optionally capped, 30 days by default.
-- Separate from invites because one is a broadcast and the other is addressed.
-- ---------------------------------------------------------------------------
create table public.join_links (
  id         uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id) on delete cascade,
  team_id    uuid,
  role       public.academy_role not null default 'parent'
               check (role in ('coach', 'parent', 'player')),
  label      text,
  token      text not null unique default encode(gen_random_bytes(12), 'hex'),
  max_uses   integer check (max_uses is null or max_uses > 0),
  use_count  integer not null default 0 check (use_count >= 0),
  expires_at timestamptz not null default now() + interval '30 days',
  created_by uuid not null references public.profiles(id) on delete cascade,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),

  constraint join_links_id_academy_key unique (id, academy_id),
  constraint join_links_team_fkey foreign key (team_id, academy_id)
    references public.teams (id, academy_id) on delete cascade
);
alter table public.join_links enable row level security;

-- Who came in through which link — the audit trail, and how we stop one
-- person consuming several uses.
create table public.join_link_redemptions (
  id         uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id) on delete cascade,
  link_id    uuid not null,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),

  constraint join_link_redemptions_unique unique (link_id, profile_id),
  constraint join_link_redemptions_link_fkey foreign key (link_id, academy_id)
    references public.join_links (id, academy_id) on delete cascade
);
alter table public.join_link_redemptions enable row level security;

-- ---------------------------------------------------------------------------
-- academy_invites — platform-owner links that create a NEW academy and make
-- the redeemer its owner. Not scoped to an academy: it doesn't exist yet.
-- ---------------------------------------------------------------------------
create table public.academy_invites (
  id                uuid primary key default gen_random_uuid(),
  token             text not null unique default encode(gen_random_bytes(16), 'hex'),
  academy_name_hint text,
  note              text,
  created_by        uuid not null references public.profiles(id) on delete cascade,
  expires_at        timestamptz not null default now() + interval '30 days',
  redeemed_by       uuid references public.profiles(id) on delete set null,
  redeemed_academy  uuid references public.academies(id) on delete set null,
  redeemed_at       timestamptz,
  revoked_at        timestamptz,
  created_at        timestamptz not null default now()
);
alter table public.academy_invites enable row level security;
