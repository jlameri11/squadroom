# SPL Season 4 — the simulation

Last run: 2026-11-15 10:36 UTC · 13 rounds played · 21 PASS · 9 FIXED · 14 FAIL · 4 not run · 40 bugs logged (13 fixed) · 18 min so far

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
| FV11 | Field map, directions and "Field 3" shown correctly to every family affected | **FIXED** | 22/22 | — | 0276: apply_reschedule resolves the ground and field to the pitch; 0276: the field in the mirrored event's venue; a field change is a change families hear |
| FV9 | Ground closures announced Friday night and Saturday 7 am; a whole venue closed | **FIXED** | 11/11 | — | 0276: notify_referees_of_change |
| FV6 | A whole venue closed | **FIXED** | 1/1 | — | 0276: notify_referees_of_change |
| FV10 | Partial closure: one pitch only | **FIXED** | 2/2 | — | 0276: notify_referees_of_change |
| FV5 | A pitch changed on the morning | **NOT RUN** | — | — | 0276: apply_reschedule resolves the ground and field to the pitch; 0276: the field in the mirrored event's venue; a field change is a change families hear |
| FV7 | A game moved to another venue | **NOT RUN** | — | — | 0276: apply_reschedule resolves the ground and field to the pitch |
| FV8 | A late kick-off pushing later games | **NOT RUN** | — | — | — |

### Weather & safety on the day

| # | Scenario | Result | Checks | Bugs | Fixed in |
|---|---|---|---|---|---|
| WS3 | Extreme heat → kick-offs moved earlier / drink breaks noted / a round postponed | **PASS** | 3/3 | — | — |
| WS1 | Wet-weather washout of a whole round: every game called off, every family, coach and referee told once, no duplicate pushes | **FIXED** | 6/6 | — | 0276: notify_referees_of_change |
| WS4 | Rescheduled games: a catch-up round, a mid-week reschedule, a double-header — _the double-header shows in the draw's sanity check: expected a double header on 2027-03-06, got []_ | **FAIL** | 3/4 | #25 | — |
| WS2 | Lightning suspension mid-game → resumed later the same day, and one abandoned — _the suspended game is moved to the afternoon on the same pitch: expected allowed, got 23P01: Field 1 Q1 is not open then — its hours are set in the venue layout; both squads hear the new time at once: expected >0, got 0_ | **FAIL** | 7/9 | #27, #26 | — |

### Results

| # | Scenario | Result | Checks | Bugs | Fixed in |
|---|---|---|---|---|---|
| R1 | Win, draw, loss; high scores; 0–0 | **PASS** | 7/7 | — | — |
| R2 | Matching scores → final; mismatched → dispute → the league rules → the ladder moves only then | **PASS** | 4/4 | — | — |
| R3 | Late result, missing result, a correction after the game, a result entered offline and synced later | **PASS** | 4/4 | — | — |
| R4 | Forfeit (coach → club → league), walkover, bye, abandoned with the score standing / replayed / awarded — _both squads' families hear the game is off (forfeit): expected >0, got 0_ | **FAIL** | 8/9 | #26 | — |
| R5 | Points deduction, ladder ties (goal difference, goals for, head-to-head), hidden scores and no ladder for U9 — _a U9 family sees no ladder (ladder_enabled off): expected empty, got 8 rows_ | **FAIL** | 7/8 | #40 | — |

### On-field issues

| # | Scenario | Result | Checks | Bugs | Fixed in |
|---|---|---|---|---|---|
| OF6 | Wrong team sheet submitted, sheet after lock — only the referee or the league can change it, logged | **PASS** | 2/2 | — | — |
| OF4 | Referee no-show, late decline, club-supplied referee, under-18 referee, referee abused → report | **FIXED** | 2/2 | — | 0276: a report of abuse, an injury or an incident is pushed; 0276: referee_unavailable_reason |
| OF1 | Yellow cards accumulating to a suspension; a red card served across rounds; a blue card where the league uses it | **PASS** | 8/8 | — | — |
| OF2 | Suspended or ineligible player on a sheet → refused by name; playing up within the rules, and over the cap → refused | **NOT RUN** | — | — | — |
| OF3 | Team short of players (minimum numbers), borrowing players, a team that doesn't turn up — _borrowing a player from a lower squad worked (see OF2): expected a borrowed player on a sheet, got no_ | **FAIL** | 2/3 | #31 | 0276: competition_divisions.squad_size_min |
| OF5 | Injury during a game → incident report → the welfare officer and the President | **FIXED** | 6/6 | — | 0276: incident_report pushes |

