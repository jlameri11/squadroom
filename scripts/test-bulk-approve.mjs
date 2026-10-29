// Run: node --env-file=.env.local scripts/test-bulk-approve.mjs
//   (needs the app running and Chrome installed — it drives the screen)
//
// R-07: many registrations, one squad, one tap. The feature IS the screen —
// the per-row route and update were already proven — so this test ticks
// boxes in a real browser and then asks the database what happened.
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'
import { resolveBaseUrl } from './_base-url.mjs'

const BASE = await resolveBaseUrl()
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const anon = createClient(URL_, PUB, { auth: { persistSession: false } })

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`)
  process.exitCode = 1
}
const head = (m) => console.log(`\n${m}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const OWNER = '00000000-0000-0000-0000-0000000000a1'
const TAG = 'BULKTEST'

// ---- clean up anything a previous run left ----
async function cleanup() {
  const { data: reqs } = await admin
    .from('registration_requests')
    .select('id, guardian_phone, player_id')
    .like('child_name', `${TAG}%`)
  for (const r of reqs ?? []) {
    if (r.player_id) {
      await admin.from('consent_acceptances').delete().eq('player_id', r.player_id)
      await admin.from('program_registrations').delete().eq('player_id', r.player_id)
      await admin.from('player_guardians').delete().eq('player_id', r.player_id)
      await admin.from('players').delete().eq('id', r.player_id)
    }
    if (r.guardian_phone) {
      const { data: p } = await admin.from('profiles').select('id').eq('phone', r.guardian_phone).maybeSingle()
      if (p) {
        await admin.from('academy_members').delete().eq('profile_id', p.id)
        await admin.auth.admin.deleteUser(p.id)
      }
    }
  }
  await admin.from('registration_requests').delete().like('child_name', `${TAG}%`)
  const { data: players } = await admin.from('players').select('id').like('full_name', `${TAG}%`)
  for (const p of players ?? []) {
    await admin.from('program_registrations').delete().eq('player_id', p.id)
    await admin.from('player_guardians').delete().eq('player_id', p.id)
  }
  await admin.from('players').delete().like('full_name', `${TAG}%`)
}
await cleanup()

// ---- sign in as the owner, forge the browser cookie ----
const { data: u } = await admin.auth.admin.getUserById(OWNER)
const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email: u.user.email })
if (!link?.properties?.hashed_token) {
  console.log("  could not issue a magic link — the project's auth rate limit, not a failure")
  process.exit(2)
}
const { data: s } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
if (!s?.session) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}
const ref = URL_.split('//')[1].split('.')[0]
const cookie = {
  name: `sb-${ref}-auth-token`,
  value: 'base64-' + Buffer.from(JSON.stringify(s.session)).toString('base64'),
  domain: 'localhost',
  path: '/',
}

// ---- fixtures ----
// A program WITH ROOM. The first run took the alphabetically-first open
// program, which was the full holiday camp, and 0083's trigger quietly
// waitlisted all three — which is right, and is not what this tests.
const { data: pubFirst } = await anon.rpc('public_programs', { p_slug: 'nrifa' })
const program = (pubFirst?.programs ?? []).find((p) => p.spots_left == null || p.spots_left >= 6)
if (!program) {
  bad('no open program with six places free to test against')
  process.exit(1)
}
const { data: team } = await admin
  .from('teams')
  .select('id, name')
  .eq('academy_id', NRIFA)
  .eq('status', 'active')
  .order('name')
  .limit(1)
  .single()
const { data: pub } = await anon.rpc('public_programs', { p_slug: 'nrifa' })
const consents = (pub?.consents ?? []).filter((c) => c.required).map((c) => ({ id: c.id, version: c.version }))

const phones = ['+61400771001', '+61400771002', '+61400771003']
const { error: seedErr } = await admin.from('registration_requests').insert(
  phones.map((phone, i) => ({
    academy_id: NRIFA,
    program_id: program.id,
    guardian_name: `${TAG} Parent ${i + 1}`,
    guardian_phone: phone,
    child_name: `${TAG} Child ${i + 1}`,
    child_dob: '2016-03-0' + (i + 1),
    consents,
    secret_hash: 'x'.repeat(64),
  }))
)
if (seedErr) {
  bad(`could not seed requests: ${seedErr.message}`)
  process.exit(1)
}

// Three signed-in registrations too, on players that already exist.
const { data: kids } = await admin
  .from('players')
  .insert([1, 2, 3].map((i) => ({ academy_id: NRIFA, full_name: `${TAG} Kid ${i}`, dob: '2015-05-0' + i })))
  .select('id')
const { error: regErr } = await admin.from('program_registrations').insert(
  (kids ?? []).map((k) => ({ academy_id: NRIFA, program_id: program.id, player_id: k.id, submitted_by: OWNER }))
)
if (regErr) {
  bad(`could not seed program registrations: ${regErr.message}`)
  await cleanup()
  process.exit(1)
}

