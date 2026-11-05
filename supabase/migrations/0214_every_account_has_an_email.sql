-- 0214: every account has an email (Joey, 5 Nov 2026).
--
-- Parents, guardians, coaches, staff, referees, organisers: everyone gives an
-- email — when they join (one field, beside the mobile), when they register
-- a child, and, for the accounts that already exist without one, once, on
-- their next open (a single screen they cannot skip). Any address is fine:
-- it never has to match PlayFootball's, which is the login complaint people
-- have about Dribl. It is confirmed with a one-tap link. Signing in with a
-- phone keeps working.
--
-- WHY A TABLE OF ITS OWN, and not the sign-in address. A parent who joined
-- by phone signs in through a placeholder address made from their number
-- (lib/join.ts, `p614…@squadroom.invalid`), and the claim routes find them by
-- it. Put a real address there and the next approve-and-claim mints a
-- brand-new empty account (it has happened once, to Joey's). So the address
-- a person gives lives here, beside the sign-in, and nothing that signs
-- people in changes.
--
-- WHO SEES IT: the person, and the staff of their own organisation (Admin →
-- Members, member_emails). Never another club's staff, never a league, never
-- in a share or an export: account_emails has one policy, "your own", and
-- the only other way out is member_emails, which checks the organisation.
-- A league's notices are emailed by the server, which reads the addresses
-- and never hands them to anyone (notice_email_recipients, service role
-- only).
--
-- "SEND ME NEWS AND OFFERS FROM SQUADROOM" is separate, unticked, never
-- required, and stored with the time it was given — and every change is kept
-- in news_consents, because "they agreed" means nothing without when.
-- Club and league notices never need it.
--
-- Unapplied until the Supabase access token is renewed (NEEDS JOEY #12);
-- test-rls checks 124–129.

-- ================================================================ tables

create table if not exists public.account_emails (
  profile_id     uuid primary key references public.profiles(id) on delete cascade,
  email          citext not null
                   check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
                   check (email !~* '@squadroom\.invalid$'),
  verified_at    timestamptz,
  news_opt_in_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table public.account_emails enable row level security;
drop policy if exists account_emails_own on public.account_emails;
create policy account_emails_own on public.account_emails for select to authenticated
  using (profile_id = (select auth.uid()));
-- Written only through set_my_email, set_my_news and the server's confirm.

drop trigger if exists account_emails_set_updated_at on public.account_emails;
create trigger account_emails_set_updated_at
  before update on public.account_emails
  for each row execute function public.set_updated_at();

create table if not exists public.news_consents (
  id         bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  opted_in   boolean not null,
  email      citext,
  at         timestamptz not null default now()
);
alter table public.news_consents enable row level security;
drop policy if exists news_consents_own on public.news_consents;
create policy news_consents_own on public.news_consents for select to authenticated
  using (profile_id = (select auth.uid()));

-- One-tap confirmation links. Only a hash is kept; the link is the token.
create table if not exists public.email_confirmations (
  token_hash text primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  email      citext not null,
  expires_at timestamptz not null default now() + interval '7 days',
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
alter table public.email_confirmations enable row level security;
-- No policies: the server (service role) writes and redeems them.

-- Which notices have been emailed to whom — so a notice is emailed once.
create table if not exists public.notice_emails (
  message_id  uuid not null references public.messages(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  sent_at     timestamptz not null default now(),
  provider_id text,
  primary key (message_id, profile_id)
);
alter table public.notice_emails enable row level security;
-- No policies: the server's.

-- Joining asks for it beside the mobile; approval copies it to the account.
alter table public.join_requests add column if not exists email citext;
alter table public.join_requests drop constraint if exists join_requests_email_shape;
alter table public.join_requests add constraint join_requests_email_shape
  check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');

-- ==================================================== the sign-in address

-- Someone who signed up with a real address has given it already, and
-- confirmed it by using the link. Kept in step: a new account with a real
-- address gets its row, and confirming the sign-in address confirms it here.
create or replace function public.handle_user_email()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email is null or new.email ilike '%@squadroom.invalid' then
    return new;
  end if;
  insert into public.account_emails (profile_id, email, verified_at)
  values (new.id, new.email, new.email_confirmed_at)
  on conflict (profile_id) do update
    set verified_at = coalesce(public.account_emails.verified_at, excluded.verified_at)
    where public.account_emails.email = excluded.email;
  return new;
end;
$$;
revoke execute on function public.handle_user_email() from public, anon, authenticated;

drop trigger if exists on_auth_user_email_kept on auth.users;
create trigger on_auth_user_email_kept
  after insert or update of email, email_confirmed_at on auth.users
  for each row execute function public.handle_user_email();

-- Everyone who already signed up with a real address.
insert into public.account_emails (profile_id, email, verified_at)
select u.id, u.email, u.email_confirmed_at
  from auth.users u
  join public.profiles p on p.id = u.id
 where u.email is not null
   and u.email !~* '@squadroom\.invalid$'
   and u.email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
on conflict (profile_id) do nothing;

-- ===================================================== the person's own

-- What the email screen and Settings need: the address, whether it is
-- confirmed, the news opt-in, and whether to ask at all.
create or replace function public.my_email()
returns jsonb
language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null then null else jsonb_build_object(
    'email', ae.email,
    'verified', ae.verified_at is not null,
    'news', ae.news_opt_in_at is not null,
    'needs_email', ae.profile_id is null
  ) end
  from (select auth.uid() as id) me
  left join public.account_emails ae on ae.profile_id = me.id;
$$;

create or replace function public.set_my_email(p_email text, p_news boolean default null)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_me      uuid := auth.uid();
  v_email   citext := lower(btrim(coalesce(p_email, '')));
  v_signin  text;
  v_was     public.account_emails;
begin
  if v_me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'That doesn''t look like an email address.' using errcode = '22023';
  end if;
  if v_email ~* '@squadroom\.invalid$' then
    raise exception 'That address can''t receive email. Use one you read.' using errcode = '22023';
  end if;

  select * into v_was from public.account_emails where profile_id = v_me;
  select u.email into v_signin from auth.users u where u.id = v_me and u.email_confirmed_at is not null;

  insert into public.account_emails (profile_id, email, verified_at)
  values (v_me, v_email, case when lower(v_signin) = v_email then now() end)
  on conflict (profile_id) do update
    set email = excluded.email,
        verified_at = case
          when public.account_emails.email = excluded.email then public.account_emails.verified_at
          else excluded.verified_at
        end;

  if p_news is not null then
    perform public.set_my_news(p_news);
  end if;

  return public.my_email();
end;
$$;

create or replace function public.set_my_news(p_news boolean)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_me  uuid := auth.uid();
  v_now boolean;
begin
  if v_me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select news_opt_in_at is not null into v_now from public.account_emails where profile_id = v_me;
  if v_now is null then
    raise exception 'add your email first' using errcode = '22023';
  end if;
  if v_now is distinct from coalesce(p_news, false) then
    update public.account_emails
       set news_opt_in_at = case when coalesce(p_news, false) then now() end
     where profile_id = v_me;
    insert into public.news_consents (profile_id, opted_in, email)
    select v_me, coalesce(p_news, false), ae.email from public.account_emails ae where ae.profile_id = v_me;
  end if;
  return public.my_email();
end;
$$;

-- ======================================= staff: their own members, only

create or replace function public.member_emails(p_academy uuid)
returns table (profile_id uuid, email citext, verified boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not app_private.is_academy_staff(p_academy) then
    raise exception 'only this organisation''s owners and admins see its members'' emails'
      using errcode = '42501';
  end if;
  return query
    select ae.profile_id, ae.email, ae.verified_at is not null
      from public.account_emails ae
      join public.academy_members am
        on am.profile_id = ae.profile_id
       and am.academy_id = p_academy
       and am.status = 'active';
end;
$$;

-- ====================================== the server's: emailing a notice

-- Everyone a notice is for, with a confirmed address, not yet emailed it —
-- and why they are getting it, for the footer. For the server only: these
-- are addresses from every club in the competition, and nobody in it sees
-- anybody else's.
create or replace function public.notice_email_recipients(p_message uuid)
returns table (profile_id uuid, email citext, standing text, competition text, league text, reply_to citext)
language sql stable security definer set search_path = public as $$
  select np.profile_id, ae.email, np.standing, comp.name, org.name, org.contact_email
    from public.messages m
    join public.channels ch on ch.id = m.channel_id and ch.type = 'notices'
    join public.competitions comp on comp.id = ch.competition_id
    join public.academies org on org.id = comp.organiser_id
    cross join lateral app_private.notices_people(ch.competition_id) np
    join public.account_emails ae on ae.profile_id = np.profile_id and ae.verified_at is not null
   where m.id = p_message
     and m.status = 'published'
     and m.deleted_at is null
     and np.profile_id <> m.sender_id
     and (m.audience = 'everyone' or np.standing in ('league', 'staff'))
     and not exists (select 1 from public.notice_emails ne
                      where ne.message_id = m.id and ne.profile_id = np.profile_id);
$$;

-- ======================================================== erasing a person

-- erase_me (0127) blanks the profile rather than deleting it, so what this
-- migration adds is removed when it does.
create or replace function app_private.on_profile_erased()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.account_emails where profile_id = new.id;
  delete from public.news_consents where profile_id = new.id;
  delete from public.email_confirmations where profile_id = new.id;
  delete from public.notice_reads where profile_id = new.id;
  delete from public.notice_emails where profile_id = new.id;
  return new;
end;
$$;
revoke execute on function app_private.on_profile_erased() from public, anon, authenticated;

drop trigger if exists profiles_erased_forget_email on public.profiles;
create trigger profiles_erased_forget_email
  after update of erased_at on public.profiles
  for each row when (new.erased_at is not null and old.erased_at is null)
  execute function app_private.on_profile_erased();

-- ================================================================ grants

revoke execute on function public.my_email() from public, anon;
grant execute on function public.my_email() to authenticated;
revoke execute on function public.set_my_email(text, boolean) from public, anon;
grant execute on function public.set_my_email(text, boolean) to authenticated;
revoke execute on function public.set_my_news(boolean) from public, anon;
grant execute on function public.set_my_news(boolean) to authenticated;
revoke execute on function public.member_emails(uuid) from public, anon;
grant execute on function public.member_emails(uuid) to authenticated;
revoke execute on function public.notice_email_recipients(uuid) from public, anon, authenticated;
grant execute on function public.notice_email_recipients(uuid) to service_role;
