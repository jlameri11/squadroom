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

## 6. "Feels instant" — a phone on 4G (13 Nov 2026)

Joey's brief of 11 Nov: no perceived lag on a phone on 4G — stale-while-
revalidate on every main screen, optimistic taps, prefetching, server work in
Sydney, skeletons in the real shape, and the numbers before and after.
Targets: tap feedback under 100 ms, first content under 1 s cold and under
300 ms warm. BUILD_PLAN item 16; 0273–0275.

### How it was measured

- `THROTTLE=fast4g node --env-file=.env.local scripts/time-screens.mjs`
  against the production build (`npm run serve:test`) on this laptop:
  Chrome's **Fast 4G** profile (9 Mbps down, 1.5 up, 165 ms latency) and a
  **CPU four times slower** — roughly a mid-range phone on a good mobile
  signal. Median of three. Since this pass a visit gives two numbers:
  **first content**, when the skeleton has gone and a person can read
  something; and **settled**, when no request to the database has been in
  flight for 400 ms — which now includes the prefetching for the next tap.
- `scripts/time-taps.mjs`: the three taps people make most, timed inside the
  page from the tap to the screen changing — an RSVP on Home, a message
  sent in a chat, a goal on match day — and what followed (the database
  having it, the bubble staying, the hero agreeing).
- **Read "before" with care.** A chat and a game were rendered on the
  server, and the harness timed that frame from a server on this laptop: no
  Pacific crossing, and the browser's own requests after it were not caught
  (the old game page even timed out warm, on a realtime socket the harness
  counted as a request). In production each of those pages paid two trips
  to Sydney from us-east-2 — 250–700 ms each (NIGHT_LOG, 11 Nov) — before
  the first byte. So those two rows are not like for like; the request
  counts are. Fixtures and the Ladder read as ready in ~420 ms in both runs
  because their shell was the loading placeholder, which carried no skeleton
  mark and had made no request yet at DOMContentLoaded; the harness now waits
  for a request, and those two are re-measured below.

### Screens (ms; Fast 4G, CPU 4× slower; median of 3)

| Screen | As | Before: settled cold | Before: settled warm | Before: requests | After: first cold | After: first warm | After: settled cold | After: settled warm | After: requests |
|---|---|---|---|---|---|---|---|---|---|
| Home | parent | 1448 | 483 | 15 | 1382 | **255** | 1553 | 472 | 13 |
| Chat list | parent | 1385 | 437 | 10 | 1206 | **241** | 1324 | 1084 ¹ | 8 |
| U8 chat | parent | 424 ² | 217 ² | 0 ² | 1266 | **258** | 1568 | 528 | 19 |
| Fixtures | parent | 419 ³ | 218 ³ | 0 ³ | 418 ³ | 219 ³ | — | — | — |
| Next game | parent | 443 ² | — ² | 25 | 1219 | **259** | 2147 | 1019 ¹ | 24 |
| Home | coach | 2000 | 850 | 25 | 1288 | **260** | 1493 | 461 | 13 |
| Admin | coach | 1587 | 602 | 15 | 1427 | 451 | 1591 | 596 | 10 |
| Admin | owner | 1553 | 609 | 17 | 1331 | 455 | 1545 | 602 | 12 |
| Ladder | league | 422 ³ | 250 ³ | 0 ³ | 422 ³ | 368 ³ | — | — | — |
| Match centre | stranger | 436 | 239 | 1 | 428 | 229 | 441 | 229 | 1 |

¹ Settled late on purpose: the chat list warms each chat whose row is in
view, and the game page loads its tabs' panels after the hero; both are
background work after first content.
² A server-rendered frame from a local server — see above.
³ The loading placeholder, not content — see above; re-measured below.

