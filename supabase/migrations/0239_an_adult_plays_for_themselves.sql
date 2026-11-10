-- 0239: an adult plays for themselves.
--
-- Joey, 10 Nov 2026, Part A fix 2: "remove the under-25 rule. Date of birth
-- must be in the past and under 100 years ago. Adult players are their own
-- member (no guardian). Fix the register form and the importer. Test a
-- 40-year-old over-35s player end to end: join, register, pay, chat, play."
--
-- What changes: the players table takes any date of birth in the past and
-- under a hundred years ago (the register form's rule follows); the three
-- 0215 guards that refuse a player's own account, login and squad place let
-- an ADULT through — someone whose own player record says they are 18 or
-- over — and keep refusing a child without a parent's approved login; every
-- reader that found a child only through player_guardians also finds the
-- person's own record (my_upcoming_events, my_rsvps_for_event, my_family,
-- my_offers, my_payment_requests, my_poll_votes; is_guardian_of already did).
-- A join link for an adult team takes a date of birth (join_requests.dob), and
-- a public registration can be for oneself (registration_requests.for_self).

-- ============================================================ the DOB rule

do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where contype = 'c' and conrelid = 'public.players'::regclass
       and pg_get_constraintdef(oid) ilike '%dob%interval%'
  loop
    execute format('alter table public.players drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.players add constraint players_dob_sane
  check (dob is null or (dob <= current_date and dob > current_date - interval '100 years'));

alter table public.join_requests add column if not exists dob date
  check (dob is null or (dob <= current_date and dob > current_date - interval '100 years'));
alter table public.registration_requests add column if not exists for_self boolean not null default false;

-- Is a team one with children in it? (The chat and DM rules for a team of
-- adults are the adult ones; any under-18 on the roster keeps the child
-- rules — Big Club Mode item 3.)
create or replace function app_private.team_has_minors(p_team uuid)
returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.players p
     where p.team_id = p_team
       and (p.dob is null or p.dob > current_date - interval '18 years'));
$fn$;
revoke execute on function app_private.team_has_minors(uuid) from public, anon, authenticated;

-- Is this person, here, an adult with a player record of their own?
create or replace function app_private.is_adult_player(p_academy uuid, p_profile uuid)
returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.players p
     where p.academy_id = p_academy and p.profile_id = p_profile
       and p.dob is not null and p.dob <= current_date - interval '18 years');
$fn$;
revoke execute on function app_private.is_adult_player(uuid, uuid) from public, anon, authenticated;

-- ================================================= the three 0215 guards

-- A player's own membership: an adult with their own record, or a teenager
-- with a parent's approved login. Nobody else.
create or replace function app_private.refuse_player_accounts()
returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if 'player' = any (coalesce(new.roles, array[new.role]))
     and not app_private.is_adult_player(new.academy_id, new.profile_id)
     and not exists (
    select 1
      from public.player_logins pl
      join public.players p on p.id = pl.player_id
     where pl.profile_id = new.profile_id
       and pl.status = 'approved'
       and p.academy_id = new.academy_id
       and app_private.is_thirteen(p.dob)
  ) then
    raise exception
      'A player''s own login needs them to be an adult, or 13 or over with a parent''s approval (My family). Add the player to the squad under Teams, and invite their parent instead.'
      using errcode = '42501';
  end if;
  return new;
end;
$fn$;

-- A player record linked to an account: the person's own, if they are an
-- adult; a teenager's, with the approved login; never a child's.
create or replace function app_private.refuse_player_logins()
returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if new.profile_id is not null
     and not (new.dob is not null and new.dob <= current_date - interval '18 years')
     and (
       not app_private.is_thirteen(new.dob)
       or not exists (
         select 1 from public.player_logins pl
          where pl.player_id = new.id and pl.profile_id = new.profile_id and pl.status = 'approved'
       )
     ) then
    raise exception
      'Under 13s never have their own login, and from 13 a login needs a parent''s approval (My family).'
      using errcode = '42501';
  end if;
  return new;
end;
$fn$;

-- A player's place in a squad: their own adult record on that squad, or a
-- parent-approved login for a teenager on it.
create or replace function app_private.refuse_squad_player_places()
returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if new.role = 'player'
     and not exists (
       select 1 from public.players p
        where p.profile_id = new.profile_id and p.team_id = new.team_id
          and p.dob is not null and p.dob <= current_date - interval '18 years')
     and not exists (
    select 1
      from public.player_logins pl
      join public.players p on p.id = pl.player_id
     where pl.profile_id = new.profile_id
       and pl.status = 'approved'
       and p.team_id = new.team_id
       and app_private.is_thirteen(p.dob)
  ) then
    raise exception 'A player''s place in a squad is their own adult record on it, or a login a parent has approved.'
      using errcode = '42501';
  end if;
  return new;
