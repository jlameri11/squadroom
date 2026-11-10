-- 0247: getting live — a roster import in batches with undo and a squad per
-- row, the setup steps the brief names, and the club's health in one answer.
--
-- Big Club Mode item 5 (Joey, 9 Nov 2026): "Getting live: setup steps
-- (streams & age groups, teams/coaches/managers, committee roles, grounds &
-- slots, invite families); the roster importer takes a team column, 1,500+
-- rows in batches, with undo; guardians stay out of bulk import; Club
-- health." The audit (docs/BIG_CLUB_MODE.md §B): the importer took 500 rows
-- into ONE squad with no undo; setup_progress had six steps; health existed
-- in pieces (the clearance board, per-squad counts) with no card.
--
-- Guardians stay out of the import, as before: "contacts are picked, never
-- synced" — a family joins with the team's code and is approved.

-- ---------------------------------------------------------------------------
-- 1. A batch: one import, however many calls it took, undoable as a whole.
-- ---------------------------------------------------------------------------
create table if not exists public.import_batches (
  id               uuid primary key default gen_random_uuid(),
  academy_id       uuid not null references public.academies(id) on delete cascade,
  kind             text not null default 'players' check (kind in ('players')),
  file_name        text,
  created_by       uuid not null references public.profiles(id) on delete cascade,
  created_at       timestamptz not null default now(),
  rows_sent        integer not null default 0,
  created_players  integer not null default 0,
  matched_players  integer not null default 0,
  removed_players  integer,
  undone_at        timestamptz,
  undone_by        uuid references public.profiles(id) on delete set null,
  constraint import_batches_id_academy_key unique (id, academy_id)
);
alter table public.import_batches enable row level security;

-- Read by the people who may import (the coaches and staff, as
-- import_players). Written only through the functions below.
drop policy if exists import_batches_select on public.import_batches;
create policy import_batches_select on public.import_batches
  for select to authenticated
  using ((select app_private.is_academy_coach(academy_id)));

-- Which import made a player. Set on the players an import CREATED, never
-- on the ones it matched: undo removes what the import added and nothing
-- the club already had.
alter table public.players
  add column if not exists import_batch_id uuid references public.import_batches(id) on delete set null;
create index if not exists players_import_batch_idx on public.players (import_batch_id) where import_batch_id is not null;

create or replace function public.start_import_batch(p_academy uuid, p_kind text default 'players', p_file text default null)
returns uuid
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_id uuid;
begin
  if not coalesce(app_private.is_academy_coach(p_academy), false) then
    raise exception 'only a coach can import a roster' using errcode = '42501';
  end if;
  insert into public.import_batches (academy_id, kind, file_name, created_by)
  values (p_academy, coalesce(p_kind, 'players'), nullif(btrim(coalesce(p_file, '')), ''), auth.uid())
  returning id into v_id;
  perform app_private.log_activity(p_academy, 'import_started', 'import_batch', v_id,
                                   coalesce(nullif(btrim(coalesce(p_file, '')), ''), 'a spreadsheet'),
                                   jsonb_build_object('kind', coalesce(p_kind, 'players')));
  return v_id;
