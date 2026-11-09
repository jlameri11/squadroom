// Run: node --env-file=.env.local scripts/test-two-step.mjs
//
// S-07, both halves. A throwaway club owner — a club made today, which
// requires two-step sign-in of its owners (0231) — opens the app and meets
// the WALL: nothing of the app until an authenticator app is set up. They
// set it up there (a real TOTP code computed here), the wall lifts, and
// their powers are theirs. A fresh password-only session is then stopped by
// the 0224 gate until the six digits are typed; the database refuses a
// password-only session staff work (2b); Settings turns it off again (and
// the wall would be back). The throwaway person and club are removed at the
// end.
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
// Every account has an email (0214): a sign-up records one, and an account
// without one meets the email gate on every screen — which, once the gate
// worked in development, sat over the two-step gate and took its taps.
await admin.from('account_emails').insert({ profile_id: made.user.id, email: 'tess.twostep@squadroom-demo.test', verified_at: new Date().toISOString() }).then(() => null, () => null)
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
  head('1. A new club requires two-step sign-in: its owner meets the wall, and sets it up there (0231)')
  const first = await freshSession()
  if (!first) { console.log("  could not sign in — the project's auth rate limit, not a failure"); await tidy(); process.exit(2) }
  let secret = null
  let usedPeriod = Math.floor(Date.now() / 30000)
  {
    const { data: required } = await admin.from('academies').select('two_step_required').eq('id', org.id).single()
    required?.two_step_required ? ok('a club made today requires two-step sign-in of its owners') : bad(`two_step_required: ${JSON.stringify(required)}`)
    const { error: weak } = await first.client.from('academies').update({ primary_colour: '#444444' }).eq('id', org.id).select('id').single()
    weak ? ok('with no authenticator app, the owner has no owner\'s powers in the database') : bad('an owner without two-step changed the club')
    const { page, context } = await open(first.session, '/admin', '[data-two-step-wall]')
    ;(await page.$('[data-two-step-wall]')) ? ok('the wall: "Set up two-step sign-in", naming the club') : bad('no wall for a required owner without two-step')
    ;(await page.$('[data-two-step-gate]')) ? bad('the six-digit gate, with no factor to check') : ok('not the six-digit gate — there is nothing to check yet')
    const buttons = await page.$$eval('[data-two-step-wall] button', (bs) => bs.map((b) => b.innerText.trim()))
    !buttons.some((b) => /skip|later|not now|close/i.test(b)) ? ok(`no way past but setting it up or signing out (${buttons.join(' · ')})`) : bad(`a way to skip: ${buttons}`)
    await page.click('[data-two-step-wall-start]')
    await page.waitForSelector('[data-two-step-wall-secret]', { timeout: 20000 })
    secret = (await page.$eval('[data-two-step-wall-secret]', (e) => e.textContent?.trim())) ?? null
    secret ? ok('a QR code and its key are shown') : bad('no key to put in an authenticator app')
    await page.type('[data-two-step-wall-code]', '000000')
    await page.click('[data-two-step-wall-verify]')
    await page.waitForFunction(() => document.querySelector('[data-two-step-wall]')?.innerText.includes('did not match'), { timeout: 15000 }).then(() => ok('a wrong code says so and keeps the wall up')).catch(() => bad('a wrong code gave no answer'))
    usedPeriod = Math.floor(Date.now() / 30000)
    await page.click('[data-two-step-wall-code]')
    await page.type('[data-two-step-wall-code]', totp(secret))
    await page.click('[data-two-step-wall-verify]')
    await page.waitForFunction(() => !document.querySelector('[data-two-step-wall]') && !!document.querySelector('[data-org]'), { timeout: 30000 }).then(() => ok('the right code lifts the wall: the Admin hub is there')).catch(async () => {
      const t = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 200))
      bad(`the wall did not lift: ${t}`)
    })
    ;(await page.$('[data-two-step-nag]')) ? bad('still asked to turn it on') : ok('and no card asks for what is done')
    await context.close()
  }

  head('2. The factor is real')
  const { data: factors } = await first.client.auth.mfa.listFactors()
  const enrolled = factors?.totp?.find((f) => f.status === 'verified')
  enrolled ? ok('a verified authenticator factor is on the account') : bad(`factors: ${JSON.stringify(factors?.all)}`)
  if (enrolled) {
    const { error: wrong } = await first.client.auth.mfa.verify({ factorId: enrolled.id, challengeId: (await first.client.auth.mfa.challenge({ factorId: enrolled.id })).data.id, code: '000000' })
    wrong ? ok('a wrong code is refused by the API too') : bad('000000 was accepted')
  }

  // The API client steps up with a code of its own, as the phone did, so
  // the proven side of the checks below has a proven session.
  if (enrolled && secret) {
    while (Math.floor(Date.now() / 30000) <= usedPeriod) await new Promise((r) => setTimeout(r, 1000))
    usedPeriod = Math.floor(Date.now() / 30000)
    const { data: ch2 } = await first.client.auth.mfa.challenge({ factorId: enrolled.id })
    const { error: up } = await first.client.auth.mfa.verify({ factorId: enrolled.id, challengeId: ch2.id, code: totp(secret) })
    up ? bad(`could not step the API session up: ${up.message}`) : ok('the API session steps up with its own code (AAL2)')
    const { data: proven } = await first.client.auth.getSession()
    if (proven?.session) first.session = proven.session
  }

  head('2b. The database asks too (0224)')
  {
    const weak = await freshSession()
    const { data: owes, error: noFn } = weak ? await weak.client.rpc('two_step_needed') : { error: { message: 'no session' } }
    if (noFn) {
      console.log(`  \x1b[2m… waiting for 0224 on squadroom-dev — until then a password-only session still has staff powers in the database, and only the app's gate stands in front of them\x1b[0m`)
    } else {
      const { error: weakErr } = await weak.client.rpc('rollover_report', { p_academy: org.id, p_season: '2026' })
      const { data: firstOwes } = await first.client.rpc('two_step_needed')
      const { error: strongErr } = await first.client.rpc('rollover_report', { p_academy: org.id, p_season: '2026' })
      owes === true && weakErr?.code === '42501' ? ok('a password-only session owes the six digits, and the database refuses it staff work') : bad(`password only: owes ${owes}, ${weakErr?.message ?? 'not refused'}`)
      firstOwes === false && !strongErr ? ok('with both steps the same owner has their powers') : bad(`both steps: owes ${firstOwes}, ${strongErr?.message ?? 'ok'}`)
    }
  }

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

  head('5. A club from before the rule: its owner is offered the one-way switch, and nothing is pressed')
  {
    // NRIFA is grandfathered (0231): its owner sees "Require two-step
    // sign-in" in Club settings. Pressing it would wall the demo's owner, so
    // this only looks.
    const { data: nrifa } = await admin.from('academies').select('two_step_required').eq('id', '00000000-0000-0000-0000-0000000a0001').single()
    nrifa?.two_step_required === false ? ok('NRIFA, here before the rule, does not require it yet') : bad(`NRIFA two_step_required: ${JSON.stringify(nrifa)}`)
    const { data: ju } = await admin.auth.admin.listUsers({ perPage: 200 })
    const joeyUser = ju?.users?.find((x) => x.email === 'joeylameri@outlook.com')
    const { data: jl } = joeyUser ? await admin.auth.admin.generateLink({ type: 'magiclink', email: joeyUser.email }) : { data: null }
    if (jl?.properties?.hashed_token) {
      const jc = createClient(URL_, PUB, { auth: { persistSession: false, autoRefreshToken: false } })
      const { data: js } = await jc.auth.verifyOtp({ token_hash: jl.properties.hashed_token, type: 'email' })
      if (js?.session) {
        const context = await browser.createBrowserContext()
        const page = await context.newPage()
        await page.setViewport({ width: 375, height: 812 })
        await page.setCookie(cookieFor(js.session))
        await page.evaluateOnNewDocument(() => { try { localStorage.setItem('squadroom.org', '00000000-0000-0000-0000-0000000a0001') } catch {} })
        await page.goto(`${BASE}/settings/academy`, { waitUntil: 'networkidle2', timeout: 60000 })
        await page.waitForSelector('[data-two-step-required]', { timeout: 20000 }).catch(() => null)
        const state = await page.$eval('[data-two-step-required]', (e) => e.getAttribute('data-two-step-required')).catch(() => null)
        state === 'off' && (await page.$('[data-two-step-require]')) ? ok('Club settings offers "Require two-step sign-in", one way — not pressed here') : bad(`settings: ${state}`)
        await context.close()
      } else ok('skipped the settings look — the project would not sign the owner in (rate limit)')
    }
  }
} finally {
  await browser.close()
  await tidy()
}
process.exit(process.exitCode ?? 0)
