-- 0082: what a registration actually asks for, and where the sensitive half
-- of it lives.
--
-- `players` today is a name, a date of birth and a free-text note. A real
-- registration collects more than that, and the more it collects the more it
-- matters WHERE each piece sits — because `players` is read by every roster,
-- directory, fixture and ladder screen in the product.
--
-- So this splits in two deliberately:
--
--   · `players` gains the fields that are part of being a name on a team
--     sheet — preferred name, gender, the Football Australia number, a photo.
--     These travel with the roster because the roster needs them.
--
--   · `player_medical` is a SEPARATE TABLE, not columns on `players`. A
--     child's asthma must not be joined into a fixture list, a directory
--     lookup or a ladder. Keeping it in another table with its own policy
--     means a careless `select *` on players cannot leak it, and there have
--     been plenty of careless selects in this repo's history.
--
-- WHO SEES MEDICAL. Guardians, and academy OWNERS/ADMINS — `is_academy_staff`,
-- not `is_academy_coach`. A volunteer coach of one age group has no business
-- reading another family's medical history, and most academies have many more
-- coaches than admins.
--
-- But a coach standing at a ground does need to know a child carries an
-- EpiPen, and "the policy was tidy" is not a defence when they did not. So
-- there is one narrow window: `coach_note`, a short line the guardian writes
-- for exactly that purpose, readable through `public.team_coach_alerts` by
-- coaches of that team and nothing else. The full record stays shut.

-- Dribl dedupes a family's registrations on name + gender + date of birth, and
-- it needs gender for competition eligibility besides. `players` had no such
-- column, so a second guardian registering the same child created a second
-- child.
do $$ begin
  create type public.player_gender as enum ('female', 'male', 'other');
exception when duplicate_object then null; end $$;

alter table public.players
  -- What the child is actually called. A team sheet that says "Matteo" when
  -- everyone says "Teo" is a team sheet nobody trusts.
  add column if not exists preferred_name text,
  add column if not exists gender public.player_gender,
  -- The Football Australia / PlayFootball number. This is the real-world key
  -- for a registered player in Australia, and the only reliable way to line a
  -- Squadroom player up with the same child in Dribl or PlayFootball — names
  -- are spelled three ways and dates of birth get typed wrong.
  add column if not exists ff_number text,
  add column if not exists photo_url text,
  add column if not exists school text;

-- One Football Australia number per academy. The same child registered twice
-- is the thing registration exists to prevent.
create unique index if not exists players_ff_number_key
  on public.players (academy_id, ff_number)
  where ff_number is not null;

-- Finding a child by name and birthday happens on every registration, so it
-- should not be a sequential scan over an academy's roster.
create index if not exists players_academy_dob_idx
  on public.players (academy_id, dob);

create table if not exists public.player_medical (
  -- One row per player, so the player id IS the key. A second medical record
  -- for the same child is not a thing that should be representable.
  player_id        uuid primary key,
  academy_id       uuid not null references public.academies(id) on delete cascade,

  -- The short line a coach may see. Deliberately one line: "Carries an
  -- EpiPen — in the red bag" is useful at a ground, a medical history is not.
  coach_note       text,

  -- The rest is for the academy's administrators and the family.
  conditions       text,
  allergies        text,
  medications      text,
  dietary          text,
  medicare_number  text,
  ambulance_cover  text,
  doctor_name      text,
  doctor_phone     text,

  -- Who to ring, which is not always a guardian — grandparents do most of the
  -- Saturday driving.
  emergency_name     text,
  emergency_phone    text,
  emergency_relation text,

  -- Consent to administer first aid, which an academy legally needs before a
  -- volunteer puts a plaster on anybody.
  first_aid_consent  boolean not null default false,

  updated_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- Same-tenant by construction, like every other child table here.
  constraint player_medical_player_fkey foreign key (player_id, academy_id)
    references public.players (id, academy_id) on delete cascade
);

alter table public.player_medical enable row level security;

-- Guardians of the child, and the academy's owners/admins. Not coaches.
create policy player_medical_select on public.player_medical
  for select to authenticated
  using (
    (select app_private.is_guardian_of(player_id))
    or (select app_private.is_academy_staff(academy_id))
  );

-- A guardian fills in their own child's; staff may correct it. Split rather
-- than FOR ALL, because a FOR ALL policy is also a SELECT policy and this
-- repo has already been bitten once by exactly that — 0056's events_write
-- silently beat the private_to filter and a coach read every private event.
create policy player_medical_insert on public.player_medical
  for insert to authenticated
  with check (
    (select app_private.is_guardian_of(player_id))
    or (select app_private.is_academy_staff(academy_id))
  );

create policy player_medical_update on public.player_medical
  for update to authenticated
  using (
    (select app_private.is_guardian_of(player_id))
    or (select app_private.is_academy_staff(academy_id))
  )
  with check (
    (select app_private.is_guardian_of(player_id))
    or (select app_private.is_academy_staff(academy_id))
  );

-- Deliberately nobody. A medical record is not deleted because a season
-- ended; it goes when the player row goes, by cascade.
create policy player_medical_delete on public.player_medical
  for delete to authenticated
  using ((select app_private.is_academy_staff(academy_id)));

create trigger player_medical_set_updated_at
  before update on public.player_medical
  for each row execute function public.set_updated_at();

/**
 * The one line a coach may see about each child in their team.
 *
 * Not a view and not a policy on the table, because what a coach may read is
 * ONE COLUMN and Postgres row-level security does not do columns. A function
 * that returns only `coach_note` cannot be coaxed into returning the medical
 * history by any argument.
 *
 * Returns nothing at all for a team this person does not coach.
 */
create or replace function public.team_coach_alerts(p_team uuid)
returns table (
  player_id   uuid,
  player_name text,
  coach_note  text
)
language sql stable security definer set search_path = public as $fn$
  select pl.id, coalesce(pl.preferred_name, pl.full_name), pm.coach_note
    from public.players pl
    join public.player_medical pm
      on pm.player_id = pl.id and pm.academy_id = pl.academy_id
   where pl.team_id = p_team
     and pm.coach_note is not null
     and btrim(pm.coach_note) <> ''
     and (select app_private.is_team_coach(p_team))
   order by pl.full_name;
$fn$;

revoke execute on function public.team_coach_alerts(uuid) from public, anon;
grant execute on function public.team_coach_alerts(uuid) to authenticated;

/**
 * Is this child already on the books?
 *
 * Dribl's rule, because it is the right one: a match on name + gender + date
 * of birth. Without it the second guardian to register — and both guardians
 * do register, because each thinks the other has not — creates a duplicate
 * child, and from then on the squad list has two of them, the ladder counts
 * one, and nobody can tell which row the medical note is on.
 *
 * Deliberately NOT fuzzy. "Matteo" and "Teo" are not merged automatically;
 * what comes back is a candidate for a human to confirm, which is the same
 * stance the fixture importer takes about column mapping. Guessing wrong here
 * attaches a stranger's child to a family.
 *
 * In app_private: it answers a question about children the caller may have no
 * relationship to, so it must never be a REST endpoint.
 */
create or replace function app_private.find_existing_player(
  p_academy uuid,
  p_name    text,
  p_dob     date,
  p_gender  public.player_gender default null
)
returns uuid
language sql stable security definer set search_path = public as $fn$
  select pl.id
    from public.players pl
   where pl.academy_id = p_academy
     and pl.dob = p_dob
     and lower(btrim(pl.full_name)) = lower(btrim(p_name))
     and (p_gender is null or pl.gender is null or pl.gender = p_gender)
   order by pl.created_at
   limit 1;
$fn$;
