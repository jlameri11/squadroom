// Run: node --env-file=.env.local scripts/time-screens.mjs
//   TIME_BASE=http://localhost:3100   (default; a production build — npm run serve:test)
//   RUNS=3                            (cold + warm visits per screen; the median is reported)
//   JSON=path                         (also write the numbers there)
//
// The first half of the scale test (Joey, 5 Nov: "time the key screens —
// parent Home, Chat, Fixtures, Admin, ladder, match centre — target under 1
// second each"). Not a pass/fail suite, which is why it is not test-*: on
// the dev data it finds the screens that do too much — too many requests,
// requests one after another that could be one — and on the big dataset
// (once the Supabase token and a branch exist, NEEDS JOEY #18) the same
// numbers say whether a screen holds up.
//
// For each screen, as the person who uses it, in a fresh browser (cold:
// nothing cached) and again in the same one (warm: what opening the app the
// second time is like):
//   ready     ms from navigation until the loading skeleton has gone AND no
//             request to the database has been in flight for 400 ms;
//   requests  calls to the database (REST, RPC, auth, storage) on the way;
//   slowest   the single slowest of them;
//   repeated  the same call made more than once for one screen — the
//             pattern that turns 50 messages into 50 requests.
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'
import { writeFileSync } from 'node:fs'
import { signInBoth } from './_auth.mjs'

const BASE = process.env.TIME_BASE ?? 'http://localhost:3100'
const RUNS = Math.max(1, Number(process.env.RUNS ?? 3))
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPA = new URL(URL_).host
const ref = SUPA.split('.')[0]
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const SPL_ORG = '00000000-0000-0000-0000-0000000a0003'
const U8 = '00000000-0000-0000-0000-0000000d0008'

const probe = await fetch(`${BASE}/signin`).catch(() => null)
if (!probe?.ok) {
  console.log(`  nothing answers at ${BASE} — start a production build first: npm run serve:test`)
  process.exit(2)
}

const { data: u8chat } = await admin.from('channels').select('id').eq('team_id', U8).eq('type', 'team').single()
const { data: game } = await admin.from('events').select('id').eq('team_id', U8).eq('type', 'match').is('cancelled_at', null)
  .gte('starts_at', new Date().toISOString()).order('starts_at').limit(1).maybeSingle()
const { data: spl } = await admin.from('competitions').select('id').eq('name', 'SPL Season 3').single()
const { data: pub } = await admin.from('competitions').select('public_slug').not('public_slug', 'is', null).not('published_at', 'is', null).limit(1).maybeSingle()

const who = {
  parent: await signInBoth(admin, 'p61400000011@squadroom.invalid'),
  coach: await signInBoth(admin, 'p61400000002@squadroom.invalid'),
  owner: await signInBoth(admin, 'joeylameri@outlook.com'),
  league: await signInBoth(admin, 'p61400000301@squadroom.invalid'),
}
if (Object.values(who).some((p) => !p)) {
  console.log("  could not sign everyone in — the project's auth rate limit")
  process.exit(2)
}

const SCREENS = [
  { name: 'Home', as: 'parent', path: '/', org: NRIFA },
  { name: 'Chat list', as: 'parent', path: '/chat', org: NRIFA },
  { name: 'U8 chat', as: 'parent', path: `/chat/${u8chat.id}`, org: NRIFA },
  { name: 'Fixtures', as: 'parent', path: '/calendar', org: NRIFA },
  ...(game ? [{ name: 'Next game', as: 'parent', path: `/calendar/${game.id}`, org: NRIFA }] : []),
  { name: 'Home', as: 'coach', path: '/', org: NRIFA },
  { name: 'Admin', as: 'coach', path: '/admin', org: NRIFA },
  { name: 'Admin', as: 'owner', path: '/admin', org: NRIFA },
  { name: 'Ladder', as: 'league', path: `/competitions/${spl.id}?tab=ladder`, org: SPL_ORG },
  ...(pub ? [{ name: 'Match centre', as: 'stranger', path: `/c/${pub.public_slug}`, org: null }] : []),
]

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })

