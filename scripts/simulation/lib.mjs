// The simulation's shared pieces (docs/SIMULATION.md; Joey's brief of 9 Nov
// 2026 and the scenario list of 13 Nov): the local Postgres, the simulated
// clock, ids that can be found again, running a call AS a person under their
// RLS, the scenario register and the bug log.
//
// LOCAL ONLY. Everything here talks to the embedded Postgres that
// scripts/local-db/run.mjs builds (port 54329); nothing reaches squadroom-dev.
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const ROOT = process.cwd()
export const TZ = 'Australia/Sydney'

/** A stable id from a name, the way scripts/scale/seed.sql makes them (md5 → uuid). */
export function sid(t) {
  const h = createHash('md5').update(t).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

// The seed's people and things, by the names seed.sql gave them.
export const ids = {
  league: sid('sim-league'),
  leagueOwner: sid('sim-league-owner'),
  /** 1 competition manager, 2 referee coordinator, 3 discipline officer, 4 ground manager, 5 competition manager, 6 referee coordinator */
  leagueStaff: (k) => sid(`sim-league-staff-${k}`),
  comp: sid('sim-comp'),
  club: (c) => sid(`sim-club-${c}`),
  /** j: 1 president (owner), 2 secretary, 3 registrar, 4 treasurer, 5 welfare officer, 6 volunteer coordinator, 7… coaches then managers */
  staff: (c, j) => sid(`sim-staff-${c}-${j}`),
  parent: (c, k) => sid(`sim-parent-${c}-${k}`),
  team: (t) => sid(`sim-team-${t}`),
  entry: (t) => sid(`sim-entry-${t}`),
  player: (t, i) => sid(`sim-player-${t}-${i}`),
  referee: (r) => sid(`sim-referee-${r}`),
  refProfile: (r) => sid(`sim-ref-${r}`),
  venue: (v) => sid(`sim-venue-${v}`),
  pitch: (v, f, sub = '') => sid(`sim-pitch-${v}-${f}${sub}`),
}

// ------------------------------------------------------------------ the clock
/**
 * The simulated moment (clock.sql). Every transaction the simulation runs
 * sets sim.now to this, so now(), today and every rule written against them
 * see the season's date, not the laptop's.
 */
export const clock = {
  now: null,
  /** `clock.set('2027-02-06 08:30')` — a Sydney wall-clock time. */
  set(local) {
    clock.now = sydney(local)
    return clock.now
  },
  /** Move forward by a number of hours (fractions allowed). */
  advance(hours) {
    clock.now = new Date(clock.now.getTime() + hours * 3600_000)
    return clock.now
  },
  iso() {
    return clock.now ? clock.now.toISOString() : null
  },
  /** The simulated moment as a Sydney wall-clock string, for messages. */
  local() {
    return clock.now ? fmtSydney(clock.now) : 'real time'
  },
}

/** A Sydney wall-clock time ('2027-02-06 08:30' or '2027-02-06') as a Date. */
export function sydney(local) {
  const [d, t = '00:00'] = local.split(/[ T]/)
  // Try both offsets Sydney uses and keep the one that formats back to the same wall clock.
  for (const off of ['+11:00', '+10:00']) {
    const guess = new Date(`${d}T${t.length === 5 ? t + ':00' : t}${off}`)
    if (fmtSydney(guess).startsWith(`${d} ${t.slice(0, 5)}`)) return guess
  }
  return new Date(`${d}T${t}+10:00`)
}
export function fmtSydney(date) {
  const p = new Intl.DateTimeFormat('en-AU', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' }).formatToParts(date)
  const g = (k) => p.find((x) => x.type === k)?.value
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour') === '24' ? '00' : g('hour')}:${g('minute')} ${g('weekday')}`
}
/** The Sydney calendar date (YYYY-MM-DD) of a Date. */
export function sydneyDate(date) {
  return fmtSydney(date).slice(0, 10)
}

// --------------------------------------------------------------- the database
/** The local database: a started embedded Postgres and a pool on it. */
export async function localDb(poolSize = 8) {
  const { default: EmbeddedPostgres } = await import('embedded-postgres').catch(() => {
    console.log('  embedded-postgres is not installed — see scripts/local-db/run.mjs')
    process.exit(2)
  })
  const { default: pgmod } = await import('pg')
  const pg = new EmbeddedPostgres({ databaseDir: join(ROOT, '.local-db'), user: 'postgres', password: 'local', port: 54329, persistent: true, onLog: () => {}, onError: () => {} })
  await pg.start()
  const pool = new pgmod.Pool({ host: 'localhost', port: 54329, user: 'postgres', password: 'local', database: 'squadroom_local', max: poolSize })
  return { pg, pool, async stop() { await pool.end(); await pg.stop() } }
}

/**
 * Every transaction: UTC, as PostgREST's connections are (so a date worked out
 * in the session's zone behaves as it does in production), and the simulated
 * clock.
 */
async function begin(c, { aal2, profileId } = {}) {
  await c.query('begin')
  await c.query(`set local timezone = 'UTC'`)
  if (clock.now) await c.query(`select set_config('sim.now', $1, true)`, [clock.iso()])
  if (profileId) {
    const claims = { sub: profileId, role: 'authenticated', ...(aal2 ? { aal: 'aal2' } : {}) }
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)])
    await c.query('set local role authenticated')
  }
}

