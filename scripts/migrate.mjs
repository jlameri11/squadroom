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
import { PROJECT_REF, PROJECT_NAME, endpoint, assertOurs, confirmProject } from './_project.mjs'

const DRY = process.argv.includes('--dry')

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

// A personal access token is account-wide — Supabase has no per-project
// scoping — so the restriction to squadroom-dev lives in scripts/_project.mjs
// and nowhere else. Proven by scripts/test-project-guard.mjs.
if (URL_) {
  try {
    assertOurs(URL_)
  } catch (error) {
    console.error(`\n  ${error.message}\n`)
    process.exit(1)
  }
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
  const query = endpoint('database/query')
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
      const response = await fetch(query, {
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

// Ask the API which project this is before writing anything to it. The URL
// already cannot name another project; this closes the gap between "the URL
// says ours" and "the thing that answered IS ours".
if (TOKEN) {
  try {
    const project = await confirmProject(TOKEN)
    console.log(`\nConfirmed project ${project.name} (${PROJECT_REF}) in ${project.region}`)
  } catch (error) {
    console.error(`\n  ${red('Refusing to run.')} ${error.message}\n`)
    process.exit(1)
  }
}

await db.open()

const version = await db.query('select current_database() as db')
console.log(`Connected to ${version[0]?.db ?? PROJECT_NAME} over the ${db.name}\n`)

// The table the Supabase CLI uses, so the two agree about history.
await db.query(`
  create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (
    version text primary key,
    statements text[],
    name text
  );
`)

const done = await db.query('select version, name from supabase_migrations.schema_migrations')

/**
 * The name of a migration, without whatever prefix the tool of the day used.
 *
 * Three different things have written this table. The Supabase CLI records a
 * timestamp version with the file's name; the MCP server recorded the name
 * with the numeric prefix STRIPPED, so 0056_screenshot_scans went in as
 * "screenshot_scans"; and one row went in fully prefixed. Comparing raw names
 * said 31 migrations were unapplied when only 11 were — and re-running
 * 0056 onwards against a built database is not a mistake you get to undo.
 *
 * So both sides are normalised to the part that actually identifies the
 * migration.
 */
const identity = (name) => name.replace(/\.sql$/, '').replace(/^\d+[a-z]?_/, '')

const applied = new Set()
for (const row of done) {
  if (row.name) applied.add(identity(row.name))
  if (row.version) applied.add(row.version)
}

const files = readdirSync('supabase/migrations')
  .filter((f) => f.endsWith('.sql'))
  .sort()

// The leading number is the version, so 0080_x.sql is version "0080".
//
// A trailing letter is allowed — 0073a_channel_type_custom.sql exists,
// because a migration had to be inserted after 0073 once 0074 was already
// written. Lexicographic sort puts 0073a after 0073 and before 0074, which is
// exactly where it belongs.
const pending = []
for (const file of files) {
  const version = file.match(/^(\d+[a-z]?)_/)?.[1]
  if (!version) {
    console.error(red(`  ${file} does not start with a number — cannot order it`))
    process.exit(1)
  }
  if (!applied.has(version) && !applied.has(identity(file))) pending.push({ version, file })
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

/**
 * A version in the shape the Supabase CLI writes, so it keeps agreeing with
 * this table: a UTC timestamp, unique per row because it is the primary key.
 */
let stamp = Date.now()
const nextVersion = () => {
  const d = new Date(stamp)
  stamp += 1000
  return (
    d.getUTCFullYear().toString() +
    String(d.getUTCMonth() + 1).padStart(2, '0') +
    String(d.getUTCDate()).padStart(2, '0') +
    String(d.getUTCHours()).padStart(2, '0') +
    String(d.getUTCMinutes()).padStart(2, '0') +
    String(d.getUTCSeconds()).padStart(2, '0')
  )
}

let count = 0
for (const { file } of pending) {
  const sql = readFileSync(`supabase/migrations/${file}`, 'utf8')
  const version = nextVersion()
  const name = file.replace(/\.sql$/, '')

  // ALTER TYPE ... ADD VALUE cannot be wrapped here. In older Postgres it
  // cannot run in a transaction at all, and 0073a exists precisely because it
  // has to be separated from the code that then uses the new label. Run it
  // bare; it is a single idempotent statement, so there is nothing a
  // transaction would protect.
  const bare = /alter\s+type\s+[^;]*add\s+value/i.test(sql)
  process.stdout.write(`  ${file} … `)
  try {
    if (bare) {
      await db.query(sql)
      await db.query(recordSql(version, name))
    } else if (db.atomic) {
      await db.query('begin')
      await db.query(sql)
      await db.query(
        'insert into supabase_migrations.schema_migrations (version, name) values ($1, $2)',
        [version, name]
      )
      await db.query('commit')
    } else {
      // One request, wrapped on the inside. Sent as separate requests the
      // BEGIN would be in a different session from the DDL and do nothing.
      await db.query(`begin;\n${sql}\n${recordSql(version, name)}\ncommit;`)
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
