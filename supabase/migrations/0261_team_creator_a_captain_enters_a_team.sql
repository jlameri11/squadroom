-- 0261: Team Creator — a captain enters a team of their own
--
-- Part C (Joey, 10 Nov 2026), item 3: for social comps and tournaments, a
-- captain registers a team, gets a join code, teammates join and pay their
-- share or the captain pays, the organiser approves.
--
-- Built on the entry request the public page already takes (0185's
-- request_competition_entry, the organiser's decide_entry_request): the
-- same form, ticked "I'm a captain entering my own team" with how many
-- players and who pays. On acceptance the team is made in the organiser's
-- own organisation (a captain has no club), the entry gets a six-letter
-- join code, and the entry fee is raised as for any entry. Teammates join
-- from /c/{slug}/team/{code} with a name, a mobile, an email and a date of
-- birth — adults only; under-18s play through a club — and land on the
-- squad, the sheet's season squad and the team's chat. The first joiner
-- whose mobile or email is the one on the request is the captain: the
-- team's manager, with the code to share. Pay: "split" raises one fee per
-- player for their share through the money the app already moves;
-- "captain" leaves the entry fee for the captain to pay the organiser, who
-- marks it as for any club. The organiser's `team_creator` switch gates
-- the whole thing.

-- ---------------------------------------------------------------------------
-- 1. What a captain's request and entry carry.
alter table public.competition_entry_requests
  add column if not exists captain    boolean not null default false,
  add column if not exists squad_size integer check (squad_size is null or squad_size between 5 and 30),
  add column if not exists pay_mode   text check (pay_mode is null or pay_mode in ('split', 'captain'));
alter table public.competition_entries
  add column if not exists join_code  text,
  add column if not exists captain_id uuid references public.profiles(id) on delete set null,
  add column if not exists pay_mode   text check (pay_mode is null or pay_mode in ('split', 'captain')),
  add column if not exists squad_size integer check (squad_size is null or squad_size between 5 and 30);
create unique index if not exists competition_entries_join_code on public.competition_entries (join_code) where join_code is not null;

-- ---------------------------------------------------------------------------
-- 2. The public request, with a captain's three more answers.
drop function if exists public.request_competition_entry(text, text, text, text, text, text, text, text, text);
create or replace function public.request_competition_entry(
  p_slug text, p_club_name text, p_team_name text, p_division text,
  p_contact_name text, p_contact_phone text, p_contact_email text, p_note text, p_ip_hash text,
  p_captain boolean default false, p_squad_size integer default null, p_pay_mode text default null
)
returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  v_comp   uuid;
  v_org    uuid;
  v_recent integer;
  v_id     uuid;
  v_club   text := btrim(coalesce(p_club_name, ''));
begin
  select id, organiser_id into v_comp, v_org from public.competitions
   where public_slug = p_slug and published_at is not null and entries_open;
  if v_comp is null then
    raise exception 'That competition isn''t taking entries.' using errcode = '22023';
  end if;
  if p_captain then
    if not app_private.feature_on(v_org, 'team_creator') then
      raise exception 'This competition takes entries from clubs, not from captains.' using errcode = '22023';
    end if;
    if p_squad_size is null or p_squad_size not between 5 and 30 then
      raise exception 'How many players — between 5 and 30.' using errcode = '22023';
    end if;
    if p_pay_mode not in ('split', 'captain') then
      raise exception 'Who pays — split between the players, or the captain.' using errcode = '22023';
    end if;
    if v_club = '' then
      v_club := btrim(p_team_name);
    end if;
  end if;
  select count(*) into v_recent from public.competition_entry_requests
   where ip_hash = p_ip_hash and created_at > now() - interval '1 hour';
  if v_recent >= 10 then
    raise exception 'Too many entries just now. Try again shortly.' using errcode = '22023';
  end if;
  if exists (select 1 from public.competition_entry_requests
              where competition_id = v_comp and status = 'pending'
                and lower(btrim(club_name)) = lower(v_club) and lower(btrim(team_name)) = lower(btrim(p_team_name))) then
    raise exception 'That team has already asked to enter; the organiser will be in touch.' using errcode = '23505';
  end if;
  insert into public.competition_entry_requests
    (competition_id, club_name, team_name, division, contact_name, contact_phone, contact_email, note, ip_hash, captain, squad_size, pay_mode)
  values (v_comp, v_club, btrim(p_team_name), nullif(btrim(coalesce(p_division, '')), ''),
          btrim(p_contact_name), nullif(btrim(coalesce(p_contact_phone, '')), ''), nullif(btrim(coalesce(p_contact_email, '')), ''),
          nullif(btrim(coalesce(p_note, '')), ''), p_ip_hash,
          coalesce(p_captain, false), case when p_captain then p_squad_size end, case when p_captain then p_pay_mode end)
  returning id into v_id;
  return v_id;
end;
$fn$;
revoke all on function public.request_competition_entry(text, text, text, text, text, text, text, text, text, boolean, integer, text) from public, anon, authenticated;
-- As before (0185): the route calls it as the service role after the IP hash.

-- A join code nobody will misread: no 0/O, 1/I.
create or replace function app_private.new_join_code()
returns text
language plpgsql volatile as $fn$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
begin
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::integer, 1);
    end loop;
    exit when not exists (select 1 from public.competition_entries e where e.join_code = v_code);
  end loop;
  return v_code;
