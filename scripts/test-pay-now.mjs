// Run: STRIPE_E2E=1 node --env-file=.env.local scripts/test-pay-now.mjs
//   (the dev server on :3000 and `stripe listen` forwarding to it, as
//   test-stripe-e2e needs; SHOTS=1 saves the form's Pay now at 375px)
//
// The registration brief, gap 1 (0262): pay now, refund on reject. A
// pay-now squad on NRIFA with a $120 fee; NRIFA's billing stood in by a
// test-mode merchant the API activates (as test-stripe-e2e does). A new
// family registers two children from the public form's API and pays each
// on Stripe Checkout with the test card, before the club has looked: the
// payment is written against the request, an account exists for their
// mobile, no player yet. The owner approves one — the payment now belongs
// to the player — and declines the other — refunded in full on its own,
// the refund row issued and the payment marked refunded by the webhook.
// The form at 375px shows "Pay now" with the fee, and "Paid and sent" back
// from Stripe. Everything made here is deleted and the billing restored.
// Without STRIPE_E2E=1 it exits 2 (not a failure).
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'
import { signInBoth } from './_auth.mjs'
import { listAllUsers } from './_users.mjs'
import { resolveBaseUrl } from './_base-url.mjs'
import { testStripe, testMerchantAccount, closeTestAccount } from './_stripe-test-accounts.mjs'

if (process.env.STRIPE_E2E !== '1') {
  console.log('  STRIPE_E2E=1 not set — pay-now needs Stripe test mode and the listener; skipped (exit 2)')
  process.exit(2)
}
const BASE = await resolveBaseUrl()
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const ref = URL_.split('//')[1].split('.')[0]
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SHOTS = process.env.SHOTS === '1'
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const head = (m) => console.log(`\n${m}`)
if (SHOTS) mkdirSync('.shots', { recursive: true })

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const SLUG = 'nrifa'
const TAG = 'Zz Paynow'
const PHONE = '+61400009951'
const stripe = testStripe()
const until = async (fn, ms = 30000, every = 1500) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, every)) }
  return null
}
const post = async (path, body, cookie) => {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, ...json }
}

async function cleanup() {
  const { data: progs } = await admin.from('programs').select('id, payment_request_id').eq('academy_id', NRIFA).like('name', `${TAG} %`)
  for (const p of progs ?? []) {
    const { data: reqs } = await admin.from('registration_requests').select('id').eq('program_id', p.id)
    for (const r of reqs ?? []) {
      const { data: pays } = await admin.from('payments').select('id').eq('registration_request_id', r.id)
      for (const pay of pays ?? []) { await admin.from('refunds').delete().eq('payment_id', pay.id); await admin.from('payments').delete().eq('id', pay.id) }
      await admin.from('registration_requests').delete().eq('id', r.id)
    }
    if (p.payment_request_id) { await admin.from('payments').delete().eq('request_id', p.payment_request_id) }
    await admin.from('payment_requests').delete().eq('academy_id', NRIFA).like('title', `${TAG} season fee — %`)
    await admin.from('programs').delete().eq('id', p.id)
    if (p.payment_request_id) await admin.from('payment_requests').delete().eq('id', p.payment_request_id)
  }
  const { data: kids } = await admin.from('players').select('id').eq('academy_id', NRIFA).like('full_name', `${TAG} %`)
  for (const k of kids ?? []) { await admin.from('player_guardians').delete().eq('player_id', k.id); await admin.from('players').delete().eq('id', k.id) }
  const { data: users } = await listAllUsers(admin)
  const u = users?.users?.find((x) => x.phone === PHONE.replace('+', ''))
  if (u) await admin.auth.admin.deleteUser(u.id)
}
await cleanup()

