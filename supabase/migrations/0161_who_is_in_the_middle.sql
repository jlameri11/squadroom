-- 0161: who is in the middle.
--
-- L-06. A league's Saturday does not happen without referees, and the
-- referee secretary's week is spent on exactly four questions: who can I
-- use, who is free, did they say yes, and did they turn up. Dribl answers
-- none of them for junior leagues, so it is a spreadsheet, a WhatsApp
-- group and a phone call at 7am.
--
-- THE POOL BELONGS TO THE ORGANISATION, not the competition: the SPL's
-- referees do its U8s and its Premier League. A referee is a row with a
-- name and a grade; a person claims it with a link (the way a parent
-- claims a team link) and from then on sees their own games. A referee
-- is NOT a member of the league in the membership sense — they see their
-- appointments, their block-outs, and nothing of anyone's children.
--
-- AVAILABLE UNLESS BLOCKED. Referees say when they are NOT free (a
-- weekend away, an exam); everything else is fair to ask. Asking is what
-- an appointment is: it is OFFERED, and the referee accepts or declines
-- from a push. The organiser sees availability per game — free, blocked,
-- or already on another pitch at the same time — before they ask.
--
-- CHECK-IN is the referee's own tap at the ground, in a window around
-- kick-off, because "did the ref show" is the question that decides a
-- forfeit. The REPORT is theirs too — score, conduct, incidents — kept
-- with the appointment, where the organiser rules on a dispute (0151).
--
-- PHONE NUMBERS: the pool's phones are readable by the league's staff and
-- the referee themselves. A club sees a name on the run sheet, not a
-- number. Same rule as every other person in the product.

-- ---------------------------------------------------------------------
-- The pool
-- ---------------------------------------------------------------------
create table if not exists public.referees (
  id           uuid primary key default gen_random_uuid(),
  academy_id   uuid not null references public.academies(id) on delete cascade,
  profile_id   uuid references public.profiles(id) on delete set null,
  full_name    text not null check (length(btrim(full_name)) > 0),
  phone        text,
  grade        text,
  status       text not null default 'active' check (status in ('active', 'inactive')),
  -- A link the referee opens once, like a team link. Twelve random bytes,
  -- the same strength as join_links.
  claim_token  text not null unique default encode(gen_random_bytes(12), 'hex'),
  claimed_at   timestamptz,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint referees_once_per_pool unique (academy_id, profile_id)
);
alter table public.referees enable row level security;
create policy referees_select on public.referees for select to authenticated
  using ((select app_private.is_academy_staff(referees.academy_id)) or profile_id = (select auth.uid()));
create policy referees_insert on public.referees for insert to authenticated
  with check ((select app_private.is_academy_staff(referees.academy_id)));
create policy referees_update on public.referees for update to authenticated
  using ((select app_private.is_academy_staff(referees.academy_id)));
create policy referees_delete on public.referees for delete to authenticated
  using ((select app_private.is_academy_staff(referees.academy_id)));
create index if not exists referees_profile_idx on public.referees (profile_id) where profile_id is not null;

