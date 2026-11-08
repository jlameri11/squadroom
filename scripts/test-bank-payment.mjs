// Run: node --env-file=.env.local scripts/test-bank-payment.mjs
//   (needs the app running — npm run dev, or serve:test; SHOTS=1 saves the
//   screens at 375px, light and dark, in .shots/)
//
// B-08's bank half (0226): a payment can be PROCESSING — the family has
// authorised a bank debit at Checkout and the money is on its way. It is
// not paid (only Stripe's async_payment_succeeded says that) and it is not
// owed: no Pay button, no reminder, no chase, no second checkout.
//
// Three parts. The screens are checked now, with the database's answers
// stood in: the family's Payments shows the fee under "Clearing", neither
// owed nor paid; the club's register says "bank payment clearing" and does
// not chase them. The webhook is checked now with a SIGNED event posted to
// the real route (Stripe's own test-signature helper and the secret in
// .env.local): a failed debit marks the row failed. The processing flow
// itself — completed-but-unpaid → processing, an expiry that must not undo
// it, the success that pays it, and the checkout refusing to take the money
// twice — runs against squadroom-dev once 0226 is applied, and says it is
// waiting until then; test-rls 155–157 prove the database half locally
// meanwhile.
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'
import { signInBoth } from './_auth.mjs'
import { resolveBaseUrl } from './_base-url.mjs'

const BASE = await resolveBaseUrl()
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const ref = URL_.split('//')[1].split('.')[0]
const host = new URL(URL_).host
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SHOTS = process.env.SHOTS === '1'
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const note = (m) => console.log(`  \x1b[2m… ${m}\x1b[0m`)
const head = (m) => console.log(`\n${m}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const U8 = '00000000-0000-0000-0000-0000000d0008'
const LEO = '00000000-0000-0000-0000-0000000e0001'
const ZOE = '00000000-0000-0000-0000-0000000e0006'
const TAG = 'TEST:: bank fee'
const SESSION = 'cs_test_bank_'

const owner = await signInBoth(admin, 'joeylameri@outlook.com')
const sam = await signInBoth(admin, 'p61400000011@squadroom.invalid')
if (!owner || !sam) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}
const { error: no0226 } = await admin.from('academy_billing').select('becs_enabled').limit(1)
const has0226 = !no0226
if (SHOTS) mkdirSync('.shots', { recursive: true })

async function tidy() {
  const { data: reqs } = await admin.from('payment_requests').select('id').eq('academy_id', NRIFA).like('title', `${TAG}%`)
  for (const r of reqs ?? []) {
    await admin.from('notification_queue').delete().filter('payload->>request_id', 'eq', r.id)
    await admin.from('payments').delete().eq('request_id', r.id)
  }
  await admin.from('payment_requests').delete().eq('academy_id', NRIFA).like('title', `${TAG}%`)
}
await tidy()
const { data: req } = await admin.from('payment_requests').insert({ academy_id: NRIFA, team_id: U8, title: `${TAG} U8 kit`, amount_cents: 6000, per_player: true, created_by: owner.session.user.id }).select('id').single()

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
const cookieOf = (who) => ({ name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(who.session)).toString('base64'), domain: 'localhost', path: '/' })

async function open(who, path, answers = null) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 375, height: 812 })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
  await page.setCookie(cookieOf(who))
  await page.evaluateOnNewDocument((org) => { try { localStorage.setItem('squadroom.org', org) } catch {} }, NRIFA)
  if (answers) {
    await page.setRequestInterception(true)
    page.on('request', (r) => {
      const u = new URL(r.url())
      const fn = u.host === host && u.pathname.startsWith('/rest/v1/rpc/') ? u.pathname.slice('/rest/v1/rpc/'.length) : null
      if (fn && fn in answers && r.method() === 'POST') {
        r.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(answers[fn]) }).catch(() => {})
        return
      }
      r.continue().catch(() => {})
    })
  }
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 90000 })
  return { context, page }
}
const text = (page) => page.evaluate(() => document.body.innerText)
const fits = (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1)
async function bothThemes(page, name) {
  let fitted = true
  for (const scheme of ['light', 'dark']) {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }])
    await sleep(250)
    fitted = fitted && (await fits(page))
    if (SHOTS) await page.screenshot({ path: `.shots/bank-${name}-${scheme}.png`, fullPage: true })
  }
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
  return fitted
}

// A signed event, the way Stripe would send it, to the real webhook.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? 'sk_test_placeholder')
const secret = process.env.STRIPE_WEBHOOK_SECRET
async function send(type, session) {
  const payload = JSON.stringify({
    id: `evt_test_${Math.random().toString(36).slice(2)}`, object: 'event', type, created: Math.floor(Date.now() / 1000), livemode: false,
    api_version: '2026-01-01', pending_webhooks: 0, request: null,
    data: { object: { object: 'checkout.session', mode: 'payment', ...session } },
  })
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret })
  const res = await fetch(`${BASE}/api/payments/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': signature }, body: payload })
  return res.status
}
const statusOf = async (sessionId) => (await admin.from('payments').select('status, stripe_payment_intent').eq('stripe_session_id', sessionId).maybeSingle()).data
const pendingRow = async (player, sessionId) =>
  admin.from('payments').insert({ academy_id: NRIFA, request_id: req.id, profile_id: sam.session.user.id, player_id: player, stripe_session_id: sessionId, amount_cents: 6000, status: 'pending' })

