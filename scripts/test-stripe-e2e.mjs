// Run: STRIPE_E2E=1 node --env-file=.env.local scripts/test-stripe-e2e.mjs
//
// The money, end to end, against Stripe TEST mode (3 Nov 2026): a club's
// Stripe account made through our own route; a registration fee paid on
// Stripe Checkout with the test card; two children in one checkout; the
// sibling discount and a voucher in the amount charged; an instalment; a
// refund; a league's entry fee paid by a club; a referee's account and a
// referee payout. The webhook arrives through `stripe listen` forwarding
// to the dev server.
//
// The club's real account is an Express one, and only Stripe's hosted
// onboarding can finish it (see scripts/_stripe-test-accounts.mjs for why
// a script cannot). So section 0 proves the route — account, link, status
// read back — and the money then moves on test-mode accounts the API can
// activate, pointed at by the same billing rows. Everything is put back and
// closed at the end.
//
// Needs: STRIPE_SECRET_KEY (sk_test_…) and STRIPE_WEBHOOK_SECRET in
// .env.local, the dev server on :3000, and
//   stripe listen --api-key $KEY --all-snapshot \
//     --forward-to localhost:3000/api/payments/webhook \
//     --forward-connect-to localhost:3000/api/payments/webhook
// running. Without STRIPE_E2E=1 it exits 2 (not a failure), so test:all
// stays green on a machine with no listener.
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'
import { signInBoth } from './_auth.mjs'
import { testStripe, testMerchantAccount, testRecipientAccount, closeTestAccount, openAccounts, isHarness } from './_stripe-test-accounts.mjs'

if (process.env.STRIPE_E2E !== '1') {
  console.log('  STRIPE_E2E is not set — the Stripe end-to-end suite only runs by hand, with the CLI listener up')
  process.exit(2)
}
const KEY = process.env.STRIPE_SECRET_KEY ?? ''
if (!KEY.startsWith('sk_test_') || !process.env.STRIPE_WEBHOOK_SECRET) {
  console.log('  needs a TEST key (sk_test_…) and STRIPE_WEBHOOK_SECRET in .env.local')
  process.exit(2)
}
const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const ref = URL_.split('//')[1].split('.')[0]
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const stripe = testStripe()
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const note = (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`)
const head = (m) => console.log(`\n${m}`)
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const SPL = '00000000-0000-0000-0000-0000000a0003'
const RAVENS = '00000000-0000-0000-0000-0000000a0002'
const OWNER = '00000000-0000-0000-0000-0000000000a1'
const PARENT = '00000000-0000-0000-0000-0000000000b1'
const U8 = '00000000-0000-0000-0000-0000000d0008'
const LEO = '00000000-0000-0000-0000-0000000e0001'
const ZOE = '00000000-0000-0000-0000-0000000e0006'
const TAG = 'STRIPE-E2E'
const REF_EMAIL = 'stripe-e2e-ref@squadroom.invalid'
const REF2_EMAIL = 'stripe-e2e-ref2@squadroom.invalid'
const findings = []

// Stripe, straight: for reading back what the webhook should have done.
const stripeApi = async (path, { method = 'GET', body, account } = {}) => {
  const headers = { Authorization: 'Basic ' + Buffer.from(KEY + ':').toString('base64') }
  if (account) headers['Stripe-Account'] = account
  if (body) headers['content-type'] = 'application/x-www-form-urlencoded'
  return (await fetch('https://api.stripe.com/v1' + path, { method, headers, body })).json()
}

const owner = await signInBoth(admin, 'joeylameri@outlook.com')
const parent = await signInBoth(admin, 'p61400000011@squadroom.invalid')
const ravens = await signInBoth(admin, 'p61400000091@squadroom.invalid')
if (!owner || !parent || !ravens) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}
const cookieOf = (s) => `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(s.session)).toString('base64')}`
const api = async (s, path, body, method = 'POST') => {
  const res = await fetch(`${BASE}${path}`, { method, headers: { 'content-type': 'application/json', cookie: cookieOf(s) }, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { json = { raw: text.slice(0, 300) } }
  return { status: res.status, ...json }
}
const until = async (fn, ms = 20000, every = 1000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const v = await fn()
    if (v) return v
    await new Promise((r) => setTimeout(r, every))
  }
  return null
}

// ------------------------------------------------------------ onboarding
// Our route first: it makes the club's Express account and the onboarding
// link, and reads the status back. A club whose owner has finished Stripe's
// pages is used as it is. Otherwise a test-mode account the API can
// activate stands in behind the same billing row for the rest of the run.
const connected = []
async function ensureConnected(academyId, who, label, name) {
  const { data: before } = await admin.from('academy_billing').select('*').eq('academy_id', academyId).maybeSingle()
  const first = await api(who, '/api/payments/connect', { academyId })
  if (first.status !== 200) { bad(`${label}: connect route ${first.status} ${first.error ?? first.raw ?? ''}`); return null }
  const routeMadeIt = !before?.stripe_account_id || before.stripe_account_id !== first.account_id
  String(first.url ?? '').startsWith('https://connect.stripe.com/') && /^acct_/.test(first.account_id ?? '')
    ? ok(`${label}: the route ${routeMadeIt ? 'made an Express account and' : 'found its Express account and made'} an onboarding link (${first.account_id})`)
    : bad(`${label}: no onboarding link: ${JSON.stringify(first).slice(0, 200)}`)
  const st = await api(who, `/api/payments/connect?academyId=${academyId}`, null, 'GET')
  const entry = { academyId, before, routeAccount: first.account_id, routeMadeIt, harness: null }
  connected.push(entry)
  if (st.charges_enabled) { ok(`${label} is connected for real — a person finished Stripe's onboarding (${first.account_id})`); return first.account_id }
  st.started === true && st.charges_enabled === false && typeof st.requirements?.outstanding === 'number'
    ? ok(`status read back from Stripe: started, charges off, ${st.requirements.outstanding} requirements outstanding (Stripe's hosted pages are the only way to finish an Express account)`)
    : bad(`${label}: status: ${JSON.stringify(st).slice(0, 200)}`)
  const { data: academy } = await admin.from('academies').select('slug').eq('id', academyId).single()
  const harness = await testMerchantAccount(stripe, { academyId, name, email: `${academy?.slug ?? 'club'}-harness@squadroom.invalid`, url: `https://squadroom-dev.netlify.app/${academy?.slug ?? ''}` })
  entry.harness = harness.id
  await admin.from('academy_billing').upsert({ academy_id: academyId, stripe_account_id: harness.id, charges_enabled: false, payouts_enabled: false }, { onConflict: 'academy_id' })
  const st2 = await api(who, `/api/payments/connect?academyId=${academyId}`, null, 'GET')
  st2.charges_enabled && st2.payouts_enabled
    ? ok(`${label}: a test-mode account the API activates stands in (${harness.id}${harness.reused ? ', reused' : ''}); the route reads it back as charges and payouts enabled`)
    : bad(`${label}: the stand-in did not read back as enabled: ${JSON.stringify(st2).slice(0, 200)}`)
  return harness.id
}

