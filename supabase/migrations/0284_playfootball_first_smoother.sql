-- 0284 — PlayFootball first, Squadi-style but smoother (Joey, 16 Nov 2026).
--
-- For a club, or a program, that requires PlayFootball: a family registers
-- there first (Step 1 — a screen with the club's PlayFootball link and "I've
-- done it"), then comes back (Step 2): an account if new, their child
-- claimed from the club's latest PlayFootball import by name, date of birth
-- and FFA number, and only what the import does not have — emergency
-- contact, consents, kit size. A child not in the import yet is let in as
-- PlayFootball pending: on the roster, in the chat, chased weekly, and kept
-- off a team sheet until the club's next import says registered. The
-- Registrar is reminded weekly to import while anyone is pending. Squadroom
-- fees at such a club are extras, labelled so; the registration fee is
-- PlayFootball's. Clubs that do not require PlayFootball see none of this.
--
-- Squadroom never talks to PlayFootball: the link opens their site in the
-- family's browser; the import is a file the club downloaded from its own
-- account (CLAUDE.md). Nothing here checks anything with Football Australia.

-- ------------------------------------------------- 1. the club's setting
alter table public.academies add column if not exists requires_playfootball boolean not null default false;
alter table public.academies add column if not exists playfootball_url text;
alter table public.academies drop constraint if exists academies_playfootball_url_shape;
alter table public.academies add constraint academies_playfootball_url_shape
  check (playfootball_url is null or playfootball_url ~* '^https://([a-z0-9-]+\.)*playfootball\.com\.au(/|$)');

-- Required for this child's registration when the club says so, or the program does.
create or replace function app_private.playfootball_required(p_academy uuid, p_program uuid default null)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select a.requires_playfootball from public.academies a where a.id = p_academy), false)
      or coalesce((select p.requires_official_rego from public.programs p where p.id = p_program), false);
$$;
revoke execute on function app_private.playfootball_required(uuid, uuid) from public, anon;
grant execute on function app_private.playfootball_required(uuid, uuid) to authenticated, service_role;

-- --------------------------------- 2. the club's import, kept to claim from
create table if not exists public.playfootball_imports (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  imported_by uuid references public.profiles(id) on delete set null,
  imported_at timestamptz not null default now(),
  rows_sent   integer not null default 0,
  matched     integer not null default 0,
  unmatched   integer not null default 0
);
create index if not exists playfootball_imports_academy_idx on public.playfootball_imports (academy_id, imported_at desc);

create table if not exists public.playfootball_rows (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  import_id   uuid references public.playfootball_imports(id) on delete set null,
  full_name   text,
  dob         date,
  ffa_number  text,
  fifa_id     text,
  status      public.official_rego_status not null default 'registered',
  player_id   uuid references public.players(id) on delete set null,
  claimed_by  uuid references public.profiles(id) on delete set null,
  claimed_at  timestamptz,
  imported_at timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists playfootball_rows_ffa_idx on public.playfootball_rows (academy_id, ffa_number) where ffa_number is not null;
create index if not exists playfootball_rows_name_dob_idx on public.playfootball_rows (academy_id, dob, lower(btrim(full_name)));
alter table public.playfootball_imports enable row level security;
alter table public.playfootball_rows enable row level security;
grant select on public.playfootball_imports, public.playfootball_rows to authenticated;
-- The club's registrations people read the list (a child's name, birthday and
-- FFA number); nobody writes it directly — the import does, and a family's
-- claim through its own function.
drop policy if exists playfootball_imports_select on public.playfootball_imports;
create policy playfootball_imports_select on public.playfootball_imports for select to authenticated
  using ((select app_private.may_run_club(academy_id, 'registrations')));
drop policy if exists playfootball_rows_select on public.playfootball_rows;
create policy playfootball_rows_select on public.playfootball_rows for select to authenticated
  using ((select app_private.may_run_club(academy_id, 'registrations')));

-- What a registration carries now: the claimed row, and what the import does
-- not have — an emergency contact and kit sizes — asked once, here.
alter table public.registration_requests add column if not exists playfootball_row_id uuid references public.playfootball_rows(id) on delete set null;
alter table public.registration_requests add column if not exists emergency_name text;
alter table public.registration_requests add column if not exists emergency_phone text;
alter table public.registration_requests add column if not exists emergency_relation text;
alter table public.registration_requests add column if not exists shirt_size public.kit_size;
alter table public.registration_requests add column if not exists shorts_size public.kit_size;

