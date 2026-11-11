-- 0253: safety and compliance — coaching accreditation with an expiry, and
-- an incident or injury report from the ground.
--
-- Big Club Mode item 11 (Joey, 9 Nov 2026): "WWCC (exists) + coaching
-- accreditation with expiry; reminders 30 days out to the person and the
-- club; expired staff flagged and removed from coaching roles with children
-- until renewed; incident/injury report from the ground (who, what, when,
-- first aid given) → Welfare officer and President; the officer's contact
-- in every family's Settings; 'Welfare' in the UI."
--
-- What already holds: a Working With Children Check is one record per
-- person (0120), a lapsed check is no check (0169: no coaching rights until
-- renewed), the warnings go 60 days out to the club, the Welfare officer's
-- contact is in every family's Settings (0241). New here: an accreditation
-- is a second kind of record — several per person (a licence per course),
-- its own table rather than a row the check's table cannot hold — with its
-- own warnings 30 days out to the person AND the club. A lapsed
-- accreditation is flagged and named on the board; it does not take a
-- coach's rights away, because the check is what protects children and a
-- course certificate is not. An incident report is its own record, read by
-- the Welfare officer and the President (and the person who filed it), and
-- told to them the moment it is filed, as a reported concern is.

-- ---------------------------------------------------------------------------
-- 1. A new kind of notification.
-- ---------------------------------------------------------------------------
do $$ begin
  alter table public.notification_queue drop constraint if exists notification_queue_kind_check;
  alter table public.notification_queue add constraint notification_queue_kind_check check (kind = any (array[
    'message', 'announcement', 'event_reminder', 'poll_opened', 'poll_closing', 'rsvp_change', 'invite',
    'event_cancelled', 'event_changed', 'event_back_on', 'rsvp_nudge', 'announcement_repeat', 'wwcc_expiring',
    'guardian_erased', 'official_rego_pending', 'reregister_nudge', 'offer', 'referee_appointment',
    'referee_response', 'referee_withdrawn', 'fixture_change_proposed', 'fixture_change_answered',
    'fixture_change_decided', 'mention', 'match_correction_requested', 'match_correction_decided',
    'fixture_flowing_open', 'discipline_warning', 'discipline_suspension', 'forfeit_request', 'forfeit_decided',
    'nomination', 'fee_due', 'fee_overdue', 'player_report', 'player_clip', 'selected', 'not_selected',
    'match_day', 'support_reply', 'match_video', 'match_photos', 'photo_hidden', 'helpers_wanted',
    'helper_reminder', 'helper_changed', 'report_filed', 'team_published', 'team_sheet_due', 'accreditation_expiring']));
end $$;

-- ---------------------------------------------------------------------------
-- 2. Accreditation: a course certificate with a date, several per person.
-- ---------------------------------------------------------------------------
create table if not exists public.staff_accreditations (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  title       text not null check (char_length(btrim(title)) between 1 and 80),
  number      text check (number is null or char_length(number) <= 60),
  expires_on  date not null,
  note        text check (note is null or char_length(note) <= 300),
  verified_by uuid not null references public.profiles(id),
  verified_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  constraint staff_accreditations_once unique (academy_id, profile_id, title)
);
create index if not exists staff_accreditations_due_idx on public.staff_accreditations (academy_id, expires_on);
alter table public.staff_accreditations enable row level security;
-- The staff read the board; a person reads their own.
drop policy if exists staff_accreditations_select on public.staff_accreditations;
create policy staff_accreditations_select on public.staff_accreditations
  for select to authenticated
  using ((select app_private.is_academy_staff(academy_id)) or profile_id = (select auth.uid()));

