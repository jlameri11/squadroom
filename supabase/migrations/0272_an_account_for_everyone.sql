-- 0272 — An account for everyone (Joey's sign-up and account creation brief,
-- 12 Nov 2026; BUILD_PLAN item 17).
--
-- Every way in — a coach's link, QR or code, a club's own sign-up, a public
-- registration — now goes through one account: first, middle and last name,
-- email, mobile, a password, and a six-digit code to the email before anything
-- opens. This migration is the database's half:
--
--   1. Names in three parts. profiles keeps full_name (131 migrations and 44
--      files read it) and gains first_name, middle_name and last_name; a
--      trigger keeps the two in step whichever is written. Existing names are
--      split on the LAST space ("Mary Anne Smith" is Mary Anne + Smith) and
--      the odd ones — one word, more than three, a digit — are flagged for the
--      club to check.
--   2. Email codes: six digits, ten minutes, five tries, a resend after thirty
--      seconds and five an hour per address. Kept hashed and salted; a demo
--      address's code is kept in clear so the screen can show it. No policy at
--      all: a browser never reads a code.
--   3. What the server's account routes need to know, with the service role:
--      whether an email or a mobile is already an account, confirmed, with a
--      password. And what the signed-in person's own screens need: my_account.
--   4. "Anyone without a password sets one next time they sign in — Not now
--      allowed once": the once is user_settings.password_deferred_at, and
--      whether a password was ever set is user_settings.password_set_at
--      (auth.users cannot say — see below).

-- ===================================================================== 1. names

alter table public.profiles
  add column if not exists first_name        text    not null default '',
  add column if not exists middle_name       text,
  add column if not exists last_name         text    not null default '',
  add column if not exists name_check_needed boolean not null default false;

-- Everyone in the club can read a name's parts as they read full_name (the
-- column grant is per column here, 0012); the flag and the middle name are
-- the person's own and the club's.
grant select (first_name, last_name) on public.profiles to authenticated;

-- Split on the LAST space. One word is a first name alone.
create or replace function app_private.name_first(p_full text)
returns text
language sql immutable as $$
  select case when position(' ' in n) = 0 then n else left(n, length(n) - position(' ' in reverse(n))) end
    from (select regexp_replace(btrim(coalesce(p_full, '')), '\s+', ' ', 'g') as n) s;
$$;

create or replace function app_private.name_last(p_full text)
returns text
language sql immutable as $$
  select case when position(' ' in n) = 0 then '' else reverse(split_part(reverse(n), ' ', 1)) end
    from (select regexp_replace(btrim(coalesce(p_full, '')), '\s+', ' ', 'g') as n) s;
$$;

-- Odd enough for a person to look at: one word, more than three, a digit, an
-- @ (an address typed as a name). An erased profile ('Removed', 0127) is not odd.
create or replace function app_private.name_looks_odd(p_full text)
returns boolean
language sql immutable as $$
  select n <> '' and n <> 'Removed'
     and (position(' ' in n) = 0
          or array_length(regexp_split_to_array(n, ' '), 1) > 3
          or n ~ '[0-9@_/\\]')
    from (select regexp_replace(btrim(coalesce(p_full, '')), '\s+', ' ', 'g') as n) s;
$$;

-- Everyone already here, before the trigger exists, so full_name stays
-- byte-for-byte what it was.
update public.profiles
   set first_name        = app_private.name_first(full_name),
       last_name         = app_private.name_last(full_name),
       name_check_needed = app_private.name_looks_odd(full_name)
 where first_name = '' and last_name = '';

-- The parts and the whole, kept in step. Written parts (the forms, the
-- club) make the whole; a written whole (set_my_profile, an importer, the
-- erasure) is re-split and re-judged.
create or replace function public.profiles_name_sync()
returns trigger
language plpgsql as $fn$
declare
  v_full  text := regexp_replace(btrim(coalesce(new.full_name, '')), '\s+', ' ', 'g');
  v_parts text;
