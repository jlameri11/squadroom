# Scale

Joey's brief of 5 Nov 2026, before the December review: a big fake
dataset (60 clubs, 400 teams, 6,000 players, 10,000 parents, 500,000
messages, a full SPL season), every key screen under a second, the slowest
queries and RLS policies explained and fixed, a Saturday 8 am spike (2,000
people opening the app, 300 live chats and score updates at once), and the
Supabase plan we need at launch.

**Where it stands (6 Nov):** the first half is done on the dev data — the
screens are timed in a production build and the app's own waste is gone.
The big run waits for two things only Joey can give (NIGHT_LOG, NEEDS JOEY
#12 and #18): a working Supabase access token, and an answer on where the
big dataset lives (a billed Supabase branch, or a free local Supabase whose
timings are a laptop's).

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

## 4. The big run — what it must answer

**(6 Nov) Where:** the dataset and the query plans can be done on this
laptop, in the embedded Postgres `scripts/local-db/` already runs every
migration in — free, no token, no branch. What that cannot give is
Sydney's network timings; a hosted branch is only needed for those (NEEDS
JOEY #18).


1. **Seed** the dataset with a script (never the dev data): 60 clubs, 400
   teams, 6,000 players, 10,000 parents with guardianships, 500,000
   messages spread over channels the way real chats are (a few busy, most
   quiet), the SPL season's fixtures and results, read state for everyone.
2. **Time** the same screens with `time-screens` against it.
3. **EXPLAIN** the slowest. The suspects from reading the code:
   - `my_channels` (behind the Chat list, the tab bar's badge and Home):
     an unread count per channel, per person, on every page.
   - `messages` RLS: `is_channel_member` per row, and from 0213
     `sees_staff_notices` for club-staff notices.
   - `home_screen`, `fixtures_screen`, `chat_screen`, `nav_badges`.
   - 0213's `notices_standing` and `notices_people` for a competition the
     size of the SPL (every family of 400 teams).
   - Indexes to confirm: `messages (channel_id, created_at)`,
     `channel_members (profile_id)`, `team_members (profile_id)`,
     `competition_entries (competition_id, team_id)`,
     `notification_queue` by `scheduled_for`.
4. **The Saturday spike:** 2,000 simulated people opening Home and the
   chat within a minute, and 300 live games ticking scores and posting
   chat lines, while the push queue drains. Watch database CPU, connection
   count and the slowest request.
5. **The plan for launch:** the Supabase tier, compute size, backups and
   point-in-time recovery the numbers call for — written here, and put to
   Joey under NEEDS JOEY. No figure is given before it is measured.