// A card paid on Stripe's hosted Checkout, in a browser, with a test card.
async function payOnCheckout(url, label, card = '4242424242424242') {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 420, height: 900 })
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 })
    await page.waitForSelector('#cardNumber', { timeout: 60000 })
    const email = await page.$('#email')
    if (email) await page.type('#email', 'sam.whitfield@squadroom.invalid', { delay: 10 })
    await page.type('#cardNumber', card, { delay: 10 })
    await page.type('#cardExpiry', '1234', { delay: 10 })
    await page.type('#cardCvc', '123', { delay: 10 })
    const name = await page.$('#billingName')
    if (name) await page.type('#billingName', 'Sam Whitfield', { delay: 10 })
    const country = await page.$('#billingCountry')
    if (country) await page.select('#billingCountry', 'AU').catch(() => {})
    const postal = await page.$('#billingPostalCode')
    if (postal) await page.type('#billingPostalCode', '2113', { delay: 10 })
    // Checkout pre-ticks "Save my information with Link", which adds a
    // required phone number; a parent would untick it or type theirs.
    const linkBox = await page.$('input[type="checkbox"]#enableStripePass, input[type="checkbox"][name="enableStripePass"]')
    if (linkBox && (await linkBox.evaluate((el) => el.checked))) await linkBox.click()
    const phone = await page.$('#phoneNumber')
    if (phone && (await phone.evaluate((el) => !el.value && el.offsetParent !== null))) await page.type('#phoneNumber', '0412345678', { delay: 10 })
    const total = await page.evaluate(() => document.body.innerText.match(/A\$[\d,.]+|\$[\d,.]+/)?.[0] ?? null)
    await page.click('.SubmitButton, button[type="submit"]')
    // Back on the app means paid (the browser holds no session, so the app
    // sends it to /signin — still the app). Stripe's page says why if not.
    let state = null
    for (let i = 0; i < 45 && !page.url().startsWith(BASE); i++) {
      await new Promise((r) => setTimeout(r, 2000))
      state = await page.evaluate(() => ({
        errors: [...document.querySelectorAll('[role=alert], .FieldError, [class*="Error"], [class*="error"]')].map((e) => e.innerText.trim().replace(/\s+/g, ' ')).filter(Boolean).slice(0, 4),
        button: document.querySelector('.SubmitButton, button[type="submit"]')?.innerText.trim().replace(/\s+/g, ' ').slice(0, 30) ?? null,
        text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 200),
      })).catch(() => null)
      if (state?.errors?.length) break
      // A click that never took (the button still says Pay after 20s): once more.
      if (i === 10 && state?.button === 'Pay') await page.click('.SubmitButton, button[type="submit"]').catch(() => {})
    }
    if (!page.url().startsWith(BASE)) {
      const shot = `.shots/stripe/fail-${label.replace(/\W+/g, '-')}.png`
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {})
      throw new Error(`still on Stripe after paying: ${JSON.stringify(state)} (${shot})`)
    }
    ok(`${label}: paid on Stripe Checkout (${total ?? 'amount shown'}) and sent back to ${page.url().replace(BASE, '')}`)
    return true
  } catch (e) {
    bad(`${label}: checkout in the browser failed — ${e.message.slice(0, 400)}`)
    return false
  } finally {
    await browser.close()
  }
}

