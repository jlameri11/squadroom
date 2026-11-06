// Run: node --env-file=.env.local scripts/local-db/copy-dev.mjs
//   after: node scripts/local-db/run.mjs --until 0207
//   then:  node scripts/local-db/run.mjs --keep --from 0208 --rls
//
// The demo's rows, copied from squadroom-dev into the local Postgres — so the
// pending migrations run on top of real data, backfills and all, exactly as
// they will on token day, and test-rls.sql has the people, squads, chats and
// competitions its checks are written about.
//
// READ-ONLY on squadroom-dev: it selects through the REST API with the
// service role and never writes there. Rows land in the local database with
// triggers paused (session_replication_role = replica): they are a snapshot
// of what the triggers already did on dev, and running them again would
// double it. Columns dev has and local does not are dropped; columns local
// has and dev does not (the pending migrations') take their defaults.
import { createClient } from '@supabase/supabase-js'
import { join } from 'node:path'

const ROOT = process.cwd()
const DATA = join(ROOT, '.local-db')
const PORT = 54329
const DB = 'squadroom_local'
const green = (s) => `\x1b[32m${s}\x1b[0m`
const red = (s) => `\x1b[31m${s}\x1b[0m`
const dim = (s) => `\x1b[2m${s}\x1b[0m`

const { default: EmbeddedPostgres } = await import('embedded-postgres').catch(() => {
  console.log(red('  embedded-postgres is not installed — see scripts/local-db/run.mjs'))
  process.exit(2)
})
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const pg = new EmbeddedPostgres({ databaseDir: DATA, user: 'postgres', password: 'local', port: PORT, persistent: true, onLog: () => {}, onError: () => {} })
await pg.start()
const client = pg.getPgClient(DB)
await client.connect()

async function insertRows(schema, table, rows, cols) {
  if (rows.length === 0) return 0
  const keep = cols.filter((c) => c.name in rows[0])
  if (keep.length === 0) return 0
  let n = 0
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200)
    const values = []
    const tuples = chunk.map((row) => {
      const ph = keep.map((c) => {
        let v = row[c.name]
        if (v !== null && v !== undefined && (c.type === 'json' || c.type === 'jsonb')) v = JSON.stringify(v)
        values.push(v === undefined ? null : v)
        return `$${values.length}`
      })
      return `(${ph.join(', ')})`
    })
    const sql = `insert into ${schema}.${table} (${keep.map((c) => `"${c.name}"`).join(', ')}) values ${tuples.join(', ')} on conflict do nothing`
    const res = await client.query(sql, values)
    n += res.rowCount
  }
  return n
}

async function columnsOf(schema, table) {
  const { rows } = await client.query(
    `select column_name as name, data_type as type, is_generated, identity_generation
       from information_schema.columns where table_schema = $1 and table_name = $2`,
    [schema, table]
  )
  return rows.filter((c) => c.is_generated !== 'ALWAYS' && c.identity_generation !== 'ALWAYS')
}

let failures = 0
try {
  await client.query('set session_replication_role = replica')

  // auth.users — the people.
  const users = []
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw new Error(`auth users: ${error.message}`)
    users.push(...data.users)
    if (data.users.length < 1000) break
  }
  const authCols = await columnsOf('auth', 'users')
  const authRows = users.map((u) => ({
    id: u.id, email: u.email ?? null, phone: u.phone || null, aud: u.aud, role: u.role ?? 'authenticated',
    email_confirmed_at: u.email_confirmed_at ?? null, phone_confirmed_at: u.phone_confirmed_at ?? null,
    raw_user_meta_data: u.user_metadata ?? {}, raw_app_meta_data: u.app_metadata ?? {},
    created_at: u.created_at, updated_at: u.updated_at ?? u.created_at,
  }))
  console.log(`  auth.users ${await insertRows('auth', 'users', authRows, authCols)}`)

  // storage.buckets — their names and rules; no files.
  const { data: buckets } = await admin.storage.listBuckets()
  const bucketCols = await columnsOf('storage', 'buckets')
  console.log(`  storage.buckets ${await insertRows('storage', 'buckets', (buckets ?? []).map((b) => ({ id: b.id, name: b.name, public: b.public, file_size_limit: b.file_size_limit ?? null, allowed_mime_types: b.allowed_mime_types ?? null })), bucketCols)}`)

  // Every public table, page by page.
  const { rows: tables } = await client.query(
    `select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`
  )
  let total = 0
  for (const { table_name: t } of tables) {
    const cols = await columnsOf('public', t)
    const rows = []
    let error = null
    for (let from = 0; ; from += 1000) {
      const res = await admin.from(t).select('*').range(from, from + 999)
      if (res.error) {
        error = res.error
        break
      }
      rows.push(...res.data)
      if (res.data.length < 1000) break
    }
    if (error) {
      // A table the pending migrations add is not on dev yet; anything else is worth saying.
      if (!/does not exist|schema cache/i.test(error.message)) {
        failures += 1
        console.log(red(`  ${t}: ${error.message}`))
      }
      continue
    }
    try {
      const n = await insertRows('public', t, rows, cols)
      total += n
      if (n) console.log(dim(`  ${t} ${n}`))
    } catch (e) {
      failures += 1
      console.log(red(`  ${t}: ${e.message}`))
    }
  }

  // Sequences after the explicit ids.
  const { rows: seqs } = await client.query(
    `select c.table_schema, c.table_name, c.column_name, pg_get_serial_sequence(format('%I.%I', c.table_schema, c.table_name), c.column_name) as seq
       from information_schema.columns c
      where c.table_schema in ('public', 'auth') and (c.column_default like 'nextval%' or c.identity_generation is not null)`
  )
  for (const s of seqs) {
    if (!s.seq) continue
    await client.query(`select setval($1, greatest(1, coalesce((select max("${s.column_name}") from ${s.table_schema}."${s.table_name}"), 1)))`, [s.seq])
  }
  await client.query('set session_replication_role = origin')
  console.log((failures ? red : green)(`  copied ${total} rows from squadroom-dev (read-only)${failures ? `, ${failures} tables failed` : ''}`))
} finally {
  await client.end()
  await pg.stop()
}
process.exitCode = failures ? 1 : 0
