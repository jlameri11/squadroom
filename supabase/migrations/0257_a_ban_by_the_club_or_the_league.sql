-- 0257: a ban, by the club or the league
--
-- Part C (Joey, 10 Nov 2026), item 2: a club or a league bans a person — a
-- parent, a spectator, a coach or a player — for a period, with a reason.
-- While it runs: no RSVP, no posting, no team sheet. Staff only; in the
-- activity log.
--
-- One table, three kinds of person: someone with an account (profile_id), a
-- child on the roster (player_id), or a name alone (a spectator the club
-- knows only by sight — a record, nothing to enforce). A ban belongs to an
-- organisation: the club's holds in the club's chats, events and squads; the
-- league's (its organiser) holds in the league's rooms and on every team
-- sheet in its competitions. It runs from a day to a day, or until lifted.
--
-- Enforced where the write happens, not only where the screen asks:
--   * RSVPs — a trigger on event_rsvps (every path: the policy, the
--     coach-on-behalf, the outbox, a poll that became an event);
--   * posting — can_post_in_channel says no (the composer hides) AND a
--     trigger on messages refuses (nothing slips past the screen);
--   * team sheets — ineligibility names the ban first, so the league's sheet
--     refuses the player and says why; a club's lineup refuses them too.
-- The person is told when it starts and when it is lifted; the log has both.

-- ---------------------------------------------------------------------------
-- 1. The table.
create table if not exists public.bans (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  profile_id  uuid references public.profiles(id) on delete cascade,
  player_id   uuid references public.players(id) on delete cascade,
  person_name text check (person_name is null or length(person_name) <= 120),
  reason      text not null check (btrim(reason) <> '' and length(reason) <= 500),
  starts_on   date not null default (now() at time zone 'Australia/Sydney')::date,
  ends_on     date,
  note        text check (note is null or length(note) <= 1000),
  issued_by   uuid references public.profiles(id) on delete set null,
  issued_at   timestamptz not null default now(),
  lifted_by   uuid references public.profiles(id) on delete set null,
  lifted_at   timestamptz,
  lift_note   text check (lift_note is null or length(lift_note) <= 500),
  constraint bans_someone check (profile_id is not null or player_id is not null or (person_name is not null and btrim(person_name) <> '')),
  constraint bans_dates check (ends_on is null or ends_on >= starts_on)
);
create index if not exists bans_academy_active on public.bans (academy_id, profile_id, player_id) where lifted_at is null;
alter table public.bans enable row level security;

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
    'role_request', 'role_decided', 'ban']));
end $$;

