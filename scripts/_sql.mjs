// Run a read-only query against squadroom-dev through the management API.
//
//   node --env-file=.env.local scripts/_sql.mjs "select now()"
//
// Goes through `endpoint()` so it cannot be aimed at another project. Used by
// the sweep scripts and for asking the catalog what is TRUE, which a grep of
// the migrations cannot do.
import { endpoint } from './_project.mjs'

export async function runSql(text) {
  const token = process.env.SUPABASE_ACCESS_TOKEN
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is not in .env.local')
  const response = await fetch(endpoint('database/query'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: text }),
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 500)}`)
  return JSON.parse(body)
}

if (process.argv[1]?.endsWith('_sql.mjs') && process.argv[2]) {
  const rows = await runSql(process.argv[2])
  console.log(JSON.stringify(rows, null, 2))
}
