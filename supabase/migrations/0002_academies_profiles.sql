-- 0002_academies_profiles.sql
-- The tenant root, user profiles, and the platform-owner allowlist.
-- RLS is enabled on creation; policies arrive in 0012. Until then: deny all.

-- ---------------------------------------------------------------------------
-- academies — the tenant root. Every other table hangs off this.
-- ---------------------------------------------------------------------------
create table public.academies (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null check (length(btrim(name)) > 0),
  slug                 citext not null unique
                         check (slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'),
  logo_url             text,
  primary_colour       text not null default '#0F172A'
                         check (primary_colour ~* '^#[0-9a-f]{6}$'),
  timezone             text not null default 'Australia/Sydney',

  -- Safeguarding settings. Defaults are the restrictive ones on purpose:
  -- parent-to-parent DMs off, parent phone numbers visible to staff only.
  dm_policy            public.dm_policy not null default 'staff_only',
  directory_visibility public.directory_visibility not null default 'staff_only',

  -- Present so billing can land later without a migration on a live table.
  plan                 text not null default 'free',

  created_by           uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
alter table public.academies enable row level security;

create trigger academies_set_updated_at
  before update on public.academies
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- profiles — one row per auth user. id IS the identity; phone is mutable.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null default '',
  phone      citext unique check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

alter table public.academies
  add constraint academies_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

-- Mirror a new auth user into profiles so the rest of the app can assume it exists.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, phone, full_name)
  values (
    new.id,
    public.normalise_phone(new.phone),
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep profiles.phone in step if the user changes their number via Supabase Auth.
create or replace function public.handle_user_phone_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.phone is distinct from old.phone then
    update public.profiles
       set phone = public.normalise_phone(new.phone)
     where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_phone_changed
  after update of phone on auth.users
  for each row execute function public.handle_user_phone_change();

-- ---------------------------------------------------------------------------
-- platform_admins — you, and nobody else. Gates the super-admin console.
-- Deliberately a table rather than a column so it can never be self-granted
-- through a profiles update.
-- ---------------------------------------------------------------------------
create table public.platform_admins (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
