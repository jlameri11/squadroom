# Scale

Joey's brief of 5 Nov 2026, before the December review: a big fake
dataset (60 clubs, 400 teams, 6,000 players, 10,000 parents, 500,000
messages, a full SPL season), every key screen under a second, the slowest
queries and RLS policies explained and fixed, a Saturday 8 am spike (2,000
people opening the app, 300 live chats and score updates at once), and the
Supabase plan we need at launch.

**Where it stands (7 Nov):** done. The screens are timed in a production
build and the app's own waste is gone (sections 1–3); the big dataset, the
query costs and the Saturday spike ran on this laptop, free, as Joey asked
(section 4); the launch plan is section 5 and NEEDS JOEY #21.

---

## 1. How a screen is timed

`scripts/time-screens.mjs` against a production build (`npm run
serve:test`, port 3100; the dev server compiles on demand and would time
itself). For each screen, as the person who uses it, three times over:

- **cold** — a fresh browser, nothing cached: opening the app from a link
  or a push;
- **warm** — the same browser again: the second open;
- **ready** — from navigation until the loading skeleton has gone and no
  request to the database has been in flight for 400 ms (or, for a page the
  server renders whole, when the document is ready);
- **requests** — calls to the database on the way, and any call made more
  than once for one screen.

The median of three is reported; the target is under 1,000 ms.

Run: `node --env-file=.env.local scripts/time-screens.mjs` (`RUNS=`,
`JSON=` to keep the numbers, `TIME_BASE=` for another server).

## 2. On the dev data

The dev data is one academy (NRIFA), one league (the SPL) and a second club
(Ravens): small. These numbers say what the app itself costs — how many
requests, how many of them one after another — not how the database holds
up at 10,000 parents; that is section 4.

Milliseconds, median of three, production build, 6 Nov 2026. "Before" is the
build of the morning; "after" includes every fix in section 3.

| Screen | As | Cold before | Cold after | Warm before | Warm after | Requests before | Requests after |
|---|---|---|---|---|---|---|---|
| Home | parent | 2744 | 649 | 496 | 372 | 11 | 9 |
| Chat list | parent | 338 | 222 | 158 | 132 | 8 | 5 |
| U8 chat | parent | 1363 | 855 | 788 | 420 | 61 | 14 |
| Fixtures | parent | 457 | 419 | 204 | 197 | 9 | 6 |
| Next game | parent | 412 | 427 | 391 | 471 | 10 | 8 |
| Home | coach | 562 | 501 | 285 | 253 | 13 | 10 |
| Admin | coach | 475 | 363 | 184 | 207 | 13 | 10 |
| Admin | owner | 409 | 492 | 185 | 152 | 13 | 11 |
| Ladder | league | 491 | 582 | 441 | 526 | 7 | 5 |
| Match centre | stranger | — | 151 | — | 141 | — | 0 |

Read with care: one request to the database is 60–300 ms from this laptop
to Sydney and back, and a single run can catch a slow one (the parent's
first Home of the morning took 2.7 s on a cold database, then never again).
The parent's Home "before" is that run. The match centre's "before" was not
measured (the harness timed a page with no browser requests as 0 until it
was fixed). What moved for certain is the request count: the U8 chat went
from 61 to 14, and every screen's warm open is now under half a second bar
the game page and the ladder.

## 3. What the timing found, and what was fixed

1. **The chat asked once per message.** Opening the U8 chat made 61
   requests, 46 of them `reaction_counts` — one per bubble, though the
   function takes a list. Signed links for attachments the same, one call
   per message. Both now go through `lib/batch.ts`: everything asked for in
   the same few milliseconds is one request.
2. **A person's Appearance never loaded.** The theme asked for every column
   of the profile, and the database refused it on every page: the phone
   column is withheld from everyone (0012), so `*` asks for a column you
   may not have. It now asks for the two appearance columns, and 0209
   grants them (unapplied; before this, applying 0209 would still have left
   Appearance unloaded). It also stopped verifying the sign-in token
   against the auth server's keys to choose colours (a request per page).
3. **The tab bar's badges were fetched twice on most pages** — a component
   mounting just after the first answer asked again. The answer is now
   shared for five seconds per page.
4. **The email and teen-login checks (0214–0215) cost two requests on
   every page.** They are now asked once per browser session, in parallel,
   and the teen-login claim not at all for a phone-joined parent.
5. **Home was a chain.** The screen loaded, then rendered, then its
   sections each asked for their own data: a second round trip on every
   open. The four requests now start together (`lib/early.ts`).
6. **A chat's file links were made again on every visit**, though each
   lasts an hour — the slowest single request on the chat screen (~650 ms).
   They are kept for the tab until five minutes before they expire, and
   forgotten on sign-out (`lib/signed-links.ts`): the warm U8 chat went
   from 788 to 420 ms.

`scripts/test-request-sharing.ts` holds the two helpers to what they
promise (one request for many asks, each answer to its asker, a failure
costing nothing; whoever asks first starts a shared request).

## 4. The big run — on this laptop (6–7 Nov)

Joey, 6 Nov: "use the free local Supabase on the laptop for the big
dataset — no billed branch." The embedded Postgres in `scripts/local-db/`
runs every migration (all 217 apply from empty); the dataset goes in on top.

### The dataset — `scripts/scale/seed.sql`

