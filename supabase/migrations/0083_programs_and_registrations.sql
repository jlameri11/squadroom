-- 0083: the thing a parent signs their child up to, and the signing up.
--
-- ONE TABLE FOR ALL OF IT. An SPL squad, a development program, a trials day,
-- a school-holiday camp, a term class, entry into a gala day, a tour. Every
-- one of these is: a name, a window to apply in, who is eligible, how many
-- places, what it costs. They differ by `kind`, price and dates — not by
-- shape — and a table each would mean seven approval queues, seven payment
-- paths and seven screens that drift apart.
--
-- ELIGIBILITY IS BY BIRTH YEAR, NEVER AGE. A child born in January and one
-- born in December are the same football age all season, and an age computed
-- today is wrong next week. Every governing body in the sport works in birth
-- years and so does this.
--
-- CAPACITY IS ENFORCED BY A TRIGGER, NOT BY THE SCREEN. Two parents can tap
-- Register in the same instant; each one's browser counted nineteen of twenty
-- places taken, and both wrote. Only the database sees both, so only the
-- database can decide which one got the last place and which one is
-- waitlisted. A check in a route handler is a check a race walks around.
--
-- MONEY REUSES THE EXISTING PATH. A program points at a `payment_requests`
-- row (0060), and a registration's paid state is a `payments` row against
-- that request for that player. There is no second payment table, no second
-- webhook, and nothing new that could mark a season's fees paid — the webhook
-- is still the only thing in the system that may do that.

