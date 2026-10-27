-- 0120: S-03. Nobody stands in front of children without a current clearance.
--
-- The last P1 safeguarding gap, and the one defect in this product that is
-- not recoverable after the fact. Everything else here can be fixed with an
-- apology.
--
-- NSW Working With Children Check: a number, an expiry, and — the part that
-- is easy to skip — a record of WHO verified it and WHEN. There is no OCG
-- API, so verification is a human reading the Employer Portal. That makes the
-- audit trail the entire control: "we checked" is worthless without a name
-- and a date beside it.
--
-- PER ACADEMY, not per person, which is the one real design decision here.
-- A clearance number belongs to a person, so one row per profile looks
-- tidier. But the VERIFICATION is an act by an employer, each employer must
-- do it, and each one's record is its own legal document — two clubs may have
-- checked on different days and seen different things. Per-academy also keeps
-- the row tenant-scoped, which is what every policy in this schema depends
-- on; a profile-level table would need a policy that reasons about which
-- academies a person currently coaches at, and that is exactly the kind of
-- cross-tenant read this schema has no other example of.
--
-- THE GATE HAS NO SETTING. Everything else in this product can be turned off
-- because everything else is someone else's business. A club that could
-- switch this off would switch it off on the Saturday they were short a
-- coach, and nobody would find out until it mattered.

do $$ begin
  create type public.clearance_kind as enum (
    'wwcc',       -- a Working With Children Check
    'exemption'   -- a NSW teacher or police officer, exempt but still recorded
  );
exception when duplicate_object then null; end $$;

