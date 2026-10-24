// Run: node --env-file=.env.local scripts/migrate.mjs [--dry]
//
// Applies the SQL files in supabase/migrations that this database has not
// seen, in order, each in its own transaction.
//
// WHY THIS EXISTS. Migrations were applied through the Supabase MCP
// connection, and when that went down there was no other route: no psql, no
// Supabase CLI, no Docker, no brew on this machine. Six migrations sat written
// and unapplied across two sessions, which meant six fixes that could not be
// tested and a product whose schema no longer matched its repository. A single
// tool being unavailable should not be able to do that.
//
// It needs SUPABASE_DB_URL — the Session pooler URI from the dashboard's
// Connect button. The service-role key cannot do this: that is a PostgREST
// credential and PostgREST does not run DDL.
//
// WHAT IT RECORDS. `supabase_migrations.schema_migrations` is the table the
// Supabase CLI itself uses, so this stays compatible with it — run `supabase
// db push` later and it will agree about what has been applied.
//
// Each file runs inside BEGIN/COMMIT. A migration that fails leaves the
// database exactly as it was rather than half-changed, which matters most for
// the ones that add a trigger and then backfill with it disabled.
import { readdirSync, readFileSync } from 'node:fs'
import pg from 'pg'

const DRY = process.argv.includes('--dry')
const URL_ = process.env.SUPABASE_DB_URL

if (!URL_) {
  console.error(`
  SUPABASE_DB_URL is not set.

  Supabase dashboard → the "Connect" button at the top of the project (the
  strings are no longer under Settings → Database) → Session pooler → copy
  the URI, put your database password in it, and add it to .env.local:

    SUPABASE_DB_URL=postgresql://postgres.<ref>:<password>@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres
`)
  process.exit(1)
}

// Guard against ever pointing this at the wrong project. CLAUDE.md's first
// rule is that only squadroom-dev may be touched, and a connection string is
// exactly the kind of thing that gets pasted from the wrong tab.
const EXPECTED_REF = 'rnykncrdcywmetuvslvw'
if (!URL_.includes(EXPECTED_REF)) {
  console.error(`
  That connection string is not squadroom-dev (${EXPECTED_REF}).

  Refusing to run. Only ever touch squadroom-dev.
`)
  process.exit(1)
}

const green = (s) => `\x1b[32m${s}\x1b[0m`
const red = (s) => `\x1b[31m${s}\x1b[0m`
const dim = (s) => `\x1b[2m${s}\x1b[0m`

const client = new pg.Client({
  connectionString: URL_,
  // The pooler terminates TLS with a certificate this client does not have a
  // root for. The connection is still encrypted.
  ssl: { rejectUnauthorized: false },
  // A long migration should not be cut off mid-DDL.
  statement_timeout: 300_000,
})

await client.connect()

const { rows: version } = await client.query('select current_database() as db, version()')
console.log(`\nConnected to ${version[0].db}\n`)

// The table the Supabase CLI uses, so the two agree about history.
await client.query(`
  create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (
    version text primary key,
    statements text[],
    name text
  );
`)

const { rows: done } = await client.query(
  'select version from supabase_migrations.schema_migrations'
)
const applied = new Set(done.map((r) => r.version))

const files = readdirSync('supabase/migrations')
  .filter((f) => f.endsWith('.sql'))
  .sort()

// The leading number is the version, so 0080_x.sql is version "0080". Files
// are named consistently in this repo; anything else is a mistake worth
// stopping for rather than guessing at.
const pending = []
for (const file of files) {
  const version = file.match(/^(\d+)_/)?.[1]
  if (!version) {
    console.error(red(`  ${file} does not start with a number — cannot order it`))
    process.exit(1)
  }
  if (!applied.has(version)) pending.push({ version, file })
}

if (pending.length === 0) {
  console.log(green(`  Up to date — all ${files.length} migrations applied.\n`))
  await client.end()
  process.exit(0)
}

console.log(`  ${applied.size} already applied, ${pending.length} to go:\n`)
for (const { file } of pending) console.log(dim(`    ${file}`))
console.log('')

if (DRY) {
  console.log(dim('  --dry, so nothing was run.\n'))
  await client.end()
  process.exit(0)
}

let count = 0
for (const { version, file } of pending) {
  const sql = readFileSync(`supabase/migrations/${file}`, 'utf8')
  process.stdout.write(`  ${file} … `)
  try {
    await client.query('begin')
    await client.query(sql)
    await client.query(
      'insert into supabase_migrations.schema_migrations (version, name) values ($1, $2)',
      [version, file]
    )
    await client.query('commit')
    console.log(green('applied'))
    count++
  } catch (error) {
    await client.query('rollback').catch(() => {})
    console.log(red('failed'))
    console.error(`\n  ${red(error.message)}`)
    if (error.position) {
      // The character offset is useless on its own; the line it lands on is
      // what you need to look at.
      const upto = sql.slice(0, Number(error.position))
      const line = upto.split('\n').length
      console.error(dim(`  at line ${line}: ${sql.split('\n')[line - 1]?.trim()}`))
    }
    if (error.hint) console.error(dim(`  hint: ${error.hint}`))
    console.error(
      `\n  ${red('Stopped.')} ${count} applied, ${pending.length - count} left. The database is` +
        '\n  exactly as it was before this file — the transaction rolled back.\n'
    )
    await client.end()
    process.exit(1)
  }
}

await client.end()
console.log(green(`\n  ${count} migrations applied.\n`))
console.log(dim('  Next: node --env-file=.env.local scripts/test-all.mjs\n'))
