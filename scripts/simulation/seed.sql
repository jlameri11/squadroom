-- SPL Season 4 — the simulated league (docs/SIMULATION.md; Joey's brief of
-- 9 Nov 2026). LOCAL ONLY: scripts/local-db/sql.mjs -f scripts/simulation/seed.sql
-- into the embedded Postgres, never into squadroom-dev or any Supabase
-- project. Every person, club, venue and team is made up.
--
-- Every id is derived (md5 of a name, as scripts/scale/seed.sql does), so the
-- week-by-week driver (season.mjs) can find anyone again. Structure goes in
-- with triggers ON, so channels, memberships, profiles, the competition's
-- rooms and the fixture mirror come about exactly as they do in the product;
-- only the history (trainings, old chat) goes in with triggers off.
--
-- What is built:
--   "Harbour Football Group" — a league with an owner and six staff holding
--   every league role; "SPL Season 4" with five age groups (U9 MiniRoos,
--   U11, U13, U15, U17) in divisions of up to eight;
--   60 clubs and academies — 20 big (eight teams), 30 small (four), 10
--   academies (two) — each with a president, a secretary, a registrar, a
--   treasurer, a welfare officer, a volunteer coordinator, a coach per team,
--   a team manager per team, coordinators per age group, ~15 players a team,
--   one or two guardians a child, a coach who is also a parent, a parent with
--   children in two clubs, a person in three organisations, teenagers with a
--   login invited and waiting;
--   12 venues of the league's with full, half and quarter pitches and their
--   hours; 150 referees (30 under 18), some with dates they cannot do.

set statement_timeout = 0;
create or replace function pg_temp.sid(t text) returns uuid language sql immutable as $$ select md5(t)::uuid $$;
create or replace function pg_temp.first_name(n bigint) returns text language sql immutable as $$
  select (array['Ava','Noah','Mia','Leo','Zoe','Ethan','Isla','Lucas','Amara','Kai','Chloe','Oscar','Priya','Hugo','Ruby','Arjun','Ella','Jonah','Hana','Mateo','Grace','Felix','Layla','Jasper','Aisha','Henry','Willow','Rafael','Sienna','Tom','Mei','Charlie','Freya','Samir','Ivy','Luca','Nadia','Harvey','Elif','Oliver'])[1 + (n * 7) % 40]
$$;
create or replace function pg_temp.last_name(n bigint) returns text language sql immutable as $$
  select (array['Whitfield','Okoro','Nguyen','Rossi','Sharma','Papadopoulos','Chen','Williams','Kowalski','Haddad','Brown','Tanaka','Singh','Mendes','Fitzgerald','Aboud','Lee','Murphy','Ivanova','Costa','Patel','Dimitriou','Walker','Kaur','Novak','Ahmed','Taylor','Moreau','Jensen','Reyes','Khan','Obi','Hughes','Lindqvist','Carter','Nakamura','Byrne','Santos','Doyle','Mbeki'])[1 + (n * 13) % 40]
$$;
create or replace function pg_temp.club_name(c bigint) returns text language sql immutable as $$
  select (array['Harbourside','Bayview','Rivergum','Ironbark','Saltwater','Kingsford Park','Marrick Heights','Glenhaven','Fernleigh','Seacliff','Wattle Park','Brightwater','Northgate','Oakridge','Pinecrest','Redfern Lakes','Stonebridge','Tallawong','Valley Heights','Westmead Park',
               'Ashcombe','Birchgrove','Coral Bay','Dunmore','Eastlake','Fairlight','Gumtree','Hillcrest','Inverloch','Jacaranda','Kurrajong','Lakeside','Mossvale','Newhaven','Orchard Hills','Parkdale','Quarry Bend','Rosehill','Sandy Point','Thornbury','Underwood','Verona Park','Waverley','Yarraford','Zetland Fields','Arcadia','Bellbird','Cedar Creek','Dawnridge','Elmwood',
               'Foxglove','Greenslopes','Hawkesbury','Illawong','Jindalee','Kingsgrove','Lilyfield','Maroubra','Narrabeen','Oatley'])[c]
    || case when c <= 20 then ' FC' when c <= 50 then (case when c % 2 = 1 then ' United' else ' Rovers' end) else ' Academy' end
