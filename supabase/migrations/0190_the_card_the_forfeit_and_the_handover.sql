-- 0190: the card, the forfeit, and the handover.
--
-- Three more Squadi-parity rows (SQUADI_INTEL §6A.2, §6A.4, §6A.6):
--
-- L-20  SANCTION CODES on cards (Y1–Y6, R1–R8) and a push to the club when a
--       player is ONE YELLOW AWAY from a suspension, and again when it lands.
--       Extends 0153's accumulation; the suspension carries the code of the
--       card that tipped it.
--
-- L-22  A FORFEIT IS ASKED FOR, NOT DECLARED: coach → club → league. A coach
--       asks with a reason; the club's staff approve or decline; the league
--       decides, and only then does 0156's forfeit score apply. A request
--       from club staff skips the club step. Each step pushes the next.
--
-- L-18  THE SCORER HANDS THEIR PHONE TO THE REFEREE. On the scorer's phone
--       the referee types the mobile number the league holds for them and
--       the word Confirm; that verifies the sheets and the score and ends the
--       game, in the referee's name, without the referee needing an account.
--       A referee who ends a game from their own phone verifies it too.

-- ------------------------------------------------------------- notification kinds
do $$
declare
  v_name text;
begin
  select conname into v_name from pg_constraint
   where conrelid = 'public.notification_queue'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) like '%kind = ANY%';
  if v_name is not null then
    execute format('alter table public.notification_queue drop constraint %I', v_name);
  end if;
  alter table public.notification_queue add constraint notification_queue_kind_check check (kind = any (array[
    'message','announcement','event_reminder','poll_opened','poll_closing','rsvp_change','invite',
    'event_cancelled','event_changed','event_back_on','rsvp_nudge','announcement_repeat','wwcc_expiring',
    'guardian_erased','official_rego_pending','reregister_nudge','offer','referee_appointment',
    'referee_response','referee_withdrawn','fixture_change_proposed','fixture_change_answered',
    'fixture_change_decided','mention','match_correction_requested','match_correction_decided',
    'fixture_flowing_open','discipline_warning','discipline_suspension','forfeit_request','forfeit_decided']));
end $$;

-- A push about a game to one person, from the league. Used by all three.
create or replace function app_private.match_push(p_fixture uuid, p_to uuid, p_kind text, p_title text, p_body text, p_payload jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  f     public.fixtures;
  v_org uuid;
begin
  select * into f from public.fixtures where id = p_fixture;
  select organiser_id into v_org from public.competitions where id = f.competition_id;
  insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload, dedupe_key)
  values (v_org, p_to, p_kind, left(p_title, 120), left(p_body, 200),
          '/competitions/' || f.competition_id || '/match/' || p_fixture,
          p_payload || jsonb_build_object('fixture_id', p_fixture),
          'mp-' || p_kind || '-' || p_fixture || '-' || p_to || '-' || extract(epoch from clock_timestamp())::numeric(20,3))
  on conflict (dedupe_key) do nothing;
end;
$$;

-- ----------------------------------------------------------------- L-20 codes
alter table public.match_events add column if not exists sanction_code text;
alter table public.match_events
  drop constraint if exists match_events_sanction_code_check,
  add constraint match_events_sanction_code_check check (sanction_code is null or sanction_code ~ '^(Y[1-6]|R[1-8])$');
alter table public.suspensions add column if not exists sanction_code text;
comment on column public.match_events.sanction_code is
  'L-20: Y1–Y6 for a caution, R1–R8 for a sending-off — the federation''s own codes.';

drop function if exists public.record_match_event(uuid, uuid, public.match_event_kind, uuid, integer, text);
drop function if exists public.record_match_event(uuid, uuid, public.match_event_kind, uuid, integer, text, text);
create function public.record_match_event(p_fixture uuid, p_entry uuid, p_kind public.match_event_kind, p_player uuid default null, p_minute integer default null, p_note text default null, p_code text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  f       public.fixtures;
  v_id    uuid;
  v_other uuid;
  v_code  text := nullif(upper(btrim(coalesce(p_code, ''))), '');
begin
  select * into f from public.fixtures where id = p_fixture;
  perform app_private.fixture_side(p_fixture, p_entry);
  v_other := case when f.home_entry_id = p_entry then f.away_entry_id else f.home_entry_id end;
  if not (coalesce(app_private.can_manage_entry(p_entry), false)
          or coalesce(app_private.can_manage_entry(v_other), false)
          or coalesce(app_private.is_fixture_referee(p_fixture), false)
          or coalesce(app_private.is_competition_organiser(f.competition_id), false)) then
    raise exception 'only the teams in this game, the referee or the organiser can record events' using errcode = '42501';
  end if;
  if f.ended_at is not null then
    raise exception 'this game has ended; ask the league for a correction' using errcode = '22023';
  end if;
  if p_player is not null and not exists (
       select 1 from public.match_sheet_players sp
         join public.match_sheets s on s.id = sp.sheet_id
        where s.fixture_id = p_fixture and s.entry_id = p_entry and sp.player_id = p_player) then
    raise exception 'that player is not on this team''s sheet for this game' using errcode = '22023';
  end if;
  if v_code is not null then
    if p_kind = 'yellow' and v_code !~ '^Y[1-6]$' then
      raise exception 'a caution takes a Y code, Y1 to Y6' using errcode = '22023';
    elsif p_kind = 'red' and v_code !~ '^R[1-8]$' then
      raise exception 'a sending-off takes an R code, R1 to R8' using errcode = '22023';
    elsif p_kind not in ('yellow', 'red') then
      raise exception 'only a card takes a sanction code' using errcode = '22023';
    end if;
  end if;
  insert into public.match_events (competition_id, fixture_id, entry_id, player_id, kind, minute, note, created_by, sanction_code)
  values (f.competition_id, p_fixture, p_entry, p_player, p_kind, p_minute, nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), v_code)
  returning id into v_id;
  perform app_private.log_sheet(f.competition_id, p_fixture, p_entry, 'event_' || p_kind::text,
    jsonb_build_object('player_id', p_player, 'minute', p_minute, 'code', v_code));
  return v_id;