// ------------------------------------------------------------------ tidy
const refereeAccounts = []
async function tidy() {
  const { data: reqs } = await admin.from('payment_requests').select('id').like('title', `${TAG}%`)
  for (const r of reqs ?? []) {
    await admin.from('refunds').delete().in('payment_id', (await admin.from('payments').select('id').eq('request_id', r.id)).data?.map((p) => p.id) ?? [])
    await admin.from('voucher_redemptions').delete().eq('request_id', r.id)
    await admin.from('payments').delete().eq('request_id', r.id)
  }
  const { data: progs } = await admin.from('programs').select('id').like('name', `${TAG}%`)
  for (const p of progs ?? []) {
    await admin.from('refunds').delete().in('registration_id', (await admin.from('program_registrations').select('id').eq('program_id', p.id)).data?.map((r) => r.id) ?? [])
    await admin.from('program_registrations').delete().eq('program_id', p.id)
  }
  await admin.from('programs').delete().like('name', `${TAG}%`)
  await admin.from('payment_requests').delete().like('title', `${TAG}%`)
  await admin.from('vouchers').delete().like('code', `${TAG.replace('-', '')}%`)
  const { data: comps } = await admin.from('competitions').select('id').like('name', `${TAG}%`)
  for (const c of comps ?? []) await admin.from('competitions').delete().eq('id', c.id)
  await admin.from('referees').delete().like('full_name', `% ${TAG}`)
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 })
  for (const e of [REF_EMAIL, REF2_EMAIL]) {
    const u = users?.users?.find((x) => x.email === e)
    if (u) await admin.auth.admin.deleteUser(u.id)
  }
  // Billing rows back as they were; everything this run made at Stripe closed.
  for (const c of connected) {
    if (c.before) await admin.from('academy_billing').upsert(c.before, { onConflict: 'academy_id' })
    else await admin.from('academy_billing').delete().eq('academy_id', c.academyId)
    if (c.harness) console.log(`  stand-in ${c.harness}: ${await closeTestAccount(stripe, c.harness)}`)
    if (c.routeMadeIt) console.log(`  express ${c.routeAccount}: ${await closeTestAccount(stripe, c.routeAccount)}`)
  }
  for (const id of refereeAccounts) console.log(`  referee ${id}: ${await closeTestAccount(stripe, id)}`)
  await admin.from('payment_requests').delete().eq('title', `${TAG} Probe`)
}
// A crashed earlier run can leave a billing row on a stand-in. Put it back on
// the club's Express account if the route made one, else clear it, so the
// run starts where a real club would: before "Set up payments".
async function preClean() {
  const accounts = await openAccounts()
  const { data: rows } = await admin.from('academy_billing').select('academy_id, stripe_account_id').in('academy_id', [NRIFA, SPL])
  for (const row of rows ?? []) {
    const held = accounts.find((a) => a.id === row.stripe_account_id)
    if (!held || !isHarness(held)) continue
    const express = accounts.find((a) => !isHarness(a) && a.metadata.academy_id === row.academy_id)
    if (express) await admin.from('academy_billing').update({ stripe_account_id: express.id, charges_enabled: false, payouts_enabled: false, details_submitted: false, connected_at: null }).eq('academy_id', row.academy_id)
    else await admin.from('academy_billing').delete().eq('academy_id', row.academy_id)
    console.log(`  (an earlier run left ${row.academy_id.slice(-4)} on stand-in ${held.id}; ${express ? `back on ${express.id}` : 'row cleared'})`)
  }
}
await tidy()
await preClean()

