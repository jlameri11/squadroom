-- 0232: the second step is a six-digit code by text, and a device can be trusted.
--
-- Joey, 9 Nov 2026: "no authenticator apps — too hard for volunteers."
--   * For owners, admins and league staff of an organisation that requires
--     two-step sign-in (0231), the second step is a six-digit code sent by
--     SMS (Twilio Verify), or by email when the account has no mobile. Still
--     compulsory for those roles.
--   * "Trust this device for 30 days": asked again only after 30 days, or on
--     a device the account has not been seen on.
--   * An authenticator app stays an OPTIONAL choice in Settings, for anyone
--     who wants one; it is never required (0224's gate still honours it).
--   * Parents, coaches and players: unchanged.
--
-- How the database knows a session has passed: a row in two_step_passes for
-- the session's id (the `session_id` claim every Supabase token carries,
-- stable across refreshes), written only after the code was checked — by
-- two_step_pass, which the server calls with the service role once Twilio
-- Verify (or our own hashed code) says yes. app_private.two_step_ok_for
-- accepts either proof: AAL2 from an authenticator app, or a live pass.
-- Nothing a browser holds can write a pass; it can only ask whether a
-- trusted device is known (two_step_trust_this_session), which mints a pass
-- for the new session from the device's remaining trust.
--
-- Codes we generate ourselves (email, and demo accounts) are stored as a
-- salted SHA-256; an SMS code is Twilio's and never touches us.

-- ================================================================ tables

create table if not exists public.two_step_passes (
  session_id    uuid primary key,
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  passed_at     timestamptz not null default now(),
  trusted_until timestamptz not null
);
create index if not exists two_step_passes_profile on public.two_step_passes (profile_id);
alter table public.two_step_passes enable row level security;
-- No policies: the service role and the functions below are the only writers,
-- and nothing needs to read it but app_private.two_step_passed().

create table if not exists public.trusted_devices (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  device_hash   text not null,
  label         text,
  trusted_until timestamptz not null,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz not null default now(),
  constraint trusted_devices_once unique (profile_id, device_hash)
);
alter table public.trusted_devices enable row level security;
drop policy if exists trusted_devices_select_own on public.trusted_devices;
create policy trusted_devices_select_own on public.trusted_devices for select to authenticated
  using (profile_id = (select auth.uid()));
-- Written by two_step_pass and two_step_forget_devices only.

create table if not exists public.two_step_codes (
  profile_id        uuid primary key references public.profiles(id) on delete cascade,
  channel           text not null check (channel in ('sms', 'email', 'demo')),
  sent_to           text not null,            -- masked, for the screen ("•••• 301")
  destination       text not null,            -- where it went, for Twilio's check
  code_hash         text,                     -- ours (email, demo); null when Twilio holds the code
  salt              text,
  expires_at        timestamptz not null,
  attempts          integer not null default 0,
  sends             integer not null default 1,
  window_started_at timestamptz not null default now(),
  created_at        timestamptz not null default now()
);
alter table public.two_step_codes enable row level security;
-- No policies: the server (service role) is the only reader and writer.

-- ============================================================== helpers

-- The session's id, from the token. Null for a stranger, and for a token
-- without one (none Supabase issues today).
create or replace function app_private.session_id()
returns uuid
language plpgsql stable security definer set search_path = public as $fn$
begin
  return nullif(coalesce(auth.jwt() ->> 'session_id', ''), '')::uuid;
exception when others then
  return null;
end;
$fn$;

-- Has this session passed the second step, and is that pass still good?
create or replace function app_private.two_step_passed()
returns boolean
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_session uuid := app_private.session_id();
begin
  if v_session is null or auth.uid() is null then
    return false;
  end if;
  return exists (
    select 1 from public.two_step_passes p
     where p.session_id = v_session
       and p.profile_id = auth.uid()
       and p.trusted_until > now());
end;
$fn$;

-- 0231's rule, with the second proof: where the organisation requires
-- two-step, an owner, admin or league staff member has their powers at AAL2
-- (an authenticator app) OR with a live pass (a code by text or email).
-- Elsewhere, 0224's rule stands: someone who chose an authenticator app is
-- held to it; everyone else is untouched.
create or replace function app_private.two_step_ok_for(p_academy uuid)
returns boolean
language plpgsql stable security definer set search_path = public as $fn$
begin
  if exists (select 1 from public.academies a where a.id = p_academy and a.two_step_required) then
    return coalesce(auth.jwt() ->> 'aal', '') = 'aal2' or app_private.two_step_passed();
  end if;
  return app_private.two_step_ok();
end;
$fn$;

-- What the app needs to know to decide whether to ask (two-step-wall.tsx):
--   required  one of my organisations requires it of my role
--   where     that organisation's name
--   enrolled  an authenticator app is set up (optional)
--   aal2      this session proved an authenticator code
--   passed    this session has a live pass (a code by text/email, or a
--             trusted device)
--   ok        either proof — nothing to ask
--   trusted_until  when the pass runs out
create or replace function public.two_step_status()
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_where text;
  v_aal2 boolean := coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
  v_passed boolean := app_private.two_step_passed();
