-- 0249: trials, grading, and "Publish teams".
--
-- Big Club Mode item 7 (Joey, 9 Nov 2026): "Trial sessions per age group;
-- coaches rate players privately (1–5 + note); coordinator allocates to
-- teams on a phone-friendly screen (and a laptop table). 'Publish teams' →
-- each family gets ONE message: team, coach, manager, training slot and
-- ground. Team chats update automatically."
--
-- Reuse first. A trial is a program of kind 'trial' (0083) with its
-- registrations; its sessions are an event series (0090) that now carries
-- the program; a child's squad is players.team_id, and the 0098 trigger
-- moves the family into the team chat the moment it changes. New here: the
-- ratings (the club's coaches' own, never a family's), the coordinator's
-- PENCILLED placements (a draft nobody outside the club can read, so a
-- half-made allocation is not a surprise in a family's app), and the
-- publish that applies the pencil, posts a welcome in each squad's chat and
-- tells every family once — the Season screen's moves and rollover too,
-- which used to tell nobody their team.

-- ---------------------------------------------------------------------------
-- 1. A new kind of notification.
-- ---------------------------------------------------------------------------
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
    'helper_reminder', 'helper_changed', 'report_filed', 'team_published']));
end $$;

-- ---------------------------------------------------------------------------
-- 2. Trial sessions belong to the trial.
-- ---------------------------------------------------------------------------
alter table public.events
  add column if not exists program_id uuid references public.programs(id) on delete set null;
alter table public.event_series
  add column if not exists program_id uuid references public.programs(id) on delete set null;
create index if not exists events_program_idx on public.events (program_id) where program_id is not null;

create or replace function public.create_trial_sessions(
  p_program uuid, p_days smallint[], p_time time, p_from date, p_until date,
  p_venue text default null, p_duration integer default 60
)
returns jsonb
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_p      public.programs;
  v_res    jsonb;
  v_series uuid;
begin
  select * into v_p from public.programs where id = p_program;
  if v_p.id is null then
    raise exception 'no such program' using errcode = '42501';
  end if;
  if v_p.kind <> 'trial' then
    raise exception 'sessions like these are for a trial' using errcode = '22023';
  end if;
  if not coalesce(app_private.is_academy_coach(v_p.academy_id), false) then
    raise exception 'only a coach can set trial sessions' using errcode = '42501';
  end if;
  -- The series does the work and its own checks. Club-wide (no team), so
  -- every family can see when the trial is; titled after the trial.
  v_res := public.create_event_series(v_p.academy_id, v_p.name || ' — trial', p_days, p_time, p_from, p_until,
                                      null, 'training', coalesce(p_duration, 60), null, p_venue);
  v_series := (v_res->>'series_id')::uuid;
  update public.event_series set program_id = p_program where id = v_series;
  update public.events set program_id = p_program where series_id = v_series;
  return v_res || jsonb_build_object('program_id', p_program);
