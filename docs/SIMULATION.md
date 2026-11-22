# SPL Season 4 — the simulation

Last run: 2026-11-22 11:14 UTC · 9 rounds played · 34 PASS · 25 FIXED · 1 FAIL · 0 not run · 36 bugs logged (34 fixed) · 17 min so far

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
| WS4 | Rescheduled games: a catch-up round, a mid-week reschedule, a double-header | **PASS** | 5/5 | — | — |
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
| OF2 | Suspended or ineligible player on a sheet → refused by name; playing up within the rules, and over the cap → refused | **PASS** | 9/9 | — | — |
| OF3 | Team short of players (minimum numbers), borrowing players, a team that doesn't turn up | **FIXED** | 3/3 | — | 0276: competition_divisions.squad_size_min |
| OF1 | Yellow cards accumulating to a suspension; a red card served across rounds; a blue card where the league uses it | **PASS** | 20/20 | — | — |
| OF5 | Injury during a game → incident report → the welfare officer and the President | **FIXED** | 6/6 | — | 0276: incident_report pushes |

### Off-field issues

| # | Scenario | Result | Checks | Bugs | Fixed in |
|---|---|---|---|---|---|
| OFF5b | A club enters late | **PASS** | 5/5 | — | — |
| OFF7a | Daylight saving: the same kick-off time on the clock after the change | **FIXED** | 1/1 | — | 0276: round dates worked out in the competition's zone |
| OFF1 | Spectator or parent abuse → ban → the banned person can't RSVP, post or be on a sheet | **PASS** | 9/9 | — | — |
| OFF3 | A coach's WWCC expires mid-season → flagged and removed from coaching until renewed | **PASS** | 6/6 | — | — |
| OFF2 | Safeguarding: a coach DMs a child (parent added automatically), a message reported, an under-13 sign-up refused, a 13+ waits for parent approval | **PASS** | 16/16 | — | — |
| OFF6 | Volunteer roster gaps on Saturday; canteen and field-marshal swaps | **PASS** | 7/7 | — | — |
| OFF7b | A public-holiday round (Easter Saturday) | **PASS** | 3/3 | — | — |

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

### Files & storage

