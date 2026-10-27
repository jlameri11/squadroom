-- 0122: R-02. A family who has never heard of us.
--
-- `programs` and `program_registrations` have existed since 0079 and both
-- assume an account: `submitted_by` is a profile. That covers a family a coach
-- has already invited and covers nothing about how a club grows. A parent who
-- sees a flyer at a school gate has no account, no invite link and no coach
-- who knows their name.
--
-- THIS IS THE MOST EXPOSED SURFACE IN THE PRODUCT. Everything else here is
-- reachable only by somebody a coach has already vouched for; this is
-- writable by anyone on the internet, which changes what each decision costs:
--
--   · One failure message for every reason a program will not take a
--     registration. "That program is full" and "that program does not exist"
--     are both "not open", because the difference tells somebody probing
--     which slugs and ids are real.
--   · The submit returns the id and the secret and NOTHING ELSE. It must not
--     say whether this child is already registered — that would make an open
--     endpoint an oracle for whether a named child plays at a named club.
--   · Rate limited on a hashed IP, the same way the join link is, because
--     approval already stops spam getting in and the thing that still hurts
--     is a queue nobody can face.
--   · Nothing is granted. A submission is a request a human still decides,
--     and the row cannot create a membership, a channel or an account.
--
-- WHAT IS PUBLISHED, and the rule behind it: a program's name, dates, price
-- and whether there is room. Never a child, never a family, never a count
-- that identifies anybody. `spots_left` is an aggregate a club would print on
-- a flyer; who is in those spots is not.

create table if not exists public.registration_requests (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  program_id  uuid not null,

  -- The guardian, as typed. No account exists yet, so there is nothing to
  -- point a foreign key at.
  guardian_name  text not null,
  guardian_phone text,
  guardian_email text,

  -- The child. A date of birth rather than an age, because a program's
  -- eligibility is a birth year and an age is wrong a week later.
  child_name     text not null,
  child_dob      date not null,
  -- The same three values `players.gender` allows. Constrained HERE as well
  -- as in the route, because this row is written from an anonymous browser
  -- and an unconstrained value would only fail later, at approval, in front
  -- of a club admin who did nothing wrong.
  child_gender   text check (child_gender is null or child_gender in ('male','female','other')),

  answers  jsonb not null default '{}'::jsonb,
  -- Which consent documents were accepted, by id AND version. "They agreed to
  -- the code of conduct" is worthless without which one.
  consents jsonb not null default '[]'::jsonb,

  -- The device secret, hashed. Same scheme as join_requests (lib/join.ts):
  -- the browser keeps the secret, the database keeps sha256 of it, so a
  -- database leak cannot mint anyone a session.
  secret_hash text not null,

  status text not null default 'pending'
    check (status in ('pending', 'approved', 'declined', 'expired')),

  -- Filled in on approval, by the route that has the service role.
  profile_id  uuid references public.profiles(id) on delete set null,
  player_id   uuid references public.players(id) on delete set null,
  registration_id uuid,

  decided_by  uuid references public.profiles(id),
  decided_at  timestamptz,
  decision_note text,
  claimed_at  timestamptz,

  created_at  timestamptz not null default now(),
  -- 90 days. A request nobody decided is not a record worth keeping, and a
  -- secret that never expires is a bearer token that never expires.
  expires_at  timestamptz not null default now() + interval '90 days',

  constraint registration_requests_program_fk
    foreign key (program_id, academy_id)
    references public.programs(id, academy_id) on delete cascade,
  constraint registration_requests_id_academy_key unique (id, academy_id)
);

create index if not exists registration_requests_queue_idx
  on public.registration_requests (academy_id, status, created_at);

alter table public.registration_requests enable row level security;

-- Staff only, and only their own academy's. A registration carries a child's
-- date of birth and a family's phone number before anybody has agreed to
-- anything, so it is the narrowest read in the product that is not a medical
-- note.
create policy registration_requests_select on public.registration_requests
  for select to authenticated
  using ((select app_private.is_academy_coach(academy_id)));

