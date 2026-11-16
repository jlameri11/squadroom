// Run: node scripts/simulation/q.mjs "select …"
// A query against the local Postgres WHILE the season is running (season.mjs
// holds the embedded server; sql.mjs would try to start a second one).
// Connects over TCP to the running instance on 54329 and prints the rows.
//   node scripts/simulation/q.mjs -f path/to/file.sql    runs a file (a migration, say) as one script
import { readFileSync } from 'node:fs'
import pg from 'pg'
const c = new pg.Client({ host: 'localhost', port: 54329, user: 'postgres', password: 'local', database: 'squadroom_local' })
await c.connect()
try {
  const argv = process.argv.slice(2)
  const text = argv[0] === '-f' ? readFileSync(argv[1], 'utf8') : argv.join(' ')
  const r = await c.query(text)
  const all = Array.isArray(r) ? r : [r]
  const last = [...all].reverse().find((x) => x?.rows?.length) ?? all[all.length - 1]
  if (last.rows?.length) {
    const cols = last.fields.map((f) => f.name)
    console.log(cols.join('  '))
    for (const row of last.rows) console.log(cols.map((k) => String(row[k] ?? '')).join('  '))
  }
  console.log(`  ${last.rowCount ?? 0} rows`)
} catch (e) {
  console.log(`  ${e.message}`)
  process.exitCode = 1
} finally {
  await c.end()
}