end;
$fn$;
revoke execute on function app_private.new_join_code() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The organiser decides. A captain's accepted entry becomes a team in the
--    organiser's organisation, with a join code instead of a club's invite.
create or replace function public.decide_entry_request(p_request uuid, p_accept boolean, p_division text default null, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_req public.competition_entry_requests;
  v_comp public.competitions;
  v_division text;
  v_entry uuid;
  v_invite uuid;
  v_token text;
  v_team uuid;
  v_code text;
begin
  select * into v_req from public.competition_entry_requests where id = p_request;
  if v_req.id is null or not app_private.may_run(v_req.competition_id, 'competition') then
    raise exception 'only the organiser decides an entry' using errcode = '42501';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'already %', v_req.status using errcode = '22023';
  end if;
  if not p_accept then
    update public.competition_entry_requests
       set status = 'declined', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), '')
     where id = p_request;
    return jsonb_build_object('status', 'declined');
  end if;
  v_division := coalesce(nullif(btrim(coalesce(p_division, '')), ''), v_req.division);
  if v_division is null then
    raise exception 'which division?' using errcode = '22023';
  end if;

  if v_req.captain then
    -- 0261: a captain's team lives with the organiser; the code is its door.
    select * into v_comp from public.competitions where id = v_req.competition_id;
    insert into public.teams (academy_id, name, age_group, season, status)
    values (v_comp.organiser_id, v_req.team_name, 'Open', coalesce(v_comp.season, to_char(now(), 'YYYY')), 'active')
    returning id into v_team;
    v_code := app_private.new_join_code();
    insert into public.competition_entries (competition_id, academy_id, team_id, display_name, division, join_code, pay_mode, squad_size)
    values (v_req.competition_id, v_comp.organiser_id, v_team, v_req.team_name, v_division, v_code, v_req.pay_mode, v_req.squad_size)
    on conflict (competition_id, division, display_name) do update
      set team_id = excluded.team_id, academy_id = excluded.academy_id, join_code = excluded.join_code,
          pay_mode = excluded.pay_mode, squad_size = excluded.squad_size
    returning id into v_entry;
    update public.competition_entry_requests
       set status = 'accepted', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), ''),
           entry_id = v_entry, division = v_division
     where id = p_request;
    return jsonb_build_object('status', 'accepted', 'entry_id', v_entry, 'team_id', v_team, 'join_code', v_code);
  end if;

  insert into public.competition_entries (competition_id, display_name, division)
  values (v_req.competition_id, v_req.team_name, v_division)
  on conflict (competition_id, division, display_name) do update set display_name = excluded.display_name
  returning id into v_entry;
  insert into public.competition_invites (competition_id, entry_id, club_name, contact_name, contact_email, contact_phone, invited_by)
  values (v_req.competition_id, v_entry, v_req.club_name, v_req.contact_name,
          case when v_req.contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then v_req.contact_email::citext end,
          case when v_req.contact_phone ~ '^\+[1-9][0-9]{7,14}$' then v_req.contact_phone end,
          auth.uid())
  returning id, token into v_invite, v_token;
  update public.competition_entry_requests
     set status = 'accepted', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), ''),
         entry_id = v_entry, invite_id = v_invite, division = v_division
   where id = p_request;
  return jsonb_build_object('status', 'accepted', 'entry_id', v_entry, 'token', v_token);
