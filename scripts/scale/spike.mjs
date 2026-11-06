// Run: node scripts/scale/spike.mjs [--opens 2000] [--games 300] [--pool 15]
//   after the dataset is loaded (scripts/scale/seed.sql)
//
// The Saturday 8 am spike (Joey, 5 Nov 2026), against the database: 2,000
// parents opening the app — Home's five calls, and for four in ten the
// chat as well — while 300 live games each take a kick-off, goals and chat
// lines, all at once, through a pool the size of Supabase's pooler. Each call
// runs as its person, under their RLS. Writes are rolled back, so the run can
// be repeated on the same data.
//
// It reports how long the whole morning took, calls a second, latency
// percentiles per kind of call, and the database time an open costs — the
// figure the plan for launch is worked out from (docs/SCALE.md).
import { createHash } from 'node:crypto'
import { join } from 'node:path'

const ROOT = process.cwd()
const arg = (name, dflt) => (process.argv.includes(name) ? Number(process.argv[process.argv.indexOf(name) + 1]) : dflt)
const OPENS = arg('--opens', 2000)
const GAMES = arg('--games', 300)
const POOL = arg('--pool', 15)

const { default: EmbeddedPostgres } = await import('embedded-postgres').catch(() => {
  console.log('  embedded-postgres is not installed — see scripts/local-db/run.mjs')
  process.exit(2)
})
const { default: pgmod } = await import('pg')
const sid = (t) => {
  const h = createHash('md5').update(t).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

const pg = new EmbeddedPostgres({ databaseDir: join(ROOT, '.local-db'), user: 'postgres', password: 'local', port: 54329, persistent: true, onLog: () => {}, onError: () => {} })
await pg.start()
const pool = new pgmod.Pool({ host: 'localhost', port: 54329, user: 'postgres', password: 'local', database: 'squadroom_local', max: POOL })
const setup = await pool.connect()
const lat = {}
const record = (kind, ms) => (lat[kind] ??= []).push(ms)

async function as(person, calls, commit = false) {
  const c = await pool.connect()
  try {
    await c.query('begin')
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: person, role: 'authenticated' })])
    await c.query('set local role authenticated')
    for (const [kind, sql, params] of calls) {
      const t = performance.now()
      await c.query(sql, params)
      record(kind, performance.now() - t)
    }
    await c.query(commit ? 'commit' : 'rollback')
  } catch (e) {
    await c.query('rollback').catch(() => {})
    record('error', 0)
    if ((lat.error?.length ?? 0) <= 3) console.log(`  error: ${e.message}`)
  } finally {
    c.release()
  }
}