end;
$$;
revoke execute on function public.record_match_event(uuid, uuid, public.match_event_kind, uuid, integer, text, text) from public, anon;
grant execute on function public.record_match_event(uuid, uuid, public.match_event_kind, uuid, integer, text, text) to authenticated;

-- 0153's trigger with the code carried and the warning pushed.
create or replace function public.suspend_on_card()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r         record;
  v_acad    uuid;
  v_yellows integer;
  v_name    text;
  v_comp    text;
  v_who     uuid;
  v_games   integer;
begin
  if new.player_id is null or new.kind not in ('red', 'yellow') then
    return new;
  end if;
  select * into r from app_private.discipline_rules(new.competition_id);
  select academy_id, full_name into v_acad, v_name from public.players where id = new.player_id;
  select name into v_comp from public.competitions where id = new.competition_id;

  if new.kind = 'red' then
    insert into public.suspensions (competition_id, player_id, academy_id, entry_id, reason, games, from_fixture_id, from_event_id, sanction_code)
    values (new.competition_id, new.player_id, v_acad, new.entry_id, 'red card', r.games_per_red, new.fixture_id, new.id, new.sanction_code);
    for v_who in select * from app_private.entry_managers(new.entry_id) loop
      perform app_private.match_push(new.fixture_id, v_who, 'discipline_suspension',
        v_name || ' is suspended — sent off' || coalesce(' (' || new.sanction_code || ')', ''),
        r.games_per_red || case when r.games_per_red = 1 then ' game' else ' games' end || ' in ' || coalesce(v_comp, 'the competition') || '. They are refused on the sheet until it is served.',
        jsonb_build_object('player_id', new.player_id));
    end loop;
    return new;
  end if;

  select count(*) into v_yellows
    from public.match_events e
   where e.competition_id = new.competition_id and e.player_id = new.player_id and e.kind = 'yellow';
  if v_yellows > 0 and v_yellows % r.yellows_per_suspension = 0 then
    insert into public.suspensions (competition_id, player_id, academy_id, entry_id, reason, games, from_fixture_id, from_event_id, sanction_code)
    values (new.competition_id, new.player_id, v_acad, new.entry_id,
            v_yellows || ' yellow cards', r.games_per_yellow_suspension, new.fixture_id, new.id, new.sanction_code);
    for v_who in select * from app_private.entry_managers(new.entry_id) loop
      perform app_private.match_push(new.fixture_id, v_who, 'discipline_suspension',
        v_name || ' is suspended — ' || v_yellows || ' yellow cards',
        r.games_per_yellow_suspension || case when r.games_per_yellow_suspension = 1 then ' game' else ' games' end || ' in ' || coalesce(v_comp, 'the competition') || '. They are refused on the sheet until it is served.',
        jsonb_build_object('player_id', new.player_id));
    end loop;
  elsif r.yellows_per_suspension > 1 and v_yellows % r.yellows_per_suspension = r.yellows_per_suspension - 1 then
    -- L-20: one card away. The club hears before the next Saturday.
    v_games := r.games_per_yellow_suspension;
    for v_who in select * from app_private.entry_managers(new.entry_id) loop
      perform app_private.match_push(new.fixture_id, v_who, 'discipline_warning',
        v_name || ' is one yellow from a suspension',
        v_yellows || ' of ' || r.yellows_per_suspension || ' in ' || coalesce(v_comp, 'the competition') || ' — the next one is ' || v_games || case when v_games = 1 then ' game' else ' games' end || ' off.',
        jsonb_build_object('player_id', new.player_id, 'yellows', v_yellows));
    end loop;
  end if;
  return new;
end;
$$;

