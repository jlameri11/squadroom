-- 0191: referee extras, nominations, and the bulk tools.
--
-- The last three Squadi-parity rows of M9 (SQUADI_INTEL §6A.9, §6A.11,
-- §6A.12):
--
-- L-25  REFEREE EXTRAS. A decline needs a reason; pulling out of an accepted
--       game inside the league's late-decline window is refused (ring the
--       league). A league can let claimed referees of the right grade take
--       an unfilled game themselves. Inside the last hours before kick-off
--       a club can allocate its own referee to a game nobody has taken. A
--       referee under eighteen names who is paid for them.
--
-- L-27  NOMINATIONS. A club proposes a division for each of its teams with
--       a comment, which locks the squad; the league sets the division it
--       plays in and can unlock. A division can carry a date-of-birth band,
--       enforced on the sheet, which the league can exempt a player from.
--
-- L-28  BULK TOOLS. Scores for many games in one call (by game or by the
--       file's match id); a whole round shifted by days, every family told
--       through the mirror; a whole round called off.

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
    'fixture_flowing_open','discipline_warning','discipline_suspension','forfeit_request','forfeit_decided',
    'nomination']));
end $$;

-- ------------------------------------------------------------- L-25 rules
alter table public.competitions
  add column if not exists late_decline_hours integer not null default 24,
  add column if not exists self_appoint boolean not null default false,
  add column if not exists self_appoint_grades text[],
  add column if not exists club_allocate_hours integer not null default 48;
alter table public.competitions
  drop constraint if exists competitions_late_decline_hours_check,
  add constraint competitions_late_decline_hours_check check (late_decline_hours between 0 and 168),
  drop constraint if exists competitions_club_allocate_hours_check,
  add constraint competitions_club_allocate_hours_check check (club_allocate_hours between 0 and 168);

alter table public.referees
  add column if not exists payee_name text,
  add column if not exists under_18 boolean not null default false,
  add column if not exists allocated_by_club uuid references public.academies(id) on delete set null;
comment on column public.referees.payee_name is
  'L-25: who is paid for this referee — a parent, for an under-18.';
comment on column public.referees.allocated_by_club is
  'L-25: put forward by a club for a game nobody had taken; not the league''s own pool.';