/**
 * Run `fn(client)` as a person: their claims set, the authenticated role
 * taken, inside one transaction. Committed unless `rollback`. A refusal is
 * returned, not thrown, so a "must not" can be asserted in one line.
 */
export async function asPerson(pool, profileId, fn, { rollback = false, aal2 = false } = {}) {
  const c = await pool.connect()
  try {
    await begin(c, { aal2, profileId })
    try {
      const out = await fn(c)
      await c.query('reset role')
      await c.query(rollback ? 'rollback' : 'commit')
      return { ok: true, data: out }
    } catch (e) {
      await c.query('rollback').catch(() => {})
      return { ok: false, code: e.code, error: e.message }
    }
  } finally {
    c.release()
  }
}

/** As a stranger (the anon role, no claims), the way a public page calls. */
export async function asAnon(pool, fn) {
  const c = await pool.connect()
  try {
    await begin(c)
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'anon' })])
    await c.query('set local role anon')
    try {
      const out = await fn(c)
      await c.query('reset role')
      await c.query('commit')
      return { ok: true, data: out }
    } catch (e) {
      await c.query('rollback').catch(() => {})
      return { ok: false, code: e.code, error: e.message }
    }
  } finally {
    c.release()
  }
}

/** As the service role (postgres), outside RLS, in one transaction on the simulated clock. Throws. */
export async function asAdmin(pool, fn) {
  const c = await pool.connect()
  try {
    await begin(c)
    try {
      const out = await fn(c)
      await c.query('commit')
      return out
    } catch (e) {
      await c.query('rollback').catch(() => {})
      throw e
    }
  } finally {
    c.release()
  }
}

/** One admin statement; the rows. */
export const sql = (pool, text, params = []) => asAdmin(pool, async (c) => (await c.query(text, params)).rows)
/** One admin statement; the first row's first column. */
export const val = async (pool, text, params = []) => {
  const rows = await sql(pool, text, params)
  return rows[0] ? rows[0][Object.keys(rows[0])[0]] : null
}

/** One call to a function, as a person; the first row's first column (a jsonb or a scalar), or the rows. */
export async function rpc(pool, profileId, fn, args = {}, opts = {}) {
  const names = Object.keys(args)
  const text = `select * from public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')})`
  return asPerson(pool, profileId, async (c) => {
    const r = await c.query(text, names.map((n) => args[n]))
    if (r.fields.length === 1 && r.rows.length <= 1) return r.rows[0]?.[r.fields[0].name] ?? null
    return r.rows
  }, opts)
}

