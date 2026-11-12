// Run: node --env-file=.env.local scripts/test-card-fee.mjs
//   (the dev server on :3000; SHOTS=1 saves the screens at 375px)
//
// The registration brief, gaps 9 and 10 (0270), on Inner West FC. The owner
// turns the card-fee pass-through on (Settings → Club, off by default); a
// $120 fee then quotes $2.39 of card fee — Stripe's 1.7% + 30c — and the
// family's Payments screen says so as its own line with one total before
// paying. A payment that lands raises a push to the payer that opens the
// receipt; the receipt shows the fee and the card fee apart and the total;
// the Paid list links to it. With the feature off, nothing of the fee shows
// and the setting is gone. Everything made here is removed and the setting
// and switch put back. (The Stripe charge itself is test-pay-now §6.)
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
const TAG = 'Zz Fee'
const until = async (fn, ms = 15000, every = 500) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, every)) }
  return null
}

const president = await signInBoth(admin, 'iw.president@squadroom-demo.test')
const parent = await signInBoth(admin, 'iw.parent@squadroom-demo.test')
if (!president || !parent) { console.log("  could not sign in — the project's auth rate limit, not a failure"); process.exit(2) }
const { data: clubBefore } = await admin.from('academies').select('card_fee_passthrough').eq('id', IW).single()
const { data: switchBefore } = await admin.from('academy_features').select('enabled').eq('academy_id', IW).eq('feature', 'card_fee_passthrough').maybeSingle()

