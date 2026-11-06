// Run: node scripts/scale/measure.mjs [--explain <function>]
//   after: node scripts/local-db/run.mjs && node scripts/local-db/sql.mjs -f scripts/scale/seed.sql
//
// The database half of the scale test (Joey, 5 Nov 2026), on the local
// Postgres holding the big dataset (scripts/scale/seed.sql): every function
// behind a key screen, called AS the person who uses it — a parent, a coach,
// a club owner, the league — under their RLS, three times; Postgres's own
// execution time (EXPLAIN ANALYZE), median reported. Nothing is committed:
// each call runs in a transaction that is rolled back.
//
// --explain <function>: the plans of every statement inside that function
// (auto_explain, nested), for the slow ones.
//
// Local timings are the database's work alone — no network, no API — which
// is exactly what an index or a rewritten policy changes.
import { createHash } from 'node:crypto'
import { join } from 'node:path'

const ROOT = process.cwd()
const args = process.argv.slice(2)
const explainFn = args.includes('--explain') ? args[args.indexOf('--explain') + 1] : null
const { default: EmbeddedPostgres } = await import('embedded-postgres').catch(() => {
  console.log('  embedded-postgres is not installed — see scripts/local-db/run.mjs')
  process.exit(2)
})
const sid = (t) => {
  const h = createHash('md5').update(t).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

const logs = []
const pg = new EmbeddedPostgres({
  databaseDir: join(ROOT, '.local-db'), user: 'postgres', password: 'local', port: 54329, persistent: true,
  onLog: (m) => logs.push(String(m)), onError: (m) => logs.push(String(m)),
})
await pg.start()
const client = pg.getPgClient('squadroom_local')
await client.connect()

const one = async (sql, params = []) => (await client.query(sql, params)).rows[0]
try {
  await client.query('analyze')

  const club = sid('scale-club-1')
  const league = sid('scale-league')
  const comp = sid('scale-comp')
  // A parent whose child plays in squad 1 — entered in the league, so the
  // game page, the ladder and the notices all apply to them.
  const team1 = sid('scale-team-1')
  const { profile_id: parent } = await one(`select pg.profile_id from public.player_guardians pg join public.players pl on pl.id = pg.player_id where pl.team_id = $1 and pg.is_primary order by pg.profile_id limit 1`, [team1])
  const coach = sid('scale-staff-1-3')
  const owner = sid('scale-staff-1-1')
  const leagueOwner = sid('scale-league-owner')
  const kid = await one(`select pl.id, pl.team_id from public.player_guardians pg join public.players pl on pl.id = pg.player_id where pg.profile_id = $1 limit 1`, [parent])
  const chan = await one(`select id from public.channels where team_id = $1 and type = 'team'`, [kid.team_id])
  const msgIds = (await client.query(`select id from public.messages where channel_id = $1 order by created_at desc limit 50`, [chan.id])).rows.map((r) => r.id)
  const training = await one(`select id from public.events where team_id = $1 and title = 'Training' and starts_at > now() order by starts_at limit 1`, [kid.team_id])
  const coachTeam = await one(`select team_id from public.team_members where profile_id = $1 and role = 'coach' limit 1`, [coach])
  const coachEvent = await one(`select id from public.events where team_id = $1 and starts_at > now() order by starts_at limit 1`, [coachTeam.team_id])
  const game = await one(`select e.id from public.events e where e.fixture_id is not null and e.team_id = $1 order by abs(extract(epoch from e.starts_at - now())) limit 1`, [kid.team_id])
  const notices = await one(`select id from public.channels where type = 'notices' and competition_id = $1`, [comp])

  const CASES = [
    ['parent', parent, 'home_screen', 'select public.home_screen($1)', [club]],
    ['parent', parent, 'home_layout', 'select public.home_layout($1)', [club]],
    ['parent', parent, 'needs_you', 'select public.needs_you($1)', [club]],
    ['parent', parent, 'home_jobs', 'select public.home_jobs($1)', [club]],
    ['parent', parent, 'nav_badges', 'select public.nav_badges($1)', [club]],
    ['parent', parent, 'chat_screen', 'select public.chat_screen($1)', [club]],
    ['parent', parent, 'channel_messages', 'select count(*) from public.channel_messages($1, null, 50)', [chan.id]],
    ['parent', parent, 'reaction_counts', 'select count(*) from public.reaction_counts($1::uuid[])', [msgIds]],
    ['parent', parent, 'fixtures_screen', 'select public.fixtures_screen(21, $1)', [club]],
    ['parent', parent, 'my_upcoming_events', 'select count(*) from public.my_upcoming_events($1, 21)', [club]],
    ['parent', parent, 'event_live', 'select public.event_live($1)', [game?.id ?? training.id]],
    ['parent', parent, 'search_chat', `select public.search_chat('Saturday', 20, $1)`, [club]],
    ['coach', coach, 'home_screen', 'select public.home_screen($1)', [club]],
    ['coach', coach, 'home_jobs', 'select public.home_jobs($1)', [club]],
    ['coach', coach, 'nav_badges', 'select public.nav_badges($1)', [club]],
    ['coach', coach, 'event_rsvp_summary', 'select count(*) from public.event_rsvp_summary($1)', [coachEvent.id]],
    ['coach', coach, 'availability_grid', 'select public.availability_grid($1, 4, 2)', [coachTeam.team_id]],
    ['owner', owner, 'home_screen', 'select public.home_screen($1)', [club]],
    ['owner', owner, 'needs_you', 'select public.needs_you($1)', [club]],
    ['owner', owner, 'nav_badges', 'select public.nav_badges($1)', [club]],
    ['league', leagueOwner, 'competition_ladder', `select count(*) from public.competition_ladder($1, 'Division 1')`, [comp]],
    ['league', leagueOwner, 'nav_badges', 'select public.nav_badges($1)', [league]],
    ['league', leagueOwner, 'notices_reach', 'select count(*) from public.notices_reach($1, $2::uuid[])', [notices.id, []]],
  ]

  const asPerson = async (person, sql, params, explain) => {
    await client.query('begin')
    try {
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: person, role: 'authenticated' })])
      await client.query('set local role authenticated')
      if (explain) {
        await client.query('reset role')
        await client.query(`load 'auto_explain'`)
        await client.query(`set local auto_explain.log_min_duration = 0`)
        await client.query(`set local auto_explain.log_nested_statements = on`)
        await client.query(`set local auto_explain.log_analyze = on`)
        await client.query(`set local auto_explain.log_buffers = on`)
        await client.query('set local role authenticated')
      }
      const res = await client.query(`explain (analyze, format json) ${sql}`, params)
      return res.rows[0]['QUERY PLAN'][0]['Execution Time']
    } finally {
      await client.query('rollback')
    }
  }

  // Writes, with their triggers: what a notice, a chat line, an answer and
  // a score tap cost the database — fan-out to every recipient included.
  const writeCase = async (label, person, setup, sql, params) => {
    const runs = []
    for (let i = 0; i < 3; i++) {
      await client.query('begin')
      try {
        const extra = setup ? await setup() : []
        await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: person, role: 'authenticated' })])
        await client.query('set local role authenticated')
        const res = await client.query(`explain (analyze, format json) ${sql}`, [...params, ...extra])
        const plan = res.rows[0]['QUERY PLAN'][0]
        runs.push({ ms: plan['Execution Time'], triggers: (plan.Triggers ?? []).map((t) => `${t['Trigger Name']} ${t.Time.toFixed(1)}`) })
      } finally {
        await client.query('rollback')
      }
    }
    runs.sort((a, b) => a.ms - b.ms)
    const med = runs[1]
    console.log(`  ${label.padEnd(30)}${med.ms.toFixed(1).padStart(10)}${med.ms > 100 ? '  ◀' : ''}${med.triggers.length ? `   ${med.triggers.filter((t) => parseFloat(t.split(' ').pop()) > 1).join(', ')}` : ''}`)
  }
  const people = await one(`select count(*)::int as n from app_private.notices_people($1)`, [comp])
  const squadSize = await one(`select count(*)::int as n from public.channel_members where channel_id = $1`, [chan.id])

  if (!explainFn) {
    console.log(`\n  writes                        median ms   (triggers over 1 ms)`)
    await writeCase(`league notice → ${people.n} people`, leagueOwner, null,
      `insert into public.messages (academy_id, channel_id, sender_id, body, audience) values ($1, $2, $3, 'Round 7 is off — grounds closed.', 'everyone')`,
      [league, notices.id, leagueOwner])
    await writeCase('league notice, club staff only', leagueOwner, null,
      `insert into public.messages (academy_id, channel_id, sender_id, body, audience) values ($1, $2, $3, 'Team sheets due Monday.', 'club_staff')`,
      [league, notices.id, leagueOwner])
    await writeCase(`squad chat line → ${squadSize.n} members`, coach, null,
      `insert into public.messages (academy_id, channel_id, sender_id, body) values ($1, $2, $3, 'Training is on tonight.')`,
      [club, (await one(`select id from public.channels where team_id = $1 and type = 'team'`, [coachTeam.team_id])).id, coach])
    await writeCase('parent answers a session', parent, null,
      `insert into public.event_rsvps (academy_id, event_id, profile_id, player_id, status) values ($1, $2, $3, $4, 'yes')
       on conflict (event_id, profile_id, player_id) do update set status = excluded.status`,
      [club, training.id, parent, kid.id])
    // A match kicking off now, made inside the transaction and rolled back.
    await writeCase('live score tap (goal)', coach, async () => {
      const ev = await one(`insert into public.events (academy_id, team_id, type, title, opponent, starts_at, ends_at)
                            values ($1, $2, 'match', 'SCALE live', 'Opponents', now() - interval '20 minutes', now() + interval '40 minutes') returning id`,
                           [club, coachTeam.team_id])
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: coach, role: 'authenticated' })])
      await client.query('set local role authenticated')
      await client.query(`select public.live_tick($1, 'kick_off')`, [ev.id])
      await client.query('reset role')
      return [ev.id]
    }, `select public.live_tick($1, 'goal_against')`, [])
  }

  if (explainFn) {
    const [fnName, who] = explainFn.split(':')
    const c = CASES.find((k) => k[2] === fnName && (!who || k[0] === who))
    if (!c) throw new Error(`no case for ${explainFn}`)
    logs.length = 0
    const ms = await asPerson(c[1], c[3], c[4], true)
    console.log(`  ${c[2]} as ${c[0]}: ${ms.toFixed(1)} ms\n`)
    // auto_explain writes each nested statement's plan to the server log.
    const text = logs.join('\n')
    const plans = text.split(/(?=duration: [\d.]+ ms\s+plan:)/).filter((b) => b.startsWith('duration'))
    plans.sort((a, b) => parseFloat(b.slice(10)) - parseFloat(a.slice(10)))
    for (const p of plans.slice(0, 6)) console.log(p.split('\n').slice(0, 40).join('\n') + '\n---')
  } else {
    console.log(`  ${'as'.padEnd(8)}${'function'.padEnd(22)}${'median ms'.padStart(10)}`)
    const rows = []
    for (const [who, person, name, sql, params] of CASES) {
      const runs = []
      for (let i = 0; i < 3; i++) runs.push(await asPerson(person, sql, params, false))
      const med = runs.sort((a, b) => a - b)[1]
      rows.push({ who, name, med })
      console.log(`  ${who.padEnd(8)}${name.padEnd(22)}${med.toFixed(1).padStart(10)}${med > 100 ? '  ◀' : ''}`)
    }
  }
} catch (e) {
  console.log(`\x1b[31m  ${e.message}\x1b[0m`)
  process.exitCode = 1
} finally {
  await client.end()
  await pg.stop()
}
