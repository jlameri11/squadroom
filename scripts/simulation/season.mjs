// Run: node scripts/simulation/season.mjs [--rebuild] [--until 3] [--skip-peak]
//
// SPL Season 4, played week by week on the LOCAL Postgres (docs/SIMULATION.md;
// Joey's brief of 9 Nov 2026 and the scenario list of 13 Nov). Never touches
// squadroom-dev or the demo.
//
//   --rebuild   rebuild the local database from every migration, load
//               scripts/simulation/seed.sql and the clock (clock.sql), then play
//   --until N   stop after round N (the pre-season alone is --until 0)
//   --skip-peak skip the Saturday-morning peak measurement
//   --seed N    the random seed (a different draw of events, scores, weather and who misbehaves)
//   --commit    commit and push docs/BUGS.md and docs/SIMULATION.md after every round (Joey, 15 Nov)
//
// The clock is simulated (clock.sql): every call runs at the season's own
// moment, so sheet locks, late declines, reminders, quiet hours, scheduled
// messages, check expiries and the morning sweeps fire as they would. The
// cron jobs and the push drain are emulated every quarter of an hour
// (world.mjs sweep()).
//
// Every scenario on Joey's list is a `scenario()` in scenarios.mjs with its
// checks (expected vs actual); the results land in .cache/simulation-results.json
// and docs/SIMULATION.md (report.mjs), bugs in docs/BUGS.md as they are found.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { ROOT, bugs, clock, head, localDb, note, ok, saveResults, scenarios, sql, val } from './lib.mjs'
import { COMP, advanceTo, gamesOn, roundDates, queueTally } from './world.mjs'
import { appointReferees, checkIns, clubLife, fullTime, leagueNotices, leagueSunday, plusDays, refereesRespond, rescheduleLeftovers, rng, scheduleFridayLines, submitSheets, weekRsvps } from './routine.mjs'
import { preseason, roundPlan, finalsPlan, closing } from './scenarios.mjs'
import { writeReport } from './report.mjs'

const args = process.argv.slice(2)
const flag = (f) => args.includes(f)
const UNTIL = args.includes('--until') ? Number(args[args.indexOf('--until') + 1]) : 99
const SEED = args.includes('--seed') ? Number(args[args.indexOf('--seed') + 1]) : 1
const COMMIT = flag('--commit')

if (flag('--rebuild')) {
  console.log('\nRebuilding the local database from every migration…')
  const r = spawnSync('node', ['scripts/local-db/run.mjs'], { stdio: 'inherit', cwd: ROOT })
  if (r.status !== 0) process.exit(r.status ?? 1)
  for (const f of ['scripts/simulation/seed.sql', 'scripts/simulation/clock.sql']) {
    console.log(`Loading ${f}…`)
    const s = spawnSync('node', ['scripts/local-db/sql.mjs', '-f', f], { stdio: 'inherit', cwd: ROOT })
    if (s.status !== 0) process.exit(s.status ?? 1)
  }
}

/** Joey (15 Nov 2026): commit and push after every round of the season. */
function commitRound(r, S) {
  const label = r <= 14 ? `round ${r}` : r === 15 ? 'the catch-up round' : 'the finals'
  const run = (cmd) => spawnSync('sh', ['-c', cmd], { cwd: ROOT, encoding: 'utf8' })
  run('git add docs/BUGS.md docs/SIMULATION.md scripts/simulation/fixed.json')
  const staged = run('git diff --cached --quiet || echo changed').stdout.trim()
  if (!staged) return
  const c = run(`git commit -q -m "Simulation: ${label} (${S}) played — ${bugs.length} bugs logged this run" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"`)
  if (c.status !== 0) { note(`commit failed: ${c.stderr.trim()}`); return }
  const p = run('git push -q')
  note(p.status === 0 ? `committed and pushed ${label}` : `pushed? ${p.stderr.trim()}`)
}

const db = await localDb(10)
const pool = db.pool
const t0 = Date.now()

