-- 0287 — league setup in thirty minutes (Joey, 16 Nov 2026). Dribl needs
-- twenty help articles and staff onboarding; ours is self-serve.
--
-- A league (or an organiser group — the same thing here, 0246) gets its own
-- setup checklist on Home and on /start/setup: Crest & colours → Venues &
-- pitches → Create the competition → Divisions & rules → Invite clubs /
-- open entries → Entry fees → Referees → Build & check the draw → Publish,
-- every tick read from the data, each step one tap away, the same
-- thirty-minute clock as a club's. Inside a competition the same steps are
-- the Setup tab until it is published (competition_setup). Three gaps are
-- filled so every step has something to tick: a division can be named
-- before any club enters it (add_division), "no entry fee" is a decision
-- (fees_decided_at), and a checked draw is recorded (draw_checked_at).

alter table public.competitions add column if not exists fees_decided_at timestamptz;
alter table public.competitions add column if not exists draw_checked_at timestamptz;

-- A division named up front, before any entry, with its age group and pitch size.
create or replace function public.add_division(p_competition uuid, p_division text, p_age_group text default null, p_pitch_size text default null)
returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  v_name text := btrim(coalesce(p_division, ''));
  v_size text := nullif(btrim(coalesce(p_pitch_size, '')), '');
  v_id   uuid;
  v_rank integer;
begin
  if not coalesce(app_private.may_run(p_competition, 'competition'), false) then
    raise exception 'only the organiser names divisions' using errcode = '42501';
  end if;
  if length(v_name) < 2 then
    raise exception 'give the division a name' using errcode = '22023';
  end if;
  if v_size is not null and v_size not in ('full', 'half', 'third', 'quarter') then
    raise exception 'a pitch size is full, half, third or quarter' using errcode = '22023';
  end if;
  select coalesce(max(d.rank), 0) + 1 into v_rank from public.competition_divisions d where d.competition_id = p_competition;
  insert into public.competition_divisions (competition_id, division, age_group, pitch_size, rank)
  values (p_competition, v_name, nullif(btrim(coalesce(p_age_group, '')), ''), v_size, v_rank)
  on conflict (competition_id, division) do update
    set age_group = coalesce(excluded.age_group, public.competition_divisions.age_group),
        pitch_size = coalesce(excluded.pitch_size, public.competition_divisions.pitch_size)
  returning id into v_id;
  return v_id;
end;
$fn$;
revoke execute on function public.add_division(uuid, text, text, text) from public, anon;
grant execute on function public.add_division(uuid, text, text, text) to authenticated;

-- The fee is decided when one is set, or when the league says there is none.
create or replace function public.competition_fees_decided()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  update public.competitions set fees_decided_at = coalesce(fees_decided_at, now()) where id = new.competition_id;
  return new;
end;
$fn$;
revoke execute on function public.competition_fees_decided() from public, anon, authenticated;
drop trigger if exists competition_fees_decided on public.competition_fees;
create trigger competition_fees_decided after insert or update on public.competition_fees for each row execute function public.competition_fees_decided();

create or replace function public.mark_entry_fees_free(p_competition uuid)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if not coalesce(app_private.may_run(p_competition, 'competition'), false) then
    raise exception 'only the organiser decides the fees' using errcode = '42501';
  end if;
  update public.competitions set fees_decided_at = now() where id = p_competition;
end;
$fn$;
revoke execute on function public.mark_entry_fees_free(uuid) from public, anon;
grant execute on function public.mark_entry_fees_free(uuid) to authenticated;

-- A draw that has been checked (draw_quality is read-only; the screen notes it here).
create or replace function public.note_draw_checked(p_competition uuid)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if not coalesce(app_private.may_run(p_competition, 'competition'), false) then
    raise exception 'only the organiser checks the draw' using errcode = '42501';
  end if;
  update public.competitions set draw_checked_at = now() where id = p_competition;
end;
$fn$;
revoke execute on function public.note_draw_checked(uuid) from public, anon;
grant execute on function public.note_draw_checked(uuid) to authenticated;