begin
  new.first_name  := regexp_replace(btrim(coalesce(new.first_name, '')), '\s+', ' ', 'g');
  new.middle_name := nullif(regexp_replace(btrim(coalesce(new.middle_name, '')), '\s+', ' ', 'g'), '');
  new.last_name   := regexp_replace(btrim(coalesce(new.last_name, '')), '\s+', ' ', 'g');
  v_parts := concat_ws(' ', nullif(new.first_name, ''), nullif(new.last_name, ''));

  if tg_op = 'INSERT' then
    if v_parts <> '' then
      new.full_name := v_parts;
    else
      new.first_name        := app_private.name_first(v_full);
      new.last_name         := app_private.name_last(v_full);
      new.full_name         := v_full;
      new.name_check_needed := app_private.name_looks_odd(v_full);
    end if;
  elsif (new.first_name, new.middle_name, new.last_name) is distinct from (old.first_name, old.middle_name, old.last_name) then
    new.full_name := case when v_parts <> '' then v_parts else v_full end;
    -- A person (or their club) typed the parts: nothing left to check.
    if v_parts <> '' then new.name_check_needed := false; end if;
  elsif v_full is distinct from regexp_replace(btrim(coalesce(old.full_name, '')), '\s+', ' ', 'g') then
    new.first_name        := app_private.name_first(v_full);
    new.last_name         := app_private.name_last(v_full);
    new.full_name         := v_full;
    new.name_check_needed := app_private.name_looks_odd(v_full);
  end if;
  return new;
end;
$fn$;

drop trigger if exists profiles_name_sync on public.profiles;
create trigger profiles_name_sync
  before insert or update of full_name, first_name, middle_name, last_name on public.profiles
  for each row execute function public.profiles_name_sync();

