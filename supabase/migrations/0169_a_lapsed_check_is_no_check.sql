-- 0169: a lapsed check is no check.
--
-- W-03. 0120 stops a new coach being put in front of children without a
-- current Working With Children Check, and deliberately left existing
-- coaches alone so a club's Saturday was not taken away to make a point.
-- The gap it left: a check that EXPIRES, or comes back barred, changes
-- nothing — the coach keeps the roster, the sheets and the children's
-- channel until somebody notices on the board.
--
-- Now a check that has lapsed (expired, barred, or not on the register)
-- removes coaching rights on the spot: no roster, no sheets, no squads, no
-- posting in channels at that club. Membership stays — they can read, and
-- renew — because the point is to keep a lapsed adult from running a team
-- of children, not to lock them out of their own club. NOTHING RECORDED is
-- still the 0120 backlog, surfaced on the board, not blocked here: the
-- seed has coaches with no record and so will every club on day one.
--
-- And a REPORTABLE-CONDUCT REGISTER: the thing the Child Safe Standards
-- ask a club to keep and almost none do. Any member files one; only the
-- club's safeguarding officers (and the owner) read the register; the
-- reporter sees their own. Never a message, never public.

create or replace function app_private.clearance_lapsed(p_academy uuid, p_profile uuid)
returns boolean
language sql stable security definer set search_path = public as $fn$
  select coalesce((
    select c.outcome in ('barred', 'not_found')
        or (c.outcome in ('cleared', 'applied') and c.expires_on < (current_date at time zone 'utc')::date)
      from public.staff_clearances c
     where c.academy_id = p_academy and c.profile_id = p_profile
  ), false);
$fn$;

