// Run: node --env-file=.env.local scripts/test-rls.mjs
//
// Runs scripts/test-rls.sql and reports it like every other suite, so that
// `npm run test:all` runs it — which is how "after every migration" stops
// being a rule somebody remembers and starts being one the runner enforces.
//
// It goes through the management API with SUPABASE_ACCESS_TOKEN, the same
// transport `npm run db:migrate` uses, and the same guard: `_project.mjs` is
// the only place that knows which project is ours, and `confirmProject`
// refuses anything else before a byte of SQL is sent.
//
// ONE REQUEST, on purpose. The SQL file builds a temp table, fills it inside
// a DO block and selects from it at the end. The management API gives each
// request its own session, so splitting that into "run" and then "read the
// results" would read from a temp table that no longer exists. The whole
// file goes in one body, and the two trailing selects are replaced with one
// that puts any FAIL first.
import { readFileSync } from 'node:fs'
import { endpoint, confirmProject } from './_project.mjs'

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`)
  process.exitCode = 1
}

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
if (!TOKEN) {
  console.log('  no SUPABASE_ACCESS_TOKEN — run  npm run db:setup')
  process.exit(2)
}
await confirmProject(TOKEN)

const sql = readFileSync(new URL('./test-rls.sql', import.meta.url), 'utf8').replace(
  /select \* from rls_results order by n;[\s\S]*$/,
  "select n, check_name, result from rls_results order by (result like 'FAIL%') desc, n;"
)

const response = await fetch(endpoint('database/query'), {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
  body: JSON.stringify({ query: sql }),
})
const text = await response.text()

let rows
try {
  rows = JSON.parse(text)
} catch {
  rows = null
}
if (!response.ok || !Array.isArray(rows)) {
  // The SQL itself failed — a check raised outside its own exception block,
  // or a role switch was refused. That is a defect in the suite or the
  // schema, and either way the message is the whole report.
  const message = rows?.message ?? text
  bad(`test-rls.sql did not complete: ${String(message).slice(0, 400)}`)
  process.exit(1)
}

console.log('\nRLS and permission checks')
let failing = 0
for (const row of rows) {
  const pass = String(row.result).startsWith('PASS')
  if (pass) ok(`${row.n}. ${row.check_name}`)
  else {
    bad(`${row.n}. ${row.check_name} — ${row.result}`)
    failing++
  }
}

console.log(
  failing
    ? `\n\x1b[31m${failing} of ${rows.length} checks failing\x1b[0m\n`
    : `\n\x1b[32mall ${rows.length} checks pass\x1b[0m\n`
)