end;
$fn$;


-- ===================================================== the log, on a delete

-- Deleting an organisation cascades through its members, teams and streams,
-- and each AFTER DELETE logger then wrote a row for an organisation that was
-- already gone — a foreign-key failure that stopped the delete itself (found
-- by test-org-follows' tidy-up on dev). The log skips what no longer has an
-- organisation to belong to.
create or replace function app_private.log_activity(
  p_academy uuid, p_action text, p_kind text, p_id uuid, p_name text, p_detail jsonb default '{}'::jsonb
) returns void
language plpgsql volatile security definer set search_path = public as $fn$
begin
  if p_academy is null or not exists (select 1 from public.academies a where a.id = p_academy) then
    return;
  end if;
  insert into public.activity_log (academy_id, actor_id, action, subject_kind, subject_id, subject_name, detail)
  values (p_academy, auth.uid(), p_action, p_kind, p_id, left(p_name, 120), coalesce(p_detail, '{}'::jsonb));
end;
$fn$;

-- ======================================================== the readers
-- Generated from the live definitions: the guardian join becomes "their
-- own record, or a child they are guardian of".

-- my_upcoming_events (from 0056_screenshot_scans.sql): 2 guardian join(s) widened
create or replace function public.my_upcoming_events(
  p_academy uuid,
  p_days    integer default 30
)
returns table (
  id            uuid,
  type          public.event_type,
  title         text,
  starts_at     timestamptz,
  ends_at       timestamptz,
  arrive_at     timestamptz,
  venue         text,
  address       text,
  opponent      text,
  kit_colour    text,
  round         text,
  team_id       uuid,
  team_name     text,
  competition   text,
  cancelled_at  timestamptz,
  my_replies    integer,
  my_children   integer,
  going         integer,
  no_reply      integer,
  private_to    uuid,
  source        text,
  confirmed_at  timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    e.id, e.type, e.title, e.starts_at, e.ends_at, e.arrive_at,
    e.venue, e.address, e.opponent, e.kit_colour, e.round,
    e.team_id, t.name, c.name, e.cancelled_at,
    (select count(*)::integer
       from public.players pl
       join lateral (select 1) self_or_guardian on (pl.profile_id = auth.uid() or exists (select 1 from public.player_guardians pg where pg.player_id = pl.id and pg.profile_id = auth.uid()))
       join public.event_rsvps er on er.event_id = e.id and er.player_id = pl.id
      where pl.academy_id = e.academy_id and (e.team_id is null or pl.team_id = e.team_id)),
    (select count(*)::integer
       from public.players pl
       join lateral (select 1) self_or_guardian on (pl.profile_id = auth.uid() or exists (select 1 from public.player_guardians pg where pg.player_id = pl.id and pg.profile_id = auth.uid()))
      where pl.academy_id = e.academy_id and (e.team_id is null or pl.team_id = e.team_id)),
    case when app_private.is_event_coach(e.id) then s.going end,
    case when app_private.is_event_coach(e.id) then s.no_reply end,
    e.private_to, e.source, e.confirmed_at
  from public.events e
  left join public.teams t on t.id = e.team_id
  left join public.competitions c on c.id = e.competition_id
  left join lateral public.event_rsvp_summary(e.id) s on true
  where e.academy_id = p_academy
    and e.starts_at >= now() - interval '3 hours'
    and e.starts_at <  now() + (p_days || ' days')::interval
    and (e.private_to is null or e.private_to = auth.uid())
    and (e.team_id is null
         or app_private.is_team_member(e.team_id)
         or app_private.is_academy_coach(e.academy_id))
    and app_private.is_academy_member(p_academy)
  order by e.starts_at;
$$;

-- my_rsvps_for_event (from 0035_event_cards_in_chat.sql): 1 guardian join(s) widened
create or replace function public.my_rsvps_for_event(p_event uuid)
returns table (
  player_id   uuid,
  player_name text,
  status      public.rsvp_status,
  note        text
)
language sql stable security definer set search_path = public as $$
  select pl.id, pl.full_name, er.status, er.note
    from public.events e
    join public.players pl
      on pl.academy_id = e.academy_id
     and (e.team_id is null or pl.team_id = e.team_id)
    join lateral (select 1) self_or_guardian on (pl.profile_id = auth.uid() or exists (select 1 from public.player_guardians pg where pg.player_id = pl.id and pg.profile_id = auth.uid()))
    left join public.event_rsvps er
      on er.event_id = e.id and er.player_id = pl.id and er.profile_id = auth.uid()
   where e.id = p_event
     and app_private.can_read_event(p_event)
   order by pl.full_name;
$$;

-- my_poll_votes (from 0044_polls_in_chat.sql): 1 guardian join(s) widened
create or replace function public.my_poll_votes(p_poll uuid)
returns table (player_id uuid, player_name text, option_ids text[], note text)
language sql stable security definer set search_path = public as $$
  with p as (select * from public.polls where id = p_poll)
  select pl.id, pl.full_name, v.option_ids, v.note
    from p
    join public.channels c on c.id = p.channel_id
    join public.players pl
      on pl.academy_id = p.academy_id
     and (c.team_id is null or pl.team_id = c.team_id)
    join lateral (select 1) self_or_guardian on (pl.profile_id = auth.uid() or exists (select 1 from public.player_guardians pg where pg.player_id = pl.id and pg.profile_id = auth.uid()))
    left join public.poll_votes v
      on v.poll_id = p_poll and v.player_id = pl.id and v.profile_id = auth.uid()
   where p.type = 'availability'
     and app_private.is_channel_member(p.channel_id)
  union all
  select null, null, v.option_ids, v.note
    from p
    left join public.poll_votes v
      on v.poll_id = p_poll and v.profile_id = auth.uid() and v.player_id is null
   where p.type <> 'availability'
     and app_private.is_channel_member(p.channel_id);
$$;

-- my_payment_requests (from 0227_pay_later_by_a_day.sql): 1 guardian join(s) widened
create or replace function public.my_payment_requests(p_academy uuid)
returns table(request_id uuid, title text, description text, amount_cents integer, currency text, due_on date, closes_at timestamptz, team_name text, player_id uuid, player_name text, status text, paid_at timestamptz, can_pay boolean, voucher_cents integer, voucher_label text, promised_by date)
language sql stable security definer set search_path = public as $$
  with mine as (
    select pl.id, pl.full_name, pl.team_id
      from public.players pl
      join lateral (select 1) self_or_guardian on (pl.profile_id = auth.uid() or exists (select 1 from public.player_guardians pg where pg.player_id = pl.id and pg.profile_id = auth.uid()))
     where pl.academy_id = p_academy
  )
  select
    r.id, r.title, r.description, r.amount_cents, r.currency, r.due_on, r.closes_at,
    coalesce(t.name, pg2.name),
    case when r.per_player then m.id end,
    case when r.per_player then m.full_name end,
    coalesce(p.status, 'unpaid'),
    p.paid_at,
    coalesce(b.charges_enabled, false),
    app_private.voucher_cents(r.id, case when r.per_player then m.id end),
    (select v.label from public.voucher_redemptions vr join public.vouchers v on v.id = vr.voucher_id
      where vr.request_id = r.id and vr.player_id is not distinct from (case when r.per_player then m.id end) limit 1),
    (select pp.by_date from public.payment_promises pp
      where pp.request_id = r.id and pp.player_id is not distinct from (case when r.per_player then m.id end))
  from public.payment_requests r
  left join public.teams t on t.id = r.team_id
  left join public.programs pg2 on pg2.id = r.program_id
  left join public.academy_billing b on b.academy_id = r.academy_id
  left join mine m
    on r.per_player
   and (r.team_id is null or m.team_id = r.team_id)
   and (r.program_id is null or app_private.is_in_program(r.program_id, m.id))
  left join public.payments p
    on p.request_id = r.id
   and p.player_id is not distinct from (case when r.per_player then m.id end)
 where r.academy_id = p_academy
   and r.archived_at is null
   and (r.closes_at is null or r.closes_at > now())
   and (r.team_id is null or app_private.is_team_member(r.team_id))
   and (not r.per_player or m.id is not null)
   and (r.program_id is null or exists (
         select 1 from mine m2 where app_private.is_in_program(r.program_id, m2.id)))
   and app_private.is_academy_member(p_academy)
 order by r.due_on nulls last, r.created_at, m.full_name;
$$;

-- my_offers (from 0221_last_seasons_players_are_offered_their_places.sql): their own offer too
create or replace function public.my_offers()
returns jsonb
language sql stable security definer set search_path = public as $fn$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',               o.id,
           'kind',             o.kind,
           'player_id',        o.player_id,
           'player',           pl.full_name,
           'squad_program',    sp.name,
           'squad_program_id', sp.id,
           'squad',            (select t.name from public.teams t where t.id = sp.team_id),
           'season',           sp.season,
           'trial',            tp.name,
           'fee_cents',        (select pr.amount_cents from public.payment_requests pr where pr.program_id = sp.id and pr.archived_at is null limit 1),
           'expires_at',       o.expires_at,
           'state',            app_private.offer_state(o.status, o.expires_at),
           'decided_at',       o.decided_at,
           'registration_id',  o.registration_id,
           'registration_status', (select r.status from public.program_registrations r where r.id = o.registration_id)
         ) order by o.expires_at), '[]'::jsonb)
    from public.offers o
    join public.players pl on pl.id = o.player_id
    join public.programs sp on sp.id = o.squad_program_id
    left join public.program_registrations tr on tr.id = o.trial_registration_id
    left join public.programs tp on tp.id = tr.program_id
   where exists (select 1 from public.player_guardians pg where pg.player_id = o.player_id and pg.profile_id = auth.uid())
      or exists (select 1 from public.players sp where sp.id = o.player_id and sp.profile_id = auth.uid());