create or replace function public.set_referee_rules(p_competition uuid, p_late_decline_hours integer, p_self_appoint boolean, p_grades text[] default null, p_club_allocate_hours integer default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(app_private.may_run(p_competition, 'referees'), false) then
    raise exception 'only the league sets referee rules' using errcode = '42501';
  end if;
  update public.competitions
     set late_decline_hours = coalesce(p_late_decline_hours, late_decline_hours),
         self_appoint = coalesce(p_self_appoint, self_appoint),
         self_appoint_grades = case when p_grades is null or array_length(p_grades, 1) is null then null else p_grades end,
         club_allocate_hours = coalesce(p_club_allocate_hours, club_allocate_hours),
         updated_at = now()
   where id = p_competition;
end;
$$;

-- 0161's response, with a reason on a decline and the late-decline block.
create or replace function public.respond_appointment(p_appointment uuid, p_accept boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_ap   public.referee_appointments;
  v_ref  public.referees;
  v_comp public.competitions;
  v_home text; v_away text; v_when timestamptz;
begin
  select * into v_ap from public.referee_appointments where id = p_appointment;
  if v_ap.id is null or not app_private.is_this_referee(v_ap.referee_id) then
    raise exception 'that appointment is not yours' using errcode = '42501';
  end if;
  if v_ap.status = 'withdrawn' then
    raise exception 'that appointment was withdrawn' using errcode = '22023';
  end if;
  select h.display_name, a.display_name, f.starts_at into v_home, v_away, v_when
    from public.fixtures f
    left join public.competition_entries h on h.id = f.home_entry_id
    left join public.competition_entries a on a.id = f.away_entry_id
   where f.id = v_ap.fixture_id;
  if not p_accept then
    if length(btrim(coalesce(p_note, ''))) = 0 then
      raise exception 'say why you cannot do it' using errcode = '22023';
    end if;
    select * into v_comp from public.competitions where id = v_ap.competition_id;
    if v_ap.status = 'accepted' and v_comp.late_decline_hours > 0
       and v_when is not null and v_when - now() < (v_comp.late_decline_hours || ' hours')::interval then
      raise exception 'that game is inside % hours of kick-off; ring the league rather than pull out here', v_comp.late_decline_hours
        using errcode = '22023';
    end if;
  end if;
  update public.referee_appointments
     set status = case when p_accept then 'accepted' else 'declined' end::public.appointment_status,
         responded_at = now(),
         response_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_appointment;

  select * into v_ref from public.referees where id = v_ap.referee_id;
  if v_ap.offered_by is not null then
    insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload, dedupe_key)
    values (v_ap.academy_id, v_ap.offered_by, 'referee_response',
            v_ref.full_name || case when p_accept then ' accepted ' else ' declined ' end
              || coalesce(v_home, 'TBC') || ' v ' || coalesce(v_away, 'TBC'),
            to_char(v_when at time zone 'Australia/Sydney', 'FMDay FMDD Mon, FMHH12:MIam')
              || coalesce(' — ' || nullif(btrim(coalesce(p_note, '')), ''), ''),
            '/competitions/' || v_ap.competition_id || '?tab=referees',
            jsonb_build_object('appointment_id', p_appointment, 'fixture_id', v_ap.fixture_id, 'accepted', p_accept),
            -- Milliseconds: an accept and a decline in the same second are two pushes.
            'ref-resp-' || p_appointment || '-' || extract(epoch from clock_timestamp())::numeric(20,3))
    on conflict (dedupe_key) do nothing;
  end if;
end;
$$;

-- A claimed referee of the right grade takes an unfilled game.
create or replace function public.self_appoint(p_fixture uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  f      public.fixtures;
  v_comp public.competitions;
  v_ref  public.referees;
  v_why  text;
  v_id   uuid;
  v_who  uuid;
  v_home text; v_away text;
begin
  select * into f from public.fixtures where id = p_fixture;
  if f.id is null then
    raise exception 'no such game' using errcode = '22023';
  end if;
  select * into v_comp from public.competitions where id = f.competition_id;
  select r.* into v_ref from public.referees r
   where r.academy_id = v_comp.organiser_id and r.profile_id = auth.uid() and r.status = 'active'
   limit 1;
  if v_ref.id is null then
    raise exception 'you are not in this league''s pool' using errcode = '42501';
  end if;
  if not v_comp.self_appoint then
    raise exception 'this league appoints its referees itself' using errcode = '22023';
  end if;
  if v_comp.self_appoint_grades is not null and not (coalesce(v_ref.grade, '') = any (v_comp.self_appoint_grades)) then
    raise exception 'games here are open to %, not your grade', array_to_string(v_comp.self_appoint_grades, ' / ') using errcode = '22023';
  end if;
  if f.status <> 'scheduled' or f.starts_at is null or f.starts_at < now() then
    raise exception 'that game is not open' using errcode = '22023';
  end if;
  if exists (select 1 from public.referee_appointments ap where ap.fixture_id = p_fixture and ap.role = 'referee' and ap.status in ('offered', 'accepted')) then
    raise exception 'that game already has a referee' using errcode = '23505';
  end if;
  v_why := app_private.referee_unavailable_reason(v_ref.id, p_fixture);
  if v_why is not null then
    raise exception 'you are %', v_why using errcode = '22023';
  end if;
  insert into public.referee_appointments (competition_id, fixture_id, referee_id, academy_id, role, status, offered_by, responded_at)
  values (f.competition_id, p_fixture, v_ref.id, v_comp.organiser_id, 'referee', 'accepted', null, now())
  on conflict (fixture_id, referee_id) do update
    set role = 'referee', status = 'accepted', responded_at = now(), response_note = null, withdrawn_note = null
  returning id into v_id;

  select h.display_name, a.display_name into v_home, v_away
    from public.fixtures x
    left join public.competition_entries h on h.id = x.home_entry_id
    left join public.competition_entries a on a.id = x.away_entry_id
   where x.id = p_fixture;
  for v_who in select * from app_private.area_holders(f.competition_id, 'referees') loop
    insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload, dedupe_key)
    values (v_comp.organiser_id, v_who, 'referee_response',
            v_ref.full_name || ' took ' || coalesce(v_home, 'TBC') || ' v ' || coalesce(v_away, 'TBC'),
            to_char(f.starts_at at time zone app_private.competition_tz(f.competition_id), 'FMDay FMDD Mon, FMHH12:MIam') || ' — self-appointed',
            '/competitions/' || f.competition_id || '?tab=referees',
            jsonb_build_object('appointment_id', v_id, 'fixture_id', p_fixture, 'self', true),
            'ref-self-' || v_id || '-' || v_who || '-' || extract(epoch from now())::bigint)
    on conflict (dedupe_key) do nothing;
  end loop;
  return v_id;
end;
$$;

-- The games a referee may take: unfilled, open, their grade.
create or replace function public.open_games_for_me()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_agg(jsonb_build_object(
             'fixture_id', f.id, 'starts_at', f.starts_at, 'competition', c.name, 'competition_id', c.id,
             'division', f.division, 'round', f.round, 'venue', coalesce(v.name, f.venue_label), 'field', f.field_label,
             'home', h.display_name, 'away', a.display_name,
             'unavailable', app_private.referee_unavailable_reason(r.id, f.id))
             order by f.starts_at)
      from public.referees r
      join public.competitions c on c.organiser_id = r.academy_id and c.self_appoint
      join public.fixtures f on f.competition_id = c.id and f.status = 'scheduled' and f.starts_at > now()
      left join public.venues v on v.id = f.venue_id
      left join public.competition_entries h on h.id = f.home_entry_id
      left join public.competition_entries a on a.id = f.away_entry_id
     where r.profile_id = auth.uid() and r.status = 'active'
       and (c.self_appoint_grades is null or coalesce(r.grade, '') = any (c.self_appoint_grades))
       and not exists (select 1 from public.referee_appointments ap
                        where ap.fixture_id = f.id and ap.role = 'referee' and ap.status in ('offered', 'accepted'))
  ), '[]'::jsonb);