-- The referee's own view of the row, used by policies on the tables below.
create or replace function app_private.is_this_referee(p_referee uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce((
    select r.profile_id = auth.uid() from public.referees r where r.id = p_referee
  ), false);
$fn$;

create or replace function app_private.referee_pool_of(p_referee uuid)
returns uuid language sql stable security definer set search_path = public as $fn$
  select academy_id from public.referees where id = p_referee;
$fn$;

-- ---------------------------------------------------------------------
-- When they are NOT free
-- ---------------------------------------------------------------------
create table if not exists public.referee_blockouts (
  id          uuid primary key default gen_random_uuid(),
  referee_id  uuid not null references public.referees(id) on delete cascade,
  academy_id  uuid not null references public.academies(id) on delete cascade,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  reason      text,
  created_at  timestamptz not null default now(),
  constraint referee_blockouts_order check (ends_at > starts_at)
);
alter table public.referee_blockouts enable row level security;
create policy referee_blockouts_select on public.referee_blockouts for select to authenticated
  using ((select app_private.is_academy_staff(referee_blockouts.academy_id))
         or (select app_private.is_this_referee(referee_blockouts.referee_id)));
create policy referee_blockouts_insert on public.referee_blockouts for insert to authenticated
  with check (academy_id = (select app_private.referee_pool_of(referee_blockouts.referee_id))
              and ((select app_private.is_academy_staff(referee_blockouts.academy_id))
                   or (select app_private.is_this_referee(referee_blockouts.referee_id))));
create policy referee_blockouts_delete on public.referee_blockouts for delete to authenticated
  using ((select app_private.is_academy_staff(referee_blockouts.academy_id))
         or (select app_private.is_this_referee(referee_blockouts.referee_id)));
create index if not exists referee_blockouts_when_idx on public.referee_blockouts (referee_id, starts_at, ends_at);

-- ---------------------------------------------------------------------
-- Appointments
-- ---------------------------------------------------------------------
do $$ begin
  create type public.referee_role as enum ('referee', 'assistant', 'fourth');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.appointment_status as enum ('offered', 'accepted', 'declined', 'withdrawn');
exception when duplicate_object then null; end $$;

create table if not exists public.referee_appointments (
  id              uuid primary key default gen_random_uuid(),
  competition_id  uuid not null references public.competitions(id) on delete cascade,
  fixture_id      uuid not null references public.fixtures(id) on delete cascade,
  referee_id      uuid not null references public.referees(id) on delete cascade,
  academy_id      uuid not null references public.academies(id) on delete cascade,
  role            public.referee_role not null default 'referee',
  status          public.appointment_status not null default 'offered',
  offered_by      uuid references public.profiles(id) on delete set null,
  offered_at      timestamptz not null default now(),
  responded_at    timestamptz,
  response_note   text,
  withdrawn_note  text,
  checked_in_at   timestamptz,
  report          jsonb,
  reported_at     timestamptz,
  -- L-07 fills this in; kept here so a payment run has one row per game.
  fee_cents       integer check (fee_cents is null or fee_cents >= 0),
  created_at      timestamptz not null default now(),
  constraint referee_appointments_once unique (fixture_id, referee_id)
);
alter table public.referee_appointments enable row level security;
-- Clubs in the competition see who is appointed (a name on the run sheet);
-- the referee sees their own. Every write goes through a function.
create policy referee_appointments_select on public.referee_appointments for select to authenticated
  using ((select app_private.is_competition_participant(referee_appointments.competition_id))
         or (select app_private.is_this_referee(referee_appointments.referee_id)));
create index if not exists referee_appointments_fixture_idx on public.referee_appointments (fixture_id, status);
create index if not exists referee_appointments_referee_idx on public.referee_appointments (referee_id, status);

alter table public.notification_queue
  drop constraint if exists notification_queue_kind_check;
alter table public.notification_queue
  add constraint notification_queue_kind_check
  check (kind = any (array[
    'message', 'announcement', 'event_reminder', 'poll_opened', 'poll_closing',
    'rsvp_change', 'invite', 'event_cancelled', 'event_changed', 'event_back_on',
    'rsvp_nudge', 'announcement_repeat', 'wwcc_expiring', 'guardian_erased',
    'official_rego_pending', 'reregister_nudge', 'offer',
    'referee_appointment', 'referee_response', 'referee_withdrawn'
  ]));

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------

-- The window a game occupies for clash purposes: kick-off to full time
-- plus half an hour to get across a ground.
create or replace function app_private.fixture_window(p_fixture uuid)
returns tstzrange language sql stable security definer set search_path = public as $fn$
  select tstzrange(f.starts_at,
                   f.starts_at + make_interval(mins => coalesce(r.match_length_mins, 60) + 30),
                   '[)')
    from public.fixtures f
    cross join lateral app_private.division_rules(f.competition_id, f.division) r
   where f.id = p_fixture and f.starts_at is not null;
$fn$;

-- Why a referee cannot take a game, or null when they can.
create or replace function app_private.referee_unavailable_reason(p_referee uuid, p_fixture uuid)
returns text language plpgsql stable security definer set search_path = public as $fn$
declare
  v_window tstzrange := app_private.fixture_window(p_fixture);
  v_reason text;
  v_other  text;
begin
  if v_window is null then
    return null;
  end if;
  select coalesce(nullif(b.reason, ''), 'not available') into v_reason
    from public.referee_blockouts b
   where b.referee_id = p_referee
     and tstzrange(b.starts_at, b.ends_at, '[)') && v_window
   limit 1;
  if v_reason is not null then
    return 'blocked out: ' || v_reason;
  end if;
  select h.display_name || ' v ' || a.display_name into v_other
    from public.referee_appointments ap
    join public.fixtures f on f.id = ap.fixture_id
    left join public.competition_entries h on h.id = f.home_entry_id
    left join public.competition_entries a on a.id = f.away_entry_id
   where ap.referee_id = p_referee
     and ap.fixture_id <> p_fixture
     and ap.status in ('offered', 'accepted')
     and app_private.fixture_window(f.id) && v_window
   limit 1;
  if v_other is not null then
    return 'already on ' || v_other;
  end if;
  return null;
end;
$fn$;

-- ---------------------------------------------------------------------
-- The pool: add, claim, list
-- ---------------------------------------------------------------------
create or replace function public.add_referee(
  p_competition uuid, p_full_name text, p_phone text default null, p_grade text default null, p_profile uuid default null
)
returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  v_academy uuid;
  v_id uuid;
begin
  select organiser_id into v_academy from public.competitions where id = p_competition;
  if v_academy is null or not app_private.is_competition_organiser(p_competition) then
    raise exception 'only the organiser keeps the referee pool' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_full_name, ''))) = 0 then
    raise exception 'a referee needs a name' using errcode = '22023';
  end if;
  insert into public.referees (academy_id, profile_id, full_name, phone, grade, claimed_at, created_by)
  values (v_academy, p_profile, btrim(p_full_name), nullif(btrim(coalesce(p_phone, '')), ''),
          nullif(btrim(coalesce(p_grade, '')), ''),
          case when p_profile is not null then now() end, auth.uid())
  returning id into v_id;
  return v_id;