-- ---------------------------------------------------------------------------
-- 2. Who may ban (the club's staff, its President and Welfare officer; the
--    league's staff, competition manager and discipline officer), and
--    whether someone is banned here today.
create or replace function app_private.may_ban(p_academy uuid)
returns boolean
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_roles public.league_role[];
begin
  if auth.uid() is null or p_academy is null then
    return false;
  end if;
  if coalesce(app_private.is_academy_staff(p_academy), false) or app_private.may_run_club(p_academy, 'welfare') then
    return true;
  end if;
  v_roles := app_private.league_roles_of(p_academy);
  return 'discipline_officer' = any (v_roles) or 'competition_manager' = any (v_roles);
end;
$fn$;
revoke execute on function app_private.may_ban(uuid) from public, anon;
grant execute on function app_private.may_ban(uuid) to authenticated;

-- The ban that holds today for this person here, if any: by their account,
-- by their roster record, or by the account their roster record belongs to.
create or replace function app_private.ban_now(p_academy uuid, p_profile uuid, p_player uuid)
returns public.bans
language sql stable security definer set search_path = public as $fn$
  select b.* from public.bans b
   where b.academy_id = p_academy
     and b.lifted_at is null
     and b.starts_on <= (now() at time zone 'Australia/Sydney')::date
     and (b.ends_on is null or b.ends_on >= (now() at time zone 'Australia/Sydney')::date)
     and (
       (p_profile is not null and b.profile_id = p_profile)
       or (p_player is not null and b.player_id = p_player)
       or (p_player is not null and b.profile_id is not null
           and b.profile_id = (select pl.profile_id from public.players pl where pl.id = p_player))
     )
   order by b.ends_on nulls first
   limit 1;
$fn$;
revoke execute on function app_private.ban_now(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function app_private.ban_words(p_academy uuid, p_profile uuid, p_player uuid)
returns text
language plpgsql stable security definer set search_path = public as $fn$
declare
  b public.bans;
begin
  if p_academy is null then
    return null;
  end if;
  b := app_private.ban_now(p_academy, p_profile, p_player);
  if b.id is null then
    return null;
  end if;
  return 'banned'
      || case when b.ends_on is not null then ' until ' || to_char(b.ends_on, 'FMDD Mon') else '' end
      || ' — ' || b.reason;
end;
$fn$;
revoke execute on function app_private.ban_words(uuid, uuid, uuid) from public, anon, authenticated;

-- Used from a policy and from can_post_in_channel: the signed-in person,
-- here, today.
create or replace function app_private.banned_here(p_academy uuid)
returns boolean
language sql stable security definer set search_path = public as $fn$
  select auth.uid() is not null and (app_private.ban_now(p_academy, auth.uid(), null)).id is not null;
$fn$;
revoke execute on function app_private.banned_here(uuid) from public, anon;
grant execute on function app_private.banned_here(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Reading: those who may ban, and the person themselves (a parent sees
--    their own; a guardian sees their child's).
drop policy if exists bans_select on public.bans;
create policy bans_select on public.bans for select to authenticated
  using ((select app_private.may_ban(academy_id))
         or profile_id = (select auth.uid())
         or (player_id is not null and (select app_private.is_guardian_of(player_id))));
-- No insert, update or delete policy: ban_person and lift_ban write.

-- ---------------------------------------------------------------------------
-- 4. The three hard stops.
create or replace function app_private.refuse_banned_rsvp()
returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  v_academy uuid;
  v_words   text;
begin
  select academy_id into v_academy from public.events where id = new.event_id;
  v_words := app_private.ban_words(v_academy, new.profile_id, new.player_id);
  if v_words is not null then
    raise exception 'no answer while %', v_words using errcode = '42501';
  end if;
  return new;
end;
$fn$;
drop trigger if exists event_rsvps_refuse_banned on public.event_rsvps;
create trigger event_rsvps_refuse_banned
  before insert or update on public.event_rsvps
  for each row execute function app_private.refuse_banned_rsvp();

create or replace function app_private.refuse_banned_message()
returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  v_academy uuid;
  v_words   text;
begin
  select academy_id into v_academy from public.channels where id = new.channel_id;
  v_words := app_private.ban_words(v_academy, new.sender_id, null);
  if v_words is not null then
    raise exception 'no posting while %', v_words using errcode = '42501';
  end if;
  return new;
end;
$fn$;
drop trigger if exists messages_refuse_banned on public.messages;
create trigger messages_refuse_banned
  before insert on public.messages
  for each row execute function app_private.refuse_banned_message();

create or replace function app_private.refuse_banned_lineup()
returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  v_words text;
  v_name  text;
begin
  v_words := app_private.ban_words(new.academy_id, null, new.player_id);
  if v_words is not null then
    select full_name into v_name from public.players where id = new.player_id;
    raise exception '% is %', coalesce(v_name, 'that player'), v_words using errcode = '42501';
  end if;
  return new;
end;
$fn$;
drop trigger if exists event_lineup_players_refuse_banned on public.event_lineup_players;
create trigger event_lineup_players_refuse_banned
  before insert on public.event_lineup_players
  for each row execute function app_private.refuse_banned_lineup();

-- ---------------------------------------------------------------------------
-- 5. Banning, lifting, the list.
create or replace function public.ban_person(
  p_academy uuid,
  p_reason  text,
  p_profile uuid default null,
  p_player  uuid default null,
  p_name    text default null,
  p_ends_on date default null,
  p_note    text default null
) returns uuid
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_id     uuid;
  v_name   text;
  v_club   text;
  v_have   public.bans;
  v_until  text;
begin
  if auth.uid() is null or not app_private.may_ban(p_academy) then
    raise exception 'only the club''s staff, its President or Welfare officer — or the league''s — ban someone' using errcode = '42501';
  end if;
  if p_profile is null and p_player is null and nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'who?' using errcode = '22023';
  end if;
  if p_profile is not null and p_profile = auth.uid() then
    raise exception 'not yourself' using errcode = '22023';
  end if;
  if p_player is not null and not exists (select 1 from public.players pl where pl.id = p_player) then
    raise exception 'no such player' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'say why — the person reads it' using errcode = '22023';
  end if;
  if p_ends_on is not null and p_ends_on < (now() at time zone 'Australia/Sydney')::date then
    raise exception 'that end date has passed' using errcode = '22023';
  end if;
  if p_profile is not null or p_player is not null then
    v_have := app_private.ban_now(p_academy, p_profile, p_player);
    if v_have.id is not null then
      raise exception 'already banned%', case when v_have.ends_on is not null then ' until ' || to_char(v_have.ends_on, 'FMDD Mon') else '' end
        using errcode = '23505';
    end if;
  end if;

  v_name := coalesce(
    (select nullif(btrim(p.full_name), '') from public.profiles p where p.id = p_profile),
    (select pl.full_name from public.players pl where pl.id = p_player),
    btrim(p_name));
  select name into v_club from public.academies where id = p_academy;

  insert into public.bans (academy_id, profile_id, player_id, person_name, reason, ends_on, note, issued_by)
  values (p_academy, p_profile, p_player, case when p_profile is null and p_player is null then btrim(p_name) end,
          btrim(p_reason), p_ends_on, nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_id;

  perform app_private.log_activity(p_academy, 'ban.issued', 'ban', v_id, v_name,
    jsonb_build_object('reason', btrim(p_reason), 'until', p_ends_on, 'profile_id', p_profile, 'player_id', p_player));

  v_until := case when p_ends_on is not null then ' until ' || to_char(p_ends_on, 'FMDD FMMonth') else ' until further notice' end;
  insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload, scheduled_for, dedupe_key)
  select p_academy, x.profile_id, 'ban',
         case when p_player is not null then v_name || ' cannot take part at ' || v_club || v_until
              else 'You cannot take part at ' || v_club || v_until end,
         btrim(p_reason) || '. No answering for games or training, no posting, no team sheet while it runs. Questions to the club''s Welfare officer.',
         '/settings', jsonb_build_object('ban_id', v_id), now(), 'ban:' || v_id::text || ':' || x.profile_id::text
    from (
      select p_profile as profile_id where p_profile is not null
      union
      select g.profile_id from public.player_guardians g where p_player is not null and g.player_id = p_player
    ) x
  on conflict (dedupe_key) do nothing;
  return v_id;
end;
$fn$;
revoke execute on function public.ban_person(uuid, text, uuid, uuid, text, date, text) from public, anon;
grant execute on function public.ban_person(uuid, text, uuid, uuid, text, date, text) to authenticated;

create or replace function public.lift_ban(p_ban uuid, p_note text default null)
returns boolean
language plpgsql volatile security definer set search_path = public as $fn$
declare
  b      public.bans;
  v_name text;
  v_club text;
begin
  select * into b from public.bans where id = p_ban for update;
  if b.id is null then
    raise exception 'no such ban' using errcode = '22023';
  end if;
  if auth.uid() is null or not app_private.may_ban(b.academy_id) then
    raise exception 'only the club''s staff, its President or Welfare officer — or the league''s — lift a ban' using errcode = '42501';
  end if;
  if b.lifted_at is not null then
    return false;
  end if;
  update public.bans set lifted_at = now(), lifted_by = auth.uid(), lift_note = nullif(btrim(coalesce(p_note, '')), '') where id = p_ban;
  v_name := coalesce(
    (select nullif(btrim(p.full_name), '') from public.profiles p where p.id = b.profile_id),
    (select pl.full_name from public.players pl where pl.id = b.player_id),
    b.person_name);
  select name into v_club from public.academies where id = b.academy_id;
  perform app_private.log_activity(b.academy_id, 'ban.lifted', 'ban', b.id, v_name,
    jsonb_build_object('note', nullif(btrim(coalesce(p_note, '')), ''), 'profile_id', b.profile_id, 'player_id', b.player_id));
  insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload, scheduled_for, dedupe_key)
  select b.academy_id, x.profile_id, 'ban',
         case when b.player_id is not null then v_name || ' is welcome back at ' || v_club else 'You are welcome back at ' || v_club end,
         coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'The ban has been lifted.'),
         '/', jsonb_build_object('ban_id', b.id, 'lifted', true), now(), 'ban-lifted:' || b.id::text || ':' || x.profile_id::text
    from (
      select b.profile_id where b.profile_id is not null
      union
      select g.profile_id from public.player_guardians g where b.player_id is not null and g.player_id = b.player_id
    ) x
  on conflict (dedupe_key) do nothing;
  return true;
end;
$fn$;
revoke execute on function public.lift_ban(uuid, text) from public, anon;
grant execute on function public.lift_ban(uuid, text) to authenticated;

-- The list: the ones that hold, then the lifted and the lapsed from the
-- last ninety days.
create or replace function public.bans_list(p_academy uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_today date := (now() at time zone 'Australia/Sydney')::date;
begin
  if not app_private.may_ban(p_academy) then
    return null;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', b.id,
             'name', coalesce((select nullif(btrim(p.full_name), '') from public.profiles p where p.id = b.profile_id),
                              (select pl.full_name from public.players pl where pl.id = b.player_id), b.person_name),
             'kind', case when b.profile_id is not null then 'member' when b.player_id is not null then 'player' else 'name' end,
             'profile_id', b.profile_id, 'player_id', b.player_id,
             'reason', b.reason, 'starts_on', b.starts_on, 'ends_on', b.ends_on, 'note', b.note,
             'issued_at', b.issued_at,
             'issued_by', (select nullif(btrim(p.full_name), '') from public.profiles p where p.id = b.issued_by),
             'lifted_at', b.lifted_at, 'lift_note', b.lift_note,
             'active', b.lifted_at is null and b.starts_on <= v_today and (b.ends_on is null or b.ends_on >= v_today),
             'upcoming', b.lifted_at is null and b.starts_on > v_today)
           order by (b.lifted_at is null and (b.ends_on is null or b.ends_on >= v_today)) desc, b.issued_at desc)
      from public.bans b
     where b.academy_id = p_academy
       and (b.lifted_at is null and (b.ends_on is null or b.ends_on >= v_today - 90)
            or b.lifted_at > now() - interval '90 days')
  ), '[]'::jsonb);