$$;

-- A club puts forward its own referee for a game nobody has taken, inside
-- the league's window. Unpaid by the league; in the pool, marked as the club's.
create or replace function public.club_allocate_referee(p_fixture uuid, p_full_name text, p_phone text default null, p_grade text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  f       public.fixtures;
  v_comp  public.competitions;
  v_club  uuid;
  v_ref   uuid;
  v_id    uuid;
  v_who   uuid;
  v_home  text; v_away text;
begin
  select * into f from public.fixtures where id = p_fixture;
  if f.id is null then
    raise exception 'no such game' using errcode = '22023';
  end if;
  if coalesce(app_private.can_manage_entry(f.home_entry_id), false) then
    select academy_id into v_club from public.competition_entries where id = f.home_entry_id;
  elsif coalesce(app_private.can_manage_entry(f.away_entry_id), false) then
    select academy_id into v_club from public.competition_entries where id = f.away_entry_id;
  else
    raise exception 'only a manager of one of the teams allocates a referee' using errcode = '42501';
  end if;
  select * into v_comp from public.competitions where id = f.competition_id;
  if v_comp.club_allocate_hours <= 0 then
    raise exception 'this league does not let clubs allocate referees' using errcode = '22023';
  end if;
  if f.status <> 'scheduled' or f.starts_at is null then
    raise exception 'that game is not on' using errcode = '22023';
  end if;
  if f.starts_at - now() > (v_comp.club_allocate_hours || ' hours')::interval then
    raise exception 'only inside % hours of kick-off, once the league has had its chance', v_comp.club_allocate_hours using errcode = '22023';
  end if;
  if exists (select 1 from public.referee_appointments ap where ap.fixture_id = p_fixture and ap.role = 'referee' and ap.status in ('offered', 'accepted')) then
    raise exception 'that game already has a referee' using errcode = '23505';
  end if;
  if length(btrim(coalesce(p_full_name, ''))) = 0 then
    raise exception 'a referee needs a name' using errcode = '22023';
  end if;
  insert into public.referees (academy_id, full_name, phone, grade, status, created_by, allocated_by_club)
  values (v_comp.organiser_id, btrim(p_full_name), nullif(btrim(coalesce(p_phone, '')), ''), nullif(btrim(coalesce(p_grade, '')), ''), 'active', auth.uid(), v_club)
  returning id into v_ref;
  insert into public.referee_appointments (competition_id, fixture_id, referee_id, academy_id, role, status, offered_by, responded_at, fee_cents)
  values (f.competition_id, p_fixture, v_ref, v_comp.organiser_id, 'referee', 'accepted', auth.uid(), now(), 0)
  returning id into v_id;

  select h.display_name, a.display_name into v_home, v_away
    from public.fixtures x
    left join public.competition_entries h on h.id = x.home_entry_id
    left join public.competition_entries a on a.id = x.away_entry_id
   where x.id = p_fixture;
  for v_who in select * from app_private.area_holders(f.competition_id, 'referees') loop
    insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload, dedupe_key)
    values (v_comp.organiser_id, v_who, 'referee_response',
            (select a.name from public.academies a where a.id = v_club) || ' put up ' || btrim(p_full_name) || ' for ' || coalesce(v_home, 'TBC') || ' v ' || coalesce(v_away, 'TBC'),
            to_char(f.starts_at at time zone app_private.competition_tz(f.competition_id), 'FMDay FMDD Mon, FMHH12:MIam') || ' — nobody from the pool had it',
            '/competitions/' || f.competition_id || '?tab=referees',
            jsonb_build_object('appointment_id', v_id, 'fixture_id', p_fixture, 'club', v_club),
            'ref-club-' || v_id || '-' || v_who || '-' || extract(epoch from now())::bigint)
    on conflict (dedupe_key) do nothing;
  end loop;
  return v_id;