function kindOf(u) {
  const p = new URL(u).pathname
  if (p.startsWith('/rest/v1/rpc/')) return `rpc ${p.slice('/rest/v1/rpc/'.length)}`
  if (p.startsWith('/rest/v1/')) return `rest ${p.slice('/rest/v1/'.length)}`
  if (p.startsWith('/auth/')) return `auth ${p.split('/').slice(3).join('/')}`
  if (p.startsWith('/storage/')) return 'storage'
  return p
}

async function visit(page, path) {
  const calls = []
  const inflight = new Map()
  const t0 = Date.now()
  let last = 0 // ms after t0 of the last database request starting or ending
  const onReq = (r) => {
    if (new URL(r.url()).host !== SUPA || r.method() === 'OPTIONS') return
    inflight.set(r, Date.now())
    last = Date.now() - t0
  }
  const onDone = (r) => {
    const t = inflight.get(r)
    if (t === undefined) return
    inflight.delete(r)
    last = Date.now() - t0
    calls.push({ kind: kindOf(r.url()), ms: Date.now() - t })
  }
  page.on('request', onReq)
  page.on('requestfinished', onDone)
  page.on('requestfailed', onDone)
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 90000 })
  // A page the server renders whole asks the database for nothing from the
  // browser: it is ready when the document is.
  const dcl = Date.now() - t0
  let ready = null
  let skeletonGone = null
  while (Date.now() - t0 < 30000) {
    const skeleton = await page.$('[data-skeleton]').catch(() => null)
    if (!skeleton && skeletonGone === null) skeletonGone = Date.now() - t0
    if (skeleton) skeletonGone = null
    if (!skeleton && inflight.size === 0 && Date.now() - t0 - last >= 400) {
      ready = Math.max(dcl, last, skeletonGone ?? 0)
      break
    }
    await new Promise((r) => setTimeout(r, 50))
  }
  page.off('request', onReq)
  page.off('requestfinished', onDone)
  page.off('requestfailed', onDone)
  const counts = {}
  for (const c of calls) counts[c.kind] = (counts[c.kind] ?? 0) + 1
  const repeated = Object.entries(counts).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1])
  const slowest = calls.slice().sort((a, b) => b.ms - a.ms)[0] ?? null
  return { ready: ready ?? 30000, requests: calls.length, slowest, repeated }
}

const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const results = []
for (const s of SCREENS) {
  const colds = []
  const warms = []
  let detail = null
  for (let run = 0; run < RUNS; run++) {
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    await page.setViewport({ width: 375, height: 812 })
    const person = who[s.as]
    if (person) {
      await page.setCookie({ name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(person.session)).toString('base64'), domain: 'localhost', path: '/' })
    }
    if (s.org) await page.evaluateOnNewDocument((o) => { try { localStorage.setItem('squadroom.org', o) } catch {} }, s.org)
    const cold = await visit(page, s.path)
    const warm = await visit(page, s.path)
    colds.push(cold.ready)
    warms.push(warm.ready)
    if (run === 0) detail = cold
    await context.close()
  }
  results.push({ ...s, cold: median(colds), warm: median(warms), requests: detail.requests, slowest: detail.slowest, repeated: detail.repeated })
}
await browser.close()

const pad = (v, n) => String(v).padEnd(n)
console.log(`\n  ${BASE} · median of ${RUNS} · target: under 1000 ms\n`)
console.log(`  ${pad('screen', 14)}${pad('as', 9)}${pad('cold ms', 9)}${pad('warm ms', 9)}${pad('requests', 10)}slowest`)
for (const r of results) {
  const flag = r.cold > 1000 || r.warm > 1000 ? ' ◀' : ''
  console.log(`  ${pad(r.name, 14)}${pad(r.as, 9)}${pad(r.cold, 9)}${pad(r.warm, 9)}${pad(r.requests, 10)}${r.slowest ? `${r.slowest.kind} ${r.slowest.ms} ms` : '—'}${flag}`)
}
const repeats = results.filter((r) => r.repeated.length)
if (repeats.length) {
  console.log('\n  the same call more than once for one screen:')
  for (const r of repeats) console.log(`    ${r.name} (${r.as}): ${r.repeated.slice(0, 6).map(([k, n]) => `${k} ×${n}`).join(', ')}`)
}
if (process.env.JSON) writeFileSync(process.env.JSON, JSON.stringify({ base: BASE, runs: RUNS, at: new Date().toISOString(), results }, null, 2))
console.log('')