try {

head('0. Test mode, and the clubs connected')
const bal = await stripeApi('/balance')
bal.livemode === false ? ok('Stripe says livemode: false — test money only') : bad(`livemode is ${bal.livemode} — STOP`)
const nrifaAcct = await ensureConnected(NRIFA, owner, 'NRIFA', 'NRIFA Football Academy')
const splAcct = await ensureConnected(SPL, owner, 'the SPL', 'Sydney Premier League')
if (!nrifaAcct) { console.log('\n  Stopping: NRIFA is not connected.'); await tidy(); process.exit(process.exitCode ?? 1) }

head('1. A registration fee, paid with the test card')
const { data: req } = await admin.from('payment_requests').insert({ academy_id: NRIFA, team_id: U8, title: `${TAG} Term 4 fee`, amount_cents: 4500, per_player: true, due_on: new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10), created_by: OWNER }).select('id').single()
let co = await api(parent, '/api/payments/checkout', { requestId: req.id, playerId: LEO })
co.status === 200 && co.url ? ok(`a Checkout Session for Leo: ${co.amount_cents} cents`) : bad(`checkout: ${co.status} ${co.error ?? co.raw ?? ''}`)
if (co.url) {
  await payOnCheckout(co.url, 'Leo')
  const paid = await until(async () => { const { data } = await admin.from('payments').select('status, stripe_payment_intent').eq('stripe_session_id', co.session_id).maybeSingle(); return data?.status === 'paid' ? data : null }, 30000, 1500)
  paid ? ok(`the webhook marked it paid (${paid.stripe_payment_intent})`) : bad('the payment never became paid — is stripe listen forwarding to this server?')
  const { data: mine } = await parent.client.rpc('my_payment_requests', { p_academy: NRIFA })
  mine?.find((r) => r.request_id === req.id && r.player_id === LEO)?.status === 'paid' ? ok("the parent's list shows Leo's fee paid") : bad("the parent's list does not show it paid")
  const pi = paid?.stripe_payment_intent ? await stripeApi(`/payment_intents/${paid.stripe_payment_intent}`, { account: nrifaAcct }) : null
  pi?.amount === co.amount_cents && pi.status === 'succeeded' ? ok(`Stripe has the charge on the club's own account: ${pi.amount} cents, ${pi.status}, no application fee`) : bad(`Stripe intent: ${JSON.stringify(pi).slice(0, 160)}`)
  if (pi) findings.push(`registration fee: ${pi.amount} cents charged on the club's account, application_fee_amount ${pi.application_fee_amount ?? 'none'}`)
}

head('2. Two children in one checkout, with the sibling discount')
// The club's ladder (academies.sibling_discount_bps, one entry per extra
// child) as the seed left it; the quote applies it to the second child.
const { data: ladderRow } = await admin.from('academies').select('sibling_discount_bps').eq('id', NRIFA).single()
ok(`the club's sibling ladder: ${JSON.stringify(ladderRow?.sibling_discount_bps)} bps`)
const { data: req2 } = await admin.from('payment_requests').insert({ academy_id: NRIFA, team_id: U8, title: `${TAG} Gala day`, amount_cents: 3000, per_player: true, created_by: OWNER }).select('id').single()
const q1 = await parent.client.rpc('quote_payment', { p_request: req2.id, p_player: LEO })
const q2 = await parent.client.rpc('quote_payment', { p_request: req2.id, p_player: ZOE })
const a1 = q1.data?.schedule?.[0]?.amount_cents, a2 = q2.data?.schedule?.[0]?.amount_cents
a1 && a2 && Math.min(a1, a2) < Math.max(a1, a2) ? ok(`the quotes: ${a1} and ${a2} cents — one child discounted`) : note(`the quotes: ${a1} and ${a2} cents (${JSON.stringify(q1.data).slice(0, 120)})`)
co = await api(parent, '/api/payments/checkout', { requestId: req2.id, playerIds: [LEO, ZOE] })
co.status === 200 && co.children === 2 && co.amount_cents === (a1 ?? 0) + (a2 ?? 0) ? ok(`one session for both: ${co.amount_cents} cents`) : bad(`family checkout: ${co.status} ${co.error ?? ''} ${JSON.stringify({ children: co.children, amount: co.amount_cents })}`)
if (co.url) {
  await payOnCheckout(co.url, 'Leo and Zoe')
  const both = await until(async () => { const { data } = await admin.from('payments').select('player_id, status').eq('stripe_session_id', co.session_id); return data?.length === 2 && data.every((p) => p.status === 'paid') ? data : null }, 30000, 1500)
  both ? ok('both rows marked paid by one webhook') : bad('the two rows did not both become paid')
  if (both) findings.push(`two children in one checkout: ${co.amount_cents} cents (${a1} + ${a2}, the second child discounted), both rows paid by one webhook`)
}

