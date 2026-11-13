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
import { createAccount, deleteAccount } from './_account.mjs'

if (process.env.STRIPE_E2E !== '1') {
  // "only runs by hand" is what scripts/test-all.mjs looks for to report this as by hand, not a crash.
  console.log('  STRIPE_E2E=1 not set — pay-now only runs by hand, with Stripe test mode and the listener up; skipped (exit 2)')
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
// The sign-up brief (12 Nov 2026): a family registers signed in. The family's
// session is the default for a post; the owner's is passed where it decides.
const FAMILY_EMAIL = 'paynow.parent@squadroom-demo.test'
let familyCookie = ''
const post = async (path, body, cookie) => {
  const c = cookie ?? familyCookie
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(c ? { cookie: c } : {}) }, body: JSON.stringify(body) })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, ...json }
}

const { data: akBefore } = await admin.from('academies').select('active_kids_provider').eq('id', NRIFA).single()
const { data: feeBefore } = await admin.from('academies').select('card_fee_passthrough').eq('id', NRIFA).single()
// The public form allows twenty registrations an hour from one address; a
// run of suites from this machine is more than that. The throttle log is
// not demo data.
await admin.from('registration_attempts').delete().gte('created_at', '1970-01-01')
const AK_NUMBERS = ['9876543210987654', '1111222233334444', '5555666677778888']

