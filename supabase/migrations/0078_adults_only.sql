-- 0078_adults_only.sql
--
-- Nobody under 18 gets an account. Squadroom is for parents and coaches.
--
-- Children exist here as roster records — a name, a date of birth, a squad
-- number, a kit size — and never as users. A coach needs to know Leo plays
-- Saturday; Leo does not need a login to find that out, and giving him one
-- creates obligations and risks that buy nothing.
--
-- What it buys by NOT existing:
--
--   * The under-16 social media minimum age (in force 10 Dec 2025) applies to
--     child users. There will not be any.
--   * Most of the Children's Online Privacy Code (registration due 10 Dec
--     2026) concerns services children use. Squadroom is used by their
--     parents.
--   * Sport Integrity Australia's rule on adults messaging children
--     one-to-one stops being a thing we police and starts being a thing that
--     cannot happen.
--
-- Children still see fixtures, ladders and results — through the public match
-- centre at /c/<slug>, which needs no account and collects nothing. That is
-- how Dribl already does it: fv.dribl.com and the rest are ordinary public
-- websites.
--
-- This does NOT replace 0076. That migration pulls guardians into any private
-- chat containing a minor, and it stays: players.profile_id exists, the
-- 'player' role exists in the enum, and a rule enforced in one place is a rule
-- that survives exactly one person deciding sixteen-year-olds are fine
-- actually. Two independent guards, neither relying on the other.

-- ---------------------------------------------------------------------------
-- 1. The player role cannot be granted
--
-- Not removed from the enum: dropping an enum value is a rewrite of every
-- table that references it, and the value is load-bearing in 0076's
-- is_minor_profile. Refused at the door instead, with a message that says what
-- to do rather than only what went wrong.
-- ---------------------------------------------------------------------------
create or replace function app_private.refuse_player_accounts()
returns trigger
language plpgsql
security definer
set search_path = public as $fn$
begin
  if new.role = 'player' then
    raise exception
      'Squadroom accounts are for adults. Add the player to the squad under Teams, and invite their parent instead.'
      using errcode = '42501';
  end if;
  return new;
end;
$fn$;

drop trigger if exists academy_members_adults_only on public.academy_members;
create trigger academy_members_adults_only
  before insert or update of role on public.academy_members
  for each row execute function app_private.refuse_player_accounts();

-- ---------------------------------------------------------------------------
-- 2. A roster record cannot be given a login
--
-- players.profile_id was built for "a 16+ player gets their own login and
-- inherits this roster row" (0003). That is the feature being withdrawn. The
-- column stays because removing it would cascade through 0076 and the
-- directory, but nothing may point it at a person any more.
--
-- Refused regardless of date of birth, and deliberately so: a roster row is
-- the record of a child, and attaching an adult's account to one would make
-- that adult a player in every query that checks. If a coach's own child is on
-- the squad, the coach is a guardian, which is a different table.
-- ---------------------------------------------------------------------------
create or replace function app_private.refuse_player_logins()
returns trigger
language plpgsql
security definer
set search_path = public as $fn$
begin
  if new.profile_id is not null then
    raise exception
      'Players don''t have accounts. Link a parent under guardians instead — they can see and answer for this player.'
      using errcode = '42501';
  end if;
  return new;
end;
$fn$;

drop trigger if exists players_no_logins on public.players;
create trigger players_no_logins
  before insert or update of profile_id on public.players
  for each row execute function app_private.refuse_player_logins();

-- ---------------------------------------------------------------------------
-- 3. Clear anything that already slipped through
--
-- None exists today. A migration that is only correct against today's data is
-- a migration waiting to be wrong.
-- ---------------------------------------------------------------------------
do $$
declare
  v_logins integer;
  v_members integer;
begin
  select count(*) into v_logins from public.players where profile_id is not null;
  select count(*) into v_members from public.academy_members where role = 'player';

  if v_logins > 0 or v_members > 0 then
    raise notice 'adults-only: clearing % player logins and % player memberships', v_logins, v_members;
  end if;

  -- Triggers are BEFORE, so these would refuse their own cleanup.
  alter table public.players disable trigger players_no_logins;
  alter table public.academy_members disable trigger academy_members_adults_only;

  update public.players set profile_id = null where profile_id is not null;
  delete from public.academy_members where role = 'player';

  alter table public.players enable trigger players_no_logins;
  alter table public.academy_members enable trigger academy_members_adults_only;
end;
$$;

comment on column public.players.profile_id is
  'Always null. Kept because 0076 and the directory reference it, but 0078
   refuses any value: nobody under 18 has an account, and a roster row is the
   record of a child. Link a parent in player_guardians instead.';
