# SPL Season 4 — the simulation

Last run: 2026-11-15 11:03 UTC · 12 rounds played · 24 PASS · 17 FIXED · 5 FAIL · 0 not run · 25 bugs logged (17 fixed) · 17 min so far

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
| R5 | Points deduction, ladder ties (goal difference, goals for, head-to-head), hidden scores and no ladder for U9 | **FIXED** | 8/8 | — | 0278: competition_ladder returns nothing for a division whose ladder is off, except to the league |

### On-field issues

| # | Scenario | Result | Checks | Bugs | Fixed in |
|---|---|---|---|---|---|
| OF6 | Wrong team sheet submitted, sheet after lock — only the referee or the league can change it, logged | **PASS** | 6/6 | — | — |
| OF4 | Referee no-show, late decline, club-supplied referee, under-18 referee, referee abused → report | **FIXED** | 17/17 | — | 0276: a report of abuse, an injury or an incident is pushed; 0276: referee_unavailable_reason |
| OF1 | Yellow cards accumulating to a suspension; a red card served across rounds; a blue card where the league uses it — _the referee records a red card (R2): expected allowed, got 22023: that player is not on this team's sheet for this game; a two-game suspension is raised at once: expected 2 games, active, got []; the club is told the player is suspended: expected >0, got 0; the discipline officer's report lists the sending-off: expected the player in the report, got listed; after 3 games without them the ban reads served 2 (done): expected served 2, served, got {"games":2,"served":0,"status":"active"}_ | **FAIL** | 7/12 | #19, #20, #21, #22, #25 | — |
| OF2 | Suspended or ineligible player on a sheet → refused by name; playing up within the rules, and over the cap → refused — _a third game played up is over the division's cap of two — refused (1 on record before this sheet): expected refused, got allowed: "6b9259dc-b108-40c7-b40b-2f0b41d837ea"_ | **FAIL** | 7/8 | #23 | — |
| OF3 | Team short of players (minimum numbers), borrowing players, a team that doesn't turn up | **FIXED** | 3/3 | — | 0276: competition_divisions.squad_size_min |
| OF5 | Injury during a game → incident report → the welfare officer and the President | **FIXED** | 6/6 | — | 0276: incident_report pushes |

### Off-field issues

| # | Scenario | Result | Checks | Bugs | Fixed in |
|---|---|---|---|---|---|
| OFF5b | A club enters late | **PASS** | 5/5 | — | — |
| OFF7a | Daylight saving: the same kick-off time on the clock after the change | **FIXED** | 2/2 | — | 0276: round dates worked out in the competition's zone |
| OFF1 | Spectator or parent abuse → ban → the banned person can't RSVP, post or be on a sheet | **PASS** | 9/9 | — | — |
| OFF3 | A coach's WWCC expires mid-season → flagged and removed from coaching until renewed | **PASS** | 6/6 | — | — |
| OFF2 | Safeguarding: a coach DMs a child (parent added automatically), a message reported, an under-13 sign-up refused, a 13+ waits for parent approval | **PASS** | 16/16 | — | — |
| OFF6 | Volunteer roster gaps on Saturday; canteen and field-marshal swaps | **PASS** | 7/7 | — | — |
| OFF7b | A public-holiday round (Easter Saturday) | **PASS** | 3/3 | — | — |
| OFF4 | Payments: a failed card, a missed instalment, a refund on withdrawal, a voucher used, an unpaid entry fee chased — _a club treasurer sees what their club owes the league: expected owed fees listed, got []_ | **FAIL** | 17/18 | #24 | 0276: queue_entry_fee_reminders (every fortnight after 14 days) |
| OFF5a | A team withdraws mid-season: fixtures, ladder and opponents handled | **FIXED** | 6/6 | — | 0276: withdraw_entry; a bye is mirrored as a called-off game |

### People & messaging

| # | Scenario | Result | Checks | Bugs | Fixed in |
|---|---|---|---|---|---|
| PM3 | Busy team chats with replies, reactions, photos and polls | **PASS** | 4/4 | — | — |
| PM5 | Quiet hours and the digest respected | **PASS** | 3/3 | — | — |
| PM4 | Scheduled messages go at their time, not before | **PASS** | 4/4 | — | — |
| PM6 | No message sent twice; late messages not sent | **PASS** | 9/9 | — | — |
| PM1 | Notices to everyone / club staff only | **PASS** | 8/8 | — | — |

## The load

Over the run: 24 league notices, 144 club messages, 2876 chat lines, 1438 reactions, 120 polls, 480 scheduled messages, 36994 RSVPs, 1819 referee appointments, 3282 team sheets, 1363 results agreed on the sheets, 115 disputes (116 ruled on), 40 late results, 307 cards.

