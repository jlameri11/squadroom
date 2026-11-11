-- 0256: role requests, with the club's approval
--
-- Joey, 11 Nov 2026: any member — or someone joining by a club link — taps
-- "Request a role": coach, team manager, volunteer, referee, or a committee
-- seat (President, Secretary, Registrar, Treasurer, Welfare officer), names
-- the squads or the area and adds a note. The request sits PENDING and
-- opens nothing until someone who may decides it:
--
--   * the club's owners and admins, the President or the Secretary — any
--     request but a committee seat;
--   * a coordinator — coach, manager and volunteer requests whose every
--     squad is inside their own age groups or stream;
--   * a committee seat — only an owner or the President.
--
-- A coach, a manager, a referee, a volunteer with a children's squad and a
-- committee seat other than the Treasurer's need a current Working With
-- Children Check first (0120's rule through has_current_clearance); without
-- one the request waits, and the list says "waiting on WWCC". The person is
-- told either way; the activity log has every step (made, approved,
-- declined, withdrawn). One pending request per kind per person.
--
-- What approval does: coach — the coach's hat on the membership and a coach's
-- place on each squad asked for; team manager — 0236's club role per squad;
-- volunteer — 0255's club role, club-wide or per squad; referee — a row on
-- the club's referee list (0213); a committee seat — the club role, and the
-- Welfare officer appointed as 0241 does. Nothing is granted before that.
--
-- The join link: a join request may carry the role the person would like
-- (wanted_role, wanted_note); the approving route files the role request
-- once they are a member. Approving a join never demotes anyone — that fix
-- is in the route (a coach who is also a parent keeps the coach's place on
-- their squad); the database already keeps the strongest hat (0237).

-- ---------------------------------------------------------------------------
-- 1. The requests.
do $$ begin
  create type public.role_request_kind as enum
    ('coach', 'team_manager', 'volunteer', 'referee', 'president', 'secretary', 'registrar', 'treasurer', 'welfare_officer');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.role_request_status as enum ('pending', 'approved', 'declined', 'withdrawn');
exception when duplicate_object then null; end $$;

create table if not exists public.role_requests (
  id            uuid primary key default gen_random_uuid(),
  academy_id    uuid not null references public.academies(id) on delete cascade,
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  kind          public.role_request_kind not null,
  team_ids      uuid[] not null default '{}',
  area          text check (area is null or length(area) <= 80),
  note          text check (note is null or length(note) <= 500),
  status        public.role_request_status not null default 'pending',
  created_at    timestamptz not null default now(),
  decided_by    uuid references public.profiles(id) on delete set null,
  decided_at    timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 500)
);
create unique index if not exists role_requests_one_pending
  on public.role_requests (academy_id, profile_id, kind) where status = 'pending';
create index if not exists role_requests_academy_status on public.role_requests (academy_id, status, created_at);
alter table public.role_requests enable row level security;

-- A volunteer's club role is club-wide or one squad's (0255).
alter table public.club_roles drop constraint if exists club_roles_fit;
alter table public.club_roles add constraint club_roles_fit check (
     (role = 'coordinator'  and scope_kind in ('stream', 'age_group'))
  or (role = 'team_manager' and scope_kind = 'team')
  or (role = 'volunteer'    and scope_kind in ('club', 'team'))
  or (role not in ('coordinator', 'team_manager', 'volunteer') and scope_kind = 'club'));

-- The join link carries what the person would like to be.
alter table public.join_requests add column if not exists wanted_role public.role_request_kind;
alter table public.join_requests add column if not exists wanted_note text check (wanted_note is null or length(wanted_note) <= 500);
alter table public.join_requests add column if not exists wanted_team_ids uuid[] not null default '{}';

-- Two more things the queue can say.
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
    'helper_reminder', 'helper_changed', 'report_filed', 'team_published', 'team_sheet_due', 'accreditation_expiring',
    'role_request', 'role_decided']));
end $$;

-- ---------------------------------------------------------------------------
-- 2. Who may decide, what needs a check, and the words for a request.
create or replace function app_private.may_decide_role_request(p_request uuid)
returns boolean
language plpgsql stable security definer set search_path = public as $fn$
declare
  r public.role_requests;