create or replace function app_private.setup_step(p_id text, p_label text, p_done boolean, p_href text, p_detail text)
returns jsonb language sql immutable as $$
  select jsonb_build_object('id', p_id, 'label', p_label, 'done', coalesce(p_done, false), 'href', p_href, 'detail', p_detail);
$$;

-- The competition's own setup: the steps in order, each with what is missing.
create or replace function public.competition_setup(p_competition uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  c         public.competitions;
  v_pitched integer;
  v_divs    integer;
  v_entries integer;
  v_drawn   integer;
  v_refs    integer;
  v_fees    integer;
  v_steps   jsonb;
  v_done    integer;
  v_base    text;
begin
  select * into c from public.competitions where id = p_competition;
  if c.id is null or not coalesce(app_private.may_run(p_competition, 'competition'), false) then
    return null;
  end if;
  v_base := '/competitions/' || c.id;
  select count(*) filter (where exists (select 1 from public.pitches p where p.venue_id = v.id)) into v_pitched
    from public.venues v where v.academy_id = c.organiser_id;
  select count(*) into v_divs from (
    select d.division from public.competition_divisions d where d.competition_id = p_competition
    union
    select e.division from public.competition_entries e where e.competition_id = p_competition) x;
  select count(*) into v_entries from public.competition_entries e where e.competition_id = p_competition and e.withdrawn_at is null;
  select count(distinct f.division) into v_drawn from public.fixtures f where f.competition_id = p_competition;
  select count(*) into v_refs from public.referees r where r.academy_id = c.organiser_id and r.status = 'active';
  select count(*) into v_fees from public.competition_fees f where f.competition_id = p_competition;
  v_steps := jsonb_build_array(
    app_private.setup_step('grounds', 'Venues & pitches', v_pitched > 0, '/admin/venues?back=' || v_base || '%3Ftab%3Dsetup',
      case when v_pitched > 0 then v_pitched || case when v_pitched = 1 then ' ground' else ' grounds' end || ' with pitches' else 'Each ground and its pitches — the draw is laid onto them' end),
    app_private.setup_step('competition', 'Create the competition', true, v_base || '?tab=setup', c.name || coalesce(' · ' || c.season, '')),
    app_private.setup_step('divisions', 'Divisions & rules', v_divs > 0, v_base || '?tab=setup#divisions',
      case when v_divs > 0 then v_divs || case when v_divs = 1 then ' division' else ' divisions' end else 'Name the divisions; points, game length and squad sizes per division' end),
    app_private.setup_step('entries', 'Invite clubs / open entries', v_entries > 0 or coalesce(c.entries_open, false), v_base || '/invite',
      v_entries || case when v_entries = 1 then ' team entered' else ' teams entered' end || ' · entries ' || case when coalesce(c.entries_open, false) then 'open' else 'closed' end),
    app_private.setup_step('fees', 'Entry fees', c.fees_decided_at is not null or v_fees > 0, v_base || '?tab=setup#fees',
      case when v_fees > 0 then v_fees || case when v_fees = 1 then ' fee set' else ' fees set' end when c.fees_decided_at is not null then 'No entry fee' else 'A fee per division, or none — say which' end),
    app_private.setup_step('referees', 'Referees', v_refs > 0, v_base || '?tab=referees',
      case when v_refs > 0 then v_refs || ' in the pool' else 'Add the referees you appoint from' end),
    app_private.setup_step('draw', 'Build & check the draw', v_divs > 0 and v_drawn >= v_divs and c.draw_checked_at is not null, v_base || '?tab=run',
      v_drawn || ' of ' || v_divs || ' divisions drawn' || case when c.draw_checked_at is not null then ' · checked' else ' · not checked yet' end),
    app_private.setup_step('publish', 'Publish', c.published_at is not null, v_base || '?tab=setup#publish',
      case when c.published_at is not null then 'Live at /c/' || coalesce(c.public_slug, '') else 'The public page every family sees; entries can open once it is live' end));
  select count(*) into v_done from jsonb_array_elements(v_steps) s where (s->>'done')::boolean;
  return jsonb_build_object('competition_id', c.id, 'name', c.name, 'published', c.published_at is not null,
                            'steps', v_steps, 'done', v_done, 'total', jsonb_array_length(v_steps), 'complete', v_done = jsonb_array_length(v_steps));
end;
$fn$;
revoke execute on function public.competition_setup(uuid) from public, anon;
grant execute on function public.competition_setup(uuid) to authenticated;

-- A league's checklist: the crest, then its newest competition's steps.
create or replace function app_private.league_setup_progress(p_academy uuid)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  a        public.academies;
  c        public.competitions;
  v_brand  boolean;
  v_steps  jsonb;
  v_comp   jsonb;
  v_done   integer;
  v_all    boolean;
begin
  select * into a from public.academies where id = p_academy;
  v_brand := a.logo_url is not null or lower(coalesce(a.primary_colour, '')) <> '#202842';
  select * into c from public.competitions x where x.organiser_id = p_academy order by x.created_at desc limit 1;
  v_steps := jsonb_build_array(
    app_private.setup_step('brand', 'Crest & colours', v_brand, '/start/setup#brand',
      case when v_brand then coalesce(nullif(a.primary_colour, ''), '') || case when a.logo_url is not null then ' · crest' else ' · no crest yet' end else 'Your colour and crest, on every page the clubs see' end));
  if c.id is null then
    v_steps := v_steps
      || app_private.setup_step('grounds', 'Venues & pitches', exists (select 1 from public.venues v join public.pitches p on p.venue_id = v.id where v.academy_id = p_academy), '/admin/venues', 'Each ground and its pitches — the draw is laid onto them')
      || app_private.setup_step('competition', 'Create the competition', false, '/competitions/new', 'A season, a tournament or a gala day')
      || app_private.setup_step('divisions', 'Divisions & rules', false, '/competitions/new', 'After the competition')
      || app_private.setup_step('entries', 'Invite clubs / open entries', false, '/competitions/new', 'After the competition')
      || app_private.setup_step('fees', 'Entry fees', false, '/competitions/new', 'After the competition')
      || app_private.setup_step('referees', 'Referees', exists (select 1 from public.referees r where r.academy_id = p_academy and r.status = 'active'), '/competitions/new', 'After the competition')
      || app_private.setup_step('draw', 'Build & check the draw', false, '/competitions/new', 'After the competition')
      || app_private.setup_step('publish', 'Publish', false, '/competitions/new', 'After the competition');
  else
    v_comp := public.competition_setup(c.id);
    v_steps := v_steps || coalesce(v_comp->'steps', '[]'::jsonb);
  end if;
  select count(*) into v_done from jsonb_array_elements(v_steps) s where (s->>'done')::boolean;
  v_all := v_done = jsonb_array_length(v_steps);
  if v_all and a.setup_completed_at is null then
    update public.academies set setup_completed_at = now() where id = p_academy;
    a.setup_completed_at := now();
  end if;
  return jsonb_build_object(
    'academy_id', a.id, 'name', a.name, 'slug', a.slug, 'primary_colour', a.primary_colour, 'logo_url', a.logo_url,
    'started_at', a.setup_started_at, 'completed_at', a.setup_completed_at,
    'minutes', round(extract(epoch from (coalesce(a.setup_completed_at, now()) - a.setup_started_at)) / 60),
    'grandfathered', a.setup_completed_at is not null and a.setup_completed_at <= a.setup_started_at + interval '1 minute',
    'competition_id', c.id, 'type', 'league',
    'steps', v_steps, 'done', v_done, 'total', jsonb_array_length(v_steps), 'complete', v_all);
end;
$fn$;
revoke execute on function app_private.league_setup_progress(uuid) from public, anon, authenticated;

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
  -- The owners and admins, and the committee that runs the club (0236:
  -- President, Secretary) — Home shows the checklist to a President's hat,
  -- and a null here read as "signed out" to the screen hook (16 Nov 2026).
  if v_academy is null or not (coalesce(app_private.is_academy_staff(v_academy), false) or coalesce(app_private.may_run_club(v_academy, 'club'), false)) then
    return null;
  end if;
  select * into a from public.academies where id = v_academy;
  -- 0287: a league has its own list — the competition, not squads and rosters.
  if a.type = 'league' then
    return app_private.league_setup_progress(v_academy);
  end if;

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
    'type', a.type::text,
    'complete', v_core_done);
end;
$$;