$fn$;

-- check_registration (from 0122_a_family_who_has_never_heard_of_us.sql): the hundred-year rule
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

  -- A date of birth in the future, or a 100-year-old, is a typo in a field
  -- that decides eligibility. (Adults register too since 0239.)
  if p_child_dob > (current_date at time zone 'utc')::date
     or p_child_dob < (current_date at time zone 'utc')::date - interval '100 years' then
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

-- my_family (from 0137_registered_with_playfootball_or_not_yet.sql): the person's own record, relationship 'self'
create or replace function public.my_family()
returns jsonb
language sql stable security definer set search_path = public as $fn$
  select coalesce(jsonb_agg(child order by child->>'full_name'), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'id',              pl.id,
               'academy_id',      pl.academy_id,
               'club',            a.name,
               'full_name',       pl.full_name,
               'preferred_name',  pl.preferred_name,
               'dob',             pl.dob,
               'gender',          pl.gender,
               'school',          pl.school,
               'ff_number',       pl.ff_number,
               'official_status', pl.official_status,
               'relationship',    coalesce(pg.relationship, 'self'),
               'kit', jsonb_build_object(
                 'shirt',  pl.shirt_size,
                 'shorts', pl.shorts_size,
                 'socks',  pl.socks_size
               ),
               'squad', (
                 select jsonb_build_object('id', t.id, 'name', t.name, 'season', t.season)
                   from public.teams t where t.id = pl.team_id
               ),
               'number', (
                 select sn.number
                   from public.squad_numbers sn
                  where sn.player_id = pl.id
                  order by (sn.season = (select t.season from public.teams t where t.id = pl.team_id)) desc,
                           sn.created_at desc
                  limit 1
               ),
               'medical', (
                 select jsonb_build_object(
                          'conditions',         m.conditions,
                          'allergies',          m.allergies,
                          'medications',        m.medications,
                          'dietary',            m.dietary,
                          'emergency_name',     m.emergency_name,
                          'emergency_phone',    m.emergency_phone,
                          'emergency_relation', m.emergency_relation,
                          'doctor_name',        m.doctor_name,
                          'doctor_phone',       m.doctor_phone,
                          'first_aid_consent',  m.first_aid_consent
                        )
                   from public.player_medical m where m.player_id = pl.id
               ),
               'consents', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'document_id', d.id,
                          'title',       d.title,
                          'kind',        d.kind,
                          'version',     d.version,
                          'required',    d.required,
                          'accepted',    ans.accepted,
                          'accepted_at', ans.accepted_at,
                          'mine',        ans.profile_id = auth.uid()
                        ) order by d.required desc, d.title)
                   from public.consent_documents d
                   left join lateral (
                     select ca.accepted, ca.accepted_at, ca.profile_id
                       from public.consent_acceptances ca
                      where ca.document_id = d.id and ca.player_id = pl.id
                      order by (ca.accepted = false) desc, ca.accepted_at desc
                      limit 1
                   ) ans on true
                  where d.academy_id = pl.academy_id
                    and d.published_at is not null
                    and d.retired_at is null
               ), '[]'::jsonb)
             ) as child
        from public.players pl
        join public.academies a on a.id = pl.academy_id
        left join public.player_guardians pg on pg.player_id = pl.id and pg.profile_id = auth.uid()
       where pg.profile_id is not null or pl.profile_id = auth.uid()
    ) s;
$fn$;