end;
$fn$;

-- The organiser's codes to hand out: each captain's team, its code, its link
-- and how full it is.
create or replace function public.captain_teams(p_competition uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
begin
  if auth.uid() is null or not app_private.may_run(p_competition, 'competition') then
    return null;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'entry_id', e.id, 'team_id', e.team_id, 'team_name', e.display_name, 'division', e.division,
             'join_code', e.join_code, 'pay_mode', e.pay_mode, 'squad_size', e.squad_size,
             'members', (select count(*) from public.entry_squads s where s.entry_id = e.id),
             'captain', (select nullif(btrim(p.full_name), '') from public.profiles p where p.id = e.captain_id),
             'contact', (select r.contact_name from public.competition_entry_requests r where r.entry_id = e.id limit 1))
           order by e.display_name)
      from public.competition_entries e
     where e.competition_id = p_competition and e.join_code is not null
  ), '[]'::jsonb);
end;
$fn$;
revoke execute on function public.captain_teams(uuid) from public, anon;
grant execute on function public.captain_teams(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Joining by the code.
create or replace function public.public_captain_team(p_slug text, p_code text)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_comp public.competitions;
  e      public.competition_entries;
  v_fee  integer;
  v_n    integer;
begin
  select * into v_comp from public.competitions
   where public_slug = p_slug and published_at is not null and public_slug is not null;
  if v_comp.id is null or not app_private.feature_on(v_comp.organiser_id, 'team_creator') then
    return null;
  end if;
  select * into e from public.competition_entries where competition_id = v_comp.id and join_code = upper(btrim(p_code));
  if e.id is null then
    return null;
  end if;
  v_fee := app_private.fee_for(v_comp.id, e.division);
  select count(*) into v_n from public.entry_squads s where s.entry_id = e.id;
  return jsonb_build_object(
    'competition', v_comp.name, 'season', v_comp.season,
    'organiser', (select a.name from public.academies a where a.id = v_comp.organiser_id),
    'team_name', e.display_name, 'division', e.division,
    'squad_size', e.squad_size, 'members', v_n, 'open', e.squad_size is null or v_n < e.squad_size,
    'pay_mode', e.pay_mode, 'fee_cents', v_fee,
    'share_cents', case when e.pay_mode = 'split' and v_fee is not null and coalesce(e.squad_size, 0) > 0 then ceil(v_fee::numeric / e.squad_size)::integer end,
    'has_captain', e.captain_id is not null);
end;
$fn$;
revoke all on function public.public_captain_team(text, text) from public;
grant execute on function public.public_captain_team(text, text) to anon, authenticated;

-- The person joins: as themselves (the route, as the service role, after
-- making their account), an adult, while there is room. They land on the
-- organiser's books as a player, on the squad, on the season squad the
-- sheet reads, and in the team's chat (the team row's trigger). The first
-- to join with the request's mobile or email is the captain. "Split"
-- raises the share once, as one fee per player on the team.
create or replace function public.join_captain_team(p_code text, p_profile uuid, p_full_name text, p_dob date)
returns jsonb
language plpgsql volatile security definer set search_path = public as $fn$
declare
  e        public.competition_entries;
  v_comp   public.competitions;
  v_req    public.competition_entry_requests;
  v_n      integer;
  v_player uuid;
  v_fee    integer;
  v_share  integer;
  v_captain boolean := false;
  v_phone  text;
  v_email  text;
  v_request uuid;
