-- 0215: a teenager's own login, with a parent's yes (Joey, 5 Nov 2026).
--
-- Replaces 0078's "nobody under 18 has an account" (S-06). Now:
--
--   · Under 13: never. The parent manages them, as now.
--   · 13 and over: their own login — with their OWN email, and a guardian's
--     approval. There is no other way for a child to get one.
--
-- The route, and the only route:
--   1. A guardian, in My family, gives a 13-and-over child's email
--      (invite_player_login). Refused for an under-13, for a child with no
--      date of birth, and for the guardian's own address.
--   2. The teenager signs in with that address — proving it is theirs — and
--      their login is matched to the invitation (claim_player_login). It
--      waits: they see nothing of the club yet.
--   3. A guardian approves it (decide_player_login). Only then is the login
--      linked to the player and put in their squad.
--
-- The database holds the line, not the screens: 0078's two triggers now
-- refuse a player membership or a player link unless an APPROVED login for a
-- child of 13 or over says so, and a third refuses a 'player' place in a
-- squad on the same terms. 0076 still brings a child's guardians into any
-- private chat they are in: a child is never alone with an adult.
--
-- NOT DECIDED HERE (NEEDS JOEY #20): whether Squadroom counts as an
-- age-restricted social media platform under the under-16 rules, what the
-- privacy notice says to a 13-year-old, and junior referees, who can already
-- claim a login (0161) and are not covered by this route.
--
-- Unapplied until the Supabase access token is renewed (NEEDS JOEY #12);
-- test-rls checks 130–133.

create table if not exists public.player_logins (
  player_id   uuid primary key references public.players(id) on delete cascade,
  academy_id  uuid not null references public.academies(id) on delete cascade,
  email       citext not null
                check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
                check (email !~* '@squadroom\.invalid$'),
  invited_by  uuid not null references public.profiles(id) on delete cascade,
  profile_id  uuid references public.profiles(id) on delete set null,
  status      text not null default 'invited'
                check (status in ('invited', 'waiting', 'approved', 'refused', 'ended')),
  created_at  timestamptz not null default now(),
  claimed_at  timestamptz,
  decided_at  timestamptz,
  decided_by  uuid references public.profiles(id) on delete set null
);
alter table public.player_logins enable row level security;

-- The child's guardians, and the child once they have signed in. Nobody else
-- — not the club's staff, who see the player's record as always.
drop policy if exists player_logins_family on public.player_logins;
create policy player_logins_family on public.player_logins for select to authenticated
  using ((select app_private.is_guardian_of(player_id)) or profile_id = (select auth.uid()));

-- 13 or over today, by date of birth. No date of birth is not 13.
create or replace function app_private.is_thirteen(p_dob date)
returns boolean
language sql stable as $$
  select p_dob is not null and p_dob <= (current_date - interval '13 years')::date;
$$;

-- ================================================================ the route

create or replace function public.invite_player_login(p_player uuid, p_email text)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_me     uuid := auth.uid();
  v_player public.players;
  v_email  citext := lower(btrim(coalesce(p_email, '')));
  v_mine   text;
begin
  if v_me is null or not app_private.is_guardian_of(p_player) then
    raise exception 'only this child''s parent or guardian can set up their login' using errcode = '42501';
  end if;
  select * into v_player from public.players where id = p_player;
  if v_player.dob is null then
    raise exception 'Add their date of birth first: a login is for 13 and over.' using errcode = '22023';
  end if;
  if not app_private.is_thirteen(v_player.dob) then
    raise exception 'Under 13s don''t have their own login. You manage theirs, as now.' using errcode = '22023';
  end if;
  if v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' or v_email ~* '@squadroom\.invalid$' then
    raise exception 'That doesn''t look like an email address they read.' using errcode = '22023';
  end if;
  select u.email into v_mine from auth.users u where u.id = v_me;
  if lower(coalesce(v_mine, '')) = v_email
     or exists (select 1 from public.account_emails ae where ae.profile_id = v_me and ae.email = v_email) then
    raise exception 'That''s your address. Their login needs their own email.' using errcode = '22023';
  end if;
  if exists (select 1 from public.player_logins pl where pl.player_id = p_player and pl.status = 'approved') then
    raise exception 'They already have a login. End it first to change the email.' using errcode = '22023';
  end if;

  insert into public.player_logins (player_id, academy_id, email, invited_by, status)
  values (p_player, v_player.academy_id, v_email, v_me, 'invited')
  on conflict (player_id) do update
    set email = excluded.email, invited_by = excluded.invited_by, status = 'invited',
        profile_id = null, created_at = now(), claimed_at = null, decided_at = null, decided_by = null;

  return jsonb_build_object('player_id', p_player, 'email', v_email, 'status', 'invited');
end;
$$;

-- The teenager, signed in with the address their guardian gave: matched,
-- and waiting. Signing in with it is what proves it is theirs.
create or replace function public.claim_player_login()
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_me    uuid := auth.uid();
  v_email text;
  v_row   public.player_logins;
begin
  if v_me is null then
    return null;
  end if;
  select u.email into v_email from auth.users u where u.id = v_me and u.email_confirmed_at is not null;
  if v_email is null then
    return null;
  end if;

  -- An account already in a club as anything but a player is somebody's
  -- parent or coach, not a child's new login — even if the address matches
  -- (a parent who typed their partner's email for the child's).
  if exists (select 1 from public.academy_members am
              where am.profile_id = v_me and am.status = 'active' and am.role <> 'player') then
    return null;
  end if;

  -- One invitation, the newest, if a family used one address twice.
  update public.player_logins pl
     set profile_id = v_me, status = 'waiting', claimed_at = now()
   where pl.player_id = (
           select x.player_id from public.player_logins x
            where x.email = v_email::citext and x.status = 'invited'
            order by x.created_at desc limit 1)
  returning * into v_row;

  if v_row.player_id is null then
    select * into v_row from public.player_logins pl
     where pl.profile_id = v_me and pl.status in ('waiting', 'approved', 'refused')
     order by pl.created_at desc limit 1;
  end if;
  if v_row.player_id is null then
    return null;
  end if;

  return jsonb_build_object(
    'status', v_row.status,
    'first_name', (select coalesce(nullif(p.preferred_name, ''), split_part(p.full_name, ' ', 1)) from public.players p where p.id = v_row.player_id),
    'club', (select a.name from public.academies a where a.id = v_row.academy_id)
  );
end;
$$;

create or replace function public.decide_player_login(p_player uuid, p_approve boolean)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_me     uuid := auth.uid();
  v_row    public.player_logins;
  v_player public.players;
begin
  if v_me is null or not app_private.is_guardian_of(p_player) then
    raise exception 'only this child''s parent or guardian can approve their login' using errcode = '42501';
  end if;
  select * into v_row from public.player_logins where player_id = p_player;
  if v_row.player_id is null or v_row.status <> 'waiting' or v_row.profile_id is null then
    raise exception 'there is no login waiting for approval' using errcode = '22023';
  end if;

  if not coalesce(p_approve, false) then
    update public.player_logins
       set status = 'refused', decided_at = now(), decided_by = v_me
     where player_id = p_player;
    return jsonb_build_object('status', 'refused');
  end if;

  select * into v_player from public.players where id = p_player;
  if not app_private.is_thirteen(v_player.dob) then
    raise exception 'Under 13s don''t have their own login.' using errcode = '22023';
  end if;

  update public.player_logins
     set status = 'approved', decided_at = now(), decided_by = v_me
   where player_id = p_player;

  -- In this order: each step is allowed by the approval just written.
  update public.players set profile_id = v_row.profile_id where id = p_player;
  insert into public.academy_members (academy_id, profile_id, role, status)
  values (v_player.academy_id, v_row.profile_id, 'player', 'active')
  on conflict (academy_id, profile_id) do update set role = 'player', status = 'active';
  if v_player.team_id is not null then
    insert into public.team_members (academy_id, team_id, profile_id, role)
    values (v_player.academy_id, v_player.team_id, v_row.profile_id, 'player')
    on conflict (team_id, profile_id) do nothing;
  end if;

  return jsonb_build_object('status', 'approved');
end;
$$;

create or replace function public.end_player_login(p_player uuid)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_me  uuid := auth.uid();
  v_row public.player_logins;
begin
  if v_me is null or not app_private.is_guardian_of(p_player) then
    raise exception 'only this child''s parent or guardian can end their login' using errcode = '42501';
  end if;
  select * into v_row from public.player_logins where player_id = p_player;
  if v_row.player_id is null then
    return jsonb_build_object('status', null);
  end if;

  update public.player_logins
     set status = 'ended', decided_at = now(), decided_by = v_me
   where player_id = p_player;
  if v_row.profile_id is not null then
    update public.players set profile_id = null where id = p_player and profile_id = v_row.profile_id;
    delete from public.team_members where profile_id = v_row.profile_id and role = 'player'
       and team_id in (select team_id from public.players where id = p_player);
    delete from public.academy_members where profile_id = v_row.profile_id and role = 'player'
       and academy_id = v_row.academy_id;
  end if;
  return jsonb_build_object('status', 'ended');
end;
$$;

-- ============================================== the database holds the line

create or replace function app_private.refuse_player_accounts()
returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if new.role = 'player' and not exists (
    select 1
      from public.player_logins pl
      join public.players p on p.id = pl.player_id
     where pl.profile_id = new.profile_id
       and pl.status = 'approved'
       and p.academy_id = new.academy_id
       and app_private.is_thirteen(p.dob)
  ) then
    raise exception
      'A player''s own login needs them to be 13 or over and a parent''s approval (My family). Add the player to the squad under Teams, and invite their parent instead.'
      using errcode = '42501';
  end if;
  return new;
end;
$fn$;

create or replace function app_private.refuse_player_logins()
returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if new.profile_id is not null and (
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

-- Re-made to watch the date of birth too: a linked player's birthday cannot
-- be moved under 13 while they have a login.
drop trigger if exists players_no_logins on public.players;
create trigger players_no_logins
  before insert or update of profile_id, dob on public.players
  for each row execute function app_private.refuse_player_logins();

create or replace function app_private.refuse_squad_player_places()
returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if new.role = 'player' and not exists (
    select 1
      from public.player_logins pl
      join public.players p on p.id = pl.player_id
     where pl.profile_id = new.profile_id
       and pl.status = 'approved'
       and p.team_id = new.team_id
       and app_private.is_thirteen(p.dob)
  ) then
    raise exception 'A player''s place in a squad comes with a login a parent has approved.'
      using errcode = '42501';
  end if;
  return new;
end;
$fn$;

drop trigger if exists team_members_players_need_approval on public.team_members;
create trigger team_members_players_need_approval
  before insert or update of role, profile_id on public.team_members
  for each row execute function app_private.refuse_squad_player_places();

comment on column public.players.profile_id is
  'The player''s own login: only for 13 and over, and only once a guardian has approved it (0215, player_logins). Under 13s never have one.';

-- When a login is erased (0214's trigger), the invitation goes with it.
create or replace function app_private.on_profile_erased_logins()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.player_logins set profile_id = null, status = 'ended' where profile_id = new.id;
  return new;
end;
$$;
drop trigger if exists profiles_erased_end_logins on public.profiles;
create trigger profiles_erased_end_logins
  after update of erased_at on public.profiles
  for each row when (new.erased_at is not null and old.erased_at is null)
  execute function app_private.on_profile_erased_logins();

revoke execute on function app_private.refuse_squad_player_places() from public, anon, authenticated;
revoke execute on function app_private.on_profile_erased_logins() from public, anon, authenticated;

revoke execute on function public.invite_player_login(uuid, text) from public, anon;
grant execute on function public.invite_player_login(uuid, text) to authenticated;
revoke execute on function public.claim_player_login() from public, anon;
grant execute on function public.claim_player_login() to authenticated;
revoke execute on function public.decide_player_login(uuid, boolean) from public, anon;
grant execute on function public.decide_player_login(uuid, boolean) to authenticated;
revoke execute on function public.end_player_login(uuid) from public, anon;
grant execute on function public.end_player_login(uuid) to authenticated;
