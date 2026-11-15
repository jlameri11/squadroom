// Run: node scripts/simulation/q.mjs "select …"
// A query against the local Postgres WHILE the season is running (season.mjs
// holds the embedded server; sql.mjs would try to start a second one).
// Connects over TCP to the running instance on 54329 and prints the rows.
import pg from 'pg'
const c = new pg.Client({ host: 'localhost', port: 54329, user: 'postgres', password: 'local', database: 'squadroom_local' })
await c.connect()
try {
  const r = await c.query(process.argv.slice(2).join(' '))
  const last = Array.isArray(r) ? r[r.length - 1] : r
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