let games = []
try {
  // Who opens: parents with a child in a squad, and the squad's channel.
  const { rows: parents } = await setup.query(`
    select pg.profile_id, am.academy_id, pl.team_id,
           (select id from public.channels c where c.team_id = pl.team_id and c.type = 'team') as channel
      from public.player_guardians pg
      join public.players pl on pl.id = pg.player_id
      join public.academy_members am on am.profile_id = pg.profile_id and am.status = 'active'
     where pg.is_primary and am.academy_id in (select id from public.academies where slug like 'scale-club-%')`)
  // 300 games kicking off now, one per squad, with their coach.
  await setup.query('set session_replication_role = origin')
  const { rows: gs } = await setup.query(`
    insert into public.events (academy_id, team_id, type, title, opponent, starts_at, ends_at)
    select t.academy_id, t.id, 'match', 'SPIKE live', 'Opponents', now() - interval '5 minutes', now() + interval '55 minutes'
      from public.teams t where t.name like '%Squad %' order by t.id limit $1
    returning id, team_id, academy_id`, [GAMES])
  for (const g of gs) {
    const { rows: [coach] } = await setup.query(`select profile_id from public.team_members where team_id = $1 and role = 'coach' limit 1`, [g.team_id])
    const { rows: [chan] } = await setup.query(`select id from public.channels where team_id = $1 and type = 'team'`, [g.team_id])
    const { rows: [fam] } = await setup.query(`select profile_id from public.team_members where team_id = $1 and role = 'parent' limit 1`, [g.team_id])
    games.push({ ...g, coach: coach.profile_id, chan: chan.id, parent: fam?.profile_id })
  }
  // Kick-offs, committed (a tick needs its game kicked off).
  await Promise.all(games.map((g) => as(g.coach, [['live: kick-off', `select public.live_tick($1, 'kick_off')`, [g.id]]], true)))
  delete lat['live: kick-off']

  const tasks = []
  for (let i = 0; i < OPENS; i++) {
    const p = parents[(i * 7919) % parents.length]
    const calls = [
      ['home_screen', 'select public.home_screen($1)', [p.academy_id]],
      ['home_layout', 'select public.home_layout($1)', [p.academy_id]],
      ['needs_you', 'select public.needs_you($1)', [p.academy_id]],
      ['home_jobs', 'select public.home_jobs($1)', [p.academy_id]],
      ['nav_badges', 'select public.nav_badges($1)', [p.academy_id]],
    ]
    if (i % 10 < 4) {
      calls.push(['chat_screen', 'select public.chat_screen($1)', [p.academy_id]])
      calls.push(['channel_messages', 'select count(*) from public.channel_messages($1, null, 50)', [p.channel]])
      calls.push(['mark_channel_read', 'select public.mark_channel_read($1)', [p.channel]])
    }
    tasks.push(() => as(p.profile_id, calls))
  }
  for (const g of games) {
    for (let k = 0; k < 4; k++) tasks.push(() => as(g.coach, [['live: goal', `select public.live_tick($1, $2)`, [g.id, k % 2 ? 'goal_for' : 'goal_against']]]))
    for (let k = 0; k < 5; k++) {
      if (!g.parent) continue
      tasks.push(() => as(g.parent, [['chat: line', `insert into public.messages (academy_id, channel_id, sender_id, body) values ($1, $2, $3, 'GOAL! What a strike.')`, [g.academy_id, g.chan, g.parent]]]))
    }
  }
  // Shuffled, so opens and live games arrive together, as on a Saturday.
  for (let i = tasks.length - 1; i > 0; i--) {
    const j = (i * 104729) % (i + 1)
    ;[tasks[i], tasks[j]] = [tasks[j], tasks[i]]
  }

  const t0 = performance.now()
  let next = 0
  await Promise.all(Array.from({ length: POOL }, async () => {
    while (next < tasks.length) await tasks[next++]()
  }))
  const wall = performance.now() - t0

  const pct = (xs, p) => xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))]
  const calls = Object.entries(lat).filter(([k]) => k !== 'error').reduce((n, [, xs]) => n + xs.length, 0)
  console.log(`\n  ${OPENS} opens + ${games.length} live games (${tasks.length} sessions, ${calls} calls) through a pool of ${POOL}`)
  console.log(`  all of it in ${(wall / 1000).toFixed(1)} s — ${(calls / (wall / 1000)).toFixed(0)} calls a second${lat.error ? `, ${lat.error.length} errors` : ''}\n`)
  console.log(`  ${'call'.padEnd(20)}${'n'.padStart(7)}${'p50 ms'.padStart(9)}${'p95 ms'.padStart(9)}${'p99 ms'.padStart(9)}`)
  for (const [k, xs] of Object.entries(lat).sort()) {
    if (k === 'error') continue
    console.log(`  ${k.padEnd(20)}${String(xs.length).padStart(7)}${pct(xs, 0.5).toFixed(1).padStart(9)}${pct(xs, 0.95).toFixed(1).padStart(9)}${pct(xs, 0.99).toFixed(1).padStart(9)}`)
  }
  const homeKinds = ['home_screen', 'home_layout', 'needs_you', 'home_jobs', 'nav_badges']
  const perOpen = homeKinds.reduce((s, k) => s + (lat[k] ?? []).reduce((a, b) => a + b, 0), 0) / OPENS
  console.log(`\n  an open of Home costs ${perOpen.toFixed(1)} ms of database time on average, under this load`)
} finally {
  await setup.query(`delete from public.events where title = 'SPIKE live'`).catch(() => {})
  setup.release()
  await pool.end()
  await pg.stop()
}