const owner = await signInBoth(admin, 'head@squadroom-demo.test')
if (!owner) { console.log("  could not sign in — the project's auth rate limit, not a failure"); process.exit(2) }
const cookie = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(owner.session)).toString('base64')}`

// The club's billing, stood in by a test merchant; put back at the end.
const { data: billingBefore } = await admin.from('academy_billing').select('*').eq('academy_id', NRIFA).maybeSingle()
const harness = await testMerchantAccount(stripe, { academyId: NRIFA, name: 'NRIFA Football Academy', email: 'nrifa-harness@squadroom.invalid', url: 'https://squadroom-dev.netlify.app/nrifa' })
await admin.from('academy_billing').upsert({ academy_id: NRIFA, stripe_account_id: harness.id, charges_enabled: true, payouts_enabled: true }, { onConflict: 'academy_id' })
ok(`NRIFA's billing stood in by ${harness.id}${harness.reused ? ' (reused)' : ''}`)

// A pay-now squad with a $120 fee.
const { data: fee } = await admin.from('payment_requests').insert({ academy_id: NRIFA, title: `${TAG} season fee`, amount_cents: 12000, per_player: true, currency: 'aud' }).select('id').single()
const { data: program } = await admin.from('programs').insert({
  academy_id: NRIFA, name: `${TAG} Squad`, kind: 'squad', status: 'open', season: '2026', created_by: owner.session.user.id,
  payment_required: true, payment_request_id: fee.id, pay_timing: 'now', born_from_year: 2015, born_to_year: 2018,
}).select('id').single()
const { data: pub } = await admin.rpc('public_programs', { p_slug: SLUG })
const consents = ((pub?.consents ?? [])).map((c) => ({ id: c.id, version: c.version }))

async function payOnCheckout(url, label) {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 420, height: 900 })
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 })
    await page.waitForSelector('#cardNumber', { timeout: 60000 })
    const email = await page.$('#email')
    if (email) await page.type('#email', 'paynow.parent@squadroom.invalid', { delay: 10 })
    await page.type('#cardNumber', '4242424242424242', { delay: 10 })
    await page.type('#cardExpiry', '1234', { delay: 10 })
    await page.type('#cardCvc', '123', { delay: 10 })
    const name = await page.$('#billingName')
    if (name) await page.type('#billingName', 'Paynow Parent', { delay: 10 })
    const country = await page.$('#billingCountry')
    if (country) await page.select('#billingCountry', 'AU').catch(() => {})
    const postal = await page.$('#billingPostalCode')
    if (postal) await page.type('#billingPostalCode', '2113', { delay: 10 })
    const linkBox = await page.$('input[type="checkbox"]#enableStripePass, input[type="checkbox"][name="enableStripePass"]')
    if (linkBox && (await linkBox.evaluate((el) => el.checked))) await linkBox.click()
    const phone = await page.$('#phoneNumber')
    if (phone && (await phone.evaluate((el) => !el.value && el.offsetParent !== null))) await page.type('#phoneNumber', '0412345678', { delay: 10 })
    await page.click('.SubmitButton, button[type="submit"]')
    for (let i = 0; i < 45 && !page.url().startsWith(BASE); i++) await new Promise((r) => setTimeout(r, 2000))
    page.url().startsWith(BASE) ? ok(`${label}: paid on Stripe Checkout, back at ${new URL(page.url()).pathname}${new URL(page.url()).search}`) : bad(`${label}: Stripe did not send the browser back (${page.url().slice(0, 80)})`)
  } finally {
    await browser.close()
  }
}