end;
$fn$;

-- The referee opens their link, signed in, and the row becomes theirs.
create or replace function public.claim_referee(p_token text)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_me uuid := auth.uid();
  v_row public.referees;
begin
  if v_me is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  select * into v_row from public.referees where claim_token = p_token;
  if v_row.id is null then
    raise exception 'that link is not a referee link' using errcode = '22023';
  end if;
  if v_row.profile_id is not null and v_row.profile_id <> v_me then
    raise exception 'that link has already been used by somebody else' using errcode = '42501';
  end if;
  if v_row.profile_id is null then
    -- One row per person per pool: a second link for the same person
    -- folds into their existing row rather than failing on the constraint.
    if exists (select 1 from public.referees r where r.academy_id = v_row.academy_id and r.profile_id = v_me) then
      raise exception 'you are already in this pool' using errcode = '23505';
    end if;
    update public.referees
       set profile_id = v_me, claimed_at = now(),
           full_name = coalesce(nullif((select full_name from public.profiles where id = v_me), ''), full_name)
     where id = v_row.id;
  end if;
  return jsonb_build_object(
    'id', v_row.id,
    'league', (select name from public.academies where id = v_row.academy_id)
  );
end;
$fn$;

-- The organiser's pool for a competition, with each referee's load.
create or replace function public.referee_pool(p_competition uuid)
returns jsonb
language sql stable security definer set search_path = public as $fn$
  select case
    when not app_private.is_competition_organiser(p_competition) then null
    else coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id,
               'full_name', r.full_name,
               'phone', r.phone,
               'grade', r.grade,
               'status', r.status,
               'claimed', r.profile_id is not null,
               'claim_token', case when r.profile_id is null then r.claim_token end,
               'upcoming', (select count(*) from public.referee_appointments ap
                             join public.fixtures f on f.id = ap.fixture_id
                            where ap.referee_id = r.id and ap.status in ('offered', 'accepted')
                              and f.starts_at >= now()),
               'games', (select count(*) from public.referee_appointments ap
                          join public.fixtures f on f.id = ap.fixture_id
                         where ap.referee_id = r.id and ap.status = 'accepted' and ap.checked_in_at is not null),
               'declined', (select count(*) from public.referee_appointments ap
                             where ap.referee_id = r.id and ap.status = 'declined'),
               'blockouts', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'starts_at', b.starts_at, 'ends_at', b.ends_at, 'reason', b.reason) order by b.starts_at)
                                       from public.referee_blockouts b where b.referee_id = r.id and b.ends_at >= now()), '[]'::jsonb)
             ) order by r.status, r.full_name)
        from public.referees r
       where r.academy_id = (select organiser_id from public.competitions where id = p_competition)
    ), '[]'::jsonb)
  end;
