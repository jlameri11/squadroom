# SPL Season 4 — the simulation

Last run: 2026-11-16 00:15 UTC · 19 rounds played · 30 PASS · 19 FIXED · 4 FAIL · 0 not run · 24 bugs logged (17 fixed) · 24 min so far

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
| WS4 | Rescheduled games: a catch-up round, a mid-week reschedule, a double-header — _the other 140 games go to the catch-up round on 22 May at their own times (or later that day): expected 140, got 112 moved; refused: {"Field # is booked # (Coral Bay United U# Red v Fernleigh FC U# Red)"_ | **FAIL** | 3/4 | #18 | — |
| WS2 | Lightning suspension mid-game → resumed later the same day, and one abandoned | **PASS** | 7/7 | — | — |

### Results

| # | Scenario | Result | Checks | Bugs | Fixed in |
|---|---|---|---|---|---|
| R1 | Win, draw, loss; high scores; 0–0 | **PASS** | 7/7 | — | — |
| R2 | Matching scores → final; mismatched → dispute → the league rules → the ladder moves only then | **PASS** | 7/7 | — | — |
| R3 | Late result, missing result, a correction after the game, a result entered offline and synced later | **PASS** | 9/9 | — | — |
| R4 | Forfeit (coach → club → league), walkover, bye, abandoned with the score standing / replayed / awarded | **FIXED** | 11/11 | — | 0278: a forfeit is mirrored as a called-off game with its reason |
| R5 | Points deduction, ladder ties (goal difference, goals for, head-to-head), hidden scores and no ladder for U9 | **FIXED** | 8/8 | — | 0278: competition_ladder returns nothing for a division whose ladder is off, except to the league |
| R6 | Finals: eligibility (minimum games), semi-finals, a grand final, extra time and penalties recorded | **FIXED** | 6/6 | — | 0276: create_finals(p_top => 4, p_final_at), rule_on_score(p_pens_home, p_pens_away) |

### On-field issues

| # | Scenario | Result | Checks | Bugs | Fixed in |
|---|---|---|---|---|---|
| OF6 | Wrong team sheet submitted, sheet after lock — only the referee or the league can change it, logged | **PASS** | 6/6 | — | — |
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
| OFF7c | Games around midnight land on the right day | **PASS** | 5/5 | — | — |

### People & messaging

| # | Scenario | Result | Checks | Bugs | Fixed in |
|---|---|---|---|---|---|
| PM3 | Busy team chats with replies, reactions, photos and polls | **PASS** | 4/4 | — | — |
| PM5 | Quiet hours and the digest respected | **PASS** | 3/3 | — | — |
| PM4 | Scheduled messages go at their time, not before | **PASS** | 4/4 | — | — |
| PM6 | No message sent twice; late messages not sent | **PASS** | 9/9 | — | — |
| PM1 | Notices to everyone / club staff only | **PASS** | 8/8 | — | — |
| PM2 | Club messages to thousands | **PASS** | 6/6 | — | — |

### Past seasons

| # | Scenario | Result | Checks | Bugs | Fixed in |
|---|---|---|---|---|---|
| PS1 | Past seasons are always visitable: nothing deleted, read-only, reachable from the match centre, the competition page, Fixtures and a team's history — _Season 4's public page still shows every game, the finals and the ladders: expected >2000 games, ≥4 finals, ≥20 ladders, got 2010 games, 3 finals, 30 ladders_ | **FAIL** | 21/22 | #19 | — |
| HH1 | Head to head on every match: only the two teams' meetings in the season the game belongs to, a summary and the list; past seasons stay behind the switcher — _a MiniRoos head to head shows the meetings without scores: expected played, no scores, got 0 meetings, scores hidden_ | **FAIL** | 6/7 | #20 | — |

### Screens

| # | Scenario | Result | Checks | Bugs | Fixed in |
|---|---|---|---|---|---|
| SC1 | Screens after the draw: Home, Fixtures, the game page, the ladder, chats and notices as nine people see them | **FIXED** | 105/105 | — | 0278: staff_reads_channel — staff read team, age-group, coaches, club-wide and custom chats, never a direct one; 0278: team managers stand with the staff for a competition's Notices |
| SC3 | Screens with a result in dispute: no score stands, the league sees the dispute, the ladder waits | **FIXED** | 129/129 | — | 0278: staff_reads_channel — staff read team, age-group, coaches, club-wide and custom chats, never a direct one; 0278: team managers stand with the staff for a competition's Notices |
| SC2 | Screens on a washout Saturday: every called-off game reads as off to the families, the coach, the league and the referee | **PASS** | 121/121 | — | — |
| SC4 | Screens after a suspension: the coach and the club see it, the league's discipline page lists it | **PASS** | 130/130 | — | — |
| SC5 | Screens at the finals: the grand finals, the finished ladders, the champions | **PASS** | 102/102 | — | — |
| SC6 | Screens in Season 5: the season switcher, last season's page and ladders in full, head to head for this season — _parent: no page errors: expected none, got Minified React error #441; visit https://react.dev/errors/441 for the full message or use ; parent: a public game page shows this season's head to head and nothing from 2027: expected Head to head · 2028, got This page couldn’t load A server error occurred. Reload to try again. Reload ERROR 1988402; league organiser: no page errors: expected none, got Minified React error #441; visit https://react.dev/errors/441 for the full message or use ; league organiser: a public game page shows this season's head to head and nothing from 2027: expected Head to head · 2028, got This page couldn’t load A server error occurred. Reload to try again. Reload ERROR 1988402_ | **FAIL** | 119/123 | #21, #22, #23, #24 | — |

## The load

Over the run: 38 league notices, 228 club messages, 4064 chat lines, 2032 reactions, 170 polls, 760 scheduled messages, 58538 RSVPs, 2426 referee appointments, 4699 team sheets, 2005 results agreed on the sheets, 165 disputes (166 ruled on), 59 late results, 411 cards.

| Round | Date | Games | Notifications queued | Sent | Texts | By kind |
|---|---|---|---|---|---|---|
| 1 | 2027-02-06 | 145 | 75554 | 74503 | 0 | event_reminder 54358, announcement 12083, message 7530, entry_fee_owed 510, team_sheet_due 289, match_day 289 |
| 2 | 2027-02-13 | 145 | 58825 | 58825 | 0 | event_reminder 38666, announcement 11675, message 7354, match_day 289, team_sheet_due 289, referee_appointment 153 |
| 3 | 2027-02-20 | 145 | 77514 | 75436 | 2293 | event_reminder 45100, announcement 19481, message 7364, event_back_on 2040, event_cancelled 2040, team_sheet_due 289 |
| 4 | 2027-02-27 | 145 | 75785 | 75145 | 7705 | event_reminder 38952, announcement 11267, event_back_on 8763, event_cancelled 7560, message 7356, fee_overdue 402 |
| 5 | 2027-03-06 | 150 | 67707 | 67654 | 159 | event_reminder 46722, announcement 11267, message 7335, event_back_on 680, fee_overdue 402, match_day 298 |
| 6 | 2027-03-13 | 145 | 66692 | 66692 | 0 | event_reminder 46512, announcement 11131, message 7300, team_sheet_due 289, match_day 289, entry_fee_owed 255 |
| 7 | 2027-03-20 | 145 | 107526 | 107526 | 0 | event_reminder 85044, announcement 10995, message 9372, fee_overdue 804, match_day 289, team_sheet_due 289 |
| 8 | 2027-03-27 | 145 | 28060 | 28056 | 0 | announcement 11677, event_reminder 7980, message 7380, team_sheet_due 289, match_day 289, referee_appointment 151 |
| 9 | 2027-04-03 | 145 | 75832 | 75823 | 0 | event_reminder 46520, announcement 20300, message 7366, fee_overdue 603, match_day 289, team_sheet_due 289 |
| 10 | 2027-04-10 | 141 | 66723 | 66716 | 0 | event_reminder 46152, announcement 11948, message 7370, match_day 282, team_sheet_due 282, entry_fee_owed 255 |
| 11 | 2027-04-24 | 138 | 98071 | 98060 | 0 | event_reminder 77130, announcement 11472, message 7360, fee_overdue 603, match_day 274, team_sheet_due 274 |
| 12 | 2027-05-01 | 138 | 65901 | 65890 | 0 | event_reminder 45734, announcement 11268, message 7313, fee_overdue 603, match_day 274, team_sheet_due 274 |
| 13 | 2027-05-08 | 138 | 74080 | 74072 | 0 | event_reminder 45836, announcement 19724, message 7294, team_sheet_due 274, match_day 274, entry_fee_owed 255 |
| 14 | 2027-05-15 | 138 | 65878 | 65873 | 0 | event_reminder 45732, announcement 11268, message 7290, fee_overdue 603, match_day 274, team_sheet_due 274 |
| 15 | 2027-05-22 | 164 | 58277 | 58270 | 0 | event_reminder 39273, announcement 11030, message 7358, match_day 305, entry_fee_owed 255, discipline_suspension 35 |
| 16 | 2027-05-29 | 8 | 50661 | 50656 | 0 | event_reminder 31396, announcement 11270, message 7364, fee_overdue 603, wwcc_expiring 12, referee_appointment 8 |
| 17 | 2027-06-05 | 4 | 51016 | 51010 | 0 | event_reminder 31396, announcement 11985, message 7360, entry_fee_owed 255, match_correction_requested 6, discipline_suspension 5 |
| 18 | 2028-02-05 | 144 | 52353 | 52352 | 0 | event_changed 22012, event_reminder 15050, announcement 11458, entry_fee_owed 1495, message 881, fee_overdue 603 |
| 19 | 2028-02-12 | 144 | 27911 | 27911 | 0 | event_reminder 15054, announcement 11117, message 881, match_day 278, team_sheet_due 278, referee_appointment 155 |

## The peak

Round 7, Saturday 10 am (2027-03-20 10:00 Sat): 2000 parents open the app (Home's six calls; four in ten open their chat; one in ten Fixtures) while 74 games take kick-offs, goals and chat lines, through a pool of 15 — 14466 calls in 42.4 s, 341 calls a second. An open of Home costs 286.6 ms of database time under this load.

| call | n | p50 ms | p95 ms | p99 ms |
|---|---|---|---|---|
| channel_screen | 800 | 6.2 | 12.4 | 15.0 |
| chat: line | 370 | 6.1 | 7.6 | 9.6 |
| fixtures_screen | 200 | 7.9 | 15.5 | 18.1 |
| home_competitions | 2000 | 249.9 | 279.6 | 290.8 |
| home_jobs | 2000 | 13.4 | 21.8 | 27.1 |
| home_layout | 2000 | 0.3 | 8.3 | 10.8 |
| home_screen | 2000 | 11.3 | 21.3 | 26.3 |
| live: goal | 296 | 6.0 | 7.3 | 9.2 |
| mark_channel_read | 800 | 0.4 | 5.1 | 7.8 |
| nav_badges | 2000 | 4.6 | 12.1 | 16.0 |
| needs_you | 2000 | 0.8 | 6.3 | 8.6 |

The league's and the clubs' screens at that moment (Postgres execution time, median of 3):

| as | screen | median ms |
|---|---|---|
| league | home_jobs | 3.1 |
| league | competition_run_sheet | 104.5 ◀ |
| league | competition_ladder | 0.5 |
| league | competition_appointments | 38.3 |
| league | admin_hub | 0.1 |
| coach | home_jobs | 21.3 |
| owner (biggest club) | home_jobs | 3.2 |
| owner (biggest club) | admin_hub | 0.2 |
| owner (biggest club) | outstanding_fees | 0.4 |
| stranger | public_competition_entry | 0.1 |

## Bugs

24 logged in `docs/BUGS.md`, 17 marked fixed. The table there carries role, steps, expected, actual and where each was fixed.

## Needs Joey

- A withdrawn team and a finished season show on the ladder and the match centre without a label yet (the data is marked; the screens could say "withdrew" and "final").