| # | Scenario | Result | Checks | Bugs | Fixed in |
|---|---|---|---|---|---|
| FS1 | Chat photos through the real storage: a coach posts a photo in the squad chat, is warned who must not be in it, the squad sees it, nobody else can open it | **FIXED** | 10/10 | — | 0286: the read rule asks the same helper as the chat (staff_reads_channel) |
| FS2 | An iPhone HEIC photo in the chat: either it goes up as a picture everyone can see, or the sender is told at once what to do — never a broken image for the squad | **FIXED** | 2/2 | — | composer, notice composer and the match photos picker refuse a HEIC with the fix (Most Compatible / a screenshot) and accept JPEG, PNG, WebP and GIF so Safari converts on the way |
| FS3 | A file over the limit: refused on the phone with a sentence, nothing uploaded | **PASS** | 2/2 | — | — |
| FS4 | A PDF in the chat: the draw as a document, opened by a parent | **PASS** | 2/2 | — | — |
| FS6 | A registration photo: sent with the request, private to the club until approved, then on the player card for the family and nobody else | **PASS** | 10/10 | — | — |
| FS5 | Match photos: the coach adds them after the game and is warned who must not be in them; only the squad sees them; a family takes one down at once; the coach puts it back — _taken down, the squad cannot open it any more: expected refused, got 200; a parent cannot put it back: expected refused, got allowed: {"limit":60,"photos":[{"at":"2027-03-13T05:30:00+00:00","by":"Priya Brown","id":"_ | **FAIL** | 8/10 | #35, #36 | — |

### Joining mid-season

| # | Scenario | Result | Checks | Bugs | Fixed in |
|---|---|---|---|---|---|
| JF1 | 200+ new families join mid-season through the sign-up flow (coach link → create account → code → team): approved by the coach, each lands in the squad, the chat and the family's Fixtures | **FIXED** | 9/9 | — | 0283: join_requests_tell_the_coach (kind join_request) |
| JF2 | A family joins through the real screens at 375px: the coach's link, Create account, the code, the join form, waiting, then in after the coach approves | **PASS** | 7/7 | — | — |

### Role requests

| # | Scenario | Result | Checks | Bugs | Fixed in |
|---|---|---|---|---|---|
| RR1 | Role requests mid-season (team manager, volunteer, referee): asked from Settings, the committee told and the President's Home counting them, a check needed before approval, approved and declined, the person told | **PASS** | 21/21 | — | — |

### Two devices, two parents

| # | Scenario | Result | Checks | Bugs | Fixed in |
|---|---|---|---|---|---|
| TP1 | Two parents answer differently for the same child: one answer per child, the latest, everywhere the coach looks; each parent sees the family's answer | **FIXED** | 7/7 | — | 0283: the register takes the latest answer a child; 0283: one row a child, the latest, and who gave it; 0283: the family's latest answer with by_name; the Saturday view counts children, the manager's tile counts children, a parent's reply count counts children |
| TP2 | One person on two devices: an answer given on one phone is on the other after a refresh; a tap on each device leaves one answer, the latest | **FIXED** | 4/4 | — | event-detail.tsx: the answer buttons follow fresh data (content-keyed), an optimistic answer in flight left alone |

### Admin mistakes

| # | Scenario | Result | Checks | Bugs | Fixed in |
|---|---|---|---|---|---|
| AM1 | A wrong import undone: a roster import of the wrong file is undone in one tap and nothing else moves; a wrong draw import can be undone the same way | **FIXED** | 10/10 | — | 0285: undo_event_import(p_academy, p_team, p_refs) |
| AM2 | The draw re-published mid-season: played games, moved games and call-offs survive; only unplayed, unpinned games are redrawn, from today on; no pair meets more than the draw allows | **FIXED** | 7/7 | — | 0285: a pairing the division already has, whichever round, is drawn already |
| AM3 | A team deleted by mistake: a squad with players, games or money cannot be deleted outright — the club ends its season instead and nothing is lost | **FIXED** | 4/4 | — | 0285: teams_refuse_delete_with_history; the composite set-null keys named their column |

### Feature switches

| # | Scenario | Result | Checks | Bugs | Fixed in |
|---|---|---|---|---|---|
| SW1 | Feature switches off: the President turns every non-core feature off for the club; the switches hold, and a switched-off feature refuses through its functions, not only its screens | **FIXED** | 5/5 | — | 0285: each function refuses with a sentence; polls by a trigger |
| SW2 | Feature switches off: the composer, the game page, Settings, the Admin hub and Fixtures show nothing of a switched-off feature for that club — and another club still has them | **FIXED** | 15/15 | — | app/chat/[channelId]/composer.tsx: behind WhenOn polls |

### League setup

| # | Scenario | Result | Checks | Bugs | Fixed in |
|---|---|---|---|---|---|
| LS1 | A brand-new organiser starts a league from sign-up to a published draw: two divisions, sixteen teams, two venues — the checklist ticks itself from the data, and it takes under thirty minutes | **PASS** | 33/33 | — | — |

## The load

Over the run: 18 league notices, 108 club messages, 2156 chat lines, 1078 reactions, 90 polls, 358 scheduled messages, 31308 RSVPs, 1376 referee appointments, 2505 team sheets, 978 results agreed on the sheets, 91 disputes (92 ruled on), 28 late results, 198 cards.

| Round | Date | Games | Notifications queued | Sent | Texts | By kind |
|---|---|---|---|---|---|---|
| 1 | 2027-02-06 | 145 | 67427 | 66368 | 0 | event_reminder 46510, announcement 12083, message 7530, match_day 289, team_sheet_due 289, entry_fee_owed 271 |
| 2 | 2027-02-13 | 145 | 66652 | 66652 | 0 | event_reminder 46514, announcement 11675, message 7349, match_day 289, team_sheet_due 289, referee_appointment 153 |
| 3 | 2027-02-20 | 145 | 77750 | 75655 | 2294 | event_reminder 45100, announcement 19481, message 7361, event_cancelled 2040, event_back_on 2040, team_sheet_due 289 |
| 4 | 2027-02-27 | 145 | 75875 | 75875 | 7705 | event_reminder 38952, announcement 11267, event_back_on 9077, event_cancelled 7560, message 7356, fee_overdue 402 |
| 5 | 2027-03-06 | 150 | 68607 | 67468 | 159 | event_reminder 47766, announcement 11268, message 7359, fee_overdue 402, match_day 298, team_sheet_due 289 |
| 6 | 2027-03-13 | 145 | 68248 | 66524 | 0 | event_reminder 47766, announcement 11446, message 7509, team_sheet_due 290, match_day 289, fee_due 201 |
| 7 | 2027-03-20 | 145 | 70404 | 68795 | 0 | event_reminder 47766, announcement 11205, message 9504, fee_overdue 603, team_sheet_due 290, match_day 289 |
| 8 | 2027-03-27 | 145 | 68360 | 66761 | 0 | event_reminder 47664, announcement 11886, message 7564, team_sheet_due 290, match_day 289, fee_overdue 201 |
| 9 | 2027-04-03 | 145 | 79382 | 77347 | 0 | event_reminder 47774, announcement 20719, message 7703, event_changed 1260, fee_overdue 603, team_sheet_due 290 |

## The peak

Round 7, Saturday 10 am (2027-03-20 10:00 Sat): 2000 parents open the app (Home's six calls; four in ten open their chat; one in ten Fixtures) while 74 games take kick-offs, goals and chat lines, through a pool of 15 — 14466 calls in 43.7 s, 331 calls a second. An open of Home costs 295.6 ms of database time under this load.

| call | n | p50 ms | p95 ms | p99 ms |
|---|---|---|---|---|
| channel_screen | 800 | 6.1 | 12.4 | 14.7 |
| chat: line | 370 | 6.1 | 8.5 | 10.8 |
| fixtures_screen | 200 | 8.4 | 14.6 | 21.1 |
| home_competitions | 2000 | 256.9 | 284.9 | 298.0 |
| home_jobs | 2000 | 14.1 | 22.2 | 27.3 |
| home_layout | 2000 | 1.1 | 8.4 | 12.0 |
| home_screen | 2000 | 12.8 | 22.2 | 26.7 |
| live: goal | 296 | 6.0 | 7.5 | 10.1 |
| mark_channel_read | 800 | 0.4 | 4.4 | 6.8 |
| nav_badges | 2000 | 4.7 | 11.9 | 15.6 |
| needs_you | 2000 | 0.9 | 6.3 | 9.5 |

The league's and the clubs' screens at that moment (Postgres execution time, median of 3):

| as | screen | median ms |
|---|---|---|
| league | home_jobs | 3.0 |
| league | competition_run_sheet | 105.7 ◀ |
| league | competition_ladder | 0.5 |
| league | competition_appointments | 39.1 |
| league | admin_hub | 0.1 |
| coach | home_jobs | 21.1 |
| owner (biggest club) | home_jobs | 3.2 |
| owner (biggest club) | admin_hub | 0.1 |
| owner (biggest club) | outstanding_fees | 0.2 |
| stranger | public_competition_entry | 0.1 |

## Bugs

36 logged in `docs/BUGS.md`, 34 marked fixed. The table there carries role, steps, expected, actual and where each was fixed.

## Needs Joey

- Nothing from this run.