end;
$fn$;
revoke execute on function public.create_trial_sessions(uuid, smallint[], time, date, date, text, integer) from public, anon;
grant execute on function public.create_trial_sessions(uuid, smallint[], time, date, date, text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Ratings: a coach's 1–5 and a note, per trial, per player. The club's
--    coaches read them together; a family never does.
-- ---------------------------------------------------------------------------
create table if not exists public.trial_ratings (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  program_id  uuid not null,
  player_id   uuid not null,
  coach_id    uuid not null references public.profiles(id) on delete cascade,
  rating      smallint not null check (rating between 1 and 5),
  note        text check (note is null or length(note) <= 500),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint trial_ratings_once unique (program_id, player_id, coach_id),
  constraint trial_ratings_program_fkey foreign key (program_id, academy_id)
    references public.programs (id, academy_id) on delete cascade,
  constraint trial_ratings_player_fkey foreign key (player_id, academy_id)
    references public.players (id, academy_id) on delete cascade
);
alter table public.trial_ratings enable row level security;

-- Who grades: the club's coaches and staff, and whoever runs its teams
-- (President, Secretary, a coordinator). Not a family, not a Treasurer.
create or replace function app_private.may_grade(p_academy uuid)
returns boolean
language sql stable security definer set search_path = public as $fn$
  select coalesce(app_private.is_academy_coach(p_academy), false)
      or coalesce(app_private.may_run_club(p_academy, 'teams'), false);
$fn$;

drop policy if exists trial_ratings_select on public.trial_ratings;
create policy trial_ratings_select on public.trial_ratings
  for select to authenticated
  using ((select app_private.is_academy_coach(academy_id)) or (select app_private.may_run_club(academy_id, 'teams')));
-- Written through rate_trial_player only.

create or replace function public.rate_trial_player(p_program uuid, p_player uuid, p_rating integer, p_note text default null)
returns uuid
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_p  public.programs;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select * into v_p from public.programs where id = p_program;
  if v_p.id is null or v_p.kind <> 'trial' then
    raise exception 'ratings are for a trial' using errcode = '22023';
  end if;
  if not app_private.may_grade(v_p.academy_id) then
    raise exception 'only the club''s coaches rate a trial' using errcode = '42501';
  end if;
  if not exists (select 1 from public.program_registrations r
                  where r.program_id = p_program and r.player_id = p_player and r.status in ('pending', 'approved', 'waitlisted')) then
    raise exception 'that player is not in this trial' using errcode = '22023';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'a rating is 1 to 5' using errcode = '22023';
  end if;
  insert into public.trial_ratings (academy_id, program_id, player_id, coach_id, rating, note)
  values (v_p.academy_id, p_program, p_player, auth.uid(), p_rating, nullif(btrim(coalesce(p_note, '')), ''))
  on conflict (program_id, player_id, coach_id) do update
    set rating = excluded.rating, note = excluded.note, updated_at = now()
  returning id into v_id;
  return v_id;
end;
$fn$;
revoke execute on function public.rate_trial_player(uuid, uuid, integer, text) from public, anon;
grant execute on function public.rate_trial_player(uuid, uuid, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The pencil: where the coordinator means to put each player. A draft,
--    readable by the club's coaches and staff only, until it is published.
-- ---------------------------------------------------------------------------
create table if not exists public.trial_placements (
  id           uuid primary key default gen_random_uuid(),
  academy_id   uuid not null references public.academies(id) on delete cascade,
  program_id   uuid not null,
  player_id    uuid not null,
  team_id      uuid,
  decided_by   uuid references public.profiles(id) on delete set null,
  decided_at   timestamptz not null default now(),
  published_at timestamptz,
  constraint trial_placements_once unique (program_id, player_id),
  constraint trial_placements_program_fkey foreign key (program_id, academy_id)
    references public.programs (id, academy_id) on delete cascade,
  constraint trial_placements_player_fkey foreign key (player_id, academy_id)
    references public.players (id, academy_id) on delete cascade,
  constraint trial_placements_team_fkey foreign key (team_id, academy_id)
    references public.teams (id, academy_id) on delete cascade
);
alter table public.trial_placements enable row level security;
drop policy if exists trial_placements_select on public.trial_placements;
create policy trial_placements_select on public.trial_placements
  for select to authenticated
  using ((select app_private.is_academy_coach(academy_id)) or (select app_private.may_run_club(academy_id, 'teams')));

create or replace function public.place_trial_player(p_program uuid, p_player uuid, p_team uuid)
returns void
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_p public.programs;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select * into v_p from public.programs where id = p_program;
  if v_p.id is null or v_p.kind <> 'trial' then
    raise exception 'placements are for a trial' using errcode = '22023';
  end if;
  -- Placing is the coordinator's and the staff's; a coach rates.
  if not (coalesce(app_private.is_academy_staff(v_p.academy_id), false) or coalesce(app_private.may_run_club(v_p.academy_id, 'teams'), false)) then
    raise exception 'only the club''s staff or a coordinator places players' using errcode = '42501';
  end if;
  if not exists (select 1 from public.program_registrations r
                  where r.program_id = p_program and r.player_id = p_player and r.status in ('pending', 'approved', 'waitlisted')) then
    raise exception 'that player is not in this trial' using errcode = '22023';
  end if;
  if p_team is not null and not exists (select 1 from public.teams t where t.id = p_team and t.academy_id = v_p.academy_id and t.status = 'active') then
    raise exception 'that squad is not in this club' using errcode = '22023';
  end if;
  if exists (select 1 from public.trial_placements pl where pl.program_id = p_program and pl.player_id = p_player and pl.published_at is not null) then
    raise exception 'already published — move them between squads on the Season screen' using errcode = '22023';
  end if;
  insert into public.trial_placements (academy_id, program_id, player_id, team_id, decided_by)
  values (v_p.academy_id, p_program, p_player, p_team, auth.uid())
  on conflict (program_id, player_id) do update
    set team_id = excluded.team_id, decided_by = excluded.decided_by, decided_at = now();
end;
$fn$;
revoke execute on function public.place_trial_player(uuid, uuid, uuid) from public, anon;
grant execute on function public.place_trial_player(uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Who has been told their squad. team_since moves with team_id (a
--    trigger); team_told_at is set by a publish. Everyone already on a
--    squad has been living with it, so they count as told.
-- ---------------------------------------------------------------------------
alter table public.players
  add column if not exists team_since   timestamptz,
  add column if not exists team_told_at timestamptz;

create or replace function public.players_team_since()
returns trigger
language plpgsql set search_path = public as $fn$
begin
  if tg_op = 'INSERT' then
    if new.team_id is not null then
      new.team_since := coalesce(new.team_since, now());
    end if;
  elsif new.team_id is distinct from old.team_id then
    new.team_since := case when new.team_id is null then null else now() end;
  end if;
  return new;
end;
$fn$;
drop trigger if exists players_team_since on public.players;
create trigger players_team_since
  before insert or update of team_id on public.players
  for each row execute function public.players_team_since();

update public.players
   set team_since   = coalesce(team_since, updated_at, created_at),
       team_told_at = coalesce(team_told_at, updated_at, created_at)
 where team_id is not null;

-- ---------------------------------------------------------------------------
-- 6. What a family is told about a squad: coach, manager, training, ground.
-- ---------------------------------------------------------------------------
create or replace function app_private.team_brief(p_team uuid)
returns jsonb
language sql stable security definer set search_path = public as $fn$
  select jsonb_build_object(
    'team', t.name,
    'season', t.season,
    'age_group', t.age_group,
    'coaches', (select string_agg(p.full_name, ', ' order by p.full_name)
                  from public.team_members tm join public.profiles p on p.id = tm.profile_id
                 where tm.team_id = t.id and tm.role = 'coach'),
    'manager', (select string_agg(p.full_name, ', ' order by p.full_name)
                  from public.club_roles r join public.profiles p on p.id = r.profile_id
                 where r.team_id = t.id and r.role = 'team_manager'),
    'training', (select string_agg(
                   array_to_string(array(select (array['Sun','Mon','Tue','Wed','Thu','Fri','Sat'])[d + 1]
                                           from unnest(s.days) as d order by d), '/')
                   || ' ' || to_char(s.at_time, 'FMHH12:MI am') || coalesce(' at ' || s.venue, ''),
                   '; ' order by s.at_time)
                   from public.event_series s
                  where s.team_id = t.id and s.type = 'training' and s.ends_on >= current_date),
    'ground', (select v.name from public.venues v where v.id = t.home_venue_id),
    'channel', (select c.id from public.channels c
                 where c.team_id = t.id and c.type = 'team' and c.status = 'active' limit 1))
    from public.teams t where t.id = p_team;
$fn$;

-- ---------------------------------------------------------------------------
-- 7. Publish: the pencil becomes the squads, each squad's chat gets a
--    welcome, each family one message. Also the Season screen's moves and
--    rollover: anyone on a squad since they were last told.
-- ---------------------------------------------------------------------------
create or replace function public.publish_teams(p_academy uuid, p_program uuid default null, p_teams uuid[] default null)
returns jsonb
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_pl       record;
  v_team     record;
  v_fam      record;
  v_brief    jsonb;
  v_ids      uuid[];
  v_players  integer := 0;
  v_families integer := 0;
  v_teams    integer := 0;
  v_url      text;
  v_now      timestamptz := clock_timestamp();
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if not (coalesce(app_private.is_academy_staff(p_academy), false) or coalesce(app_private.may_run_club(p_academy, 'teams'), false)) then
    raise exception 'only the club''s staff or a coordinator publishes teams' using errcode = '42501';
  end if;

  -- A trial's pencilled placements become real squads first. The 0098
  -- trigger moves each family into the squad's chat as team_id changes.
  if p_program is not null then
    if not exists (select 1 from public.programs pr where pr.id = p_program and pr.academy_id = p_academy and pr.kind = 'trial') then
      raise exception 'that trial is not this club''s' using errcode = '42501';
    end if;
    for v_pl in select pl.id, pl.player_id, pl.team_id
                  from public.trial_placements pl
                 where pl.program_id = p_program and pl.published_at is null and pl.team_id is not null loop
      update public.players
         set team_id = v_pl.team_id, team_told_at = null, updated_at = now()
       where id = v_pl.player_id and academy_id = p_academy;
      update public.trial_placements set published_at = v_now where id = v_pl.id;
    end loop;
  end if;

  -- Who is told: on a squad, and not told since they were put there.
  select coalesce(array_agg(p.id), '{}'::uuid[]) into v_ids
    from public.players p
   where p.academy_id = p_academy and p.team_id is not null
     and (p.team_told_at is null or p.team_told_at < p.team_since)
     and (p_teams is null or p.team_id = any (p_teams))
     and (p_program is null or exists (select 1 from public.trial_placements pl where pl.program_id = p_program and pl.player_id = p.id));
  v_players := coalesce(array_length(v_ids, 1), 0);
  if v_players = 0 then
    return jsonb_build_object('players', 0, 'families', 0, 'teams', 0);
  end if;

  -- One welcome in each squad's chat, from whoever published.
  for v_team in select distinct p.team_id from public.players p where p.id = any (v_ids) loop
    v_brief := app_private.team_brief(v_team.team_id);
    v_teams := v_teams + 1;
    if (v_brief->>'channel') is not null then
      insert into public.messages (academy_id, channel_id, sender_id, body)
      values (p_academy, (v_brief->>'channel')::uuid, auth.uid(),
              'Welcome to ' || (v_brief->>'team') || coalesce(' for ' || (v_brief->>'season'), '') || '.'
              || E'\nCoach: '    || coalesce(v_brief->>'coaches',  'to be confirmed')
              || E'\nManager: '  || coalesce(v_brief->>'manager',  'to be confirmed')
              || E'\nTraining: ' || coalesce(v_brief->>'training', 'to be confirmed')
              || E'\nGround: '   || coalesce(v_brief->>'ground',   'to be confirmed'));
    end if;
  end loop;

  -- One message per family, every child of theirs in it. An adult player is
  -- their own family.
  for v_fam in
    select g.profile_id,
           string_agg(coalesce(p.preferred_name, split_part(p.full_name, ' ', 1)) || ' is in ' || (b.brief->>'team')
                      || ' · coach ' || coalesce(b.brief->>'coaches', 'to be confirmed')
                      || coalesce(' · manager ' || (b.brief->>'manager'), '')
                      || ' · training ' || coalesce(b.brief->>'training', 'to be confirmed')
                      || ' · ground ' || coalesce(b.brief->>'ground', 'to be confirmed'),
                      E'\n' order by p.full_name) as body,
           count(distinct p.team_id) as n_teams,
           min(b.brief->>'channel') as channel
      from public.players p
      cross join lateral (select app_private.team_brief(p.team_id) as brief) b
      join lateral (
        select pg.profile_id
          from public.player_guardians pg
          join public.academy_members am on am.profile_id = pg.profile_id and am.academy_id = p.academy_id and am.status = 'active'
         where pg.player_id = p.id
        union
        select p.profile_id where p.profile_id is not null
      ) g on true
     where p.id = any (v_ids)
     group by g.profile_id
  loop
    v_families := v_families + 1;
    v_url := case when v_fam.n_teams = 1 and v_fam.channel is not null then '/chat/' || v_fam.channel else '/' end;
    insert into public.notification_queue (academy_id, profile_id, kind, title, body, url, payload, dedupe_key)
    values (p_academy, v_fam.profile_id, 'team_published', 'Teams are out', v_fam.body, v_url,
            jsonb_build_object('program_id', p_program),
            'team_published:' || v_fam.profile_id || ':' || extract(epoch from v_now)::bigint)
    on conflict (dedupe_key) do nothing;
  end loop;

  update public.players set team_told_at = v_now where id = any (v_ids);

  perform app_private.log_activity(p_academy, 'teams_published',
                                   case when p_program is null then 'academy' else 'program' end,
                                   coalesce(p_program, p_academy),
                                   coalesce((select pr.name from public.programs pr where pr.id = p_program), 'the squads'),
                                   jsonb_build_object('players', v_players, 'families', v_families, 'teams', v_teams));
  return jsonb_build_object('players', v_players, 'families', v_families, 'teams', v_teams);
end;
$fn$;
revoke execute on function public.publish_teams(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.publish_teams(uuid, uuid, uuid[]) to authenticated;

-- What a publish would do, for the button. For a trial: its unpublished
-- pencil; otherwise everyone on a squad since they were last told.
create or replace function public.publish_teams_preview(p_academy uuid, p_program uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_ids uuid[];
begin
  if not (coalesce(app_private.is_academy_staff(p_academy), false) or coalesce(app_private.may_run_club(p_academy, 'teams'), false)) then
    return null;
  end if;
  if p_program is not null then
    select coalesce(array_agg(pl.player_id), '{}'::uuid[]) into v_ids
      from public.trial_placements pl
     where pl.program_id = p_program and pl.academy_id = p_academy and pl.published_at is null and pl.team_id is not null;
  else
    select coalesce(array_agg(p.id), '{}'::uuid[]) into v_ids
      from public.players p
     where p.academy_id = p_academy and p.team_id is not null
       and (p.team_told_at is null or p.team_told_at < p.team_since);
  end if;
  return jsonb_build_object(
    'players', coalesce(array_length(v_ids, 1), 0),
    'families', (select count(distinct g.profile_id)
                   from public.players p
                   join lateral (
                     select pg.profile_id from public.player_guardians pg
                       join public.academy_members am on am.profile_id = pg.profile_id and am.academy_id = p.academy_id and am.status = 'active'
                      where pg.player_id = p.id
                     union select p.profile_id where p.profile_id is not null
                   ) g on true
                  where p.id = any (v_ids)),
    'teams', (select count(distinct coalesce(pl.team_id, p.team_id))
                from public.players p
                left join public.trial_placements pl on pl.player_id = p.id and pl.program_id = p_program
               where p.id = any (v_ids)));
end;
$fn$;
revoke execute on function public.publish_teams_preview(uuid, uuid) from public, anon;
grant execute on function public.publish_teams_preview(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. The board: everyone trialling, the ratings so far, the pencil, the
--    squads to pencil into, the sessions. Coaches and the people who run
--    the club's teams; null for anyone else.
-- ---------------------------------------------------------------------------
create or replace function public.trial_board(p_program uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_p public.programs;
  v_can_place boolean;
begin
  if auth.uid() is null then
    return null;
  end if;
  select * into v_p from public.programs where id = p_program;
  if v_p.id is null or v_p.kind <> 'trial' or not app_private.may_grade(v_p.academy_id) then
    return null;
  end if;
  v_can_place := coalesce(app_private.is_academy_staff(v_p.academy_id), false) or coalesce(app_private.may_run_club(v_p.academy_id, 'teams'), false);

  return jsonb_build_object(
    'program', jsonb_build_object('id', v_p.id, 'name', v_p.name, 'season', v_p.season, 'status', v_p.status,
                                  'born_from_year', v_p.born_from_year, 'born_to_year', v_p.born_to_year),
    'can_place', v_can_place,
    'sessions', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'starts_at', e.starts_at, 'venue', e.venue,
                                                               'cancelled', e.cancelled_at is not null) order by e.starts_at)
                            from public.events e
                           where e.program_id = p_program and e.starts_at >= now() - interval '1 day'), '[]'::jsonb),
    'to_publish', (select count(*) from public.trial_placements pl
                    where pl.program_id = p_program and pl.published_at is null and pl.team_id is not null),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
               'player_id', p.id, 'registration_id', r.id, 'name', p.full_name, 'dob', p.dob, 'status', r.status,
               'team_id', p.team_id,
               'team', (select t.name from public.teams t where t.id = p.team_id),
               'avg', (select round(avg(tr.rating)::numeric, 1) from public.trial_ratings tr where tr.program_id = p_program and tr.player_id = p.id),
               'count', (select count(*) from public.trial_ratings tr where tr.program_id = p_program and tr.player_id = p.id),
               'mine', (select jsonb_build_object('rating', tr.rating, 'note', tr.note)
                          from public.trial_ratings tr where tr.program_id = p_program and tr.player_id = p.id and tr.coach_id = auth.uid()),
               'ratings', (select coalesce(jsonb_agg(jsonb_build_object('coach', pr.full_name, 'rating', tr.rating, 'note', tr.note) order by pr.full_name), '[]'::jsonb)
                             from public.trial_ratings tr join public.profiles pr on pr.id = tr.coach_id
                            where tr.program_id = p_program and tr.player_id = p.id),
               'placement', (select jsonb_build_object('team_id', pl.team_id,
                                                       'team', (select t.name from public.teams t where t.id = pl.team_id),
                                                       'published_at', pl.published_at)
                               from public.trial_placements pl where pl.program_id = p_program and pl.player_id = p.id))
             order by p.full_name)
        from public.program_registrations r
        join public.players p on p.id = r.player_id
       where r.program_id = p_program and r.status in ('pending', 'approved', 'waitlisted')), '[]'::jsonb),
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'age_group', t.age_group, 'label', t.label,
                                          'players', (select count(*) from public.players x where x.team_id = t.id),
                                          'capacity', t.capacity)
                       order by t.age_group, t.name)
        from public.teams t where t.academy_id = v_p.academy_id and t.status = 'active'), '[]'::jsonb));
end;
$fn$;
revoke execute on function public.trial_board(uuid) from public, anon;
grant execute on function public.trial_board(uuid) to authenticated;
