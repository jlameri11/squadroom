// Run: node --env-file=.env.local scripts/test-coach-scope.mjs
//
// A coach who is not staff runs their squad, not the club (Joey, 4 Nov
// 2026: "why does Marcus, coach-only, see the full Admin tab?"). The
// database already refuses him the club's work — rolling the season over,
// laying out grounds — and this proves it, and proves the Admin hub no
// longer offers those rows to him. What the database still lets a coach do
// (approve their squad's families, decide registrations, take registers,
// import for their squad) stays on the hub.
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'
import { signInBoth } from './_auth.mjs'
import { resolveBaseUrl } from './_base-url.mjs'

const BASE = await resolveBaseUrl()
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const ref = URL_.split('//')[1].split('.')[0]
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const note = (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`)
const head = (m) => console.log(`\n${m}`)
const NRIFA = '00000000-0000-0000-0000-0000000a0001'

const marcus = await signInBoth(admin, 'p61400000002@squadroom.invalid')
if (!marcus) { console.log("  could not sign in — the project's auth rate limit, not a failure"); process.exit(2) }
const { data: role } = await admin.from('academy_members').select('role').eq('academy_id', NRIFA).eq('profile_id', marcus.session.user.id).single()
role?.role === 'coach' ? ok('Marcus is a coach and nothing more at NRIFA (the seed)') : bad(`Marcus's role is ${role?.role}`)

head("1. The database refuses a coach the club's work")
const { error: season } = await marcus.client.rpc('preview_season_plan', { p_academy: NRIFA, p_from: '2026', p_to: '2027' })
season?.code === '42501' ? ok('rolling the season over: refused') : bad(`season rollover: ${season?.message ?? 'allowed'}`)
let { data: venue } = await admin.from('venues').select('id').eq('academy_id', NRIFA).limit(1).maybeSingle()
let madeVenue = false
if (!venue) {
  const made = await admin.from('venues').insert({ academy_id: NRIFA, name: 'COACHSCOPE Park' }).select('id').single()
  venue = made.data
  madeVenue = Boolean(made.data)
}
if (venue) {
  const { error: pitch } = await marcus.client.rpc('add_pitch', { p_venue: venue.id, p_name: 'COACHSCOPE pitch' })
  pitch?.code === '42501' ? ok('laying out a ground: refused') : bad(`add_pitch: ${pitch?.message ?? 'allowed'}`)
  await admin.from('pitches').delete().eq('name', 'COACHSCOPE pitch')
  if (madeVenue) await admin.from('venues').delete().eq('id', venue.id)
} else note('no venue to try a pitch on')
const { error: program } = await marcus.client.from('programs').insert({ academy_id: NRIFA, name: 'COACHSCOPE program', kind: 'camp', status: 'draft' })
program?.code === '42501' ? ok('making a program: refused') : bad(`programs insert: ${program?.message ?? 'allowed'}`)
await admin.from('programs').delete().eq('name', 'COACHSCOPE program')
const { error: comp } = await marcus.client.from('competitions').insert({ organiser_id: NRIFA, name: 'COACHSCOPE cup', type: 'tournament', season: '2026', status: 'active', mode: 'managed', visibility: 'participants', created_by: marcus.session.user.id })
if (comp?.code === '42501') ok('starting a competition: refused')
else {
  note(`starting a competition is still ALLOWED by the database for a coach (${comp?.message ?? 'row written'}) — the hub hides the row; tightening the policy needs a migration (NEEDS JOEY #12)`)
  await admin.from('competitions').delete().eq('name', 'COACHSCOPE cup')
}

head('2. The Admin hub offers a coach only what they can do')
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 375, height: 812 })
  await page.setCookie({ name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(marcus.session)).toString('base64'), domain: 'localhost', path: '/' })
  await page.evaluateOnNewDocument((org) => { try { localStorage.setItem('squadroom.org', org) } catch {} }, NRIFA)
  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle2', timeout: 60000 })
  await page.waitForSelector('[data-org]', { timeout: 30000 }).catch(() => null)
  const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))
  for (const row of ['Teams and players', 'Join requests', 'Programs', 'Import fixtures or players', 'Competitions']) {
    text.includes(row) ? ok(`shown: ${row}`) : bad(`missing for a coach: ${row}`)
  }
  for (const row of ['New season', 'Venues and pitches', 'Start a competition', 'Collect payments', 'Members', 'Club settings', 'Sponsors']) {
    text.includes(row) ? bad(`offered to a coach: ${row}`) : ok(`hidden: ${row}`)
  }
} finally {
  await browser.close()
}
process.exit(process.exitCode ?? 0)