head('3. A voucher, and an instalment')
const { data: req3 } = await admin.from('payment_requests').insert({ academy_id: NRIFA, team_id: U8, title: `${TAG} Camp`, amount_cents: 8000, per_player: true, instalments: 4, instalment_every_days: 30, created_by: OWNER }).select('id').single()
const { error: vErr } = await admin.from('vouchers').insert({ academy_id: NRIFA, code: `${TAG.replace('-', '')}20`, label: 'E2E twenty off', kind: 'club', amount_cents: 2000, created_by: OWNER })
if (vErr) bad(`voucher insert: ${vErr.message}`)
const red = await parent.client.rpc('redeem_voucher', { p_code: `${TAG.replace('-', '')}20`, p_request: req3.id, p_player: LEO })
red.error ? bad(`redeem: ${red.error.message}`) : ok(`voucher applied: ${JSON.stringify(red.data).slice(0, 120)}`)
const q3 = await parent.client.rpc('quote_payment', { p_request: req3.id, p_player: LEO })
const first3 = q3.data?.schedule?.[0]
first3 ? ok(`first of ${q3.data.schedule.length} instalments: ${first3.amount_cents} cents (${JSON.stringify({ ...q3.data, schedule: undefined }).slice(0, 140)})`) : bad(`quote: ${JSON.stringify(q3).slice(0, 200)}`)
co = await api(parent, '/api/payments/checkout', { requestId: req3.id, playerId: LEO })
co.status === 200 && co.amount_cents === first3?.amount_cents ? ok(`the session charges exactly the first instalment: ${co.amount_cents} cents`) : bad(`instalment checkout: ${co.status} ${co.error ?? ''} ${co.amount_cents}`)
if (co.url) {
  await payOnCheckout(co.url, 'instalment 1')
  const p1 = await until(async () => { const { data } = await admin.from('payments').select('status, instalment_seq').eq('stripe_session_id', co.session_id).maybeSingle(); return data?.status === 'paid' ? data : null }, 30000, 1500)
  p1?.instalment_seq === 1 ? ok('instalment 1 paid; the next checkout will be part 2') : bad(`instalment 1: ${JSON.stringify(p1)}`)
  const q4 = await parent.client.rpc('quote_payment', { p_request: req3.id, p_player: LEO })
  const statuses = q4.data?.schedule?.map((s) => s.status)
  statuses?.[0] === 'paid' && statuses[1] === 'unpaid' ? ok('the schedule shows part 1 paid, part 2 next') : bad(`schedule after: ${JSON.stringify(statuses)}`)
  const co2 = await api(parent, '/api/payments/checkout', { requestId: req3.id, playerId: LEO })
  co2.status === 200 && co2.amount_cents === q4.data?.schedule?.[1]?.amount_cents ? ok(`the next session is part 2: ${co2.amount_cents} cents`) : note(`next session: ${co2.status} ${co2.amount_cents} ${co2.error ?? ''}`)
  if (p1) findings.push(`voucher and instalments: $20 off an $80 camp in 4 parts; part 1 charged ${co.amount_cents} cents, part 2 quoted ${co2.amount_cents ?? '?'} cents`)
}