const made = []
try {
  head('1. Two children registered and paid before the club looks')
  for (const [child, dob] of [[`${TAG} Child One`, '2016-03-03'], [`${TAG} Child Two`, '2017-04-04']]) {
    const r = await post('/api/register/request', { slug: SLUG, programId: program.id, guardianName: `${TAG} Parent`, guardianPhone: PHONE, guardianEmail: 'paynow.parent@example.com', childName: child, childDob: dob, consents })
    if (r.status !== 200) { bad(`request for ${child}: ${r.status} ${r.error ?? ''}`); continue }
    const pay = await post('/api/register/pay', { requestId: r.requestId, secret: r.secret })
    pay.status === 200 && String(pay.url).startsWith('https://checkout.stripe.com/') && pay.amount_cents === 12000 ? ok(`${child}: a $120.00 Checkout before approval`) : bad(`${child}: pay ${pay.status} ${pay.error ?? JSON.stringify(pay).slice(0, 120)}`)
    if (pay.url) await payOnCheckout(pay.url, child)
    const paid = await until(async () => { const { data } = await admin.from('payments').select('id, status, player_id, stripe_payment_intent').eq('registration_request_id', r.requestId).maybeSingle(); return data?.status === 'paid' ? data : null }, 90000, 2000)
    if (!paid) {
      const { data: row } = await admin.from('payments').select('status').eq('registration_request_id', r.requestId).maybeSingle()
      const session = pay.session_id ? await stripe.checkout.sessions.retrieve(pay.session_id, {}, { stripeAccount: harness.id }).catch((e) => ({ error: e.message })) : null
      bad(`${child}: payment ${JSON.stringify(row)}; Stripe says ${session?.payment_status ?? session?.error ?? '?'}`)
    } else {
      paid.player_id === null ? ok(`${child}: the webhook marked it paid, against the request, no player yet`) : bad(`${child}: payment ${JSON.stringify(paid)}`)
    }
    const { data: payRow } = await admin.from('payments').select('id').eq('registration_request_id', r.requestId).maybeSingle()
    made.push({ child, requestId: r.requestId, secret: r.secret, payment: payRow?.id ?? null })
  }
  const { data: req0 } = made[0] ? await admin.from('registration_requests').select('profile_id, status').eq('id', made[0].requestId).single() : { data: null }
  const { data: prof } = await admin.from('profiles').select('id').eq('phone', PHONE).maybeSingle()
  req0?.profile_id && req0.profile_id === prof?.id && req0.status === 'pending' ? ok('an account for the mobile exists and the request still waits on the club') : bad(`request: ${JSON.stringify(req0)}, profile ${prof?.id}`)
  const { count: hats } = prof ? await admin.from('academy_members').select('*', { count: 'exact', head: true }).eq('profile_id', prof.id) : { count: 0 }
  hats === 0 ? ok('and that account is a member of nothing — nothing granted') : bad(`${hats} memberships before approval`)
  const second = await post('/api/register/pay', { requestId: made[0].requestId, secret: made[0].secret })
  second.status === 409 ? ok('paying the same registration twice is refused') : bad(`second pay: ${second.status}`)

  head('2. Approved: the payment belongs to the child')
  if (made[0]) {
    const a = await post('/api/register/approve', { requestId: made[0].requestId, decision: 'approve' }, cookie)
    a.status === 200 ? ok(`approved ${made[0].child}`) : bad(`approve: ${a.status} ${a.error ?? ''}`)
    const { data: kid } = await admin.from('players').select('id').eq('academy_id', NRIFA).eq('full_name', made[0].child).maybeSingle()
    const { data: pay } = await admin.from('payments').select('player_id, status').eq('id', made[0].payment).single()
    kid && pay.player_id === kid.id && pay.status === 'paid' ? ok('the player exists and the payment is theirs, paid') : bad(`after approval: kid ${kid?.id}, payment ${JSON.stringify(pay)}`)
    const { data: owes } = await owner.client.rpc('outstanding_fees', { p_academy: NRIFA })
    const row = (owes ?? []).find((o) => o.player_id === kid?.id && o.request_id === fee.id)
    !row || row.outstanding_cents === 0 ? ok('who-owes shows nothing owing on this fee for them') : bad(`owes: ${JSON.stringify(row)}`)
  }

  head('3. Declined: refunded in full, on its own')
  if (made[1]) {
    const d = await post('/api/register/approve', { requestId: made[1].requestId, decision: 'decline', note: 'Zz: the squad is full' }, cookie)
    d.status === 200 && d.refunds?.length === 1 && d.refunds[0].ok ? ok(`declined ${made[1].child}: one refund issued at once`) : bad(`decline: ${d.status} ${JSON.stringify(d.refunds ?? d.error)}`)
    const { data: refund } = await admin.from('refunds').select('status, amount_cents, reason, stripe_refund_id, player_id').eq('payment_id', made[1].payment).maybeSingle()
    refund?.status === 'issued' && refund.amount_cents === 12000 && refund.reason === 'declined' && refund.stripe_refund_id && refund.player_id === null ? ok(`the refund row: issued, $120.00, ${refund.stripe_refund_id}, no player to point at`) : bad(`refund row: ${JSON.stringify(refund)}`)
    const refunded = await until(async () => { const { data } = await admin.from('payments').select('status').eq('id', made[1].payment).single(); return data?.status === 'refunded' ? data : null }, 90000, 2000)
    refunded ? ok('the webhook marked the payment refunded') : bad('the payment never read refunded')
    const { count: kid2 } = await admin.from('players').select('*', { count: 'exact', head: true }).eq('academy_id', NRIFA).eq('full_name', made[1].child)
    kid2 === 0 ? ok('and no player was made for a declined child') : bad(`${kid2} players for the declined child`)
  }

  head('4. The form: "Pay now" with the fee, and "Paid and sent"')
  {
    const r = await post('/api/register/request', { slug: SLUG, programId: program.id, guardianName: `${TAG} Parent`, guardianPhone: PHONE, guardianEmail: 'paynow.parent@example.com', childName: `${TAG} Child Three`, childDob: '2015-05-05', consents })
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
    try {
      for (const [scheme, query, expect] of [['light', '', 'Pay now'], ['dark', '?paid=1', 'Paid and sent']]) {
        const context = await browser.createBrowserContext()
        const page = await context.newPage()
        await page.setViewport({ width: 375, height: 812 })
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }])
        await page.evaluateOnNewDocument((k, v) => { try { localStorage.setItem(k, v) } catch {} }, `squadroom.registration.${SLUG}`, JSON.stringify({ requestId: r.requestId, secret: r.secret, programId: program.id }))
        await page.goto(`${BASE}/${SLUG}/register${query}`, { waitUntil: 'networkidle2', timeout: 90000 })
        await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout: 30000 }, expect).catch(() => {})
        const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))
        const fits = await page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1)
        const good = text.includes(expect) && (query ? true : text.includes('$120.00')) && fits
        good ? ok(`${scheme}${query}: "${expect}"${query ? '' : ' with $120.00'}, 375px`) : bad(`${scheme}${query}: ${text.slice(0, 160)} fits ${fits}`)
        if (SHOTS) await page.screenshot({ path: `.shots/pay-now-${scheme}${query ? '-paid' : ''}.png`, fullPage: true })
        await context.close()
      }
    } finally {
      await browser.close()
    }
  }
} catch (e) {
  bad(`threw: ${e.message}`)
} finally {
  await cleanup()
  if (billingBefore) await admin.from('academy_billing').upsert(billingBefore, { onConflict: 'academy_id' })
  else await admin.from('academy_billing').delete().eq('academy_id', NRIFA)
  console.log(`  stand-in ${harness.id}: ${await closeTestAccount(stripe, harness.id)}`)
  const { count } = await admin.from('programs').select('id', { count: 'exact', head: true }).eq('academy_id', NRIFA).like('name', `${TAG} %`)
  count === 0 ? ok('everything made here is gone, the billing as it was') : bad(`${count} programs left behind`)
}
console.log(process.exitCode ? '' : '\n  \x1b[32mpay now: charged on submit, refunded in full on a decline\x1b[0m\n')
