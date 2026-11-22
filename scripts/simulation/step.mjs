// Run: node scripts/simulation/step.mjs --at '2027-02-22 10:00' --plan extra --step 'RR1'
//
// One scenario step on its own, against the local Postgres that a season run
// left behind (hold it up with `node scripts/local-db/serve.mjs`), with the
// simulated clock set to the moment given — for building a scenario in
// seconds instead of waiting twenty-five minutes for the season to reach
// it. Every step of the plan whose name starts with --step runs, in order,
// the clock set to each step's own moment (no sweeps between them). The
// checks print as they do in a run; nothing is committed and the report is
// not rewritten.
//
//   --plan   which plan to load: extra (scenarios-extra.mjs), rounds, rounds2, season5
//   --round  the round the plan is asked for (rounds plans take a round and its Saturday)
//   --list   print the plan's steps and exit
import pg from 'pg'
import { val } from './lib.mjs'
import { setCompetition } from './world.mjs'
// Dry: bugs and results print, docs/BUGS.md and the results file are left alone.
process.env.SIM_DRY ??= '1'
const { clock, saveResults, scenarios } = await import('./lib.mjs')
const { rng } = await import('./routine.mjs')

const arg = (k, d = null) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d)
const at = arg('--at')
const plan = arg('--plan', 'extra')
const prefix = arg('--step', '')
const round = Number(arg('--round', '4'))

const pool = new pg.Pool({ host: 'localhost', port: 54329, user: 'postgres', password: 'local', database: 'squadroom_local', max: 8 })
try {
  await pool.query('select 1')
} catch (e) {
  console.log(`  the local Postgres is not up on :54329 (node scripts/local-db/serve.mjs) — ${e.message}`)
  process.exit(2)
}
const ctx = {
  pool, seed: Number(process.env.SEED ?? 9), stats: { notices: 0, clubMessages: 0, chatLines: 0, reactions: 0, polls: 0, scheduled: 0, rsvps: 0, appointments: 0, sheets: 0, results: 0, disputes: 0, ruled: 0, lateResults: 0, cards: 0 },
  perRound: [], ladders: {}, reserved: new Set(), noShows: [], lateResults: [], needsJoey: [], bench: {},
}
const steps = []
const add = (when, name, fn) => steps.push({ at: when, name, run: fn })
const S = (() => {
  // The Saturday of the round asked for: round 1 is 2027-02-06, a week apart, 17 April skipped.
  const dates = []
  for (let d = new Date('2027-02-06T00:00:00Z'); dates.length < 20; d = new Date(d.getTime() + 7 * 86400_000)) {
    const iso = d.toISOString().slice(0, 10)
    if (iso !== '2027-04-17') dates.push(iso)
  }
  return dates[round - 1]
})()
if (at) clock.set(at)
else clock.set(`${S} 10:00`)
const rand = rng(ctx.seed * 1000 + 100 + round)
if (plan === 'extra') {
  const { extraPlan } = await import('./scenarios-extra.mjs')
  await extraPlan(ctx, round, S, add, rand)
} else if (plan === 'rounds') {
  const { roundPlan } = await import('./scenarios.mjs')
  for (const st of await roundPlan(ctx, round, S)) steps.push(st)
} else if (plan === 'season5') {
  const { season5Plan } = await import('./scenarios-season5.mjs')
  // Alone, the Season 5 competition is whatever the database has (the season run sets it when it rolls over).
  ctx.comp5 = ctx.comp5 ?? (await val(ctx.pool, `select id from public.competitions where season = '2028' order by created_at desc limit 1`))
  if (ctx.comp5) setCompetition(ctx.comp5)
  await season5Plan(ctx, add)
} else if (plan === 'league') {
  const { leagueSetup } = await import('./scenarios-extra.mjs')
  add('2027-01-18 10:00', 'LS1 a brand-new organiser starts a league', () => leagueSetup(ctx))
} else {
  console.log(`  no plan called ${plan}`)
  process.exit(2)
}
steps.sort((a, b) => a.at.localeCompare(b.at))
const mine = steps.filter((s) => !prefix || s.name.startsWith(prefix))
if (process.argv.includes('--list') || !mine.length) {
  for (const s of steps) console.log(`  ${s.at}  ${s.name}`)
  if (!mine.length && prefix) console.log(`\n  no step starts with "${prefix}"`)
  await pool.end()
  process.exit(0)
}
for (const s of mine) {
  if (!at) clock.set(s.at)
  console.log(`\n\x1b[1m${s.name}\x1b[0m  \x1b[2m${clock.local()}\x1b[0m`)
  try {
    const out = await s.run()
    if (out && typeof out === 'object') console.log(`  ${JSON.stringify(out).slice(0, 300)}`)
  } catch (e) {
    console.log(`  \x1b[31mstep threw: ${e.stack ?? e.message}\x1b[0m`)
  }
}
const rows = saveResults({ stats: ctx.stats, perRound: [], seed: ctx.seed })
console.log('')
for (const r of rows.filter((x) => [...scenarios.keys()].includes(x.id) && x.ran)) {
  const failed = r.checks.filter((c) => !c.passed)
  console.log(`  ${r.status === 'FAIL' ? '\x1b[31m' : '\x1b[32m'}${r.status}\x1b[0m ${r.id} ${r.title.slice(0, 80)} — ${r.checks.length - failed.length}/${r.checks.length}`)
}
await pool.end()