let browser
try {
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
} catch (e) {
  console.log(`  no Chrome at ${CHROME} — set CHROME to its path. Skipping. (${e.message.slice(0, 60)})`)
  await cleanup()
  process.exit(2)
}
const page = await browser.newPage()
await page.setViewport({ width: 375, height: 812 })
await page.setCookie(cookie)

const clickText = async (selector, text) => {
  const handles = await page.$$(selector)
  for (const h of handles) {
    const t = (await (await h.getProperty('textContent')).jsonValue()) ?? ''
    if (t.trim() === text || t.trim().startsWith(text)) {
      await h.click()
      return true
    }
  }
  return false
}
const tickAll = async (prefix) => {
  const boxes = await page.$$(`input[type=checkbox][aria-label^="Select ${prefix}"]`)
  for (const b of boxes) await b.click()
  return boxes.length
}

head(`1. The public queue: three of ${TAG} accepted into ${team.name} in one go`)
try {
  await page.goto(`${BASE}/admin/registrations`, { waitUntil: 'networkidle2', timeout: 45000 })
  await sleep(1500)
  ;(await clickText('button', 'Select')) ? ok('Select is offered') : bad('no Select button — are there two or more waiting?')
  await sleep(300)
  const ticked = await tickAll(`${TAG} Child`)
  ticked === 3 ? ok('three boxes ticked') : bad(`${ticked} boxes found for ${TAG}`)
  await page.select('select[aria-label="Squad for everyone selected"]', team.id)
  ;(await clickText('button', 'Accept 3')) ? ok('"Accept 3" tapped') : bad('no "Accept 3" button')
  // Three sequential route calls, each making an account.
  for (let i = 0; i < 40; i++) {
    await sleep(500)
    const left = await page.$$(`input[type=checkbox][aria-label^="Select ${TAG} Child"]`)
    const bar = await page.$('button[aria-pressed]')
    if (left.length === 0 && bar) break
  }
  const { data: after } = await admin
    .from('registration_requests')
    .select('status, player_id, child_name')
    .like('child_name', `${TAG}%`)
  const approved = (after ?? []).filter((r) => r.status === 'approved')
  approved.length === 3 ? ok('all three are approved in the database') : bad(`${approved.length} approved: ${JSON.stringify(after)}`)
  const { data: placed } = await admin
    .from('players')
    .select('full_name, team_id')
    .in('id', approved.map((r) => r.player_id).filter(Boolean))
  // Named first: a line starting with `(` would be read as a call on the
  // line above. This project has been bitten by that three times.
  const allPlaced = (placed ?? []).length === 3 && placed.every((p) => p.team_id === team.id)
  allPlaced ? ok(`and all three children are in ${team.name}`) : bad(`placed: ${JSON.stringify(placed)}`)
  const { count: members } = await admin
    .from('academy_members')
    .select('*', { count: 'exact', head: true })
    .eq('academy_id', NRIFA)
    .in('profile_id', (await admin.from('profiles').select('id').in('phone', phones)).data?.map((p) => p.id) ?? [])
  members === 3 ? ok('and their three parents are members of the club') : bad(`${members} parents became members`)
} catch (e) {
  bad(`public queue: ${e.message.slice(0, 100)}`)
}

head(`2. The program's own queue: three signed-in registrations, one tap`)
try {
  await page.goto(`${BASE}/admin/programs/${program.id}`, { waitUntil: 'networkidle2', timeout: 45000 })
  await sleep(1500)
  ;(await clickText('button', 'Select')) ? ok('Select is offered') : bad('no Select button')
  await sleep(300)
  const ticked = await tickAll(`${TAG} Kid`)
  ticked === 3 ? ok('three boxes ticked') : bad(`${ticked} boxes found`)
  await page.select('select[aria-label="Squad for everyone selected"]', team.id)
  ;(await clickText('button', 'In — 3')) ? ok('"In — 3" tapped') : bad('no "In — 3" button')
  for (let i = 0; i < 30; i++) {
    await sleep(400)
    const left = await page.$$(`input[type=checkbox][aria-label^="Select ${TAG} Kid"]`)
    if (left.length === 0) break
  }
  const { data: regs } = await admin
    .from('program_registrations')
    .select('status, player:players(full_name, team_id)')
    .in('player_id', (kids ?? []).map((k) => k.id))
  regs?.length === 3 && regs.every((r) => r.status === 'approved')
    ? ok('all three approved')
    : bad(`${JSON.stringify(regs)}`)
  regs?.every((r) => r.player?.team_id === team.id)
    ? ok(`and all three in ${team.name}`)
    : bad('a child was approved without the squad')
} catch (e) {
  bad(`program queue: ${e.message.slice(0, 100)}`)
}

await browser.close()
await cleanup()
console.log(process.exitCode ? '\n\x1b[31mBULK APPROVE IS WRONG\x1b[0m\n' : '\n\x1b[32mall good\x1b[0m\n')