begin
  select * into r from public.role_requests where id = p_request;
  if r.id is null or auth.uid() is null then
    return false;
  end if;
  -- Nobody decides their own: a coordinator asking to coach in their own
  -- group, a President asking for a second seat, goes to someone else.
  if r.profile_id = auth.uid() then
    return false;
  end if;
  if r.kind in ('president', 'secretary', 'registrar', 'treasurer', 'welfare_officer') then
    return app_private.holds_role(r.academy_id, 'owner') or app_private.has_club_role(r.academy_id, 'president');
  end if;
  if coalesce(app_private.is_academy_staff(r.academy_id), false) or app_private.may_run_club(r.academy_id, 'club') then
    return true;
  end if;
  -- A coordinator: every squad asked for inside their own groups, and
  -- managers do not count (runs_team's second argument).
  if app_private.has_club_role(r.academy_id, 'coordinator')
     and r.kind in ('coach', 'team_manager', 'volunteer')
     and coalesce(array_length(r.team_ids, 1), 0) > 0 then
    return not exists (select 1 from unnest(r.team_ids) t(id) where not app_private.runs_team(t.id, false));
  end if;
  return false;
end;
$fn$;
-- Used straight from the select policy below, so the signed-in role runs it.
revoke execute on function app_private.may_decide_role_request(uuid) from public, anon;
grant execute on function app_private.may_decide_role_request(uuid) to authenticated;

create or replace function app_private.role_request_needs_check(p_request uuid)
returns boolean
language plpgsql stable security definer set search_path = public as $fn$
declare
  r public.role_requests;
begin
  select * into r from public.role_requests where id = p_request;
  if r.id is null then
    return false;
  end if;
  return case
    when r.kind = 'treasurer' then false
    when r.kind = 'volunteer' then exists (select 1 from unnest(r.team_ids) t(id) where app_private.team_has_minors(t.id))
    else true
  end;
end;
$fn$;
revoke execute on function app_private.role_request_needs_check(uuid) from public, anon, authenticated;

create or replace function app_private.role_request_words(p_request uuid)
returns text
language plpgsql stable security definer set search_path = public as $fn$
declare
  r public.role_requests;
  v_teams text;
begin
  select * into r from public.role_requests where id = p_request;
  if r.id is null then
    return null;
  end if;
  select string_agg(t.name, ', ' order by t.name) into v_teams from public.teams t where t.id = any (r.team_ids);
  return case r.kind
    when 'coach'           then 'coach of ' || coalesce(v_teams, 'a squad')
    when 'team_manager'    then 'team manager of ' || coalesce(v_teams, 'a squad')
    when 'volunteer'       then 'volunteer' || case when r.area is not null then ' (' || r.area || ')' else '' end
                                            || case when v_teams is not null then ' with ' || v_teams else '' end
    when 'referee'         then 'referee'
    when 'president'       then 'President'
    when 'secretary'       then 'Secretary'
    when 'registrar'       then 'Registrar'
    when 'treasurer'       then 'Treasurer'
    when 'welfare_officer' then 'Welfare officer'
  end;
end;
$fn$;
revoke execute on function app_private.role_request_words(uuid) from public, anon, authenticated;

-- Who is told of a new request: the people who may decide it.
create or replace function app_private.role_request_approvers(p_request uuid)
returns table (profile_id uuid)
language plpgsql stable security definer set search_path = public as $fn$
declare
  r public.role_requests;
  v_committee boolean;
begin
  select * into r from public.role_requests where id = p_request;
  if r.id is null then
    return;
  end if;
  v_committee := r.kind in ('president', 'secretary', 'registrar', 'treasurer', 'welfare_officer');
  return query
  select distinct x.profile_id from (
    select m.profile_id from public.academy_members m
     where m.academy_id = r.academy_id and m.status = 'active'
       and ('owner' = any (m.roles) or (not v_committee and 'admin' = any (m.roles)))
    union
    select cr.profile_id from public.club_roles cr
     where cr.academy_id = r.academy_id
       and (cr.role = 'president' or (not v_committee and cr.role = 'secretary'))
    union
    select cr.profile_id from public.club_roles cr
     where not v_committee and r.kind in ('coach', 'team_manager', 'volunteer')
       and cr.academy_id = r.academy_id and cr.role = 'coordinator'
       and coalesce(array_length(r.team_ids, 1), 0) > 0
       and not exists (
         select 1 from unnest(r.team_ids) t(id) join public.teams tm on tm.id = t.id
          where not ((cr.scope_kind = 'age_group' and cr.age_group = tm.age_group)
                  or (cr.scope_kind = 'stream' and cr.stream_id = tm.stream_id)))
  ) x where x.profile_id <> r.profile_id;
end;
$fn$;
revoke execute on function app_private.role_request_approvers(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The log and the word, from one trigger — so the join route's request
--    (filed as the service role) is logged and told of the same way.
create or replace function app_private.on_role_request()
returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  v_name  text;
  v_words text;
begin
  select coalesce(nullif(btrim(p.full_name), ''), 'Someone') into v_name from public.profiles p where p.id = new.profile_id;
  v_words := app_private.role_request_words(new.id);
  if tg_op = 'INSERT' then
    perform app_private.log_activity(new.academy_id, 'role_request.made', 'role_request', new.id, v_name,
      jsonb_build_object('kind', new.kind, 'teams', new.team_ids, 'area', new.area, 'words', v_words));
    insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload, scheduled_for, dedupe_key)
    select new.academy_id, a.profile_id, 'role_request', 'A role request',
           v_name || ' asks to be ' || v_words || '. Approve or decline under Requests.',
           '/admin/requests', jsonb_build_object('role_request_id', new.id, 'kind', new.kind), now(),
           'role_request:' || new.id::text || ':' || a.profile_id::text
      from app_private.role_request_approvers(new.id) a
    on conflict (dedupe_key) do nothing;
    return new;
  end if;
  if new.status is distinct from old.status and new.status in ('approved', 'declined', 'withdrawn') then
    perform app_private.log_activity(new.academy_id, 'role_request.' || new.status::text, 'role_request', new.id, v_name,
      jsonb_build_object('kind', new.kind, 'teams', new.team_ids, 'words', v_words, 'note', new.decision_note));
    if new.status in ('approved', 'declined') then
      insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload, scheduled_for, dedupe_key)
      values (new.academy_id, new.profile_id, 'role_decided',
              case when new.status = 'approved' then 'You''re in: ' || v_words else 'Your request to be ' || v_words end,
              case when new.status = 'approved' then 'Approved' else 'Not approved' end
                || case when new.decision_note is not null then ' — ' || new.decision_note else '.' end,
              case when new.status = 'approved' then '/' else '/settings' end,
              jsonb_build_object('role_request_id', new.id, 'kind', new.kind, 'status', new.status), now(),
              'role_decided:' || new.id::text)
      on conflict (dedupe_key) do nothing;
    end if;
  end if;
  return new;
end;
$fn$;
drop trigger if exists role_requests_log_and_tell on public.role_requests;
create trigger role_requests_log_and_tell
  after insert or update on public.role_requests
  for each row execute function app_private.on_role_request();

-- ---------------------------------------------------------------------------
-- 4. Reading: your own, and the ones you may decide.
drop policy if exists role_requests_select on public.role_requests;
create policy role_requests_select on public.role_requests for select to authenticated
  using (profile_id = (select auth.uid()) or (select app_private.may_decide_role_request(id)));
-- No insert, update or delete policy: the functions below write, as their owner.

-- ---------------------------------------------------------------------------
-- 5. Asking.
create or replace function public.request_role(
  p_academy uuid,
  p_kind    public.role_request_kind,
  p_teams   uuid[] default '{}',
  p_area    text default null,
  p_note    text default null
) returns uuid
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_id    uuid;
  v_teams uuid[] := coalesce(p_teams, '{}');
