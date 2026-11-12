// Run: node --env-file=.env.local scripts/test-my-registrations.mjs
//   (the dev server on :3000; SHOTS=1 saves the screens at 375px)
//
// The registration brief, gap 4 (0265): Settings → My registrations, on
// Inner West FC's demo family. Every registration and where it stands —
// Submitted (a public-form request made with the parent's mobile before
// any account), Approved, Waitlisted with its place, Rejected, Withdrawn —
// a stranger's request kept out; their people with Edit and Sign up; their
// payments with a receipt each. The receipt page says what, for whom, to
// whom and when, with Stripe's id; the payer, the family and the club's
// Treasurer may open it, a coach may not. Everything made here is removed.
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
const head = (m) => console.log(`\n${m}`)
if (SHOTS) mkdirSync('.shots', { recursive: true })

const IW = '00000000-0000-0000-0000-0000000a0009'
const U8_RED = 'af495ca5-3827-450f-8a4e-5e90a2f5a9b3'
const AMARA = '547fae37-239c-4fef-bb24-cb813d6049db'
const JONAH = '50390257-4ced-4e1b-8081-371782ad56da'
const TAG = 'Zz MR'

const president = await signInBoth(admin, 'iw.president@squadroom-demo.test')
const parent = await signInBoth(admin, 'iw.parent@squadroom-demo.test')
const coach = await signInBoth(admin, 'iw.coach@squadroom-demo.test')
const treasurer = await signInBoth(admin, 'iw.treasurer@squadroom-demo.test')
if (!president || !parent || !coach || !treasurer) { console.log("  could not sign in — the project's auth rate limit, not a failure"); process.exit(2) }
const { data: parentProfile } = await admin.from('profiles').select('phone').eq('id', parent.session.user.id).single()

async function cleanup() {
  await admin.from('payments').delete().eq('academy_id', IW).like('stripe_payment_intent', 'pi_zz_mr%')
  await admin.from('payment_requests').delete().eq('academy_id', IW).like('title', `${TAG} %`)
  await admin.from('registration_requests').delete().eq('academy_id', IW).like('child_name', `${TAG} %`)
  const { data: progs } = await admin.from('programs').select('id').eq('academy_id', IW).like('name', `${TAG} %`)
  for (const p of progs ?? []) {
    await admin.from('program_registrations').delete().eq('program_id', p.id)
    await admin.from('programs').delete().eq('id', p.id)
  }
}
await cleanup()

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
async function open(who, path, scheme) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 375, height: 812 })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }])
  await page.setCookie({ name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(who.session)).toString('base64'), domain: 'localhost', path: '/' })
  await page.evaluateOnNewDocument((o) => { try { localStorage.setItem('squadroom.org', o) } catch {} }, IW)
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 90000 })
  return { page, context }
}
async function waitFor(page, selector, ms = 45000) {
  const found = await page.waitForSelector(selector, { timeout: ms }).catch(() => null)
  if (found) return found
  await page.reload({ waitUntil: 'networkidle2', timeout: 90000 })
  return page.waitForSelector(selector, { timeout: ms }).catch(() => null)
}
const fits = (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1)
const shot = (page, name) => SHOTS ? page.screenshot({ path: `.shots/my-registrations-${name}.png`, fullPage: true }) : null
const chips = (page) => page.$$eval('[data-status]', (els) => els.map((e) => e.getAttribute('data-status')))