$$;
create or replace function pg_temp.club_slug(c bigint) returns text language sql immutable as $$
  select lower(regexp_replace(pg_temp.club_name(c), '[^a-zA-Z0-9]+', '-', 'g'))
$$;
-- Teams a club fields: big clubs eight, small four, academies two.
create temporary table sim_team_plan (club integer, age text, label text, born integer);
insert into sim_team_plan
select c, t.age, t.label, t.born
  from generate_series(1, 60) c
  join lateral (
    values ('U9', 'Red', 2018, 'big,small'), ('U9', 'Blue', 2019, 'big'),
           ('U11', 'Red', 2016, 'big,small,academy'), ('U11', 'Blue', 2017, 'big'),
           ('U13', 'Red', 2014, 'big,small,academy'), ('U13', 'Blue', 2015, 'big'),
           ('U15', 'Red', 2012, 'big,small'),
           ('U17', 'Red', 2010, 'big')
  ) as t(age, label, born, kinds) on position((case when c <= 20 then 'big' when c <= 50 then 'small' else 'academy' end) in t.kinds) > 0;
-- A stable team number: by club, then the plan's order.
create temporary table sim_teams as
  select row_number() over (order by club, age, label) as t, club, age, label, born,
         (case when club <= 20 then 'big' when club <= 50 then 'small' else 'academy' end) as kind
    from sim_team_plan;
create index on sim_teams (club);

-- ------------------------------------------------------------------ people
-- Accounts: the league's owner and six staff; per club, staff 1–6 (the
-- committee), then a coach and a manager per team; parents; referees.
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, phone, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', pg_temp.sid('sim-league-owner'), 'authenticated', 'authenticated', 'owner@harbourfg.sim.test', now(), null,
        '{"full_name": "Dana Harbour", "first_name": "Dana", "last_name": "Harbour"}', '{}', now() - interval '300 days', now());
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, phone, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', pg_temp.sid('sim-league-staff-' || k), 'authenticated', 'authenticated', 'staff' || k || '@harbourfg.sim.test', now(), null,
       jsonb_build_object('full_name', pg_temp.first_name(k) || ' ' || pg_temp.last_name(k + 3), 'first_name', pg_temp.first_name(k), 'last_name', pg_temp.last_name(k + 3)), '{}'::jsonb, now() - interval '280 days', now()
  from generate_series(1, 6) k;

-- Club staff j: 1 president (owner), 2 secretary (admin), 3 registrar (admin),
-- 4 treasurer, 5 welfare officer (admin), 6 volunteer coordinator; then a
-- coach per team (7 … 6+T), then a manager per team.
create temporary table sim_staff as
  select c, j,
         case when j <= 6 then j else null end as committee,
         case when j > 6 and j <= 6 + n then j - 6 else null end as coach_of,      -- the club's k-th team
         case when j > 6 + n then j - 6 - n else null end as manager_of
    from (select club as c, count(*)::integer as n from sim_teams group by club) x
    cross join lateral generate_series(1, 6 + 2 * x.n) j;
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, phone, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', pg_temp.sid('sim-staff-' || c || '-' || j), 'authenticated', 'authenticated',
       'staff' || c || '-' || j || '@' || pg_temp.club_slug(c) || '.sim.test', now(), '+614' || lpad((10000000 + c * 100 + j)::text, 8, '0'),
       jsonb_build_object('full_name', pg_temp.first_name(c * 31 + j) || ' ' || pg_temp.last_name(c * 17 + j), 'first_name', pg_temp.first_name(c * 31 + j), 'last_name', pg_temp.last_name(c * 17 + j)),
       '{}'::jsonb, now() - interval '250 days', now()
  from sim_staff;

