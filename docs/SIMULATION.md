# Full season simulation — "SPL Season 4"

**Status (9 Nov 2026): queued.** Joey's order: two-step text code (0232) →
organiser groups → Big Club Mode (`BIG_CLUB_MODE.md`) → this. Commit and push
hourly while it runs. No deploy. This file will become the report (section
"What ran" onward); until then it holds the brief, verbatim.

## The brief (Joey, 9 Nov 2026)

> FULL SEASON SIMULATION — "SPL Season 4" (Joey, 9 Nov)
> Goal: prove the whole platform works end to end at real size, and find every bug before real clubs do.
>
> WHERE: run it on the local Postgres (scripts/local-db), never on squadroom-dev or the demo. All data fake (made-up clubs, people, venues). Reuse the scale-test tooling.
>
> 1. BUILD THE LEAGUE
> - A "Tournament & league organiser" (fake: "Harbour Football Group") running "SPL Season 4".
> - 5 age groups (U9, U11, U13, U15, U17), each split into divisions — 300+ teams total from ~60 clubs and academies (mix of big clubs, small clubs, academies; some clubs with several teams per age group).
> - 12 venues with pitches and hours (L-29), different sizes per age group.
> - Referees pool (~150, incl. under-18 refs), league staff with each league role.
> - Each club: committee roles, coaches, team managers, ~15 players per team, 1–2 guardians per child, some adult staff who are also parents.
>
> 2. RUN THE SEASON (simulate week by week, ~14 rounds + finals)
> - Clubs enter, pay entry fees (Stripe test mode or the no-key path), nominate teams.
> - Draw generated; draw-quality summary checked; Fixture Flowing window used by some home clubs.
> - Each week: referees allocated, some decline/late-decline; availability answered by parents (incl. two parents disagreeing); coaches select and publish team sheets; sheets lock; ineligible players refused; live score taps (some offline, synced late); both teams submit scores (some mismatched → disputes); cards incl. accumulation → suspensions; forfeits; a washout round called off by venue; a rescheduled round; abandoned game.
> - Ladders, MiniRoos rules for U9 (no scores/ladder shown), finals eligibility, finals series.
>
> 3. COMMUNICATION LOAD (throughout)
> - League: Notices to everyone and to club staff only; the Clubs chat with club heads; DMs organiser↔club heads.
> - Clubs: "Message the club" to thousands, age-group notices, team chats busy (thousands of messages/week), replies, reactions, photos, polls, scheduled messages.
> - Safeguarding: coaches trying to DM under-13s (parents auto-added), a reported message, an under-13 trying to make an account (refused), a 13+ awaiting parent approval.
>
> 4. EVERY SCENARIO
> - For every role (parent, adult player, 13+ player, coach, team manager, coordinator, club president/registrar/treasurer, welfare officer, volunteer coordinator, league organiser, each league role, referee, stranger on the public page): do every main job they have, AND try things they must NOT be able to do (other clubs' data, other teams, money, medical, posting notices). Every "must not" must be refused.
> - Edge cases: no signal, double taps, back button, two children in different clubs, a person in three organisations, long names, emoji, wrong inputs, expired WWCC, unpaid fees, timezone around midnight.
>
> 5. MEASURE AND REPORT
> - Time every key screen and call during peak (Saturday 8am) — target under 1 second.
> - Log every failure, error and wrong result in docs/BUGS.md (role, steps, expected vs actual, severity).
> - Fix all high/medium bugs, re-run the affected weeks until clean.
> - Write docs/SIMULATION.md: what ran (numbers), what broke, what was fixed, performance at peak, anything that needs Joey.
> - Then delete the simulated data from the local DB.
>
> Do this after the current queue (two-step text code → organiser groups → big-club mode). Commit and push hourly. No deploy.

## Notes taken while queued

- The scale-test tooling to reuse: `scripts/local-db/` (`run.mjs`, `sql.mjs`,
  `copy-dev.mjs`) and the scale run recorded in `SCALE.md`.
- Several brief items depend on Big Club Mode landing first (team managers,
  coordinators, president/registrar/treasurer, welfare and volunteer roles,
  "Message the club"), which is why it runs after it.
- Stripe in the simulation: the local Postgres has no webhook; entry fees
  take the no-key path (recorded by the treasurer) unless the Stripe test
  harness is pointed at the local app on purpose.