| Round | Date | Games | Notifications queued | Sent | Texts | By kind |
|---|---|---|---|---|---|---|
| 1 | 2027-02-06 | 145 | 48660 | 47609 | 0 | event_reminder 46510, message 1017, match_day 289, team_sheet_due 289, entry_fee_owed 250, helper_reminder 146 |
| 2 | 2027-02-13 | 145 | 49489 | 49489 | 0 | event_reminder 38666, message 7353, announcement 2615, team_sheet_due 289, match_day 289, helper_reminder 152 |
| 3 | 2027-02-20 | 145 | 77394 | 75316 | 2185 | event_reminder 45100, announcement 19481, message 7362, event_back_on 2040, event_cancelled 2040, team_sheet_due 289 |
| 4 | 2027-02-27 | 145 | 76108 | 74562 | 7705 | event_reminder 38952, announcement 11267, event_back_on 9077, event_cancelled 7560, message 7356, fee_overdue 402 |
| 5 | 2027-03-06 | 150 | 68601 | 68548 | 159 | event_reminder 46722, announcement 11267, message 7333, event_back_on 1569, fee_overdue 402, match_day 298 |
| 6 | 2027-03-13 | 145 | 105990 | 105990 | 0 | event_reminder 85411, announcement 11131, message 7299, fee_overdue 603, team_sheet_due 289, match_day 289 |
| 7 | 2027-03-20 | 145 | 50524 | 50524 | 0 | event_reminder 46145, message 2856, fee_overdue 402, match_day 289, team_sheet_due 289, entry_fee_owed 257 |
| 8 | 2027-03-27 | 145 | 9761 | 9759 | 0 | event_reminder 7980, message 912, match_day 289, team_sheet_due 289, helper_reminder 140, announcement 131 |
| 9 | 2027-04-03 | 145 | 75830 | 75821 | 0 | event_reminder 46520, announcement 20300, message 7364, fee_overdue 603, match_day 289, team_sheet_due 289 |
| 10 | 2027-04-10 | 141 | 66737 | 66730 | 0 | event_reminder 46152, announcement 11948, message 7372, match_day 282, team_sheet_due 282, entry_fee_owed 257 |
| 11 | 2027-04-24 | 138 | 98147 | 98136 | 0 | event_reminder 77130, announcement 11472, message 7359, fee_overdue 603, event_cancelled 312, team_sheet_due 274 |
| 12 | 2027-05-01 | 138 | 65908 | 65897 | 0 | event_reminder 45734, announcement 11268, message 7314, fee_overdue 603, match_day 274, team_sheet_due 274 |

## The peak

Round 7, Saturday 10 am (2027-03-20 10:00 Sat): 2000 parents open the app (Home's six calls; four in ten open their chat; one in ten Fixtures) while 74 games take kick-offs, goals and chat lines, through a pool of 15 — 14466 calls in 43.6 s, 332 calls a second. An open of Home costs 295.6 ms of database time under this load.

| call | n | p50 ms | p95 ms | p99 ms |
|---|---|---|---|---|
| channel_screen | 800 | 5.8 | 11.8 | 14.2 |
| chat: line | 370 | 6.0 | 8.2 | 10.1 |
| fixtures_screen | 200 | 7.7 | 14.6 | 18.0 |
| home_competitions | 2000 | 257.6 | 290.0 | 322.6 |
| home_jobs | 2000 | 13.5 | 22.8 | 29.9 |
| home_layout | 2000 | 0.4 | 8.1 | 11.4 |
| home_screen | 2000 | 12.0 | 22.7 | 29.8 |
| live: goal | 296 | 5.8 | 7.5 | 10.0 |
| mark_channel_read | 800 | 0.4 | 4.8 | 8.2 |
| nav_badges | 2000 | 4.6 | 12.1 | 16.2 |
| needs_you | 2000 | 0.8 | 5.9 | 8.7 |

The league's and the clubs' screens at that moment (Postgres execution time, median of 3):

| as | screen | median ms |
|---|---|---|
| league | home_jobs | 3.2 |
| league | competition_run_sheet | 104.7 ◀ |
| league | competition_ladder | 0.5 |
| league | competition_appointments | 38.0 |
| league | admin_hub | 0.1 |
| coach | home_jobs | 22.4 |
| owner (biggest club) | home_jobs | 3.8 |
| owner (biggest club) | admin_hub | 0.2 |
| owner (biggest club) | outstanding_fees | 0.5 |
| stranger | public_competition_entry | 0.1 |

## Bugs

25 logged in `docs/BUGS.md`, 17 marked fixed. The table there carries role, steps, expected, actual and where each was fixed.

## Needs Joey

- Nothing from this run.