begin
  if auth.uid() is null or not app_private.is_academy_member(p_academy) then
    raise exception 'join the club first' using errcode = '42501';
  end if;
  if p_kind not in ('coach', 'team_manager', 'volunteer') then
    v_teams := '{}';
  end if;
  if p_kind in ('coach', 'team_manager') and coalesce(array_length(v_teams, 1), 0) = 0 then
    raise exception 'say which squad' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_teams) t(id)
              where not exists (select 1 from public.teams tm where tm.id = t.id and tm.academy_id = p_academy and tm.status = 'active')) then
    raise exception 'that squad is not this club''s' using errcode = '22023';
  end if;
  -- Already theirs: nothing to ask for.
  if (p_kind = 'coach' and not exists (select 1 from unnest(v_teams) t(id) where not app_private.is_team_coach(t.id)))
     or (p_kind = 'team_manager' and not exists (
           select 1 from unnest(v_teams) t(id)
            where not exists (select 1 from public.club_roles r where r.academy_id = p_academy and r.profile_id = auth.uid()
                                                                   and r.role = 'team_manager' and r.team_id = t.id)))
     or exists (select 1 from public.club_roles r
                 where r.academy_id = p_academy and r.profile_id = auth.uid() and r.scope_kind = 'club'
                   and r.role::text = p_kind::text)
     or (p_kind = 'referee' and exists (select 1 from public.referees rf where rf.academy_id = p_academy and rf.profile_id = auth.uid())) then
    raise exception 'that is already yours' using errcode = '22023';
  end if;
  insert into public.role_requests (academy_id, profile_id, kind, team_ids, area, note)
  values (p_academy, auth.uid(), p_kind, v_teams, nullif(btrim(p_area), ''), nullif(btrim(p_note), ''))
  on conflict (academy_id, profile_id, kind) where status = 'pending' do nothing
  returning id into v_id;
  if v_id is null then
    raise exception 'you have already asked — it is waiting on the committee' using errcode = '23505';
  end if;
  return v_id;
end;
$fn$;
revoke execute on function public.request_role(uuid, public.role_request_kind, uuid[], text, text) from public, anon;
grant execute on function public.request_role(uuid, public.role_request_kind, uuid[], text, text) to authenticated;

create or replace function public.withdraw_role_request(p_request uuid)
returns boolean
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_n integer;
begin
  if auth.uid() is null then
    return false;
  end if;
  update public.role_requests set status = 'withdrawn', decided_at = now()
   where id = p_request and profile_id = auth.uid() and status = 'pending';
  get diagnostics v_n = row_count;
  return v_n = 1;
end;
$fn$;
revoke execute on function public.withdraw_role_request(uuid) from public, anon;
grant execute on function public.withdraw_role_request(uuid) to authenticated;

-- Your own requests, for Settings.
create or replace function public.my_role_requests(p_academy uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
begin
  if auth.uid() is null then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', r.id, 'kind', r.kind, 'words', app_private.role_request_words(r.id), 'status', r.status,
             'created_at', r.created_at, 'decided_at', r.decided_at, 'decision_note', r.decision_note,
             'waiting_on_check', r.status = 'pending' and app_private.role_request_needs_check(r.id)
                                 and not app_private.has_current_clearance(r.academy_id, r.profile_id))
           order by r.created_at desc)
      from public.role_requests r
     where r.academy_id = p_academy and r.profile_id = auth.uid()
       and (r.status = 'pending' or r.decided_at > now() - interval '60 days')
  ), '[]'::jsonb);
end;
$fn$;
revoke execute on function public.my_role_requests(uuid) from public, anon;
grant execute on function public.my_role_requests(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. The list, for those who decide. The staff, the President and the
--    Secretary see every pending request (a committee seat with "only the
--    owner or the President decides this"); a coordinator sees the ones
--    inside their groups.
create or replace function public.role_requests_pending(p_academy uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_all boolean;
begin
  if auth.uid() is null then
    return null;
  end if;
  v_all := coalesce(app_private.is_academy_staff(p_academy), false) or app_private.may_run_club(p_academy, 'club');
  if not v_all and not app_private.has_club_role(p_academy, 'coordinator') then
    return null;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', r.id, 'profile_id', r.profile_id,
             'name', coalesce(nullif(btrim(p.full_name), ''), 'Someone'),
             'kind', r.kind, 'words', app_private.role_request_words(r.id),
             'teams', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name), '[]'::jsonb)
                         from public.teams t where t.id = any (r.team_ids)),
             'area', r.area, 'note', r.note, 'created_at', r.created_at,
             'needs_check', app_private.role_request_needs_check(r.id),
             'has_check', app_private.has_current_clearance(r.academy_id, r.profile_id),
             'committee', r.kind in ('president', 'secretary', 'registrar', 'treasurer', 'welfare_officer'),
             'can_decide', app_private.may_decide_role_request(r.id))
           order by r.created_at)
      from public.role_requests r
      join public.profiles p on p.id = r.profile_id
     where r.academy_id = p_academy and r.status = 'pending'
       and (v_all or app_private.may_decide_role_request(r.id))
  ), '[]'::jsonb);