-- discipline_report with the cards and their codes.
create or replace function public.discipline_report(p_competition uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not coalesce(app_private.is_competition_participant(p_competition), false) then
    raise exception 'not yours to see' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'rules', (select to_jsonb(r) from app_private.discipline_rules(p_competition) r),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
               'player_id', x.player_id,
               'name',      (select pl.full_name from public.players pl where pl.id = x.player_id),
               'club',      (select a.name from public.players pl join public.academies a on a.id = pl.academy_id where pl.id = x.player_id),
               'entry',     (select e.display_name from public.competition_entries e where e.id = x.entry_id),
               'yellows',   x.yellows, 'reds', x.reds, 'blues', x.blues,
               'one_away',  (select (count(*) filter (where e.kind = 'yellow')) % ru.yellows_per_suspension = ru.yellows_per_suspension - 1
                               from public.match_events e, app_private.discipline_rules(p_competition) ru
                              where e.competition_id = p_competition and e.player_id = x.player_id
                              group by ru.yellows_per_suspension),
               'cards', coalesce((
                 select jsonb_agg(jsonb_build_object('kind', e.kind, 'code', e.sanction_code, 'minute', e.minute, 'fixture_id', e.fixture_id,
                          'game', (select h.display_name || ' v ' || a.display_name from public.fixtures f
                                     left join public.competition_entries h on h.id = f.home_entry_id
                                     left join public.competition_entries a on a.id = f.away_entry_id where f.id = e.fixture_id))
                          order by e.created_at)
                   from public.match_events e where e.competition_id = p_competition and e.player_id = x.player_id and e.kind in ('yellow', 'red', 'blue')), '[]'::jsonb),
               'suspensions', coalesce((
                 select jsonb_agg(jsonb_build_object('id', s.id, 'reason', s.reason, 'games', s.games, 'served', s.served,
                          'status', s.status, 'issued_at', s.issued_at, 'note', s.note, 'appeal_note', s.appeal_note, 'code', s.sanction_code)
                          order by s.issued_at desc)
                   from public.suspensions s where s.competition_id = p_competition and s.player_id = x.player_id), '[]'::jsonb)
             ) order by x.reds desc, x.yellows desc, x.player_id)
        from (
          select e.player_id, (array_agg(e.entry_id))[1] as entry_id,
                 count(*) filter (where e.kind = 'yellow')::integer as yellows,
                 count(*) filter (where e.kind = 'red')::integer as reds,
                 count(*) filter (where e.kind = 'blue')::integer as blues
            from public.match_events e
           where e.competition_id = p_competition and e.player_id is not null and e.kind in ('yellow', 'red', 'blue')
           group by e.player_id
          union
          select s.player_id, (array_agg(s.entry_id))[1], 0, 0, 0
            from public.suspensions s
           where s.competition_id = p_competition
             and not exists (select 1 from public.match_events e where e.competition_id = p_competition and e.player_id = s.player_id and e.kind in ('yellow','red','blue'))
           group by s.player_id
        ) x
    ), '[]'::jsonb)
  );
end;
$$;

-- ----------------------------------------------------------------- L-22 forfeit
create table if not exists public.forfeit_requests (
  id               uuid primary key default gen_random_uuid(),
  competition_id   uuid not null references public.competitions(id) on delete cascade,
  fixture_id       uuid not null references public.fixtures(id) on delete cascade,
  entry_id         uuid not null references public.competition_entries(id) on delete cascade,
  requested_by     uuid not null references public.profiles(id) on delete cascade,
  reason           text not null check (btrim(reason) <> ''),
  status           text not null default 'proposed' check (status in ('proposed', 'club_approved', 'approved', 'declined', 'withdrawn')),
  club_decided_by  uuid references public.profiles(id) on delete set null,
  club_decided_at  timestamptz,
  club_note        text,
  league_decided_by uuid references public.profiles(id) on delete set null,
  league_decided_at timestamptz,
  league_note      text,
  created_at       timestamptz not null default now()
);
create index if not exists forfeit_requests_fixture on public.forfeit_requests (fixture_id, status);
create index if not exists forfeit_requests_competition on public.forfeit_requests (competition_id, status);
alter table public.forfeit_requests enable row level security;
drop policy if exists forfeit_requests_select on public.forfeit_requests;
create policy forfeit_requests_select on public.forfeit_requests for select to authenticated
  using (
    (select app_private.may_run(competition_id, 'grounds'))
    or exists (
      select 1 from public.fixtures f
       where f.id = fixture_id
         and (app_private.can_manage_entry(f.home_entry_id) or app_private.can_manage_entry(f.away_entry_id)))
  );
grant select on public.forfeit_requests to authenticated;