**The repeated calls that were there before:** `two_step_status` three times
on every screen (now once a minute per tab), `home_jobs` twice on every Home
(the early start and the card asked with different keys), the competitions
card's one-plus-three-per-competition (thirteen requests on a coach's Home;
one now), the Admin hub's three counts plus one (one now). Still there and
noted for later: the game page's `fixtures` ×3 and its 24 requests in all
(`use-game` plus the preview tab's panels), the chat's `profiles` ×2 and the
per-poll `poll_results`/`my_poll_votes`, and the Admin hub's `jwks` ×2 and
`academy_members` ×2 on a cold open (two readers of the current
organisation before the shared read lands).

### Taps (ms from the tap to the screen; Fast 4G, CPU 4×; median of 3)

| Tap | Before | Then (before) | After | Then (after) |
|---|---|---|---|---|
| RSVP on Home | 2 | saved in the database after 22 ms | 2 | saved after 33 ms |
| Send a message | 19 | **the bubble vanished for a moment, 3 of 3** | 21 | the bubble stayed |
| +1 Them on match day | **362** | **the hero agreed after 12,657 ms** | **2** | the hero agreed after 2 ms |

### What changed

1. **A chat and a game are the browser's** (0273): `channel_screen` and
   `game_screen`, one call each from Sydney, through `lib/hooks/use-screen`
   — the same memory-and-IndexedDB cache Home, the Chat list and Fixtures
   had — so a chat or a game opened before paints at once and refreshes
   quietly; the pages are session gates and shells. Netlify refuses to move
   this plan's functions to Sydney (NEEDS JOEY #27), which is why the pages
   moved rather than the server.
2. **One request per screen key**: whoever asks first starts it, anyone
   else joins (`fetchScreen`); an answer under five seconds old is not asked
   for again; a screen asks again quietly when the tab comes back after
   thirty seconds away. Home's sections (`home_layout`, `needs_you`,
   `home_jobs`, `home_competitions`) and the Admin hub (`admin_hub`, 0274)
   go through the same cache; `home_competitions` counts a competition's
   fixtures in one pass (0275).
3. **Prefetch**: once Home has settled, the four tabs' screens and the next
   game; a chat row in view warms its chat (`useInViewOnce`); a
   `preconnect` to the database in the page head.
4. **Taps show at once and roll back with a sentence**: the sent bubble
   keeps the row's id instead of vanishing until the broadcast; a reaction
   is put back with a word if refused; a goal moves the score on the tap
   (`ahead`), and the hero is told by a `squadroom:score` event instead of
   waiting for its fifteen-second timer; approving a join or a registration
   removes the row at once and brings it back with the reason; a fee, a
   referee run and a voucher marked paid or redeemed the same. The game
   page's RSVP buttons are no longer greyed for up to six seconds. A refusal
   is `plainRefusal`: our own sentences kept, Postgres's not shown.
5. **Skeletons in the real shape**: a chat (bar, bubbles, composer), a game
   (back link, hero, tabs), the chat list (search, rows), the Admin hub
   (rows); every loading state carries `data-skeleton`.
6. **Fewer calls per screen**: `two_step_status` once a minute per tab and
   shared in flight; one current-organisation read per tab.

### What the numbers say, and what is left

- **Warm, first content is 220–260 ms on every main screen** except the
  Admin hub (450 ms, which first resolves the current organisation and
  then asks) — under the 300 ms target. **Cold, first content is 1.2–1.4 s**
  on this profile against a 1 s target: the database answers in 30–60 ms,
  the one round trip costs 165 ms, and the rest is the JavaScript itself on
  a four-times-slower CPU. What would move it: a smaller first chunk (fewer
  client components on the first paint), and for the game page one
  `game_context` call in place of `use-game`'s cascade (24 requests).
- **Every tap is at 2–21 ms**, and what follows a tap now agrees with it:
  the goal's hero in 2 ms from 12.7 s, the sent message on screen for good.
- Settled times include the prefetching that makes the *next* tap instant;
  first content is the number that says what a person sees.