end;
$fn$;
revoke execute on function public.start_import_batch(uuid, text, text) from public, anon;
grant execute on function public.start_import_batch(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The importer: a squad per row, and the batch it belongs to.
-- ---------------------------------------------------------------------------
-- A fifth parameter with a default would leave the four-parameter function
-- beside it and make every call ambiguous, so the old one goes first.
drop function if exists public.import_players(uuid, uuid, jsonb, text);

create or replace function public.import_players(
  p_academy uuid,
  p_team    uuid,
  p_rows    jsonb,
  p_season  text default null,
  p_batch   uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_row       jsonb;
  v_name      text;
  v_dob       date;
  v_gender    public.player_gender;
  v_team      uuid;
  v_existing  uuid;
  v_player    uuid;
  v_number    integer;
  v_created   integer := 0;
  v_matched   integer := 0;
  v_numbered  integer := 0;
  v_problems  jsonb := '[]'::jsonb;
  v_index     integer := 0;
begin
  if not app_private.is_academy_coach(p_academy) then
    raise exception 'only a coach can import a roster' using errcode = '42501';
  end if;
  if p_team is not null and not exists (
    select 1 from public.teams where id = p_team and academy_id = p_academy
  ) then
    raise exception 'that team is not in this academy' using errcode = '42501';
  end if;
  if p_batch is not null and not exists (
    select 1 from public.import_batches b where b.id = p_batch and b.academy_id = p_academy and b.undone_at is null
  ) then
    raise exception 'that import is not this club''s, or was undone' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be an array' using errcode = '22023';
  end if;
  -- Per call. A bigger file arrives as several calls on one batch.
  if jsonb_array_length(p_rows) > 500 then
    raise exception 'that is % rows — send them 500 at a time', jsonb_array_length(p_rows)
      using errcode = '22023';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_index := v_index + 1;
    v_name := btrim(coalesce(v_row->>'full_name', ''));
    v_gender := nullif(btrim(coalesce(v_row->>'gender', '')), '')::public.player_gender;

    -- A row with no name is a blank line at the bottom of a spreadsheet, which
    -- every spreadsheet has. Skipped quietly rather than failing the import.
    if v_name = '' then
      continue;
    end if;

    begin
      v_dob := (v_row->>'dob')::date;
    exception when others then
      v_problems := v_problems || jsonb_build_object(
        'row', v_index, 'name', v_name,
        'problem', 'could not read the date of birth: ' || coalesce(v_row->>'dob', '(blank)')
      );
      continue;
    end;

    if v_dob is null then
      v_problems := v_problems || jsonb_build_object(
        'row', v_index, 'name', v_name, 'problem', 'no date of birth'
      );
      continue;
    end if;

    -- A child born in the future, or a hundred years ago, is a date read the
    -- wrong way round. Worth stopping on rather than importing.
    if v_dob > current_date or v_dob < current_date - interval '100 years' then
      v_problems := v_problems || jsonb_build_object(
        'row', v_index, 'name', v_name,
        'problem', 'date of birth reads as ' || v_dob::text || ' — check day/month order'
      );
      continue;
    end if;

    -- The squad: the row's own, else the one picked for the whole file. The
    -- screen resolves a "Squad" column to ids by name; the row's id is
    -- checked here all the same, because a client is a claim.
    v_team := p_team;
    if nullif(btrim(coalesce(v_row->>'team_id', '')), '') is not null then
      begin
        v_team := (v_row->>'team_id')::uuid;
      exception when others then
        v_problems := v_problems || jsonb_build_object('row', v_index, 'name', v_name, 'problem', 'the squad could not be read');
        continue;
      end;
      if not exists (select 1 from public.teams t where t.id = v_team and t.academy_id = p_academy) then
        v_problems := v_problems || jsonb_build_object('row', v_index, 'name', v_name, 'problem', 'that squad is not in this club');
        continue;
      end if;
    end if;

    v_existing := app_private.find_existing_player(p_academy, v_name, v_dob, v_gender);

    if v_existing is not null then
      v_player := v_existing;
      v_matched := v_matched + 1;
      -- Fill the blanks only. A coach has edited this row since the export,
      -- and the spreadsheet is not more authoritative than they are.
      update public.players pl
         set gender         = coalesce(pl.gender, v_gender),
             shirt_size     = coalesce(pl.shirt_size,  app_private.as_kit_size(v_row->>'shirt_size')),
             shorts_size    = coalesce(pl.shorts_size, app_private.as_kit_size(v_row->>'shorts_size')),
             socks_size     = coalesce(pl.socks_size,  app_private.as_sock_size(v_row->>'socks_size')),
             preferred_name = coalesce(pl.preferred_name, nullif(btrim(coalesce(v_row->>'preferred_name', '')), '')),
             ff_number      = coalesce(pl.ff_number, nullif(btrim(coalesce(v_row->>'ff_number', '')), '')),
             school         = coalesce(pl.school, nullif(btrim(coalesce(v_row->>'school', '')), '')),
             team_id        = coalesce(pl.team_id, v_team),
             updated_at     = now()
       where pl.id = v_existing;
    else
      insert into public.players (
        academy_id, team_id, full_name, dob, gender, preferred_name, ff_number, school,
        shirt_size, shorts_size, socks_size, import_batch_id
      ) values (
        p_academy, v_team, v_name, v_dob, v_gender,
        nullif(btrim(coalesce(v_row->>'preferred_name', '')), ''),
        nullif(btrim(coalesce(v_row->>'ff_number', '')), ''),
        nullif(btrim(coalesce(v_row->>'school', '')), ''),
        -- Guarded casts: 'MED'::kit_size raises 22P02 and would take the
        -- whole import down over a field nobody needs.
        app_private.as_kit_size(v_row->>'shirt_size'),
        app_private.as_kit_size(v_row->>'shorts_size'),
        app_private.as_sock_size(v_row->>'socks_size'),
        p_batch
      )
      returning id into v_player;
      v_created := v_created + 1;
    end if;

    -- Shirt numbers, if the file has them and a season was named. A clash is
    -- reported rather than thrown: one duplicated number must not cost the
    -- club its whole import.
    v_number := nullif(btrim(coalesce(v_row->>'squad_number', '')), '')::integer;
    if v_number is not null and p_season is not null then
      begin
        insert into public.squad_numbers (academy_id, player_id, season, number, assigned_by)
        values (p_academy, v_player, p_season, v_number, auth.uid())
        on conflict (academy_id, season, player_id) do update set number = excluded.number;
        v_numbered := v_numbered + 1;
      exception when unique_violation then
        v_problems := v_problems || jsonb_build_object(
          'row', v_index, 'name', v_name,
          'problem', 'shirt number ' || v_number || ' is already taken this season'
        );
      end;
    end if;
  end loop;

  if p_batch is not null then
    update public.import_batches
       set rows_sent = rows_sent + v_index,
           created_players = created_players + v_created,
           matched_players = matched_players + v_matched
     where id = p_batch;
  end if;

  return jsonb_build_object(
    'created', v_created,
    'matched', v_matched,
    'numbered', v_numbered,
    'problems', v_problems
  );
end;
$fn$;
revoke execute on function public.import_players(uuid, uuid, jsonb, text, uuid) from public, anon;
grant execute on function public.import_players(uuid, uuid, jsonb, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Undo: the players an import created, unless the club has since built
--    on one — a family claimed them, a registration, a payment.
-- ---------------------------------------------------------------------------
create or replace function public.undo_import_batch(p_batch uuid)
returns jsonb
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_b         public.import_batches;
  v_p         record;
  v_removed   integer := 0;
  v_kept      integer := 0;
  v_kept_list jsonb := '[]'::jsonb;
begin
  select * into v_b from public.import_batches where id = p_batch;
  if v_b.id is null then
    raise exception 'no such import' using errcode = '42501';
  end if;
  if not coalesce(app_private.is_academy_coach(v_b.academy_id), false) then
    raise exception 'only a coach can undo an import' using errcode = '42501';
  end if;
  if v_b.undone_at is not null then
    raise exception 'that import was already undone' using errcode = '22023';
  end if;

  for v_p in select pl.id, pl.full_name from public.players pl where pl.import_batch_id = p_batch loop
    -- Built on since: kept, and named, so the coach can decide by hand.
    if exists (select 1 from public.player_guardians g where g.player_id = v_p.id)
       or exists (select 1 from public.players x where x.id = v_p.id and x.profile_id is not null)
       or exists (select 1 from public.program_registrations r where r.player_id = v_p.id)
       or exists (select 1 from public.payments q where q.player_id = v_p.id) then
      v_kept := v_kept + 1;
      v_kept_list := v_kept_list || to_jsonb(v_p.full_name);
      continue;
    end if;
    begin
      delete from public.squad_numbers where player_id = v_p.id;
      delete from public.players where id = v_p.id;
      v_removed := v_removed + 1;
    exception when foreign_key_violation then
      -- Something else refers to them (a team sheet, an attendance mark):
      -- the club has used the record, so it stays.
      v_kept := v_kept + 1;
      v_kept_list := v_kept_list || to_jsonb(v_p.full_name);
    end;
  end loop;

  update public.import_batches
     set undone_at = now(), undone_by = auth.uid(), removed_players = v_removed
   where id = p_batch;
  perform app_private.log_activity(v_b.academy_id, 'import_undone', 'import_batch', p_batch,
                                   coalesce(v_b.file_name, 'a spreadsheet'),
                                   jsonb_build_object('removed', v_removed, 'kept', v_kept));
  return jsonb_build_object('removed', v_removed, 'kept', v_kept, 'kept_names', v_kept_list);
end;
$fn$;
revoke execute on function public.undo_import_batch(uuid) from public, anon;
grant execute on function public.undo_import_batch(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The setup steps the brief names. The five that mark setup complete are
--    unchanged (brand, squads, roster, programs, coaches); the new ones are
--    there to be done, and club mode adds its own two.
-- ---------------------------------------------------------------------------
create or replace function public.setup_progress(p_academy uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_academy   uuid;
  a           public.academies;
  v_brand     boolean;
  v_squads    boolean;
  v_roster    boolean;
  v_programs  boolean;
  v_coaches   boolean;
  v_session   boolean;
  v_streams   boolean;
  v_committee boolean;
  v_grounds   boolean;
  v_teams     integer;
  v_covered   integer;
  v_players   integer;
  v_joined    integer;
  v_core_done boolean;
  v_steps     jsonb;
  v_done      integer;
begin
  v_academy := app_private.my_academy(p_academy);
  if v_academy is null or not coalesce(app_private.is_academy_staff(v_academy), false) then
    return null;
  end if;
  select * into a from public.academies where id = v_academy;

  v_brand    := a.logo_url is not null or lower(coalesce(a.primary_colour, '')) <> '#202842';
  v_squads   := exists (select 1 from public.teams t where t.academy_id = v_academy and t.status = 'active');
  v_roster   := exists (select 1 from public.players p where p.academy_id = v_academy);
  v_programs := exists (select 1 from public.programs p where p.academy_id = v_academy);
  v_coaches  := exists (select 1 from public.academy_members m where m.academy_id = v_academy and m.role in ('coach', 'admin') and m.status = 'active')
             or exists (select 1 from public.invites i where i.academy_id = v_academy and i.role in ('coach', 'admin'))
             or exists (select 1 from public.join_links j where j.academy_id = v_academy and j.role in ('coach', 'admin'));
  v_session  := exists (select 1 from public.events e where e.academy_id = v_academy);
  v_streams  := exists (select 1 from public.streams s where s.academy_id = v_academy);
  v_committee := exists (select 1 from public.club_roles r where r.academy_id = v_academy and r.role in ('president', 'secretary'));
  v_grounds  := exists (select 1 from public.venues v where v.academy_id = v_academy);

  -- Every squad with someone in front of it: a coach on the team, or a
  -- team manager over it.
  select count(*),
         count(*) filter (where exists (select 1 from public.team_members tm where tm.team_id = t.id and tm.role = 'coach')
                             or exists (select 1 from public.club_roles r where r.team_id = t.id and r.role = 'team_manager'))
    into v_teams, v_covered
    from public.teams t where t.academy_id = v_academy and t.status = 'active';

  -- Families in the app: players with a guardian who is an active member,
  -- or an adult who is their own.
  select count(*),
         count(*) filter (where p.profile_id is not null
                             or exists (select 1 from public.player_guardians g
                                          join public.academy_members am on am.profile_id = g.profile_id and am.academy_id = p.academy_id and am.status = 'active'
                                         where g.player_id = p.id))
    into v_players, v_joined
    from public.players p where p.academy_id = v_academy;

  v_core_done := v_brand and v_squads and v_roster and v_programs and v_coaches;
  if v_core_done and a.setup_completed_at is null then
    update public.academies set setup_completed_at = now() where id = v_academy;
    a.setup_completed_at := now();
  end if;

  v_steps := jsonb_build_array(
    jsonb_build_object('id', 'brand', 'label', 'Crest and colours', 'done', v_brand, 'href', '/start/setup#brand',
      'detail', case when v_brand then coalesce(nullif(a.primary_colour, ''), '') || case when a.logo_url is not null then ' · crest' else ' · no crest yet' end else 'Pick your colour; add the crest' end),
    jsonb_build_object('id', 'squads', 'label', 'Squads', 'done', v_squads, 'href', '/admin/teams',
      'detail', v_teams || ' active'));
  if coalesce(a.club_mode, false) then
    v_steps := v_steps || jsonb_build_object('id', 'streams', 'label', 'Streams and age groups', 'done', v_streams, 'href', '/admin/teams',
      'detail', case when v_streams then (select count(*) from public.streams s where s.academy_id = v_academy) || ' streams' else 'Juniors, Seniors, Women, Over-35s — the parts of the club, each with its age groups' end);
  end if;
  v_steps := v_steps
    || jsonb_build_object('id', 'coaches', 'label', 'Coaches', 'done', v_coaches, 'href', '/admin/invites',
      'detail', case when v_coaches then 'Invited' else 'A link or a code for each coach; they need a WWCC on file to be given a squad' end)
    || jsonb_build_object('id', 'managers', 'label', 'Someone in front of every squad', 'done', v_teams > 0 and v_covered = v_teams, 'href', '/admin/teams',
      'detail', case when v_teams = 0 then 'A coach or a team manager per squad'
                     when v_covered = v_teams then 'Every squad has a coach or a manager'
                     else (v_teams - v_covered) || ' of ' || v_teams || ' squads with nobody yet' end)
    || jsonb_build_object('id', 'roster', 'label', 'Roster', 'done', v_roster, 'href', '/admin/import/players',
      'detail', v_players || ' players — import a spreadsheet, or add them by hand')
    || jsonb_build_object('id', 'programs', 'label', 'Programs', 'done', v_programs, 'href', '/admin/programs',
      'detail', case when v_programs then (select count(*) from public.programs p where p.academy_id = v_academy) || ' set up' else 'The squad season, a camp, trials — what families register for' end);
  if coalesce(a.club_mode, false) then
    v_steps := v_steps || jsonb_build_object('id', 'committee', 'label', 'Committee roles', 'done', v_committee, 'href', '/admin/roles',
      'detail', case when v_committee then 'President or Secretary named' else 'President, Secretary, Registrar, Treasurer, Welfare officer' end);
  end if;
  v_steps := v_steps
    || jsonb_build_object('id', 'grounds', 'label', 'Grounds', 'done', v_grounds, 'href', '/admin/venues',
      'detail', case when v_grounds then (select count(*) from public.venues v where v.academy_id = v_academy) || ' grounds' else 'Where you play and train, and the pitches on each' end)
    || jsonb_build_object('id', 'families', 'label', 'Invite families', 'done', v_joined > 0, 'href', '/admin/teams',
      'detail', case when v_players = 0 then 'Each squad has a code and a QR for its families'
                     else v_joined || ' of ' || v_players || ' players have a family in the app' end)
    || jsonb_build_object('id', 'session', 'label', 'First training', 'done', v_session, 'href', '/calendar',
      'detail', case when v_session then 'In the calendar' else 'Weekly training, set once' end);
  select count(*) into v_done from jsonb_array_elements(v_steps) s where (s->>'done')::boolean;

  return jsonb_build_object(
    'academy_id', v_academy,
    'name', a.name,
    'slug', a.slug,
    'primary_colour', a.primary_colour,
    'logo_url', a.logo_url,
    'started_at', a.setup_started_at,
    'completed_at', a.setup_completed_at,
    'minutes', round(extract(epoch from (coalesce(a.setup_completed_at, now()) - a.setup_started_at)) / 60),
    'grandfathered', a.setup_completed_at is not null and a.setup_completed_at <= a.setup_started_at + interval '1 minute',
    'steps', v_steps,
    'done', v_done,
    'total', jsonb_array_length(v_steps),
    'complete', v_core_done);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Club health: one answer for the card. Owners, admins, and the people
--    who run the club (President, Secretary — may_run_club 'club').
-- ---------------------------------------------------------------------------
create or replace function public.club_health(p_academy uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_academy  uuid;
  v_today    date := (current_date at time zone 'utc')::date;
  v_players  integer;
  v_joined   integer;
  v_teams    jsonb;
  v_nobody   jsonb;
  v_checks   jsonb;
  v_pf       integer;
  v_setup    jsonb;
begin
  v_academy := app_private.my_academy(p_academy);
  if v_academy is null then
    return null;
  end if;
  if not (coalesce(app_private.is_academy_staff(v_academy), false)
          or coalesce(app_private.may_run_club(v_academy, 'club'), false)) then
    return null;
  end if;

  -- Families joined, per squad (worst first) and overall.
  select count(*),
         count(*) filter (where p.profile_id is not null
                             or exists (select 1 from public.player_guardians g
                                          join public.academy_members am on am.profile_id = g.profile_id and am.academy_id = p.academy_id and am.status = 'active'
                                         where g.player_id = p.id))
    into v_players, v_joined
    from public.players p where p.academy_id = v_academy;

  select coalesce(jsonb_agg(row order by row->>'pct', row->>'name'), '[]'::jsonb) into v_teams
    from (
      select jsonb_build_object(
               'id', t.id, 'name', t.name, 'players', count(p.id),
               'with_family', count(p.id) filter (where p.profile_id is not null
                                                     or exists (select 1 from public.player_guardians g
                                                                  join public.academy_members am on am.profile_id = g.profile_id and am.academy_id = p.academy_id and am.status = 'active'
                                                                 where g.player_id = p.id)),
               'pct', case when count(p.id) = 0 then 100
                           else round(100.0 * count(p.id) filter (where p.profile_id is not null
                                                     or exists (select 1 from public.player_guardians g
                                                                  join public.academy_members am on am.profile_id = g.profile_id and am.academy_id = p.academy_id and am.status = 'active'
                                                                 where g.player_id = p.id)) / count(p.id)) end) as row
        from public.teams t
        left join public.players p on p.team_id = t.id and p.academy_id = t.academy_id
       where t.academy_id = v_academy and t.status = 'active'
       group by t.id, t.name
    ) x;

  -- Squads with nobody in front of them: no coach on the team, no manager over it.
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name), '[]'::jsonb) into v_nobody
    from public.teams t
   where t.academy_id = v_academy and t.status = 'active'
     and not exists (select 1 from public.team_members tm where tm.team_id = t.id and tm.role = 'coach')
     and not exists (select 1 from public.club_roles r where r.team_id = t.id and r.role = 'team_manager');

  -- Working With Children Checks of the staff and coaches, by state — the
  -- clearance board's words (0120), counted.
  select jsonb_build_object(
           'missing',  count(*) filter (where c.id is null),
           'barred',   count(*) filter (where c.outcome = 'barred'),
           'expired',  count(*) filter (where c.id is not null and c.outcome <> 'barred' and c.expires_on < v_today),
           'expiring', count(*) filter (where c.id is not null and c.outcome <> 'barred' and c.expires_on >= v_today and c.expires_on < v_today + 60),
           'people',   count(*))
    into v_checks
    from public.academy_members am
    left join public.staff_clearances c on c.academy_id = am.academy_id and c.profile_id = am.profile_id
   where am.academy_id = v_academy and am.status = 'active' and am.role in ('owner', 'admin', 'coach');

  select count(*) into v_pf from public.players p where p.academy_id = v_academy and p.official_status = 'pending';

  -- The setup steps, for the staff (setup_progress is theirs; a President
  -- who is not staff gets the rest without it).
  v_setup := public.setup_progress(v_academy);

  return jsonb_build_object(
    'academy_id', v_academy,
    'families', jsonb_build_object('players', v_players, 'with_family', v_joined,
                                   'pct', case when coalesce(v_players, 0) = 0 then 100 else round(100.0 * v_joined / v_players) end,
                                   'teams', v_teams),
    'teams_without_manager', v_nobody,
    'checks', v_checks,
    'playfootball_not_done', v_pf,
    'setup', case when v_setup is null then null else jsonb_build_object('done', v_setup->'done', 'total', v_setup->'total', 'complete', v_setup->'complete') end);
end;
$fn$;
revoke execute on function public.club_health(uuid) from public, anon;
grant execute on function public.club_health(uuid) to authenticated;