let program = null, fee = null, payment = null, amaraReg = null
try {
  head('1. What the family has put in')
  const { data: p } = await admin.from('programs').insert({ academy_id: IW, name: `${TAG} Squad`, kind: 'squad', status: 'open', season: '2026', created_by: president.session.user.id, born_from_year: 2012, born_to_year: 2018 }).select('id').single()
  program = p
  const { data: regA } = await admin.from('program_registrations').insert({ academy_id: IW, program_id: program.id, player_id: AMARA, submitted_by: parent.session.user.id, status: 'approved', decided_by: president.session.user.id, decided_at: new Date().toISOString() }).select('id').single()
  amaraReg = regA
  await admin.from('program_registrations').insert({ academy_id: IW, program_id: program.id, player_id: JONAH, submitted_by: parent.session.user.id, status: 'waitlisted', waitlist_position: 2 })
  await admin.from('registration_requests').insert([
    { academy_id: IW, program_id: program.id, guardian_name: 'Grace Okoro', guardian_phone: parentProfile.phone, guardian_email: 'grace.other@example.com', child_name: `${TAG} New Child`, child_dob: '2017-02-02', secret_hash: 'x', status: 'pending', expires_at: new Date(Date.now() + 7 * 864e5).toISOString(), decision_note: null, decided_at: null },
    { academy_id: IW, program_id: program.id, guardian_name: 'Grace Okoro', guardian_phone: parentProfile.phone, guardian_email: 'grace.other@example.com', child_name: `${TAG} Declined Child`, child_dob: '2016-02-02', secret_hash: 'x', status: 'declined', expires_at: new Date(Date.now() + 7 * 864e5).toISOString(), decision_note: 'Zz: the squad is full', decided_at: new Date().toISOString() },
    { academy_id: IW, program_id: program.id, guardian_name: 'A Stranger', guardian_phone: '+61400000998', guardian_email: 'stranger@example.com', child_name: `${TAG} Stranger Child`, child_dob: '2016-03-03', secret_hash: 'x', status: 'pending', expires_at: new Date(Date.now() + 7 * 864e5).toISOString(), decision_note: null, decided_at: null },
  ])
  const { data: f } = await admin.from('payment_requests').insert({ academy_id: IW, title: `${TAG} fee`, amount_cents: 8000, currency: 'aud', per_player: true, team_id: U8_RED, created_by: president.session.user.id }).select('id').single()
  fee = f
  const { data: pay } = await admin.from('payments').insert({ academy_id: IW, request_id: fee.id, profile_id: parent.session.user.id, player_id: AMARA, amount_cents: 8000, currency: 'aud', status: 'paid', paid_at: new Date().toISOString(), instalment_seq: 1, stripe_payment_intent: 'pi_zz_mr_1' }).select('id').single()
  payment = pay
  ok('a squad with Amara approved and Jonah waitlisted #2; a request sent with the parent\'s mobile and one declined; a stranger\'s; a paid fee')

  const { data: mine, error } = await parent.client.rpc('my_registrations')
  const regs = mine?.registrations ?? [], reqs = mine?.requests ?? []
  !error && regs.some((r) => r.player_id === AMARA && r.status === 'approved') && regs.some((r) => r.player_id === JONAH && r.status === 'waitlisted' && r.waitlist_position === 2) ? ok('my_registrations: both children\'s registrations with their status') : bad(`registrations: ${error?.message ?? JSON.stringify(regs).slice(0, 200)}`)
  reqs.some((q) => q.child === `${TAG} New Child` && q.status === 'pending') && reqs.some((q) => q.child === `${TAG} Declined Child` && q.status === 'declined' && q.decision_note) && !reqs.some((q) => q.child === `${TAG} Stranger Child`) ? ok('the two requests made with their mobile, not the stranger\'s') : bad(`requests: ${JSON.stringify(reqs).slice(0, 300)}`)
  ;(mine?.people ?? []).some((x) => x.id === AMARA && x.squad === 'U8 Red') && (mine?.people ?? []).some((x) => x.id === JONAH) ? ok('their people: Amara (U8 Red) and Jonah') : bad(`people: ${JSON.stringify(mine?.people)}`)
  ;(mine?.payments ?? []).some((x) => x.id === payment.id && x.amount_cents === 8000 && x.child === 'Amara Okoro') ? ok('their payment, $80.00 for Amara') : bad(`payments: ${JSON.stringify(mine?.payments)}`)
  const { data: theirs } = await coach.client.rpc('my_registrations')
  ;(theirs?.registrations ?? []).length === 0 && (theirs?.requests ?? []).length === 0 && (theirs?.payments ?? []).length === 0 ? ok('the coach, who is nobody\'s guardian, sees none of it') : bad(`coach sees: ${JSON.stringify(theirs).slice(0, 200)}`)

  head('2. The screen')
  {
    const { page, context } = await open(parent, '/settings/registrations', 'light')
    const list = await waitFor(page, '[data-my-registrations]')
    const seen = list ? await chips(page) : []
    const text = list ? await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ')) : ''
    ;['pending', 'approved', 'waitlisted', 'declined'].every((s) => seen.includes(s)) && /Submitted/.test(text) && /Approved/.test(text) && /Waitlisted · #2/.test(text) && /Rejected/.test(text) && !/Stranger Child/.test(text) ? ok('Submitted, Approved, Waitlisted · #2 and Rejected, and no stranger, 375px light') : bad(`chips ${JSON.stringify(seen)}; ${text.slice(0, 300)}`)
    ;/the squad is full/.test(text) ? ok('the club\'s note is on the rejected one') : bad('no decision note')
    const people = await page.$$('[data-person]')
    const receipts = await page.$$('[data-receipt]')
    people.length >= 2 && receipts.length >= 1 && /Zz MR fee/.test(text) && /\$80\.00/.test(text) && (await fits(page)) ? ok(`people (${people.length}) with Edit and Sign up; the payment with a Receipt link`) : bad(`people ${people.length}, receipts ${receipts.length}, fits ${await fits(page)}`)
    await shot(page, 'light')
    await context.close()
    const dark = await open(parent, '/settings/registrations', 'dark')
    await waitFor(dark.page, '[data-my-registrations]')
    ;(await fits(dark.page)) ? ok('375px dark') : bad('dark does not fit')
    await shot(dark.page, 'dark')
    await dark.context.close()
    const s = await open(parent, '/settings', 'light')
    const row = await waitFor(s.page, 'a[href="/settings/registrations"]')
    row ? ok('Settings has the row') : bad('no My registrations row on Settings')
    await s.context.close()
  }

  head('3. Withdrawn, from the same button as Sign up')
  {
    const { error } = await parent.client.rpc('withdraw_registration', { p_registration: amaraReg.id, p_reason: 'Zz: moving house' })
    const { data: after } = await admin.from('program_registrations').select('status').eq('id', amaraReg.id).single()
    !error && after?.status === 'withdrawn' ? ok('the parent withdrew Amara') : bad(`withdraw: ${error?.message} status ${after?.status}`)
    const { page, context } = await open(parent, '/settings/registrations', 'light')
    await waitFor(page, '[data-my-registrations]')
    const seen = await chips(page)
    seen.includes('withdrawn') && !seen.includes('approved') ? ok('the screen says Withdrawn') : bad(`chips ${JSON.stringify(seen)}`)
    await context.close()
  }

  head('4. The receipt')
  {
    const { page, context } = await open(parent, `/receipts/${payment.id}`, 'light')
    const card = await waitFor(page, '[data-receipt-card]')
    const text = card ? await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ')) : ''
    card && /\$80\.00/.test(text) && /Amara Okoro/.test(text) && /Inner West FC/.test(text) && /pi_zz_mr_1/.test(text) && /Paid on/.test(text) && /Squadroom holds none of it/.test(text) && (await fits(page)) ? ok('$80.00 · Amara Okoro · Inner West FC · Stripe id · paid on, 375px light') : bad(`receipt: ${text.slice(0, 300)}`)
    await shot(page, 'receipt-light')
    await context.close()
    const dark = await open(parent, `/receipts/${payment.id}`, 'dark')
    await waitFor(dark.page, '[data-receipt-card]')
    ;(await fits(dark.page)) ? ok('375px dark') : bad('receipt dark')
    await shot(dark.page, 'receipt-dark')
    await dark.context.close()
    const c = await coach.client.rpc('payment_receipt', { p_payment: payment.id })
    const t = await treasurer.client.rpc('payment_receipt', { p_payment: payment.id })
    c.error?.code === '42501' && !t.error && t.data?.amount_cents === 8000 ? ok('the coach may not open it; the Treasurer may') : bad(`coach ${c.error?.code ?? 'allowed'}, treasurer ${t.error?.message ?? 'ok'}`)
    const stranger = await coach.client.rpc('payment_receipt', { p_payment: '00000000-0000-0000-0000-000000000000' })
    stranger.error ? ok('a made-up receipt is nothing') : bad('a made-up id answered')
  }
} catch (e) {
  bad(`threw: ${e.message}`)
} finally {
  await browser.close()
  await cleanup()
  const { count } = await admin.from('programs').select('id', { count: 'exact', head: true }).eq('academy_id', IW).like('name', `${TAG} %`)
  const { count: pays } = await admin.from('payments').select('id', { count: 'exact', head: true }).like('stripe_payment_intent', 'pi_zz_mr%')
  count === 0 && pays === 0 ? ok('everything made here is gone') : bad(`${count} programs, ${pays} payments left`)
}
console.log(process.exitCode ? '' : '\n  \x1b[32mmy registrations: where each one stands, the people, the receipts\x1b[0m\n')