begin
  if p_profile is null or (auth.uid() is distinct from p_profile and coalesce(auth.jwt() ->> 'role', '') <> 'service_role') then
    raise exception 'join as yourself' using errcode = '42501';
  end if;
  select * into e from public.competition_entries where join_code = upper(btrim(coalesce(p_code, '')));
  if e.id is null then
    raise exception 'no team has that code' using errcode = '22023';
  end if;
  select * into v_comp from public.competitions where id = e.competition_id;
  if not app_private.feature_on(v_comp.organiser_id, 'team_creator') then
    raise exception 'this competition does not take captains'' teams' using errcode = '22023';
  end if;
  if p_dob is null or p_dob > (current_date - interval '18 years') then
    raise exception 'captains'' teams are for adults — under-18s play through a club' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_full_name, '')), '') is null then
    raise exception 'your name' using errcode = '22023';
  end if;
  -- Already on it: nothing to do but say so.
  select pl.id into v_player from public.players pl where pl.academy_id = v_comp.organiser_id and pl.profile_id = p_profile and pl.team_id = e.team_id limit 1;
  if v_player is null then
    select count(*) into v_n from public.entry_squads s where s.entry_id = e.id;
    if e.squad_size is not null and v_n >= e.squad_size then
      raise exception 'the team is full (% players)', e.squad_size using errcode = '22023';
    end if;
    -- Their own player record first: the guards that let a player's own
    -- membership and squad place through read it (0239).
    update public.profiles set full_name = coalesce(nullif(btrim(full_name), ''), btrim(p_full_name)) where id = p_profile;
    insert into public.players (academy_id, team_id, full_name, dob, profile_id)
    values (v_comp.organiser_id, e.team_id, btrim(p_full_name), p_dob, p_profile)
    returning id into v_player;
    -- The organiser's books: a player's hat added, never a hat taken (0237).
    insert into public.academy_members (academy_id, profile_id, role, roles, status)
    values (v_comp.organiser_id, p_profile, 'player', array['player']::public.academy_role[], 'active')
    on conflict (academy_id, profile_id) do update
      set roles = (select coalesce(array_agg(distinct x), '{}'::public.academy_role[]) from unnest(public.academy_members.roles || 'player'::public.academy_role) x),
          status = 'active';
    insert into public.team_members (academy_id, team_id, profile_id, role)
    values (v_comp.organiser_id, e.team_id, p_profile, 'player')
    on conflict (team_id, profile_id) do nothing;
    insert into public.entry_squads (competition_id, entry_id, academy_id, player_id, added_by)
    values (e.competition_id, e.id, v_comp.organiser_id, v_player, p_profile)
    on conflict do nothing;
  end if;

  -- The captain: the request's contact, by mobile or email.
  if e.captain_id is null then
    select r.* into v_req from public.competition_entry_requests r where r.entry_id = e.id limit 1;
    select p.phone into v_phone from public.profiles p where p.id = p_profile;
    select ae.email::text into v_email from public.account_emails ae where ae.profile_id = p_profile limit 1;
    if v_req.id is not null and (
         (v_req.contact_phone is not null and v_phone is not null and v_req.contact_phone = v_phone)
      or (v_req.contact_email is not null and v_email is not null and lower(v_req.contact_email) = lower(v_email))) then
      update public.competition_entries set captain_id = p_profile where id = e.id;
      insert into public.club_roles (academy_id, profile_id, role, scope_kind, team_id, granted_by)
      values (v_comp.organiser_id, p_profile, 'team_manager', 'team', e.team_id, p_profile)
      on conflict on constraint club_roles_once do nothing;
      v_captain := true;
    end if;
  else
    v_captain := e.captain_id = p_profile;
  end if;

  -- The share, once, when the team pays as players.
  v_fee := app_private.fee_for(e.competition_id, e.division);
  if e.pay_mode = 'split' and v_fee is not null and coalesce(e.squad_size, 0) > 0 then
    v_share := ceil(v_fee::numeric / e.squad_size)::integer;
    select pr.id into v_request from public.payment_requests pr
     where pr.academy_id = v_comp.organiser_id and pr.team_id = e.team_id and pr.competition_id = e.competition_id limit 1;
    if v_request is null then
      insert into public.payment_requests (academy_id, title, description, amount_cents, per_player, team_id, competition_id, due_on, created_by)
      values (v_comp.organiser_id, v_comp.name || ' — ' || e.display_name || ' entry',
              'Your share of the team''s entry fee (' || e.squad_size || ' ways).', v_share, true, e.team_id, e.competition_id,
              (now() at time zone 'Australia/Sydney')::date + 14, p_profile)
      returning id into v_request;
    end if;
  end if;

  return jsonb_build_object('team_id', e.team_id, 'entry_id', e.id, 'team_name', e.display_name, 'competition', v_comp.name,
                            'captain', v_captain, 'share_cents', v_share, 'join_code', case when v_captain then e.join_code end,
                            'members', (select count(*) from public.entry_squads s where s.entry_id = e.id), 'squad_size', e.squad_size);