end;
$fn$;
revoke execute on function public.role_requests_pending(uuid) from public, anon;
grant execute on function public.role_requests_pending(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Deciding. Approval grants exactly the thing asked for, and only now.
create or replace function public.decide_role_request(p_request uuid, p_approve boolean, p_note text default null)
returns jsonb
language plpgsql volatile security definer set search_path = public as $fn$
declare
  r       public.role_requests;
  v_words text;
  t       uuid;
begin
  select * into r from public.role_requests where id = p_request for update;
  if r.id is null then
    raise exception 'no such request' using errcode = '22023';
  end if;
  if auth.uid() is null or not app_private.may_decide_role_request(p_request) then
    raise exception 'that request is not yours to decide' using errcode = '42501';
  end if;
  if r.status <> 'pending' then
    raise exception 'already decided' using errcode = '22023';
  end if;
  v_words := app_private.role_request_words(p_request);

  if not p_approve then
    update public.role_requests
       set status = 'declined', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(p_note), '')
     where id = p_request;
    return jsonb_build_object('status', 'declined', 'words', v_words);
  end if;

  if not exists (select 1 from public.academy_members m
                  where m.academy_id = r.academy_id and m.profile_id = r.profile_id and m.status = 'active') then
    raise exception 'they are no longer a member of the club' using errcode = '22023';
  end if;
  if r.kind in ('coach', 'team_manager') and coalesce(array_length(r.team_ids, 1), 0) = 0 then
    raise exception 'no squad named — decline it and ask them to request again from Settings with the squad' using errcode = '22023';
  end if;
  if app_private.role_request_needs_check(p_request) and not app_private.has_current_clearance(r.academy_id, r.profile_id) then
    raise exception 'waiting on WWCC: no current Working With Children Check is recorded for them. Record it under Admin → Working With Children Checks, then approve.'
      using errcode = '42501';
  end if;

  case r.kind
    when 'coach' then
      update public.academy_members m
         set roles = (select coalesce(array_agg(distinct x), '{}'::public.academy_role[]) from unnest(m.roles || 'coach'::public.academy_role) x)
       where m.academy_id = r.academy_id and m.profile_id = r.profile_id;
      foreach t in array r.team_ids loop
        insert into public.team_members (academy_id, team_id, profile_id, role)
        values (r.academy_id, t, r.profile_id, 'coach')
        on conflict (team_id, profile_id) do update set role = 'coach';
      end loop;
    when 'team_manager' then
      foreach t in array r.team_ids loop
        insert into public.club_roles (academy_id, profile_id, role, scope_kind, team_id, granted_by)
        values (r.academy_id, r.profile_id, 'team_manager', 'team', t, auth.uid())
        on conflict on constraint club_roles_once do update set granted_by = excluded.granted_by;
      end loop;
    when 'volunteer' then
      if coalesce(array_length(r.team_ids, 1), 0) = 0 then
        insert into public.club_roles (academy_id, profile_id, role, scope_kind, granted_by)
        values (r.academy_id, r.profile_id, 'volunteer', 'club', auth.uid())
        on conflict on constraint club_roles_once do nothing;
      else
        foreach t in array r.team_ids loop
          insert into public.club_roles (academy_id, profile_id, role, scope_kind, team_id, granted_by)
          values (r.academy_id, r.profile_id, 'volunteer', 'team', t, auth.uid())
          on conflict on constraint club_roles_once do nothing;
        end loop;
      end if;
    when 'referee' then
      insert into public.referees (academy_id, profile_id, full_name, phone, status, created_by)
      select r.academy_id, r.profile_id, coalesce(nullif(btrim(p.full_name), ''), 'Referee'), p.phone, 'active', auth.uid()
        from public.profiles p
       where p.id = r.profile_id
         and not exists (select 1 from public.referees rf where rf.academy_id = r.academy_id and rf.profile_id = r.profile_id);
    else
      insert into public.club_roles (academy_id, profile_id, role, scope_kind, granted_by)
      values (r.academy_id, r.profile_id, r.kind::text::public.club_role, 'club', auth.uid())
      on conflict on constraint club_roles_once do update set granted_by = excluded.granted_by;
      if r.kind = 'welfare_officer' then
        insert into public.safeguarding_officers (academy_id, profile_id, appointed_by)
        values (r.academy_id, r.profile_id, auth.uid())
        on conflict do nothing;
      end if;
  end case;

  update public.role_requests
     set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(p_note), '')
   where id = p_request;
  return jsonb_build_object('status', 'approved', 'words', v_words);