$fn$;

-- Who could take this game: every active referee in the pool, with the
-- reason they cannot, if there is one.
create or replace function public.referee_availability(p_fixture uuid)
returns jsonb
language sql stable security definer set search_path = public as $fn$
  select case
    when not app_private.is_competition_organiser((select competition_id from public.fixtures where id = p_fixture)) then null
    else coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id,
               'full_name', r.full_name,
               'grade', r.grade,
               'claimed', r.profile_id is not null,
               'unavailable', app_private.referee_unavailable_reason(r.id, p_fixture),
               'already', (select ap.status::text from public.referee_appointments ap
                            where ap.fixture_id = p_fixture and ap.referee_id = r.id)
             ) order by (app_private.referee_unavailable_reason(r.id, p_fixture) is null) desc, r.full_name)
        from public.referees r
       where r.status = 'active'
         and r.academy_id = (select c.organiser_id from public.fixtures f
                               join public.competitions c on c.id = f.competition_id
                              where f.id = p_fixture)
    ), '[]'::jsonb)
  end;
$fn$;

-- ---------------------------------------------------------------------
-- Appoint, respond, withdraw, check in, report
-- ---------------------------------------------------------------------
create or replace function public.appoint_referee(p_fixture uuid, p_referee uuid, p_role public.referee_role default 'referee')
returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  v_fx   public.fixtures;
  v_ref  public.referees;
  v_org  uuid;
  v_why  text;
  v_id   uuid;
  v_home text;
  v_away text;