create or replace function public.record_accreditation(
  p_academy uuid, p_profile uuid, p_title text, p_expires_on date, p_number text default null, p_note text default null
)
returns uuid
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if not coalesce(app_private.is_academy_staff(p_academy), false) then
    raise exception 'only a club owner or admin records an accreditation' using errcode = '42501';
  end if;
  if p_profile = auth.uid() then
    raise exception 'somebody else has to record yours — a certificate you entered for yourself is not a record' using errcode = '42501';
  end if;
  if not exists (select 1 from public.academy_members m where m.academy_id = p_academy and m.profile_id = p_profile and m.status = 'active') then
    raise exception 'that person is not at this club' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null then
    raise exception 'which course' using errcode = '22023';
  end if;
  if p_expires_on is null or p_expires_on < current_date - interval '5 years' then
    raise exception 'when it runs out' using errcode = '22023';
  end if;
  insert into public.staff_accreditations (academy_id, profile_id, title, number, expires_on, note, verified_by)
  values (p_academy, p_profile, btrim(p_title), nullif(btrim(coalesce(p_number, '')), ''), p_expires_on, nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  on conflict (academy_id, profile_id, title) do update
    set number = excluded.number, expires_on = excluded.expires_on, note = excluded.note,
        verified_by = excluded.verified_by, verified_at = now()
  returning id into v_id;
  perform app_private.log_activity(p_academy, 'accreditation_recorded', 'profile', p_profile,
                                   (select p.full_name from public.profiles p where p.id = p_profile),
                                   jsonb_build_object('title', btrim(p_title), 'expires_on', p_expires_on));
  return v_id;
end;
$fn$;
revoke execute on function public.record_accreditation(uuid, uuid, text, date, text, text) from public, anon;
grant execute on function public.record_accreditation(uuid, uuid, text, date, text, text) to authenticated;

create or replace function public.remove_accreditation(p_accreditation uuid)
returns void
language plpgsql volatile security definer set search_path = public as $fn$
declare
  a public.staff_accreditations;
begin
  select * into a from public.staff_accreditations where id = p_accreditation;
  if a.id is null then
    raise exception 'no such record' using errcode = '22023';
  end if;
  if not coalesce(app_private.is_academy_staff(a.academy_id), false) then
    raise exception 'only a club owner or admin removes an accreditation' using errcode = '42501';
  end if;
  delete from public.staff_accreditations where id = p_accreditation;
  perform app_private.log_activity(a.academy_id, 'accreditation_removed', 'profile', a.profile_id,
                                   (select p.full_name from public.profiles p where p.id = a.profile_id),
                                   jsonb_build_object('title', a.title));
end;
$fn$;
revoke execute on function public.remove_accreditation(uuid) from public, anon;
grant execute on function public.remove_accreditation(uuid) to authenticated;

-- The board: every staff member and coach, their accreditations, worst
-- first. Owners and admins.
create or replace function public.accreditation_board(p_academy uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_academy uuid;
  v_today date := (current_date at time zone 'utc')::date;
begin
  v_academy := app_private.my_academy(p_academy);
  if v_academy is null or not coalesce(app_private.is_academy_staff(v_academy), false) then
    return null;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'profile_id', am.profile_id, 'name', p.full_name, 'role', am.role,
             'coaches', (select string_agg(t.name, ', ' order by t.name) from public.team_members tm join public.teams t on t.id = tm.team_id and t.status = 'active'
                          where tm.academy_id = v_academy and tm.profile_id = am.profile_id and tm.role = 'coach'),
             'accreditations', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'id', a.id, 'title', a.title, 'number', a.number, 'expires_on', a.expires_on,
                        'days_left', a.expires_on - v_today,
                        'state', case when a.expires_on < v_today then 'expired' when a.expires_on < v_today + 30 then 'expiring' else 'current' end,
                        'verified_by', (select v.full_name from public.profiles v where v.id = a.verified_by),
                        'verified_at', a.verified_at, 'note', a.note)
                      order by a.expires_on)
                 from public.staff_accreditations a where a.academy_id = v_academy and a.profile_id = am.profile_id), '[]'::jsonb))
           order by
             case when exists (select 1 from public.staff_accreditations a where a.academy_id = v_academy and a.profile_id = am.profile_id and a.expires_on < v_today) then 0
                  when exists (select 1 from public.staff_accreditations a where a.academy_id = v_academy and a.profile_id = am.profile_id and a.expires_on < v_today + 30) then 1
                  when exists (select 1 from public.staff_accreditations a where a.academy_id = v_academy and a.profile_id = am.profile_id) then 3
                  else 2 end,
             p.full_name)
      from public.academy_members am
      join public.profiles p on p.id = am.profile_id
     where am.academy_id = v_academy and am.status = 'active' and am.role in ('owner', 'admin', 'coach')), '[]'::jsonb);
end;
$fn$;
revoke execute on function public.accreditation_board(uuid) from public, anon;
grant execute on function public.accreditation_board(uuid) to authenticated;

-- Thirty days out, and then every fortnight until renewed: the person, and
-- the club's owners and admins. Daily, after the check warnings.
create or replace function public.queue_accreditation_warnings()
returns integer
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_sent integer := 0;
  v_today date := (current_date at time zone 'utc')::date;