-- Nobody writes directly, in either direction. Submission goes through the
-- route that holds the rate limit and the eligibility rules; the decision
-- goes through the route that creates the account. A policy that allowed
-- either would be a policy that skipped them.
create policy registration_requests_insert on public.registration_requests
  for insert to authenticated with check (false);
create policy registration_requests_update on public.registration_requests
  for update to authenticated using (false);
create policy registration_requests_delete on public.registration_requests
  for delete to authenticated using (false);

/**
 * How many places are left.
 *
 * Counts the places actually TAKEN — approved registrations plus requests
 * still waiting — because a program with twelve places and eleven pending
 * requests has one place left, not twelve. The alternative is a club
 * discovering on the first morning that it accepted thirty children into a
 * hall that holds twelve.
 *
 * Null capacity means no limit, and returns null rather than a large number
 * so a caller cannot accidentally treat "unlimited" as "zero".
 */
create or replace function app_private.program_spots_left(p_program uuid)
returns integer
language sql stable security definer set search_path = public as $fn$
  select case
    when p.capacity is null then null
    else greatest(
      p.capacity
      - (select count(*) from public.program_registrations r
          where r.program_id = p.id and r.status in ('approved', 'pending'))
      - (select count(*) from public.registration_requests q
          where q.program_id = p.id and q.status = 'pending'),
      0
    )::integer
  end
  from public.programs p
 where p.id = p_program;
$fn$;

/**
 * What a club publishes about its programs.
 *
 * Anon-callable, so every line of it is a decision about what the internet
 * may know. Programs that are not open are not listed at all — not listed as
 * closed, which would still confirm they exist.
 *
 * The consent documents come back with it, because a registration form that
 * asks somebody to agree to something has to show them the thing.
 */
create or replace function public.public_programs(p_slug text)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_academy public.academies;
begin
  select * into v_academy from public.academies where slug = lower(btrim(p_slug));
  if v_academy.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'academy', jsonb_build_object(
      'name', v_academy.name,
      'slug', v_academy.slug,
      'primary_colour', v_academy.primary_colour,
      'logo_url', v_academy.logo_url,
      'timezone', v_academy.timezone
    ),
    'programs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id,
               'name', p.name,
               'kind', p.kind,
               'description', p.description,
               'season', p.season,
               'born_from_year', p.born_from_year,
               'born_to_year', p.born_to_year,
               'gender', p.gender,
               'starts_on', p.starts_on,
               'ends_on', p.ends_on,
               'closes_at', p.closes_at,
               'questions', p.questions,
               'payment_required', p.payment_required,
               -- The price, from the payment request the program points at.
               -- Integer cents, never a float: 49.9 * 100 is 4989.999999.
               'amount_cents', (
                 select pr.amount_cents from public.payment_requests pr
                  where pr.id = p.payment_request_id
               ),
               'spots_left', app_private.program_spots_left(p.id),
               'waitlist_enabled', p.waitlist_enabled
             ) order by p.starts_on nulls last, p.name)
        from public.programs p
       where p.academy_id = v_academy.id
         and p.status = 'open'
         and (p.opens_at is null or p.opens_at <= now())
         and (p.closes_at is null or p.closes_at > now())
    ), '[]'::jsonb),
    'consents', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id,
               'kind', c.kind,
               'title', c.title,
               'version', c.version,
               'body', c.body,
               'required', c.required
             ) order by c.required desc, c.title)
        from public.consent_documents c
       where c.academy_id = v_academy.id
         and c.published_at is not null
         and c.retired_at is null
    ), '[]'::jsonb)
  );
end;
$fn$;

revoke execute on function public.public_programs(text) from public;
grant execute on function public.public_programs(text) to anon, authenticated;

