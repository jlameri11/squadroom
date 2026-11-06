-- The scale test's dataset (Joey, 5 Nov 2026): 60 clubs, 400 squads, 6,000
-- players, 10,000 parents, 500,000 messages, a full league season.
--
-- LOCAL ONLY: scripts/scale/run.mjs loads it into the embedded Postgres that
-- scripts/local-db/ builds. Never into squadroom-dev or any Supabase
-- project. Every id is derived (md5 of a name) so a person, a squad or a
-- channel can be found again by the script that measures.
--
-- Structure goes in with triggers ON, so channels, memberships and settings
-- come about exactly as they do in the product. The bulk — training
-- sessions, answers, half a million messages — goes in with triggers OFF
-- (replica): otherwise every message would queue a push for every member.

set statement_timeout = 0;

create or replace function pg_temp.sid(t text) returns uuid language sql immutable as $$ select md5(t)::uuid $$;

-- ------------------------------------------------------------------ people
-- 60 clubs × 10 staff (owner, admin, eight coaches), a league owner, and
-- 10,000 parents.
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, phone, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', pg_temp.sid('scale-staff-' || c || '-' || j), 'authenticated', 'authenticated',
       'staff' || c || '-' || j || '@scale.test', now(), null,
       jsonb_build_object('full_name', 'Staff ' || c || '-' || j), '{}'::jsonb, now() - interval '200 days', now()
  from generate_series(1, 60) c, generate_series(1, 10) j;

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, phone, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', pg_temp.sid('scale-league-owner'), 'authenticated', 'authenticated',
        'league@scale.test', now(), null, '{"full_name": "League Owner"}', '{}', now() - interval '200 days', now());

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, phone, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', pg_temp.sid('scale-parent-' || n), 'authenticated', 'authenticated',
       'parent' || n || '@scale.test', now(), null,
       jsonb_build_object('full_name', 'Parent ' || n), '{}'::jsonb, now() - interval '150 days', now()
  from generate_series(1, 10000) n;

-- ------------------------------------------------------------ organisations
insert into public.academies (id, name, slug, type, timezone, created_by)
values (pg_temp.sid('scale-league'), 'Scale Premier League', 'scale-premier-league', 'league', 'Australia/Sydney', pg_temp.sid('scale-league-owner'));

insert into public.academies (id, name, slug, type, timezone, created_by)
select pg_temp.sid('scale-club-' || c), 'Scale Club ' || c, 'scale-club-' || c, 'club', 'Australia/Sydney', pg_temp.sid('scale-staff-' || c || '-1')
  from generate_series(1, 60) c;

insert into public.academy_members (academy_id, profile_id, role, status)
values (pg_temp.sid('scale-league'), pg_temp.sid('scale-league-owner'), 'owner', 'active');

-- Owners first: the clearance gate (0120) covers admins and coaches, and
-- an owner records everyone's check.
insert into public.academy_members (academy_id, profile_id, role, status)
select pg_temp.sid('scale-club-' || c), pg_temp.sid('scale-staff-' || c || '-1'), 'owner', 'active'
  from generate_series(1, 60) c;

-- Every member of staff has a current check, recorded by the owner — before
-- they join as admin or coach, or the gate refuses them.
insert into public.staff_clearances (academy_id, profile_id, kind, number, outcome, expires_on, verified_by)
select pg_temp.sid('scale-club-' || c), pg_temp.sid('scale-staff-' || c || '-' || j), 'wwcc',
       'WWC' || lpad((c * 100 + j)::text, 7, '0') || 'E', 'cleared', (current_date + 700), pg_temp.sid('scale-staff-' || c || '-1')
  from generate_series(1, 60) c, generate_series(1, 10) j;

insert into public.academy_members (academy_id, profile_id, role, status)
select pg_temp.sid('scale-club-' || c), pg_temp.sid('scale-staff-' || c || '-' || j),
       (case when j = 2 then 'admin' else 'coach' end)::public.academy_role, 'active'
  from generate_series(1, 60) c, generate_series(2, 10) j;

-- Parent n belongs to club ((n - 1) % 60) + 1.
insert into public.academy_members (academy_id, profile_id, role, status)
select pg_temp.sid('scale-club-' || (((n - 1) % 60) + 1)), pg_temp.sid('scale-parent-' || n), 'parent', 'active'
  from generate_series(1, 10000) n;