begin
  select * into v_fx from public.fixtures where id = p_fixture;
  if v_fx.id is null or not app_private.is_competition_organiser(v_fx.competition_id) then
    raise exception 'only the organiser appoints referees' using errcode = '42501';
  end if;
  if v_fx.status not in ('scheduled', 'in_progress') or v_fx.starts_at is null then
    raise exception 'that game is not on, or has no kick-off time yet' using errcode = '22023';
  end if;
  select organiser_id into v_org from public.competitions where id = v_fx.competition_id;
  select * into v_ref from public.referees where id = p_referee;
  if v_ref.id is null or v_ref.academy_id <> v_org then
    raise exception 'that referee is not in this league''s pool' using errcode = '22023';
  end if;
  if v_ref.status <> 'active' then
    raise exception '% is not active in the pool', v_ref.full_name using errcode = '22023';
  end if;
  v_why := app_private.referee_unavailable_reason(p_referee, p_fixture);
  if v_why is not null then
    raise exception '% is %', v_ref.full_name, v_why using errcode = '22023';
  end if;
  if p_role = 'referee' and exists (
    select 1 from public.referee_appointments ap
     where ap.fixture_id = p_fixture and ap.role = 'referee' and ap.status in ('offered', 'accepted')
  ) then
    raise exception 'that game already has a referee — withdraw them first' using errcode = '23505';
  end if;

  select h.display_name, a.display_name into v_home, v_away
    from public.fixtures f
    left join public.competition_entries h on h.id = f.home_entry_id
    left join public.competition_entries a on a.id = f.away_entry_id
   where f.id = p_fixture;

  insert into public.referee_appointments (competition_id, fixture_id, referee_id, academy_id, role, offered_by)
  values (v_fx.competition_id, p_fixture, p_referee, v_org, p_role, auth.uid())
  on conflict (fixture_id, referee_id) do update
    set role = excluded.role, status = 'offered', offered_by = excluded.offered_by, offered_at = now(),
        responded_at = null, response_note = null, withdrawn_note = null
  returning id into v_id;

  if v_ref.profile_id is not null then
    insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload, dedupe_key)
    values (v_org, v_ref.profile_id, 'referee_appointment',
            'Can you ' || case p_role when 'referee' then 'referee' when 'assistant' then 'run the line at' else 'be fourth official at' end
              || ' ' || coalesce(v_home, 'TBC') || ' v ' || coalesce(v_away, 'TBC') || '?',
            to_char(v_fx.starts_at at time zone 'Australia/Sydney', 'FMDay FMDD Mon, FMHH12:MIam')
              || coalesce(' · ' || nullif(coalesce((select name from public.venues where id = v_fx.venue_id), v_fx.venue_label), ''), '')
              || coalesce(' ' || v_fx.field_label, ''),
            '/referee',
            jsonb_build_object('appointment_id', v_id, 'fixture_id', p_fixture),
            'ref-appt-' || v_id || '-' || extract(epoch from now())::bigint);
  end if;
  return v_id;
end;
$fn$;

create or replace function public.respond_appointment(p_appointment uuid, p_accept boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_ap  public.referee_appointments;
  v_ref public.referees;
  v_home text; v_away text; v_when timestamptz;
begin
  select * into v_ap from public.referee_appointments where id = p_appointment;
  if v_ap.id is null or not app_private.is_this_referee(v_ap.referee_id) then
    raise exception 'that appointment is not yours' using errcode = '42501';
  end if;
  if v_ap.status = 'withdrawn' then
    raise exception 'that appointment was withdrawn' using errcode = '22023';
  end if;
  update public.referee_appointments
     set status = case when p_accept then 'accepted' else 'declined' end::public.appointment_status,
         responded_at = now(),
         response_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_appointment;

  select * into v_ref from public.referees where id = v_ap.referee_id;
  select h.display_name, a.display_name, f.starts_at into v_home, v_away, v_when
    from public.fixtures f
    left join public.competition_entries h on h.id = f.home_entry_id
    left join public.competition_entries a on a.id = f.away_entry_id
   where f.id = v_ap.fixture_id;
  if v_ap.offered_by is not null then
    insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload, dedupe_key)
    values (v_ap.academy_id, v_ap.offered_by, 'referee_response',
            v_ref.full_name || case when p_accept then ' accepted ' else ' declined ' end
              || coalesce(v_home, 'TBC') || ' v ' || coalesce(v_away, 'TBC'),
            to_char(v_when at time zone 'Australia/Sydney', 'FMDay FMDD Mon, FMHH12:MIam')
              || coalesce(' — ' || nullif(btrim(coalesce(p_note, '')), ''), ''),
            '/competitions/' || v_ap.competition_id,
            jsonb_build_object('appointment_id', p_appointment, 'fixture_id', v_ap.fixture_id, 'accepted', p_accept),
            'ref-resp-' || p_appointment || '-' || extract(epoch from now())::bigint);
  end if;
end;
$fn$;