-- Parents: a club's players plus a hundred, so a second guardian is always there.
create temporary table sim_parent_count as
  select club as c, count(*)::integer * 15 + 100 as n from sim_teams group by club;
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, phone, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', pg_temp.sid('sim-parent-' || c || '-' || k), 'authenticated', 'authenticated',
       'parent' || c || '-' || k || '@' || pg_temp.club_slug(c) || '.sim.test', now(), '+614' || lpad((20000000 + c * 1000 + k)::text, 8, '0'),
       jsonb_build_object('full_name', pg_temp.first_name(c * 53 + k) || ' ' || pg_temp.last_name(c * 29 + k), 'first_name', pg_temp.first_name(c * 53 + k), 'last_name', pg_temp.last_name(c * 29 + k)),
       '{}'::jsonb, now() - interval '200 days', now()
  from sim_parent_count p cross join lateral generate_series(1, p.n) k;

-- Referees: 150, the last 30 under 18.
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, phone, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', pg_temp.sid('sim-ref-' || r), 'authenticated', 'authenticated', 'ref' || r || '@harbourfg.sim.test', now(), '+614' || lpad((30000000 + r)::text, 8, '0'),
       jsonb_build_object('full_name', pg_temp.first_name(r * 11) || ' ' || pg_temp.last_name(r * 19), 'first_name', pg_temp.first_name(r * 11), 'last_name', pg_temp.last_name(r * 19)),
       '{}'::jsonb, now() - interval '220 days', now()
  from generate_series(1, 150) r;

-- ------------------------------------------------------------ organisations
-- two_step_required off everywhere: the simulation runs its calls straight
-- against the database, where a second step has no screen; the wall itself
-- is proven by its own suites (0231–0232).
insert into public.academies (id, name, slug, type, timezone, created_by, two_step_required)
values (pg_temp.sid('sim-league'), 'Harbour Football Group', 'harbour-football-group', 'league', 'Australia/Sydney', pg_temp.sid('sim-league-owner'), false);
insert into public.academies (id, name, slug, type, timezone, created_by, two_step_required)
select pg_temp.sid('sim-club-' || c), pg_temp.club_name(c), pg_temp.club_slug(c), (case when c > 50 then 'academy' else 'club' end)::public.org_type, 'Australia/Sydney', pg_temp.sid('sim-staff-' || c || '-1'), false
  from generate_series(1, 60) c;

-- The league: owner, six admins, every league role. Staff need a current
-- check first (0120), the league's included.
insert into public.academy_members (academy_id, profile_id, role, status)
values (pg_temp.sid('sim-league'), pg_temp.sid('sim-league-owner'), 'owner', 'active');
insert into public.staff_clearances (academy_id, profile_id, kind, number, outcome, expires_on, verified_by)
select pg_temp.sid('sim-league'), pg_temp.sid('sim-league-staff-' || k), 'wwcc', 'WWC' || lpad(k::text, 7, '0') || 'E', 'cleared', date '2028-12-31', pg_temp.sid('sim-league-owner')
  from generate_series(1, 6) k;
insert into public.academy_members (academy_id, profile_id, role, status)
select pg_temp.sid('sim-league'), pg_temp.sid('sim-league-staff-' || k), 'admin', 'active' from generate_series(1, 6) k;
insert into public.league_roles (academy_id, profile_id, role, granted_by)
select pg_temp.sid('sim-league'), pg_temp.sid('sim-league-staff-' || k),
       (array['competition_manager','referee_coordinator','discipline_officer','ground_manager','competition_manager','referee_coordinator'])[k]::public.league_role,
       pg_temp.sid('sim-league-owner')
  from generate_series(1, 6) k;