end;
$$;

-- What the match page needs to offer a club the allocation.
create or replace function public.club_allocate_window(p_fixture uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'mine', coalesce(app_private.can_manage_entry(f.home_entry_id), false) or coalesce(app_private.can_manage_entry(f.away_entry_id), false),
    'hours', c.club_allocate_hours,
    'has_referee', exists (select 1 from public.referee_appointments ap where ap.fixture_id = f.id and ap.role = 'referee' and ap.status in ('offered', 'accepted')),
    'open', c.club_allocate_hours > 0 and f.status = 'scheduled' and f.starts_at is not null
            and f.starts_at > now() and f.starts_at - now() <= (c.club_allocate_hours || ' hours')::interval
            and not exists (select 1 from public.referee_appointments ap where ap.fixture_id = f.id and ap.role = 'referee' and ap.status in ('offered', 'accepted')))
    from public.fixtures f join public.competitions c on c.id = f.competition_id
   where f.id = p_fixture;
$$;
revoke execute on function public.club_allocate_window(uuid) from public, anon;
grant execute on function public.club_allocate_window(uuid) to authenticated;

drop function if exists public.set_my_bank_details(uuid, text);
drop function if exists public.set_my_bank_details(uuid, text, text, boolean);
create function public.set_my_bank_details(p_referee uuid, p_details text, p_payee_name text default null, p_under_18 boolean default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not app_private.is_this_referee(p_referee) then
    raise exception 'that is not your referee record' using errcode = '42501';
  end if;
  update public.referees
     set bank_details = nullif(btrim(coalesce(p_details, '')), ''),
         payee_name = coalesce(nullif(btrim(coalesce(p_payee_name, '')), ''), case when p_payee_name is null then payee_name end),
         under_18 = coalesce(p_under_18, under_18)
   where id = p_referee;
end;
$$;
revoke execute on function public.set_my_bank_details(uuid, text, text, boolean) from public, anon;
grant execute on function public.set_my_bank_details(uuid, text, text, boolean) to authenticated;

-- my_appointments: the payee and the rules, for the referee's own page.
create or replace function public.my_appointments()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'pools', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'league', a.name, 'grade', r.grade, 'status', r.status,
               'bank_details', r.bank_details, 'payee_name', r.payee_name, 'under_18', r.under_18) order by a.name)
        from public.referees r join public.academies a on a.id = r.academy_id
       where r.profile_id = auth.uid()
    ), '[]'::jsonb),
    'appointments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', ap.id,
               'role', ap.role,
               'status', ap.status,
               'offered_at', ap.offered_at,
               'checked_in_at', ap.checked_in_at,
               'reported_at', ap.reported_at,
               'report', ap.report,
               'withdrawn_note', ap.withdrawn_note,
               'fixture_id', f.id,
               'home_entry_id', f.home_entry_id,
               'away_entry_id', f.away_entry_id,
               'starts_at', f.starts_at,
               'fixture_status', f.status,
               'competition', c.name,
               'competition_id', c.id,
               'league', a.name,
               'division', f.division,
               'round', f.round,
               'venue', coalesce(v.name, f.venue_label),
               'address', v.address,
               'field', f.field_label,
               'home', h.display_name,
               'away', aw.display_name,
               'home_score', f.home_score,
               'away_score', f.away_score,
               'fee_cents', coalesce(ap.fee_cents, (select x.fee_cents from public.competition_referee_fees x where x.competition_id = c.id and x.role = ap.role)),
               'paid_at', (select i.paid_at from public.referee_payment_items i where i.appointment_id = ap.id and i.status = 'paid'),
               'late_decline_hours', c.late_decline_hours
             ) order by f.starts_at desc nulls last)
        from public.referee_appointments ap
        join public.referees r on r.id = ap.referee_id
        join public.fixtures f on f.id = ap.fixture_id
        join public.competitions c on c.id = f.competition_id
        join public.academies a on a.id = ap.academy_id
        left join public.venues v on v.id = f.venue_id
        left join public.competition_entries h on h.id = f.home_entry_id
        left join public.competition_entries aw on aw.id = f.away_entry_id
       where r.profile_id = auth.uid()
    ), '[]'::jsonb),
    'blockouts', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'referee_id', b.referee_id, 'starts_at', b.starts_at, 'ends_at', b.ends_at, 'reason', b.reason) order by b.starts_at)
        from public.referee_blockouts b
        join public.referees r on r.id = b.referee_id
       where r.profile_id = auth.uid() and b.ends_at >= now() - interval '30 days'
    ), '[]'::jsonb),
    'open_games', public.open_games_for_me()
  );
