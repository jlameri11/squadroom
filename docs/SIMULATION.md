# SPL Season 4 — the simulation

Last run: 2026-11-15 23:57 UTC · 2 rounds played · 15 PASS · 6 FIXED · 0 FAIL · 0 not run · 42 bugs logged (17 fixed) · 6 min so far

## What this is

Joey's brief (9 Nov 2026): build a whole league — Harbour Football Group, SPL Season 4, five age groups in 39 divisions, 300 teams from 60 clubs and academies, 12 grounds with their pitches and hours, 150 referees (30 under 18), every league and committee role, 4,500 players with one or two guardians — and play the season week by week on the local Postgres with every scenario on the list of 13 Nov, as the people who would do it, through the same functions the screens call. Measure at the peak. Log every failure in `docs/BUGS.md`; fix every high and medium.

How to run it (local only, never squadroom-dev): `node scripts/simulation/season.mjs --rebuild --commit --seed N` — rebuilds the local database from every migration, loads `scripts/simulation/seed.sql` and the clock (`clock.sql`), then plays the season and commits after every round. `--until N` stops after round N; the seed changes the draw of events, scores, weather and who misbehaves. The clock is simulated: every call runs at the season's own moment (February to June 2027, then January–February 2028 for the second season), so sheet locks, late declines, reminders, quiet hours, scheduled messages, check expiries and the morning sweeps fire as they would; pg_cron and the push drain are emulated every quarter-hour (`world.mjs`). Everything is done as a person under their RLS; the database is never written as the service role except where the product's own server would (the Stripe webhook's payment rows, the drain marking rows sent). At five moments — after the draw, a washout Saturday, a dispute, a suspension, the finals — and again in the second season, **the real app is opened in a browser at 375px** as nine people (three parents, one with children at two clubs; two coaches; a team manager; a club president; the league organiser; a referee) against a small local Supabase (`stack.mjs`), and Home, Fixtures, the game page, the ladder, the chats and the notices are compared with what the database says; the screenshots are in `.cache/screens/`. After Season 4's grand final the league ends the season, the sixty clubs roll over to 2028, SPL Season 5 starts from Season 4 and plays three rounds, so that past seasons and head to head are proved on a league with a history. The simulated data is deleted at the end by rebuilding the local database.

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
| FV11 | Field map, directions and "Field 3" shown correctly to every family affected | **FIXED** | 7/7 | — | 0276: apply_reschedule resolves the ground and field to the pitch; 0276: the field in the mirrored event's venue; a field change is a change families hear |

### Results

| # | Scenario | Result | Checks | Bugs | Fixed in |
|---|---|---|---|---|---|
| R1 | Win, draw, loss; high scores; 0–0 | **PASS** | 7/7 | — | — |
| R2 | Matching scores → final; mismatched → dispute → the league rules → the ladder moves only then | **PASS** | 7/7 | — | — |
| R3 | Late result, missing result, a correction after the game, a result entered offline and synced later | **PASS** | 9/9 | — | — |

### On-field issues

| # | Scenario | Result | Checks | Bugs | Fixed in |
|---|---|---|---|---|---|
| OF6 | Wrong team sheet submitted, sheet after lock — only the referee or the league can change it, logged | **PASS** | 6/6 | — | — |
| OF4 | Referee no-show, late decline, club-supplied referee, under-18 referee, referee abused → report | **FIXED** | 17/17 | — | 0276: a report of abuse, an injury or an incident is pushed; 0276: referee_unavailable_reason |

### Off-field issues

| # | Scenario | Result | Checks | Bugs | Fixed in |
|---|---|---|---|---|---|
| OFF5b | A club enters late | **PASS** | 5/5 | — | — |
| OFF7a | Daylight saving: the same kick-off time on the clock after the change | **FIXED** | 1/1 | — | 0276: round dates worked out in the competition's zone |

### People & messaging

| # | Scenario | Result | Checks | Bugs | Fixed in |
|---|---|---|---|---|---|
| PM3 | Busy team chats with replies, reactions, photos and polls | **PASS** | 4/4 | — | — |
| PM5 | Quiet hours and the digest respected | **PASS** | 3/3 | — | — |
| PM4 | Scheduled messages go at their time, not before | **PASS** | 4/4 | — | — |
| PM6 | No message sent twice; late messages not sent | **PASS** | 7/7 | — | — |
| PM1 | Notices to everyone / club staff only | **PASS** | 4/4 | — | — |

### Screens

| # | Scenario | Result | Checks | Bugs | Fixed in |
|---|---|---|---|---|---|
| SC1 | Screens after the draw: Home, Fixtures, the game page, the ladder, chats and notices as nine people see them | **FIXED** | 105/105 | — | 0278: staff_reads_channel — staff read team, age-group, coaches, club-wide and custom chats, never a direct one; 0278: team managers stand with the staff for a competition's Notices |
| SC3 | Screens with a result in dispute: no score stands, the league sees the dispute, the ladder waits | **FIXED** | 129/129 | — | 0278: staff_reads_channel — staff read team, age-group, coaches, club-wide and custom chats, never a direct one; 0278: team managers stand with the staff for a competition's Notices |

## The load

Over the run: 4 league notices, 24 club messages, 480 chat lines, 240 reactions, 20 polls, 80 scheduled messages, 6892 RSVPs, 308 referee appointments, 551 team sheets, 256 results agreed on the sheets, 17 disputes (18 ruled on), 7 late results, 53 cards.

| Round | Date | Games | Notifications queued | Sent | Texts | By kind |
|---|---|---|---|---|---|---|
| 1 | 2027-02-06 | 145 | 75554 | 74503 | 0 | event_reminder 54358, announcement 12083, message 7530, entry_fee_owed 510, team_sheet_due 289, match_day 289 |
| 2 | 2027-02-13 | 145 | 58825 | 58825 | 0 | event_reminder 38666, announcement 11675, message 7354, match_day 289, team_sheet_due 289, referee_appointment 153 |

## Bugs

42 logged in `docs/BUGS.md`, 17 marked fixed. The table there carries role, steps, expected, actual and where each was fixed.

## Needs Joey

- Nothing from this run.