end;
$fn$;
revoke execute on function public.join_captain_team(text, uuid, text, date) from public, anon;
grant execute on function public.join_captain_team(text, uuid, text, date) to authenticated;

-- The team's own page: the code, for whoever runs the team.
create or replace function public.team_join_code(p_team uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  e public.competition_entries;
  v_slug text;
begin
  if auth.uid() is null or not (coalesce(app_private.is_team_coach(p_team), false) or app_private.runs_team(p_team, true)) then
    return null;
  end if;
  select * into e from public.competition_entries where team_id = p_team and join_code is not null order by created_at desc limit 1;
  if e.id is null then
    return null;
  end if;
  select public_slug into v_slug from public.competitions where id = e.competition_id;
  return jsonb_build_object('join_code', e.join_code, 'slug', v_slug, 'competition', (select name from public.competitions where id = e.competition_id),
                            'members', (select count(*) from public.entry_squads s where s.entry_id = e.id), 'squad_size', e.squad_size,
                            'pay_mode', e.pay_mode, 'captain', e.captain_id = auth.uid());
end;
$fn$;
revoke execute on function public.team_join_code(uuid) from public, anon;
grant execute on function public.team_join_code(uuid) to authenticated;

-- The public page's switches: the breakdown and, now, captains' teams.
create or replace function public.public_switches(p_slug text)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_org uuid;
begin
  select organiser_id into v_org from public.competitions
   where public_slug = p_slug and published_at is not null and public_slug is not null;
  if v_org is null then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('ladder_breakdown', app_private.feature_on(v_org, 'ladder_breakdown'),
                            'team_creator', app_private.feature_on(v_org, 'team_creator'));
end;
$fn$;

insert into app_private.anon_callable (proname, why) values
  ('public_captain_team', 'the join page for a captain''s team: the team''s name, how full it is, the share — nobody''s name')
on conflict (proname) do update set why = excluded.why;

-- The organiser's list carries the captain's three answers (0185's reader, plus three keys).
create or replace function public.entry_requests(p_competition uuid)
returns jsonb
language sql stable security definer set search_path = public as $fn$
  select case
    when not app_private.may_run(p_competition, 'competition') then null
    else coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'club_name', r.club_name, 'team_name', r.team_name, 'division', r.division,
               'contact_name', r.contact_name, 'contact_phone', r.contact_phone, 'contact_email', r.contact_email,
               'note', r.note, 'status', r.status, 'created_at', r.created_at, 'decided_at', r.decided_at, 'decision_note', r.decision_note,
               'token', (select ci.token from public.competition_invites ci where ci.id = r.invite_id and ci.status = 'pending'),
               'captain', r.captain, 'squad_size', r.squad_size, 'pay_mode', r.pay_mode
             ) order by (r.status = 'pending') desc, r.created_at)
        from public.competition_entry_requests r
       where r.competition_id = p_competition
    ), '[]'::jsonb)
  end;
$fn$;