begin
  with due as (
    select a.id, a.academy_id, a.profile_id, a.title, a.expires_on, p.full_name,
           (a.expires_on - v_today) as days_left
      from public.staff_accreditations a
      join public.profiles p on p.id = a.profile_id
      join public.academy_members am
        on am.academy_id = a.academy_id and am.profile_id = a.profile_id
       and am.status = 'active' and am.role in ('owner', 'admin', 'coach')
     where a.expires_on <= v_today + 30
  ),
  recipients as (
    select d.*, d.profile_id as tell, true as own from due d
    union all
    select d.*, am.profile_id as tell, false as own
      from due d
      join public.academy_members am
        on am.academy_id = d.academy_id and am.status = 'active' and am.role in ('owner', 'admin')
       and am.profile_id <> d.profile_id
  ),
  fresh as (
    select r.* from recipients r
     where not exists (
       select 1 from public.notification_queue n
        where n.kind = 'accreditation_expiring'
          and n.profile_id = r.tell
          and n.payload->>'accreditation_id' = r.id::text
          and n.created_at > now() - interval '14 days'
     )
  ),
  queued as (
    insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload)
    select f.academy_id, f.tell, 'accreditation_expiring',
           case when f.own then
                  case when f.days_left < 0 then 'Your ' || f.title || ' has expired' else 'Your ' || f.title || ' is running out' end
                else
                  case when f.days_left < 0 then 'A coach''s accreditation has expired' else 'A coach''s accreditation is running out' end
           end,
           case when f.own then '' else f.full_name || ' — ' || f.title || ' ' end ||
           case when f.days_left < 0 then 'expired ' || abs(f.days_left) || ' days ago'
                when f.days_left = 0 then 'expires today'
                else 'expires in ' || f.days_left || ' days' end
           || case when f.own then '. Renew it and tell the club.' else '.' end,
           case when f.own then '/settings' else '/admin/clearances' end,
           jsonb_build_object('accreditation_id', f.id, 'subject_id', f.profile_id, 'expires_on', f.expires_on)
      from fresh f
    returning 1
  )
  select count(*)::integer into v_sent from queued;
  return v_sent;
end;
$fn$;
revoke execute on function public.queue_accreditation_warnings() from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.queue_accreditation_warnings() to service_role;
  end if;
end $$;
select cron.unschedule('queue-accreditation-warnings')
 where exists (select 1 from cron.job where jobname = 'queue-accreditation-warnings');
select cron.schedule(
  'queue-accreditation-warnings',
  '20 19 * * *',  -- 19:20 UTC is 06:20 in Sydney, after the check warnings
  $cron$select public.queue_accreditation_warnings()$cron$
);

-- ---------------------------------------------------------------------------
-- 3. An incident or injury, reported from the ground.
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.incident_status as enum ('open', 'reviewed');
exception when duplicate_object then null; end $$;

create table if not exists public.incident_reports (
  id            uuid primary key default gen_random_uuid(),
  academy_id    uuid not null references public.academies(id) on delete cascade,
  event_id      uuid,
  team_id       uuid,
  reported_by   uuid not null references public.profiles(id) on delete cascade,
  occurred_at   timestamptz not null default now(),
  -- Who: a player on the roster, or a name typed (a spectator, a visitor).
  player_id     uuid,
  who           text check (who is null or char_length(who) <= 120),
  what          text not null check (char_length(btrim(what)) between 1 and 2000),
  first_aid     text check (first_aid is null or char_length(first_aid) <= 1000),
  ambulance     boolean not null default false,
  parent_told   boolean not null default false,
  status        public.incident_status not null default 'open',
  outcome       text,
  reviewed_by   uuid references public.profiles(id) on delete set null,
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now(),
  constraint incident_reports_event_fkey foreign key (event_id, academy_id) references public.events (id, academy_id) on delete set null,
  constraint incident_reports_player_fkey foreign key (player_id, academy_id) references public.players (id, academy_id) on delete set null
);
create index if not exists incident_reports_academy_idx on public.incident_reports (academy_id, status, created_at desc);
alter table public.incident_reports enable row level security;
-- The Welfare officer and the President (0241's officers), and whoever filed it.
drop policy if exists incident_reports_select on public.incident_reports;
create policy incident_reports_select on public.incident_reports
  for select to authenticated
  using ((select app_private.is_safeguarding_officer(academy_id)) or reported_by = (select auth.uid()));

-- Who files: the squad's coach or manager, the staff, whoever runs volunteers
-- (the field marshal), from a game or on its own.
create or replace function public.file_incident_report(
  p_academy uuid, p_what text, p_event uuid default null, p_player uuid default null, p_who text default null,
  p_occurred_at timestamptz default null, p_first_aid text default null, p_ambulance boolean default false, p_parent_told boolean default false
)
returns uuid
language plpgsql volatile security definer set search_path = public as $fn$
declare
  e    public.events;
  v_id uuid;
  v_team uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_event is not null then
    select * into e from public.events where id = p_event and academy_id = p_academy;
    if e.id is null then
      raise exception 'that game is not this club''s' using errcode = '22023';
    end if;
    v_team := e.team_id;
  end if;
  if not (coalesce(app_private.is_academy_coach(p_academy), false)
          or coalesce(app_private.may_run_club(p_academy, 'volunteers'), false)
          or (v_team is not null and coalesce(app_private.is_team_coach(v_team), false))) then
    raise exception 'an incident is reported by the squad''s coach or manager, the club''s staff or a field marshal' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_what, '')), '') is null then
    raise exception 'say what happened' using errcode = '22023';
  end if;
  if p_player is not null and not exists (select 1 from public.players pl where pl.id = p_player and pl.academy_id = p_academy) then
    raise exception 'that player is not this club''s' using errcode = '22023';
  end if;
  insert into public.incident_reports (academy_id, event_id, team_id, reported_by, occurred_at, player_id, who, what, first_aid, ambulance, parent_told)
  values (p_academy, p_event, v_team, auth.uid(), coalesce(p_occurred_at, now()), p_player,
          nullif(btrim(coalesce(p_who, '')), ''), btrim(p_what), nullif(btrim(coalesce(p_first_aid, '')), ''),
          coalesce(p_ambulance, false), coalesce(p_parent_told, false))
  returning id into v_id;
  return v_id;
