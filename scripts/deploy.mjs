// Run: node scripts/deploy.mjs                 build + check, upload nothing
//      node scripts/deploy.mjs --deploy        build + check + deploy to production
//      node scripts/deploy.mjs --sync-env      put the RUNTIME variables into Netlify's environment
//      node scripts/deploy.mjs --check-env     say which runtime variables Netlify is missing
//
// Deploy hygiene (Joey, 10 Nov 2026). The 9 Nov deploy bundled .env.local
// into .netlify/functions-internal: Next's standalone output copies the
// project's env files so the server can read them at runtime, the Netlify
// runtime ships that output, and so every secret on the laptop — the
// tools-only SUPABASE_ACCESS_TOKEN and NETLIFY_AUTH_TOKEN among them — went
// up with the app. Netlify's own environment held only the public
// variables; the live site was reading its secrets out of the copied file.
//
// The rules this script enforces:
//   1. The app's runtime variables live in Netlify's environment settings
//      (--sync-env copies exactly the allow-list below from .env.local, and
//      sets NEXT_PUBLIC_SITE_URL to the site itself, never to localhost).
//      Tools-only secrets are never synced.
//   2. The build runs with every env file hidden and a minimal process
//      environment, so the only variables it sees are Netlify's.
//   3. The bundle is scanned (scripts/check-bundle-secrets.mjs) for any env
//      file, any local secret value and any tools-only assignment; a hit
//      aborts before anything is uploaded.
//   4. Nothing is uploaded unless --deploy is given. Production deploys are
//      Joey's call (CLAUDE.md: milestone + green run, never Sat/Sun).
//
// NETLIFY_AUTH_TOKEN is read from .env.local for the CLI's own process only;
// it is in the build's process environment too (the CLI inherits it), which
// is why the scan looks for its value in the output.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { checkBundle, localSecrets, TOOLS_ONLY } from './check-bundle-secrets.mjs'

const ROOT = process.cwd()
const HIDE_DIR = join(ROOT, '.deploy-hidden')
const SITE_URL = 'https://squadroom-dev.netlify.app'
const args = new Set(process.argv.slice(2))

/**
 * What the running app reads (grep process.env across app, lib, netlify).
 * Public ones are inlined at build time; the rest the server reads at
 * runtime from Netlify's environment. Nothing else is ever set there.
 */
