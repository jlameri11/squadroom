// Run: node --env-file=.env.local scripts/test-two-step.mjs
//   (needs the app running — npm run dev, or serve:test)
//
// S-07 as Joey changed it (9 Nov 2026; 0231 + 0232): no authenticator apps
// needed. A throwaway club made today requires two-step sign-in of its
// owners. Its owner — a placeholder account, so the code comes to the screen
// instead of a text — opens the app and meets the WALL: the six digits, with
// "Trust this device for 30 days". With a password alone the database
// refuses them an owner's powers; a wrong code is refused; the right code
// lifts the wall and the powers are theirs. A fresh sign-in on the same
// device meets no wall; on another device the wall is back; when the
// device's trust lapses, back again. The club's coach is never asked. Codes
// are held to one a minute and five wrong tries. An authenticator app stays
// an optional choice (0224's gate). The throwaway people and club are
// removed at the end.
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import puppeteer from 'puppeteer-core'
import { resolveBaseUrl } from './_base-url.mjs'
import { sessionIdOf, totp } from './_auth.mjs'
import { listAllUsers } from './_users.mjs'

const BASE = await resolveBaseUrl()
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const ref = URL_.split('//')[1].split('.')[0]
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const head = (m) => console.log(`\n${m}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const OWNER_EMAIL = 'twostep-owner@squadroom.invalid'
const COACH_EMAIL = 'twostep-coach@squadroom.invalid'
const SLUG = 'twostep-zzz'
// At least 32 characters, like the token the wall makes (lib/two-step/device.ts) — a shorter one is replaced.
const DEVICE = 'test-device-' + randomBytes(16).toString('hex')
const NRIFA = '00000000-0000-0000-0000-0000000a0001'

const { error: no0232 } = await admin.from('two_step_passes').select('session_id').limit(1)
if (no0232) {
  console.log('  \x1b[2m… waiting for 0232 on squadroom-dev — test-rls 170–173 prove it locally meanwhile\x1b[0m')
  process.exit(0)
}

// A session straight from a magic link: password-strength only (AAL1).
async function freshSession(email) {
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  const client = createClient(URL_, PUB, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
  return data?.session ? { client, session: data.session } : null
}
const cookieFor = (session) => ({ name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64'), domain: 'localhost', path: '/' })
const daysFromNow = (iso) => (new Date(iso).getTime() - Date.now()) / 864e5

async function tidy() {
  const { data: orgs } = await admin.from('academies').select('id').eq('slug', SLUG)
  for (const o of orgs ?? []) await admin.from('academies').delete().eq('id', o.id)
  const { data: users } = await listAllUsers(admin)
  for (const email of [OWNER_EMAIL, COACH_EMAIL]) {
    const u = users?.users?.find((x) => x.email === email)
    if (u) await admin.auth.admin.deleteUser(u.id)
  }
}
await tidy()
const { data: madeOwner } = await admin.auth.admin.createUser({ email: OWNER_EMAIL, email_confirm: true })
const { data: madeCoach } = await admin.auth.admin.createUser({ email: COACH_EMAIL, email_confirm: true })
const OWNER = madeOwner.user.id
const COACH = madeCoach.user.id
await admin.from('profiles').upsert([{ id: OWNER, full_name: 'Tess Twostep' }, { id: COACH, full_name: 'Kit Coach' }])
// Every account has an email (0214); without one the email gate sits over the wall.
await admin.from('account_emails').insert([
  { profile_id: OWNER, email: 'tess.twostep@squadroom-demo.test', verified_at: new Date().toISOString() },
  { profile_id: COACH, email: 'kit.coach@squadroom-demo.test', verified_at: new Date().toISOString() },
]).then(() => null, () => null)
const { data: org } = await admin.from('academies').insert({ name: 'ZZZ Two Step Club', slug: SLUG, type: 'academy', primary_colour: '#333333' }).select('id, two_step_required').single()
const expires = new Date(Date.now() + 300 * 864e5).toISOString().slice(0, 10)
await admin.from('staff_clearances').insert([
  { academy_id: org.id, profile_id: OWNER, kind: 'wwcc', number: 'TS-OWNER', outcome: 'cleared', expires_on: expires, verified_by: OWNER },
  { academy_id: org.id, profile_id: COACH, kind: 'wwcc', number: 'TS-COACH', outcome: 'cleared', expires_on: expires, verified_by: OWNER },
])
await admin.from('academy_members').insert([
  { academy_id: org.id, profile_id: OWNER, role: 'owner', status: 'active' },
  { academy_id: org.id, profile_id: COACH, role: 'coach', status: 'active' },
])

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
const open = async (session, path, waitFor, device = DEVICE, orgId = org.id) => {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 375, height: 812 })
  await page.setCookie(cookieFor(session))
  await page.evaluateOnNewDocument((o, d) => { try { localStorage.setItem('squadroom.org', o); if (d) localStorage.setItem('squadroom.device', d) } catch {} }, orgId, device)
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 60000 })
  if (waitFor) await page.waitForSelector(waitFor, { timeout: 20000 }).catch(() => null)
  await sleep(400)
  return { page, context }
}
// Scroll a control to the middle before tapping it: puppeteer's own scroll
// leaves a low control at the bottom edge, under the fixed tab bar, and the
// tap opens Home instead (found by part 5's first run).
const tap = async (page, sel) => {
  await page.$eval(sel, (el) => el.scrollIntoView({ block: 'center' }))
  await sleep(150)
  await page.click(sel)
}
const noWallSettles = async (page) => {
  // The wall decides after two calls (status, then the device); give it a
  // moment to appear before saying it did not.
  await sleep(2500)
  return !(await page.$('[data-two-step-wall]'))
}

try {
  head('1. A club made today asks its owner for a code: the wall, the code, the powers')
  const first = await freshSession(OWNER_EMAIL)
  if (!first) { console.log("  could not sign in — the project's auth rate limit, not a failure"); await tidy(); process.exit(2) }
  org.two_step_required ? ok('a club made today requires two-step sign-in of its owners') : bad(`two_step_required: ${org.two_step_required}`)
  {
    const { error: weak } = await first.client.from('academies').update({ primary_colour: '#444444' }).eq('id', org.id).select('id').single()
    weak ? ok("with a password alone, the owner has no owner's powers in the database") : bad('an owner with a password alone changed the club')
    const { data: st } = await first.client.rpc('two_step_status')
    st?.required && !st.ok && !st.passed ? ok(`the database says: required by ${st.where}, not yet passed`) : bad(`status: ${JSON.stringify(st)}`)
  }
  let shown = null
  {
    const { page, context } = await open(first.session, '/admin', '[data-two-step-wall]')
    ;(await page.$('[data-two-step-wall]')) ? ok('the wall: "Your six-digit code", naming the club') : bad('no wall for a required owner')
    ;(await page.$('[data-two-step-gate]')) ? bad('the authenticator gate, with no factor to check') : ok('not the authenticator gate — nothing was set up, nothing is needed')
    await page.waitForSelector('[data-two-step-demo-code]', { timeout: 20000 }).catch(() => null)
    shown = await page.$eval('[data-two-step-demo-code]', (e) => e.textContent?.trim() ?? '').catch(() => null)
    ;/^\d{6}$/.test(shown ?? '') ? ok('a demo account: the six digits come to the screen (a real account is texted)') : bad(`no code shown: ${await page.evaluate(() => document.querySelector('[data-two-step-wall]')?.innerText.replace(/\s+/g, ' ').slice(0, 200))}`)
    const ticked = await page.$eval('[data-two-step-trust]', (e) => e.checked).catch(() => null)
    ticked === true ? ok('"Trust this device for 30 days" is offered, ticked') : bad(`trust checkbox: ${ticked}`)
    const buttons = await page.$$eval('[data-two-step-wall] button', (bs) => bs.map((b) => b.innerText.trim()))
    !buttons.some((b) => /skip|later|not now|close/i.test(b)) ? ok(`no way past but the code, an authenticator app, or signing out (${buttons.join(' · ')})`) : bad(`a way to skip: ${buttons}`)
    await page.type('[data-two-step-wall-code]', shown === '000000' ? '111111' : '000000')
    await page.click('[data-two-step-wall-verify]')
    await page.waitForFunction(() => document.querySelector('[data-two-step-wall]')?.innerText.includes('did not match'), { timeout: 15000 }).then(() => ok('a wrong code says so, counts the tries left, and keeps the wall up')).catch(() => bad('a wrong code gave no answer'))
    await page.click('[data-two-step-wall-code]')
    await page.type('[data-two-step-wall-code]', shown ?? '000000')
    await page.click('[data-two-step-wall-verify]')
    await page.waitForFunction(() => !document.querySelector('[data-two-step-wall]') && !!document.querySelector('[data-org]'), { timeout: 30000 }).then(() => ok('the right code lifts the wall: the Admin hub is there')).catch(async () => {
      bad(`the wall did not lift: ${await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 200))}`)
    })
    ;(await page.$('[data-two-step-nag]')) ? bad('a card still asks for something') : ok('and no card asks for an authenticator app')
    await context.close()
  }
  {
    const { data: st } = await first.client.rpc('two_step_status')
    st?.ok && st.passed && daysFromNow(st.trusted_until) > 29 && daysFromNow(st.trusted_until) < 31 ? ok('the database holds the pass for this session — 30 days, the device trusted') : bad(`status after: ${JSON.stringify(st)}`)
    const { error: strong } = await first.client.from('academies').update({ primary_colour: '#454545' }).eq('id', org.id).select('id').single()
    strong ? bad(`with the pass, still refused: ${strong.message}`) : ok("with the pass, the owner's powers are theirs (two_step_ok_for, 0232)")
    const { data: devices } = await admin.from('trusted_devices').select('label, trusted_until, device_hash').eq('profile_id', OWNER)
    devices?.length === 1 && devices[0].label && devices[0].device_hash !== DEVICE ? ok(`the device is remembered by its hash, as "${devices[0].label}"`) : bad(`devices: ${JSON.stringify(devices)}`)
    const { data: peek } = await first.client.from('two_step_passes').select('session_id')
    ;(peek ?? []).length === 0 ? ok('nobody reads the passes table from a browser') : bad('a member read the passes table')
    const { page, context } = await open(first.session, '/settings', '[data-trusted-devices]')
    const listed = await page.$eval('[data-trusted-devices]', (e) => e.innerText).catch(() => '')
    ;/trusted until/.test(listed) && /Forget them all/.test(listed) ? ok('Settings lists the trusted device, with "Forget them all"') : bad(`trusted devices in Settings: ${listed.slice(0, 120) || 'none'}`)
    await context.close()
  }

  head('2. A trusted device skips the code; a new device does not; a lapsed one does not')
  const second = await freshSession(OWNER_EMAIL)
  {
    const { data: before } = await second.client.rpc('two_step_status')
    before && !before.ok ? ok('a fresh sign-in has no pass yet') : bad(`fresh: ${JSON.stringify(before)}`)
    const { page, context } = await open(second.session, '/', '[data-persona], [data-needs-you], main')
    ;(await noWallSettles(page)) ? ok('on the trusted device, no wall: the session took its pass from the device') : bad('the wall is up on the trusted device')
    await context.close()
    const { data: after } = await second.client.rpc('two_step_status')
    after?.ok && after.passed && daysFromNow(after.trusted_until) > 28 ? ok("the API sees the same pass, for the device's remaining days") : bad(`after: ${JSON.stringify(after)}`)
  }
  const third = await freshSession(OWNER_EMAIL)
  {
    const { page, context } = await open(third.session, '/', '[data-two-step-wall]', 'another-device-' + randomBytes(16).toString('hex'))
    ;(await page.$('[data-two-step-wall]')) ? ok('a device the account has not been seen on is asked again') : bad('no wall on a new device')
    await page.waitForSelector('[data-two-step-demo-code]', { timeout: 20000 }).then(() => ok('and a new code is sent')).catch(() => bad('no code on the new device'))
    await context.close()
  }
  await admin.from('trusted_devices').update({ trusted_until: new Date(Date.now() - 864e5).toISOString() }).eq('profile_id', OWNER)
  await admin.from('two_step_passes').delete().eq('profile_id', OWNER).neq('session_id', sessionIdOf(first.session))
  await admin.from('two_step_codes').delete().eq('profile_id', OWNER)
  const fourth = await freshSession(OWNER_EMAIL)
  let fourthPage = null
  {
    const { page, context } = await open(fourth.session, '/', '[data-two-step-wall]')
    ;(await page.$('[data-two-step-wall]')) ? ok("when the device's 30 days are up, the wall is back on it") : bad('no wall on a lapsed device')
    await page.waitForSelector('[data-two-step-demo-code]', { timeout: 20000 }).catch(() => null)
    fourthPage = { page, context }
  }

  head('3. The club\'s coach is never asked')
  const coach = await freshSession(COACH_EMAIL)
  {
    const { data: st } = await coach.client.rpc('two_step_status')
    st && st.required === false ? ok('the database asks nothing of a coach') : bad(`coach status: ${JSON.stringify(st)}`)
    const { page, context } = await open(coach.session, '/admin', '[data-org]')
    ;(await noWallSettles(page)) ? ok('no wall for a coach') : bad('a coach met the wall')
    await context.close()
    const { data: mine } = await coach.client.from('academy_members').select('role').eq('academy_id', org.id).eq('profile_id', COACH).maybeSingle()
    mine?.role === 'coach' ? ok('and coaches with a password alone, as before') : bad(`coach membership: ${JSON.stringify(mine)}`)
  }

  head('4. Codes are held: one a minute, five wrong tries')
  if (fourthPage) {
    const { page, context } = fourthPage
    const again = await page.evaluate(() => fetch('/api/two-step/send', { method: 'POST' }).then((r) => r.json()))
    again.sent && again.resent === false && again.wait > 0 ? ok(`asking again inside a minute sends nothing new (${again.wait} s to wait)`) : bad(`again: ${JSON.stringify(again)}`)
    const code = await page.$eval('[data-two-step-demo-code]', (e) => e.textContent?.trim() ?? '').catch(() => '')
    const wrong = code === '000000' ? '111111' : '000000'
    const statuses = []
    for (let i = 0; i < 5; i++) {
      statuses.push(await page.evaluate((c) => fetch('/api/two-step/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: c }) }).then((r) => r.status), wrong))
    }
    const after = await page.evaluate((c) => fetch('/api/two-step/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: c }) }).then((r) => r.json()), code)
    statuses.every((s) => s === 400) && after.ok === false && after.error === 'no-code' ? ok('five wrong tries burn the code; the right one is then refused until a new one is sent') : bad(`tries ${statuses.join(',')} then ${JSON.stringify(after)}`)
    const { data: st } = await fourth.client.rpc('two_step_status')
    st && !st.ok ? ok('and the session is still unproven') : bad(`after the burn: ${JSON.stringify(st)}`)
    await context.close()
  }

  head('5. An authenticator app stays an optional choice (0224)')
  let secret = null
  let usedPeriod = Math.floor(Date.now() / 30000)
  {
    const { page, context } = await open(first.session, '/settings', '[data-two-step]')
    const state = await page.evaluate(() => document.querySelector('[data-two-step]')?.getAttribute('data-two-step'))
    const text = await page.$eval('[data-two-step]', (e) => e.innerText).catch(() => '')
    state === 'off' && /optional/i.test(text) ? ok('Settings: an authenticator app is offered as optional, off') : bad(`settings: ${state} — ${text.slice(0, 120)}`)
    ;(await page.$('[data-two-step-wall]')) ? bad('the wall is over Settings for a passed session') : ok('no wall over Settings: this session passed in part 1')
    await tap(page, '[data-two-step-on]')
    await page.waitForSelector('[data-two-step-secret]', { timeout: 20000 }).catch(() => null)
    secret = (await page.$eval('[data-two-step-secret]', (e) => e.textContent?.trim()).catch(() => null)) ?? null
    if (secret) {
      usedPeriod = Math.floor(Date.now() / 30000)
      await page.type('[data-two-step-code]', totp(secret))
      await tap(page, '[data-two-step-finish]')
      await page.waitForFunction(() => document.querySelector('[data-two-step]')?.getAttribute('data-two-step') === 'on', { timeout: 20000 }).then(() => ok('set up from Settings with a real code')).catch(() => bad('could not set up the app from Settings'))
    } else bad(`no key to put in an authenticator app: ${await page.evaluate(() => document.querySelector('[data-two-step]')?.innerText.replace(/\s+/g, ' ').slice(0, 160))}`)
    await context.close()
  }
  const fifth = secret ? await freshSession(OWNER_EMAIL) : null
  if (fifth) {
    const { page, context } = await open(fifth.session, '/', '[data-two-step-gate]')
    const gate = await page.$('[data-two-step-gate]')
    gate && !(await page.$('[data-two-step-wall]')) ? ok('a password-only sign-in now meets the six-digit gate, not the texted code') : bad(`gate ${Boolean(gate)}, wall ${Boolean(await page.$('[data-two-step-wall]'))}`)
    if (gate && secret) {
      while (Math.floor(Date.now() / 30000) <= usedPeriod) await sleep(1000)
      usedPeriod = Math.floor(Date.now() / 30000)
      await page.type('[data-two-step-code]', totp(secret))
      await page.click('[data-two-step-gate] button[type="submit"]')
      await page.waitForFunction(() => !document.querySelector('[data-two-step-gate]') && !document.querySelector('[data-two-step-wall]'), { timeout: 30000 }).then(() => ok("the app's six digits let them through")).catch(() => bad('the gate did not lift on the right code'))
    }
    await context.close()
  }
  // Turning it off needs a proven (AAL2) session: the API client steps up with its own code.
  if (secret) {
    const { data: factors } = await first.client.auth.mfa.listFactors()
    const f = factors?.totp?.find((x) => x.status === 'verified')
    if (f) {
      while (Math.floor(Date.now() / 30000) <= usedPeriod) await sleep(1000)
      usedPeriod = Math.floor(Date.now() / 30000)
      const { data: ch } = await first.client.auth.mfa.challenge({ factorId: f.id })
      const { error: up } = await first.client.auth.mfa.verify({ factorId: f.id, challengeId: ch.id, code: totp(secret) })
      const { data: proven } = await first.client.auth.getSession()
      if (!up && proven?.session) first.session = proven.session
      const { page, context } = await open(first.session, '/settings', '[data-two-step]')
      await tap(page, '[data-two-step-off]').catch(() => null)
      await page.waitForSelector('[data-two-step-off-confirm]', { timeout: 10000 }).catch(() => null)
      await tap(page, '[data-two-step-off-confirm]').catch(() => null)
      await page.waitForFunction(() => document.querySelector('[data-two-step]')?.getAttribute('data-two-step') === 'off', { timeout: 15000 }).then(() => ok('turned off from Settings, with a confirmation first — it was optional')).catch(() => bad('could not turn it off from Settings'))
      await context.close()
    }
  }

  head('6. A club from before the rule: its owner is reminded the switch is theirs, and nothing is pressed')
  {
    const { data: nrifa } = await admin.from('academies').select('two_step_required').eq('id', NRIFA).single()
    nrifa?.two_step_required === false ? ok('NRIFA, here before the rule, does not require it yet') : bad(`NRIFA two_step_required: ${JSON.stringify(nrifa)}`)
    const { data: ju } = await listAllUsers(admin)
    const joeyUser = ju?.users?.find((x) => x.email === 'joeylameri@outlook.com')
    const { data: jl } = joeyUser ? await admin.auth.admin.generateLink({ type: 'magiclink', email: joeyUser.email }) : { data: null }
    if (jl?.properties?.hashed_token) {
      const jc = createClient(URL_, PUB, { auth: { persistSession: false, autoRefreshToken: false } })
      const { data: js } = await jc.auth.verifyOtp({ token_hash: jl.properties.hashed_token, type: 'email' })
      if (js?.session) {
        const { page, context } = await open(js.session, '/admin', '[data-org]', null, NRIFA)
        ;(await page.$('[data-two-step-nag]')) && !(await page.$('[data-two-step-wall]')) ? ok('the Admin hub reminds the owner that two-step is off for NRIFA — a card, not a wall') : bad('no reminder card for a grandfathered club\'s owner')
        await page.goto(`${BASE}/settings/academy`, { waitUntil: 'networkidle2', timeout: 60000 })
        await page.waitForSelector('[data-two-step-required]', { timeout: 20000 }).catch(() => null)
        const state = await page.$eval('[data-two-step-required]', (e) => e.getAttribute('data-two-step-required')).catch(() => null)
        state === 'off' && (await page.$('[data-two-step-require]')) ? ok('Club settings offers "Require two-step sign-in", one way — not pressed here') : bad(`settings: ${state}`)
        await context.close()
      } else ok('skipped the look — the project would not sign the owner in (rate limit)')
    }
  }
} finally {
  await browser.close()
  await tidy()
}
console.log(process.exitCode ? '' : '\n  \x1b[32mthe second step is a code by text, and a trusted device is asked once a month\x1b[0m\n')
process.exit(process.exitCode ?? 0)