-- Clubs: the president owns; everyone staff-like has a current check first
-- (0120), recorded by the president.
insert into public.academy_members (academy_id, profile_id, role, status)
select pg_temp.sid('sim-club-' || c), pg_temp.sid('sim-staff-' || c || '-1'), 'owner', 'active' from generate_series(1, 60) c;
insert into public.staff_clearances (academy_id, profile_id, kind, number, outcome, expires_on, verified_by)
select pg_temp.sid('sim-club-' || c), pg_temp.sid('sim-staff-' || c || '-' || j), 'wwcc',
       'WWC' || lpad((c * 1000 + j)::text, 7, '0') || 'E', 'cleared',
       -- A few checks run out mid-season (the brief's "expired WWCC").
       case when j = 7 and c % 15 = 0 then date '2027-03-20' else date '2028-12-31' end,
       pg_temp.sid('sim-staff-' || c || '-1')
  from sim_staff where j >= 2;
insert into public.academy_members (academy_id, profile_id, role, status)
select pg_temp.sid('sim-club-' || c), pg_temp.sid('sim-staff-' || c || '-' || j),
       (case when j in (2, 3, 5) then 'admin' when coach_of is not null then 'coach' else 'parent' end)::public.academy_role, 'active'
  from sim_staff where j >= 2;
-- The committee's seats (0237): scoped roles, not hats.
insert into public.club_roles (academy_id, profile_id, role, scope_kind, granted_by)
select pg_temp.sid('sim-club-' || c), pg_temp.sid('sim-staff-' || c || '-' || j),
       (array['president','secretary','registrar','treasurer','welfare_officer','volunteer_coordinator'])[j]::public.club_role, 'club', pg_temp.sid('sim-staff-' || c || '-1')
  from sim_staff where committee is not null;
insert into public.safeguarding_officers (academy_id, profile_id, appointed_by)
select pg_temp.sid('sim-club-' || c), pg_temp.sid('sim-staff-' || c || '-5'), pg_temp.sid('sim-staff-' || c || '-1') from generate_series(1, 60) c;
-- Parents: members of their club.
insert into public.academy_members (academy_id, profile_id, role, status)
select pg_temp.sid('sim-club-' || c), pg_temp.sid('sim-parent-' || c || '-' || k), 'parent', 'active'
  from sim_parent_count p cross join lateral generate_series(1, p.n) k;
-- A person in three organisations: club 1's first parent is a parent at
-- clubs 2 and 3 as well (children in two clubs, below).
insert into public.academy_members (academy_id, profile_id, role, status)
values (pg_temp.sid('sim-club-2'), pg_temp.sid('sim-parent-1-1'), 'parent', 'active'),
       (pg_temp.sid('sim-club-3'), pg_temp.sid('sim-parent-1-1'), 'parent', 'active');

-- ------------------------------------------------------------------ squads
insert into public.teams (id, academy_id, name, age_group, season, status, gender)
select pg_temp.sid('sim-team-' || t), pg_temp.sid('sim-club-' || club), age || ' ' || label, age, '2027', 'active',
       (case when t % 5 = 0 then 'girls' when t % 7 = 0 then 'mixed' else 'boys' end)::public.team_gender
  from sim_teams;
-- The coach of the club's k-th team; the manager of it (a scoped role).
insert into public.team_members (academy_id, team_id, profile_id, role)
select pg_temp.sid('sim-club-' || s.c), pg_temp.sid('sim-team-' || tt.t), pg_temp.sid('sim-staff-' || s.c || '-' || s.j), 'coach'
  from sim_staff s
  join (select t, club, row_number() over (partition by club order by t) as k from sim_teams) tt on tt.club = s.c and tt.k = s.coach_of;
insert into public.club_roles (academy_id, profile_id, role, scope_kind, team_id, granted_by)
select pg_temp.sid('sim-club-' || s.c), pg_temp.sid('sim-staff-' || s.c || '-' || s.j), 'team_manager', 'team', pg_temp.sid('sim-team-' || tt.t), pg_temp.sid('sim-staff-' || s.c || '-1')
  from sim_staff s
  join (select t, club, row_number() over (partition by club order by t) as k from sim_teams) tt on tt.club = s.c and tt.k = s.manager_of;
-- A coordinator per age group the club fields: the first coach of that age.
insert into public.club_roles (academy_id, profile_id, role, scope_kind, age_group, granted_by)
select distinct on (x.club, x.age) pg_temp.sid('sim-club-' || x.club), pg_temp.sid('sim-staff-' || x.club || '-' || s.j), 'coordinator', 'age_group', x.age, pg_temp.sid('sim-staff-' || x.club || '-1')
  from (select t, club, age, row_number() over (partition by club order by t) as k from sim_teams) x
  join sim_staff s on s.c = x.club and s.coach_of = x.k
 order by x.club, x.age, x.t;

-- Fifteen players a team, born for their age group; a stable number p.
insert into public.players (id, academy_id, team_id, full_name, dob, gender)
select pg_temp.sid('sim-player-' || t || '-' || i), pg_temp.sid('sim-club-' || club), pg_temp.sid('sim-team-' || t),
       pg_temp.first_name(t * 7 + i * 3) || ' ' || pg_temp.last_name(club * 29 + ((t * 15 + i) % 100) + 1),
       make_date(born, (1 + ((t + i) % 12))::integer, (1 + ((t * i) % 27))::integer),
       (case when t % 5 = 0 then 'female' when t % 7 = 0 then (case when i % 2 = 0 then 'female' else 'male' end) else 'male' end)::public.player_gender
  from sim_teams cross join lateral generate_series(1, 15) i;

-- Guardians: the club's k-th player gets the club's k-th parent, and for two
-- in three the (k + 100)-th as well. Surnames match the first guardian.
with pl as (
  select p.id, p.academy_id, row_number() over (partition by p.academy_id order by p.team_id, p.id) as k
    from public.players p where p.academy_id in (select id from public.academies where slug <> 'harbour-football-group')
), par as (
  select am.profile_id, am.academy_id, row_number() over (partition by am.academy_id order by am.profile_id) as k
    from public.academy_members am
    join auth.users u on u.id = am.profile_id
   where am.role = 'parent' and u.email like 'parent%' and am.academy_id in (select id from public.academies where slug <> 'harbour-football-group')
)
insert into public.player_guardians (academy_id, player_id, profile_id, relationship, is_primary)
select pl.academy_id, pl.id, par.profile_id, case when g = 1 then 'parent' else 'parent' end, g = 1
  from pl
  cross join (values (1), (2)) as gs(g)
  join par on par.academy_id = pl.academy_id and par.k = pl.k + (g - 1) * 100
 where g = 1 or pl.k % 3 <> 0;
-- A coach who is also a parent: each club's first coach is guardian of the
-- club's first player too.
insert into public.player_guardians (academy_id, player_id, profile_id, relationship, is_primary)
select pg_temp.sid('sim-club-' || c), (select id from public.players p where p.academy_id = pg_temp.sid('sim-club-' || c) order by p.team_id, p.id limit 1),
       pg_temp.sid('sim-staff-' || c || '-7'), 'parent', false
  from generate_series(1, 60) c
on conflict do nothing;
-- Children in two clubs: club 1's first parent is also guardian of a child at club 2.
insert into public.player_guardians (academy_id, player_id, profile_id, relationship, is_primary)
select pg_temp.sid('sim-club-2'), (select id from public.players p where p.academy_id = pg_temp.sid('sim-club-2') order by p.team_id desc, p.id limit 1), pg_temp.sid('sim-parent-1-1'), 'parent', false
on conflict do nothing;

-- Teenagers' logins (0215): forty U15/U17 players invited, their email on the row.
insert into public.player_logins (player_id, academy_id, email, invited_by, status)
select p.id, p.academy_id, 'teen-' || substr(p.id::text, 1, 8) || '@sim.test', pg.profile_id, 'invited'
  from public.players p
  join public.teams tm on tm.id = p.team_id
  join public.player_guardians pg on pg.player_id = p.id and pg.is_primary
 where tm.age_group in ('U15', 'U17') and p.academy_id in (select id from public.academies where slug <> 'harbour-football-group')
 order by p.id limit 40;

-- ------------------------------------------------------------------ venues
insert into public.venues (id, academy_id, name, address, lat, lng, amenities)
select pg_temp.sid('sim-venue-' || v), pg_temp.sid('sim-league'),
       (array['Harbour Park','Bayview Reserve','Rivergum Fields','Ironbark Oval','Saltwater Sports Complex','Kingsford Playing Fields','Marrick Common','Glenhaven Reserve','Fernleigh Park','Seacliff Green','Wattle Park Ovals','Brightwater Fields'])[v],
       v || ' Harbour Road, Sim NSW 2000', -33.80 - v * 0.013, 151.10 + v * 0.017,
       jsonb_build_object('parking', 'Street and the car park off Harbour Road', 'toilets', true, 'canteen', v % 2 = 0)
  from generate_series(1, 12) v;
-- Two full pitches a venue; the first cut into quarters, the second into halves.
insert into public.pitches (id, academy_id, venue_id, name, size, sort, x, y, w, h)
select pg_temp.sid('sim-pitch-' || v || '-' || f), pg_temp.sid('sim-league'), pg_temp.sid('sim-venue-' || v), 'Field ' || f, 'full', f, 5 + (f - 1) * 50, 10, 40, 60
  from generate_series(1, 12) v, generate_series(1, 2) f;
insert into public.pitches (id, academy_id, venue_id, parent_id, name, size, sort, x, y, w, h)
select pg_temp.sid('sim-pitch-' || v || '-1-q' || q), pg_temp.sid('sim-league'), pg_temp.sid('sim-venue-' || v), pg_temp.sid('sim-pitch-' || v || '-1'), 'Field 1 Q' || q, 'quarter', 10 + q,
       5 + ((q - 1) % 2) * 20, 10 + ((q - 1) / 2) * 30, 20, 30
  from generate_series(1, 12) v, generate_series(1, 4) q;
insert into public.pitches (id, academy_id, venue_id, parent_id, name, size, sort, x, y, w, h)
select pg_temp.sid('sim-pitch-' || v || '-2-h' || h), pg_temp.sid('sim-league'), pg_temp.sid('sim-venue-' || v), pg_temp.sid('sim-pitch-' || v || '-2'), 'Field 2 H' || h, 'half', 20 + h,
       55, 10 + (h - 1) * 30, 40, 30
  from generate_series(1, 12) v, generate_series(1, 2) h;
-- Hours (L-29): weekends 8–6, weekday evenings for training.
insert into public.pitch_availability (academy_id, pitch_id, weekday, opens, closes)
select p.academy_id, p.id, d, case when d in (0, 6) then time '08:00' else time '16:00' end, case when d = 0 then time '17:00' when d = 6 then time '18:00' else time '21:00' end
  from public.pitches p cross join generate_series(0, 6) d
 where p.academy_id = pg_temp.sid('sim-league');
-- The league's rule of thumb for pitch sizes by age.
insert into public.pitch_size_rules (academy_id, age_group, size)
values (pg_temp.sid('sim-league'), 'U9', 'quarter'), (pg_temp.sid('sim-league'), 'U11', 'half'), (pg_temp.sid('sim-league'), 'U13', 'half'),
       (pg_temp.sid('sim-league'), 'U15', 'full'), (pg_temp.sid('sim-league'), 'U17', 'full');

-- ---------------------------------------------------------------- referees
insert into public.referees (id, academy_id, profile_id, full_name, phone, grade, status, claimed_at, created_by, under_18)
select pg_temp.sid('sim-referee-' || r), pg_temp.sid('sim-league'), pg_temp.sid('sim-ref-' || r),
       pg_temp.first_name(r * 11) || ' ' || pg_temp.last_name(r * 19), '+614' || lpad((30000000 + r)::text, 8, '0'),
       (array['A','B','C'])[1 + r % 3], 'active', now() - interval '100 days', pg_temp.sid('sim-league-staff-2'), r > 120
  from generate_series(1, 150) r;
-- Twenty cannot do the second Saturday of the season.
insert into public.referee_blockouts (referee_id, academy_id, starts_at, ends_at, reason)
select pg_temp.sid('sim-referee-' || r), pg_temp.sid('sim-league'), timestamptz '2027-02-13 00:00+11', timestamptz '2027-02-13 23:59+11', 'Away that weekend'
  from generate_series(1, 20) r;

-- --------------------------------------------------------------- the league
insert into public.competitions (id, organiser_id, name, type, season, status, starts_on, ends_on, created_by, mode, visibility, public_slug, published_at, entries_open)
values (pg_temp.sid('sim-comp'), pg_temp.sid('sim-league'), 'SPL Season 4', 'season', '2027', 'active', date '2027-02-06', date '2027-06-05',
        pg_temp.sid('sim-league-owner'), 'managed', 'participants', 'spl-season-4', now(), false);
insert into public.competition_discipline_rules (competition_id, yellows_per_suspension, games_per_yellow_suspension, games_per_red, blue_cards, blue_minutes)
values (pg_temp.sid('sim-comp'), 3, 1, 2, true, 10);
insert into public.competition_referee_fees (competition_id, role, fee_cents)
values (pg_temp.sid('sim-comp'), 'referee', 4000), (pg_temp.sid('sim-comp'), 'assistant', 2500);
insert into public.competition_clubs (competition_id, academy_id, status, joined_at)
select pg_temp.sid('sim-comp'), pg_temp.sid('sim-club-' || c), 'active', now() - interval '40 days' from generate_series(1, 60) c;

-- Divisions of up to eight, balanced, per age group: "U11 Division 3".
create temporary table sim_divisions as
  select t, age, club, label,
         age || ' Division ' || (1 + (row_number() over (partition by age order by t) - 1) % ceil(count(*) over (partition by age) / 8.0)::integer) as division
    from sim_teams;
insert into public.competition_divisions (competition_id, division, age_group, scores_public, ladder_enabled, match_length_mins, pitch_size, sheet_lock_mins, finals_min_games, rank, squad_size_min)
select pg_temp.sid('sim-comp'), d.division, d.age,
       d.age <> 'U9', d.age <> 'U9',
       (case d.age when 'U9' then 40 when 'U11' then 50 when 'U13' then 60 when 'U15' then 70 else 80 end),
       (case d.age when 'U9' then 'quarter' when 'U11' then 'half' when 'U13' then 'half' else 'full' end),
       30, 5, row_number() over (order by app_private.age_number(d.age), (regexp_match(d.division, '(\d+)$'))[1]::integer),
       (case d.age when 'U9' then 4 when 'U11' then 7 else 9 end)
  from (select distinct division, age from sim_divisions) d;
-- Rules a few divisions play under (L-27 bands, the borrowing cap, playing up).
update public.competition_divisions set born_after = date '2014-01-01', born_before = date '2015-12-31'
 where competition_id = pg_temp.sid('sim-comp') and division = 'U13 Division 1';
update public.competition_divisions set borrow_cap = 2
 where competition_id = pg_temp.sid('sim-comp') and division = 'U15 Division 1';
update public.competition_divisions set allow_playing_up = false
 where competition_id = pg_temp.sid('sim-comp') and division = 'U17 Division 1';
-- Entry fees per age group, so each entry owes one the moment it exists (the trigger).
insert into public.competition_fees (competition_id, division, fee_cents, instructions)
select pg_temp.sid('sim-comp'), d.division, (case d.age when 'U9' then 45000 when 'U11' then 55000 when 'U13' then 65000 when 'U15' then 75000 else 85000 end),
       'Harbour Football Group · BSB 000-000 · Acc 12345678 · reference the team'
  from (select distinct division, age from sim_divisions) d;
insert into public.competition_entries (id, competition_id, academy_id, team_id, display_name, division, nominated_at)
select pg_temp.sid('sim-entry-' || d.t), pg_temp.sid('sim-comp'), pg_temp.sid('sim-club-' || d.club), pg_temp.sid('sim-team-' || d.t),
       pg_temp.club_name(d.club) || ' ' || d.age || ' ' || d.label, d.division, now() - interval '30 days'
  from sim_divisions d;

-- ------------------------------------------------------------- the history
set session_replication_role = replica;
-- Every account's email is on record and confirmed (the email gate would otherwise sit above every screen).
insert into public.account_emails (profile_id, email, verified_at)
select u.id, u.email, now() - interval '100 days' from auth.users u where u.email is not null
on conflict do nothing;
-- Everyone set a password when they signed up (the password gate would otherwise sit above every screen).
update public.user_settings set password_set_at = now() - interval '100 days' where password_set_at is null;
-- Everyone has the app on one phone (the drain sends to a subscription).
insert into public.push_subscriptions (profile_id, platform, endpoint, p256dh, auth, device_label)
select p.id, 'web', 'https://push.sim.test/' || p.id, 'sim', 'sim', 'Phone'
  from public.profiles p;
-- A few families keep quiet hours (9pm–7am) and a few take a digest.
update public.user_settings us set quiet_hours_enabled = true, quiet_hours_start = time '21:00', quiet_hours_end = time '07:00'
 where us.profile_id in (select pg_temp.sid('sim-parent-' || c || '-' || k) from generate_series(1, 60) c, generate_series(1, 3) k);
update public.user_settings us set digest_minutes = 60
 where us.profile_id in (select pg_temp.sid('sim-parent-' || c || '-' || k) from generate_series(1, 60) c, generate_series(4, 6) k);
-- Training twice a week for every squad, Tuesdays and Thursdays at 5:30,
-- from the week before round 1 to the week after the grand final.
insert into public.events (academy_id, team_id, type, title, starts_at, ends_at, venue, created_by)
select tm.academy_id, tm.id, 'training', 'Training',
       (d::timestamp + time '17:30') at time zone 'Australia/Sydney',
       (d::timestamp + time '18:45') at time zone 'Australia/Sydney',
       'Home ground', null
  from public.teams tm
  cross join generate_series(date '2027-02-02', date '2027-06-10', interval '1 day') d
 where tm.season = '2027' and extract(dow from d) in (2, 4)
   and tm.academy_id in (select id from public.academies where slug <> 'harbour-football-group');
-- A hundred lines of history in every squad chat, from its own members in turn.
create temporary table sim_chan_people as
  select cm.channel_id, cm.academy_id, cm.profile_id,
         row_number() over (partition by cm.channel_id order by cm.profile_id) as k,
         count(*) over (partition by cm.channel_id) as n
    from public.channel_members cm
    join public.channels c on c.id = cm.channel_id
   where c.type = 'team' and c.academy_id in (select id from public.academies where slug <> 'harbour-football-group');
create index on sim_chan_people (channel_id, k);
insert into public.messages (academy_id, channel_id, sender_id, body, status, created_at)
select cp.academy_id, cp.channel_id, cp.profile_id,
       (array['Training is on — bring a drink bottle.','Who can do oranges on Saturday?','Great effort today, everyone.','Reminder: shin pads every session.','Carpool from the north side?','Photos from the game are in the album.','Kick-off is 9am, there by 8:15 please.','Can someone bring the first-aid kit?'])[1 + (s % 8)],
       'published', now() - ((100 - s) * interval '1 day')
  from (select distinct channel_id, academy_id, max(n) as n from sim_chan_people group by channel_id, academy_id) ch
  cross join lateral generate_series(1, 100) s
  join sim_chan_people cp on cp.channel_id = ch.channel_id and cp.k = 1 + (abs(hashtext(ch.channel_id::text || s)) % ch.n);
-- Everyone has opened their chats at some point in the last two days.
update public.channel_members cm
   set last_read_at = now() - ((abs(hashtext(cm.id::text)) % 2880) * interval '1 minute');
set session_replication_role = origin;

select 'league' as what, count(*) from public.academies where type = 'league' and slug = 'harbour-football-group'
union all select 'clubs', count(*) from public.academies where slug <> 'harbour-football-group'
union all select 'people', count(*) from public.profiles
union all select 'teams', count(*) from public.teams where season = '2027'
union all select 'players', count(*) from public.players
union all select 'guardian links', count(*) from public.player_guardians
union all select 'divisions', count(*) from public.competition_divisions where competition_id = pg_temp.sid('sim-comp')
union all select 'entries', count(*) from public.competition_entries where competition_id = pg_temp.sid('sim-comp')
union all select 'entry fees owed', count(*) from public.entry_fees where competition_id = pg_temp.sid('sim-comp')
union all select 'venues / pitches', (select count(*) from public.venues) * 1000 + (select count(*) from public.pitches)
union all select 'referees', count(*) from public.referees
union all select 'channels', count(*) from public.channels
union all select 'messages', count(*) from public.messages;