create or replace function public.withdraw_appointment(p_appointment uuid, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_ap  public.referee_appointments;
  v_ref public.referees;
  v_home text; v_away text; v_when timestamptz;
begin
  select * into v_ap from public.referee_appointments where id = p_appointment;
  if v_ap.id is null or not app_private.is_competition_organiser(v_ap.competition_id) then
    raise exception 'only the organiser withdraws an appointment' using errcode = '42501';
  end if;
  update public.referee_appointments
     set status = 'withdrawn', withdrawn_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_appointment;
  select * into v_ref from public.referees where id = v_ap.referee_id;
  if v_ref.profile_id is not null and v_ap.status in ('offered', 'accepted') then
    select h.display_name, a.display_name, f.starts_at into v_home, v_away, v_when
      from public.fixtures f
      left join public.competition_entries h on h.id = f.home_entry_id
      left join public.competition_entries a on a.id = f.away_entry_id
     where f.id = v_ap.fixture_id;
    insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload, dedupe_key)
    values (v_ap.academy_id, v_ref.profile_id, 'referee_withdrawn',
            'You are no longer on ' || coalesce(v_home, 'TBC') || ' v ' || coalesce(v_away, 'TBC'),
            to_char(v_when at time zone 'Australia/Sydney', 'FMDay FMDD Mon, FMHH12:MIam')
              || coalesce(' — ' || nullif(btrim(coalesce(p_note, '')), ''), ''),
            '/referee',
            jsonb_build_object('appointment_id', p_appointment, 'fixture_id', v_ap.fixture_id),
            'ref-wd-' || p_appointment || '-' || extract(epoch from now())::bigint);
  end if;
end;
$fn$;

-- At the ground: three hours before kick-off to two hours after.
create or replace function public.referee_check_in(p_appointment uuid)
returns timestamptz
language plpgsql security definer set search_path = public as $fn$
declare
  v_ap public.referee_appointments;
  v_ko timestamptz;
begin
  select * into v_ap from public.referee_appointments where id = p_appointment;
  if v_ap.id is null or not app_private.is_this_referee(v_ap.referee_id) then
    raise exception 'that appointment is not yours' using errcode = '42501';
  end if;
  if v_ap.status <> 'accepted' then
    raise exception 'accept the appointment before checking in' using errcode = '22023';
  end if;
  select starts_at into v_ko from public.fixtures where id = v_ap.fixture_id;
  if v_ko is null or now() < v_ko - interval '3 hours' or now() > v_ko + interval '2 hours' then
    raise exception 'check-in opens three hours before kick-off' using errcode = '22023';
  end if;
  update public.referee_appointments set checked_in_at = coalesce(checked_in_at, now()) where id = p_appointment;
  return (select checked_in_at from public.referee_appointments where id = p_appointment);
end;
$fn$;

-- The referee's report, after kick-off. Free shape, but the keys the UI
-- writes are: home_score, away_score, conduct, incidents, pitch, notes.
create or replace function public.submit_referee_report(p_appointment uuid, p_report jsonb)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_ap public.referee_appointments;
  v_ko timestamptz;
begin
  select * into v_ap from public.referee_appointments where id = p_appointment;
  if v_ap.id is null or not app_private.is_this_referee(v_ap.referee_id) then
    raise exception 'that appointment is not yours' using errcode = '42501';
  end if;
  if v_ap.status <> 'accepted' then
    raise exception 'only an accepted appointment has a report' using errcode = '22023';
  end if;
  select starts_at into v_ko from public.fixtures where id = v_ap.fixture_id;
  if v_ko is null or now() < v_ko then
    raise exception 'the report comes after the game' using errcode = '22023';
  end if;
  if jsonb_typeof(p_report) <> 'object' then
    raise exception 'a report is an object' using errcode = '22023';
  end if;
  update public.referee_appointments set report = p_report, reported_at = now() where id = p_appointment;
end;
$fn$;

-- ---------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------