-- The four coaching helpers (public wrappers from 0011 are what the 0013
-- policies call; app_private ones are what everything since calls).
create or replace function public.is_academy_coach(p_academy uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(app_private.academy_role_of(p_academy) in ('owner', 'admin', 'coach'), false)
     and not app_private.clearance_lapsed(p_academy, auth.uid());
$$;

create or replace function app_private.is_academy_coach(p_academy uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(app_private.academy_role_of(p_academy) in ('owner', 'admin', 'coach'), false)
     and not app_private.clearance_lapsed(p_academy, auth.uid());
$$;

create or replace function public.is_team_coach(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (exists (
    select 1 from public.team_members
     where team_id = p_team and profile_id = auth.uid() and role = 'coach'
  ) or exists (
    select 1 from public.teams t
     where t.id = p_team and app_private.is_academy_staff(t.academy_id)
  ))
  and not exists (
    select 1 from public.teams t
     where t.id = p_team and app_private.clearance_lapsed(t.academy_id, auth.uid())
  );
$$;

create or replace function app_private.is_team_coach(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (exists (
    select 1 from public.team_members
     where team_id = p_team and profile_id = auth.uid() and role = 'coach'
  ) or exists (
    select 1 from public.teams t
     where t.id = p_team and app_private.is_academy_staff(t.academy_id)
  ))
  and not exists (
    select 1 from public.teams t
     where t.id = p_team and app_private.clearance_lapsed(t.academy_id, auth.uid())
  );
$$;

-- Posting: 0016's rules, after one more question.
create or replace function app_private.can_post_in_channel(
  p_channel  uuid,
  p_reply_to uuid default null
) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  c public.channels%rowtype;
begin
  select * into c from public.channels where id = p_channel;

  if c.id is null or c.status <> 'active' then
    return false;
  end if;

  if not app_private.is_channel_member(p_channel) then
    return false;
  end if;

  -- A lapsed check does not post to children, whatever else they are.
  if app_private.clearance_lapsed(c.academy_id, auth.uid()) then
    return false;
  end if;

  if app_private.is_channel_host(p_channel) then
    return true;
  end if;

  return case c.posting_mode
    when 'open'         then true
    when 'hosts_only'   then false
    when 'replies_only' then p_reply_to is not null
                             and exists (select 1 from public.messages m
                                          where m.id = p_reply_to
                                            and m.channel_id = p_channel)
    else false
  end;
end;
$$;

create or replace function public.can_post_in_channel(p_channel uuid, p_reply_to uuid default null)
returns boolean language sql stable security definer set search_path = public as $$
  select app_private.can_post_in_channel(p_channel, p_reply_to);
$$;

-- ---------------------------------------------------------------------
-- The reportable-conduct register
-- ---------------------------------------------------------------------
do $$ begin
  create type public.conduct_category as enum ('disclosure', 'allegation', 'concern', 'boundary_breach', 'other');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.conduct_status as enum ('open', 'referred', 'closed');
exception when duplicate_object then null; end $$;

create table if not exists public.conduct_reports (
  id                 uuid primary key default gen_random_uuid(),
  academy_id         uuid not null references public.academies(id) on delete cascade,
  reported_by        uuid not null references public.profiles(id) on delete cascade,
  category           public.conduct_category not null,
  occurred_on        date,
  subject_name       text,
  subject_profile_id uuid references public.profiles(id) on delete set null,
  involves_child     boolean not null default true,
  description        text not null check (length(btrim(description)) > 0),
  status             public.conduct_status not null default 'open',
  referred_to        text,
  outcome            text,
  reviewed_by        uuid references public.profiles(id) on delete set null,
  reviewed_at        timestamptz,
  created_at         timestamptz not null default now()
);
alter table public.conduct_reports enable row level security;
create policy conduct_reports_select on public.conduct_reports for select to authenticated
  using ((select app_private.is_safeguarding_officer(conduct_reports.academy_id)) or reported_by = (select auth.uid()));
create index if not exists conduct_reports_academy_idx on public.conduct_reports (academy_id, status, created_at);

create or replace function public.file_conduct_report(
  p_academy uuid, p_category public.conduct_category, p_description text,
  p_occurred_on date default null, p_subject_name text default null, p_subject_profile uuid default null, p_involves_child boolean default true
)
returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  v_id uuid;
begin
  if not coalesce(app_private.is_academy_member(p_academy), false) then
    raise exception 'only a member of the club files a report there' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_description, ''))) < 10 then
    raise exception 'say what happened, in a sentence or more' using errcode = '22023';
  end if;
  insert into public.conduct_reports (academy_id, reported_by, category, occurred_on, subject_name, subject_profile_id, involves_child, description)
  values (p_academy, auth.uid(), p_category, p_occurred_on, nullif(btrim(coalesce(p_subject_name, '')), ''), p_subject_profile, coalesce(p_involves_child, true), btrim(p_description))
  returning id into v_id;
  return v_id;
end;
$fn$;

create or replace function public.conduct_register(p_academy uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_academy uuid := app_private.my_academy(p_academy);
begin
  if v_academy is null or not coalesce(app_private.is_safeguarding_officer(v_academy), false) then
    return null;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', r.id, 'category', r.category, 'occurred_on', r.occurred_on, 'subject_name', r.subject_name,
             'subject', (select p.full_name from public.profiles p where p.id = r.subject_profile_id),
             'involves_child', r.involves_child, 'description', r.description, 'status', r.status,
             'referred_to', r.referred_to, 'outcome', r.outcome, 'created_at', r.created_at,
             'reporter', (select p.full_name from public.profiles p where p.id = r.reported_by),
             'reviewed_by', (select p.full_name from public.profiles p where p.id = r.reviewed_by), 'reviewed_at', r.reviewed_at
           ) order by (r.status = 'open') desc, r.created_at desc)
      from public.conduct_reports r
     where r.academy_id = v_academy
  ), '[]'::jsonb);
end;
$fn$;

create or replace function public.review_conduct_report(p_report uuid, p_status public.conduct_status, p_outcome text default null, p_referred_to text default null)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_academy uuid;
begin
  select academy_id into v_academy from public.conduct_reports where id = p_report;
  if v_academy is null or not coalesce(app_private.is_safeguarding_officer(v_academy), false) then
    raise exception 'only a safeguarding officer reviews a report' using errcode = '42501';
  end if;
  if p_status = 'referred' and length(btrim(coalesce(p_referred_to, ''))) = 0 then
    raise exception 'referred to whom? (police, the OCG, the federation…)' using errcode = '22023';
  end if;
  update public.conduct_reports
     set status = p_status,
         outcome = coalesce(nullif(btrim(coalesce(p_outcome, '')), ''), outcome),
         referred_to = coalesce(nullif(btrim(coalesce(p_referred_to, '')), ''), referred_to),
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_report;
end;
$fn$;

grant execute on function public.file_conduct_report(uuid, public.conduct_category, text, date, text, uuid, boolean) to authenticated;
grant execute on function public.conduct_register(uuid) to authenticated;
grant execute on function public.review_conduct_report(uuid, public.conduct_status, text, text) to authenticated;