### Off-field issues

| # | Scenario | Result | Checks | Bugs | Fixed in |
|---|---|---|---|---|---|
| OFF5b | A club enters late | **PASS** | 5/5 | — | — |
| OFF7a | Daylight saving: the same kick-off time on the clock after the change | **FIXED** | 2/2 | — | 0276: round dates worked out in the competition's zone |
| OFF1 | Spectator or parent abuse → ban → the banned person can't RSVP, post or be on a sheet — _after this round's game without them, one of two games is served: expected served 1, active, got {"games":2,"served":0,"status":"active"}_ | **FAIL** | 11/12 | #32 | — |
| OFF3 | A coach's WWCC expires mid-season → flagged and removed from coaching until renewed | **PASS** | 6/6 | — | — |
| OFF2 | Safeguarding: a coach DMs a child (parent added automatically), a message reported, an under-13 sign-up refused, a 13+ waits for parent approval | **PASS** | 16/16 | — | — |
| OFF6 | Volunteer roster gaps on Saturday; canteen and field-marshal swaps — _the third yellow is recorded: expected allowed, got 22023: this game has ended; ask the league for a correction; three yellows: a one-game suspension: expected 1 game, active, got []_ | **FAIL** | 7/9 | #33, #34 | — |
| OFF7b | A public-holiday round (Easter Saturday) | **PASS** | 3/3 | — | — |
| OFF4 | Payments: a failed card, a missed instalment, a refund on withdrawal, a voucher used, an unpaid entry fee chased — _the 51 clubs whose entry fee is still owed in April have been reminded: expected ≥1 reminder, got 0 reminders; a club treasurer sees what their club owes the league: expected owed fees listed, got listed_ | **FAIL** | 16/18 | #37, #38 | 0276: queue_entry_fee_reminders (every fortnight after 14 days) |
| OFF5a | A team withdraws mid-season: fixtures, ladder and opponents handled — _the remaining games become byes; the played ones stand: expected 5 byes, 8 played, got 6 byes, 8 played_ | **FAIL** | 5/6 | #39 | 0276: withdraw_entry; a bye is mirrored as a called-off game |
| OFF7c | Games around midnight land on the right day | **PASS** | 5/5 | — | — |

### People & messaging

| # | Scenario | Result | Checks | Bugs | Fixed in |
|---|---|---|---|---|---|
| PM3 | Busy team chats with replies, reactions, photos and polls | **PASS** | 4/4 | — | — |
| PM5 | Quiet hours and the digest respected | **PASS** | 3/3 | — | — |
| PM4 | Scheduled messages go at their time, not before | **PASS** | 8/8 | — | — |
| PM6 | No message sent twice; late messages not sent — _two games missed: the red-card ban is served: expected served 2, served, got {"games":2,"served":1,"status":"active"}; with the ban served the player is accepted on the sheet again: expected allowed, got 22023: Amara Hughes is suspended — red card, 1 game still to serve_ | **FAIL** | 17/19 | #35, #36 | — |
| PM1 | Notices to everyone / club staff only | **PASS** | 8/8 | — | — |
| PM2 | Club messages to thousands | **PASS** | 6/6 | — | — |

## The load

Over the run: 26 league notices, 156 club messages, 3108 chat lines, 1554 reactions, 130 polls, 520 scheduled messages, 39974 RSVPs, 1958 referee appointments, 3446 team sheets, 1450 results agreed on the sheets, 142 disputes (143 ruled on), 61 late results, 289 cards.

