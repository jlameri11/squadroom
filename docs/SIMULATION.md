# SPL Season 4 — the simulation

Last run: 2026-11-15 09:31 UTC · 5 rounds played · 18 PASS · 2 FIXED · 6 FAIL · 4 not run · 8 bugs logged (3 fixed) · 4 min so far

## What this is

Joey's brief (9 Nov 2026): build a whole league — Harbour Football Group, SPL Season 4, five age groups in 39 divisions, 300 teams from 60 clubs and academies, 12 grounds with their pitches and hours, 150 referees (30 under 18), every league and committee role, 4,500 players with one or two guardians — and play the season week by week on the local Postgres with every scenario on the list of 13 Nov, as the people who would do it, through the same functions the screens call. Measure at the peak. Log every failure in `docs/BUGS.md`; fix every high and medium.

How to run it (local only, never squadroom-dev): `node scripts/simulation/season.mjs --rebuild` — rebuilds the local database from every migration, loads `scripts/simulation/seed.sql` and the clock (`clock.sql`), then plays the season. `--until N` stops after round N. The clock is simulated: every call runs at the season's own moment (February to June 2027), so sheet locks, late declines, reminders, quiet hours, scheduled messages, check expiries and the morning sweeps fire as they would; pg_cron and the push drain are emulated every quarter-hour (`world.mjs`). Everything is done as a person under their RLS; the database is never written as the service role except where the product's own server would (the Stripe webhook's payment rows, the drain marking rows sent). The simulated data is deleted at the end by rebuilding the local database.

## The scenarios

PASS: happened and behaved as expected. FIXED: failed in an earlier run, fixed (the Fixed column names where), passes now. FAIL: still wrong — see the bug number. Every check is in `scripts/simulation/scenarios.mjs`.

### Season build

| # | Scenario | Result | Checks | Bugs | Fixed in |
|---|---|---|---|---|---|
| S1 | The draw: 14 rounds home and away, a bye week in the school holidays | **FIXED** | 5/5 | — | 0276: generate_fixtures(… p_legs, p_skip_dates); 0276: p_skip_dates |
| S2 | The sanity check on the draw: every pair once a leg, no coach in two games, families at two grounds as a warning, no double-headers | **PASS** | 4/4 | — | — |

### Fields & venues

| # | Scenario | Result | Checks | Bugs | Fixed in |
|---|---|---|---|---|---|
| FV1 | Pitch allocation by age-group size | **PASS** | 2/2 | — | — |
| FV3 | Hours limits: nothing drawn outside a pitch's hours, and a move outside them is refused | **PASS** | 2/2 | — | — |
| FV2 | A full pitch split into halves, thirds or quarters | **PASS** | 4/4 | — | — |
| FV4 | Double-booking a pitch is refused | **PASS** | 2/2 | — | — |
| FV11 | Field map, directions and "Field 3" shown correctly to every family affected | **PASS** | 22/22 | — | — |
| FV9 | Ground closures announced Friday night and Saturday 7 am; a whole venue closed — _Friday night: the 14 referees appointed to those games are told their game is off: expected 14, got 8; Saturday 7 am: the 14 referees appointed to those games are told their game is off: expected 14, got 8_ | **FAIL** | 9/11 | #6 | — |
| FV6 | A whole venue closed | **PASS** | 1/1 | — | — |
| FV10 | Partial closure: one pitch only | **PASS** | 2/2 | — | — |
| FV5 | A pitch changed on the morning | **NOT RUN** | — | — | — |
| FV7 | A game moved to another venue | **NOT RUN** | — | — | — |
| FV8 | A late kick-off pushing later games | **NOT RUN** | — | — | — |

### Weather & safety on the day

| # | Scenario | Result | Checks | Bugs | Fixed in |
|---|---|---|---|---|---|
| WS3 | Extreme heat → kick-offs moved earlier / drink breaks noted / a round postponed | **PASS** | 3/3 | — | — |
| WS1 | Wet-weather washout of a whole round: every game called off, every family, coach and referee told once, no duplicate pushes — _Washout: the 124 referees appointed to those games are told their game is off: expected 124, got 75_ | **FAIL** | 5/6 | #7 | — |
| WS4 | Rescheduled games: a catch-up round, a mid-week reschedule, a double-header — _the double-header shows in the draw's sanity check: expected a double header on 2027-03-06, got []_ | **FAIL** | 3/4 | #8 | — |
| WS2 | Lightning suspension mid-game → resumed later the same day, and one abandoned — _four 8 am games at Bayview to use: expected 4, got 0_ | **FAIL** | 2/3 | — | — |

### Results

| # | Scenario | Result | Checks | Bugs | Fixed in |
|---|---|---|---|---|---|
| R1 | Win, draw, loss; high scores; 0–0 | **PASS** | 7/7 | — | — |
| R2 | Matching scores → final; mismatched → dispute → the league rules → the ladder moves only then — _the league's Home shows one disputed result: expected "1 disputed", got 8 disputed · 1 sheets missing_ | **FAIL** | 3/4 | #5 | — |
| R3 | Late result, missing result, a correction after the game, a result entered offline and synced later | **PASS** | 4/4 | — | — |
| R4 | Forfeit (coach → club → league), walkover, bye, abandoned with the score standing / replayed / awarded | **NOT RUN** | — | — | — |

### On-field issues

| # | Scenario | Result | Checks | Bugs | Fixed in |
|---|---|---|---|---|---|
| OF6 | Wrong team sheet submitted, sheet after lock — only the referee or the league can change it, logged | **PASS** | 2/2 | — | — |
| OF4 | Referee no-show, late decline, club-supplied referee, under-18 referee, referee abused → report | **PASS** | 2/2 | — | — |

### Off-field issues

| # | Scenario | Result | Checks | Bugs | Fixed in |
|---|---|---|---|---|---|
| OFF5b | A club enters late | **PASS** | 5/5 | — | — |
| OFF7a | Daylight saving: the same kick-off time on the clock after the change | **FIXED** | 1/1 | — | 0276: round dates worked out in the competition's zone |

### People & messaging

| # | Scenario | Result | Checks | Bugs | Fixed in |
|---|---|---|---|---|---|
| PM3 | Busy team chats with replies, reactions, photos and polls | **PASS** | 4/4 | — | — |
| PM5 | Quiet hours and the digest respected — _the quiet-hours parent shares a squad chat with a digest parent: expected a channel, got none_ | **FAIL** | 0/1 | #4 | — |
| PM4 | Scheduled messages go at their time, not before | **PASS** | 8/8 | — | — |
| PM6 | No message sent twice; late messages not sent | **PASS** | 14/14 | — | — |
| PM1 | Notices to everyone / club staff only | **PASS** | 4/4 | — | — |

## The load

Over the run: 10 league notices, 60 club messages, 1200 chat lines, 600 reactions, 50 polls, 200 scheduled messages, 12487 RSVPs, 610 referee appointments, 1098 team sheets, 333 results agreed on the sheets, 39 disputes (40 ruled on), 17 late results, 61 cards.

| Round | Date | Games | Notifications queued | Sent | Texts | By kind |
|---|---|---|---|---|---|---|
| 1 | 2027-02-06 | 145 | 119404 | 118353 | 0 | event_reminder 54358, event_changed 45038, announcement 11483, message 7478, match_day 289, team_sheet_due 289 |
| 2 | 2027-02-13 | 145 | 49474 | 49474 | 0 | event_reminder 38666, message 7354, announcement 2615, match_day 289, team_sheet_due 289, helper_reminder 152 |
| 3 | 2027-02-20 | 145 | 74296 | 74296 | 2078 | event_reminder 45100, announcement 18581, message 7362, event_cancelled 2040, team_sheet_due 289, match_day 231 |
| 4 | 2027-02-27 | 145 | 73720 | 66015 | 7705 | event_reminder 38952, announcement 10667, event_back_on 7560, event_cancelled 7560, message 7356, fee_overdue 402 |
| 5 | 2027-03-03 | 4 | 32508 | 32508 | 0 | event_reminder 23752, event_back_on 7560, message 912, referee_game_moved 145, announcement 131, match_day 8 |

## Bugs

8 logged in `docs/BUGS.md`, 3 marked fixed. The table there carries role, steps, expected, actual and where each was fixed.

## Needs Joey

- Nothing from this run.
