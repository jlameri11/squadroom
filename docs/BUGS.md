# Bugs found by the Season 4 simulation

Found by `scripts/simulation` on the local Postgres (docs/SIMULATION.md). Severity: **high** (a wrong result, data crossing a boundary, a job impossible), **medium** (a job harder than it should be, a wrong or missing message), **low** (cosmetic, a rough edge). Every high and medium is fixed before the simulation is called done; the Fixed column names the migration or file. Rows with a Fixed entry were found by an earlier run and pass now (`scripts/simulation/fixed.json`); rows without one are open.

| # | Severity | Role | Where | Steps | Expected | Actual | Fixed |
|---|---|---|---|---|---|---|---|
| 1 | medium | competition manager | generate_fixtures / generate_fixtures_managed | Build the draw for an eight-team division; try to draw the second half of the season | Rounds 1–14 from one draw, home and away reversed in the second leg | One run makes seven rounds; a second run is allowed and labels its games Round 1–7 again, with nobody's home game reversed | 0276: generate_fixtures(… p_legs, p_skip_dates) |
| 2 | medium | competition manager | generate_fixtures_managed (p_round_every_days) | Draw a season across the NSW autumn school holidays | A week the league leaves out (17 April) has no games; later rounds move on a week | The generator spaces rounds evenly and cannot leave a week out; the league would move every game of the round by hand | 0276: p_skip_dates |
| 3 | medium | competition manager | generate_fixtures_managed (round dates as timestamptz + 'n days') | Draw a season whose rounds cross 4 April 2027 (daylight saving ends); compare a division's first kick-off on 27 March and 10 April | The same clock time (9 am stays 9 am) | Round dates were p_start_at + n days on a timestamptz; in a UTC session (PostgREST) that is n × 24 hours, so every kick-off after the change was an hour earlier and the pitch fit then pushed it to the next free slot. Found by inspection while fixing the draw; the check that would have caught it is OFF7a | 0276: round dates worked out in the competition's zone |
| 4 | high | coach | messages | PM3 the squad chat had a coach line and replies tonight | ≥4 | 1 |  |
| 5 | high | parent | enqueue_message_notification (quiet hours) | PM5 a quiet-hours parent's push waits for 7 am | 07:00 next morning | no row |  |
| 6 | high | parent | enqueue_message_notification (digest) | PM5 a digest parent gets one row for two lines, counting both | 1 row, count 2 | 0 rows, count undefined |  |
| 7 | high | parent | claim_notifications | PM5 and was sent after 7 am, not at 9:30 pm | sent ≥ 07:00 | unsent |  |
| 8 | high | parent | claim_notifications (12-hour window) | PM6 the Friday-evening lines, 14 hours stale when the drain came back, were not sent | none sent | 0 of 0 sent |  |
| 9 | high | coach | event_ticker.created_at | PM6 the kick-off is recorded at the time it was tapped, not when it synced | 2027-02-05T21:00:00.000Z | Sat Feb 06 2027 09:30:00 GMT+1100 (Australian Eastern Daylight Time) |  |
| 10 | high | everyone | notification_queue dedupe_key | PM6 nobody has two of the same push for one game this week | 0 | 23255 |  |
| 11 | high | ground manager | reschedule_fixture | FV11 the ground manager moves the game onto Field 3 by name | allowed | 23514: new row for relation "notification_queue" violates check constraint "notification_queue_kind_check" |  |
| 12 | high | ground manager | apply_reschedule | FV11 the game is on Field 3 (label and pitch) | Field 3 / its pitch id | Field 1 / the old pitch |  |
| 13 | high | parent | game_screen / mirror_fixture | FV11 a home family's game page says Field 3 | Harbour Park · Field 3 | Harbour Park · Field 1 |  |
| 14 | high | parent | fixture_pitch / venue_layout | FV11 the home family gets the field map with the pin, the address and Field 3 drawn | lat, address, Field 3 on the canvas | lat -33.813, 1 Harbour Road, Sim NSW 2000, field Field 1, 12 pitches |  |
| 15 | high | parent | notify_event_change | FV11 both squads were told the field changed | 52 people | 0 |  |
| 16 | high | referee | submit_referee_report | FV11 the referee files their report with the abuse in it | allowed | 23514: new row for relation "notification_queue" violates check constraint "notification_queue_kind_check" |  |
| 17 | high | referee coordinator | competition_appointments | FV11 the referee coordinator reads it on the appointments screen | abuse: true | null |  |
| 18 | medium | referee coordinator | submit_referee_report | FV11 a report of abuse reaches the coordinator or the discipline officer without them looking | a push | 0 queued |  |