/**
 * Is this submission allowed to happen at all?
 *
 * One function, called by the route with the service role, so every rule is
 * in one place and testable without HTTP. Returns the program id on success
 * and raises with a single unhelpful message on every failure — see the note
 * at the top about what the differences would tell somebody probing.
 *
 * This is validation, not authorisation: there is nobody to authorise.
 */
create or replace function public.check_registration(
  p_academy_slug text,
  p_program      uuid,
  p_child_dob    date,
  p_consents     jsonb
)
returns uuid
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_academy uuid;
  v_program public.programs;
  v_missing integer;
begin
  select id into v_academy from public.academies where slug = lower(btrim(p_academy_slug));

  select * into v_program
    from public.programs
   where id = p_program and academy_id = v_academy
     and status = 'open'
     and (opens_at is null or opens_at <= now())
     and (closes_at is null or closes_at > now());

  -- One message. A club that is full, a program that closed yesterday, a
  -- program belonging to another club and a program that never existed are
  -- all the same answer here.
  if v_program.id is null then
    raise exception 'That isn''t open for registrations.' using errcode = '22023';
  end if;

  -- Birth YEAR, never age. A January and a December child are the same
  -- football age, and an age computed today is wrong next week.
  if v_program.born_from_year is not null
     and extract(year from p_child_dob) < v_program.born_from_year then
    raise exception 'That program is for children born between % and %.',
      v_program.born_from_year, coalesce(v_program.born_to_year, v_program.born_from_year)
      using errcode = '22023';
  end if;
  if v_program.born_to_year is not null
     and extract(year from p_child_dob) > v_program.born_to_year then
    raise exception 'That program is for children born between % and %.',
      coalesce(v_program.born_from_year, v_program.born_to_year), v_program.born_to_year
      using errcode = '22023';
  end if;

  -- A date of birth in the future, or a 40-year-old, is a typo in a field
  -- that decides eligibility.
  if p_child_dob > (current_date at time zone 'utc')::date
     or p_child_dob < (current_date at time zone 'utc')::date - interval '25 years' then
    raise exception 'That date of birth does not look right.' using errcode = '22023';
  end if;

  -- Every REQUIRED consent, accepted at the version that is published now. A
  -- form that posts without them is a form somebody bypassed.
  select count(*) into v_missing
    from public.consent_documents c
   where c.academy_id = v_academy
     and c.published_at is not null
     and c.retired_at is null
     and c.required
     and not exists (
       select 1 from jsonb_array_elements(coalesce(p_consents, '[]'::jsonb)) a
        where (a->>'id')::uuid = c.id
          and (a->>'version') = c.version::text
     );

  if v_missing > 0 then
    raise exception 'Please agree to the % required %.',
      v_missing, case when v_missing = 1 then 'document' else 'documents' end
      using errcode = '22023';
  end if;

  -- Full, and no waitlist. Checked last so a full program does not reveal
  -- itself before the easier rules have had their say.
  if app_private.program_spots_left(p_program) = 0 and not v_program.waitlist_enabled then
    raise exception 'That isn''t open for registrations.' using errcode = '22023';
  end if;

  return v_program.id;
end;
$fn$;

revoke execute on function public.check_registration(text, uuid, date, jsonb)
  from public, anon, authenticated;
grant execute on function public.check_registration(text, uuid, date, jsonb)
  to service_role;

