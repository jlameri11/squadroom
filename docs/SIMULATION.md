# SPL Season 4 — the simulation

Last run: 2026-11-15 10:58 UTC · 6 rounds played · 20 PASS · 14 FIXED · 3 FAIL · 0 not run · 22 bugs logged (17 fixed) · 12 min so far

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
| FV11 | Field map, directions and "Field 3" shown correctly to every family affected | **FIXED** | 7/7 | — | 0276: apply_reschedule resolves the ground and field to the pitch; 0276: the field in the mirrored event's venue; a field change is a change families hear |
| FV9 | Ground closures announced Friday night and Saturday 7 am; a whole venue closed | **FIXED** | 11/11 | — | 0276: notify_referees_of_change |
| FV6 | A whole venue closed | **FIXED** | 1/1 | — | 0276: notify_referees_of_change |
| FV10 | Partial closure: one pitch only | **FIXED** | 2/2 | — | 0276: notify_referees_of_change |
| FV5 | A pitch changed on the morning | **FIXED** | 3/3 | — | 0276: apply_reschedule resolves the ground and field to the pitch; 0276: the field in the mirrored event's venue; a field change is a change families hear |
| FV7 | A game moved to another venue | **FIXED** | 4/4 | — | 0276: apply_reschedule resolves the ground and field to the pitch |
| FV8 | A late kick-off pushing later games — _a pitch with three games still to play: expected one, got none_ | **FAIL** | 0/1 | — | — |

### Weather & safety on the day

| # | Scenario | Result | Checks | Bugs | Fixed in |
|---|---|---|---|---|---|
| WS3 | Extreme heat → kick-offs moved earlier / drink breaks noted / a round postponed | **PASS** | 3/3 | — | — |
| WS1 | Wet-weather washout of a whole round: every game called off, every family, coach and referee told once, no duplicate pushes | **FIXED** | 6/6 | — | 0276: notify_referees_of_change |
| WS4 | Rescheduled games: a catch-up round, a mid-week reschedule, a double-header — _the other 140 games go to the catch-up round on 22 May: expected 140, got 101_ | **FAIL** | 3/4 | #18 | — |
| WS2 | Lightning suspension mid-game → resumed later the same day, and one abandoned | **PASS** | 7/7 | — | — |

### Results

| # | Scenario | Result | Checks | Bugs | Fixed in |
|---|---|---|---|---|---|
| R1 | Win, draw, loss; high scores; 0–0 | **PASS** | 7/7 | — | — |
| R2 | Matching scores → final; mismatched → dispute → the league rules → the ladder moves only then | **PASS** | 7/7 | — | — |
| R3 | Late result, missing result, a correction after the game, a result entered offline and synced later | **PASS** | 9/9 | — | — |
| R4 | Forfeit (coach → club → league), walkover, bye, abandoned with the score standing / replayed / awarded | **FIXED** | 11/11 | — | 0278: a forfeit is mirrored as a called-off game with its reason |

### On-field issues

| # | Scenario | Result | Checks | Bugs | Fixed in |
|---|---|---|---|---|---|
| OF6 | Wrong team sheet submitted, sheet after lock — only the referee or the league can change it, logged | **PASS** | 6/6 | — | — |
| OF4 | Referee no-show, late decline, club-supplied referee, under-18 referee, referee abused → report | **FIXED** | 17/17 | — | 0276: a report of abuse, an injury or an incident is pushed; 0276: referee_unavailable_reason |
| OF1 | Yellow cards accumulating to a suspension; a red card served across rounds; a blue card where the league uses it — _the referee records a red card (R2): expected allowed, got 22023: that player is not on this team's sheet for this game; a two-game suspension is raised at once: expected 2 games, active, got []; the club is told the player is suspended: expected >0, got 0; the discipline officer's report lists the sending-off: expected the player in the report, got listed_ | **FAIL** | 4/8 | #19, #20, #21, #22 | — |
| OF2 | Suspended or ineligible player on a sheet → refused by name; playing up within the rules, and over the cap → refused | **PASS** | 6/6 | — | — |
| OF3 | Team short of players (minimum numbers), borrowing players, a team that doesn't turn up | **FIXED** | 3/3 | — | 0276: competition_divisions.squad_size_min |

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

## The load

Over the run: 12 league notices, 72 club messages, 1440 chat lines, 720 reactions, 60 polls, 240 scheduled messages, 18678 RSVPs, 917 referee appointments, 1684 team sheets, 607 results agreed on the sheets, 52 disputes (53 ruled on), 12 late results, 148 cards.

| Round | Date | Games | Notifications queued | Sent | Texts | By kind |
|---|---|---|---|---|---|---|
| 1 | 2027-02-06 | 145 | 48660 | 47609 | 0 | event_reminder 46510, message 1017, match_day 289, team_sheet_due 289, entry_fee_owed 250, helper_reminder 146 |
| 2 | 2027-02-13 | 145 | 49489 | 49489 | 0 | event_reminder 38666, message 7353, announcement 2615, team_sheet_due 289, match_day 289, helper_reminder 152 |
| 3 | 2027-02-20 | 145 | 77394 | 75316 | 2185 | event_reminder 45100, announcement 19481, message 7362, event_back_on 2040, event_cancelled 2040, team_sheet_due 289 |
| 4 | 2027-02-27 | 145 | 76108 | 74562 | 7705 | event_reminder 38952, announcement 11267, event_back_on 9077, event_cancelled 7560, message 7356, fee_overdue 402 |
| 5 | 2027-03-06 | 150 | 68601 | 68548 | 159 | event_reminder 46722, announcement 11267, message 7333, event_back_on 1569, fee_overdue 402, match_day 298 |
| 6 | 2027-03-13 | 145 | 105990 | 105990 | 0 | event_reminder 85411, announcement 11131, message 7299, fee_overdue 603, team_sheet_due 289, match_day 289 |

## Bugs

22 logged in `docs/BUGS.md`, 17 marked fixed. The table there carries role, steps, expected, actual and where each was fixed.

## Needs Joey

- Nothing from this run.