/** A statement as a person (an insert through RLS, say); the rows. */
export function run(pool, profileId, text, params = [], opts = {}) {
  return asPerson(pool, profileId, async (c) => (await c.query(text, params)).rows, opts)
}

// ------------------------------------------------------------- the bug log
const BUGS = join(ROOT, 'docs', 'BUGS.md')
const seen = new Set()
export const bugs = []

/**
 * docs/BUGS.md, as the brief asks: role, steps, expected vs actual, severity.
 * One row per distinct finding (the same place/expected/actual is written once).
 * Returns the bug's number.
 */
/** SIM_DRY=1 (scripts/simulation/step.mjs): print the bugs and results, write no file. */
const DRY = process.env.SIM_DRY === '1'
export function logBug({ severity, role, where, steps, expected, actual, scenario }) {
  const key = `${where}|${expected}|${String(actual).slice(0, 80)}`
  if (seen.has(key)) return bugs.find((b) => b.key === key)?.n ?? null
  seen.add(key)
  let n = bugs.length + 1
  if (!DRY) {
    startBugLog()
    n = (readFileSync(BUGS, 'utf8').match(/^\| \d+ \|/gm) ?? []).length + 1
    appendFileSync(BUGS, `| ${n} | ${cell(severity)} | ${cell(role)} | ${cell(where)} | ${cell(steps)} | ${cell(expected)} | ${cell(actual)} |  |\n`)
  }
  bugs.push({ n, key, severity, role, where, scenario })
  console.log(`  \x1b[31mbug #${n}\x1b[0m [${severity}] ${role} — ${where}: expected ${expected}; got ${String(actual).slice(0, 160)}`)
  return n
}
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')

/**
 * docs/BUGS.md starts each run with the bugs earlier runs found and fixed
 * (scripts/simulation/fixed.json, the ledger), then the run appends what it
 * finds. A run that finds nothing new leaves only the fixed ones.
 */
let bugLogStarted = false
export function startBugLog() {
  if (bugLogStarted) return
  bugLogStarted = true
  const fixed = existsSync(FIXED) ? JSON.parse(readFileSync(FIXED, 'utf8')) : []
  const rows = (Array.isArray(fixed) ? fixed : []).map((f, i) => `| ${i + 1} | ${cell(f.severity)} | ${cell(f.role)} | ${cell(f.where)} | ${cell(f.steps)} | ${cell(f.expected)} | ${cell(f.actual)} | ${cell(f.fixed)} |`)
  writeFileSync(BUGS, '# Bugs found by the Season 4 simulation\n\nFound by `scripts/simulation` on the local Postgres (docs/SIMULATION.md). Severity: **high** (a wrong result, data crossing a boundary, a job impossible), **medium** (a job harder than it should be, a wrong or missing message), **low** (cosmetic, a rough edge). Every high and medium is fixed before the simulation is called done; the Fixed column names the migration or file. Rows with a Fixed entry were found by an earlier run and pass now (`scripts/simulation/fixed.json`); rows without one are open.\n\n| # | Severity | Role | Where | Steps | Expected | Actual | Fixed |\n|---|---|---|---|---|---|---|---|\n' + rows.join('\n') + (rows.length ? '\n' : ''))
}
const FIXED = join(ROOT, 'scripts', 'simulation', 'fixed.json')

export const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
export const note = (m) => console.log(`  \x1b[2m… ${m}\x1b[0m`)
export const head = (m) => console.log(`\n\x1b[1m${m}\x1b[0m  \x1b[2m${clock.local()}\x1b[0m`)

// ------------------------------------------------------- the scenario register
/**
 * Joey's list (13 Nov 2026): every item happens at least once and is checked,
 * expected against actual, and lands in docs/SIMULATION.md as PASS, FIXED
 * or FAIL. A scenario is registered once and may record several checks; it
 * passes when every check passed. FIXED is a pass on a scenario that logged
 * a bug in an earlier run and names the fix (scripts/simulation/fixed.json).
 */