-- The referee's own page: their pools, their games, their block-outs.
create or replace function public.my_appointments()
returns jsonb
language sql stable security definer set search_path = public as $fn$
  select jsonb_build_object(
    'pools', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'league', a.name, 'grade', r.grade, 'status', r.status) order by a.name)
        from public.referees r join public.academies a on a.id = r.academy_id
       where r.profile_id = auth.uid()
    ), '[]'::jsonb),
    'appointments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', ap.id,
               'role', ap.role,
               'status', ap.status,
               'offered_at', ap.offered_at,
               'checked_in_at', ap.checked_in_at,
               'reported_at', ap.reported_at,
               'report', ap.report,
               'withdrawn_note', ap.withdrawn_note,
               'fixture_id', f.id,
               'starts_at', f.starts_at,
               'fixture_status', f.status,
               'competition', c.name,
               'competition_id', c.id,
               'league', a.name,
               'division', f.division,
               'round', f.round,
               'venue', coalesce(v.name, f.venue_label),
               'address', v.address,
               'field', f.field_label,
               'home', h.display_name,
               'away', aw.display_name,
               'home_score', f.home_score,
               'away_score', f.away_score
             ) order by f.starts_at desc nulls last)
        from public.referee_appointments ap
        join public.referees r on r.id = ap.referee_id
        join public.fixtures f on f.id = ap.fixture_id
        join public.competitions c on c.id = f.competition_id
        join public.academies a on a.id = ap.academy_id
        left join public.venues v on v.id = f.venue_id
        left join public.competition_entries h on h.id = f.home_entry_id
        left join public.competition_entries aw on aw.id = f.away_entry_id
       where r.profile_id = auth.uid()
    ), '[]'::jsonb),
    'blockouts', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'referee_id', b.referee_id, 'starts_at', b.starts_at, 'ends_at', b.ends_at, 'reason', b.reason) order by b.starts_at)
        from public.referee_blockouts b
        join public.referees r on r.id = b.referee_id
       where r.profile_id = auth.uid() and b.ends_at >= now() - interval '30 days'
    ), '[]'::jsonb)
  );
$fn$;

-- The competition's games with who is on them. Participants and the
-- organiser; the report body only for the organiser.
create or replace function public.competition_appointments(p_competition uuid, p_division text default null)
returns jsonb
language sql stable security definer set search_path = public as $fn$
  select case
    when not app_private.is_competition_participant(p_competition) then null
    else jsonb_build_object(
      'fixtures', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'fixture_id', f.id,
                 'starts_at', f.starts_at,
                 'division', f.division,
                 'round', f.round,
                 'venue', coalesce(v.name, f.venue_label),
                 'field', f.field_label,
                 'status', f.status,
                 'home', h.display_name,
                 'away', aw.display_name,
                 'appointments', coalesce((
                   select jsonb_agg(jsonb_build_object(
                            'id', ap.id,
                            'referee_id', ap.referee_id,
                            'name', r.full_name,
                            'grade', r.grade,
                            'claimed', r.profile_id is not null,
                            'role', ap.role,
                            'status', ap.status,
                            'response_note', ap.response_note,
                            'checked_in_at', ap.checked_in_at,
                            'reported_at', ap.reported_at,
                            'report', case when app_private.is_competition_organiser(p_competition) then ap.report end
                          ) order by ap.role, ap.offered_at)
                     from public.referee_appointments ap
                     join public.referees r on r.id = ap.referee_id
                    where ap.fixture_id = f.id and ap.status <> 'withdrawn'
                 ), '[]'::jsonb)
               ) order by f.starts_at nulls last, f.field_label)
          from public.fixtures f
          left join public.venues v on v.id = f.venue_id
          left join public.competition_entries h on h.id = f.home_entry_id
          left join public.competition_entries aw on aw.id = f.away_entry_id
         where f.competition_id = p_competition
           and (p_division is null or f.division = p_division)
           and f.status in ('scheduled', 'in_progress', 'final', 'forfeit')
      ), '[]'::jsonb),
      -- Per referee across the competition, for the organiser's eye and
      -- L-15's export: offered, accepted, declined, turned up, reported.
      'summary', case when app_private.is_competition_organiser(p_competition) then coalesce((
        select jsonb_agg(jsonb_build_object(
                 'referee_id', s.referee_id, 'name', s.name, 'grade', s.grade,
                 'offered', s.offered, 'accepted', s.accepted, 'declined', s.declined,
                 'checked_in', s.checked_in, 'reported', s.reported
               ) order by s.name)
          from (
            -- Grouped first: an aggregate cannot sit inside another.
            select r.id as referee_id, r.full_name as name, r.grade,
                   count(*) filter (where ap.status = 'offered')         as offered,
                   count(*) filter (where ap.status = 'accepted')        as accepted,
                   count(*) filter (where ap.status = 'declined')        as declined,
                   count(*) filter (where ap.checked_in_at is not null)  as checked_in,
                   count(*) filter (where ap.reported_at is not null)    as reported
              from public.referee_appointments ap
              join public.referees r on r.id = ap.referee_id
             where ap.competition_id = p_competition
             group by r.id, r.full_name, r.grade
          ) s
      ), '[]'::jsonb) else '[]'::jsonb end
    )
  end;