const RUNTIME_PUBLIC = ['NEXT_PUBLIC_SITE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_VAPID_PUBLIC_KEY']
const RUNTIME_SECRET = [
  'SUPABASE_SERVICE_ROLE_KEY', 'PUSH_WAKE_SECRET', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT',
  'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'ANTHROPIC_API_KEY',
  'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_VERIFY_SERVICE_SID', 'TWILIO_FROM_NUMBER',
  'RESEND_API_KEY', 'MAIL_FROM',
  'APNS_KEY_ID', 'APNS_TEAM_ID', 'APNS_BUNDLE_ID', 'APNS_PRIVATE_KEY', 'APNS_ENVIRONMENT', 'FCM_SERVICE_ACCOUNT',
]
/** Must be present in Netlify for the site to work at all. The rest are optional features. */
const REQUIRED = ['NEXT_PUBLIC_SITE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY']

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`)
const note = (m) => console.log(`  \x1b[2m${m}\x1b[0m`)
const fail = (m) => { bad(m); process.exit(1) }

function readEnvFile(path) {
  const out = new Map()
  if (!existsSync(path)) return out
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out.set(m[1], v)
  }
  return out
}

const local = readEnvFile(join(ROOT, '.env.local'))
const token = local.get('NETLIFY_AUTH_TOKEN')
if (!token) fail('NETLIFY_AUTH_TOKEN is not in .env.local — it goes under NEEDS JOEY and the deploy waits')
const siteId = JSON.parse(readFileSync(join(ROOT, '.netlify/state.json'), 'utf8')).siteId
if (!siteId) fail('.netlify/state.json has no siteId — link the site first')

/** The CLI's environment: the token and what a shell needs, nothing of ours. */
const cliEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  TMPDIR: process.env.TMPDIR ?? '/tmp',
  LANG: process.env.LANG ?? 'en_AU.UTF-8',
  SHELL: process.env.SHELL ?? '/bin/zsh',
  NETLIFY_AUTH_TOKEN: token,
  NETLIFY_SITE_ID: siteId,
  CI: '1',
}

function netlify(cmdArgs, { capture = false } = {}) {
  const r = spawnSync('npx', ['netlify-cli', ...cmdArgs], {
    cwd: ROOT,
    env: cliEnv,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return r
}

/** The NAMES set in Netlify's environment — values are never read here. */
function netlifyEnvNames() {
  // The production context: secrets live only there, and the default
  // listing (the dev context) would report every one of them missing.
  const r = netlify(['env:list', '--json', '--context', 'production'], { capture: true })
  if (r.status !== 0) fail(`netlify env:list failed: ${(r.stderr || '').split('\n').slice(0, 3).join(' ')}`)
  const parsed = JSON.parse(r.stdout)
  return new Set(Array.isArray(parsed) ? parsed.map((e) => e.key ?? e.name) : Object.keys(parsed))
}

function checkEnv() {
  const names = netlifyEnvNames()
  const missingRequired = REQUIRED.filter((k) => !names.has(k))
  // An empty line in .env.local (TWILIO_…= with nothing after it) is not set.
  const missingOptional = RUNTIME_SECRET.filter((k) => !names.has(k) && Boolean(local.get(k)) && !REQUIRED.includes(k))
  const toolsThere = TOOLS_ONLY.filter((k) => names.has(k))
  if (toolsThere.length) bad(`tools-only secrets are set in Netlify: ${toolsThere.join(', ')} — unset them`)
  if (missingRequired.length) bad(`Netlify is missing: ${missingRequired.join(', ')}`)
  else ok(`Netlify has every required variable (${REQUIRED.length})`)
  if (missingOptional.length) bad(`set on this laptop but not in Netlify: ${missingOptional.join(', ')} — those features go dark on deploy (run --sync-env)`)
  else ok('every runtime variable this laptop has is in Netlify too')
  return missingRequired.length === 0 && toolsThere.length === 0 && missingOptional.length === 0
}

function syncEnv() {
  const names = netlifyEnvNames()
  let set = 0
  for (const k of [...RUNTIME_PUBLIC, ...RUNTIME_SECRET]) {
    if (TOOLS_ONLY.includes(k)) continue
    // The site's own address, never the laptop's.
    const value = k === 'NEXT_PUBLIC_SITE_URL' ? SITE_URL : local.get(k)
    if (!value) continue
    const secret = !k.startsWith('NEXT_PUBLIC_') && k !== 'VAPID_SUBJECT' && k !== 'MAIL_FROM' && k !== 'APNS_ENVIRONMENT' && k !== 'APNS_BUNDLE_ID'
    // Netlify will only hold a secret value in a non-development context;
    // production is the one context this site deploys to.
    const r = netlify(['env:set', k, value, ...(secret ? ['--secret', '--context', 'production'] : [])], { capture: true })
    if (r.status !== 0) {
      bad(`${k}: ${(r.stderr || r.stdout || '').split('\n').find((l) => l.trim()) ?? 'failed'}`)
      continue
    }
    set++
    ok(`${names.has(k) ? 'updated' : 'set'} ${k}${secret ? ' (secret)' : ''}`)
  }
  note(`${set} runtime variables in Netlify's environment; tools-only secrets (${TOOLS_ONLY.join(', ')}) never`)
}

/** Every env file out of the way, so the build sees only Netlify's variables. */
function hideEnvFiles() {
  mkdirSync(HIDE_DIR, { recursive: true })
  const moved = []
  for (const f of readdirSync(ROOT)) {
    if (/^\.env(\..+)?$/.test(f) && f !== '.env.local.example') {
      renameSync(join(ROOT, f), join(HIDE_DIR, f))
      moved.push(f)
    }
  }
  return moved
}
function restoreEnvFiles(moved) {
  for (const f of moved) {
    const from = join(HIDE_DIR, f)
    if (existsSync(from)) renameSync(from, join(ROOT, f))
  }
  if (existsSync(HIDE_DIR) && readdirSync(HIDE_DIR).length === 0) rmSync(HIDE_DIR, { recursive: true, force: true })
}

function portInUse(port) {
  const r = spawnSync('lsof', ['-ti', `:${port}`], { encoding: 'utf8' })
  return (r.stdout || '').trim().length > 0
}

// ---------------------------------------------------------------------------
if (args.has('--check-env')) {
  process.exit(checkEnv() ? 0 : 1)
}
if (args.has('--sync-env')) {
  syncEnv()
  process.exit(checkEnv() ? 0 : 1)
}

console.log('\nDeploy — build with Netlify’s variables only, scan the bundle, then upload (or not)\n')
if (!checkEnv()) fail('fix Netlify’s environment first (node scripts/deploy.mjs --sync-env)')
if (portInUse(3000)) fail('the dev server holds port 3000 and shares .next with the build — stop it first')

// A clean slate: the previous output may hold the copied env file.
for (const dir of ['.next', '.netlify/functions-internal', '.netlify/edge-functions-dist', '.netlify/deploy', '.netlify/v1', '.netlify/static', '.netlify/functions']) {
  rmSync(join(ROOT, dir), { recursive: true, force: true })
}

const moved = hideEnvFiles()
ok(`hidden for the build: ${moved.join(', ') || 'no env files'}`)
const restore = () => restoreEnvFiles(moved)
process.on('SIGINT', () => { restore(); process.exit(130) })
process.on('SIGTERM', () => { restore(); process.exit(143) })

let built = false
try {
  const r = netlify(['build', '--context', 'production'])
  built = r.status === 0
} finally {
  restore()
  ok('env files restored')
}
if (!built) fail('the build failed; nothing uploaded')

// The scan, with the env files back so their values are the needles.
const secrets = localSecrets(ROOT)
let hits = 0
for (const b of ['.netlify', '.next']) {
  const { missing, hits: h } = checkBundle(join(ROOT, b), secrets, { root: ROOT })
  if (missing) { note(`${b}: not built`); continue }
  for (const x of h) bad(`${x.file} — ${x.why}`)
  hits += h.length
  if (h.length === 0) ok(`${b}: no env file, none of ${secrets.size} secret values, no tools-only assignment`)
}
if (hits > 0) fail(`${hits} secret(s) in the bundle — NOT deployed`)

if (!args.has('--deploy')) {
  console.log('\n  built and checked; nothing uploaded (add --deploy to publish)\n')
  process.exit(0)
}

const d = netlify(['deploy', '--prod', '--no-build'])
if (d.status !== 0) fail('the upload failed')
console.log(`\n  \x1b[32mdeployed to ${SITE_URL}\x1b[0m — log it in docs/NIGHT_LOG.md (Deploys)\n`)