end;
$fn$;
revoke execute on function public.decide_role_request(uuid, boolean, text) from public, anon;
grant execute on function public.decide_role_request(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Club HQ's "Needs a decision" counts them (home_jobs, re-created below
--    with that one change: the pending role requests this person may
--    decide, and the tile opening Requests when any are waiting).
create or replace function public.home_jobs(p_academy uuid default null, p_persona text default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_me       uuid := auth.uid();
  v_academy  uuid;
  v_role     public.academy_role;
  v_type     text;
  v_tz       text;
  v_persona  text;
  v_personas text[];
  v_jobs     jsonb := '[]'::jsonb;
  v_today    jsonb;
  v_ann      jsonb;
  v_switch   jsonb;
  v_id       uuid;
  v_title    text;
  v_at       timestamptz;
  v_count    integer;
  v_count2   integer;
  v_count3   integer;
  v_cents    bigint;
  v_detail   text;
  v_comp     uuid;
  v_comp2    uuid;
  v_day      date;
  v_sun      date;
  v_upcoming jsonb := '[]'::jsonb;
  v_teams    uuid[];
begin
  if v_me is null then
    return null;
  end if;
  v_academy := app_private.my_academy(p_academy);
  if v_academy is null then
    return null;
  end if;

  select am.role into v_role
    from public.academy_members am
   where am.academy_id = v_academy and am.profile_id = v_me and am.status = 'active';
  select a.type::text, coalesce(a.timezone, 'Australia/Sydney') into v_type, v_tz
    from public.academies a where a.id = v_academy;
  v_personas := app_private.home_personas(v_academy, v_me);
  v_persona := case when p_persona is not null and p_persona = any (v_personas) then p_persona else v_personas[1] end;
  v_day := (now() at time zone v_tz)::date;
  v_sun := v_day + ((7 - extract(dow from v_day)::integer) % 7);

  -- The next three weeks, worked out ONCE (0216).
  if v_persona in ('parent', 'coach', 'player') then
    select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb) into v_upcoming
      from public.my_upcoming_events(v_academy, 21) e;
  end if;

  -- ------------------------------------------------------- parent / player
  if v_persona in ('parent', 'player') then
    select e.id, e.title, e.starts_at into v_id, v_title, v_at
      from jsonb_to_recordset(v_upcoming) as e(id uuid, type public.event_type, title text, starts_at timestamptz, cancelled_at timestamptz, my_replies integer, my_children integer, no_reply integer)
     where e.cancelled_at is null and coalesce(e.my_children, 0) > coalesce(e.my_replies, 0)
     order by e.starts_at, e.id limit 1;
    select count(*) into v_count
      from jsonb_to_recordset(v_upcoming) as e(id uuid, type public.event_type, title text, starts_at timestamptz, cancelled_at timestamptz, my_replies integer, my_children integer, no_reply integer)
     where e.cancelled_at is null and coalesce(e.my_children, 0) > coalesce(e.my_replies, 0);
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'rsvp', 'label', 'Answer',
      'detail', case when v_id is null then 'All answered'
                     else v_title || ' · ' || to_char(v_at at time zone v_tz, 'Dy') end,
      'href', case when v_id is null then '/calendar' else '/calendar/' || v_id end,
      'count', coalesce(v_count, 0));

    v_id := null; v_title := null; v_count := null;
    select c.channel_id, c.name, c.unread_count into v_id, v_title, v_count
      from public.my_channels(v_academy) c
     where c.status = 'active' and c.type = 'team'
     order by c.unread_count desc, c.last_message_at desc nulls last limit 1;
    if v_id is null then
      select c.channel_id, c.name, c.unread_count into v_id, v_title, v_count
        from public.my_channels(v_academy) c
       where c.status = 'active'
       order by c.unread_count desc, c.last_message_at desc nulls last limit 1;
    end if;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'chat', 'label', 'Team chat',
      'detail', coalesce(v_title, 'No chats yet'),
      'href', case when v_id is null then '/chat' else '/chat/' || v_id end,
      'count', coalesce(v_count, 0));

    v_count := null; v_detail := null;
    select (x->>'count')::integer, x->>'detail' into v_count, v_detail
      from jsonb_array_elements(coalesce(public.needs_you(v_academy), '[]'::jsonb)) x
     where x->>'kind' = 'fees' limit 1;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'pay', 'label', 'Pay',
      'detail', coalesce(v_detail, 'Nothing owing'),
      'href', '/payments',
      'count', coalesce(v_count, 0));

  -- ------------------------------------------------------------------- coach
  elsif v_persona = 'coach' then
    select c.channel_id, c.name, c.unread_count into v_id, v_title, v_count
      from public.my_channels(v_academy) c
     where c.status = 'active' and c.type = 'team'
     order by (c.my_role = 'host') desc, c.unread_count desc, c.last_message_at desc nulls last limit 1;
    if v_id is null then
      select c.channel_id, c.name, c.unread_count into v_id, v_title, v_count
        from public.my_channels(v_academy) c
       where c.status = 'active'
       order by c.unread_count desc, c.last_message_at desc nulls last limit 1;
    end if;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'post', 'label', 'Post',
      'detail', coalesce(v_title, 'No chats yet'),
      'href', case when v_id is null then '/chat' else '/chat/' || v_id end,
      'count', coalesce(v_count, 0));

    v_id := null; v_title := null; v_count := null;
    select e.id, e.title, e.no_reply into v_id, v_title, v_count
      from jsonb_to_recordset(v_upcoming) as e(id uuid, type public.event_type, title text, starts_at timestamptz, cancelled_at timestamptz, my_replies integer, my_children integer, no_reply integer)
     where e.cancelled_at is null and e.type in ('match', 'tournament')
     order by e.starts_at, e.id limit 1;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'squad', 'label', 'Squad',
      'detail', case when v_id is null then 'No game coming up'
                     when coalesce(v_count, 0) > 0 then v_count || ' no reply · ' || v_title
                     else v_title end,
      'href', case when v_id is null then '/calendar' else '/calendar/' || v_id end,
      'count', coalesce(v_count, 0));

    v_id := null; v_title := null; v_at := null;
    select e.id, e.title, e.starts_at into v_id, v_title, v_at
      from public.events e
     where e.academy_id = v_academy and e.type = 'training' and e.cancelled_at is null
       and e.private_to is null
       and e.starts_at between now() - interval '12 hours' and now()
       and (app_private.is_academy_coach(v_academy)
            or (e.team_id is not null and app_private.is_team_coach(e.team_id)))
     order by e.starts_at desc limit 1;
    if v_id is null then
      select e.id, e.title, e.starts_at into v_id, v_title, v_at
        from jsonb_to_recordset(v_upcoming) as e(id uuid, type public.event_type, title text, starts_at timestamptz, cancelled_at timestamptz, my_replies integer, my_children integer, no_reply integer)
       where e.starts_at < now() + interval '7 days'
         and e.cancelled_at is null and e.type = 'training'
       order by e.starts_at, e.id limit 1;
    end if;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'attendance', 'label', 'Attendance',
      'detail', case when v_id is null then 'No training this week'
                     when v_at <= now() then v_title || ' · register open'
                     else v_title || ' · ' || to_char(v_at at time zone v_tz, 'Dy HH12:MI am') end,
      'href', case when v_id is null then '/calendar' else '/calendar/' || v_id end,
      'count', 0);

  -- ------------------------------------------------------------------- owner
  elsif v_persona = 'owner' then
    select (select count(*) from public.registration_requests rr
             where rr.academy_id = v_academy and rr.status = 'pending')
         + (select count(*) from public.program_registrations pr
             where pr.academy_id = v_academy and pr.status = 'pending')
      into v_count;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'registrations', 'label', 'Registrations',
      'detail', case when coalesce(v_count, 0) = 0 then 'None waiting' else v_count || ' waiting' end,
      'href', '/admin/registrations',
      'count', coalesce(v_count, 0));

    select count(distinct o.player_id), coalesce(sum(o.outstanding_cents), 0) into v_count, v_cents
      from public.outstanding_fees(v_academy) o
     where o.outstanding_cents > 0;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'owing', 'label', 'Who owes',
      'detail', case when coalesce(v_count, 0) = 0 then 'Nobody owes'
                     else '$' || to_char(v_cents / 100.0, 'FM999999990') || ' · ' || v_count
                          || case when v_count = 1 then ' child' else ' children' end end,
      'href', '/admin/payments',
      'count', coalesce(v_count, 0));

    v_id := null; v_title := null;
    select c.channel_id, c.name into v_id, v_title
      from public.my_channels(v_academy) c
     where c.status = 'active' and c.type = 'academy_wide' limit 1;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'everyone', 'label', 'Message everyone',
      'detail', coalesce(v_title, 'Club-wide chat'),
      'href', case when v_id is null then '/chat' else '/chat/' || v_id end,
      'count', 0);

    select count(*) into v_count
      from public.events e
     where e.academy_id = v_academy and e.cancelled_at is null and e.private_to is null
       and (e.starts_at at time zone v_tz)::date = v_day;
    v_today := jsonb_build_object(
      'label', 'Today across all teams',
      'detail', case when coalesce(v_count, 0) = 0 then 'Nothing on today'
                     else v_count || case when v_count = 1 then ' session' else ' sessions' end end,
      'count', coalesce(v_count, 0),
      'href', '/calendar');

  -- --------------------------------------------------------------- president
  -- Club HQ (Big Club Mode item 12): needs a decision · this weekend · money.
  elsif v_persona = 'president' then
    select (select count(*) from public.registration_requests rr where rr.academy_id = v_academy and rr.status = 'pending')
         + (select count(*) from public.program_registrations pr where pr.academy_id = v_academy and pr.status = 'pending')
         + (select count(*) from public.join_requests jr where jr.academy_id = v_academy and jr.status = 'pending')
         + (select count(*) from public.refunds rf where rf.academy_id = v_academy and rf.status = 'requested')
      into v_count;
    -- 0256: role requests this person may decide.
    select count(*) into v_count2 from public.role_requests q
     where q.academy_id = v_academy and q.status = 'pending' and app_private.may_decide_role_request(q.id);
    v_count := coalesce(v_count, 0) + coalesce(v_count2, 0);
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'decisions', 'label', 'Needs a decision',
      'detail', case when v_count = 0 then 'Nothing waiting'
                     else v_count || ' waiting' || case when coalesce(v_count2, 0) > 0 then ' · ' || v_count2 || ' role request' || case when v_count2 = 1 then '' else 's' end else '' end end,
      'href', case when coalesce(v_count2, 0) > 0 then '/admin/requests' else '/admin/registrations' end,
      'count', v_count);

    select count(*), count(*) filter (where e.cancelled_at is not null) into v_count, v_count2
      from public.events e
     where e.academy_id = v_academy and e.private_to is null and e.type in ('match', 'tournament')
       and (e.starts_at at time zone v_tz)::date between v_day and v_sun;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'weekend', 'label', 'This weekend',
      'detail', case when coalesce(v_count, 0) = 0 then 'No games'
                     else (v_count - v_count2) || ' games' || case when v_count2 > 0 then ' · ' || v_count2 || ' called off' else '' end end,
      'href', '/calendar',
      'count', coalesce(v_count, 0) - coalesce(v_count2, 0));

    select count(distinct o.player_id), coalesce(sum(o.outstanding_cents), 0) into v_count, v_cents
      from public.outstanding_fees(v_academy) o
     where o.outstanding_cents > 0;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'money', 'label', 'Money',
      'detail', case when coalesce(v_count, 0) = 0 then 'Nobody owes'
                     else '$' || to_char(v_cents / 100.0, 'FM999999990') || ' owed · ' || v_count end,
      'href', '/admin/payments',
      'count', coalesce(v_count, 0));

    select count(*) into v_count
      from public.events e
     where e.academy_id = v_academy and e.cancelled_at is null and e.private_to is null
       and (e.starts_at at time zone v_tz)::date = v_day;
    v_today := jsonb_build_object(
      'label', 'Today across the club',
      'detail', case when coalesce(v_count, 0) = 0 then 'Nothing on today'
                     else v_count || case when v_count = 1 then ' session' else ' sessions' end end,
      'count', coalesce(v_count, 0),
      'href', '/calendar');

  -- --------------------------------------------------------------- treasurer
  elsif v_persona = 'treasurer' then
    select count(distinct o.player_id), coalesce(sum(o.outstanding_cents), 0) into v_count, v_cents
      from public.outstanding_fees(v_academy) o
     where o.outstanding_cents > 0;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'owing', 'label', 'Who owes',
      'detail', case when coalesce(v_count, 0) = 0 then 'Nobody owes'
                     else '$' || to_char(v_cents / 100.0, 'FM999999990') || ' · ' || v_count end,
      'href', '/admin/payments',
      'count', coalesce(v_count, 0));

    select coalesce(sum(p.amount_cents), 0), count(*) into v_cents, v_count
      from public.payments p
     where p.academy_id = v_academy and p.status = 'paid'
       and coalesce(p.paid_at, p.created_at) >= date_trunc('month', now() at time zone v_tz);
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'collected', 'label', 'Collected',
      'detail', case when coalesce(v_count, 0) = 0 then 'Nothing yet this month'
                     else '$' || to_char(v_cents / 100.0, 'FM999999990') || ' this month' end,
      'href', '/admin/payments',
      'count', 0);

    select count(*) into v_count from public.refunds rf where rf.academy_id = v_academy and rf.status = 'requested';
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'refunds', 'label', 'Refunds',
      'detail', case when coalesce(v_count, 0) = 0 then 'None to issue' else v_count || ' to issue' end,
      'href', '/admin/payments',
      'count', coalesce(v_count, 0));

  -- --------------------------------------------------------------- registrar
  elsif v_persona = 'registrar' then
    select (select count(*) from public.registration_requests rr where rr.academy_id = v_academy and rr.status = 'pending')
         + (select count(*) from public.program_registrations pr where pr.academy_id = v_academy and pr.status = 'pending')
      into v_count;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'registrations', 'label', 'Registrations',
      'detail', case when coalesce(v_count, 0) = 0 then 'None waiting' else v_count || ' waiting' end,
      'href', '/admin/registrations',
      'count', coalesce(v_count, 0));

    select count(*) into v_count from public.players p
     where p.academy_id = v_academy and p.official_status = 'pending';
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'playfootball', 'label', 'PlayFootball',
      'detail', case when coalesce(v_count, 0) = 0 then 'Everyone done' else v_count || ' not done' end,
      'href', '/admin/teams',
      'count', coalesce(v_count, 0));

    select count(*) into v_count from public.offers o
     where o.academy_id = v_academy and o.status = 'open' and o.expires_at > now();
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'offers', 'label', 'Offers',
      'detail', case when coalesce(v_count, 0) = 0 then 'None open' else v_count || ' open' end,
      'href', '/admin/season',
      'count', coalesce(v_count, 0));

  -- ------------------------------------------------------------- coordinator
  elsif v_persona = 'coordinator' then
    select coalesce(array_agg(t.id), '{}') into v_teams
      from public.teams t
     where t.academy_id = v_academy and t.status = 'active'
       and exists (select 1 from public.club_roles r
                    where r.academy_id = v_academy and r.profile_id = v_me and r.role = 'coordinator'
                      and ((r.scope_kind = 'stream' and r.stream_id = t.stream_id)
                           or (r.scope_kind = 'age_group' and r.age_group = t.age_group)));
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'teams', 'label', 'My teams',
      'detail', case when cardinality(v_teams) = 0 then 'No squads in your groups yet' else cardinality(v_teams) || ' squads' end,
      'href', '/admin/teams',
      'count', cardinality(v_teams));

    select count(*) into v_count
      from public.events e
     where e.academy_id = v_academy and e.cancelled_at is null and e.private_to is null
       and e.team_id = any (v_teams) and e.type in ('match', 'tournament')
       and (e.starts_at at time zone v_tz)::date between v_day and v_sun;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'weekend', 'label', 'This weekend',
      'detail', case when coalesce(v_count, 0) = 0 then 'No games' else v_count || ' games' end,
      'href', '/calendar',
      'count', coalesce(v_count, 0));

    v_id := null; v_title := null; v_count := null;
    select c.channel_id, c.name, c.unread_count into v_id, v_title, v_count
      from public.my_channels(v_academy) c
     where c.status = 'active' and c.type = 'coaches' limit 1;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'coaches', 'label', 'Coaches',
      'detail', coalesce(v_title, 'The coaches'' room'),
      'href', case when v_id is null then '/chat' else '/chat/' || v_id end,
      'count', coalesce(v_count, 0));

  -- ----------------------------------------------------------------- manager
  elsif v_persona = 'manager' then
    select coalesce(array_agg(r.team_id), '{}') into v_teams
      from public.club_roles r
     where r.academy_id = v_academy and r.profile_id = v_me and r.role = 'team_manager';

    v_id := null; v_title := null; v_at := null; v_count := null;
    select e.id, e.title, e.starts_at,
           (select count(*) from public.team_members tm
             where tm.team_id = e.team_id and tm.role in ('parent', 'player')
               and not exists (select 1 from public.event_rsvps rs where rs.event_id = e.id and rs.profile_id = tm.profile_id))
      into v_id, v_title, v_at, v_count
      from public.events e
     where e.academy_id = v_academy and e.team_id = any (v_teams) and e.cancelled_at is null and e.private_to is null
       and e.type in ('match', 'tournament') and e.starts_at > now()
     order by e.starts_at limit 1;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'availability', 'label', 'Availability',
      'detail', case when v_id is null then 'No game coming up'
                     when coalesce(v_count, 0) > 0 then v_count || ' not answered · ' || v_title
                     else v_title end,
      'href', case when v_id is null then '/calendar' else '/calendar/' || v_id end,
      'count', coalesce(v_count, 0));

    v_jobs := v_jobs || jsonb_build_object(
      'id', 'sheet', 'label', 'Team sheet',
      'detail', case when v_id is null then 'No game coming up' else v_title || ' · ' || to_char(v_at at time zone v_tz, 'Dy') end,
      'href', case when v_id is null then '/calendar' else '/calendar/' || v_id || '?tab=sheet' end,
      'count', 0);

    v_id := null; v_title := null; v_count := null;
    select c.channel_id, c.name, c.unread_count into v_id, v_title, v_count
      from public.my_channels(v_academy) c
     where c.status = 'active' and c.type = 'team' and c.team_id = any (v_teams)
     order by c.unread_count desc limit 1;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'chat', 'label', 'Team chat',
      'detail', coalesce(v_title, 'The team''s chat'),
      'href', case when v_id is null then '/chat' else '/chat/' || v_id end,
      'count', coalesce(v_count, 0));

  -- ----------------------------------------------------------------- welfare
  elsif v_persona = 'welfare' then
    select count(*) into v_count from public.message_reports mr where mr.academy_id = v_academy and mr.status = 'open';
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'reports', 'label', 'Reports',
      'detail', case when coalesce(v_count, 0) = 0 then 'Nothing open' else v_count || ' open' end,
      'href', '/admin/safeguarding',
      'count', coalesce(v_count, 0));
    select count(*) into v_count from public.conduct_reports cr where cr.academy_id = v_academy and cr.status = 'open';
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'concerns', 'label', 'Concerns',
      'detail', case when coalesce(v_count, 0) = 0 then 'Nothing open' else v_count || ' open' end,
      'href', '/admin/safeguarding',
      'count', coalesce(v_count, 0));
    select count(*) into v_count
      from public.academy_members m
      left join public.staff_clearances c on c.academy_id = m.academy_id and c.profile_id = m.profile_id
     where m.academy_id = v_academy and m.status = 'active'
       and m.roles && array['coach', 'admin']::public.academy_role[]
       and (c.id is null or c.expires_on < current_date + 30 or c.outcome in ('barred', 'not_found'));
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'checks', 'label', 'Checks',
      'detail', case when coalesce(v_count, 0) = 0 then 'Everyone current' else v_count || ' to chase' end,
      'href', '/admin/clearances',
      'count', coalesce(v_count, 0));

  -- -------------------------------------------------------------- volunteers
  elsif v_persona = 'volunteers' then
    select count(*), coalesce(sum(j.spots - (select count(*) from public.event_job_helpers h where h.job_id = j.id)), 0)
      into v_count, v_count2
      from public.event_jobs j
      join public.events e on e.id = j.event_id
     where j.academy_id = v_academy and e.cancelled_at is null
       and e.starts_at between now() and now() + interval '7 days'
       and j.spots > (select count(*) from public.event_job_helpers h where h.job_id = j.id);
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'gaps', 'label', 'This weekend''s gaps',
      'detail', case when coalesce(v_count, 0) = 0 then 'Every job filled' else v_count2 || ' spots across ' || v_count || ' jobs' end,
      'href', '/calendar',
      'count', coalesce(v_count2, 0));
    select count(*) into v_count
      from public.events e
     where e.academy_id = v_academy and e.cancelled_at is null and e.private_to is null
       and e.starts_at between now() and now() + interval '7 days'
       and not exists (select 1 from public.event_jobs j where j.event_id = e.id);
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'rosters', 'label', 'Rosters',
      'detail', case when coalesce(v_count, 0) = 0 then 'Every event has its jobs' else v_count || ' events with no jobs yet' end,
      'href', '/calendar',
      'count', coalesce(v_count, 0));
    v_id := null; v_title := null;
    select c.channel_id, c.name into v_id, v_title
      from public.my_channels(v_academy) c
     where c.status = 'active' and c.type = 'academy_wide' limit 1;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'ask', 'label', 'Ask for help',
      'detail', coalesce(v_title, 'Club-wide chat'),
      'href', case when v_id is null then '/chat' else '/chat/' || v_id end,
      'count', 0);

  -- ------------------------------------------------------------------ league
  else
    select f.competition_id, count(*) into v_comp, v_count
      from public.fixtures f
      join public.competitions c on c.id = f.competition_id
     where c.organiser_id = v_academy and f.status in ('scheduled', 'in_progress')
       and (f.starts_at at time zone v_tz)::date between v_day and v_sun
     group by f.competition_id order by count(*) desc limit 1;
    if v_comp is null then
      select c.id into v_comp from public.competitions c
       where c.organiser_id = v_academy order by c.created_at desc limit 1;
    end if;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'draw', 'label', 'The draw',
      'detail', case when coalesce(v_count, 0) = 0 then 'Nothing this weekend'
                     else v_count || ' games this weekend' end,
      'href', case when v_comp is null then '/competitions' else '/competitions/' || v_comp || '?tab=run' end,
      'count', coalesce(v_count, 0));
    v_today := jsonb_build_object(
      'label', 'This weekend',
      'detail', case when coalesce(v_count, 0) = 0 then 'No games drawn'
                     else v_count || ' games, ' || to_char(v_day, 'Dy DD Mon') || ' to ' || to_char(v_sun, 'Dy DD Mon') end,
      'count', coalesce(v_count, 0),
      'href', case when v_comp is null then '/competitions' else '/competitions/' || v_comp || '?tab=run' end);

    v_comp2 := null; v_count2 := null;
    select f.competition_id, count(*) into v_comp2, v_count2
      from public.fixtures f
      join public.competitions c on c.id = f.competition_id
     where c.organiser_id = v_academy and f.status = 'scheduled'
       and f.starts_at between now() and now() + interval '7 days'
       and not exists (select 1 from public.referee_appointments ra
                        where ra.fixture_id = f.id and ra.role = 'referee' and ra.status = 'accepted')
     group by f.competition_id order by count(*) desc limit 1;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'referees', 'label', 'Referees',
      'detail', case when coalesce(v_count2, 0) = 0 then 'Every game covered'
                     else v_count2 || case when v_count2 = 1 then ' game' else ' games' end || ' without a referee' end,
      'href', case when coalesce(v_comp2, v_comp) is null then '/competitions'
                   else '/competitions/' || coalesce(v_comp2, v_comp) || '?tab=referees' end,
      'count', coalesce(v_count2, 0));

    v_comp2 := null; v_count2 := null; v_count := null;
    select f.competition_id,
           count(*) filter (where f.score_disputed),
           count(*) filter (where not f.score_disputed)
      into v_comp2, v_count, v_count2
      from public.fixtures f
      join public.competitions c on c.id = f.competition_id
     where c.organiser_id = v_academy
       and (
         f.score_disputed
         or (f.starts_at between now() - interval '7 days' and now()
             and f.status in ('scheduled', 'in_progress', 'final')
             and (select count(*) from public.match_sheets ms where ms.fixture_id = f.id) < 2)
       )
     group by f.competition_id order by count(*) desc limit 1;
    v_jobs := v_jobs || jsonb_build_object(
      'id', 'results', 'label', 'Results',
      'detail', case when coalesce(v_count, 0) + coalesce(v_count2, 0) = 0 then 'Nothing to resolve'
                     else concat_ws(' · ',
                            case when coalesce(v_count, 0) > 0 then v_count || ' disputed' end,
                            case when coalesce(v_count2, 0) > 0 then v_count2 || ' sheets missing' end) end,
      'href', case when coalesce(v_comp2, v_comp) is null then '/competitions'
                   else '/competitions/' || coalesce(v_comp2, v_comp) || '?tab=run' end,
      'count', coalesce(v_count, 0) + coalesce(v_count2, 0));
  end if;

  -- The latest announcement in a channel this person is in.
  select jsonb_build_object(
           'id', m.id, 'channel_id', m.channel_id, 'channel_name', c.name,
           'body', left(m.body, 280), 'sender_name', p.full_name, 'created_at', m.created_at,
           'relevant_until', m.relevant_until,
           'reply_count', (select count(*) from public.messages x
                            where x.reply_to_id = m.id and x.status = 'published' and x.deleted_at is null))
    into v_ann
    from public.messages m
    join public.channel_members cm on cm.channel_id = m.channel_id and cm.profile_id = v_me
    join public.channels c on c.id = m.channel_id
    left join public.profiles p on p.id = m.sender_id
   where m.academy_id = v_academy and m.is_announcement
     and m.status = 'published' and m.deleted_at is null
     and (m.relevant_until is null or m.relevant_until > now())
   order by m.created_at desc limit 1;

  -- Everywhere else this person belongs, for the one-tap switch.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id, 'name', o.name, 'type', o.type, 'role', o.role,
           'persona', (app_private.home_personas(o.id, v_me))[1],
           'primary_colour', o.primary_colour) order by o.name), '[]'::jsonb)
    into v_switch
    from public.my_organisations() o
   where o.id <> v_academy;

  return jsonb_build_object(
    'academy_id', v_academy,
    'role', v_role,
    'persona', v_persona,
    'hats', to_jsonb(v_personas),
    'jobs', v_jobs,
    'today', v_today,
    'announcement', v_ann,
    'switch', v_switch);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. A game's duties in a stable order (found by test-rls 205 on dev): two
