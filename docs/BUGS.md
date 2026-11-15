# Bugs found by the Season 4 simulation

Found by `scripts/simulation` on the local Postgres (docs/SIMULATION.md). Severity: **high** (a wrong result, data crossing a boundary, a job impossible), **medium** (a job harder than it should be, a wrong or missing message), **low** (cosmetic, a rough edge). Every high and medium is fixed before the simulation is called done; the Fixed column names the migration or file. Rows with a Fixed entry were found by an earlier run and pass now (`scripts/simulation/fixed.json`); rows without one are open.

| # | Severity | Role | Where | Steps | Expected | Actual | Fixed |
|---|---|---|---|---|---|---|---|
| 1 | medium | competition manager | generate_fixtures / generate_fixtures_managed | Build the draw for an eight-team division; try to draw the second half of the season | Rounds 1–14 from one draw, home and away reversed in the second leg | One run makes seven rounds; a second run is allowed and labels its games Round 1–7 again, with nobody's home game reversed | 0276: generate_fixtures(… p_legs, p_skip_dates) |
| 2 | medium | competition manager | generate_fixtures_managed (p_round_every_days) | Draw a season across the NSW autumn school holidays | A week the league leaves out (17 April) has no games; later rounds move on a week | The generator spaces rounds evenly and cannot leave a week out; the league would move every game of the round by hand | 0276: p_skip_dates |
| 3 | medium | competition manager | generate_fixtures_managed (round dates as timestamptz + 'n days') | Draw a season whose rounds cross 4 April 2027 (daylight saving ends); compare a division's first kick-off on 27 March and 10 April | The same clock time (9 am stays 9 am) | Round dates were p_start_at + n days on a timestamptz; in a UTC session (PostgREST) that is n × 24 hours, so every kick-off after the change was an hour earlier and the pitch fit then pushed it to the next free slot. Found by inspection while fixing the draw; the check that would have caught it is OFF7a | 0276: round dates worked out in the competition's zone |
| 4 | high | parent | channel_members | PM5 the quiet-hours parent shares a squad chat with a digest parent | a channel | none |  |
| 5 | high | league | home_jobs (league) | R2 the league's Home shows one disputed result | "1 disputed" | 8 disputed · 1 sheets missing |  |
| 6 | high | referee | call_off_fixtures / notify_event_change | FV9 Friday night: the 14 referees appointed to those games are told their game is off | 14 | 8 |  |
| 7 | high | referee | call_off_fixtures / notify_event_change | WS1 Washout: the 124 referees appointed to those games are told their game is off | 124 | 75 |  |
| 8 | high | competition manager | draw_quality | WS4 the double-header shows in the draw's sanity check | a double header on 2027-03-06 | [] |  |
| 9 | high | referee | record_match_event | OF1 the first yellow of three is recorded | allowed | 22023: this game has ended; ask the league for a correction |  |
| 10 | high | referee | record_match_event (blue) | OF1 a blue card is recorded with its minute | allowed | 22023: this game has ended; ask the league for a correction |  |
| 11 | high | referee | record_match_event (blue_minutes) | OF1 the sin bin runs from the minute shown: back at 50 | 50 |  |  |
| 12 | high | coach | suspend_on_card (L-20) | OFF1 the club hears the player is one yellow from a suspension | >0 | 0 |  |
| 13 | high | club admin | queue_clearance_warnings | OFF3 each of the four clubs' owners and admins are told a coach's check has expired | 4 clubs | 0 clubs ( people) |  |
| 14 | high | club admin | clearance_board | OFF3 the club's checks board shows the coach as expired | expired | expiring |  |
| 15 | high | coach | can_manage_entry → is_team_coach → clearance_lapsed | OFF3 a coach whose check has expired cannot submit a sheet | refused | allowed: "2147e298-b089-4d82-ba04-6d4be3fe5114" |  |
| 16 | high | coach | can_post_in_channel → clearance_lapsed | OFF3 nor post to the squad | refused | allowed: [{"id":"9b29cc58-652e-4839-b280-7a8817cdcf7e"}] |  |
| 17 | high | coach | ineligibility (borrow_cap) | OFF6 a third game played up is over the division's cap of two — refused | refused | allowed: "ec7c6e57-7f0e-446a-9425-a4701bcadcf4" |  |
| 18 | high | league | fixtures | OFF7b the round falls on Easter Saturday with a full card | 2027-04-03, >100 games | 2027-03-27, 145 games |  |
| 19 | high | league | home_jobs | OFF7b the league's Home counts the weekend's games | N games this weekend | Nothing this weekend |  |