try {
  // ---------------------------------------------------------------------------
  head("1. The family's Payments, with a bank payment clearing (0226's answers stood in)")
  {
    const row = (player_id, player_name, status, extra = {}) => ({
      request_id: req.id, title: `${TAG} U8 kit`, description: null, amount_cents: 6000, currency: 'aud', due_on: null, closes_at: null,
      team_name: 'U8 SPL', player_id, player_name, status, paid_at: null, can_pay: true, voucher_cents: 0, voucher_label: null, ...extra,
    })
    const { context, page } = await open(sam, '/payments', {
      my_payment_requests: [row(LEO, 'Leo Whitfield', 'processing'), row(ZOE, 'Zoe Whitfield', 'unpaid'), row('00000000-0000-4000-8000-000000000001', 'Max Testing', 'paid', { paid_at: new Date().toISOString() })],
    })
    await page.waitForSelector('[data-clearing]', { timeout: 20000 }).catch(() => null)
    const t = await text(page)
    const payButtons = await page.$$eval('button', (bs) => bs.filter((b) => /^Pay \$/.test(b.textContent?.trim() ?? '')).length)
    t.includes('CLEARING') && t.includes('Leo Whitfield') && t.includes('two or three business days') ? ok('"Clearing": Leo\'s fee, paid from the bank, two or three business days') : bad(`clearing: ${t.slice(0, 300)}`)
    payButtons === 1 ? ok('one Pay button — Zoe\'s; none for the fee that is clearing') : bad(`${payButtons} Pay buttons`)
    const paidSection = t.slice(t.indexOf('PAID'))
    t.includes('PAID') && paidSection.includes('Max Testing') && !paidSection.includes('Leo Whitfield') ? ok('and it is not under Paid — the bank has not said so yet') : bad('the clearing fee is listed as paid')
    ;(await bothThemes(page, 'family')) ? ok('fits 375px, light and dark') : bad('wider than the phone')
    await context.close()
  }

  // ---------------------------------------------------------------------------
  head("2. The club's register does not chase a bank payment clearing (stood in)")
  {
    const reg = (player_id, player_name, status) => ({ player_id, player_name, guardian: 'Sam Whitfield', guardian_phone: '+61400000011', status, paid_at: null, amount_cents: 6000 })
    const { context, page } = await open(owner, '/admin/payments', {
      payment_register: [reg(LEO, 'Leo Whitfield', 'processing'), reg(ZOE, 'Zoe Whitfield', 'unpaid'), reg('00000000-0000-4000-8000-000000000001', 'Max Testing', 'paid')],
    })
    await page.waitForFunction((tag) => document.body.innerText.includes(tag), { timeout: 20000 }, `${TAG} U8 kit`).catch(() => null)
    await page.$$eval('button', (bs, tag) => bs.find((b) => b.textContent?.includes(tag))?.click(), `${TAG} U8 kit`)
    await page.waitForSelector('[data-clearing]', { timeout: 10000 }).catch(() => null)
    const t = await text(page)
    t.includes('1 paid · 1 clearing · 1 outstanding') ? ok('"1 paid · 1 clearing · 1 outstanding"') : bad(`register: ${t.slice(t.indexOf('paid ·') - 20, t.indexOf('paid ·') + 80)}`)
    const texts = await page.$$eval('a[href^="sms:"]', (as) => as.length)
    t.includes('bank payment clearing') && texts === 1 ? ok('Leo: "bank payment clearing" — only Zoe\'s family gets a Text link') : bad(`chase links: ${texts}`)
    ;(await bothThemes(page, 'register')) ? ok('fits 375px, light and dark') : bad('wider than the phone')
    await context.close()
  }

  // ---------------------------------------------------------------------------
  head('3. The webhook, with signed events')
  if (!secret) {
    note('no STRIPE_WEBHOOK_SECRET in .env.local — the webhook half is skipped')
  } else {
    const failing = `${SESSION}fail_${Date.now()}`
    await pendingRow(ZOE, failing)
    const code = await send('checkout.session.async_payment_failed', { id: failing, payment_status: 'unpaid', payment_intent: 'pi_test_fail', metadata: { kind: 'request', request_id: req.id } })
    const after = await statusOf(failing)
    code === 200 && after?.status === 'failed' ? ok('a debit that fails marks the row failed (a signed event, the real route)') : bad(`failed debit: HTTP ${code}, row ${JSON.stringify(after)}`)

    if (!has0226) {
      note('waiting for 0226 on squadroom-dev (the Supabase token) — completed-but-unpaid → processing, an expiry that must not undo it, the success that pays it, and the checkout refusing to take the money twice run then; test-rls 155–157 prove the database half locally meanwhile')
    } else {
      const clearing = `${SESSION}clear_${Date.now()}`
      await pendingRow(LEO, clearing)
      await send('checkout.session.completed', { id: clearing, payment_status: 'unpaid', payment_intent: 'pi_test_clear', metadata: { kind: 'request', request_id: req.id } })
      let row = await statusOf(clearing)
      row?.status === 'processing' && row.stripe_payment_intent === 'pi_test_clear' ? ok('Checkout completed with the payment unpaid: the row is processing') : bad(`after completed/unpaid: ${JSON.stringify(row)}`)
      await send('checkout.session.expired', { id: clearing, payment_status: 'unpaid', payment_intent: 'pi_test_clear', metadata: { kind: 'request' } })
      row = await statusOf(clearing)
      row?.status === 'processing' ? ok('a late expiry does not undo it') : bad(`after expired: ${JSON.stringify(row)}`)

      // The checkout will not take the money twice while it clears. The
      // billing row is stood in and put back exactly as it was.
      const { data: billingBefore } = await admin.from('academy_billing').select('*').eq('academy_id', NRIFA).maybeSingle()
      await admin.from('academy_billing').upsert({ academy_id: NRIFA, stripe_account_id: billingBefore?.stripe_account_id ?? 'acct_test_squadroom', charges_enabled: true }, { onConflict: 'academy_id' })
      try {
        const res = await fetch(`${BASE}/api/payments/checkout`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: `${cookieOf(sam).name}=${cookieOf(sam).value}` },
          body: JSON.stringify({ requestId: req.id, playerId: LEO }),
        })
        const body = await res.json().catch(() => ({}))
        res.status === 409 && /still clearing/.test(body.error ?? '') ? ok(`Sam cannot pay it again: ${res.status} "${body.error}"`) : bad(`checkout while clearing: ${res.status} ${JSON.stringify(body)}`)
      } finally {
        if (billingBefore) await admin.from('academy_billing').upsert(billingBefore, { onConflict: 'academy_id' })
        else await admin.from('academy_billing').delete().eq('academy_id', NRIFA)
      }

      await send('checkout.session.async_payment_succeeded', { id: clearing, payment_status: 'paid', payment_intent: 'pi_test_clear', metadata: { kind: 'request' } })
      row = await statusOf(clearing)
      row?.status === 'paid' ? ok('then Stripe says the money arrived, and it is paid') : bad(`after succeeded: ${JSON.stringify(row)}`)

      const { data: mine } = await sam.client.rpc('my_payment_requests', { p_academy: NRIFA })
      const leo = (mine ?? []).find((o) => o.request_id === req.id && o.player_id === LEO)
      leo?.status === 'paid' ? ok("and Sam's own list agrees") : bad(`Sam sees ${JSON.stringify(leo)}`)
    }
  }
} finally {
  await browser.close()
  await tidy()
}
console.log(process.exitCode ? '' : '\n  \x1b[32ma bank payment clears, and is chased by nobody meanwhile\x1b[0m\n')