-- ------------------------------------------------------------------ squads
-- Squad t belongs to club ((t - 1) % 60) + 1; age groups U7–U16 in turn.
insert into public.teams (id, academy_id, name, age_group, season, status)
select pg_temp.sid('scale-team-' || t), pg_temp.sid('scale-club-' || (((t - 1) % 60) + 1)),
       'U' || (7 + ((t - 1) / 60) % 10) || ' Squad ' || t, 'U' || (7 + ((t - 1) / 60) % 10), '2026', 'active'
  from generate_series(1, 400) t;

-- One coach per squad: the club's coaches 3–10 in turn.
insert into public.team_members (academy_id, team_id, profile_id, role)
select pg_temp.sid('scale-club-' || c), pg_temp.sid('scale-team-' || t),
       pg_temp.sid('scale-staff-' || c || '-' || (3 + ((t - 1) / 60) % 8)), 'coach'
  from generate_series(1, 400) t, lateral (select ((t - 1) % 60) + 1 as c) x;

-- 15 players a squad; born for their age group.
insert into public.players (id, academy_id, team_id, full_name, dob)
select pg_temp.sid('scale-player-' || p), pg_temp.sid('scale-club-' || c), pg_temp.sid('scale-team-' || t),
       'Player ' || p, make_date(2026 - (7 + ((t - 1) / 60) % 10), 1 + (p % 12), 1 + (p % 27))
  from generate_series(1, 6000) p,
       lateral (select ((p - 1) % 400) + 1 as t) tt,
       lateral (select ((tt.t - 1) % 60) + 1 as c) cc;

-- Guardians: within each club, the k-th player's first guardian is the
-- club's k-th parent, and the second (for about two in three) the
-- (k + 100)-th. Parents left over are members with no child in a squad.
with pl as (
  select p.id, p.academy_id, row_number() over (partition by p.academy_id order by p.id) as k
    from public.players p where p.full_name like 'Player %'
), par as (
  select am.profile_id, am.academy_id, row_number() over (partition by am.academy_id order by am.profile_id) as k
    from public.academy_members am
   where am.role = 'parent' and am.academy_id in (select id from public.academies where slug like 'scale-club-%')
)
insert into public.player_guardians (academy_id, player_id, profile_id, relationship, is_primary)
select pl.academy_id, pl.id, par.profile_id, 'parent', g = 1
  from pl
  cross join (values (1), (2)) as gs(g)
  join par on par.academy_id = pl.academy_id and par.k = pl.k + (g - 1) * 100;

-- --------------------------------------------------------------- the league
insert into public.competitions (id, organiser_id, name, type, season, status, starts_on, ends_on, created_by)
values (pg_temp.sid('scale-comp'), pg_temp.sid('scale-league'), 'Scale Season 2026', 'season', '2026', 'active',
        date '2026-10-03', date '2027-02-13', pg_temp.sid('scale-league-owner'));

insert into public.competition_clubs (competition_id, academy_id, status, joined_at)
select pg_temp.sid('scale-comp'), pg_temp.sid('scale-club-' || c), 'active', now() - interval '60 days'
  from generate_series(1, 60) c;

-- Two squads a club are entered (the first two), in six age divisions of 20.
insert into public.competition_entries (id, competition_id, academy_id, team_id, display_name, division)
select pg_temp.sid('scale-entry-' || t), pg_temp.sid('scale-comp'), tm.academy_id, tm.id, tm.name,
       'Division ' || (1 + (row_number() over (order by t) - 1) / 20)
  from generate_series(1, 120) t
  join public.teams tm on tm.id = pg_temp.sid('scale-team-' || t);