-- A new account made by the sign-up route carries its parts in the
-- metadata; one made the old way (a placeholder from a phone) carries only
-- full_name, which the trigger splits.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, phone, full_name, first_name, middle_name, last_name)
  values (
    new.id,
    public.normalise_phone(new.phone),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'first_name', ''),
    nullif(new.raw_user_meta_data ->> 'middle_name', ''),
    coalesce(new.raw_user_meta_data ->> 'last_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ===================================================== 3. the person's own

alter table public.user_settings
  add column if not exists password_deferred_at timestamptz,
  add column if not exists password_set_at      timestamptz;

-- Whether a PERSON has set a password cannot be read from auth.users:
-- Supabase gives an account made without one (a placeholder from a mobile,
-- a magic-link sign-up, the sign-up route before its code is confirmed) a
-- random hash nobody knows, which looks exactly like a real one. So it is
-- recorded here by whatever sets a password — the account routes, the
-- "Set a password" screens (mark_password_set), the demo seed — and read
-- from here by my_account and account_lookup.
comment on column public.user_settings.password_set_at is
  'When this person set a password themselves. auth.users.encrypted_password cannot say: an account made without a password carries a random hash.';

-- The demo accounts all have one (docs/DEMO.md, scripts/demo-passwords.mjs).
insert into public.user_settings (profile_id, password_set_at)
select p.id, now()
  from public.profiles p
  join auth.users u on u.id = p.id
 where u.email ilike '%@squadroom-demo.test'
on conflict (profile_id) do update
  set password_set_at = coalesce(public.user_settings.password_set_at, now());

create or replace function public.mark_password_set()
returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  insert into public.user_settings (profile_id, password_set_at)
  values (v_me, now())
  on conflict (profile_id) do update
    set password_set_at = now(), updated_at = now();
  return true;
end;
$$;
revoke execute on function public.mark_password_set() from public, anon;
grant execute on function public.mark_password_set() to authenticated;

-- Everything the account screens need in one read: the name's parts, the
-- mobile, the email, whether there is a password yet, whether "Not now" has
-- been used. Nobody else's, ever.
create or replace function public.my_account()
returns jsonb
language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null then null else jsonb_build_object(
    'id', p.id,
    'first_name', p.first_name,
    'middle_name', p.middle_name,
    'last_name', p.last_name,
    'full_name', p.full_name,
    'name_check_needed', p.name_check_needed,
    'phone', p.phone::text,
    'sign_in_email', case when u.email ilike '%@squadroom.invalid' then null else u.email end,
    'placeholder', u.email ilike '%@squadroom.invalid',
    'email', ae.email,
    'email_verified', ae.verified_at is not null,
    'has_password', s.password_set_at is not null,
    'password_deferred', s.password_deferred_at is not null
  ) end
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.account_emails ae on ae.profile_id = p.id
    left join public.user_settings s on s.profile_id = p.id
   where p.id = auth.uid();
$$;
revoke execute on function public.my_account() from public, anon;
grant execute on function public.my_account() to authenticated;

create or replace function public.set_my_name(p_first text, p_middle text default null, p_last text default null)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if btrim(coalesce(p_first, '')) = '' or btrim(coalesce(p_last, '')) = '' then
    raise exception 'First name and last name, please.' using errcode = '22023';
  end if;
  if length(p_first) > 80 or length(coalesce(p_middle, '')) > 80 or length(p_last) > 80 then
    raise exception 'That name is too long.' using errcode = '22023';
  end if;
  update public.profiles
     set first_name = p_first, middle_name = p_middle, last_name = p_last, name_check_needed = false
   where id = v_me;
  return public.my_account();
end;
$$;
revoke execute on function public.set_my_name(text, text, text) from public, anon;
grant execute on function public.set_my_name(text, text, text) to authenticated;

-- "Not now", once. True when this was the once; false when it was used before.
create or replace function public.defer_password()
returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare
  v_me   uuid := auth.uid();
  v_used boolean;
begin
  if v_me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select password_deferred_at is not null into v_used from public.user_settings where profile_id = v_me;
  if coalesce(v_used, false) then
    return false;
  end if;
  insert into public.user_settings (profile_id, password_deferred_at)
  values (v_me, now())
  on conflict (profile_id) do update
    set password_deferred_at = now(), updated_at = now();
  return true;
end;
$$;
revoke execute on function public.defer_password() from public, anon;
grant execute on function public.defer_password() to authenticated;

-- The club checks an odd name: its staff see who is flagged, and may set
-- the parts for a member of their own club.
create or replace function public.names_to_check(p_academy uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select case when coalesce(app_private.is_academy_staff(p_academy), false) then
    coalesce((select jsonb_agg(jsonb_build_object('profile_id', p.id, 'full_name', p.full_name, 'first_name', p.first_name, 'last_name', p.last_name) order by p.full_name)
                from public.academy_members m
                join public.profiles p on p.id = m.profile_id
               where m.academy_id = p_academy and m.status = 'active' and p.name_check_needed), '[]'::jsonb)
  else '[]'::jsonb end;
$$;
revoke execute on function public.names_to_check(uuid) from public, anon;
grant execute on function public.names_to_check(uuid) to authenticated;

create or replace function public.set_member_name(p_academy uuid, p_profile uuid, p_first text, p_middle text default null, p_last text default null)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null or not coalesce(app_private.is_academy_staff(p_academy), false) then
    raise exception 'only the club''s staff may do this' using errcode = '42501';
  end if;
  if not exists (select 1 from public.academy_members where academy_id = p_academy and profile_id = p_profile and status = 'active') then
    raise exception 'not a member of this club' using errcode = '42501';
  end if;
  if btrim(coalesce(p_first, '')) = '' or btrim(coalesce(p_last, '')) = '' then
    raise exception 'First name and last name, please.' using errcode = '22023';
  end if;
  update public.profiles
     set first_name = p_first, middle_name = p_middle, last_name = p_last, name_check_needed = false
   where id = p_profile;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.set_member_name(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.set_member_name(uuid, uuid, text, text, text) to authenticated;

-- ================================================================ 2. the codes

create table if not exists public.email_codes (
  id          uuid primary key default gen_random_uuid(),
  email       citext not null,
  purpose     text not null check (purpose in ('confirm', 'sign_in', 'reset')),
  channel     text not null default 'email' check (channel in ('email', 'demo')),
  code_hash   text not null,
  salt        text not null,
  -- Only a demo address's (docs/DEMO.md): shown on the screen, never sent.
  demo_code   text check (demo_code is null or channel = 'demo'),
  -- The account the code is for; null until a sign-up's account exists.
  user_id     uuid,
  -- What the sign-up typed, applied when the code is confirmed (the names,
  -- the mobile, whether an existing phone-joined account is being adopted).
  payload     jsonb not null default '{}'::jsonb,
  ip_hash     text,
  attempts    integer not null default 0,
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists email_codes_email_purpose_idx on public.email_codes (email, purpose, created_at desc);
create index if not exists email_codes_ip_idx on public.email_codes (ip_hash, created_at desc);
alter table public.email_codes enable row level security;
-- No policy at all. Supabase's default privileges would hand anon and
-- authenticated the table (0269 learnt this): taken back explicitly.
revoke all on public.email_codes from public, anon, authenticated;
comment on table public.email_codes is
  'The six-digit codes emailed to confirm a sign-up, sign in without a password, or reset one. Hashed and salted; a demo address''s in clear for the screen. Service role only — a browser never reads a code.';

-- May another code go to this address now? Thirty seconds between sends,
-- five an hour an address, sixty an hour an IP. The server asks before
-- sending; the answer says how long to wait.
create or replace function public.email_code_allowed(p_email text, p_purpose text, p_ip_hash text)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_email citext := lower(btrim(coalesce(p_email, '')));
  v_last  timestamptz;
  v_hour  integer;
  v_ip    integer;
begin
  delete from public.email_codes where created_at < now() - interval '2 days';
  select max(created_at) into v_last from public.email_codes where email = v_email and purpose = p_purpose;
  if v_last is not null and v_last > now() - interval '30 seconds' then
    return jsonb_build_object('ok', false, 'reason', 'wait',
                              'wait', greatest(1, ceil(extract(epoch from (v_last + interval '30 seconds' - now())))::integer));
  end if;
  select count(*) into v_hour from public.email_codes where email = v_email and created_at > now() - interval '1 hour';
  if v_hour >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'hour', 'wait', 3600);
  end if;
  if p_ip_hash is not null then
    select count(*) into v_ip from public.email_codes where ip_hash = p_ip_hash and created_at > now() - interval '1 hour';
    if v_ip >= 60 then
      return jsonb_build_object('ok', false, 'reason', 'ip', 'wait', 3600);
    end if;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.email_code_allowed(text, text, text) from public, anon, authenticated;
grant execute on function public.email_code_allowed(text, text, text) to service_role;

-- ======================================================= 3. the server's look-up

-- Is this email, or this mobile, already somebody? The sign-up route asks
-- before making an account: an address that is already a confirmed sign-in
-- is told to sign in; a mobile that is already on an account is not taken
-- over by whoever types it; an address a phone-joined parent gave their
-- club (account_emails) lets that parent claim their existing account by
-- proving the address. Service role only: it reads auth.users.
create or replace function public.account_lookup(p_email text, p_phone text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_email      citext := lower(btrim(coalesce(p_email, '')));
  v_phone      text   := nullif(btrim(coalesce(p_phone, '')), '');
  v_by_email   jsonb;
  v_by_account jsonb;
  v_by_phone   jsonb;
begin
  select jsonb_build_object(
           'user_id', u.id,
           'confirmed', u.email_confirmed_at is not null,
           'has_password', s.password_set_at is not null,
           'placeholder', u.email ilike '%@squadroom.invalid',
           'last_sign_in_at', u.last_sign_in_at)
    into v_by_email
    from auth.users u
    left join public.user_settings s on s.profile_id = u.id
   where lower(u.email) = v_email::text
   limit 1;

  select jsonb_build_object(
           'profile_id', ae.profile_id,
           'user_email', u.email,
           'confirmed', u.email_confirmed_at is not null,
           'has_password', s.password_set_at is not null,
           'placeholder', u.email ilike '%@squadroom.invalid',
           'phone', p.phone::text)
    into v_by_account
    from public.account_emails ae
    join auth.users u on u.id = ae.profile_id
    join public.profiles p on p.id = ae.profile_id
    left join public.user_settings s on s.profile_id = ae.profile_id
   where ae.email = v_email
   limit 1;

  if v_phone is not null then
    select jsonb_build_object(
             'profile_id', p.id,
             'user_email', u.email,
             'placeholder', u.email ilike '%@squadroom.invalid',
             'has_password', s.password_set_at is not null,
             'account_email', ae.email)
      into v_by_phone
      from public.profiles p
      join auth.users u on u.id = p.id
      left join public.account_emails ae on ae.profile_id = p.id
      left join public.user_settings s on s.profile_id = p.id
     where p.phone = v_phone::citext
     limit 1;
  end if;

  return jsonb_build_object('by_email', v_by_email, 'by_account_email', v_by_account, 'by_phone', v_by_phone);
end;
$$;
revoke all on function public.account_lookup(text, text) from public, anon, authenticated;
grant execute on function public.account_lookup(text, text) to service_role;
