// Run: node --env-file=.env.local scripts/test-two-step.mjs
//
// S-07, the half the app can do without a migration: two-step sign-in
// with an authenticator app. A throwaway club owner turns it on (the API
// path the settings screen uses: enrol, challenge, verify with a real
// TOTP code computed here), a fresh password-only session is then stopped
// by the gate until the six digits are typed, the Admin hub asks an owner
// without it to turn it on, and the settings screen turns it off again.
// The throwaway person and club are removed at the end.
//
// What is NOT proven here, on purpose: that the database refuses a
// password-only session for staff work. It does not yet — that is the
// migration half (NIGHT_LOG, NEEDS JOEY #12).
import { createClient } from '@supabase/supabase-js'
import { createHmac } from 'node:crypto'
import puppeteer from 'puppeteer-core'
import { resolveBaseUrl } from './_base-url.mjs'

const BASE = await resolveBaseUrl()
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const ref = URL_.split('//')[1].split('.')[0]
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const head = (m) => console.log(`\n${m}`)
const EMAIL = 'twostep-owner@squadroom.invalid'
const SLUG = 'twostep-zzz'

// RFC 6238, six digits, thirty seconds — what every authenticator app does.
function totp(secretBase32, at = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const c of secretBase32.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, '0')
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)))
  const h = createHmac('sha1', key).update(counter).digest()
  const o = h[h.length - 1] & 0xf
  const code = ((h[o] & 0x7f) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1_000_000
  return String(code).padStart(6, '0')
}

// A session straight from a magic link: password-strength only (AAL1).
async function freshSession() {
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email: EMAIL })
  const client = createClient(URL_, PUB, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
  return data?.session ? { client, session: data.session } : null
}
const cookieFor = (session) => ({ name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64'), domain: 'localhost', path: '/' })

async function tidy() {
  const { data: orgs } = await admin.from('academies').select('id').eq('slug', SLUG)
  for (const o of orgs ?? []) await admin.from('academies').delete().eq('id', o.id)
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const u = users?.users?.find((x) => x.email === EMAIL)
  if (u) await admin.auth.admin.deleteUser(u.id)
}
await tidy()
const { data: made } = await admin.auth.admin.createUser({ email: EMAIL, email_confirm: true })
await admin.from('profiles').upsert({ id: made.user.id, full_name: 'Tess Twostep' })
const { data: org } = await admin.from('academies').insert({ name: 'ZZZ Two Step Club', slug: SLUG, type: 'academy', primary_colour: '#333333' }).select('id').single()
await admin.from('academy_members').insert({ academy_id: org.id, profile_id: made.user.id, role: 'owner', status: 'active' })

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
const open = async (session, path, waitFor) => {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 375, height: 812 })
  await page.setCookie(cookieFor(session))
  await page.evaluateOnNewDocument((o) => { try { localStorage.setItem('squadroom.org', o) } catch {} }, org.id)
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 60000 })
  if (waitFor) await page.waitForSelector(waitFor, { timeout: 20000 }).catch(() => null)
  await new Promise((r) => setTimeout(r, 400))
  return { page, context }
}