$$;

-- ----------------------------------------------------------- L-27 nominations
alter table public.competition_entries
  add column if not exists proposed_division text,
  add column if not exists nomination_note text,
  add column if not exists nominated_at timestamptz,
  add column if not exists squad_locked_at timestamptz;
alter table public.competition_divisions
  add column if not exists born_after date,
  add column if not exists born_before date;
alter table public.entry_squads
  add column if not exists age_exempt boolean not null default false,
  add column if not exists age_exempt_by uuid references public.profiles(id) on delete set null;
comment on column public.competition_entries.squad_locked_at is
  'L-27: nominated — the squad changes only when the league unlocks it.';

-- A locked squad changes only by the league's hand.
create or replace function public.guard_locked_squad()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_entry uuid := coalesce(new.entry_id, old.entry_id);
  e public.competition_entries;
begin
  select * into e from public.competition_entries where id = v_entry;
  if e.squad_locked_at is not null and not coalesce(app_private.is_competition_organiser(e.competition_id), false) then
    raise exception 'this squad was nominated on % and is locked; ask the league to unlock it',
      to_char(e.squad_locked_at at time zone 'Australia/Sydney', 'FMDD Mon') using errcode = '22023';
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists entry_squads_locked on public.entry_squads;
create trigger entry_squads_locked
  before insert or delete on public.entry_squads
  for each row execute function public.guard_locked_squad();