begin
  if auth.uid() is null then
    return null;
  end if;
  select a.name into v_where from public.academies a
   where a.two_step_required
     and (exists (select 1 from public.academy_members am
                   where am.academy_id = a.id and am.profile_id = auth.uid() and am.status = 'active' and am.role in ('owner', 'admin'))
          or exists (select 1 from public.league_roles lr where lr.academy_id = a.id and lr.profile_id = auth.uid()))
   order by a.name
   limit 1;
  return jsonb_build_object(
    'required', v_where is not null,
    'where', v_where,
    'enrolled', exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified'),
    'aal2', v_aal2,
    'passed', v_passed,
    'ok', v_aal2 or v_passed,
    'trusted_until', (select p.trusted_until from public.two_step_passes p
                       where p.session_id = app_private.session_id() and p.profile_id = auth.uid() and p.trusted_until > now()));
end;
$fn$;

-- ================================================================ passing

-- The server's word that the code was right (Twilio Verify said "approved",
-- or our hashed code matched). SERVICE ROLE ONLY. Mints the pass for that
-- session — 30 days when the person asked to trust the device, otherwise
-- twelve hours, a day's work — and, when trusted, remembers the device so
-- the next sign-in on it needs no code.
create or replace function public.two_step_pass(
  p_profile uuid,
  p_session uuid,
  p_trust   boolean default false,
  p_device  text default null,
  p_label   text default null
) returns jsonb
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_until timestamptz;
  v_hash  text;
begin
  if p_profile is null or p_session is null then
    raise exception 'a pass names a person and a session' using errcode = '22023';
  end if;
  v_until := now() + case when coalesce(p_trust, false) then interval '30 days' else interval '12 hours' end;

  -- Yesterday's passes go, so the table holds only what counts.
  delete from public.two_step_passes where profile_id = p_profile and trusted_until <= now();

  insert into public.two_step_passes (session_id, profile_id, passed_at, trusted_until)
  values (p_session, p_profile, now(), v_until)
  on conflict (session_id) do update
    set profile_id = excluded.profile_id, passed_at = now(), trusted_until = excluded.trusted_until;

  if coalesce(p_trust, false) and nullif(btrim(coalesce(p_device, '')), '') is not null then
    v_hash := encode(sha256(convert_to(p_device, 'UTF8')), 'hex');
    insert into public.trusted_devices (profile_id, device_hash, label, trusted_until, last_used_at)
    values (p_profile, v_hash, left(nullif(btrim(coalesce(p_label, '')), ''), 80), v_until, now())
    on conflict (profile_id, device_hash) do update
      set trusted_until = excluded.trusted_until, label = coalesce(excluded.label, public.trusted_devices.label), last_used_at = now();
  end if;

  return jsonb_build_object('trusted_until', v_until, 'device_trusted', coalesce(p_trust, false) and p_device is not null);
end;
$fn$;

-- A new session on a device this account trusted within the last 30 days
-- gets a pass without a code. The browser hands over the device's token;
-- only its hash is kept, so a copy of the table opens nothing.
create or replace function public.two_step_trust_this_session(p_device text)
returns jsonb
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_me      uuid := auth.uid();
  v_session uuid := app_private.session_id();
  v_hash    text;
  v_until   timestamptz;
begin
  if v_me is null then
    raise exception 'must be signed in' using errcode = '42501';
  end if;
  if v_session is null or nullif(btrim(coalesce(p_device, '')), '') is null then
    return jsonb_build_object('trusted', false);
  end if;
  v_hash := encode(sha256(convert_to(p_device, 'UTF8')), 'hex');
  select d.trusted_until into v_until
    from public.trusted_devices d
   where d.profile_id = v_me and d.device_hash = v_hash and d.trusted_until > now();
  if v_until is null then
    return jsonb_build_object('trusted', false);
  end if;

  insert into public.two_step_passes (session_id, profile_id, passed_at, trusted_until)
  values (v_session, v_me, now(), v_until)
  on conflict (session_id) do update
    set trusted_until = greatest(public.two_step_passes.trusted_until, excluded.trusted_until)
    where public.two_step_passes.profile_id = v_me;
  update public.trusted_devices set last_used_at = now()
   where profile_id = v_me and device_hash = v_hash;

  return jsonb_build_object('trusted', true, 'trusted_until', v_until);
end;
$fn$;

-- Settings → "Forget my trusted devices": every device, and every other
-- session's pass. This session keeps its own (they are holding the phone).
create or replace function public.two_step_forget_devices()
returns integer
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_me uuid := auth.uid();
  n integer;
begin
  if v_me is null then
    raise exception 'must be signed in' using errcode = '42501';
  end if;
  delete from public.trusted_devices where profile_id = v_me;
  get diagnostics n = row_count;
  delete from public.two_step_passes
   where profile_id = v_me and session_id is distinct from app_private.session_id();
  return n;
end;
$fn$;

-- ================================================================= grants

revoke execute on function public.two_step_pass(uuid, uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.two_step_pass(uuid, uuid, boolean, text, text) to service_role;
revoke execute on function public.two_step_status() from public, anon;
grant execute on function public.two_step_status() to authenticated;
revoke execute on function public.two_step_trust_this_session(text) from public, anon;
grant execute on function public.two_step_trust_this_session(text) to authenticated;
revoke execute on function public.two_step_forget_devices() from public, anon;
grant execute on function public.two_step_forget_devices() to authenticated;
revoke execute on function app_private.session_id() from public, anon, authenticated;
revoke execute on function app_private.two_step_passed() from public, anon, authenticated;
