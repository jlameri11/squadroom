// Run: node scripts/check-bundle-secrets.mjs [--bundle .netlify] [--bundle .next]
//
// The pre-deploy check (Joey, 10 Nov 2026). The 9 Nov deploy bundled
// .env.local into .netlify/functions-internal — the Netlify Next runtime
// copies the project's env files into the server handler — and with it the
// tools-only secrets (SUPABASE_ACCESS_TOKEN, NETLIFY_AUTH_TOKEN) and the
// runtime ones (ANTHROPIC_API_KEY, the service-role key…). Nothing in a build
// should carry a secret: the server reads its variables from Netlify's
// environment at runtime, and the only values that belong in a bundle are the
// NEXT_PUBLIC_* ones, which are public by design.
//
// So this fails the deploy if the build output holds:
//   1. any file named .env* (whatever is in it), or
//   2. the VALUE of any non-public variable from the local env files
//      (.env.local, .env*.local), or
//   3. a tools-only variable NAME with an assignment (NAME=…) — the shape of a
//      copied env file even when the values differ from the local ones.
//
// Exit 0 when clean, 1 on any hit, 2 when the bundle is missing. The values
// themselves are never printed — only the variable's name and the file.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const args = process.argv.slice(2)
const bundles = []
for (let i = 0; i < args.length; i++) if (args[i] === '--bundle') bundles.push(args[++i])
if (bundles.length === 0) bundles.push('.netlify', '.next')

/** The variables only our tools use. Never needed by the running app. */
export const TOOLS_ONLY = ['SUPABASE_ACCESS_TOKEN', 'NETLIFY_AUTH_TOKEN', 'SUPABASE_DB_PASSWORD', 'SUPABASE_DB_URL']

/** Name → value for every non-public variable in the local env files. */
export function localSecrets(root = process.cwd()) {
  const out = new Map()
  const files = readdirSync(root).filter((f) => /^\.env(\..+)?\.local$/.test(f) || f === '.env.local')
  for (const f of files) {
    for (const line of readFileSync(join(root, f), 'utf8').split('\n')) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/)
      if (!m) continue
      const name = m[1]
      let value = m[2].trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
      if (name.startsWith('NEXT_PUBLIC_')) continue
      // Short values (a port, a flag, a region) would match everywhere and
      // mean nothing; a secret is long.
      if (value.length < 12) continue
      if (!out.has(name)) out.set(name, value)
    }
  }
  return out
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' && !p.includes('functions-internal')) continue
      yield* walk(p)
    } else if (entry.isFile()) {
      yield p
    }
  }
}

export function checkBundle(dir, secrets, { root = process.cwd() } = {}) {
  const hits = []
  if (!existsSync(dir)) return { missing: true, hits }
  const needles = [...secrets.entries()]
  const assignment = new RegExp(`(^|[^A-Z0-9_])(${TOOLS_ONLY.join('|')})\\s*=`, 'm')
  for (const file of walk(dir)) {
    const rel = relative(root, file)
    const base = file.split('/').pop()
    if (/^\.env(\..*)?$/.test(base)) hits.push({ file: rel, why: 'an env file' })
    const size = statSync(file).size
    if (size > 64 * 1024 * 1024) continue
    let text
    try {
      text = readFileSync(file, 'latin1')
    } catch {
      continue
    }
    for (const [name, value] of needles) {
      if (text.includes(value)) hits.push({ file: rel, why: `the value of ${name}` })
    }
    const m = text.match(assignment)
    if (m) hits.push({ file: rel, why: `an assignment of ${m[2]}` })
  }
  return { missing: false, hits }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const secrets = localSecrets()
  let total = 0
  let missing = 0
  for (const b of bundles) {
    const { missing: m, hits } = checkBundle(b, secrets)
    if (m) {
      console.log(`  \x1b[2m${b}: not built\x1b[0m`)
      missing++
      continue
    }
    if (hits.length === 0) {
      console.log(`  \x1b[32m✓\x1b[0m ${b}: no env file, none of ${secrets.size} secret values, no tools-only assignment`)
      continue
    }
    total += hits.length
    for (const h of hits) console.log(`  \x1b[31m✗\x1b[0m ${h.file} — ${h.why}`)
  }
  if (total > 0) {
    console.log(`\n  \x1b[31mSECRETS IN THE BUNDLE (${total}). Do not deploy this build.\x1b[0m\n`)
    process.exit(1)
  }
  if (missing === bundles.length) {
    console.log('\n  nothing to check — build first\n')
    process.exit(2)
  }
  console.log('\n  \x1b[32mthe bundle carries no secrets\x1b[0m\n')
}