end;
$fn$;
revoke execute on function public.bans_list(uuid) from public, anon;
grant execute on function public.bans_list(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. The posting gate and the sheet's eligibility, re-created with the ban
--    in front (their bodies as they stood, 0169 and 0191, plus one check).
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

  -- 0257: a ban by the club or the league stops every post, host or not.
  if app_private.banned_here(c.academy_id) then
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

create or replace function app_private.ineligibility(p_entry uuid, p_player uuid, p_on date, p_fixture uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v_entry   public.competition_entries;
  v_fx      public.fixtures;
  v_rank    integer;
  v_up      boolean;
  v_name    text;
  v_dob     date;
  v_from    text;
  v_head    text;
  v_own     boolean;
  v_cap     integer;
  v_min     integer;
  v_after   date;
  v_before  date;
  v_n       integer;
  v_why     text;
begin
  select * into v_entry from public.competition_entries where id = p_entry;
  select full_name, dob into v_name, v_dob from public.players where id = p_player;
  if v_name is null then return 'no such player'; end if;
  if p_fixture is not null then
    select * into v_fx from public.fixtures where id = p_fixture;
  end if;

  v_head := app_private.concussion_reason(p_player);
  if v_head is not null then return v_head; end if;

  -- 0257: banned by the club, or by the league that runs this competition.
  v_why := app_private.ban_words(v_entry.academy_id, null, p_player);
  if v_why is null then
    v_why := app_private.ban_words((select c.organiser_id from public.competitions c where c.id = v_entry.competition_id), null, p_player);
  end if;
  if v_why is not null then return v_name || ' is ' || v_why; end if;

  v_own := exists (select 1 from public.entry_squads s where s.entry_id = p_entry and s.player_id = p_player);

  select d.rank, d.allow_playing_up, d.borrow_cap, d.finals_min_games, d.born_after, d.born_before
    into v_rank, v_up, v_cap, v_min, v_after, v_before
    from public.competition_divisions d
   where d.competition_id = v_entry.competition_id and d.division = v_entry.division;

  -- L-27: the division's date-of-birth band, unless the league exempted them.
  if v_dob is not null and (v_after is not null or v_before is not null)
     and not exists (select 1 from public.entry_squads s where s.entry_id = p_entry and s.player_id = p_player and s.age_exempt)
     and ((v_after is not null and v_dob < v_after) or (v_before is not null and v_dob > v_before)) then
    return v_name || ' was born in ' || extract(year from v_dob)::integer || '; this division is for '
           || coalesce(extract(year from v_after)::integer::text, '…') || '–' || coalesce(extract(year from v_before)::integer::text, '…');
  end if;

  if not v_own then
    select lower_e.division into v_from
      from public.entry_squads s
      join public.competition_entries lower_e on lower_e.id = s.entry_id
      join public.competition_divisions ld
        on ld.competition_id = lower_e.competition_id and ld.division = lower_e.division
     where s.player_id = p_player
       and lower_e.competition_id = v_entry.competition_id
       and lower_e.academy_id = v_entry.academy_id
       and lower_e.id <> v_entry.id
       and v_rank is not null and ld.rank is not null and ld.rank < v_rank
     limit 1;
    if v_from is null then
      return v_name || ' is not on this squad';
    end if;
    if not coalesce(v_up, true) then
      return v_name || ' is on the ' || v_from || ' squad and this division does not allow playing up';
    end if;
    if v_cap is not null then
      select count(distinct s.fixture_id) into v_n
        from public.match_sheet_players sp
        join public.match_sheets s on s.id = sp.sheet_id
       where s.competition_id = v_entry.competition_id and sp.player_id = p_player
         and (p_fixture is null or s.fixture_id <> p_fixture)
         and not exists (select 1 from public.entry_squads q where q.entry_id = s.entry_id and q.player_id = p_player);
      if v_n >= v_cap then
        return v_name || ' has already played up ' || v_n || case when v_n = 1 then ' time' else ' times' end
               || ' this season; this division allows ' || v_cap;
      end if;
    end if;
  end if;

  v_why := app_private.suspension_reason(v_entry.competition_id, p_player, p_on);
  if v_why is not null then return v_why; end if;

  if v_fx.id is not null and v_fx.stage = 'final' and v_min is not null then
    select count(distinct s.fixture_id) into v_n
      from public.match_sheet_players sp
      join public.match_sheets s on s.id = sp.sheet_id
      join public.fixtures fx on fx.id = s.fixture_id
     where s.competition_id = v_entry.competition_id and sp.player_id = p_player
       and coalesce(fx.stage, 'group') <> 'final';
    if v_n < v_min then
      return v_name || ' has played ' || v_n || ' of the season''s games; a final needs ' || v_min;
    end if;
  end if;

  return null;
end;
$$;
