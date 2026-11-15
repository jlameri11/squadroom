# SPL Season 4 — the simulation

Last run: 2026-11-15 11:47 UTC · 12 rounds played · 26 PASS · 18 FIXED · 2 FAIL · 0 not run · 20 bugs logged (17 fixed) · 17 min so far

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
| FV8 | A late kick-off pushing later games | **PASS** | 3/3 | — | — |

### Weather & safety on the day

| # | Scenario | Result | Checks | Bugs | Fixed in |
|---|---|---|---|---|---|
| WS3 | Extreme heat → kick-offs moved earlier / drink breaks noted / a round postponed | **PASS** | 3/3 | — | — |
| WS1 | Wet-weather washout of a whole round: every game called off, every family, coach and referee told once, no duplicate pushes | **FIXED** | 6/6 | — | 0276: notify_referees_of_change |
| WS4 | Rescheduled games: a catch-up round, a mid-week reschedule, a double-header — _the other 140 games go to the catch-up round on 22 May at their own times: expected 140, got 101 moved; refused: {"Harvey Reyes is on Gumtree United U# Red v Seacliff FC U# Red at # (_ | **FAIL** | 3/4 | #20 | — |
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
| OF6 | Wrong team sheet submitted, sheet after lock — only the referee or the league can change it, logged — _the referee can change it after the lock: expected allowed, got 42501: only the team's manager or coach can submit its sheet; the change after the lock is logged as an official's: expected ≥1, got 0_ | **FAIL** | 4/6 | #18, #19 | — |
| OF4 | Referee no-show, late decline, club-supplied referee, under-18 referee, referee abused → report | **FIXED** | 17/17 | — | 0276: a report of abuse, an injury or an incident is pushed; 0276: referee_unavailable_reason |
| OF2 | Suspended or ineligible player on a sheet → refused by name; playing up within the rules, and over the cap → refused | **PASS** | 9/9 | — | — |
| OF3 | Team short of players (minimum numbers), borrowing players, a team that doesn't turn up | **FIXED** | 3/3 | — | 0276: competition_divisions.squad_size_min |
| OF1 | Yellow cards accumulating to a suspension; a red card served across rounds; a blue card where the league uses it | **PASS** | 21/21 | — | — |
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
| OFF4 | Payments: a failed card, a missed instalment, a refund on withdrawal, a voucher used, an unpaid entry fee chased | **FIXED** | 18/18 | — | 0276: queue_entry_fee_reminders (every fortnight after 14 days) |
| OFF5a | A team withdraws mid-season: fixtures, ladder and opponents handled | **FIXED** | 6/6 | — | 0276: withdraw_entry; a bye is mirrored as a called-off game |

### People & messaging

| # | Scenario | Result | Checks | Bugs | Fixed in |
|---|---|---|---|---|---|
| PM3 | Busy team chats with replies, reactions, photos and polls | **PASS** | 4/4 | — | — |
| PM5 | Quiet hours and the digest respected | **PASS** | 3/3 | — | — |
| PM4 | Scheduled messages go at their time, not before | **PASS** | 4/4 | — | — |
| PM6 | No message sent twice; late messages not sent | **PASS** | 9/9 | — | — |
| PM1 | Notices to everyone / club staff only | **PASS** | 8/8 | — | — |

### Screens

| # | Scenario | Result | Checks | Bugs | Fixed in |
|---|---|---|---|---|---|
| SC1 | Screens after the draw: Home, Fixtures, the game page, the ladder, chats and notices as nine people see them | **FIXED** | 105/105 | — | 0278: staff_reads_channel — staff read team, age-group, coaches, club-wide and custom chats, never a direct one; 0278: team managers stand with the staff for a competition's Notices |
| SC3 | Screens with a result in dispute: no score stands, the league sees the dispute, the ladder waits | **FIXED** | 129/129 | — | 0278: staff_reads_channel — staff read team, age-group, coaches, club-wide and custom chats, never a direct one; 0278: team managers stand with the staff for a competition's Notices |
| SC2 | Screens on a washout Saturday: every called-off game reads as off to the families, the coach, the league and the referee | **PASS** | 129/129 | — | — |
| SC4 | Screens after a suspension: the coach and the club see it, the league's discipline page lists it | **PASS** | 130/130 | — | — |

## The load

Over the run: 24 league notices, 144 club messages, 2876 chat lines, 1438 reactions, 120 polls, 480 scheduled messages, 37230 RSVPs, 1823 referee appointments, 3289 team sheets, 1345 results agreed on the sheets, 108 disputes (109 ruled on), 63 late results, 289 cards.

| Round | Date | Games | Notifications queued | Sent | Texts | By kind |
|---|---|---|---|---|---|---|
| 1 | 2027-02-06 | 145 | 48670 | 47619 | 0 | event_reminder 46510, message 1017, match_day 289, team_sheet_due 289, entry_fee_owed 255, helper_reminder 146 |
| 2 | 2027-02-13 | 145 | 49453 | 49453 | 0 | event_reminder 38666, message 7354, announcement 2615, team_sheet_due 289, match_day 289, helper_reminder 152 |
| 3 | 2027-02-20 | 145 | 77504 | 75425 | 2294 | event_reminder 45100, announcement 19481, message 7365, event_back_on 2040, event_cancelled 2040, team_sheet_due 289 |
| 4 | 2027-02-27 | 145 | 76101 | 74555 | 7705 | event_reminder 38952, announcement 11267, event_back_on 9077, event_cancelled 7560, message 7357, fee_overdue 402 |
| 5 | 2027-03-06 | 150 | 68614 | 68561 | 159 | event_reminder 46722, announcement 11267, message 7334, event_back_on 1569, fee_overdue 402, match_day 298 |
| 6 | 2027-03-13 | 145 | 66679 | 66679 | 0 | event_reminder 46512, announcement 11131, message 7298, team_sheet_due 289, match_day 289, entry_fee_owed 255 |
| 7 | 2027-03-20 | 145 | 107541 | 107541 | 0 | event_reminder 85044, announcement 10995, message 9372, fee_overdue 804, match_day 289, team_sheet_due 289 |
| 8 | 2027-03-27 | 145 | 9788 | 9786 | 0 | event_reminder 7980, message 912, match_day 289, team_sheet_due 289, helper_reminder 142, announcement 131 |
| 9 | 2027-04-03 | 145 | 75840 | 75831 | 0 | event_reminder 46520, announcement 20300, message 7366, fee_overdue 603, match_day 289, team_sheet_due 289 |
| 10 | 2027-04-10 | 141 | 66717 | 66710 | 0 | event_reminder 46152, announcement 11948, message 7372, match_day 282, team_sheet_due 282, entry_fee_owed 255 |
| 11 | 2027-04-24 | 138 | 98136 | 98125 | 0 | event_reminder 77130, announcement 11472, message 7358, fee_overdue 603, event_cancelled 312, team_sheet_due 274 |
| 12 | 2027-05-01 | 138 | 65907 | 65895 | 0 | event_reminder 45734, announcement 11268, message 7315, fee_overdue 603, match_day 274, team_sheet_due 274 |

## The peak

Round 7, Saturday 10 am (2027-03-20 10:00 Sat): 2000 parents open the app (Home's six calls; four in ten open their chat; one in ten Fixtures) while 74 games take kick-offs, goals and chat lines, through a pool of 15 — 14466 calls in 42.5 s, 340 calls a second. An open of Home costs 287.6 ms of database time under this load.

| call | n | p50 ms | p95 ms | p99 ms |
|---|---|---|---|---|
| channel_screen | 800 | 5.9 | 12.0 | 14.8 |
| chat: line | 370 | 6.0 | 8.3 | 10.2 |
| fixtures_screen | 200 | 8.0 | 14.0 | 20.8 |
| home_competitions | 2000 | 249.9 | 283.1 | 300.4 |
| home_jobs | 2000 | 13.3 | 21.8 | 28.1 |
| home_layout | 2000 | 0.4 | 7.9 | 11.1 |
| home_screen | 2000 | 11.4 | 21.7 | 27.9 |
| live: goal | 296 | 5.8 | 7.8 | 9.2 |
| mark_channel_read | 800 | 0.4 | 5.0 | 7.5 |
| nav_badges | 2000 | 4.6 | 11.8 | 14.8 |
| needs_you | 2000 | 0.8 | 6.0 | 9.3 |

The league's and the clubs' screens at that moment (Postgres execution time, median of 3):

| as | screen | median ms |
|---|---|---|
| league | home_jobs | 3.0 |
| league | competition_run_sheet | 104.0 ◀ |
| league | competition_ladder | 0.4 |
| league | competition_appointments | 38.0 |
| league | admin_hub | 0.1 |
| coach | home_jobs | 21.3 |
| owner (biggest club) | home_jobs | 3.2 |
| owner (biggest club) | admin_hub | 0.2 |
| owner (biggest club) | outstanding_fees | 0.5 |
| stranger | public_competition_entry | 0.1 |

## Bugs

20 logged in `docs/BUGS.md`, 17 marked fixed. The table there carries role, steps, expected, actual and where each was fixed.

## Needs Joey

- Nothing from this run.