do $$ begin
  -- The words the Employer Portal actually uses, so a club admin is copying
  -- rather than translating. A status we invented would be a status somebody
  -- maps wrongly.
  create type public.clearance_outcome as enum (
    'cleared',
    'applied',    -- application lodged; NSW permits work once the employer
                  -- has verified the application number
    'barred',
    'not_found'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.staff_clearances (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,

  kind        public.clearance_kind not null default 'wwcc',
  -- As printed. Not normalised or validated against a format, because the
  -- format has changed before and a club that cannot record the number it is
  -- looking at will record it somewhere we cannot see.
  number      text not null,
  outcome     public.clearance_outcome not null,

  -- NOT NULL, deliberately, including for an exemption and for an
  -- application. A record with no date is a record that never expires, and a
  -- clearance that never expires is the hole this table exists to close — a
  -- teacher's exemption still gets a review date, and an 'applied' row gets
  -- a date by which somebody has to look again.
  expires_on  date not null,

  verified_by uuid not null references public.profiles(id),
  verified_at timestamptz not null default now(),
  note        text,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- One current record per person per academy. A history table would be
  -- better and is not what today needs; re-verifying replaces the row and
  -- `verified_at` says when.
  constraint staff_clearances_unique unique (academy_id, profile_id),
  -- The composite shape the rest of this schema uses, so a child table later
  -- cannot point at a clearance from another tenant.
  constraint staff_clearances_id_academy_key unique (id, academy_id)
);

create index if not exists staff_clearances_expiry_idx
  on public.staff_clearances (academy_id, expires_on);

alter table public.staff_clearances enable row level security;

-- Visible to academy staff only. A clearance number is a government
-- identifier attached to a named adult: a parent has no reason to read it,
-- and "the coach is verified" is a fact the directory can show without it.
create policy staff_clearances_select on public.staff_clearances
  for select to authenticated
  using ((select app_private.is_academy_staff(academy_id)));

-- Written through record_clearance only. A direct insert would skip the
-- self-verification check, which is the control that matters most.
create policy staff_clearances_insert on public.staff_clearances
  for insert to authenticated with check (false);
create policy staff_clearances_update on public.staff_clearances
  for update to authenticated using (false);
-- A verification record is a record. A club that can delete its clearance
-- history has no clearance history.
create policy staff_clearances_delete on public.staff_clearances
  for delete to authenticated using (false);

/**
 * Is this person cleared to work with children at this academy, today?
 *
 * The single definition. Three screens and two triggers ask it, and three
 * copies of "cleared or applied, and not expired" is three places for the
 * next person to forget the 'barred' case.
 *
 * coalesce, because a non-member produces NULL and `if not NULL` never fires
 * — the three-valued-logic hole 0092 was written to close, and the one place
 * it would be least acceptable to repeat.
 */
create or replace function app_private.has_current_clearance(
  p_academy uuid,
  p_profile uuid
)
returns boolean
language sql stable security definer set search_path = public as $fn$
  select coalesce((
    select c.outcome in ('cleared', 'applied')
       and c.expires_on >= (current_date at time zone 'utc')::date
      from public.staff_clearances c
     where c.academy_id = p_academy and c.profile_id = p_profile
  ), false);
$fn$;

-- ---------------------------------------------------------------------------
-- The gate
-- ---------------------------------------------------------------------------

/**
 * A team coach is the person standing in front of the children.
 *
 * No exemption, not even for the owner. This is the assertion the whole
 * migration exists to make, and an exception for the most senior person is
 * an exception for exactly the person nobody else will question.
 *
 * Fires on new writes only. Existing coaches are untouched, which is
 * deliberate: a trigger that invalidated today's roster would take a club's
 * Saturday away to make a point, and the backlog is surfaced by
 * `clearance_board` instead so a club can work through it.
 */
create or replace function public.require_a_clearance()
returns trigger
language plpgsql set search_path = public as $fn$
begin
  if new.role = 'coach'
     and not app_private.has_current_clearance(new.academy_id, new.profile_id) then
    raise exception 'That person has no current Working With Children Check recorded. Record it under Admin → Working With Children Checks first.'
      using errcode = '42501';
  end if;
  return new;
end;
$fn$;

drop trigger if exists team_members_require_clearance on public.team_members;
create trigger team_members_require_clearance
  before insert or update of role, profile_id on public.team_members
  for each row execute function public.require_a_clearance();

/**
 * Academy staff see every child's name, date of birth and medical notes, so
 * admin is child-related work too.
 *
 * OWNER IS EXEMPT HERE, and only here. The first owner of a new academy has
 * nobody to verify them — refusing the role would make creating an academy
 * impossible, and a product that cannot be started is not a safer product.
 * The exemption is safe because the place it actually matters is gated
 * above with no exemption at all: an unverified owner can run the club and
 * cannot be put in front of a team.
 */
create or replace function public.require_a_clearance_for_staff()
returns trigger
language plpgsql set search_path = public as $fn$
begin
  if new.role in ('coach', 'admin')
     and new.status = 'active'
     and not app_private.has_current_clearance(new.academy_id, new.profile_id) then
    raise exception 'That person has no current Working With Children Check recorded. Record it under Admin → Working With Children Checks first.'
      using errcode = '42501';
  end if;
  return new;
end;
$fn$;

drop trigger if exists academy_members_require_clearance on public.academy_members;
create trigger academy_members_require_clearance
  before insert or update of role, status, profile_id on public.academy_members
  for each row execute function public.require_a_clearance_for_staff();

-- ---------------------------------------------------------------------------
-- Recording one
-- ---------------------------------------------------------------------------

/**
 * Write down what the Employer Portal said.
 *
 * NOBODY VERIFIES THEMSELVES. That is the control; everything else here is
 * bookkeeping. A coach who can type their own clearance number and mark it
 * cleared has not been checked, they have been asked, and the audit trail
 * would say "verified by" and name the person it was meant to protect
 * children from.
 *
 * A platform admin may, because the first owner of a new academy has nobody
 * else to do it and the alternative is an academy that can never put its own
 * founder in front of a team. That is us, during onboarding, and it is
 * recorded under our name.
 */
create or replace function public.record_clearance(
  p_academy    uuid,
  p_profile    uuid,
  p_number     text,
  p_outcome    public.clearance_outcome,
  p_expires_on date,
  p_kind       public.clearance_kind default 'wwcc',
  p_note       text default null
)
returns uuid
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_me       uuid := auth.uid();
  v_platform boolean;
  v_id       uuid;
begin
  if v_me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  v_platform := exists (select 1 from public.platform_admins pa where pa.profile_id = v_me);

  if not (coalesce(app_private.is_academy_staff(p_academy), false) or v_platform) then
    raise exception 'only a club admin can record a clearance' using errcode = '42501';
  end if;

  if p_profile = v_me and not v_platform then
    raise exception 'Somebody else has to verify yours — a check you entered for yourself is not a check'
      using errcode = '42501';
  end if;

  if nullif(btrim(coalesce(p_number, '')), '') is null then
    raise exception 'The clearance number is what makes this a record' using errcode = '22023';
  end if;

  -- A date in the past is either a typo or a lapsed clearance being recorded
  -- as current. Both are refused, because the gate reads this date.
  if p_outcome in ('cleared', 'applied')
     and p_expires_on < (current_date at time zone 'utc')::date then
    raise exception 'That date has already passed' using errcode = '22023';
  end if;

  -- The person has to be at this academy. Without this, a clearance could be
  -- recorded against a stranger's profile id and would sit there satisfying
  -- a gate nobody could see.
  if not exists (
    select 1 from public.academy_members am
     where am.academy_id = p_academy and am.profile_id = p_profile
  ) then
    raise exception 'That person is not at this academy' using errcode = '22023';
  end if;

  insert into public.staff_clearances (
    academy_id, profile_id, kind, number, outcome, expires_on, verified_by, note
  ) values (
    p_academy, p_profile, p_kind, btrim(p_number), p_outcome, p_expires_on, v_me,
    nullif(btrim(coalesce(p_note, '')), '')
  )
  on conflict (academy_id, profile_id) do update
    set kind = excluded.kind,
        number = excluded.number,
        outcome = excluded.outcome,
        expires_on = excluded.expires_on,
        verified_by = excluded.verified_by,
        verified_at = now(),
        note = excluded.note,
        updated_at = now()
  returning id into v_id;

  return v_id;
end;
$fn$;

revoke execute on function public.record_clearance(
  uuid, uuid, text, public.clearance_outcome, date, public.clearance_kind, text
) from public, anon;
grant execute on function public.record_clearance(
  uuid, uuid, text, public.clearance_outcome, date, public.clearance_kind, text
) to authenticated;

/**
 * Everyone who needs one, and where they stand.
 *
 * Built from the PEOPLE rather than from the clearances, so somebody with no
 * record at all appears — which is the whole point. A screen listing
 * clearances shows a club its paperwork; a screen listing staff shows it the
 * gap.
 */
create or replace function public.clearance_board(p_academy uuid default null)
returns table (
  profile_id  uuid,
  full_name   text,
  academy_role public.academy_role,
  coaches     text,
  number      text,
  kind        public.clearance_kind,
  outcome     public.clearance_outcome,
  expires_on  date,
  days_left   integer,
  state       text,
  verified_by text,
  verified_at timestamptz
)
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_academy uuid;
begin
  v_academy := app_private.my_academy(p_academy);
  if v_academy is null or not coalesce(app_private.is_academy_staff(v_academy), false) then
    return;
  end if;

  return query
  select
    am.profile_id,
    p.full_name,
    am.role,
    -- Which squads they coach. A missing clearance for somebody in front of
    -- a team is a different problem from a missing one for the treasurer.
    (select string_agg(t.name, ', ' order by t.name)
       from public.team_members tm
       join public.teams t on t.id = tm.team_id and t.status = 'active'
      where tm.academy_id = v_academy and tm.profile_id = am.profile_id
        and tm.role = 'coach'),
    c.number,
    c.kind,
    c.outcome,
    c.expires_on,
    case when c.expires_on is null then null
         else (c.expires_on - (current_date at time zone 'utc')::date) end,
    -- One word a club admin can sort by. 'barred' is its own state rather
    -- than lumped in with missing, because they call for opposite actions.
    case
      when c.id is null then 'missing'
      when c.outcome = 'barred' then 'barred'
      when c.outcome = 'not_found' then 'not_found'
      when c.expires_on < (current_date at time zone 'utc')::date then 'expired'
      when c.expires_on < (current_date at time zone 'utc')::date + 60 then 'expiring'
      when c.outcome = 'applied' then 'applied'
      else 'current'
    end,
    v.full_name,
    c.verified_at
  from public.academy_members am
  join public.profiles p on p.id = am.profile_id
  left join public.staff_clearances c
    on c.academy_id = am.academy_id and c.profile_id = am.profile_id
  left join public.profiles v on v.id = c.verified_by
  where am.academy_id = v_academy
    and am.status = 'active'
    and am.role in ('owner', 'admin', 'coach')
  order by
    -- Worst first. A board that opens on the people who are fine is a board
    -- nobody scrolls.
    case
      when c.outcome = 'barred' then 0
      when c.id is null then 1
      when c.expires_on < (current_date at time zone 'utc')::date then 2
      when c.expires_on < (current_date at time zone 'utc')::date + 60 then 3
      else 4
    end,
    p.full_name;
end;
$fn$;

revoke execute on function public.clearance_board(uuid) from public, anon;
grant execute on function public.clearance_board(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Telling somebody before it lapses
-- ---------------------------------------------------------------------------

alter table public.notification_queue
  drop constraint if exists notification_queue_kind_check;

alter table public.notification_queue
  add constraint notification_queue_kind_check
  check (kind = any (array[
    'message',
    'announcement',
    'event_reminder',
    'poll_opened',
    'poll_closing',
    'rsvp_change',
    'invite',
    'event_cancelled',
    'event_changed',
    'event_back_on',
    'rsvp_nudge',
    'announcement_repeat',
    -- 0120. Added in the same migration as the sender, because 0109 shipped
    -- two kinds the constraint did not know about and every nudge failed.
    'wwcc_expiring'
  ]));

/**
 * Warn the club 60 days out, and keep warning.
 *
 * Sixty days because renewing is not instant and a coach who finds out the
 * week before misses games. It goes to the OWNERS AND ADMINS, not the coach:
 * the club carries the legal duty, and a reminder only the person affected
 * sees is a reminder that stops when they ignore it.
 *
 * Re-sent every 14 days rather than once, because the one notification that
 * matters is the one nobody saw. Rate limited in here rather than by the
 * caller, so running the sweep twice tells nobody twice — the same lesson as
 * the RSVP nudge.
 */
create or replace function public.queue_clearance_warnings()
returns integer
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_sent integer := 0;
begin
  with due as (
    select c.academy_id, c.profile_id, c.expires_on, p.full_name,
           (c.expires_on - (current_date at time zone 'utc')::date) as days_left
      from public.staff_clearances c
      join public.profiles p on p.id = c.profile_id
      join public.academy_members am
        on am.academy_id = c.academy_id and am.profile_id = c.profile_id
       and am.status = 'active' and am.role in ('owner', 'admin', 'coach')
     where c.outcome in ('cleared', 'applied')
       and c.expires_on <= (current_date at time zone 'utc')::date + 60
  ),
  recipients as (
    select d.*, am.profile_id as tell
      from due d
      join public.academy_members am
        on am.academy_id = d.academy_id
       and am.status = 'active'
       and am.role in ('owner', 'admin')
  ),
  fresh as (
    select r.* from recipients r
     where not exists (
       select 1 from public.notification_queue n
        where n.kind = 'wwcc_expiring'
          and n.profile_id = r.tell
          and n.payload->>'subject_id' = r.profile_id::text
          and n.created_at > now() - interval '14 days'
     )
  ),
  queued as (
    insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload)
    select
      f.academy_id,
      f.tell,
      'wwcc_expiring',
      case when f.days_left < 0 then 'A coach''s check has expired'
           else 'A coach''s check is running out' end,
      f.full_name || ' — ' ||
      case when f.days_left < 0 then 'expired ' || abs(f.days_left) || ' days ago'
           when f.days_left = 0 then 'expires today'
           else 'expires in ' || f.days_left || ' days' end,
      '/admin/clearances',
      jsonb_build_object('subject_id', f.profile_id, 'expires_on', f.expires_on)
    from fresh f
    returning 1
  )
  select count(*)::integer into v_sent from queued;

  return v_sent;
end;
$fn$;

revoke execute on function public.queue_clearance_warnings() from public, anon, authenticated;

-- Once a day, early. An expiry is a date, not an event: checking every five
-- minutes would wake the push sender for nothing 288 times a day, which is
-- the mistake the reminder cron already made once and had half the Netlify
-- allowance eaten by.
select cron.unschedule('queue-clearance-warnings')
 where exists (select 1 from cron.job where jobname = 'queue-clearance-warnings');

select cron.schedule(
  'queue-clearance-warnings',
  '15 19 * * *',  -- 19:15 UTC is 06:15 in Sydney
  $cron$select public.queue_clearance_warnings()$cron$
);