async function cleanup() {
  const { data: pays } = await admin.from('payments').select('id').eq('academy_id', IW).like('stripe_payment_intent', 'pi_zz_fee%')
  for (const p of pays ?? []) {
    await admin.from('notification_queue').delete().like('dedupe_key', `receipt:${p.id}:%`)
    await admin.from('payments').delete().eq('id', p.id)
  }
  await admin.from('payment_requests').delete().eq('academy_id', IW).like('title', `${TAG} %`)
  await admin.from('academies').update({ card_fee_passthrough: clubBefore?.card_fee_passthrough ?? false }).eq('id', IW)
  await president.client.rpc('set_feature', { p_academy: IW, p_feature: 'card_fee_passthrough', p_enabled: switchBefore ? switchBefore.enabled : true })
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
const shot = (page, name) => SHOTS ? page.screenshot({ path: `.shots/card-fee-${name}.png`, fullPage: true }) : null
const tap = async (h) => { await h.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' })); await h.click() }

let fee = null, payment = null
try {
  const { data: f } = await admin.from('payment_requests').insert({ academy_id: IW, title: `${TAG} fee`, amount_cents: 12000, currency: 'aud', per_player: true, team_id: U8_RED, created_by: president.session.user.id }).select('id').single()
  fee = f

  head('1. Off by default; the owner turns it on')
  {
    const { data: q0 } = await parent.client.rpc('quote_payment', { p_request: fee.id, p_player: AMARA })
    q0?.card_fee_cents === 0 ? ok('off: the quote carries no card fee') : bad(`off quote: ${JSON.stringify(q0?.card_fee_cents)}`)
    const { page, context } = await open(president, '/settings/academy', 'light')
    const box = await waitFor(page, '[data-card-fee-passthrough]')
    if (!box) bad('no card-fee switch on Settings → Club')
    else {
      await tap(box)
      const on = await until(async () => { const { data } = await admin.from('academies').select('card_fee_passthrough').eq('id', IW).single(); return data?.card_fee_passthrough ? data : null })
      on && (await fits(page)) ? ok('ticked: academies.card_fee_passthrough is true, 375px light') : bad(`after the tick: ${JSON.stringify(on)}`)
      await shot(page, 'settings-light')
    }
    await context.close()
  }

  head('2. $120 quotes $2.39 of card fee, its own line, one total')
  {
    const { data: q } = await parent.client.rpc('quote_payment', { p_request: fee.id, p_player: AMARA })
    q?.card_fee_cents === 239 && q.net_cents === 12000 ? ok('quote_payment: net $120.00, card fee $2.39 (ceil((12000 + 30) / 0.983) − 12000)') : bad(`quote: ${JSON.stringify(q)?.slice(0, 200)}`)
    const { data: mine } = await parent.client.rpc('my_payment_requests', { p_academy: IW })
    const row = (mine ?? []).find((m) => m.request_id === fee.id && m.player_id === AMARA)
    row?.card_fee_cents === 239 ? ok('my_payment_requests carries it too') : bad(`list row: ${JSON.stringify(row)}`)
    const { page, context } = await open(parent, '/payments', 'light')
    const line = await waitFor(page, `xpath/.//li[contains(., ${JSON.stringify(`${TAG} fee`)})]//p[@data-card-fee]`)
    const text = line ? await line.evaluate((el) => el.textContent) : ''
    line && /\$2\.39/.test(text) && /you pay \$122\.39/.test(text) && (await fits(page)) ? ok('Payments: "Card processing fee $2.39 … you pay $122.39", 375px light') : bad(`payments line: ${text}`)
    await shot(page, 'payments-light')
    await context.close()
  }

  head('3. A payment lands: a push, a receipt with the fee apart, the Paid list links to it')
  {
    const { data: p } = await admin.from('payments').insert({ academy_id: IW, request_id: fee.id, profile_id: parent.session.user.id, player_id: AMARA, amount_cents: 12000, card_fee_cents: 239, currency: 'aud', status: 'pending', instalment_seq: 1, stripe_payment_intent: 'pi_zz_fee_1' }).select('id').single()
    payment = p
    await admin.from('payments').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', payment.id)
    const { data: push } = await admin.from('notification_queue').select('title, url, profile_id').eq('dedupe_key', `receipt:${payment.id}:paid`).maybeSingle()
    push && push.profile_id === parent.session.user.id && push.url === `/receipts/${payment.id}` && /Receipt: \$122\.39 to Inner West FC/.test(push.title) ? ok(`the push to the payer: "${push.title}", opening the receipt`) : bad(`push: ${JSON.stringify(push)}`)
    const { count: others } = await admin.from('notification_queue').select('id', { count: 'exact', head: true }).like('dedupe_key', `receipt:${payment.id}:%`).neq('profile_id', parent.session.user.id)
    others === 0 ? ok('and to nobody else') : bad(`${others} pushes to others`)
    const { page, context } = await open(parent, `/receipts/${payment.id}`, 'dark')
    const card = await waitFor(page, '[data-receipt-card]')
    const amount = card ? await page.$eval('[data-receipt-amount]', (el) => el.textContent) : ''
    const feeLine = card ? await page.$('[data-receipt-card-fee="239"]') : null
    card && amount === '$122.39' && feeLine && (await fits(page)) ? ok('the receipt: $122.39, with "$120.00 fee + $2.39 card processing fee", 375px dark') : bad(`receipt amount "${amount}", fee line ${Boolean(feeLine)}`)
    await shot(page, 'receipt-dark')
    await context.close()
    const list = await open(parent, '/payments', 'dark')
    const link = await waitFor(list.page, `[data-receipt="${payment.id}"]`)
    link && (await fits(list.page)) ? ok('Payments → Paid has the Receipt link') : bad('no receipt link in the Paid list')
    await shot(list.page, 'paid-list-dark')
    await list.context.close()
    const { data: refund } = await admin.from('payments').update({ status: 'refunded', refunded_at: new Date().toISOString() }).eq('id', payment.id).select('id').single()
    const { data: push2 } = refund ? await admin.from('notification_queue').select('title').eq('dedupe_key', `receipt:${payment.id}:refunded`).maybeSingle() : { data: null }
    push2 && /Refunded: \$122\.39/.test(push2.title) ? ok(`a refund pushes too: "${push2.title}"`) : bad(`refund push: ${JSON.stringify(push2)}`)
  }

  head('4. Switched off: nothing of it')
  {
    await president.client.rpc('set_feature', { p_academy: IW, p_feature: 'card_fee_passthrough', p_enabled: false })
    const { data: q } = await parent.client.rpc('quote_payment', { p_request: fee.id, p_player: AMARA })
    q?.card_fee_cents === 0 ? ok('the feature off: no card fee on the quote, whatever the setting says') : bad(`quote off: ${q?.card_fee_cents}`)
    const { page, context } = await open(president, '/settings/academy', 'light')
    await waitFor(page, '[data-photo-required]')
    ;(await page.$('[data-card-fee-section]')) === null ? ok('no setting on Settings → Club') : bad('the setting shows with the feature off')
    await context.close()
    await president.client.rpc('set_feature', { p_academy: IW, p_feature: 'card_fee_passthrough', p_enabled: true })
    await admin.from('academies').update({ card_fee_passthrough: false }).eq('id', IW)
    const { data: q2 } = await parent.client.rpc('quote_payment', { p_request: fee.id, p_player: AMARA })
    q2?.card_fee_cents === 0 ? ok('the setting off: no card fee') : bad(`quote setting off: ${q2?.card_fee_cents}`)
  }
} catch (e) {
  bad(`threw: ${e.message}`)
} finally {
  await browser.close()
  await cleanup()
  const { count } = await admin.from('payment_requests').select('id', { count: 'exact', head: true }).eq('academy_id', IW).like('title', `${TAG} %`)
  const { data: after } = await admin.from('academies').select('card_fee_passthrough').eq('id', IW).single()
  count === 0 && after?.card_fee_passthrough === (clubBefore?.card_fee_passthrough ?? false) ? ok('everything made here is gone; the setting and switch as they were') : bad(`${count} fees left, setting ${after?.card_fee_passthrough}`)
}
console.log(process.exitCode ? '' : '\n  \x1b[32mreceipts and the card fee: a push and a receipt when money lands; Stripe\'s fee as its own line, only when the club says\x1b[0m\n')