try {
  head('1. An owner without two-step sign-in is asked for it, and nothing stands in their way')
  const first = await freshSession()
  if (!first) { console.log("  could not sign in — the project's auth rate limit, not a failure"); await tidy(); process.exit(2) }
  {
    const { page, context } = await open(first.session, '/admin', '[data-org]')
    ;(await page.$('[data-two-step-nag]')) ? ok('the Admin hub asks the owner to turn it on') : bad('no nag card for an owner without two-step sign-in')
    ;(await page.$('[data-two-step-gate]')) ? bad('a gate with no factor enrolled') : ok('no gate: there is nothing to check yet')
    await context.close()
  }

  head('2. Turned on through the API the settings screen uses')
  const { data: enrolled, error: enErr } = await first.client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'test' })
  if (enErr) bad(`enroll: ${enErr.message}`)
  const secret = enrolled?.totp?.secret
  secret && enrolled.totp.qr_code?.startsWith('data:image/svg+xml') ? ok('a secret and a QR code come back') : bad(`enroll gave ${JSON.stringify(enrolled).slice(0, 100)}`)
  const { data: ch } = await first.client.auth.mfa.challenge({ factorId: enrolled.id })
  // A code is good once. Remember which thirty seconds this one belongs to,
  // so the browser below is given a code from a later period, as a person
  // typing from their phone a minute later would be.
  let usedPeriod = Math.floor(Date.now() / 30000)
  const { error: vErr } = await first.client.auth.mfa.verify({ factorId: enrolled.id, challengeId: ch.id, code: totp(secret) })
  vErr ? bad(`verify with a computed code: ${vErr.message}`) : ok('a code computed the way an authenticator app computes it is accepted')
  const { data: factors } = await first.client.auth.mfa.listFactors()
  factors?.totp?.some((f) => f.status === 'verified') ? ok('the factor is verified') : bad(`factors: ${JSON.stringify(factors?.all)}`)
  const { data: aal } = await first.client.auth.mfa.getAuthenticatorAssuranceLevel()
  aal?.currentLevel === 'aal2' ? ok('that session is now fully proven (AAL2)') : bad(`AAL after verify: ${JSON.stringify(aal)}`)
  const { error: wrong } = await first.client.auth.mfa.verify({ factorId: enrolled.id, challengeId: (await first.client.auth.mfa.challenge({ factorId: enrolled.id })).data.id, code: '000000' })
  wrong ? ok('a wrong code is refused') : bad('000000 was accepted')

  head('3. A fresh password-only session is stopped by the gate until the six digits are typed')
  const second = await freshSession()
  {
    const { page, context } = await open(second.session, '/', '[data-two-step-gate]')
    const gate = await page.$('[data-two-step-gate]')
    gate ? ok('the gate is up before anything of Home') : bad('no gate for an AAL1 session with a verified factor')
    const home = await page.$('[data-needs-you], [data-persona]')
    const behind = await page.evaluate(() => { const g = document.querySelector('[data-two-step-gate]'); return g ? getComputedStyle(g).position === 'fixed' : false })
    behind ? ok('and it covers the whole screen') : bad(home ? 'Home is visible around the gate' : 'the gate is not fixed over the screen')
    if (gate) {
      await page.type('[data-two-step-code]', '123456')
      await page.click('[data-two-step-gate] button[type="submit"]')
      await page.waitForFunction(() => document.querySelector('[data-two-step-gate]')?.innerText.includes('did not match'), { timeout: 15000 }).then(() => ok('a wrong code says so and keeps the gate up')).catch(() => bad('a wrong code gave no answer'))
      // The gate clears the field on a miss; and the code must be from a
      // period no earlier code was accepted in.
      while (Math.floor(Date.now() / 30000) <= usedPeriod) await new Promise((r) => setTimeout(r, 1000))
      usedPeriod = Math.floor(Date.now() / 30000)
      await page.click('[data-two-step-code]')
      await page.type('[data-two-step-code]', totp(secret))
      await page.click('[data-two-step-gate] button[type="submit"]')
      await page.waitForFunction(() => !document.querySelector('[data-two-step-gate]') && !!document.querySelector('[data-persona], [data-needs-you], main'), { timeout: 30000 }).then(() => ok('the right code lets them through to Home')).catch(async () => {
        const why = await page.evaluate(() => {
          const gate = document.querySelector('[data-two-step-gate]')
          const raw = document.cookie.split('; ').filter((c) => c.includes('auth-token')).map((c) => c.split('=').slice(1).join('=')).join('')
          let aal = '?'
          try {
            const json = raw.startsWith('base64-') ? atob(raw.slice(7)) : decodeURIComponent(raw)
            const token = JSON.parse(json).access_token
            aal = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).aal
          } catch (e) { aal = 'unreadable: ' + String(e).slice(0, 40) }
          return { url: location.href, gate: gate ? gate.innerText.replace(/\s+/g, ' ').slice(0, 160) : null, aal, body: document.body.innerText.replace(/\s+/g, ' ').slice(0, 120) }
        })
        bad(`the gate did not lift on the right code — ${JSON.stringify(why)}`)
      })
      ;(await page.$('[data-two-step-nag]')) ? bad('still nagged after turning it on') : ok('no nag once it is on')
    }
    await context.close()
  }

  head('4. Settings shows it on, and turns it off')
  {
    // The session the browser just upgraded is not ours to reuse; the
    // API-verified one is AAL2 and can turn it off.
    const { page, context } = await open(first.session, '/settings', '[data-two-step]')
    const state = await page.evaluate(() => document.querySelector('[data-two-step]')?.getAttribute('data-two-step'))
    state === 'on' ? ok('Settings → Two-step sign-in: On') : bad(`settings says ${state}`)
    await page.click('[data-two-step-off]').catch(() => null)
    await page.waitForSelector('[data-two-step-off-confirm]', { timeout: 10000 }).catch(() => null)
    await page.click('[data-two-step-off-confirm]').catch(() => null)
    await page.waitForFunction(() => document.querySelector('[data-two-step]')?.getAttribute('data-two-step') === 'off', { timeout: 15000 }).then(() => ok('turned off from Settings, with a confirmation first')).catch(() => bad('could not turn it off from Settings'))
    await context.close()
  }
  const { data: after } = await first.client.auth.mfa.listFactors()
  ;(after?.totp ?? []).length === 0 ? ok('no factor left on the account') : bad(`factors left: ${after.totp.length}`)
} finally {
  await browser.close()
  await tidy()
}
process.exit(process.exitCode ?? 0)