-- A round robin in each division: 19 rounds, Saturdays from 3 Oct 2026, 9 am
-- in Sydney. Rounds already played have a score.
with div as (
  select division, array_agg(id order by id) as ids from public.competition_entries
   where competition_id = pg_temp.sid('scale-comp') group by division
), pairs as (
  -- The circle method: entry i plays entry (r - i) mod 19 in round r, the
  -- twentieth sitting at the centre.
  select d.division, r, i,
         case when i = 19 then d.ids[20] else d.ids[1 + i] end as a,
         -- The centre plays x where 2x ≡ r (mod 19): x = 10r mod 19.
         case when i = 19 then d.ids[1 + ((10 * r) % 19)] else d.ids[1 + ((r - i + 19) % 19)] end as b
    from div d, generate_series(0, 18) r, generate_series(0, 19) i
)
insert into public.fixtures (competition_id, division, round, home_entry_id, away_entry_id, starts_at, duration_mins, status, home_score, away_score)
select pg_temp.sid('scale-comp'), p.division, (p.r + 1)::text,
       case when p.r % 2 = 0 then p.a else p.b end, case when p.r % 2 = 0 then p.b else p.a end,
       ((date '2026-10-03' + p.r * 7)::timestamp + time '09:00') at time zone 'Australia/Sydney', 60,
       (case when date '2026-10-03' + p.r * 7 < current_date then 'final' else 'scheduled' end)::public.fixture_status,
       case when date '2026-10-03' + p.r * 7 < current_date then (abs(hashtext(p.a::text || p.r)) % 5) end,
       case when date '2026-10-03' + p.r * 7 < current_date then (abs(hashtext(p.b::text || p.r)) % 5) end
  from pairs p
 where p.a <> p.b and (p.i = 19 or p.i < ((p.r - p.i + 19) % 19));

-- ------------------------------------------------------------- the bulk
set session_replication_role = replica;

-- Training twice a week for every squad, six weeks either side of today.
insert into public.events (academy_id, team_id, type, title, starts_at, ends_at, venue, created_by)
select tm.academy_id, tm.id, 'training', 'Training',
       ((current_date + w * 7 + d)::timestamp + time '17:30') at time zone 'Australia/Sydney',
       ((current_date + w * 7 + d)::timestamp + time '18:45') at time zone 'Australia/Sydney',
       'Scale Oval', null
  from public.teams tm, generate_series(-6, 5) w, (values (1), (3)) as dd(d)
 where tm.name like '%Squad %';

-- Answers for the next three weeks: about seven in ten children, by their
-- first guardian.
insert into public.event_rsvps (academy_id, event_id, profile_id, player_id, status, note)
select e.academy_id, e.id, pg.profile_id, pl.id,
       (case abs(hashtext(e.id::text || pl.id::text)) % 10 when 0 then 'no' when 1 then 'maybe' else 'yes' end)::public.rsvp_status,
       case when abs(hashtext(e.id::text || pl.id::text)) % 10 = 0 then 'Away this week' end
  from public.events e
  join public.players pl on pl.team_id = e.team_id
  join public.player_guardians pg on pg.player_id = pl.id and pg.is_primary
 where e.title = 'Training' and e.starts_at between now() and now() + interval '21 days'
   and abs(hashtext(e.id::text || pl.id::text || 'answered')) % 10 < 7;

-- Half a million messages over 120 days: 1,000 in each squad's chat, 1,000
-- in each club's announcements, 666 in each coaches' channel, from the
-- channel's own members in turn.
create temporary table chan_people as
  select cm.channel_id, cm.academy_id, cm.profile_id,
         row_number() over (partition by cm.channel_id order by cm.profile_id) as k,
         count(*) over (partition by cm.channel_id) as n
    from public.channel_members cm
    join public.channels c on c.id = cm.channel_id
   where c.academy_id in (select id from public.academies where slug like 'scale-%');
create index on chan_people (channel_id, k);

with targets as (
  select c.id as channel_id, c.academy_id,
         case c.type when 'team' then 1000 when 'academy_wide' then 1000 when 'coaches' then 666 else 0 end as how_many,
         (select max(n) from chan_people x where x.channel_id = c.id) as members
    from public.channels c
   where c.academy_id in (select id from public.academies where slug like 'scale-club-%')
)
insert into public.messages (academy_id, channel_id, sender_id, body, status, created_at)
select t.academy_id, t.channel_id, cp.profile_id,
       'Message ' || s || ' — see you Saturday, bring a drink bottle and shin pads.',
       'published',
       now() - ((t.how_many - s) * (interval '120 days' / t.how_many))
  from targets t
  cross join lateral generate_series(1, t.how_many) s
  join chan_people cp on cp.channel_id = t.channel_id
   and cp.k = 1 + (abs(hashtext(t.channel_id::text || s)) % t.members)
 where t.how_many > 0 and t.members > 0;

-- Everyone has read up to some point in the last three days.
update public.channel_members cm
   set last_read_at = now() - ((abs(hashtext(cm.id::text)) % 4320) * interval '1 minute')
 where cm.academy_id in (select id from public.academies where slug like 'scale-%');

set session_replication_role = origin;
