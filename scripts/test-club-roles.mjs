// Run: node --env-file=.env.local scripts/test-club-roles.mjs
//   (needs the app running — npm run dev, or serve:test; SHOTS=1 saves the
//   screens at 375px, light and dark, in .shots/)
//
// Big Club Mode, step 1 (0236): several roles per person, each with a
// scope, and everyone sees only their job. On squadroom-dev, at NRIFA: the
// Head of academy (an owner) makes Hana's parent Treasurer, Sam Registrar
// and Marcus coordinator of U8. Then: the Treasurer reads who owes and never
// a medical record; the Registrar reads registrations and is refused the
// money; the coordinator changes the U8 squad and not the U12; a parent
// cannot hand out roles. The Roles and Activity screens at 375px. Every
// role, clearance and squad change made here is undone.
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'
import { signInBoth } from './_auth.mjs'
import { resolveBaseUrl } from './_base-url.mjs'

const BASE = await resolveBaseUrl()
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const ref = URL_.split('//')[1].split('.')[0]
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SHOTS = process.env.SHOTS === '1'
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const note = (m) => console.log(`  \x1b[2m… ${m}\x1b[0m`)
const head = (m) => console.log(`\n${m}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const HANA_PARENT = '00000000-0000-0000-0000-0000000000b4'
const SAM = '00000000-0000-0000-0000-0000000000b1'
const MARCUS = '00000000-0000-0000-0000-0000000000a2'
const U8 = '00000000-0000-0000-0000-0000000d0008'
const U12 = '00000000-0000-0000-0000-0000000d0012'

const { error: no0236 } = await admin.from('club_roles').select('id').limit(1)
if (no0236) {
  note('waiting for 0236 on squadroom-dev — test-rls 178–183 prove it locally meanwhile')
  process.exit(0)
}

// signInAs returns a client alone; the screens need the session too.
async function signInBothAs(profileId) {
  const { data } = await admin.auth.admin.getUserById(profileId)
  return data?.user?.email ? signInBoth(admin, data.user.email) : null
}
const owner = await signInBoth(admin, 'head@squadroom-demo.test') // Head of academy: NRIFA's owner, nothing else
const hana = await signInBothAs(HANA_PARENT)
const sam = await signInBothAs(SAM)
const marcus = await signInBothAs(MARCUS)
if (!owner || !hana || !sam || !marcus) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}
if (SHOTS) mkdirSync('.shots', { recursive: true })

// What this touches, read first, put back after.
// Marcus coaches from before the WWCC rule (0120 left existing coaches alone), so he has no check on record either.
const { data: clearancesBefore } = await admin.from('staff_clearances').select('profile_id').eq('academy_id', NRIFA).in('profile_id', [HANA_PARENT, SAM, MARCUS])
const hadClearance = new Set((clearancesBefore ?? []).map((c) => c.profile_id))
const { data: u8Before } = await admin.from('teams').select('kit_home').eq('id', U8).single()
const { data: u12Before } = await admin.from('teams').select('kit_home').eq('id', U12).single()
const expires = new Date(Date.now() + 300 * 864e5).toISOString().slice(0, 10)
for (const pid of [HANA_PARENT, SAM, MARCUS]) {
  if (!hadClearance.has(pid)) {
    await admin.from('staff_clearances').insert({ academy_id: NRIFA, profile_id: pid, kind: 'wwcc', number: `TEST-ROLES-${pid.slice(-2)}`, outcome: 'cleared', expires_on: expires, verified_by: owner.session.user.id })
  }
}
async function tidy() {
  const { data: roles } = await admin.from('club_roles').select('id').eq('academy_id', NRIFA).in('profile_id', [HANA_PARENT, SAM, MARCUS])
  for (const r of roles ?? []) await admin.from('club_roles').delete().eq('id', r.id)
  await admin.from('safeguarding_officers').delete().eq('academy_id', NRIFA).in('profile_id', [HANA_PARENT, SAM, MARCUS])
  for (const pid of [HANA_PARENT, SAM, MARCUS]) if (!hadClearance.has(pid)) await admin.from('staff_clearances').delete().eq('academy_id', NRIFA).eq('profile_id', pid)
  await admin.from('teams').update({ kit_home: u8Before?.kit_home ?? null }).eq('id', U8)
  await admin.from('teams').update({ kit_home: u12Before?.kit_home ?? null }).eq('id', U12)
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
async function open(who, path, waitFor) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 375, height: 812 })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
  await page.setCookie({ name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(who.session)).toString('base64'), domain: 'localhost', path: '/' })
  await page.evaluateOnNewDocument((o) => { try { localStorage.setItem('squadroom.org', o) } catch {} }, NRIFA)
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 90000 })
  if (waitFor) await page.waitForSelector(waitFor, { timeout: 20000 }).catch(() => null)
  await sleep(300)
  return { context, page }
}
const fits = (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1)
async function bothThemes(page, name) {
  let fitted = true
  for (const scheme of ['light', 'dark']) {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }])
    await sleep(250)
    fitted = fitted && (await fits(page))
    if (SHOTS) await page.screenshot({ path: `.shots/roles-${name}-${scheme}.png`, fullPage: true })
  }
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
  return fitted
}

try {
  head('1. The owner hands out roles; a parent cannot; a role around children needs a check')
  const { error: parentGrant } = await sam.client.rpc('grant_club_role', { p_academy: NRIFA, p_profile: HANA_PARENT, p_role: 'treasurer' })
  parentGrant?.code === '42501' ? ok('a parent cannot hand out roles') : bad(`parent granted: ${parentGrant?.message ?? 'allowed'}`)
  const { data: officials } = await owner.client.rpc('club_officials', { p_academy: NRIFA })
  officials && Array.isArray(officials.members) && officials.members.length >= 3 ? ok(`the owner sees ${officials.members.length} members to choose from, ${officials.teams.length} teams, ${officials.age_groups.length} age groups`) : bad(`officials: ${JSON.stringify(officials).slice(0, 160)}`)
  const { data: t1, error: g1 } = await owner.client.rpc('grant_club_role', { p_academy: NRIFA, p_profile: HANA_PARENT, p_role: 'treasurer' })
  g1 ? bad(`treasurer: ${g1.message}`) : ok("Hana's parent is Treasurer")
  const { data: t2, error: g2 } = await owner.client.rpc('grant_club_role', { p_academy: NRIFA, p_profile: SAM, p_role: 'registrar' })
  g2 ? bad(`registrar: ${g2.message}`) : ok('Sam is Registrar (his check is on record)')
  const { error: g3 } = await owner.client.rpc('grant_club_role', { p_academy: NRIFA, p_profile: MARCUS, p_role: 'coordinator', p_scope_kind: 'age_group', p_age_group: 'U8' })
  g3 ? bad(`coordinator: ${g3.message}`) : ok('Marcus is coordinator of U8')
  const { data: after } = await owner.client.rpc('club_officials', { p_academy: NRIFA })
  const held = (after?.roles ?? []).map((r) => `${r.role}${r.scope_kind === 'club' ? '' : ':' + r.scope}`)
  held.includes('treasurer') && held.includes('registrar') && held.includes('coordinator:U8') ? ok(`the Roles screen lists them: ${held.join(', ')}`) : bad(`held: ${held.join(', ')}`)
  const { data: logged } = await owner.client.from('activity_log').select('action, subject_name').eq('academy_id', NRIFA).eq('action', 'role.granted').order('at', { ascending: false }).limit(5)
  ;(logged ?? []).length >= 3 ? ok('each grant is in the activity log, with who and when') : bad(`log: ${JSON.stringify(logged)}`)
  void t1; void t2

  head('2. The Treasurer: money, never medical')
  const { data: accT } = await hana.client.rpc('my_club_access', { p_academy: NRIFA })
  ;(accT?.areas ?? []).includes('money') && !(accT?.areas ?? []).includes('registrations') ? ok(`access: ${(accT.areas ?? []).join(', ')}`) : bad(`treasurer access: ${JSON.stringify(accT)}`)
  const { error: owes } = await hana.client.rpc('outstanding_fees', { p_academy: NRIFA })
  owes ? bad(`who owes refused the Treasurer: ${owes.message}`) : ok('the who-owes list answers the Treasurer')
  const { data: med } = await hana.client.from('player_medical').select('player_id').eq('academy_id', NRIFA)
  ;(med ?? []).length === 0 ? ok('and no medical record is readable') : bad(`medical rows: ${med.length}`)
  const { error: tGrant } = await hana.client.rpc('grant_club_role', { p_academy: NRIFA, p_profile: SAM, p_role: 'treasurer' })
  tGrant?.code === '42501' ? ok('a Treasurer cannot hand out roles') : bad('a Treasurer granted a role')

  head('3. The Registrar: registrations, not money')
  const { data: accR } = await sam.client.rpc('my_club_access', { p_academy: NRIFA })
  ;(accR?.areas ?? []).includes('registrations') && !(accR?.areas ?? []).includes('money') ? ok(`access: ${(accR.areas ?? []).join(', ')}`) : bad(`registrar access: ${JSON.stringify(accR)}`)
  const { data: regs } = await sam.client.from('program_registrations').select('id').eq('academy_id', NRIFA).limit(5)
  ;(regs ?? []).length >= 1 ? ok("the club's registrations are readable") : bad('no registrations readable by the Registrar')
  const { error: owesR } = await sam.client.rpc('outstanding_fees', { p_academy: NRIFA })
  owesR?.code === '42501' ? ok('the who-owes list refuses the Registrar') : bad(`registrar read who owes: ${owesR?.message ?? 'allowed'}`)

  head('4. A coordinator runs only their age group')
  const { data: u8ok } = await marcus.client.from('teams').update({ kit_home: 'TEST:: coordinator wrote this' }).eq('id', U8).select('id')
  const { data: u12no } = await marcus.client.from('teams').update({ kit_home: 'TEST:: should not land' }).eq('id', U12).select('id')
  ;(u8ok ?? []).length === 1 && (u12no ?? []).length === 0 ? ok('Marcus changes the U8 squad and not the U12') : bad(`U8 ${(u8ok ?? []).length}, U12 ${(u12no ?? []).length}`)
  const { data: u12row } = await admin.from('teams').select('kit_home').eq('id', U12).single()
  u12row?.kit_home !== 'TEST:: should not land' ? ok('the U12 is untouched') : bad('the U12 was written')

  head('5. The screens, at 375px')
  {
    const { context, page } = await open(owner, '/admin/roles', '[data-roles-list]')
    const people = await page.$$('[data-role-person]')
    people.length >= 3 ? ok(`Roles: ${people.length} people with roles, each with Remove`) : bad(`roles screen: ${await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 160))}`)
    await page.click('[data-role-add]')
    await page.waitForSelector('[data-grant-form]', { timeout: 10000 }).catch(() => null)
    ;(await page.$('[data-grant-form]')) && (await page.$$eval('[data-grant-role] option', (os) => os.length)) === 8 ? ok('"Give someone a role": the eight roles, each described') : bad('no grant sheet, or not eight roles')
    ;(await bothThemes(page, 'screen')) ? ok('fits 375px, light and dark') : bad('wider than the phone')
    await context.close()
  }
  {
    const { context, page } = await open(owner, '/admin/activity', '[data-activity-list]')
    const rows = await page.$$eval('[data-activity-row]', (ls) => ls.map((l) => l.getAttribute('data-activity-row')))
    rows.includes('role.granted') ? ok(`Activity: ${rows.length} rows on screen, the grants among them`) : bad(`activity rows: ${rows.slice(0, 5).join(', ')}`)
    ;(await bothThemes(page, 'activity')) ? ok('fits 375px, light and dark') : bad('wider than the phone')
    await context.close()
  }
  {
    const { context, page } = await open(sam, '/admin/roles', '[data-roles-denied], [data-roles-list]')
    ;(await page.$('[data-roles-denied]')) ? ok('a Registrar opening Roles is told it is not theirs') : bad('a Registrar saw the Roles screen')
    await context.close()
  }
} finally {
  await browser.close()
  await tidy()
}
console.log(process.exitCode ? '' : '\n  \x1b[32meveryone sees only their job\x1b[0m\n')