create table if not exists public.registration_attempts (
  id         bigserial primary key,
  ip_hash    text not null,
  program_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists registration_attempts_recent_idx
  on public.registration_attempts (created_at);

alter table public.registration_attempts enable row level security;
-- No policies at all: the service role bypasses RLS and nobody else has any
-- business reading a table of hashed addresses.

/**
 * Too many, too fast?
 *
 * The same shape as check_join_rate, and the same reasoning: coach approval
 * already stops spam getting IN, and what still hurts is a queue nobody can
 * face — because the one real registration in it is the one that gets missed.
 *
 * The IP is hashed before it arrives here. This is a spam control, not a
 * record of who looked at a football club.
 */
create or replace function public.check_registration_rate(
  p_ip_hash text,
  p_program uuid
)
returns boolean
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_by_ip      integer;
  v_by_program integer;
begin
  delete from public.registration_attempts where created_at < now() - interval '24 hours';

  select count(*) into v_by_ip
    from public.registration_attempts
   where ip_hash = p_ip_hash and created_at > now() - interval '1 hour';

  select count(*) into v_by_program
    from public.registration_attempts
   where program_id = p_program and created_at > now() - interval '1 hour';

  insert into public.registration_attempts (ip_hash, program_id) values (p_ip_hash, p_program);

  -- A family with three children registering from one phone is normal, and
  -- so is a whole age group signing up the evening a flyer goes out. Twenty
  -- from one address in an hour is not.
  return v_by_ip >= 20 or v_by_program >= 200;
end;
$fn$;

revoke execute on function public.check_registration_rate(text, uuid)
  from public, anon, authenticated;
grant execute on function public.check_registration_rate(text, uuid) to service_role;

/**
 * The queue a club works through.
 *
 * Oldest first. A family who filled in a form on Monday and heard nothing by
 * Saturday has already decided what kind of club this is.
 */
create or replace function public.registration_queue(
  p_academy uuid default null,
  p_status  text default 'pending'
)
returns table (
  request_id    uuid,
  program_id    uuid,
  program_name  text,
  guardian_name text,
  guardian_phone text,
  guardian_email text,
  child_name    text,
  child_dob     date,
  child_gender  text,
  answers       jsonb,
  consents      jsonb,
  status        text,
  created_at    timestamptz,
  decided_by    text,
  decided_at    timestamptz,
  decision_note text,
  -- Whether this child looks like one already on the roster, so a second
  -- guardian registering the same child does not create a duplicate.
  existing_player_id uuid,
  spots_left    integer
)
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_academy uuid;
begin
  v_academy := app_private.my_academy(p_academy);
  if v_academy is null or not coalesce(app_private.is_academy_coach(v_academy), false) then
    return;
  end if;

  return query
  select
    q.id, q.program_id, p.name,
    q.guardian_name, q.guardian_phone, q.guardian_email,
    q.child_name, q.child_dob, q.child_gender,
    q.answers, q.consents, q.status, q.created_at,
    d.full_name, q.decided_at, q.decision_note,
    -- Name and date of birth together. Name alone would match a cousin.
    (select pl.id from public.players pl
      where pl.academy_id = v_academy
        and pl.dob = q.child_dob
        and lower(btrim(pl.full_name)) = lower(btrim(q.child_name))
      limit 1),
    app_private.program_spots_left(q.program_id)
  from public.registration_requests q
  join public.programs p on p.id = q.program_id
  left join public.profiles d on d.id = q.decided_by
  where q.academy_id = v_academy
    and (p_status is null or q.status = p_status)
    and q.expires_at > now()
  order by q.created_at;
end;
$fn$;

revoke execute on function public.registration_queue(uuid, text) from public, anon;
grant execute on function public.registration_queue(uuid, text) to authenticated;

/**
 * A request nobody decided.
 *
 * Expired rather than deleted: a club that is asked "we registered in March
 * and never heard back" needs to be able to find it. The secret stops
 * working either way, because `claim` checks the status.
 */
create or replace function public.expire_stale_registrations()
returns integer
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_n integer;
begin
  with gone as (
    update public.registration_requests
       set status = 'expired'
     where status = 'pending' and expires_at < now()
    returning 1
  )
  select count(*)::integer into v_n from gone;
  return v_n;
end;
$fn$;

revoke execute on function public.expire_stale_registrations()
  from public, anon, authenticated;
grant execute on function public.expire_stale_registrations() to service_role;