-- The import: every row kept (matched or not), the players it matches
-- updated, the requests it confirms, the counts right (0236's
-- confirmed_requests counted the last row only).
create or replace function public.import_official_status(p_academy uuid, p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  r jsonb;
  v_import uuid;
  v_row uuid;
  v_name text; v_dob date; v_ffa text; v_fifa text; v_status_text text;
  v_status public.official_rego_status;
  v_player uuid;
  v_matched integer := 0;
  v_confirmed integer := 0;
  v_n integer;
  v_unmatched jsonb := '[]'::jsonb;
begin
  if not coalesce(app_private.may_run_club(p_academy, 'registrations'), false) then
    raise exception 'only the club''s staff import PlayFootball exports' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be an array' using errcode = '22023';
  end if;
  insert into public.playfootball_imports (academy_id, imported_by, rows_sent)
  values (p_academy, auth.uid(), jsonb_array_length(p_rows)) returning id into v_import;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_name := nullif(btrim(coalesce(r->>'full_name',
                        btrim(coalesce(r->>'first_name', '') || ' ' || coalesce(r->>'last_name', '')))), '');
    v_dob := case when coalesce(r->>'dob', '') ~ '^\d{4}-\d{2}-\d{2}$' then (r->>'dob')::date end;
    v_ffa := nullif(regexp_replace(coalesce(r->>'ffa_number', ''), '\D', '', 'g'), '');
    v_fifa := nullif(regexp_replace(coalesce(r->>'fifa_id', ''), '\D', '', 'g'), '');
    v_status_text := lower(coalesce(r->>'status', ''));
    v_status := case
      when v_status_text ~ '(pending|await|incomplete|submitted|unpaid|in progress|review)' then 'pending'
      when v_status_text ~ '(cancel|withdraw|reject|declin|inactive|expired)' then 'unknown'
      else 'registered'
    end;

    -- The player, if the club already has them.
    v_player := null;
    if v_ffa is not null then
      select id into v_player from public.players where academy_id = p_academy and ff_number = v_ffa limit 1;
    end if;
    if v_player is null and v_fifa is not null then
      select id into v_player from public.players where academy_id = p_academy and fifa_id = v_fifa limit 1;
    end if;
    if v_player is null and v_name is not null and v_dob is not null then
      select id into v_player from public.players
       where academy_id = p_academy and dob = v_dob and lower(btrim(full_name)) = lower(v_name)
       limit 1;
    end if;

    -- The row, kept: by FFA number, else by name and birthday.
    v_row := null;
    if v_ffa is not null then
      select id into v_row from public.playfootball_rows where academy_id = p_academy and ffa_number = v_ffa;
    end if;
    if v_row is null and v_name is not null and v_dob is not null then
      select id into v_row from public.playfootball_rows
       where academy_id = p_academy and dob = v_dob and lower(btrim(full_name)) = lower(v_name) and ffa_number is null
       limit 1;
    end if;
    if v_row is null then
      insert into public.playfootball_rows (academy_id, import_id, full_name, dob, ffa_number, fifa_id, status, player_id)
      values (p_academy, v_import, v_name, v_dob, v_ffa, v_fifa, v_status, v_player) returning id into v_row;
    else
      update public.playfootball_rows
         set import_id = v_import, full_name = coalesce(v_name, full_name), dob = coalesce(v_dob, dob),
             fifa_id = coalesce(v_fifa, fifa_id), status = v_status, player_id = coalesce(v_player, player_id),
             imported_at = now(), updated_at = now()
       where id = v_row;
    end if;

    if v_player is null then
      v_unmatched := v_unmatched || jsonb_build_object('name', coalesce(v_name, v_ffa, v_fifa, '?'), 'dob', v_dob);
      -- A waiting registration that claimed this row is confirmed by it all the same.
      if v_status = 'registered' then
        update public.registration_requests q
           set official_confirmed_at = now(), official_confirmed_by = auth.uid(),
               ffa_number = coalesce(q.ffa_number, v_ffa), fifa_id = coalesce(q.fifa_id, v_fifa)
         where q.academy_id = p_academy and q.status = 'pending' and q.official_confirmed_at is null
           and (q.playfootball_row_id = v_row
                or (v_dob is not null and q.child_dob = v_dob and lower(btrim(q.child_name)) = lower(coalesce(v_name, '')))
                or (v_ffa is not null and q.ffa_number = v_ffa));
        get diagnostics v_n = row_count;
        v_confirmed := v_confirmed + v_n;
      end if;
      continue;
    end if;

    v_matched := v_matched + 1;
    update public.players
       set official_status = v_status,
           official_status_at = now(),
           official_status_by = auth.uid(),
           ff_number = coalesce(ff_number, v_ffa),
           fifa_id = coalesce(fifa_id, v_fifa),
           updated_at = now()
     where id = v_player;

    if v_status = 'registered' then
      update public.registration_requests q
         set official_confirmed_at = now(), official_confirmed_by = auth.uid(),
             ffa_number = coalesce(q.ffa_number, v_ffa), fifa_id = coalesce(q.fifa_id, v_fifa)
       where q.academy_id = p_academy and q.status = 'pending' and q.official_confirmed_at is null
         and (q.playfootball_row_id = v_row
              or (v_dob is not null and q.child_dob = v_dob and lower(btrim(q.child_name)) = lower(coalesce(v_name, '')))
              or (v_ffa is not null and q.ffa_number = v_ffa)
              or (v_fifa is not null and q.fifa_id = v_fifa));
      get diagnostics v_n = row_count;
      v_confirmed := v_confirmed + v_n;
    end if;
  end loop;

  update public.playfootball_imports set matched = v_matched, unmatched = jsonb_array_length(v_unmatched) where id = v_import;
  return jsonb_build_object('import_id', v_import, 'matched', v_matched, 'confirmed_requests', v_confirmed, 'unmatched', v_unmatched,
                            'rows', (select count(*) from public.playfootball_rows where academy_id = p_academy));
end;
$fn$;

-- The import's standing, for the import screen and the Registrar's reminder.
create or replace function public.playfootball_import_status(p_academy uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select case when app_private.may_run_club(p_academy, 'registrations') then jsonb_build_object(
    'imported_at', (select max(i.imported_at) from public.playfootball_imports i where i.academy_id = p_academy),
    'imports', (select count(*) from public.playfootball_imports i where i.academy_id = p_academy),
    'rows', (select count(*) from public.playfootball_rows r where r.academy_id = p_academy),
    'to_claim', (select count(*) from public.playfootball_rows r where r.academy_id = p_academy and r.player_id is null and r.status = 'registered'),
    'pending_players', (select count(*) from public.players pl where pl.academy_id = p_academy and pl.official_status = 'pending'),
    'required', (select a.requires_playfootball from public.academies a where a.id = p_academy)) end;
$$;
revoke execute on function public.playfootball_import_status(uuid) from public, anon;
grant execute on function public.playfootball_import_status(uuid) to authenticated;

-- --------------------------------------- 3. a family claims their child
-- Name, birthday AND FFA number, all three, so the list is not an oracle for
-- which children play here: the FFA number is on the family's own
-- PlayFootball profile and nowhere public.
create or replace function public.claim_playfootball_child(p_academy uuid, p_name text, p_dob date, p_ffa text)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_ffa text := nullif(regexp_replace(coalesce(p_ffa, ''), '\D', '', 'g'), '');
  v_name text := lower(btrim(coalesce(p_name, '')));
  r public.playfootball_rows;
  v_player public.players;
begin
  if auth.uid() is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  if v_ffa is null or p_dob is null or v_name = '' then
    return jsonb_build_object('found', false, 'why', 'name, date of birth and FFA number');
  end if;
  select * into r from public.playfootball_rows x
   where x.academy_id = p_academy and x.ffa_number = v_ffa and x.dob = p_dob
     and (lower(btrim(coalesce(x.full_name, ''))) = v_name
          or (split_part(lower(btrim(coalesce(x.full_name, ''))), ' ', 1) = split_part(v_name, ' ', 1)
              and reverse(split_part(reverse(lower(btrim(coalesce(x.full_name, '')))), ' ', 1)) = reverse(split_part(reverse(v_name), ' ', 1))))
   limit 1;
  if r.id is null then
    return jsonb_build_object('found', false);
  end if;
  if r.player_id is not null then
    select * into v_player from public.players where id = r.player_id;
  else
    select * into v_player from public.players pl
     where pl.academy_id = p_academy and pl.dob = r.dob and lower(btrim(pl.full_name)) = lower(btrim(coalesce(r.full_name, ''))) limit 1;
  end if;
  return jsonb_build_object(
    'found', true,
    'row_id', r.id,
    'full_name', r.full_name,
    'dob', r.dob,
    'ffa_number', r.ffa_number,
    'fifa_id', r.fifa_id,
    'status', r.status,
    'on_roster', v_player.id is not null,
    'gender', v_player.gender,
    'has_emergency', v_player.id is not null and exists (select 1 from public.player_medical pm where pm.player_id = v_player.id and nullif(btrim(coalesce(pm.emergency_name, '')), '') is not null),
    'has_kit', v_player.id is not null and v_player.shirt_size is not null,
    'squad', (select t.name from public.teams t where t.id = v_player.team_id));
end;
$fn$;
revoke execute on function public.claim_playfootball_child(uuid, text, date, text) from public, anon;
grant execute on function public.claim_playfootball_child(uuid, text, date, text) to authenticated;

-- ------------------------------- 4. let them in as PlayFootball pending
-- Approval no longer waits for the import (0162's gate): the child is on the
-- roster as pending, so the chase reaches them and the coach can see them.
-- The team sheet is the gate now (ineligibility, below).
create or replace function public.guard_official_rego()
returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  v_academy uuid;
begin
  if new.status <> 'approved' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'approved' then
    return new;
  end if;
  select p.academy_id into v_academy from public.programs p where p.id = new.program_id;
  if app_private.playfootball_required(v_academy, new.program_id) and new.player_id is not null then
    update public.players
       set official_status = 'pending', official_status_at = now()
     where id = new.player_id and official_status = 'unknown';
  end if;
  return new;
end;
$fn$;

-- ---------------------------------------- 5. the team sheet is the gate
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

  -- PlayFootball first (0284): at a club, or on a program, that requires it, a
  -- child is kept off the sheet until the club's import says registered.
  if (select pl.official_status from public.players pl where pl.id = p_player) not in ('registered', 'not_required')
     and (app_private.playfootball_required(v_entry.academy_id, null)
          or exists (select 1 from public.program_registrations pr join public.programs pg on pg.id = pr.program_id
                      where pr.player_id = p_player and pr.status = 'approved' and pg.requires_official_rego)) then
    return v_name || ' is PlayFootball pending — the club''s next PlayFootball import clears them for a team sheet';
  end if;

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

-- ------------------------------------------- 6. the chase, weekly, for every pending child
create or replace function public.queue_official_rego_reminders()
returns integer
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_sent integer := 0;
begin
  with first_match as (
    select e.team_id, min(e.starts_at) as kick_off
      from public.events e
     where e.type = 'match'
       and e.cancelled_at is null
       and e.team_id is not null
       and e.starts_at > now()
     group by e.team_id
  ),
  -- A pending child with a game inside a fortnight, as before — and, at a club
  -- that requires PlayFootball, every pending child, weekly, game or no game (0284).
  due as (
    select pl.id as player_id, pl.academy_id, pl.full_name, fm.kick_off,
           case when fm.kick_off is null then null else greatest(0, (fm.kick_off::date - current_date)) end as days_left,
           a.name as club
      from public.players pl
      join public.academies a on a.id = pl.academy_id
      left join first_match fm on fm.team_id = pl.team_id
     where pl.official_status = 'pending'
       and (fm.kick_off <= now() + interval '14 days' or a.requires_playfootball)
  ),
  recipients as (
    select d.*, pg.profile_id as tell
      from due d
      join public.player_guardians pg on pg.player_id = d.player_id
  ),
  fresh as (
    select r.* from recipients r
     where not exists (
       select 1 from public.notification_queue n
        where n.kind = 'official_rego_pending'
          and n.profile_id = r.tell
          and n.payload->>'player_id' = r.player_id::text
          and n.created_at > now() - interval '7 days'
     )
  ),
  queued as (
    insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload)
    select
      f.academy_id,
      f.tell,
      'official_rego_pending',
      'Not yet registered with PlayFootball',
      case when f.days_left is null or f.days_left > 14
           then f.full_name || ' is PlayFootball pending at ' || f.club || '. Register them at playfootball.com.au — the club''s next import clears them for team sheets.'
           else f.full_name || ' plays ' ||
                case when f.days_left = 0 then 'today'
                     when f.days_left = 1 then 'tomorrow'
                     else 'in ' || f.days_left || ' days' end ||
                ' and the club has no PlayFootball registration for them. Without one they cannot take the field.' end,
      '/settings/family',
      jsonb_build_object('player_id', f.player_id, 'kick_off', f.kick_off)
    from fresh f
    returning 1
  )
  select count(*)::integer into v_sent from queued;

  return v_sent;
end;
$fn$;

-- ------------------------------------- 7. the Registrar's weekly import reminder
alter table public.notification_queue drop constraint if exists notification_queue_kind_check;
alter table public.notification_queue add constraint notification_queue_kind_check check (kind = any (array[
  'message', 'announcement', 'event_reminder', 'poll_opened', 'poll_closing', 'rsvp_change', 'invite', 'event_cancelled', 'event_changed',
  'event_back_on', 'rsvp_nudge', 'announcement_repeat', 'wwcc_expiring', 'guardian_erased', 'official_rego_pending', 'reregister_nudge', 'offer',
  'referee_appointment', 'referee_response', 'referee_withdrawn', 'fixture_change_proposed', 'fixture_change_answered', 'fixture_change_decided',
  'mention', 'match_correction_requested', 'match_correction_decided', 'fixture_flowing_open', 'discipline_warning', 'discipline_suspension',
  'forfeit_request', 'forfeit_decided', 'nomination', 'fee_due', 'fee_overdue', 'player_report', 'player_clip', 'selected', 'not_selected',
  'match_day', 'support_reply', 'match_video', 'match_photos', 'photo_hidden', 'helpers_wanted', 'helper_reminder', 'helper_changed',
  'report_filed', 'team_published', 'team_sheet_due', 'accreditation_expiring', 'role_request', 'role_decided', 'ban', 'receipt',
  -- 0276
  'referee_game_off', 'referee_game_moved', 'referee_report', 'incident_report', 'entry_fee_owed',
  -- 0283
  'join_request',
  -- 0284
  'playfootball_import_due']));

create or replace function public.queue_playfootball_import_reminders()
returns integer
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_sent integer := 0;
begin
  with clubs as (
    select a.id as academy_id, a.name,
           (select count(*) from public.players pl where pl.academy_id = a.id and pl.official_status = 'pending') as pending,
           (select count(*) from public.registration_requests q where q.academy_id = a.id and q.status = 'pending' and q.official_confirmed_at is null and q.register_as = 'player') as waiting,
           (select max(i.imported_at) from public.playfootball_imports i where i.academy_id = a.id) as last_import
      from public.academies a
     where a.requires_playfootball
        or exists (select 1 from public.programs p where p.academy_id = a.id and p.requires_official_rego and p.status = 'open')
  ),
  due as (
    select * from clubs c
     where (c.pending + c.waiting) > 0
       and (c.last_import is null or c.last_import < now() - interval '6 days')
  ),
  people as (
    -- The Registrar (and the Secretary and President, who may run registrations), else the owners.
    select d.*, r.profile_id as tell
      from due d
      join public.club_roles r on r.academy_id = d.academy_id and r.role in ('registrar', 'secretary', 'president') and r.scope_kind = 'club'
    union
    select d.*, am.profile_id
      from due d
      join public.academy_members am on am.academy_id = d.academy_id and am.status = 'active' and am.role = 'owner'
     where not exists (select 1 from public.club_roles r where r.academy_id = d.academy_id and r.role = 'registrar' and r.scope_kind = 'club')
  ),
  queued as (
    insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload, scheduled_for, dedupe_key)
    select p.academy_id, p.tell, 'playfootball_import_due',
           'PlayFootball import due',
           (p.pending + p.waiting) || case when p.pending + p.waiting = 1 then ' child is' else ' children are' end
             || ' waiting on PlayFootball at ' || p.name || '. Import this week''s export under Admin → Import → PlayFootball'
             || case when p.last_import is null then ' — there has been no import yet.' else ' — the last one was ' || to_char(p.last_import, 'DD Mon') || '.' end,
           '/admin/import/playfootball',
           jsonb_build_object('pending', p.pending, 'waiting', p.waiting, 'last_import', p.last_import),
           now(),
           'playfootball_import_due:' || p.academy_id::text || ':' || p.tell::text || ':' || to_char(now(), 'IYYY-IW')
      from people p
    on conflict (dedupe_key) do nothing
    returning 1
  )
  select count(*)::integer into v_sent from queued;
  return v_sent;
end;
$fn$;
revoke execute on function public.queue_playfootball_import_reminders() from public, anon, authenticated;
grant execute on function public.queue_playfootball_import_reminders() to service_role;

select cron.unschedule('queue-playfootball-import-reminders')
 where exists (select 1 from cron.job where jobname = 'queue-playfootball-import-reminders');
select cron.schedule(
  'queue-playfootball-import-reminders',
  '25 19 * * *',  -- 19:25 UTC is 06:25 in Sydney, after the family chase
  $cron$select public.queue_playfootball_import_reminders()$cron$
);

-- ---------------------------- 8. the Registrar reads, confirms and decides registrations
create or replace function public.confirm_official_rego(p_request uuid, p_confirmed boolean default true)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_req public.registration_requests;
  v_player uuid;
begin
  select * into v_req from public.registration_requests where id = p_request;
  if v_req.id is null or not (coalesce(app_private.is_academy_coach(v_req.academy_id), false) or coalesce(app_private.may_run_club(v_req.academy_id, 'registrations'), false)) then
    raise exception 'that registration is not yours to confirm' using errcode = '42501';
  end if;
  update public.registration_requests
     set official_confirmed_at = case when p_confirmed then now() end,
         official_confirmed_by = case when p_confirmed then auth.uid() end
   where id = p_request;

  -- A child already on the roster is confirmed there too, with the ids
  -- the family gave, so the gate and the roster say the same thing.
  if p_confirmed then
    select pl.id into v_player from public.players pl
     where pl.academy_id = v_req.academy_id
       and pl.dob = v_req.child_dob
       and lower(btrim(pl.full_name)) = lower(btrim(v_req.child_name))
     limit 1;
    if v_player is not null then
      update public.players
         set official_status = 'registered',
             ff_number = coalesce(ff_number, v_req.ffa_number),
             fifa_id = coalesce(fifa_id, v_req.fifa_id),
             updated_at = now()
       where id = v_player;
    end if;
  end if;
end;
$fn$;
create or replace function public.registration_queue(
  p_academy uuid default null,
  p_status  text default 'pending'
)
returns table (
  request_id    uuid,
  program_id    uuid,
  program_name  text,
  guardian_name text,
  guardian_phone text,
  guardian_email text,
  child_name    text,
  child_dob     date,
  child_gender  text,
  answers       jsonb,
  consents      jsonb,
  status        text,
  created_at    timestamptz,
  decided_by    text,
  decided_at    timestamptz,
  decision_note text,
  existing_player_id uuid,
  spots_left    integer,
  -- R-18
  ffa_number    text,
  fifa_id       text,
  requires_official boolean,
  official_confirmed_at timestamptz,
  existing_official_status text,
  -- 0263: where the pending photo sits in player-photos, or null.
  photo_path    text,
  -- 0267: the role, and the Working With Children Check.
  register_as   text,
  wwcc_number   text,
  wwcc_expires_on date,
  wwcc_checked_at timestamptz,
  role_note     text,
  -- 0268: the question to the family and their answer; the registration an
  -- accepted request became, and where it stands.
  info_requested_at timestamptz,
  info_note     text,
  family_reply  text,
  family_replied_at timestamptz,
  registration_id uuid,
  registration_status text
)
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_academy uuid;
begin
  v_academy := app_private.my_academy(p_academy);
  -- The coaches, and the people who run registrations (the Registrar is not a coach) — 0284.
  if v_academy is null or not (coalesce(app_private.is_academy_coach(v_academy), false) or coalesce(app_private.may_run_club(v_academy, 'registrations'), false)) then
    return;
  end if;

  return query
  select
    q.id, q.program_id, p.name,
    q.guardian_name, q.guardian_phone, q.guardian_email,
    q.child_name, q.child_dob, q.child_gender,
    q.answers, q.consents, q.status, q.created_at,
    d.full_name, q.decided_at, q.decision_note,
    m.id,
    case when q.program_id is null then null else app_private.program_spots_left(q.program_id) end,
    q.ffa_number, q.fifa_id, coalesce(p.requires_official_rego, false), q.official_confirmed_at,
    m.official_status::text,
    q.photo_path,
    q.register_as, q.wwcc_number, q.wwcc_expires_on, q.wwcc_checked_at, q.role_note,
    q.info_requested_at, q.info_note, q.family_reply, q.family_replied_at,
    q.registration_id, pr.status::text
  from public.registration_requests q
  left join public.programs p on p.id = q.program_id
  left join public.profiles d on d.id = q.decided_by
  left join public.program_registrations pr on pr.id = q.registration_id
  left join lateral (
    select pl.id, pl.official_status from public.players pl
     where pl.academy_id = v_academy
       and pl.dob = q.child_dob
       and lower(btrim(pl.full_name)) = lower(btrim(q.child_name))
     limit 1
  ) m on true
  where q.academy_id = v_academy
    and (p_status is null or q.status = p_status)
    and q.expires_at > now()
  order by q.created_at;
end;
$fn$;
drop policy if exists registration_requests_select on public.registration_requests;
create policy registration_requests_select on public.registration_requests
  for select to authenticated
  using ((select app_private.is_academy_coach(academy_id)) or (select app_private.may_run_club(academy_id, 'registrations')));

-- ----------------------------- 9. the front door: what the club requires, fees as extras
create or replace function public.public_programs(p_slug text)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_academy public.academies;
begin
  select * into v_academy from public.academies where slug = lower(btrim(p_slug));
  if v_academy.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'academy', jsonb_build_object(
      'id', v_academy.id,
      'name', v_academy.name,
      'slug', v_academy.slug,
      'primary_colour', v_academy.primary_colour,
      'logo_url', v_academy.logo_url,
      'timezone', v_academy.timezone,
      'photo_required', v_academy.photo_required,
      'active_kids', app_private.takes_active_kids(v_academy.id),
      'card_fee_passthrough', v_academy.card_fee_passthrough and app_private.feature_on(v_academy.id, 'card_fee_passthrough'),
      -- 0284: PlayFootball first at this club, and where to do it.
      'requires_playfootball', v_academy.requires_playfootball,
      'playfootball_url', v_academy.playfootball_url
    ),
    'programs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id,
               'name', p.name,
               'kind', p.kind,
               'description', p.description,
               'season', p.season,
               'born_from_year', p.born_from_year,
               'born_to_year', p.born_to_year,
               'gender', p.gender,
               'starts_on', p.starts_on,
               'ends_on', p.ends_on,
               'closes_at', p.closes_at,
               'questions', p.questions,
               'payment_required', p.payment_required,
               'pay_timing', p.pay_timing,
               'amount_cents', (
                 select pr.amount_cents from public.payment_requests pr
                  where pr.id = p.payment_request_id
               ),
               'spots_left', app_private.program_spots_left(p.id),
               'waitlist_enabled', p.waitlist_enabled,
               'requires_official_rego', p.requires_official_rego,
               -- 0284: this program needs PlayFootball (the club's rule or its own); its fee is a club extra, never the registration fee.
               'requires_playfootball', v_academy.requires_playfootball or p.requires_official_rego,
               'fee_kind', case when v_academy.requires_playfootball or p.requires_official_rego then 'extra' else 'fee' end
             ) order by p.starts_on nulls last, p.name)
        from public.programs p
       where p.academy_id = v_academy.id
         and p.status = 'open'
         and (p.opens_at is null or p.opens_at <= now())
         and (p.closes_at is null or p.closes_at > now())
    ), '[]'::jsonb),
    'consents', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id,
               'kind', c.kind,
               'title', c.title,
               'version', c.version,
               'body', c.body,
               'required', c.required
             ) order by c.required desc, c.title)
        from public.consent_documents c
       where c.academy_id = v_academy.id
         and c.published_at is not null
         and c.retired_at is null
    ), '[]'::jsonb)
  );
end;
$fn$;
