// Run: npm run types
//
// Regenerates lib/database.types.ts from the live schema.
//
// This exists because the one-liner it replaces was
//
//   supabase gen types typescript --project-id … > lib/database.types.ts
//
// and the shell opens that redirect BEFORE the command runs. So any failure
// — an expired token, no network, a Supabase hiccup — truncates the file to
// zero bytes first and fails second. The result is a repository where every
// table and function has silently stopped existing, and the first symptom is
// a type error in a file nobody touched. That happened.
//
// So: generate to a temporary file, check it looks like the thing it is
// meant to be, and only then replace the real one.
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { PROJECT_REF } from './_project.mjs'

const OUT = 'lib/database.types.ts'
const TMP = `${OUT}.new`

const green = (s) => `\x1b[32m${s}\x1b[0m`
const red = (s) => `\x1b[31m${s}\x1b[0m`

const result = spawnSync(
  'npx',
  ['supabase', 'gen', 'types', 'typescript', '--project-id', PROJECT_REF],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
)

if (result.status !== 0) {
  console.error(red('\n  Could not generate types.\n'))
  console.error(`  ${(result.stderr || result.error?.message || '').trim().slice(0, 500)}\n`)
  console.error('  The existing file has been left alone.\n')
  process.exit(1)
}

const generated = result.stdout ?? ''

// Three cheap checks, each one a way the output has actually been wrong:
// empty (the command failed), an error page (a proxy answered instead), and
// a schema with no functions (the token can see the project but not query).
if (generated.trim().length === 0) {
  console.error(red('\n  Supabase returned nothing. The existing file has been left alone.\n'))
  process.exit(1)
}
if (!generated.includes('export type Database')) {
  console.error(red('\n  That output is not a types file:\n'))
  console.error(`  ${generated.trim().slice(0, 300)}\n`)
  process.exit(1)
}

const before = existsSync(OUT) ? readFileSync(OUT, 'utf8') : ''
const countTables = (text) => (text.match(/Row: \{/g) ?? []).length

// A schema does not normally shrink. When it does it is worth a human
// looking, because the usual cause is pointing at the wrong project or a
// migration that dropped more than it meant to.
const was = countTables(before)
const now = countTables(generated)
if (before && now < was * 0.9) {
  console.error(
    red(`\n  The new schema is much smaller than the old one (${now} vs ${was} tables).\n`)
  )
  console.error('  Refusing to overwrite. Check the project and the migrations first.\n')
  writeFileSync(TMP, generated)
  console.error(`  The new output is in ${TMP} if you want to look at it.\n`)
  process.exit(1)
}

writeFileSync(TMP, generated)
writeFileSync(OUT, generated)
unlinkSync(TMP)

console.log(
  green(`\n  ${OUT} — ${now} tables, ${(generated.match(/Args: \{/g) ?? []).length} functions.\n`)
)
