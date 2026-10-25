// Run: node scripts/test-project-guard.mjs
//
// Proves that nothing in scripts/ can be aimed at another Supabase project.
//
// This matters because a Supabase personal access token is ACCOUNT-WIDE —
// there is no per-project scoping, so a token that can apply a migration to
// squadroom-dev can apply one to every other project on the account. The only
// thing standing between those two facts is scripts/_project.mjs, and a guard
// nobody tests is a guard nobody should trust.
//
// Needs no credential and touches no network. It is a unit test of the guard.
import { readFileSync, readdirSync } from 'node:fs'
import { PROJECT_REF, endpoint, assertOurs } from './_project.mjs'

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`)
  process.exitCode = 1
}

console.log('\nProject guard\n')

// 1. Every URL it builds names our project.
endpoint().includes(`/v1/projects/${PROJECT_REF}`)
  ? ok('endpoint() targets squadroom-dev')
  : bad(`endpoint() built ${endpoint()}`)

endpoint('database/query') === `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`
  ? ok('and appends a path inside it')
  : bad(endpoint('database/query'))

// 2. A hostile path cannot climb out of it.
for (const attempt of [
  '../../otherproject/database/query',
  '/v1/projects/someoneelse/database/query',
  'database//query',
  '..',
]) {
  try {
    const built = endpoint(attempt)
    bad(`"${attempt}" was allowed and built ${built}`)
  } catch {
    ok(`"${attempt.slice(0, 34)}" refused`)
  }
}

// 3. A connection string for another project is refused.
try {
  assertOurs('postgresql://postgres.someotherproject:pw@aws-0.pooler.supabase.com:5432/postgres')
  bad('another project’s connection string was accepted')
} catch {
  ok('another project’s connection string refused')
}

try {
  assertOurs(`postgresql://postgres.${PROJECT_REF}:pw@aws-0.pooler.supabase.com:5432/postgres`)
  ok('ours accepted')
} catch (error) {
  bad(`ours was refused: ${error.message}`)
}

// 4. And nothing in scripts/ names a project any other way.
//
// The guard only guarantees anything if every caller goes through it. A second
// hard-coded ref somewhere else, or a ref read from an argument, would be a
// hole the tests above cannot see — so this reads the source.
const files = readdirSync('scripts').filter((f) => f.endsWith('.mjs'))
const offenders = []
for (const file of files) {
  if (file === '_project.mjs' || file === 'test-project-guard.mjs') continue
  const source = readFileSync(`scripts/${file}`, 'utf8')

  // A project ref is 20 lowercase letters. Any that is not ours is a problem;
  // ours appearing outside _project.mjs is a duplicate waiting to drift.
  for (const match of source.matchAll(/\b([a-z]{20})\b/g)) {
    const ref = match[1]
    // Ordinary English words of twenty letters do not occur; this is only
    // ever a project id.
    if (ref !== PROJECT_REF) continue
    offenders.push(`${file} hard-codes the project ref — import it from _project.mjs`)
  }

  if (/api\.supabase\.com\/v1\/projects\/\$\{/.test(source) && file !== 'migrate.mjs') {
    offenders.push(`${file} builds a management URL itself instead of using endpoint()`)
  }
}

if (offenders.length === 0) {
  ok(`no script names a project outside _project.mjs (${files.length} checked)`)
} else {
  for (const o of [...new Set(offenders)]) bad(o)
}

console.log(
  process.exitCode
    ? '\n\x1b[31mGUARD HAS A HOLE\x1b[0m\n'
    : '\n\x1b[32mNothing here can reach another project.\x1b[0m\n'
)
process.exit(process.exitCode ?? 0)
