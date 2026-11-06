// Run: node scripts/local-db/sql.mjs "select …"        one statement, rows printed
//      node scripts/local-db/sql.mjs -f path/to/file.sql  a file, in one transaction
//
// SQL against the local Postgres that run.mjs builds (.local-db/), for
// looking around and for the scale work. Starts it if needed and stops it
// after. Never connects to Supabase.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const { default: EmbeddedPostgres } = await import('embedded-postgres').catch(() => {
  console.log('  embedded-postgres is not installed — see scripts/local-db/run.mjs')
  process.exit(2)
})
const args = process.argv.slice(2)
const sql = args[0] === '-f' ? readFileSync(args[1], 'utf8') : args.join(' ')
if (!sql.trim()) {
  console.log('  usage: node scripts/local-db/sql.mjs "select 1"   |   -f file.sql')
  process.exit(2)
}

const pg = new EmbeddedPostgres({ databaseDir: join(ROOT, '.local-db'), user: 'postgres', password: 'local', port: 54329, persistent: true, onLog: () => {}, onError: () => {} })
await pg.start()
const client = pg.getPgClient('squadroom_local')
await client.connect()
try {
  const t = Date.now()
  const res = await client.query(args[0] === '-f' ? `begin;\n${sql}\ncommit;` : sql)
  // A file's results end with its COMMIT: show the last one that has rows.
  const all = Array.isArray(res) ? res : [res]
  const last = [...all].reverse().find((r) => r?.rows?.length) ?? all[all.length - 1]
  if (last?.rows?.length) {
    const cols = last.fields.map((f) => f.name)
    const widths = cols.map((c) => Math.min(60, Math.max(c.length, ...last.rows.map((r) => String(r[c] ?? '').length))))
    console.log(cols.map((c, i) => c.padEnd(widths[i])).join('  '))
    for (const r of last.rows) console.log(cols.map((c, i) => String(r[c] ?? '').slice(0, 60).padEnd(widths[i])).join('  '))
  }
  console.log(`\x1b[2m  ${last?.rowCount ?? 0} rows · ${Date.now() - t} ms\x1b[0m`)
} catch (e) {
  console.log(`\x1b[31m  ${e.message}\x1b[0m${e.where ? `\n  ${e.where.split('\n')[0]}` : ''}`)
  process.exitCode = 1
} finally {
  await client.end()
  await pg.stop()
}