const ctx = {
  pool,
  rand: rng(SEED * 1000 + 4),
  seed: SEED,
  stats: { notices: 0, appointments: 0, clubMessages: 0, chatLines: 0, reactions: 0, polls: 0, rsvps: 0, scheduled: 0, sheets: 0, results: 0, disputes: 0, cards: 0, ruled: 0, lateResults: 0 },
  perRound: [],
  noShows: [],
  lateResults: [],
  ladders: {},
  peak: null,
}

try {
  const seeded = await val(pool, `select count(*)::int from public.competitions where id = $1`, [COMP])
  if (!seeded) {
    console.log('  the simulated league is not loaded — run with --rebuild')
    process.exit(2)
  }
  const clockOn = await val(pool, `select count(*)::int from pg_proc where proname = 'sim_date' and pronamespace = 'pg_catalog'::regnamespace`)
  if (!clockOn) {
    console.log('  the simulation clock is not installed — node scripts/local-db/sql.mjs -f scripts/simulation/clock.sql')
    process.exit(2)
  }

  // ------------------------------------------------------------ pre-season
  clock.set('2027-01-25 09:00')
  head('PRE-SEASON — Monday 25 January 2027')
  await preseason(ctx)

  const firstDates = await roundDates(pool)
  note(`${firstDates.length} playing days drawn: ${firstDates.map((d) => `${d.d} (${d.games})`).join(', ')}`)

  // --------------------------------------------------------------- rounds
  // Week by week, taking the next playing day from the draw each time — the
  // catch-up round and the finals appear in it as the season makes them.
  let r = 0
  const isSaturday = (d) => new Date(`${d}T12:00:00+10:00`).getUTCDay() === 6
  let S = firstDates.find((d) => isSaturday(d.d))?.d
  let extra = []
  // The next Saturday with games; a mid-week game belongs to the week around it.
  const nextDay = async (after) => (await roundDates(pool)).find((d) => d.d > after && isSaturday(d.d))?.d ?? null
  while (S) {
    r++
    if (r > UNTIL) break
    const since = clock.now
    head(`${r <= 14 ? `ROUND ${r}` : r === 15 ? 'CATCH-UP ROUND' : 'FINALS'} — Saturday ${S}`)
    const rand = rng(SEED * 1000 + 100 + r)
    const plan = r <= 14 ? await roundPlan(ctx, r, S) : []
    if (r === 14) extra = await finalsPlan(ctx)
    const weekEnd = `${plusDays(S, 1)} 23:59`
    const mine = extra.filter((x) => x.at <= weekEnd)
    extra = extra.filter((x) => x.at > weekEnd)
    const steps = [
      { at: `${plusDays(S, -6)} 18:00`, name: 'league notices', run: () => leagueNotices(ctx, r) },
      { at: `${plusDays(S, -6)} 18:30`, name: 'appoint referees', run: () => appointReferees(ctx, S) },
      { at: `${plusDays(S, -5)} 09:00`, name: 'referees respond', run: () => refereesRespond(ctx, S, rand) },
      { at: `${plusDays(S, -5)} 19:00`, name: 'club life', run: () => clubLife(ctx, r, rand) },
      { at: `${plusDays(S, -5)} 20:00`, name: 'families answer', run: () => weekRsvps(ctx, S, rand) },
      { at: `${plusDays(S, -4)} 19:00`, name: 'coaches schedule Friday lines', run: () => scheduleFridayLines(ctx, S, rand) },
      { at: `${plusDays(S, -4)} 12:00`, name: 'mid-week team sheets', run: () => submitSheets(ctx, S, rand, { from: plusDays(S, -5), to: plusDays(S, -1) }), quiet: true },
      { at: `${plusDays(S, -1)} 12:00`, name: 'team sheets', run: () => submitSheets(ctx, S, rand, { from: S, to: plusDays(S, 1) }) },
      ...plan,
      ...mine,
    ]
    // The week's games (Monday to Sunday), slot by slot: the referees' check-ins and full time.
    const games = (await Promise.all(Array.from({ length: 7 }, (_, i) => gamesOn(pool, plusDays(S, i - 5))))).flat()
    const slots = [...new Set(games.map((g) => g.starts_at.toISOString()))].sort()
    for (const slot of slots) {
      const these = games.filter((g) => g.starts_at.toISOString() === slot)
      const ko = new Date(slot)
      const minus = (m) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ko.getTime() + m * 60_000)).replace(',', '')
      steps.push({ at: minus(-10), name: `check-ins ${minus(0).slice(11)}`, run: () => checkIns(ctx, these, rand), quiet: true })
      const dur = Math.max(...these.map((g) => g.duration_mins ?? 60))
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ko)
      steps.push({ at: minus(dur + 8), name: `full time ${minus(0).slice(11)}`, run: async () => fullTime(ctx, (await gamesOn(pool, day)).filter((g) => these.some((t) => t.id === g.id)), rand), quiet: true })
    }
    steps.push({ at: `${plusDays(S, 1)} 10:00`, name: 'the league on Sunday', run: () => leagueSunday(ctx, rand) })
    if (S < '2027-05-22') steps.push({ at: `${plusDays(S, 1)} 16:30`, name: 'leftover games to the catch-up round', run: () => rescheduleLeftovers(ctx) })
    steps.push({ at: `${plusDays(S, 1)} 11:00`, name: 'ladders', run: async () => { ctx.ladders[r] = await sql(pool, `select division, count(*)::int as teams, sum(played)::int as played from (select d.division, l.* from public.competition_divisions d cross join lateral app_private.ladder($1, d.division) l where d.competition_id = $1) x group by division order by division`, [COMP]) } })
    steps.sort((a, b) => a.at.localeCompare(b.at))

    for (const step of steps) {
      await advanceTo(pool, step.at)
      const out = await step.run()
      if (!step.quiet) console.log(`  ${clock.local()}  ${step.name}${out && typeof out === 'object' ? `  ${JSON.stringify(out).slice(0, 200)}` : ''}`)
    }
    // Sunday night: how much went out this week.
    const tally = await queueTally(pool, since)
    ctx.perRound.push({ r, date: S, games: games.length, queue: tally })
    const total = tally.reduce((n, t) => n + t.n, 0)
    const sent = tally.reduce((n, t) => n + t.sent, 0)
    const sms = tally.reduce((n, t) => n + t.sms, 0)
    note(`week ${r}: ${games.length} games, ${total} notifications queued (${sent} sent, ${sms} texts), bugs so far ${bugs.length}`)
    ctx.minutes = `${Math.round((Date.now() - t0) / 60000)} min so far`
    try { writeReport(saveResults({ stats: ctx.stats, perRound: ctx.perRound, peak: ctx.peak, seed: SEED }), ctx) } catch (e) { note(`report not written: ${e.message}`) }
    if (COMMIT) commitRound(r, S)
    S = await nextDay(S)
  }
  // Steps left after the last playing day.
  if (r <= UNTIL) {
    for (const step of extra) {
      await advanceTo(pool, step.at)
      const out = await step.run()
      console.log(`  ${clock.local()}  ${step.name}${out && typeof out === 'object' ? `  ${JSON.stringify(out).slice(0, 200)}` : ''}`)
    }
    if (r > 14) await closing(ctx)
  }
} catch (e) {
  console.log(`\n\x1b[31m  the simulation stopped: ${e.stack ?? e.message}\x1b[0m`)
  process.exitCode = 1
} finally {
  ctx.minutes = `${Math.round((Date.now() - t0) / 60000)} min`
  const rows = saveResults({ stats: ctx.stats, perRound: ctx.perRound, peak: ctx.peak, seed: SEED, minutes: Math.round((Date.now() - t0) / 60000) })
  try { writeReport(rows, ctx) } catch (e) { note(`report not written: ${e.message}`) }
  const pass = rows.filter((x) => x.status === 'PASS').length, fixed = rows.filter((x) => x.status === 'FIXED').length, fail = rows.filter((x) => x.status === 'FAIL').length, notRun = rows.filter((x) => x.status === 'NOT RUN').length
  console.log(`\n  scenarios: ${pass} pass · ${fixed} fixed · ${fail} fail · ${notRun} not run · bugs logged this run: ${bugs.length} · ${Math.round((Date.now() - t0) / 1000)} s`)
  await db.stop()
}