create or replace function public.request_forfeit(p_fixture uuid, p_entry uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  f        public.fixtures;
  e        public.competition_entries;
  v_staff  boolean;
  v_id     uuid;
  v_who    uuid;
  v_home   text;
  v_away   text;
begin
  select * into f from public.fixtures where id = p_fixture;
  if f.id is null then
    raise exception 'no such game' using errcode = '22023';
  end if;
  perform app_private.fixture_side(p_fixture, p_entry);
  select * into e from public.competition_entries where id = p_entry;
  if not coalesce(app_private.can_manage_entry(p_entry), false) then
    raise exception 'only the team''s coach or club asks to forfeit' using errcode = '42501';
  end if;
  if f.status not in ('scheduled', 'postponed') then
    raise exception 'that game is %', f.status using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'say why' using errcode = '22023';
  end if;
  if exists (select 1 from public.forfeit_requests r where r.fixture_id = p_fixture and r.entry_id = p_entry and r.status in ('proposed', 'club_approved')) then
    raise exception 'a forfeit is already asked for' using errcode = '23505';
  end if;
  -- Club staff (or the league itself) skip the club step.
  v_staff := (e.academy_id is not null and coalesce(app_private.is_academy_staff(e.academy_id), false))
             or coalesce(app_private.is_competition_organiser(f.competition_id), false);

  insert into public.forfeit_requests (competition_id, fixture_id, entry_id, requested_by, reason, status, club_decided_by, club_decided_at)
  values (f.competition_id, p_fixture, p_entry, auth.uid(), btrim(p_reason),
          case when v_staff then 'club_approved' else 'proposed' end,
          case when v_staff then auth.uid() end, case when v_staff then now() end)
  returning id into v_id;
  perform app_private.log_sheet(f.competition_id, p_fixture, p_entry, 'forfeit_requested',
    jsonb_build_object('request_id', v_id, 'reason', btrim(p_reason), 'club_step_skipped', v_staff));

  select h.display_name, a.display_name into v_home, v_away
    from public.fixtures x
    left join public.competition_entries h on h.id = x.home_entry_id
    left join public.competition_entries a on a.id = x.away_entry_id
   where x.id = p_fixture;
  if v_staff then
    for v_who in select * from app_private.area_holders(f.competition_id, 'grounds') loop
      if v_who <> auth.uid() then
        perform app_private.match_push(p_fixture, v_who, 'forfeit_request',
          e.display_name || ' ask to forfeit ' || coalesce(v_home, '?') || ' v ' || coalesce(v_away, '?'),
          'Approved by the club — ' || btrim(p_reason), jsonb_build_object('request_id', v_id));
      end if;
    end loop;
  elsif e.academy_id is not null then
    for v_who in
      select am.profile_id from public.academy_members am
       where am.academy_id = e.academy_id and am.status = 'active' and am.role in ('owner', 'admin')
    loop
      if v_who <> auth.uid() then
        perform app_private.match_push(p_fixture, v_who, 'forfeit_request',
          'Your coach asks to forfeit ' || coalesce(v_home, '?') || ' v ' || coalesce(v_away, '?'),
          btrim(p_reason) || ' — approve or decline before it goes to the league.', jsonb_build_object('request_id', v_id));
      end if;
    end loop;
  end if;
  return v_id;
end;
$$;

create or replace function public.club_decide_forfeit(p_request uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  r      public.forfeit_requests;
  e      public.competition_entries;
  v_who  uuid;
  v_home text;
  v_away text;
begin
  select * into r from public.forfeit_requests where id = p_request;
  if r.id is null then
    raise exception 'no such request' using errcode = '22023';
  end if;
  select * into e from public.competition_entries where id = r.entry_id;
  if not (e.academy_id is not null and coalesce(app_private.is_academy_staff(e.academy_id), false)) then
    raise exception 'only the club''s staff decide this step' using errcode = '42501';
  end if;
  if r.status <> 'proposed' then
    raise exception 'already %', r.status using errcode = '22023';
  end if;
  update public.forfeit_requests
     set status = case when p_approve then 'club_approved' else 'declined' end,
         club_decided_by = auth.uid(), club_decided_at = now(), club_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_request;
  perform app_private.log_sheet(r.competition_id, r.fixture_id, r.entry_id,
    case when p_approve then 'forfeit_club_approved' else 'forfeit_club_declined' end,
    jsonb_build_object('request_id', r.id, 'note', p_note));

  select h.display_name, a.display_name into v_home, v_away
    from public.fixtures x
    left join public.competition_entries h on h.id = x.home_entry_id
    left join public.competition_entries a on a.id = x.away_entry_id
   where x.id = r.fixture_id;
  if p_approve then
    for v_who in select * from app_private.area_holders(r.competition_id, 'grounds') loop
      if v_who <> auth.uid() then
        perform app_private.match_push(r.fixture_id, v_who, 'forfeit_request',
          e.display_name || ' ask to forfeit ' || coalesce(v_home, '?') || ' v ' || coalesce(v_away, '?'),
          'Approved by the club — ' || r.reason, jsonb_build_object('request_id', r.id));
      end if;
    end loop;
  end if;
  if r.requested_by <> auth.uid() then
    perform app_private.match_push(r.fixture_id, r.requested_by, 'forfeit_decided',
      case when p_approve then 'The club agrees — the league decides next' else 'The club says play the game' end,
      coalesce(nullif(btrim(coalesce(p_note, '')), ''), r.reason), jsonb_build_object('request_id', r.id));
  end if;
end;
$$;

create or replace function public.league_decide_forfeit(p_request uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  r      public.forfeit_requests;
  e      public.competition_entries;
  v_who  uuid;
  v_home text;
  v_away text;
begin
  select * into r from public.forfeit_requests where id = p_request;
  if r.id is null or not coalesce(app_private.may_run(r.competition_id, 'grounds'), false) then
    raise exception 'only the league decides a forfeit' using errcode = '42501';
  end if;
  if r.status not in ('proposed', 'club_approved') then
    raise exception 'already %', r.status using errcode = '22023';
  end if;
  select * into e from public.competition_entries where id = r.entry_id;
  update public.forfeit_requests
     set status = case when p_approve then 'approved' else 'declined' end,
         league_decided_by = auth.uid(), league_decided_at = now(), league_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_request;
  perform app_private.log_sheet(r.competition_id, r.fixture_id, r.entry_id,
    case when p_approve then 'forfeit_approved' else 'forfeit_declined' end,
    jsonb_build_object('request_id', r.id, 'note', p_note));
  if p_approve then
    -- 0156's forfeit: the division's forfeit score, every family told through the mirror.
    perform public.forfeit_fixture(r.fixture_id, r.entry_id, coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Forfeit — ' || r.reason));
  end if;

  select h.display_name, a.display_name into v_home, v_away
    from public.fixtures x
    left join public.competition_entries h on h.id = x.home_entry_id
    left join public.competition_entries a on a.id = x.away_entry_id
   where x.id = r.fixture_id;
  for v_who in
    select * from app_private.entry_managers(r.entry_id)
    union
    select * from app_private.entry_managers((select case when f.home_entry_id = r.entry_id then f.away_entry_id else f.home_entry_id end from public.fixtures f where f.id = r.fixture_id))
    union
    select r.requested_by
  loop
    if v_who <> auth.uid() then
      perform app_private.match_push(r.fixture_id, v_who, 'forfeit_decided',
        case when p_approve then e.display_name || ' forfeit ' || coalesce(v_home, '?') || ' v ' || coalesce(v_away, '?')
             else 'The league says play ' || coalesce(v_home, '?') || ' v ' || coalesce(v_away, '?') end,
        coalesce(nullif(btrim(coalesce(p_note, '')), ''), r.reason), jsonb_build_object('request_id', r.id));
    end if;
  end loop;
end;
$$;

create or replace function public.withdraw_forfeit_request(p_request uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r public.forfeit_requests;
begin
  select * into r from public.forfeit_requests where id = p_request;
  if r.id is null or not coalesce(app_private.can_manage_entry(r.entry_id), false) then
    raise exception 'only the team withdraws its own request' using errcode = '42501';
  end if;
  if r.status not in ('proposed', 'club_approved') then
    raise exception 'already %', r.status using errcode = '22023';
  end if;
  update public.forfeit_requests set status = 'withdrawn' where id = p_request;
  perform app_private.log_sheet(r.competition_id, r.fixture_id, r.entry_id, 'forfeit_withdrawn', jsonb_build_object('request_id', r.id));
end;
$$;

create or replace function public.forfeit_requests_view(p_competition uuid)
returns table (
  id uuid, fixture_id uuid, entry_id uuid, entry_name text, home text, away text, division text, round text,
  starts_at timestamptz, reason text, status text, requested_by_name text, created_at timestamptz,
  club_note text, club_decided_at timestamptz, league_note text, league_decided_at timestamptz
)
language sql stable set search_path = public as $$
  select r.id, r.fixture_id, r.entry_id,
         (select e.display_name from public.competition_entries e where e.id = r.entry_id),
         (select e.display_name from public.competition_entries e where e.id = f.home_entry_id),
         (select e.display_name from public.competition_entries e where e.id = f.away_entry_id),
         f.division, f.round, f.starts_at, r.reason, r.status,
         (select pr.full_name from public.profiles pr where pr.id = r.requested_by),
         r.created_at, r.club_note, r.club_decided_at, r.league_note, r.league_decided_at
    from public.forfeit_requests r
    join public.fixtures f on f.id = r.fixture_id
   where r.competition_id = p_competition
   order by (r.status in ('proposed', 'club_approved')) desc, r.created_at desc;
$$;

-- --------------------------------------------------------------- L-18 handover
alter table public.fixtures
  add column if not exists referee_verified_at timestamptz,
  add column if not exists referee_verified_by uuid references public.referees(id) on delete set null;

-- The last nine digits: an Australian mobile however it was typed —
-- "0400 000 777", "+61 400 000 777", "61400000777" are one number.
create or replace function app_private.phone_key(p_phone text)
returns text language sql immutable as $$
  select case when length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) >= 9
              then right(regexp_replace(p_phone, '\D', '', 'g'), 9) end;
$$;

create or replace function public.referee_verify_by_phone(p_fixture uuid, p_phone text, p_word text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  f        public.fixtures;
  v_ref    public.referees;
  v_tries  integer;
begin
  select * into f from public.fixtures where id = p_fixture;
  if f.id is null then
    raise exception 'no such game' using errcode = '22023';
  end if;
  -- The scorer holds the phone: a manager of either side.
  if not (coalesce(app_private.can_manage_entry(f.home_entry_id), false)
          or coalesce(app_private.can_manage_entry(f.away_entry_id), false)) then
    raise exception 'only a manager''s phone is handed to the referee' using errcode = '42501';
  end if;
  if f.referee_verified_at is not null then
    raise exception 'this game is already verified' using errcode = '22023';
  end if;
  if f.starts_at is null or f.starts_at > now() then
    raise exception 'the game has not kicked off' using errcode = '22023';
  end if;
  if f.status in ('bye', 'cancelled', 'postponed') then
    raise exception 'this game is %', f.status using errcode = '22023';
  end if;
  select count(*) into v_tries
    from public.match_sheet_log l
   where l.fixture_id = p_fixture and l.actor = auth.uid() and l.action = 'referee_verify_failed'
     and l.at > now() - interval '1 hour';
  if v_tries >= 5 then
    raise exception 'too many tries; ask the league to end the game' using errcode = '22023';
  end if;
  select r.* into v_ref
    from public.referee_appointments ap
    join public.referees r on r.id = ap.referee_id
   where ap.fixture_id = p_fixture and ap.role = 'referee' and ap.status = 'accepted'
   limit 1;
  if v_ref.id is null then
    raise exception 'no referee is appointed to this game' using errcode = '22023';
  end if;
  -- A wrong try is ANSWERED, not raised: a raise would roll the log entry
  -- back with it, and the record of failed tries is what makes five of
  -- them a lock.
  if lower(btrim(coalesce(p_word, ''))) <> 'confirm'
     or app_private.phone_key(v_ref.phone) is null
     or app_private.phone_key(p_phone) is null
     or app_private.phone_key(p_phone) <> app_private.phone_key(v_ref.phone) then
    perform app_private.log_sheet(f.competition_id, p_fixture, null, 'referee_verify_failed', '{}'::jsonb);
    return jsonb_build_object('ok', false,
      'reason', 'That is not the referee''s number, or the word is not Confirm.',
      'tries_left', greatest(0, 4 - v_tries));
  end if;

  update public.fixtures
     set referee_verified_at = now(), referee_verified_by = v_ref.id,
         ended_at = coalesce(ended_at, now()), ended_by = coalesce(ended_by, auth.uid()),
         updated_at = now()
   where id = p_fixture;
  perform app_private.log_sheet(f.competition_id, p_fixture, null, 'referee_verified',
    jsonb_build_object('referee_id', v_ref.id, 'referee', v_ref.full_name, 'on_scorers_phone', true));
  if f.ended_at is null then
    perform app_private.log_sheet(f.competition_id, p_fixture, null, 'match_ended',
      jsonb_build_object('by_referee_on_scorers_phone', true));
  end if;
  return jsonb_build_object('ok', true, 'verified_at', now(), 'referee', v_ref.full_name);
end;
$$;

-- A referee ending a game from their own phone verifies it too.
create or replace function public.end_match(p_fixture uuid, p_note text default null)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  f     public.fixtures;
  v_ref uuid;
begin
  select * into f from public.fixtures where id = p_fixture;
  if f.id is null then
    raise exception 'no such game' using errcode = '22023';
  end if;
  if not (coalesce(app_private.is_fixture_referee(p_fixture), false)
          or coalesce(app_private.may_run(f.competition_id, 'competition'), false)) then
    raise exception 'only the referee or the league ends a game' using errcode = '42501';
  end if;
  if f.ended_at is not null then
    return f.ended_at;
  end if;
  if f.starts_at is null or f.starts_at > now() then
    raise exception 'this game has not kicked off yet' using errcode = '22023';
  end if;
  if f.status in ('bye', 'cancelled', 'postponed') then
    raise exception 'this game is %', f.status using errcode = '22023';
  end if;
  if coalesce(app_private.is_fixture_referee(p_fixture), false) then
    select ap.referee_id into v_ref
      from public.referee_appointments ap join public.referees r on r.id = ap.referee_id
     where ap.fixture_id = p_fixture and ap.status = 'accepted' and r.profile_id = auth.uid()
     limit 1;
  end if;
  update public.fixtures
     set ended_at = now(), ended_by = auth.uid(),
         referee_verified_at = case when v_ref is not null then coalesce(referee_verified_at, now()) else referee_verified_at end,
         referee_verified_by = coalesce(referee_verified_by, v_ref),
         updated_at = now()
   where id = p_fixture;
  perform app_private.log_sheet(f.competition_id, p_fixture, null, 'match_ended',
    jsonb_build_object('note', nullif(btrim(coalesce(p_note, '')), ''), 'referee_verified', v_ref is not null));
  return now();
end;
$$;

-- ------------------------------------------------------ the view and the ops
create or replace function public.match_sheet_view(p_fixture uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  f        public.fixtures;
  v_lock   timestamptz;
  v_ref    boolean;
  v_run    boolean;
  v_ground boolean;
  v_inside boolean;
  v_mh     boolean;
  v_ma     boolean;
begin
  select * into f from public.fixtures where id = p_fixture;
  if f.id is null or not coalesce(app_private.is_competition_participant(f.competition_id), false) then
    raise exception 'not yours to see' using errcode = '42501';
  end if;
  v_lock := app_private.sheet_lock_at(p_fixture);
  v_ref  := coalesce(app_private.is_fixture_referee(p_fixture), false);
  v_run  := coalesce(app_private.may_run(f.competition_id, 'competition'), false);
  v_ground := coalesce(app_private.may_run(f.competition_id, 'grounds'), false);
  v_mh := coalesce(app_private.can_manage_entry(f.home_entry_id), false);
  v_ma := coalesce(app_private.can_manage_entry(f.away_entry_id), false);
  v_inside := v_run or v_ref or v_mh or v_ma;
  return jsonb_build_object(
    'fixture', jsonb_build_object(
      'id', f.id, 'division', f.division, 'round', f.round, 'starts_at', f.starts_at, 'stage', f.stage,
      'status', f.status, 'home_score', f.home_score, 'away_score', f.away_score,
      'score_disputed', f.score_disputed, 'notes', f.notes,
      'home_entry_id', f.home_entry_id, 'away_entry_id', f.away_entry_id,
      'home', (select e.display_name from public.competition_entries e where e.id = f.home_entry_id),
      'away', (select e.display_name from public.competition_entries e where e.id = f.away_entry_id),
      'ended_at', f.ended_at,
      'lock_at', v_lock,
      'locked', (v_lock is not null and now() >= v_lock),
      'referee_verified_at', f.referee_verified_at,
      'referee_verified_by', (select r.full_name from public.referees r where r.id = f.referee_verified_by)
    ),
    'can_manage_home', v_mh,
    'can_manage_away', v_ma,
    'is_organiser', coalesce(app_private.is_competition_organiser(f.competition_id), false),
    'is_referee', v_ref,
    'may_end', f.ended_at is null and (v_ref or v_run) and f.starts_at is not null and f.starts_at <= now()
               and f.status not in ('bye', 'cancelled', 'postponed'),
    'may_reopen', f.ended_at is not null and v_run,
    'may_grounds', v_ground,
    'is_club_staff_home', (select e.academy_id is not null and coalesce(app_private.is_academy_staff(e.academy_id), false)
                             from public.competition_entries e where e.id = f.home_entry_id),
    'is_club_staff_away', (select e.academy_id is not null and coalesce(app_private.is_academy_staff(e.academy_id), false)
                             from public.competition_entries e where e.id = f.away_entry_id),
    'referee_name', (select r.full_name from public.referee_appointments ap join public.referees r on r.id = ap.referee_id
                      where ap.fixture_id = p_fixture and ap.role = 'referee' and ap.status = 'accepted' limit 1),
    'can_hand_over', (v_mh or v_ma) and f.ended_at is null and f.referee_verified_at is null
                     and f.starts_at is not null and f.starts_at <= now()
                     and f.status not in ('bye', 'cancelled', 'postponed')
                     and exists (select 1 from public.referee_appointments ap where ap.fixture_id = p_fixture and ap.role = 'referee' and ap.status = 'accepted'),
    'rules', (select to_jsonb(r) from app_private.division_rules(f.competition_id, f.division) r),
    'sheets', coalesce((
      select jsonb_object_agg(case when s.entry_id = f.home_entry_id then 'home' else 'away' end,
        jsonb_build_object(
          'status', s.status, 'our_score', s.our_score, 'their_score', s.their_score,
          'captain_player_id', s.captain_player_id, 'keeper_player_id', s.keeper_player_id,
          'submitted_at', s.submitted_at, 'confirmed_at', s.confirmed_at,
          'players', coalesce((
            select jsonb_agg(jsonb_build_object('player_id', sp.player_id, 'number', sp.number, 'starting', sp.starting,
                     'name', (select pl.full_name from public.players pl where pl.id = sp.player_id))
                     order by sp.starting desc, sp.number nulls last)
              from public.match_sheet_players sp where sp.sheet_id = s.id), '[]'::jsonb)
        ))
        from public.match_sheets s where s.fixture_id = p_fixture
    ), '{}'::jsonb),
    'squads', jsonb_build_object(
      'home', coalesce((select jsonb_agg(jsonb_build_object('player_id', q.player_id, 'number', q.number,
                         'name', (select pl.full_name from public.players pl where pl.id = q.player_id),
                         'ineligible', app_private.ineligibility(f.home_entry_id, q.player_id, coalesce(f.starts_at::date, current_date), f.id))
                         order by q.number nulls last)
                  from public.entry_squads q where q.entry_id = f.home_entry_id), '[]'::jsonb),
      'away', coalesce((select jsonb_agg(jsonb_build_object('player_id', q.player_id, 'number', q.number,
                         'name', (select pl.full_name from public.players pl where pl.id = q.player_id),
                         'ineligible', app_private.ineligibility(f.away_entry_id, q.player_id, coalesce(f.starts_at::date, current_date), f.id))
                         order by q.number nulls last)
                  from public.entry_squads q where q.entry_id = f.away_entry_id), '[]'::jsonb)
    ),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'entry_id', e.entry_id, 'player_id', e.player_id,
               'name', (select pl.full_name from public.players pl where pl.id = e.player_id),
               'kind', e.kind, 'minute', e.minute, 'note', e.note, 'code', e.sanction_code) order by e.minute nulls last, e.created_at)
        from public.match_events e where e.fixture_id = p_fixture), '[]'::jsonb),
    'corrections', case when v_inside then coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'detail', c.detail,
               'proposed_home', c.proposed_home, 'proposed_away', c.proposed_away, 'status', c.status,
               'requested_by', (select pr.full_name from public.profiles pr where pr.id = c.requested_by),
               'created_at', c.created_at, 'decided_at', c.decided_at, 'decision_note', c.decision_note)
               order by (c.status = 'open') desc, c.created_at desc)
        from public.match_corrections c where c.fixture_id = p_fixture), '[]'::jsonb) else '[]'::jsonb end,
    'forfeits', case when v_inside then coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'entry_id', r.entry_id,
               'entry', (select e.display_name from public.competition_entries e where e.id = r.entry_id),
               'reason', r.reason, 'status', r.status,
               'requested_by', (select pr.full_name from public.profiles pr where pr.id = r.requested_by),
               'created_at', r.created_at, 'club_note', r.club_note, 'league_note', r.league_note)
               order by (r.status in ('proposed', 'club_approved')) desc, r.created_at desc)
        from public.forfeit_requests r where r.fixture_id = p_fixture), '[]'::jsonb) else '[]'::jsonb end,
    'log', coalesce((
      select jsonb_agg(jsonb_build_object('action', l.action, 'detail', l.detail, 'at', l.at,
               'by', (select pr.full_name from public.profiles pr where pr.id = l.actor)) order by l.at)
        from public.match_sheet_log l where l.fixture_id = p_fixture), '[]'::jsonb)
  );
