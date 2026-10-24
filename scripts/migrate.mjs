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

// CLAUDE.md's first rule is that only squadroom-dev may be touched, and a
// connection string is exactly the kind of thing that gets pasted from the
// wrong tab. The ref is hard-coded here rather than read from the
// environment, so there is nothing to get wrong.
const REF = 'rnykncrdcywmetuvslvw'

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
const URL_ = process.env.SUPABASE_DB_URL

if (!TOKEN && !URL_) {
  console.error(`
  No database credential.

  Run  npm run db:setup

  It asks for one thing, works out the rest and checks it before saving.
`)
  process.exit(1)
}

if (URL_ && !URL_.includes(REF)) {
  console.error(`
  That connection string is not squadroom-dev (${REF}).

  Refusing to run. Only ever touch squadroom-dev.
`)
  process.exit(1)
}

const green = (s) => `\x1b[32m${s}\x1b[0m`
const red = (s) => `\x1b[31m${s}\x1b[0m`
const dim = (s) => `\x1b[2m${s}\x1b[0m`

/**
 * Two ways in, one interface.
 *
 * A direct Postgres connection is the better one: it has real transactions,
 * so a migration that fails rolls back cleanly. The Management API is the
 * EASIER one to set up — a token takes one click, where a database password
 * usually has to be reset before anybody can find it — and for a project
 * where the alternative is eight stranded migrations, easier wins.
 *
 * The API path cannot wrap a file in a transaction from the outside, so it
 * wraps it on the inside instead: the SQL is sent as one statement beginning
 * with BEGIN and ending with COMMIT. Postgres treats the whole string as a
 * single implicit transaction either way, which is the property that matters
 * — a half-applied migration is the thing to avoid.
 */
const db = TOKEN ? apiTransport(TOKEN) : pgTransport(URL_)

function pgTransport(url) {
  const client = new pg.Client({
    connectionString: url,
    // The pooler terminates TLS with a certificate this client has no root
    // for. The connection is still encrypted.
    ssl: { rejectUnauthorized: false },
    // A long migration must not be cut off mid-DDL.
    statement_timeout: 300_000,
  })
  return {
    name: 'direct connection',
    atomic: true,
    open: () => client.connect(),
    query: async (sql, params) => (await client.query(sql, params)).rows,
    close: () => client.end(),
  }
}

function apiTransport(token) {
  const endpoint = `https://api.supabase.com/v1/projects/${REF}/database/query`
  return {
    name: 'management API',
    atomic: false,
    open: async () => {},
    query: async (sql, params) => {
      // The endpoint takes no parameters, so the one parameterised call in
      // this script is inlined with proper quoting rather than concatenated.
      const text = params?.length
        ? sql.replace(/\$(\d+)/g, (_, n) => quote(params[Number(n) - 1]))
        : sql
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ query: text }),
      })
      const body = await response.text()
      if (!response.ok) {
        let message = body
        try {
          const parsed = JSON.parse(body)
          message = parsed.message ?? parsed.error ?? body
        } catch {}
        throw new Error(message.slice(0, 2000))
      }
      return body ? JSON.parse(body) : []
    },
    close: async () => {},
  }
}

/** Single-quoted SQL literal, doubling any quote inside it. */
function quote(value) {
  if (value === null || value === undefined) return 'null'
  return `'${String(value).replace(/'/g, "''")}'`
}

await db.open()

const version = await db.query('select current_database() as db')
console.log(`\nConnected to ${version[0]?.db ?? REF} over the ${db.name}\n`)

// The table the Supabase CLI uses, so the two agree about history.
await db.query(`
  create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (
    version text primary key,
    statements text[],
    name text
  );
`)

const done = await db.query('select version from supabase_migrations.schema_migrations')
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
  await db.close()
  process.exit(0)
}

console.log(`  ${applied.size} already applied, ${pending.length} to go:\n`)
for (const { file } of pending) console.log(dim(`    ${file}`))
console.log('')

if (DRY) {
  console.log(dim('  --dry, so nothing was run.\n'))
  await db.close()
  process.exit(0)
}

let count = 0
for (const { version, file } of pending) {
  const sql = readFileSync(`supabase/migrations/${file}`, 'utf8')
  process.stdout.write(`  ${file} … `)
  try {
    if (db.atomic) {
      await db.query('begin')
      await db.query(sql)
      await db.query(
        'insert into supabase_migrations.schema_migrations (version, name) values ($1, $2)',
        [version, file]
      )
      await db.query('commit')
    } else {
      // One request, wrapped on the inside. Sent as separate requests the
      // BEGIN would be in a different session from the DDL and do nothing.
      await db.query(`begin;\n${sql}\n${recordSql(version, file)}\ncommit;`)
    }
    console.log(green('applied'))
    count++
  } catch (error) {
    if (db.atomic) await db.query('rollback').catch(() => {})
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
    await db.close()
    process.exit(1)
  }
}

await db.close()
console.log(green(`\n  ${count} migrations applied.\n`))
console.log(dim('  Next: npm run test:all\n'))

function recordSql(version, file) {
  return (
    'insert into supabase_migrations.schema_migrations (version, name) values (' +
    `${quote(version)}, ${quote(file)});`
  )
}