do $$ begin
  create type public.program_kind as enum (
    'squad',        -- a season in a squad: SPL, club team
    'development',  -- weekly skills / development program
    'trial',        -- trials for a squad
    'camp',         -- school-holiday camp
    'term_class',   -- term-based classes
    'tournament',   -- entry into a tournament or gala day
    'tour',         -- a tour
    'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.program_status as enum ('draft', 'open', 'closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.registration_status as enum (
    'pending', 'approved', 'rejected', 'waitlisted', 'withdrawn'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.programs (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  name        text not null check (btrim(name) <> ''),
  kind        public.program_kind not null default 'squad',
  status      public.program_status not null default 'draft',
  season      text,
  description text,

  -- Inclusive, and in birth years. born_from is the EARLIEST year, so the
  -- oldest child; born_to is the latest, so the youngest. Both null means
  -- open to any age, which is what a club-wide tour is.
  born_from_year integer check (born_from_year between 1900 and 2200),
  born_to_year   integer check (born_to_year between 1900 and 2200),
  constraint programs_birth_years_ordered
    check (born_from_year is null or born_to_year is null
           or born_from_year <= born_to_year),

  -- Some programs are single-gender because the competition they feed is.
  gender public.player_gender,

  -- Null means no limit. A trials day usually has one; a tour always does.
  capacity         integer check (capacity > 0),
  waitlist_enabled boolean not null default true,

  -- When a parent may apply, which is not when the program runs.
  opens_at   timestamptz,
  closes_at  timestamptz,
  starts_on  date,
  ends_on    date,
  constraint programs_window_ordered
    check (opens_at is null or closes_at is null or opens_at < closes_at),

  -- Approving a registration can put the child straight into this team, and
  -- the existing triggers on team_members then create the channel membership
  -- and the calendar entries. Nothing new to build for that.
  team_id uuid,

  -- The bill. Null means free.
  payment_request_id uuid,
  -- Whether paying is required before a place is held. A trials day usually
  -- takes the money up front; a squad season often invoices later.
  payment_required boolean not null default false,

  -- Extra questions this academy wants asked, as [{id, label, type, required}].
  -- Free-form on purpose: what a tour needs to ask (passport, dietary, rooming)
  -- has nothing to do with what a trials day needs, and a column each would be
  -- a migration every time an academy thought of something.
  questions jsonb not null default '[]'::jsonb
    check (jsonb_typeof(questions) = 'array'),

  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint programs_id_academy_key unique (id, academy_id),
  constraint programs_team_fkey foreign key (team_id, academy_id)
    references public.teams (id, academy_id) on delete set null,
  constraint programs_payment_request_fkey foreign key (payment_request_id, academy_id)
    references public.payment_requests (id, academy_id) on delete set null
);

create index if not exists programs_academy_status_idx
  on public.programs (academy_id, status, opens_at);

create table if not exists public.program_registrations (
  id         uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id) on delete cascade,
  program_id uuid not null,
  player_id  uuid not null,

  -- Who submitted it. A registration is an act by an adult on behalf of a
  -- child, and that adult is who gets told the outcome.
  submitted_by uuid not null references public.profiles(id) on delete cascade,

  status public.registration_status not null default 'pending',

  -- Answers to programs.questions, keyed by question id.
  answers jsonb not null default '{}'::jsonb
    check (jsonb_typeof(answers) = 'object'),
  note text,

  -- Where in the queue, for a waitlist that has to be fair. Set by the
  -- trigger below, never by a client.
  waitlist_position integer,

  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  decision_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A child is in a program once. A parent who taps twice, or two guardians
  -- who each register the same child, get one row — which is the other half
  -- of the duplicate problem that find_existing_player solves.
  constraint program_registrations_once unique (program_id, player_id),

  constraint program_registrations_id_academy_key unique (id, academy_id),
  constraint program_registrations_program_fkey foreign key (program_id, academy_id)
    references public.programs (id, academy_id) on delete cascade,
  constraint program_registrations_player_fkey foreign key (player_id, academy_id)
    references public.players (id, academy_id) on delete cascade
);

create index if not exists program_registrations_program_status_idx
  on public.program_registrations (program_id, status);
create index if not exists program_registrations_player_idx
  on public.program_registrations (player_id);

/**
 * Everything the database must decide rather than trust a browser about.
 *
 * Three things, and all three were tempting to put in a route handler:
 *
 *   1. The program is actually open. A closed program's URL still works, and
 *      a parent who left a tab open overnight should be told no.
 *   2. The child is the right age, by birth year, and the right gender.
 *   3. The place exists. This is the race: counting approved registrations in
 *      the browser and inserting if there is room means two parents both
 *      count nineteen and both insert. Counting here, inside the write, is
 *      the only place where exactly one of them can lose.
 *
 * Losing means WAITLISTED, not rejected — with a position, so the queue is
 * in the order people actually applied. If the academy has turned the
 * waitlist off, it means refused, and the parent is told the program is full
 * rather than left wondering.
 */
create or replace function public.guard_program_registration()
returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  v_program  public.programs;
  v_player   public.players;
  v_taken    integer;
  v_queue    integer;
  v_year     integer;
begin
  select * into v_program from public.programs where id = new.program_id;
  select * into v_player  from public.players  where id = new.player_id;

  -- academy_id is carried on the row rather than derived, and the composite
  -- foreign keys above already make a cross-tenant pairing impossible. This
  -- catches the row being inserted with the wrong one of two academies the
  -- submitter does belong to.
  if v_program.academy_id <> new.academy_id or v_player.academy_id <> new.academy_id then
    raise exception 'that program and that player are not in the same academy'
      using errcode = '42501';
  end if;

  -- Staff may add anybody at any time: a late entry agreed on the phone is a
  -- normal part of running an academy, and refusing it would just push the
  -- academy back into a spreadsheet.
  if not app_private.is_academy_staff(new.academy_id) then
    if v_program.status <> 'open' then
      raise exception 'registrations for % are not open', v_program.name
        using errcode = '22023';
    end if;
    if v_program.opens_at is not null and now() < v_program.opens_at then
      raise exception 'registrations for % open %', v_program.name,
        to_char(v_program.opens_at, 'FMDay FMDD FMMonth')
        using errcode = '22023';
    end if;
    if v_program.closes_at is not null and now() > v_program.closes_at then
      raise exception 'registrations for % closed on %', v_program.name,
        to_char(v_program.closes_at, 'FMDD FMMonth')
        using errcode = '22023';
    end if;
  end if;

  -- Birth year, never age.
  v_year := extract(year from v_player.dob)::integer;
  if v_program.born_from_year is not null and v_year < v_program.born_from_year then
    raise exception '% is for players born % to %, and % was born in %',
      v_program.name, v_program.born_from_year,
      coalesce(v_program.born_to_year::text, 'later'),
      v_player.full_name, v_year
      using errcode = '22023';
  end if;
  if v_program.born_to_year is not null and v_year > v_program.born_to_year then
    raise exception '% is for players born % to %, and % was born in %',
      v_program.name, coalesce(v_program.born_from_year::text, 'earlier'),
      v_program.born_to_year, v_player.full_name, v_year
      using errcode = '22023';
  end if;

  if v_program.gender is not null and v_player.gender is not null
     and v_program.gender <> v_player.gender then
    raise exception '% is a % program', v_program.name, v_program.gender
      using errcode = '22023';
  end if;

  -- The race. SERIALIZABLE is not in play here, so take the program row's
  -- lock: whoever gets it counts and decides, and the next transaction counts
  -- again afterwards rather than against a stale number.
  if v_program.capacity is not null and new.status = 'pending' then
    perform 1 from public.programs where id = new.program_id for update;

    select count(*) into v_taken
      from public.program_registrations
     where program_id = new.program_id
       and status in ('pending', 'approved');

    if v_taken >= v_program.capacity then
      if not v_program.waitlist_enabled then
        raise exception '% is full', v_program.name using errcode = '22023';
      end if;
      select coalesce(max(waitlist_position), 0) + 1 into v_queue
        from public.program_registrations
       where program_id = new.program_id and status = 'waitlisted';
      new.status := 'waitlisted';
      new.waitlist_position := v_queue;
    end if;
  end if;

  return new;
end;
$fn$;

drop trigger if exists program_registrations_guard on public.program_registrations;
create trigger program_registrations_guard
  before insert on public.program_registrations
  for each row execute function public.guard_program_registration();

/**
 * A decision is a decision, and it is stamped here.
 *
 * decided_by and decided_at are set from the session rather than taken from
 * the row, because "who approved this child" is the kind of fact that has to
 * be true a year later when somebody asks.
 */
create or replace function public.stamp_registration_decision()
returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if new.status <> old.status
     and new.status in ('approved', 'rejected', 'waitlisted') then
    new.decided_by := auth.uid();
    new.decided_at := now();
  end if;

  -- Leaving the queue closes the gap behind you, or the numbers stop meaning
  -- anything after the first withdrawal.
  if old.status = 'waitlisted' and new.status <> 'waitlisted' then
    new.waitlist_position := null;
    update public.program_registrations
       set waitlist_position = waitlist_position - 1
     where program_id = new.program_id
       and status = 'waitlisted'
       and waitlist_position > old.waitlist_position;
  end if;

  return new;
end;
$fn$;

drop trigger if exists program_registrations_stamp on public.program_registrations;
create trigger program_registrations_stamp
  before update of status on public.program_registrations
  for each row execute function public.stamp_registration_decision();

create trigger programs_set_updated_at
  before update on public.programs
  for each row execute function public.set_updated_at();

create trigger program_registrations_set_updated_at
  before update on public.program_registrations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- policies

alter table public.programs enable row level security;
alter table public.program_registrations enable row level security;

-- A draft program is the academy's working copy and nobody else's business.
create policy programs_select on public.programs
  for select to authenticated
  using (
    (select app_private.is_academy_member(academy_id))
    and (status <> 'draft' or (select app_private.is_academy_coach(academy_id)))
  );

create policy programs_insert on public.programs
  for insert to authenticated
  with check ((select app_private.is_academy_staff(academy_id)));

create policy programs_update on public.programs
  for update to authenticated
  using ((select app_private.is_academy_staff(academy_id)))
  with check ((select app_private.is_academy_staff(academy_id)));

create policy programs_delete on public.programs
  for delete to authenticated
  using ((select app_private.is_academy_staff(academy_id)));

-- A guardian sees their own children's registrations; coaches see their
-- academy's, because running the queue is the job.
create policy program_registrations_select on public.program_registrations
  for select to authenticated
  using (
    (select app_private.is_guardian_of(player_id))
    or (select app_private.is_academy_coach(academy_id))
  );

create policy program_registrations_insert on public.program_registrations
  for insert to authenticated
  with check (
    submitted_by = (select auth.uid())
    and (
      (select app_private.is_guardian_of(player_id))
      or (select app_private.is_academy_staff(academy_id))
    )
  );

-- A guardian may withdraw and may fix their own answers. They may NOT approve
-- anything, which is why the status check is here and not left to the UI.
create policy program_registrations_update on public.program_registrations
  for update to authenticated
  using (
    (select app_private.is_guardian_of(player_id))
    or (select app_private.is_academy_staff(academy_id))
  )
  with check (
    (select app_private.is_academy_staff(academy_id))
    or (
      (select app_private.is_guardian_of(player_id))
      and status in ('pending', 'withdrawn', 'waitlisted')
    )
  );

create policy program_registrations_delete on public.program_registrations
  for delete to authenticated
  using ((select app_private.is_academy_staff(academy_id)));