| Round | Date | Games | Notifications queued | Sent | Texts | By kind |
|---|---|---|---|---|---|---|
| 1 | 2027-02-06 | 145 | 48405 | 47354 | 0 | event_reminder 46510, message 1017, match_day 289, team_sheet_due 289, helper_reminder 146, announcement 131 |
| 2 | 2027-02-13 | 145 | 49458 | 49458 | 0 | event_reminder 38666, message 7354, announcement 2615, team_sheet_due 289, match_day 289, helper_reminder 152 |
| 3 | 2027-02-20 | 145 | 74318 | 74318 | 2079 | event_reminder 45100, announcement 18581, message 7362, event_cancelled 2040, team_sheet_due 289, match_day 231 |
| 4 | 2027-02-27 | 145 | 73704 | 65999 | 7705 | event_reminder 38952, announcement 10667, event_back_on 7560, event_cancelled 7560, message 7356, fee_overdue 402 |
| 5 | 2027-03-06 | 149 | 74002 | 74002 | 53 | event_reminder 46774, announcement 10667, event_back_on 7560, message 7334, fee_overdue 402, match_day 298 |
| 6 | 2027-03-13 | 145 | 105107 | 105107 | 0 | event_reminder 85411, announcement 10531, message 7300, fee_overdue 603, team_sheet_due 289, match_day 289 |
| 7 | 2027-03-20 | 145 | 50287 | 50287 | 0 | event_reminder 46145, message 2856, fee_overdue 402, team_sheet_due 289, match_day 289, helper_reminder 137 |
| 8 | 2027-03-27 | 145 | 49097 | 49090 | 0 | event_reminder 46886, message 912, fee_overdue 402, team_sheet_due 289, match_day 289, helper_reminder 141 |
| 9 | 2027-04-03 | 145 | 9982 | 9981 | 0 | event_reminder 7980, message 912, match_day 289, team_sheet_due 289, fee_overdue 201, helper_reminder 150 |
| 10 | 2027-04-10 | 141 | 65867 | 65860 | 0 | event_reminder 46152, announcement 11348, message 7370, match_day 282, team_sheet_due 282, referee_appointment 144 |
| 11 | 2027-04-24 | 138 | 97202 | 97191 | 0 | event_reminder 77130, announcement 10872, message 7359, fee_overdue 603, match_day 274, team_sheet_due 274 |
| 12 | 2027-05-01 | 138 | 65314 | 65302 | 0 | event_reminder 45734, announcement 10668, message 7313, fee_overdue 603, match_day 274, team_sheet_due 274 |
| 13 | 2027-05-08 | 138 | 72911 | 72903 | 0 | event_reminder 45836, announcement 18824, message 7293, match_day 274, team_sheet_due 274, referee_appointment 145 |

## The peak

Round 7, Saturday 10 am (2027-03-20 10:00 Sat): 2000 parents open the app (Home's six calls; four in ten open their chat; one in ten Fixtures) while 74 games take kick-offs, goals and chat lines, through a pool of 15 — 14466 calls in 41.9 s, 345 calls a second. An open of Home costs 283.4 ms of database time under this load.

| call | n | p50 ms | p95 ms | p99 ms |
|---|---|---|---|---|
| channel_screen | 800 | 5.6 | 11.7 | 15.3 |
| chat: line | 370 | 6.0 | 8.0 | 11.6 |
| fixtures_screen | 200 | 7.8 | 14.7 | 17.8 |
| home_competitions | 2000 | 245.7 | 280.1 | 330.7 |
| home_jobs | 2000 | 13.2 | 21.9 | 27.3 |
| home_layout | 2000 | 0.3 | 8.1 | 11.8 |
| home_screen | 2000 | 11.1 | 21.7 | 26.6 |
| live: goal | 296 | 5.8 | 7.3 | 9.0 |
| mark_channel_read | 800 | 0.4 | 5.2 | 7.2 |
| nav_badges | 2000 | 4.4 | 11.7 | 16.0 |
| needs_you | 2000 | 0.8 | 6.1 | 10.3 |

The league's and the clubs' screens at that moment (Postgres execution time, median of 3):

| as | screen | median ms |
|---|---|---|
| league | home_jobs | 2.6 |
| league | competition_run_sheet | 101.6 ◀ |
| league | competition_ladder | 0.4 |
| league | competition_appointments | 36.3 |
| league | admin_hub | 0.1 |
| coach | home_jobs | 20.6 |
| owner (biggest club) | home_jobs | 3.2 |
| owner (biggest club) | admin_hub | 0.2 |
| owner (biggest club) | outstanding_fees | 0.4 |
| stranger | public_competition_entry | 0.1 |

## Bugs

40 logged in `docs/BUGS.md`, 13 marked fixed. The table there carries role, steps, expected, actual and where each was fixed.

## Needs Joey

- Nothing from this run.