$fn$;

-- The run sheet carries the referee's name, so a club manager knows who
-- to look for. Return type changes, so drop and recreate (as 0156 did).
drop function if exists public.competition_run_sheet(uuid, text);
create function public.competition_run_sheet(p_competition uuid, p_division text default null)
returns table (
  fixture_id    uuid,
  starts_at     timestamptz,
  field_label   text,
  division      text,
  group_label   text,
  round         text,
  home_name     text,
  away_name     text,
  home_score    integer,
  away_score    integer,
  status        public.fixture_status,
  can_score     boolean,
  home_entry_id uuid,
  away_entry_id uuid,
  referees      text
)
language sql stable security definer set search_path = public as $$
  select
    f.id, f.starts_at, f.field_label, f.division, f.group_label, f.round,
    h.display_name, a.display_name,
    f.home_score, f.away_score, f.status,
    (app_private.is_competition_organiser(f.competition_id)
      or app_private.can_manage_entry(f.home_entry_id)
      or app_private.can_manage_entry(f.away_entry_id)),
    f.home_entry_id, f.away_entry_id,
    (select string_agg(
              r.full_name || case ap.role when 'referee' then '' when 'assistant' then ' (AR)' else ' (4th)' end
                || case ap.status when 'offered' then '?' else '' end,
              ', ' order by ap.role, r.full_name)
       from public.referee_appointments ap
       join public.referees r on r.id = ap.referee_id
      where ap.fixture_id = f.id and ap.status in ('offered', 'accepted'))
  from public.fixtures f
  left join public.competition_entries h on h.id = f.home_entry_id
  left join public.competition_entries a on a.id = f.away_entry_id
  where f.competition_id = p_competition
    and (p_division is null or f.division = p_division)
    and app_private.is_competition_participant(f.competition_id)
  order by f.starts_at, f.field_label;
$$;

grant execute on function public.competition_run_sheet(uuid, text) to authenticated;
grant execute on function public.add_referee(uuid, text, text, text, uuid) to authenticated;
grant execute on function public.claim_referee(text) to authenticated;
grant execute on function public.referee_pool(uuid) to authenticated;
grant execute on function public.referee_availability(uuid) to authenticated;
grant execute on function public.appoint_referee(uuid, uuid, public.referee_role) to authenticated;
grant execute on function public.respond_appointment(uuid, boolean, text) to authenticated;
grant execute on function public.withdraw_appointment(uuid, text) to authenticated;
grant execute on function public.referee_check_in(uuid) to authenticated;
grant execute on function public.submit_referee_report(uuid, jsonb) to authenticated;
grant execute on function public.my_appointments() to authenticated;
grant execute on function public.competition_appointments(uuid, text) to authenticated;