| | |
|---|---|
| Clubs | 60, each with an owner, an admin and eight coaches (all with a current check) |
| A league | one, running a season with all 60 clubs and 120 squads entered, six divisions of 20 |
| Squads | 400 (U7–U16), one coach each |
| Players | 6,000 (15 a squad), with 10,000 guardian links |
| Parents | 10,000 (10,601 people in all) |
| Fixtures | 1,140 (a 19-round round robin per division); 300 played, with scores |
| Sessions | 9,600 trainings, six weeks either side of today, plus the games |
| Answers | 25,236 for the next three weeks |
| Messages | 499,960 over 120 days — 1,000 in each squad chat and club channel |
| Size | 475 MB (messages 278 MB) |

Structure goes in with triggers on, so channels, memberships, settings and
the competition's Notices come about as they do in the product (20 s to
load). Run: `node scripts/local-db/run.mjs && node scripts/local-db/sql.mjs
-f scripts/scale/seed.sql`.

### One call at a time — `scripts/scale/measure.mjs`

Each function behind a key screen, called as the person who uses it, under
their RLS; Postgres's own execution time, median of three, in milliseconds.

| Function | Parent | Coach | Owner | League |
|---|---|---|---|---|
| home_screen | 6.0 | 18.1 | 9.3 | |
| home_jobs | 6.8 (was 10.5) | 18.3 (was 24.0) | | |
| needs_you | 0.7 | | 1.8 | |
| nav_badges | 1.3 | 1.4 | 1.4 | 1.3 |
| chat_screen | 1.3 | | | |
| channel_messages (50) | 1.5 | | | |
| fixtures_screen | 4.4 | | | |
| search_chat | 13.4 | | | |
| event_rsvp_summary | | 0.2 | | |
| availability_grid | | 0.8 | | |
| competition_ladder | | | | 0.5 |
| notices_reach | | | | 0.2 |

Writes, triggers and fan-out included:

| Write | ms |
|---|---|
| A league notice to everyone (3,602 people get a push) | 86 |
| A notice to club staff only | 9 |
| A line in a squad chat (25 members) | 1.0 |
| A parent's answer | 0.4 |
| A live score tap | 1.3 |

### The Saturday 8 am spike — `scripts/scale/spike.mjs`

2,000 parents opening the app (Home's five calls; four in ten also open
their squad's chat) while 300 live games each take four score taps and
five chat lines — 4,700 sessions, 15,100 calls, all at once, shuffled
together, through a pool of 15 connections (the size of Supabase's pooler
for the small computes):

| | Before 0216 | After 0216 |
|---|---|---|
| The whole morning | 7.1 s | 5.6 s |
| Calls a second | 2,132 | 2,704 |
| home_jobs p50 / p95 / p99 | 19 / 40 / 56 ms | 10 / 29 / 40 ms |
| home_screen p50 / p95 / p99 | 11 / 26 / 35 ms | 10 / 29 / 40 ms |
| Everything else, p99 | under 18 ms | under 18 ms |
| Database time per Home open | 41 ms | 31 ms |

### What it found, and fixed

- **0216: Home's jobs asked for the next three weeks up to three times an
  open**, and that list works out who has answered and who is coming for
  every event in it — for a coach, the whole club's. Now once. The new
  version was checked against the old for twenty people: the same jobs,
  except that a tie (two squads training at the same minute) now goes the
  same way every time. A quarter off the database time of an open.
- **The role helpers are PL/pgSQL now (0224, 8 Nov).** Adding the two-step
  rule to `academy_role_of` as a SQL function made a staff check 44 µs, from
  19 — Postgres 17 plans a SQL-language function again on every call, and
  the nested check made that plan bigger. In PL/pgSQL, which keeps its plans
  for the session, the same rule costs 6 µs a staff check, 9 a squad
  coach's and 5 a parent's — each faster than before the rule existed
  (100,000 calls each, on the demo copy).
- **What still grows with a club's size:** `my_upcoming_events` works out
  a summary for every event in the window. A coach at a 60-squad club would
  pay about ten times what one at NRIFA's size does (~200 ms). The fix, when
  such a club signs up, is to ask for summaries only for the events shown.
- **Nothing grows with the size of Squadroom.** Every call reads its own
  club, squad or channel through indexes; 500,000 messages cost a chat
  screen 1.5 ms.
- **A league notice is the heaviest single write** (86 ms for 3,602
  recipients — a push row each). Fine at a few a week; a league ten times the
  SPL would make it about a second, still acceptable for something sent a
  few times a week.

## 5. The plan for launch

What the numbers say, for 10,000 parents:

- **The database is not the constraint.** The worst case — every family
  opening the app in the same minute — is 2,000 opens × 31 ms ≈ one CPU-core
  second per second on this laptop. A cloud vCPU is slower (call it two to
  three times), so two vCPUs would be busy for that minute and idle most of
  the week. Real Saturdays spread the opens over the morning.
- **Memory:** the whole dataset is under 500 MB; the part read on a
  Saturday (this week's events, recent messages) is a fraction of it. 2 GB
  holds it with room.
- **Recommendation:** the **Pro plan**, on the **Small compute** at launch
  (2 vCPUs, 2 GB — check the current figures on supabase.com/pricing), and
  watch Saturday morning's CPU in the dashboard: move to Medium if it sits
  above about 60 %.
- **Backups:** Pro keeps daily backups for seven days. For a product that
  holds a season's chat and answers, add **point-in-time recovery** (seven
  days) before the first real club, so a bad Saturday loses minutes rather
  than a day. It is an add-on with its own price.
- **What this cannot tell us:** Supabase's API, Auth and Realtime are their
  own services, sized by Supabase; the network from a phone in Sydney adds
  what `time-screens` measured on the dev data (section 2). Push sending
  runs on Netlify functions.

The decision, and its cost, is Joey's: NIGHT_LOG, NEEDS JOEY #21.