export const scenarios = new Map()
let current = null

export function scenario(id, group, title) {
  if (!scenarios.has(id)) scenarios.set(id, { id, group, title, checks: [], bugs: [], ran: false })
  const s = scenarios.get(id)
  s.ran = true
  current = s
  return s
}

/** Point the checks at a scenario already registered (a later step of it); nothing if unknown. */
export function focus(id) {
  const s = scenarios.get(id)
  if (!s) return false
  s.ran = true
  current = s
  return true
}

/** One check inside the current scenario. Logs a bug when it fails (unless `quiet`). */
export function check(passed, { what, expected, actual, role = '—', where = '—', severity = 'high', quiet = false }) {
  const s = current
  const row = { what, expected: String(expected), actual: String(actual), passed: Boolean(passed), at: clock.local() }
  s?.checks.push(row)
  if (passed) {
    ok(`${what}`)
  } else if (quiet) {
    console.log(`  \x1b[33m◦\x1b[0m ${what}: expected ${expected}; got ${String(actual).slice(0, 160)}`)
  } else {
    const n = logBug({ severity, role, where, steps: `${s?.id ?? ''} ${what}`, expected, actual, scenario: s?.id })
    if (n && s && !s.bugs.includes(n)) s.bugs.push(n)
  }
  return Boolean(passed)
}

/** A must-not: the call should be refused (a policy or a rule) or come back empty. */
export function mustRefuse(result, opts) {
  const refused = !result.ok && ['42501', 'P0001', '22023', '23514', '23P01', '23505', '23503'].includes(result.code)
  const empty = result.ok && (result.data == null || (Array.isArray(result.data) && result.data.length === 0) || result.data === 0 || result.data === false)
  return check(refused || empty, { ...opts, expected: opts.expected ?? 'refused', actual: result.ok ? `allowed: ${JSON.stringify(result.data)?.slice(0, 120)}` : `${result.code}: ${result.error}` })
}

/** A must: the call should succeed. */
export function mustWork(result, opts) {
  return check(result.ok, { ...opts, expected: opts.expected ?? 'allowed', actual: result.ok ? 'allowed' : `${result.code ?? '?'}: ${result.error}` })
}

// ------------------------------------------------------------------ the report
const RESULTS = join(ROOT, '.cache', 'simulation-results.json')

export function saveResults(extra = {}) {
  mkdirSync(join(ROOT, '.cache'), { recursive: true })
  const ledger = existsSync(FIXED) ? JSON.parse(readFileSync(FIXED, 'utf8')) : []
  const fixedBy = {}
  for (const f of Array.isArray(ledger) ? ledger : []) for (const id of [].concat(f.scenario ?? [])) fixedBy[id] = (fixedBy[id] ? fixedBy[id] + '; ' : '') + f.fixed
  const rows = [...scenarios.values()].map((s) => {
    const passed = s.ran && s.checks.length > 0 && s.checks.every((c) => c.passed)
    const status = !s.ran || s.checks.length === 0 ? 'NOT RUN' : passed ? (fixedBy[s.id] ? 'FIXED' : 'PASS') : 'FAIL'
    return { ...s, status, fixed: fixedBy[s.id] ?? null }
  })
  if (!DRY) writeFileSync(RESULTS, JSON.stringify({ at: new Date().toISOString(), rows, bugs, ...extra }, null, 2))
  return rows
}

/** Who is signed in for a club's chores, by job. */
export const who = {
  president: (c) => ids.staff(c, 1),
  secretary: (c) => ids.staff(c, 2),
  registrar: (c) => ids.staff(c, 3),
  treasurer: (c) => ids.staff(c, 4),
  welfare: (c) => ids.staff(c, 5),
  volunteers: (c) => ids.staff(c, 6),
  compManager: ids.leagueStaff(1),
  refCoordinator: ids.leagueStaff(2),
  discipline: ids.leagueStaff(3),
  grounds: ids.leagueStaff(4),
}
