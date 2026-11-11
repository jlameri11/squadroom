// Run: node scripts/scale/message-the-club.mjs [--people 2000]
//   after: node scripts/local-db/run.mjs && node scripts/local-db/sql.mjs -f scripts/scale/seed.sql
//
// Big Club Mode, Phase 1's definition of done: "Message the club" to 2,000
// people queues instantly and delivers in batches — proven on the local big
// dataset. The first club of the dataset is swollen to the size asked for
// (families borrowed from the other clubs), its owner sends one message to
// the whole club and the clock stops when the tap returns. Then the worker
// (fan_out_club_messages — cron's job, every minute) is run by hand, pass by
// pass: five hundred pushes a pass, the message 'sending' until the last
// pass and 'sent' after it; every recipient queued once; never the sender;
// a pass too many queues nobody twice.
//
// LOCAL ONLY — the embedded Postgres, never Supabase. Everything happens in
// one transaction that is rolled back, so the dataset is as it was.
import { createHash } from 'node:crypto'
import { join } from 'node:path'

const ROOT = process.cwd()
const args = process.argv.slice(2)
const PEOPLE = Number(args.includes('--people') ? args[args.indexOf('--people') + 1] : 2000)
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const head = (m) => console.log(`\n${m}`)
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
const timed = async (sql, params = []) => {
  const t = performance.now()
  const res = await client.query(sql, params)
  return { res, ms: Math.round(performance.now() - t) }
}

const club = sid('scale-club-1')
const owner = sid('scale-staff-1-1')
const BODY = 'Hawthorne Reserve is closed this Saturday — every game there is off. The league has been told; watch here for the new dates.'
try {
  await client.query('begin')
  head(`1. A club of ${PEOPLE.toLocaleString()}`)
  const before = await one(`select count(*)::int as n from public.academy_members where academy_id = $1 and status = 'active'`, [club])
  const need = Math.max(0, PEOPLE - before.n)
  const { ms: borrowMs } = await timed(`
    insert into public.academy_members (academy_id, profile_id, role, status)
    select $1, am.profile_id, 'parent', 'active'
      from (select distinct on (profile_id) profile_id from public.academy_members
             where academy_id <> $1 and role = 'parent' and status = 'active' order by profile_id) am
     where not exists (select 1 from public.academy_members x where x.academy_id = $1 and x.profile_id = am.profile_id)
     limit $2
    on conflict do nothing`, [club, need])
  const members = await one(`select count(*)::int as n from public.academy_members where academy_id = $1 and status = 'active'`, [club])
  members.n >= PEOPLE
    ? ok(`${before.n} members; ${need.toLocaleString()} families borrowed from the other clubs in ${borrowMs} ms — ${members.n.toLocaleString()} in all`)
    : bad(`${members.n} members`)

  head('2. The owner taps Send')
  // A club requires two-step sign-in of its owners (0231): without the
  // second proof an owner's hats are hidden and the gate says no. This
  // session proved an authenticator code (aal2), as the app's does.
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: owner, role: 'authenticated', aal: 'aal2' })])
  await client.query('set local role authenticated')
  const preview = await timed(`select public.preview_club_message($1, '{"kind":"club"}'::jsonb) as p`, [club])
  const reach = preview.res.rows[0].p?.count
  reach === members.n - 1
    ? ok(`"This will reach ${reach.toLocaleString()} people" in ${preview.ms} ms`)
    : bad(`preview: ${JSON.stringify(preview.res.rows[0].p)} in ${preview.ms} ms`)
  const sent = await timed(`select public.send_club_message($1, $2, '{"kind":"club"}'::jsonb, true) as id`, [club, BODY])
  const id = sent.res.rows[0].id
  sent.ms < 1500 ? ok(`the tap returned in ${sent.ms} ms`) : bad(`the tap took ${sent.ms} ms`)
  await client.query('reset role')
  const row = await one(`select status, recipient_count from public.club_messages where id = $1`, [id])
  row.status === 'queued' && row.recipient_count === reach
    ? ok(`queued for ${row.recipient_count.toLocaleString()}; not one push sent yet`)
    : bad(JSON.stringify(row))
  const queuedNow = await one(`select count(*)::int as n from public.notification_queue where dedupe_key like $1`, [`club:${id}:%`])
  queuedNow.n === 0 ? ok('the notification queue holds nothing of it until the worker comes') : bad(`${queuedNow.n} queued at once`)

  head('3. The worker, pass by pass')
  const passes = Math.ceil(reach / 500)
  let told = 0
  for (let i = 1; i <= passes + 1; i++) {
    const pass = await timed(`select public.fan_out_club_messages() as n`)
    const now = await one(`select count(*)::int as n from public.notification_queue where dedupe_key like $1`, [`club:${id}:%`])
    const added = now.n - told
    told = now.n
    const st = await one(`select status from public.club_messages where id = $1`, [id])
    if (i <= passes) {
      const expect = Math.min(500, reach - 500 * (i - 1))
      const want = i < passes ? 'sending' : 'sent'
      added === expect && st.status === want
        ? ok(`pass ${i}: ${added} queued in ${pass.ms} ms — ${st.status}`)
        : bad(`pass ${i}: ${added} queued (wanted ${expect}), ${st.status} (wanted ${want}) in ${pass.ms} ms`)
    } else {
      added === 0 && st.status === 'sent' ? ok('a pass too many queues nobody twice') : bad(`extra pass: ${added} more, ${st.status}`)
    }
  }
  const people = await one(
    `select count(distinct profile_id)::int as n,
            count(*) filter (where profile_id = $2)::int as sender,
            count(*) filter (where scheduled_for > now() + interval '1 minute')::int as held
       from public.notification_queue where dedupe_key like $1`, [`club:${id}:%`, owner])
  people.n === reach && people.sender === 0
    ? ok(`${people.n.toLocaleString()} people told once each, never the sender${people.held ? `; ${people.held} held for the morning (quiet hours)` : ''}`)
    : bad(JSON.stringify(people))
} catch (e) {
  bad(`threw: ${e.message}`)
} finally {
  await client.query('rollback').catch(() => {})
  await client.end()
  await pg.stop()
}
console.log(process.exitCode ? '\n\x1b[31mMESSAGE THE CLUB DOES NOT SCALE\x1b[0m\n' : '\n\x1b[32mall good\x1b[0m\n')