end;
$$;

-- match_day_ops gains the forfeits waiting on the league.
create or replace function public.match_day_ops(p_competition uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_any boolean;
begin
  v_any := coalesce(app_private.may_run(p_competition, 'competition'), false)
        or coalesce(app_private.may_run(p_competition, 'referees'), false)
        or coalesce(app_private.may_run(p_competition, 'discipline'), false)
        or coalesce(app_private.may_run(p_competition, 'grounds'), false);
  if not v_any then
    return null;
  end if;
  return jsonb_build_object(
    'missing_sheets', coalesce((
      select jsonb_agg(jsonb_build_object('fixture_id', f.id, 'starts_at', f.starts_at, 'division', f.division,
               'home', h.display_name, 'away', a.display_name,
               'sheets', (select count(*) from public.match_sheets s where s.fixture_id = f.id)) order by f.starts_at desc)
        from public.fixtures f
        left join public.competition_entries h on h.id = f.home_entry_id
        left join public.competition_entries a on a.id = f.away_entry_id
       where f.competition_id = p_competition
         and f.starts_at between now() - interval '7 days' and now()
         and f.status in ('scheduled', 'in_progress', 'final')
         and f.home_entry_id is not null and f.away_entry_id is not null
         and (select count(*) from public.match_sheets s where s.fixture_id = f.id) < 2), '[]'::jsonb),
    'unverified', coalesce((
      select jsonb_agg(jsonb_build_object('fixture_id', f.id, 'starts_at', f.starts_at, 'division', f.division,
               'home', h.display_name, 'away', a.display_name,
               'state', case when f.score_disputed then 'disputed' else 'one side' end) order by f.starts_at desc)
        from public.fixtures f
        left join public.competition_entries h on h.id = f.home_entry_id
        left join public.competition_entries a on a.id = f.away_entry_id
       where f.competition_id = p_competition
         and f.status in ('scheduled', 'in_progress')
         and f.starts_at < now()
         and (f.score_disputed
              or exists (select 1 from public.match_sheets s where s.fixture_id = f.id and s.our_score is not null))), '[]'::jsonb),
    'not_ended', coalesce((
      select jsonb_agg(jsonb_build_object('fixture_id', f.id, 'starts_at', f.starts_at, 'division', f.division,
               'home', h.display_name, 'away', a.display_name, 'status', f.status) order by f.starts_at desc)
        from public.fixtures f
        left join public.competition_entries h on h.id = f.home_entry_id
        left join public.competition_entries a on a.id = f.away_entry_id
       where f.competition_id = p_competition
         and f.ended_at is null
         and f.starts_at between now() - interval '7 days' and now() - interval '3 hours'
         and f.status in ('scheduled', 'in_progress', 'final')
         and f.home_entry_id is not null and f.away_entry_id is not null), '[]'::jsonb),
    'pending_reports', coalesce((
      select jsonb_agg(jsonb_build_object('fixture_id', f.id, 'starts_at', f.starts_at, 'division', f.division,
               'home', h.display_name, 'away', a.display_name, 'referee', r.full_name) order by f.starts_at desc)
        from public.referee_appointments ap
        join public.referees r on r.id = ap.referee_id
        join public.fixtures f on f.id = ap.fixture_id
        left join public.competition_entries h on h.id = f.home_entry_id
        left join public.competition_entries a on a.id = f.away_entry_id
       where ap.competition_id = p_competition
         and ap.role = 'referee' and ap.status = 'accepted' and ap.reported_at is null
         and f.starts_at between now() - interval '14 days' and now() - interval '2 hours'
         and f.status in ('scheduled', 'in_progress', 'final')), '[]'::jsonb),
    'unfilled', coalesce((
      select jsonb_agg(jsonb_build_object('fixture_id', f.id, 'starts_at', f.starts_at, 'division', f.division,
               'home', h.display_name, 'away', a.display_name) order by f.starts_at)
        from public.fixtures f
        left join public.competition_entries h on h.id = f.home_entry_id
        left join public.competition_entries a on a.id = f.away_entry_id
       where f.competition_id = p_competition
         and f.status = 'scheduled'
         and f.starts_at between now() and now() + interval '7 days'
         and not exists (select 1 from public.referee_appointments ra
                          where ra.fixture_id = f.id and ra.role = 'referee' and ra.status = 'accepted')), '[]'::jsonb),
    'suspensions', coalesce((
      select jsonb_agg(jsonb_build_object('player', pl.full_name, 'team', e.display_name,
               'reason', s.reason, 'left', s.games - s.served, 'code', s.sanction_code) order by s.issued_at desc)
        from public.suspensions s
        join public.players pl on pl.id = s.player_id
        left join public.competition_entries e on e.id = s.entry_id
       where s.competition_id = p_competition and s.status = 'active' and s.served < s.games), '[]'::jsonb),
    'corrections', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'fixture_id', c.fixture_id, 'kind', c.kind, 'detail', c.detail,
               'home', h.display_name, 'away', a.display_name, 'created_at', c.created_at) order by c.created_at)
        from public.match_corrections c
        join public.fixtures f on f.id = c.fixture_id
        left join public.competition_entries h on h.id = f.home_entry_id
        left join public.competition_entries a on a.id = f.away_entry_id
       where c.competition_id = p_competition and c.status = 'open'), '[]'::jsonb),
    'forfeits', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'fixture_id', r.fixture_id, 'reason', r.reason, 'status', r.status,
               'entry', (select e.display_name from public.competition_entries e where e.id = r.entry_id),
               'home', h.display_name, 'away', a.display_name, 'starts_at', f.starts_at, 'created_at', r.created_at) order by f.starts_at)
        from public.forfeit_requests r
        join public.fixtures f on f.id = r.fixture_id
        left join public.competition_entries h on h.id = f.home_entry_id
        left join public.competition_entries a on a.id = f.away_entry_id
       where r.competition_id = p_competition and r.status in ('proposed', 'club_approved')), '[]'::jsonb),
    'change_requests', (select count(*) from public.fixture_change_requests r
                         where r.competition_id = p_competition and r.status in ('proposed', 'agreed')),
    'flowing_until', (select c.flowing_until from public.competitions c where c.id = p_competition)
  );
end;
$$;

revoke execute on function public.request_forfeit(uuid, uuid, text) from public, anon;
grant execute on function public.request_forfeit(uuid, uuid, text) to authenticated;
revoke execute on function public.club_decide_forfeit(uuid, boolean, text) from public, anon;
grant execute on function public.club_decide_forfeit(uuid, boolean, text) to authenticated;
revoke execute on function public.league_decide_forfeit(uuid, boolean, text) from public, anon;
grant execute on function public.league_decide_forfeit(uuid, boolean, text) to authenticated;
revoke execute on function public.withdraw_forfeit_request(uuid) from public, anon;
grant execute on function public.withdraw_forfeit_request(uuid) to authenticated;
revoke execute on function public.forfeit_requests_view(uuid) from public, anon;
grant execute on function public.forfeit_requests_view(uuid) to authenticated;
revoke execute on function public.referee_verify_by_phone(uuid, text, text) from public, anon;
grant execute on function public.referee_verify_by_phone(uuid, text, text) to authenticated;