head('4. A refund, issued by the club, confirmed by Stripe')
// A refund is always of a registration (0145 works it out on withdrawal),
// so the paid fee gets a program and Leo a place on it.
const { data: paidRow } = await admin.from('payments').select('id, amount_cents, stripe_payment_intent').eq('request_id', req.id).eq('status', 'paid').maybeSingle()
if (paidRow?.stripe_payment_intent) {
  const { data: program } = await admin.from('programs').insert({ academy_id: NRIFA, name: `${TAG} Term 4`, kind: 'term_class', status: 'open', payment_request_id: req.id, payment_required: true, created_by: OWNER }).select('id').single()
  const { data: rego, error: regoErr } = await admin.from('program_registrations').insert({ academy_id: NRIFA, program_id: program.id, player_id: LEO, submitted_by: PARENT, status: 'approved', answers: {} }).select('id').single()
  if (regoErr) bad(`registration: ${regoErr.message}`)
  const { data: refund, error: rErr } = await admin.from('refunds').insert({ academy_id: NRIFA, registration_id: rego?.id, player_id: LEO, payment_id: paidRow.id, amount_cents: 1500, reason: 'withdrawn', status: 'requested', requested_by: PARENT }).select('id').single()
  if (rErr) bad(`refund row: ${rErr.message}`)
  const pr = await api(parent, '/api/payments/refund', { refundId: refund?.id })
  pr.status === 403 || pr.status === 404 ? ok(`a parent cannot issue one (${pr.status})`) : bad(`parent refund: ${pr.status} ${pr.error ?? ''}`)
  const rr = await api(owner, '/api/payments/refund', { refundId: refund?.id })
  rr.status === 200 && rr.stripe_refund_id ? ok(`the owner issues a $15 refund: ${rr.stripe_refund_id}`) : bad(`refund: ${rr.status} ${rr.error ?? ''}`)
  const refunded = await until(async () => { const { data } = await admin.from('payments').select('status').eq('id', paidRow.id).single(); return data?.status === 'refunded' ? data : null }, 30000, 1500)
  refunded ? ok('the webhook marked the payment refunded') : bad('the payment did not become refunded')
  const sr = rr.stripe_refund_id ? await stripeApi(`/refunds/${rr.stripe_refund_id}`, { account: nrifaAcct }) : {}
  sr.amount === 1500 && sr.status ? ok(`Stripe has the refund: ${sr.amount} cents, ${sr.status}`) : bad(`Stripe refund: ${JSON.stringify(sr).slice(0, 200)}`)
  const again = await api(owner, '/api/payments/refund', { refundId: refund?.id })
  again.status === 409 ? ok('issuing it twice is refused') : bad(`second issue: ${again.status}`)
  findings.push(`refund: $15 of a $45 fee, issued on the club's account (${sr.status}), payment row marked refunded by the webhook`)
} else bad('no paid row to refund')

head('5. A league entry fee, paid online by the club')
let comp = null
if (splAcct) {
  const made = await admin.from('competitions').insert({ organiser_id: SPL, name: `${TAG} Cup`, type: 'season', season: '2026', status: 'active', mode: 'managed', visibility: 'participants', entries_open: true, created_by: OWNER }).select('id').single()
  comp = made.data
  if (!comp) bad(`competition: ${made.error?.message}`)
  await admin.from('competition_clubs').insert([{ competition_id: comp.id, academy_id: RAVENS, status: 'active', joined_at: new Date().toISOString() }, { competition_id: comp.id, academy_id: NRIFA, status: 'active', joined_at: new Date().toISOString() }])
  const { error: feeErr } = await owner.client.rpc('set_competition_fee', { p_competition: comp.id, p_division: 'U8', p_fee_cents: 12000 })
  if (feeErr) bad(`set_competition_fee: ${feeErr.message}`)
  const { data: entry } = await admin.from('competition_entries').insert({ competition_id: comp.id, academy_id: RAVENS, team_id: null, display_name: 'Ravens U8', division: 'U8' }).select('id').single()
  const fee = await until(async () => { const { data } = await admin.from('entry_fees').select('id, amount_cents, status').eq('entry_id', entry.id).maybeSingle(); return data }, 5000, 500)
  fee?.amount_cents === 12000 && fee.status === 'owed' ? ok("the Ravens' entry raised a $120 fee, owed") : bad(`fee: ${JSON.stringify(fee)}`)
  const pe = await api(parent, '/api/payments/entry-fee', { feeId: fee?.id })
  pe.status === 403 || pe.status === 404 ? ok(`a parent cannot pay a club's entry fee (${pe.status})`) : bad(`parent entry fee: ${pe.status}`)
  const ef = await api(ravens, '/api/payments/entry-fee', { feeId: fee?.id })
  ef.status === 200 && ef.url ? ok("the Ravens' owner gets a Checkout Session on the league's account") : bad(`entry fee checkout: ${ef.status} ${ef.error ?? ''}`)
  if (ef.url) {
    // The card that skips the pending balance, so the league has the money
    // available for the referee transfer below.
    await payOnCheckout(ef.url, 'Ravens entry fee', '4000000000000077')
    const paidFee = await until(async () => { const { data } = await admin.from('entry_fees').select('status, method, stripe_payment_intent').eq('id', fee.id).single(); return data?.status === 'paid' ? data : null }, 30000, 1500)
    paidFee?.method === 'stripe' ? ok('the webhook marked the entry fee paid by Stripe') : bad(`entry fee after: ${JSON.stringify(paidFee)}`)
    const { data: fv } = await owner.client.rpc('competition_fees_view', { p_competition: comp.id })
    JSON.stringify(fv ?? '').includes('"paid"') ? ok("the league's fees view shows it paid") : note(`fees view: ${JSON.stringify(fv).slice(0, 160)}`)
    const lb = await stripeApi('/balance', { account: splAcct })
    const avail = lb.available?.find((b) => b.currency === 'aud')?.amount
    ok(`the league's available balance: ${avail ?? '?'} cents`)
    if (paidFee) findings.push(`league entry fee: $120 charged on the league's account, marked paid by the webhook; league balance ${avail ?? '?'} cents available`)
  }
} else bad('the SPL is not connected — skipped')