-- A trigger function is never called by a client, but 0185's door stays shut.
revoke execute on function public.guard_locked_squad() from public, anon, authenticated;

create or replace function public.nominate_entry(p_entry uuid, p_division text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  e     public.competition_entries;
  v_who uuid;
  v_n   integer;
begin
  select * into e from public.competition_entries where id = p_entry;
  if e.id is null or not coalesce(app_private.can_manage_entry(p_entry), false) then
    raise exception 'only the club nominates its team' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_division, ''))) = 0 then
    raise exception 'propose a division' using errcode = '22023';
  end if;
  select count(*) into v_n from public.entry_squads s where s.entry_id = p_entry;
  if v_n = 0 then
    raise exception 'put the squad together first — a nomination locks it' using errcode = '22023';
  end if;
  update public.competition_entries
     set proposed_division = btrim(p_division), nomination_note = nullif(btrim(coalesce(p_note, '')), ''),
         nominated_at = now(), squad_locked_at = coalesce(squad_locked_at, now())
   where id = p_entry;
  for v_who in select * from app_private.area_holders(e.competition_id, 'competition') loop
    insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload, dedupe_key)
    select c.organiser_id, v_who, 'nomination',
           e.display_name || ' nominated for ' || btrim(p_division),
           v_n || ' players, squad locked' || coalesce(' — ' || nullif(btrim(coalesce(p_note, '')), ''), ''),
           '/competitions/' || e.competition_id || '?tab=clubs',
           jsonb_build_object('entry_id', p_entry),
           'nom-' || p_entry || '-' || v_who || '-' || extract(epoch from now())::bigint
      from public.competitions c where c.id = e.competition_id
    on conflict (dedupe_key) do nothing;
  end loop;
end;
$$;

create or replace function public.set_entry_division(p_entry uuid, p_division text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  e     public.competition_entries;
  v_who uuid;
begin
  select * into e from public.competition_entries where id = p_entry;
  if e.id is null or not coalesce(app_private.may_run(e.competition_id, 'competition'), false) then
    raise exception 'only the league sets a team''s division' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_division, ''))) = 0 then
    raise exception 'a division is needed' using errcode = '22023';
  end if;
  update public.competition_entries set division = btrim(p_division) where id = p_entry;
  for v_who in select * from app_private.entry_managers(p_entry) loop
    insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload, dedupe_key)
    select c.organiser_id, v_who, 'nomination',
           e.display_name || ' are in ' || btrim(p_division),
           coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Set by the league' || case when e.proposed_division is not null and lower(e.proposed_division) <> lower(btrim(p_division)) then ' (you proposed ' || e.proposed_division || ')' else '' end),
           '/competitions/' || e.competition_id,
           jsonb_build_object('entry_id', p_entry),
           'div-' || p_entry || '-' || v_who || '-' || extract(epoch from now())::bigint
      from public.competitions c where c.id = e.competition_id
    on conflict (dedupe_key) do nothing;
  end loop;
end;
$$;