async function cleanup() {
  // 0264: the vouchers (their redemptions go with them), and the club's provider setting.
  await admin.from('vouchers').delete().eq('academy_id', NRIFA).in('voucher_number', AK_NUMBERS)
  await admin.from('academies').update({ active_kids_provider: akBefore?.active_kids_provider ?? false, card_fee_passthrough: feeBefore?.card_fee_passthrough ?? false }).eq('id', NRIFA)
  const { data: progs } = await admin.from('programs').select('id, payment_request_id').eq('academy_id', NRIFA).like('name', `${TAG} %`)
  for (const p of progs ?? []) {
    const { data: reqs } = await admin.from('registration_requests').select('id').eq('program_id', p.id)
    for (const r of reqs ?? []) {
      const { data: pays } = await admin.from('payments').select('id').eq('registration_request_id', r.id)
      for (const pay of pays ?? []) {
        await admin.from('notification_queue').delete().like('dedupe_key', `receipt:${pay.id}:%`)
        await admin.from('refunds').delete().eq('payment_id', pay.id)
        await admin.from('payments').delete().eq('id', pay.id)
      }
      await admin.from('registration_requests').delete().eq('id', r.id)
    }
    if (p.payment_request_id) { await admin.from('payments').delete().eq('request_id', p.payment_request_id) }
    await admin.from('payment_requests').delete().eq('academy_id', NRIFA).like('title', `${TAG} % — %`)
    await admin.from('programs').delete().eq('id', p.id)
    if (p.payment_request_id) await admin.from('payment_requests').delete().eq('id', p.payment_request_id)
  }
  await admin.from('payment_requests').delete().eq('academy_id', NRIFA).like('title', `${TAG} small fee`)
  const { data: kids } = await admin.from('players').select('id').eq('academy_id', NRIFA).like('full_name', `${TAG} %`)
  for (const k of kids ?? []) { await admin.from('player_guardians').delete().eq('player_id', k.id); await admin.from('players').delete().eq('id', k.id) }
  // §7: the parent's coach registration (no program), and what approval gave them.
  await admin.from('registration_requests').delete().eq('academy_id', NRIFA).like('child_name', `${TAG} %`)
  const { data: users } = await listAllUsers(admin)
  const u = users?.users?.find((x) => x.phone === PHONE.replace('+', ''))
  if (u) {
    await admin.from('team_members').delete().eq('profile_id', u.id)
    await admin.from('club_roles').delete().eq('profile_id', u.id)
    await admin.from('staff_clearances').delete().eq('profile_id', u.id)
    await admin.from('academy_members').delete().eq('profile_id', u.id)
    await admin.auth.admin.deleteUser(u.id)
  }
  await deleteAccount(admin, FAMILY_EMAIL)
}
await cleanup()
const family = await createAccount(BASE, { first: TAG, last: 'Parent', email: FAMILY_EMAIL, mobile: PHONE })
familyCookie = family.cookie

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
      // 0270: the button names the figure — "Pay $120.00" — rather than "Pay now".
      for (const [scheme, query, expect] of [['light', '', 'Pay $120.00'], ['dark', '?paid=1', 'Paid and sent']]) {
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
  head('5. With an Active & Creative Kids voucher (0264): $50 off before the charge')
  {
    await admin.from('academies').update({ active_kids_provider: true }).eq('id', NRIFA)
    // $120 fee, $50 voucher: Stripe charges $70; approval moves the voucher with the payment.
    const r = await post('/api/register/request', { slug: SLUG, programId: program.id, guardianName: `${TAG} Parent`, guardianPhone: PHONE, guardianEmail: 'paynow.parent@example.com', childName: `${TAG} Child Five`, childDob: '2016-07-07', consents })
    const pay = await post('/api/register/pay', { requestId: r.requestId, secret: r.secret, voucher: { number: '9876 5432 1098 7654', childName: '' } })
    pay.status === 200 && pay.amount_cents === 7000 && pay.off_cents === 5000 && String(pay.url).startsWith('https://checkout.stripe.com/') ? ok('a $70.00 Checkout: the voucher\'s $50.00 taken off first') : bad(`pay with voucher: ${pay.status} ${pay.error ?? JSON.stringify(pay).slice(0, 160)}`)
    const { data: v5 } = await admin.from('vouchers').select('id, child_name, child_dob, registration_request_id').eq('voucher_number', '9876543210987654').maybeSingle()
    v5?.child_name === `${TAG} Child Five` && v5.child_dob === '2016-07-07' && v5.registration_request_id === r.requestId ? ok('the voucher row names the child from the registration and the request it waits on') : bad(`voucher ${JSON.stringify(v5)}`)
    const { data: mine } = await owner.client.rpc('my_payment_requests', { p_academy: NRIFA })
    !(mine ?? []).some((m) => String(m.title).startsWith(`${TAG} season fee —`)) ? ok('the registration\'s stand-in fee is in nobody\'s Payments list') : bad('a member sees the stand-in fee as a bill')
    if (pay.url) await payOnCheckout(pay.url, `${TAG} Child Five`)
    const paid = await until(async () => { const { data } = await admin.from('payments').select('id, status, amount_cents').eq('registration_request_id', r.requestId).maybeSingle(); return data?.status === 'paid' ? data : null }, 90000, 2000)
    paid?.amount_cents === 7000 ? ok('paid $70.00') : bad(`payment ${JSON.stringify(paid)}`)
    const a = await post('/api/register/approve', { requestId: r.requestId, decision: 'approve' }, cookie)
    const { data: kid5 } = await admin.from('players').select('id').eq('academy_id', NRIFA).eq('full_name', `${TAG} Child Five`).maybeSingle()
    const { data: red5 } = v5 ? await admin.from('voucher_redemptions').select('request_id, player_id, amount_cents').eq('voucher_id', v5.id).maybeSingle() : { data: null }
    a.status === 200 && kid5 && red5?.request_id === fee.id && red5.player_id === kid5.id && red5.amount_cents === 5000 ? ok('approved: the voucher moved onto the program fee, for the child') : bad(`approve ${a.status}; redemption ${JSON.stringify(red5)}`)
    const { data: owes } = await owner.client.rpc('outstanding_fees', { p_academy: NRIFA })
    const owe5 = (owes ?? []).find((o) => o.player_id === kid5?.id && o.request_id === fee.id)
    !owe5 || owe5.outstanding_cents === 0 ? ok('who-owes: nothing owing — $70 paid, $50 the voucher') : bad(`owes: ${JSON.stringify(owe5)}`)
    const { data: toRedeem } = await owner.client.rpc('active_kids_to_redeem', { p_academy: NRIFA })
    const t5 = (toRedeem ?? []).find((t) => t.voucher_number === '9876543210987654')
    t5 && t5.waiting === false && t5.fee_title === `${TAG} season fee` ? ok('the Treasurer\'s list has it, on the program fee, ready to redeem') : bad(`to redeem: ${JSON.stringify(t5)}`)

    // A $50 program: the voucher covers it — no Stripe, nothing to pay.
    const { data: small } = await admin.from('payment_requests').insert({ academy_id: NRIFA, title: `${TAG} small fee`, amount_cents: 5000, per_player: true, currency: 'aud' }).select('id').single()
    const { data: programSmall } = await admin.from('programs').insert({ academy_id: NRIFA, name: `${TAG} Small`, kind: 'camp', status: 'open', season: '2026', created_by: owner.session.user.id, payment_required: true, payment_request_id: small.id, pay_timing: 'now', born_from_year: 2015, born_to_year: 2018 }).select('id').single()
    const r6 = await post('/api/register/request', { slug: SLUG, programId: programSmall.id, guardianName: `${TAG} Parent`, guardianPhone: PHONE, guardianEmail: 'paynow.parent@example.com', childName: `${TAG} Child Six`, childDob: '2016-08-08', consents })
    const pay6 = await post('/api/register/pay', { requestId: r6.requestId, secret: r6.secret, voucher: { number: '1111 2222 3333 4444' } })
    const { count: pays6 } = await admin.from('payments').select('id', { count: 'exact', head: true }).eq('registration_request_id', r6.requestId)
    pay6.status === 200 && pay6.covered === true && pay6.amount_cents === 0 && pays6 === 0 ? ok('a $50 fee: covered, no Checkout, no payment row') : bad(`covered: ${pay6.status} ${JSON.stringify(pay6).slice(0, 160)}, ${pays6} payments`)
    const again6 = await post('/api/register/pay', { requestId: r6.requestId, secret: r6.secret })
    again6.covered === true ? ok('tapping again keeps the same voucher') : bad(`again: ${JSON.stringify(again6).slice(0, 120)}`)
    const a6 = await post('/api/register/approve', { requestId: r6.requestId, decision: 'approve' }, cookie)
    const { data: kid6 } = await admin.from('players').select('id').eq('academy_id', NRIFA).eq('full_name', `${TAG} Child Six`).maybeSingle()
    const { data: owes6 } = await owner.client.rpc('outstanding_fees', { p_academy: NRIFA })
    const owe6 = (owes6 ?? []).find((o) => o.player_id === kid6?.id && o.request_id === small.id)
    a6.status === 200 && kid6 && (!owe6 || owe6.outstanding_cents === 0) ? ok('approved: nothing owing on the $50 fee') : bad(`approve ${a6.status}; owes ${JSON.stringify(owe6)}`)

    // Declined: the money comes back and so does the voucher.
    const r7 = await post('/api/register/request', { slug: SLUG, programId: program.id, guardianName: `${TAG} Parent`, guardianPhone: PHONE, guardianEmail: 'paynow.parent@example.com', childName: `${TAG} Child Seven`, childDob: '2016-09-09', consents })
    const pay7 = await post('/api/register/pay', { requestId: r7.requestId, secret: r7.secret, voucher: { number: '5555 6666 7777 8888' } })
    if (pay7.url) await payOnCheckout(pay7.url, `${TAG} Child Seven`)
    const paid7 = await until(async () => { const { data } = await admin.from('payments').select('id, status').eq('registration_request_id', r7.requestId).maybeSingle(); return data?.status === 'paid' ? data : null }, 90000, 2000)
    const d7 = paid7 ? await post('/api/register/approve', { requestId: r7.requestId, decision: 'decline', note: 'Zz: full' }, cookie) : { status: 0 }
    const { data: refund7 } = paid7 ? await admin.from('refunds').select('amount_cents, status').eq('payment_id', paid7.id).maybeSingle() : { data: null }
    const { count: v7 } = await admin.from('vouchers').select('id', { count: 'exact', head: true }).eq('voucher_number', '5555666677778888')
    d7.status === 200 && refund7?.amount_cents === 7000 && refund7.status === 'issued' && v7 === 0 ? ok('declined: the $70.00 refunded, the voucher given back (its number free again)') : bad(`decline ${d7.status}; refund ${JSON.stringify(refund7)}; vouchers left ${v7}`)
    await admin.from('academies').update({ active_kids_provider: akBefore?.active_kids_provider ?? false }).eq('id', NRIFA)
  }

  head('6. The card fee passed on (0270): its own line, before the charge')
  {
    await admin.from('academies').update({ card_fee_passthrough: true }).eq('id', NRIFA)
    const r = await post('/api/register/request', { slug: SLUG, programId: program.id, guardianName: `${TAG} Parent`, guardianPhone: PHONE, guardianEmail: 'paynow.parent@example.com', childName: `${TAG} Child Eight`, childDob: '2016-10-10', consents })
    const pay = await post('/api/register/pay', { requestId: r.requestId, secret: r.secret })
    pay.status === 200 && pay.amount_cents === 12000 && pay.card_fee_cents === 239 && pay.total_cents === 12239 ? ok('the route: $120.00 fee, $2.39 card fee, $122.39 to pay') : bad(`pay with card fee: ${pay.status} ${JSON.stringify(pay).slice(0, 160)}`)
    const session = pay.session_id ? await stripe.checkout.sessions.retrieve(pay.session_id, {}, { stripeAccount: harness.id }).catch((e) => ({ error: e.message })) : null
    session?.amount_total === 12239 ? ok('Stripe asks for $122.39 — the fee and the card fee as two lines') : bad(`session total ${session?.amount_total ?? session?.error}`)
    if (pay.url) await payOnCheckout(pay.url, `${TAG} Child Eight`)
    const paid = await until(async () => { const { data } = await admin.from('payments').select('id, status, amount_cents, card_fee_cents').eq('registration_request_id', r.requestId).maybeSingle(); return data?.status === 'paid' ? data : null }, 90000, 2000)
    paid?.amount_cents === 12000 && paid.card_fee_cents === 239 ? ok('paid: the row keeps the fee and the card fee apart') : bad(`paid row ${JSON.stringify(paid)}`)
    if (paid) {
      const { data: receipt } = await owner.client.rpc('payment_receipt', { p_payment: paid.id })
      receipt?.total_cents === 12239 && receipt.card_fee_cents === 239 ? ok('the receipt: $122.39 in all, $2.39 of it the card fee') : bad(`receipt ${JSON.stringify(receipt)?.slice(0, 160)}`)
      const { data: push } = await admin.from('notification_queue').select('url, title').eq('dedupe_key', `receipt:${paid.id}:paid`).maybeSingle()
      push?.url === `/receipts/${paid.id}` ? ok(`and the push to the payer: "${push.title}"`) : bad(`push ${JSON.stringify(push)}`)
    }
    await admin.from('academies').update({ card_fee_passthrough: feeBefore?.card_fee_passthrough ?? false }).eq('id', NRIFA)
  }

  head('7. A family: two children and the parent as coach — the children in one checkout')
  {
    const U8 = '00000000-0000-0000-0000-0000000d0008'
    const inTwoYears = new Date(Date.now() + 730 * 864e5).toISOString().slice(0, 10)
    const nine = await post('/api/register/request', { slug: SLUG, programId: program.id, guardianName: `${TAG} Parent`, guardianPhone: PHONE, guardianEmail: 'paynow.parent@example.com', childName: `${TAG} Child Nine`, childDob: '2016-11-11', consents })
    const ten = await post('/api/register/request', { slug: SLUG, programId: program.id, guardianName: `${TAG} Parent`, guardianPhone: PHONE, guardianEmail: 'paynow.parent@example.com', childName: `${TAG} Child Ten`, childDob: '2017-12-12', consents })
    const coach = await post('/api/register/request', { slug: SLUG, registerAs: 'coach', guardianName: `${TAG} Parent`, guardianPhone: PHONE, guardianEmail: 'paynow.parent@example.com', childName: `${TAG} Parent`, childDob: '1985-01-01', wwccNumber: 'WWC9998887E', wwccExpiresOn: inTwoYears, roleNote: 'Happy to help with the U8s', consents })
    nine.status === 200 && ten.status === 200 && coach.status === 200 ? ok('two children registered, and the parent as a coach') : bad(`requests: ${nine.status} ${ten.status} ${coach.status} ${coach.error ?? ''}`)
    const payCoach = await post('/api/register/pay', { requestId: coach.requestId, secret: coach.secret })
    payCoach.status === 409 ? ok('a coach\'s registration has nothing to pay') : bad(`pay coach: ${payCoach.status}`)
    const mixed = await post('/api/register/pay', { requests: [{ requestId: nine.requestId, secret: nine.secret }, { requestId: ten.requestId, secret: 'wrong' }] })
    mixed.status === 404 ? ok('a wrong secret on either: nothing') : bad(`mixed: ${mixed.status}`)
    const pay = await post('/api/register/pay', { requests: [{ requestId: nine.requestId, secret: nine.secret }, { requestId: ten.requestId, secret: ten.secret }] })
    pay.status === 200 && pay.amount_cents === 24000 && pay.count === 2 && pay.card_fee_cents === 0 ? ok('one Checkout for both children: $240.00') : bad(`pay both: ${pay.status} ${JSON.stringify(pay).slice(0, 160)}`)
    const session = pay.session_id ? await stripe.checkout.sessions.retrieve(pay.session_id, {}, { stripeAccount: harness.id }).catch((e) => ({ error: e.message })) : null
    session?.amount_total === 24000 ? ok('Stripe asks for $240.00 in one go') : bad(`session total ${session?.amount_total ?? session?.error}`)
    if (pay.url) await payOnCheckout(pay.url, 'the two children')
    const both = await until(async () => { const { data } = await admin.from('payments').select('registration_request_id, status, stripe_session_id, amount_cents').in('registration_request_id', [nine.requestId, ten.requestId]); return data?.length === 2 && data.every((p) => p.status === 'paid') ? data : null }, 90000, 2000)
    both && new Set(both.map((p) => p.stripe_session_id)).size === 1 && both.every((p) => p.amount_cents === 12000) ? ok('both paid, $120.00 each, one session between them') : bad(`both: ${JSON.stringify(both)}`)
    const again = await post('/api/register/pay', { requests: [{ requestId: nine.requestId, secret: nine.secret }, { requestId: ten.requestId, secret: ten.secret }] })
    again.status === 409 ? ok('paying them again is refused') : bad(`again: ${again.status}`)
    await owner.client.rpc('confirm_wwcc_check', { p_request: coach.requestId, p_checked: true })
    const a9 = await post('/api/register/approve', { requestId: nine.requestId, decision: 'approve', teamId: U8 }, cookie)
    const a10 = await post('/api/register/approve', { requestId: ten.requestId, decision: 'approve', teamId: U8 }, cookie)
    const ac = await post('/api/register/approve', { requestId: coach.requestId, decision: 'approve', teamId: U8 }, cookie)
    const { data: prof } = await admin.from('profiles').select('id').eq('phone', PHONE).maybeSingle()
    const { data: hats } = prof ? await admin.from('academy_members').select('roles').eq('academy_id', NRIFA).eq('profile_id', prof.id).maybeSingle() : { data: null }
    const { data: kids } = await admin.from('players').select('id, full_name').eq('academy_id', NRIFA).in('full_name', [`${TAG} Child Nine`, `${TAG} Child Ten`])
    const { data: moved } = kids?.length ? await admin.from('payments').select('player_id, request_id, status').in('player_id', kids.map((k) => k.id)) : { data: [] }
    a9.status === 200 && a10.status === 200 && ac.status === 200 && (kids ?? []).length === 2 && (moved ?? []).length === 2 && (moved ?? []).every((m) => m.request_id === fee.id && m.status === 'paid') ? ok('approved: both children on the roster, each payment on the program fee') : bad(`approve ${a9.status} ${a10.status} ${ac.status} ${ac.error ?? ''}; kids ${kids?.length}; moved ${JSON.stringify(moved)}`)
    const roles = hats?.roles ?? []
    roles.includes('coach') && roles.includes('parent') ? ok('the parent is a coach and a parent at once — neither hat lost') : bad(`hats ${JSON.stringify(roles)}`)
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