head("6. A referee's account, and a payout from the league")
if (splAcct && comp) {
  const mkUser = async (email, name) => {
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true })
    if (error) { bad(`user ${email}: ${error.message}`); return null }
    await admin.from('profiles').upsert({ id: data.user.id, full_name: name })
    return data.user.id
  }
  const refId = await mkUser(REF_EMAIL, `Pat Whistle ${TAG}`)
  const ref2Id = await mkUser(REF2_EMAIL, `Robin Flag ${TAG}`)
  const { data: pool } = await admin.from('referees').insert({ academy_id: SPL, profile_id: refId, full_name: `Pat Whistle ${TAG}`, grade: 'Level 3', claimed_at: new Date().toISOString() }).select('id').single()
  const { data: pool2 } = await admin.from('referees').insert({ academy_id: SPL, profile_id: ref2Id, full_name: `Robin Flag ${TAG}`, grade: 'Level 4', claimed_at: new Date().toISOString() }).select('id').single()
  const referee = await signInBoth(admin, REF_EMAIL)
  const referee2 = await signInBoth(admin, REF2_EMAIL)

  // 6a. The route, for a referee with nothing yet: a recipient account and a link.
  const none = await api(referee2, '/api/payments/referees/connect', null, 'GET')
  none.started === false ? ok('a referee with no account: not started') : bad(`status: ${JSON.stringify(none)}`)
  const made = await api(referee2, '/api/payments/referees/connect', {})
  if (made.account_id) refereeAccounts.push(made.account_id)
  made.status === 200 && String(made.url ?? '').startsWith('https://connect.stripe.com/') ? ok(`the route makes a recipient-only account and an onboarding link for Robin (${made.account_id})`) : bad(`referee connect: ${made.status} ${made.error ?? JSON.stringify(made).slice(0, 160)}`)
  const { data: robin } = await admin.from('referees').select('stripe_account_id').eq('id', pool2.id).single()
  robin?.stripe_account_id === made.account_id ? ok("written on Robin's referee row") : bad(`referee row: ${JSON.stringify(robin)}`)
  const after = await api(referee2, '/api/payments/referees/connect', null, 'GET')
  after.started === true && after.connected === false ? ok(`read back: started, not yet able to receive (${after.outstanding} requirements outstanding)`) : bad(`status after: ${JSON.stringify(after)}`)
  const notRef = await api(parent, '/api/payments/referees/connect', {})
  notRef.status === 403 ? ok('a parent is not a referee (403)') : bad(`parent as referee: ${notRef.status}`)

  // 6b. Pat: a test-mode recipient account the API activates, on the referee row.
  const pat = await testRecipientAccount(stripe, { name: 'Pat Whistle', email: REF_EMAIL })
  refereeAccounts.push(pat.id)
  await admin.from('referees').update({ stripe_account_id: pat.id }).eq('id', pool.id)
  const patSt = await api(referee, '/api/payments/referees/connect', null, 'GET')
  patSt.connected === true ? ok(`Pat's account reads back as able to receive transfers (${pat.id})`) : bad(`Pat status: ${JSON.stringify(patSt)}`)

  // 6c. A game Pat refereed last Saturday, a fee, a run.
  const { data: entries } = await admin.from('competition_entries').insert([
    { competition_id: comp.id, academy_id: NRIFA, team_id: U8, display_name: 'NRIFA U8', division: 'U8' },
  ]).select('id')
  const { data: others } = await admin.from('competition_entries').select('id').eq('competition_id', comp.id).neq('id', entries[0].id).limit(1)
  const lastSat = new Date(); lastSat.setDate(lastSat.getDate() - ((lastSat.getDay() + 1) % 7 || 7)); lastSat.setHours(9, 0, 0, 0)
  const { data: fx, error: fxErr } = await admin.from('fixtures').insert({ competition_id: comp.id, division: 'U8', round: 'R1', home_entry_id: entries[0].id, away_entry_id: others[0].id, starts_at: lastSat.toISOString(), status: 'final', home_score: 1, away_score: 0, stage: 'group' }).select('id').single()
  if (fxErr) bad(`fixture: ${fxErr.message}`)
  await admin.from('referee_appointments').insert({ competition_id: comp.id, fixture_id: fx.id, referee_id: pool.id, academy_id: SPL, role: 'referee', status: 'accepted', checked_in_at: lastSat.toISOString() })
  const { error: feeE } = await owner.client.rpc('set_referee_fee', { p_competition: comp.id, p_role: 'referee', p_fee_cents: 4500 })
  if (feeE) bad(`set_referee_fee: ${feeE.message}`)
  const from = lastSat.toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' })
  const { data: runId, error: runE } = await owner.client.rpc('build_referee_payment_run', { p_competition: comp.id, p_from: from, p_to: from })
  runId ? ok(`the league builds a run: Pat, one game, $45`) : bad(`run: ${runE?.message ?? 'nothing built'}`)

  // 6d. Pay it through Stripe: a transfer from the league's account to Pat's.
  if (runId) {
    const notYou = await api(ravens, '/api/payments/referees', { runId })
    notYou.status === 404 || notYou.status === 403 ? ok(`a club cannot pay the league's run (${notYou.status})`) : bad(`club paying run: ${notYou.status}`)
    const t = await api(owner, '/api/payments/referees', { runId })
    const { data: items } = await admin.from('referee_payment_items').select('status, stripe_transfer_id, amount_cents').eq('run_id', runId)
    const { data: run } = await admin.from('referee_payment_runs').select('status, paid_method').eq('id', runId).single()
    if (t.status === 200 && t.ok) {
      items?.every((i) => i.status === 'paid' && i.stripe_transfer_id) && run?.status === 'paid' && run.paid_method === 'stripe'
        ? ok(`Stripe moved $45 from the league to Pat (${items[0].stripe_transfer_id}); the run and its item are marked paid by Stripe`)
        : bad(`after payout: ${JSON.stringify({ items, run })}`)
      const tr = await stripeApi(`/transfers/${items?.[0]?.stripe_transfer_id}`, { account: splAcct })
      tr.amount === 4500 && tr.destination === pat.id ? ok(`Stripe has the transfer: ${tr.amount} cents to ${tr.destination}`) : note(`transfer read back: ${JSON.stringify(tr).slice(0, 200)}`)
      findings.push(`referee payout: Stripe accepted a $45 transfer from the league's connected account to the referee's (${items?.[0]?.stripe_transfer_id})`)
    } else {
      const why = (t.failed?.[0] ?? t.error ?? JSON.stringify(t)).slice(0, 300)
      note(`Stripe would not move the money league → referee: ${t.status} — ${why}`)
      items?.every((i) => i.status === 'pending' && !i.stripe_transfer_id) && run?.status === 'draft'
        ? ok('nothing was marked paid: the run stays draft, the item pending, for the treasurer to pay by bank transfer')
        : bad(`after a refused payout: ${JSON.stringify({ items, run })}`)
      findings.push(`referee payout: Stripe refused the connected-to-connected transfer — ${why}`)
    }
  }
} else note('skipped — needs the SPL connected and the cup from section 5')

head('What works')
for (const f of findings) console.log(`  · ${f}`)
} catch (e) {
  bad(`the suite crashed: ${e.stack?.split('\n').slice(0, 3).join(' | ') ?? e}`)
} finally {
  await tidy()
}
process.exit(process.exitCode ?? 0)