create or replace function public.lock_entry_squad(p_entry uuid, p_locked boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  e public.competition_entries;
begin
  select * into e from public.competition_entries where id = p_entry;
  if e.id is null or not coalesce(app_private.may_run(e.competition_id, 'competition'), false) then
    raise exception 'only the league locks or unlocks a squad' using errcode = '42501';
  end if;
  update public.competition_entries
     set squad_locked_at = case when p_locked then coalesce(squad_locked_at, now()) end
   where id = p_entry;
end;
$$;

create or replace function public.exempt_player_age(p_entry uuid, p_player uuid, p_exempt boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  e public.competition_entries;
begin
  select * into e from public.competition_entries where id = p_entry;
  if e.id is null or not coalesce(app_private.may_run(e.competition_id, 'competition'), false) then
    raise exception 'only the league exempts a player from the age band' using errcode = '42501';
  end if;
  update public.entry_squads set age_exempt = p_exempt, age_exempt_by = case when p_exempt then auth.uid() end
   where entry_id = p_entry and player_id = p_player;
  if not found then
    raise exception 'that player is not on this squad' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.entry_nominations(p_competition uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not coalesce(app_private.may_run(p_competition, 'competition'), false) then null else coalesce((
    select jsonb_agg(jsonb_build_object(
             'entry_id', e.id, 'name', e.display_name, 'club', a.name, 'division', e.division,
             'proposed_division', e.proposed_division, 'note', e.nomination_note, 'nominated_at', e.nominated_at,
             'locked', e.squad_locked_at is not null,
             'players', (select count(*) from public.entry_squads s where s.entry_id = e.id),
             'outside_band', (select count(*) from public.entry_squads s join public.players pl on pl.id = s.player_id
                               join public.competition_divisions d on d.competition_id = e.competition_id and d.division = e.division
                              where s.entry_id = e.id and not s.age_exempt
                                and ((d.born_after is not null and pl.dob < d.born_after) or (d.born_before is not null and pl.dob > d.born_before))))
             order by (e.nominated_at is not null) desc, e.nominated_at desc, e.display_name)
      from public.competition_entries e
      left join public.academies a on a.id = e.academy_id
     where e.competition_id = p_competition), '[]'::jsonb) end;
$$;

-- The club's own teams here, with where they stand.
create or replace function public.my_entries(p_competition uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_agg(jsonb_build_object(
             'entry_id', e.id, 'name', e.display_name, 'division', e.division,
             'proposed_division', e.proposed_division, 'note', e.nomination_note, 'nominated_at', e.nominated_at,
             'locked', e.squad_locked_at is not null,
             'players', (select count(*) from public.entry_squads s where s.entry_id = e.id))
             order by e.display_name)
      from public.competition_entries e
     where e.competition_id = p_competition and app_private.can_manage_entry(e.id)
       and not coalesce(app_private.is_competition_organiser(p_competition), false)), '[]'::jsonb);
$$;

-- The date-of-birth band, on the sheet.
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

-- ------------------------------------------------------------ L-28 bulk tools
create or replace function public.bulk_scores(p_competition uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r         jsonb;
  i         integer := 0;
  f         public.fixtures;
  v_home    integer;
  v_away    integer;
  v_done    integer := 0;
  v_skipped jsonb := '[]'::jsonb;
begin
  if not coalesce(app_private.may_run(p_competition, 'competition'), false) then
    raise exception 'only the league enters scores in bulk' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be an array' using errcode = '22023';
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    f := null;
    if coalesce(r->>'fixture_id', '') <> '' then
      select * into f from public.fixtures where id = (r->>'fixture_id')::uuid and competition_id = p_competition;
    elsif coalesce(r->>'external_ref', '') <> '' then
      select * into f from public.fixtures where external_ref = r->>'external_ref' and competition_id = p_competition;
    end if;
    if f.id is null then
      v_skipped := v_skipped || jsonb_build_object('row', i, 'why', 'no such game');
      continue;
    end if;
    begin
      v_home := (r->>'home')::integer;
      v_away := (r->>'away')::integer;
    exception when others then
      v_skipped := v_skipped || jsonb_build_object('row', i, 'why', 'scores are not numbers');
      continue;
    end;
    if v_home is null or v_away is null or v_home < 0 or v_away < 0 then
      v_skipped := v_skipped || jsonb_build_object('row', i, 'why', 'both scores are needed');
      continue;
    end if;
    if f.status in ('final', 'forfeit', 'bye', 'cancelled') then
      v_skipped := v_skipped || jsonb_build_object('row', i, 'why', 'already ' || f.status);
      continue;
    end if;
    if f.ended_at is not null then
      v_skipped := v_skipped || jsonb_build_object('row', i, 'why', 'ended — use a correction');
      continue;
    end if;
    update public.fixtures
       set home_score = v_home, away_score = v_away, status = 'final', score_disputed = false,
           score_entered_by = auth.uid(), score_entered_at = now(),
           ended_at = now(), ended_by = auth.uid(), updated_at = now()
     where id = f.id;
    update public.match_sheets set status = 'confirmed' where fixture_id = f.id and status = 'disputed';
    perform app_private.log_sheet(p_competition, f.id, null, 'score_bulk', jsonb_build_object('home', v_home, 'away', v_away));
    v_done := v_done + 1;
  end loop;
  return jsonb_build_object('updated', v_done, 'skipped', v_skipped);
end;
$$;

create or replace function public.shift_round(p_competition uuid, p_division text, p_round text, p_days integer)
returns integer language plpgsql security definer set search_path = public as $$
declare
  f public.fixtures;
  n integer := 0;
begin
  if not coalesce(app_private.may_run(p_competition, 'grounds'), false) then
    raise exception 'only the league moves a round' using errcode = '42501';
  end if;
  if p_days is null or p_days = 0 or abs(p_days) > 120 then
    raise exception 'say how many days, up to 120 either way' using errcode = '22023';
  end if;
  for f in
    select * from public.fixtures
     where competition_id = p_competition and division = p_division and round = p_round
       and status in ('scheduled', 'postponed') and starts_at is not null
  loop
    perform app_private.apply_reschedule(f.id, f.starts_at + (p_days || ' days')::interval, null, null);
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function public.abandon_round(p_competition uuid, p_division text, p_round text, p_reason text, p_cancel boolean default false, p_note text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  if not coalesce(app_private.may_run(p_competition, 'grounds'), false) then
    raise exception 'only the league calls a round off' using errcode = '42501';
  end if;
  if p_reason is null or p_reason not in ('wet_weather', 'ground_closed', 'forfeit', 'not_enough_players', 'other') then
    raise exception 'that is not a reason this product knows' using errcode = '22023';
  end if;
  update public.fixtures f
     set status = case when p_cancel then 'cancelled' else 'postponed' end::public.fixture_status,
         cancel_reason = p_reason,
         notes = coalesce(nullif(btrim(coalesce(p_note, '')), ''), f.notes),
         updated_at = now()
   where f.competition_id = p_competition and f.division = p_division and f.round = p_round
     and f.status in ('scheduled', 'in_progress');
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.set_referee_rules(uuid, integer, boolean, text[], integer) from public, anon;
grant execute on function public.set_referee_rules(uuid, integer, boolean, text[], integer) to authenticated;
revoke execute on function public.self_appoint(uuid) from public, anon;
grant execute on function public.self_appoint(uuid) to authenticated;
revoke execute on function public.open_games_for_me() from public, anon;
grant execute on function public.open_games_for_me() to authenticated;
revoke execute on function public.club_allocate_referee(uuid, text, text, text) from public, anon;
grant execute on function public.club_allocate_referee(uuid, text, text, text) to authenticated;
revoke execute on function public.nominate_entry(uuid, text, text) from public, anon;
grant execute on function public.nominate_entry(uuid, text, text) to authenticated;
revoke execute on function public.set_entry_division(uuid, text, text) from public, anon;
grant execute on function public.set_entry_division(uuid, text, text) to authenticated;
revoke execute on function public.lock_entry_squad(uuid, boolean) from public, anon;
grant execute on function public.lock_entry_squad(uuid, boolean) to authenticated;
revoke execute on function public.exempt_player_age(uuid, uuid, boolean) from public, anon;
grant execute on function public.exempt_player_age(uuid, uuid, boolean) to authenticated;
revoke execute on function public.entry_nominations(uuid) from public, anon;
grant execute on function public.entry_nominations(uuid) to authenticated;
revoke execute on function public.my_entries(uuid) from public, anon;
grant execute on function public.my_entries(uuid) to authenticated;
revoke execute on function public.bulk_scores(uuid, jsonb) from public, anon;
grant execute on function public.bulk_scores(uuid, jsonb) to authenticated;
revoke execute on function public.shift_round(uuid, text, text, integer) from public, anon;
grant execute on function public.shift_round(uuid, text, text, integer) to authenticated;
revoke execute on function public.abandon_round(uuid, text, text, text, boolean, text) from public, anon;
grant execute on function public.abandon_round(uuid, text, text, text, boolean, text) to authenticated;