end;
$fn$;
revoke execute on function public.file_incident_report(uuid, text, uuid, uuid, text, timestamptz, text, boolean, boolean) from public, anon;
grant execute on function public.file_incident_report(uuid, text, uuid, uuid, text, timestamptz, text, boolean, boolean) to authenticated;

-- Told to the Welfare officer and the President the moment it is filed, as
-- a reported concern is (0241); the one trigger function serves all three.
create or replace function app_private.tell_welfare_of_report()
returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  v_title text := case tg_table_name
                    when 'conduct_reports' then 'A concern was reported'
                    when 'incident_reports' then 'An incident was reported'
                    else 'A message was reported' end;
  v_url text := '/admin/safeguarding';
begin
  insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload, scheduled_for, dedupe_key)
  select new.academy_id, w.profile_id, 'report_filed', v_title,
         'For the Welfare officer and the President. Open it when you can; it is seen by nobody else.',
         v_url,
         jsonb_build_object('report', tg_table_name, 'id', new.id),
         now(),
         'report:' || tg_table_name || ':' || new.id::text || ':' || w.profile_id::text
    from app_private.welfare_people(new.academy_id) w
   where w.profile_id is distinct from new.reported_by
  on conflict (dedupe_key) do nothing;
  return null;
end;
$fn$;
drop trigger if exists incident_reports_tell_welfare on public.incident_reports;
create trigger incident_reports_tell_welfare
  after insert on public.incident_reports
  for each row execute function app_private.tell_welfare_of_report();

-- The register, for the Welfare officer and the President.
create or replace function public.incident_register(p_academy uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_academy uuid;
begin
  v_academy := app_private.my_academy(p_academy);
  if v_academy is null or not coalesce(app_private.is_safeguarding_officer(v_academy), false) then
    return null;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', r.id, 'status', r.status, 'occurred_at', r.occurred_at, 'created_at', r.created_at,
             'what', r.what, 'who', coalesce((select pl.full_name from public.players pl where pl.id = r.player_id), r.who),
             'player_id', r.player_id, 'first_aid', r.first_aid, 'ambulance', r.ambulance, 'parent_told', r.parent_told,
             'event', (select jsonb_build_object('id', e.id, 'title', e.title, 'starts_at', e.starts_at, 'venue', e.venue) from public.events e where e.id = r.event_id),
             'team', (select t.name from public.teams t where t.id = r.team_id),
             'reported_by', (select p.full_name from public.profiles p where p.id = r.reported_by),
             'outcome', r.outcome, 'reviewed_by', (select p.full_name from public.profiles p where p.id = r.reviewed_by), 'reviewed_at', r.reviewed_at)
           order by r.created_at desc)
      from public.incident_reports r where r.academy_id = v_academy), '[]'::jsonb);
end;
$fn$;
revoke execute on function public.incident_register(uuid) from public, anon;
grant execute on function public.incident_register(uuid) to authenticated;

create or replace function public.review_incident(p_report uuid, p_outcome text)
returns void
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_academy uuid;
begin
  select academy_id into v_academy from public.incident_reports where id = p_report;
  if v_academy is null then
    raise exception 'no such report' using errcode = '22023';
  end if;
  if not coalesce(app_private.is_safeguarding_officer(v_academy), false) then
    raise exception 'only the Welfare officer or the President reviews an incident' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_outcome, '')), '') is null then
    raise exception 'say what was done — a closed report with no note is not a record' using errcode = '22023';
  end if;
  update public.incident_reports
     set status = 'reviewed', outcome = btrim(p_outcome), reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_report;
end;
$fn$;
revoke execute on function public.review_incident(uuid, text) from public, anon;
grant execute on function public.review_incident(uuid, text) to authenticated;