--    duties rostered in one transaction share a created_at, so "the first
--    duty" could change between two reads. The squad's own order of titles
--    first (team_duties.position), then the title.
create or replace function public.event_duties(p_event uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  e public.events;
begin
  select * into e from public.events where id = p_event;
  if e.id is null or not coalesce(app_private.can_read_event(p_event), false) then
    return null;
  end if;
  return jsonb_build_object(
    'can_manage', e.team_id is not null and app_private.may_roster(e.team_id),
    'can_take', e.team_id is not null and (coalesce(app_private.is_team_member(e.team_id), false)),
    'titles', coalesce((select jsonb_agg(d.title order by d.position) from public.team_duties d where d.team_id = e.team_id), '[]'::jsonb),
    'duties', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', d.id, 'title', d.title, 'player_id', d.player_id,
               'player', (select coalesce(pl.preferred_name, split_part(pl.full_name, ' ', 1)) from public.players pl where pl.id = d.player_id),
               'family', app_private.family_name(d.player_id),
               'mine', coalesce(app_private.is_guardian_of(d.player_id), false),
               'requested_swap_at', d.requested_swap_at, 'swap_note', d.swap_note)
             order by coalesce((select td.position from public.team_duties td where td.team_id = e.team_id and td.title = d.title), 999), d.title, d.created_at)
        from public.event_duties d where d.event_id = p_event), '[]'::jsonb));
end;
$fn$;
