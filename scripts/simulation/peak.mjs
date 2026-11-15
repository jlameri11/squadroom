// The Saturday-morning peak, at the simulated moment (round 7, 10 am): the
// scale test's spike (scripts/scale/spike.mjs) on the simulated league — 2,000
// parents opening the app, 150 live games ticking, chat lines landing — through
// a pool the size of Supabase's pooler, every call as its person under RLS;
// and the league's own screens timed with EXPLAIN ANALYZE. Writes are rolled
// back, so the season carries on unchanged.
import { clock, note } from './lib.mjs'
import { COMP, LEAGUE } from './world.mjs'

export async function measurePeak(ctx, { opens = 2000, games = 150, pool: POOL = 15 } = {}) {
  const { default: pgmod } = await import('pg')
  const pool = new pgmod.Pool({ host: 'localhost', port: 54329, user: 'postgres', password: 'local', database: 'squadroom_local', max: POOL })
  const lat = {}
  const record = (kind, ms) => (lat[kind] ??= []).push(ms)
  const setup = await pool.connect()
  const begin = async (c, person) => {
    await c.query('begin')
    await c.query(`set local timezone = 'UTC'`)
    await c.query(`select set_config('sim.now', $1, true)`, [clock.iso()])
    if (person) {
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: person, role: 'authenticated' })])
      await c.query('set local role authenticated')
    }
  }
  async function as(person, calls, commit = false) {
    const c = await pool.connect()
    try {
      await begin(c, person)
      for (const [kind, sql, params] of calls) {
        const t = performance.now()
        await c.query(sql, params)
        record(kind, performance.now() - t)
      }
      await c.query('reset role')
      await c.query(commit ? 'commit' : 'rollback')
    } catch (e) {
      await c.query('rollback').catch(() => {})
      record('error', 0)
      if ((lat.error?.length ?? 0) <= 3) note(`peak error: ${e.message}`)
    } finally {
      c.release()
    }
  }
  const out = { calls: 0, seconds: 0, summary: '', table: '' }
  try {
    await setup.query('analyze')
    const { rows: parents } = await setup.query(`
      select pg.profile_id, am.academy_id, pl.team_id,
             (select id from public.channels c where c.team_id = pl.team_id and c.type = 'team') as channel
        from public.player_guardians pg
        join public.players pl on pl.id = pg.player_id
        join public.academy_members am on am.profile_id = pg.profile_id and am.academy_id = pl.academy_id and am.status = 'active'
       where pg.is_primary limit 4000`)
    // The games on now: the ones kicking off within the hour, with their coach and chat.
    await begin(setup, null)
    const { rows: gs } = await setup.query(`
      select e.id, e.team_id, e.academy_id,
             (select tm.profile_id from public.team_members tm where tm.team_id = e.team_id and tm.role = 'coach' limit 1) as coach,
             (select c.id from public.channels c where c.team_id = e.team_id and c.type = 'team') as chan,
             (select tm.profile_id from public.team_members tm where tm.team_id = e.team_id and tm.role = 'parent' limit 1) as parent
        from public.events e join public.fixtures f on f.id = e.fixture_id
       where f.competition_id = $1 and f.status = 'scheduled' and e.cancelled_at is null
         and e.starts_at between now() - interval '50 minutes' and now() + interval '70 minutes'
       order by e.starts_at limit $2`, [COMP, games])
    await setup.query('commit')
    // Kick-offs, committed (a tick needs its game kicked off).
    await Promise.all(gs.filter((g) => g.coach).map((g) => as(g.coach, [['live: kick-off', `select public.live_tick($1, 'kick_off')`, [g.id]]], true)))
    delete lat['live: kick-off']

    const tasks = []
    for (let i = 0; i < opens; i++) {
      const p = parents[(i * 7919) % parents.length]
      const calls = [
        ['home_screen', 'select public.home_screen($1)', [p.academy_id]],
        ['home_layout', 'select public.home_layout($1)', [p.academy_id]],
        ['needs_you', 'select public.needs_you($1)', [p.academy_id]],
        ['home_jobs', 'select public.home_jobs($1)', [p.academy_id]],
        ['nav_badges', 'select public.nav_badges($1)', [p.academy_id]],
        ['home_competitions', 'select public.home_competitions($1)', [p.academy_id]],
      ]
      if (i % 10 < 4 && p.channel) {
        calls.push(['channel_screen', 'select public.channel_screen($1)', [p.channel]])
        calls.push(['mark_channel_read', 'select public.mark_channel_read($1)', [p.channel]])
      }
      if (i % 10 === 5) calls.push(['fixtures_screen', 'select public.fixtures_screen(21, $1)', [p.academy_id]])
      tasks.push(() => as(p.profile_id, calls))
    }
    for (const g of gs) {
      if (!g.coach) continue
      for (let k = 0; k < 4; k++) tasks.push(() => as(g.coach, [['live: goal', `select public.live_tick($1, $2)`, [g.id, k % 2 ? 'goal_for' : 'goal_against']]]))
      for (let k = 0; k < 5; k++) {
        if (!g.parent || !g.chan) continue
        tasks.push(() => as(g.parent, [['chat: line', `insert into public.messages (academy_id, channel_id, sender_id, body) values ($1, $2, $3, 'GOAL! What a strike.')`, [g.academy_id, g.chan, g.parent]]]))
      }
    }
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
    out.calls = calls
    out.seconds = Math.round(wall / 100) / 10
    const lines = [`| call | n | p50 ms | p95 ms | p99 ms |`, `|---|---|---|---|---|`]
    for (const [k, xs] of Object.entries(lat).sort()) {
      if (k === 'error') continue
      lines.push(`| ${k} | ${xs.length} | ${pct(xs, 0.5).toFixed(1)} | ${pct(xs, 0.95).toFixed(1)} | ${pct(xs, 0.99).toFixed(1)} |`)
    }
    // The league's and the clubs' own screens, timed by Postgres.
    const explain = async (person, sql, params) => {
      const c = await pool.connect()
      try {
        await begin(c, person)
        const r = await c.query(`explain (analyze, format json) ${sql}`, params)
        await c.query('rollback')
        return r.rows[0]['QUERY PLAN'][0]['Execution Time']
      } catch (e) {
        await c.query('rollback').catch(() => {})
        return NaN
      } finally { c.release() }
    }
    const leagueOwner = (await setup.query(`select profile_id from public.academy_members where academy_id = $1 and role = 'owner' limit 1`, [LEAGUE])).rows[0].profile_id
    const coach = (await setup.query(`select profile_id from public.team_members where role = 'coach' limit 1`)).rows[0].profile_id
    const owner = (await setup.query(`select am.profile_id, am.academy_id from public.academy_members am join public.academies a on a.id = am.academy_id where am.role = 'owner' and a.type = 'club' order by (select count(*) from public.academy_members x where x.academy_id = am.academy_id) desc limit 1`)).rows[0]
    const screens = [
      ['league', leagueOwner, 'home_jobs', `select public.home_jobs($1, 'league')`, [LEAGUE]],
      ['league', leagueOwner, 'competition_run_sheet', `select count(*) from public.competition_run_sheet($1, null)`, [COMP]],
      ['league', leagueOwner, 'competition_ladder', `select count(*) from public.competition_ladder($1, 'U11 Division 1')`, [COMP]],
      ['league', leagueOwner, 'competition_appointments', `select public.competition_appointments($1, null)`, [COMP]],
      ['league', leagueOwner, 'admin_hub', `select public.admin_hub($1)`, [LEAGUE]],
      ['coach', coach, 'home_jobs', `select public.home_jobs($1, 'coach')`, [(await setup.query(`select academy_id from public.team_members where profile_id = $1 limit 1`, [coach])).rows[0].academy_id]],
      ['owner (biggest club)', owner.profile_id, 'home_jobs', `select public.home_jobs($1, 'owner')`, [owner.academy_id]],
      ['owner (biggest club)', owner.profile_id, 'admin_hub', `select public.admin_hub($1)`, [owner.academy_id]],
      ['owner (biggest club)', owner.profile_id, 'outstanding_fees', `select count(*) from public.outstanding_fees($1)`, [owner.academy_id]],
      ['stranger', null, 'public_competition_entry', `select public.public_competition_entry('spl-season-4')`, []],
    ]
    const sl = [`| as | screen | median ms |`, `|---|---|---|`]
    for (const [whoLabel, person, name, sql, params] of screens) {
      const runs = []
      for (let i = 0; i < 3; i++) runs.push(await explain(person, sql, params))
      const med = runs.sort((a, b) => a - b)[1]
      sl.push(`| ${whoLabel} | ${name} | ${Number.isNaN(med) ? 'refused' : med.toFixed(1)}${med > 100 ? ' ◀' : ''} |`)
    }
    const homeKinds = ['home_screen', 'home_layout', 'needs_you', 'home_jobs', 'nav_badges', 'home_competitions']
    const perOpen = homeKinds.reduce((s, k) => s + (lat[k] ?? []).reduce((a, b) => a + b, 0), 0) / opens
    out.summary = `Round 7, Saturday 10 am (${clock.local()}): ${opens} parents open the app (Home's six calls; four in ten open their chat; one in ten Fixtures) while ${gs.length} games take kick-offs, goals and chat lines, through a pool of ${POOL} — ${calls} calls in ${out.seconds} s, ${(calls / (wall / 1000)).toFixed(0)} calls a second${lat.error ? `, ${lat.error.length} errors` : ''}. An open of Home costs ${perOpen.toFixed(1)} ms of database time under this load.`
    out.table = lines.join('\n') + '\n\nThe league\'s and the clubs\' screens at that moment (Postgres execution time, median of 3):\n\n' + sl.join('\n')
    console.log(`  ${out.summary}`)
  } finally {
    await setup.query(`update public.events set cancelled_at = cancelled_at where false`).catch(() => {})
    setup.release()
    await pool.end()
  }
  return out
}
