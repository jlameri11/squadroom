// Run: node --env-file=.env.local scripts/test-pay-later.mjs
//   (needs the app running — npm run dev, or serve:test; SHOTS=1 saves the
//   screens at 375px, light and dark, in .shots/)
//
// B-08's last piece, pay later by a day (0227): on a fee, "Can't pay today?
// Pick a day" — the family names a day, the club sees it beside the name
// instead of chasing, a reminder comes the day before, and nothing about
// what is owed changes.
//
// Two halves. The screens are checked now, with the database's answers
// stood in: the family's row and its form, exactly what "Set the day"
// sends, the club's register with a promised family listed last. The real
// thing — Sam names a day, the club's register and who-owes show it,
// another parent cannot name one for Leo, a day too far is refused — runs
// against squadroom-dev once 0227 is applied, and says it is waiting until
// then; test-rls 158–160 prove the database half locally meanwhile.
import { createClient } from '@supabase/supabase-js'
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
const TAG = 'TEST:: pay later'

const owner = await signInBoth(admin, 'joeylameri@outlook.com')
const sam = await signInBoth(admin, 'p61400000011@squadroom.invalid')
const hanasParent = await signInBoth(admin, 'p61400000014@squadroom.invalid')
if (!owner || !sam || !hanasParent) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}
const { error: no0227 } = await admin.from('payment_promises').select('id').limit(1)
const has0227 = !no0227
if (SHOTS) mkdirSync('.shots', { recursive: true })
const inDays = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString('en-CA')

async function tidy() {
  const { data: reqs } = await admin.from('payment_requests').select('id').eq('academy_id', NRIFA).like('title', `${TAG}%`)
  for (const r of reqs ?? []) {
    await admin.from('notification_queue').delete().filter('payload->>request_id', 'eq', r.id)
    if (has0227) await admin.from('payment_promises').delete().eq('request_id', r.id)
    await admin.from('payments').delete().eq('request_id', r.id)
  }
  await admin.from('payment_requests').delete().eq('academy_id', NRIFA).like('title', `${TAG}%`)
}
await tidy()
const { data: req } = await admin.from('payment_requests').insert({ academy_id: NRIFA, team_id: U8, title: `${TAG} U8 socks`, amount_cents: 2500, per_player: true, due_on: inDays(21), created_by: owner.session.user.id }).select('id').single()

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })

async function open(who, path, answers = null) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 375, height: 812 })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
  await page.setCookie({ name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(who.session)).toString('base64'), domain: 'localhost', path: '/' })
  await page.evaluateOnNewDocument((org) => { try { localStorage.setItem('squadroom.org', org) } catch {} }, NRIFA)
  const calls = []
  if (answers) {
    await page.setRequestInterception(true)
    page.on('request', (r) => {
      const u = new URL(r.url())
      const fn = u.host === host && u.pathname.startsWith('/rest/v1/rpc/') ? u.pathname.slice('/rest/v1/rpc/'.length) : null
      if (fn && fn in answers && r.method() === 'POST') {
        let body = {}
        try { body = JSON.parse(r.postData() ?? '{}') } catch {}
        calls.push({ fn, body })
        const value = typeof answers[fn] === 'function' ? answers[fn](body) : answers[fn]
        r.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(value) }).catch(() => {})
        return
      }
      r.continue().catch(() => {})
    })
  }
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 90000 })
  return { context, page, calls }
}
const text = (page) => page.evaluate(() => document.body.innerText)
const fits = (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1)
async function bothThemes(page, name) {
  let fitted = true
  for (const scheme of ['light', 'dark']) {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }])
    await sleep(250)
    fitted = fitted && (await fits(page))
    if (SHOTS) await page.screenshot({ path: `.shots/pay-later-${name}-${scheme}.png`, fullPage: true })
  }
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
  return fitted
}

try {
  // ---------------------------------------------------------------------------
  head("1. The family picks a day (0227's answers stood in)")
  {
    let zoeDay = null
    const row = (player_id, player_name, promised_by) => ({
      request_id: req.id, title: `${TAG} U8 socks`, description: null, amount_cents: 2500, currency: 'aud', due_on: inDays(21), closes_at: null,
      team_name: 'U8 SPL', player_id, player_name, status: 'unpaid', paid_at: null, can_pay: true, voucher_cents: 0, voucher_label: null, promised_by,
    })
    const { context, page, calls } = await open(sam, '/payments', {
      my_payment_requests: () => [row(LEO, 'Leo Whitfield', inDays(7)), row(ZOE, 'Zoe Whitfield', zoeDay)],
      promise_to_pay: (b) => { zoeDay = b.p_by; return { id: '00000000-0000-4000-8000-000000000001', by_date: b.p_by, latest: inDays(21) } },
    })
    await page.waitForSelector('[data-pay-later]', { timeout: 20000 }).catch(() => null)
    const t = await text(page)
    ;(await page.$(`[data-promised="${inDays(7)}"]`)) && t.includes("You said you'd pay by") && t.includes("We'll remind you the day before") ? ok("Leo's fee: \"You said you'd pay by …\", with Change") : bad(`leo: ${t.slice(0, 300)}`)
    ;(await page.$$('[data-pay-later]')).length === 1 ? ok('Zoe\'s fee offers "Can\'t pay today? Pick a day"') : bad('no pick-a-day on the unpromised fee')
    const pays = await page.$$eval('button', (bs) => bs.filter((b) => /^Pay \$/.test(b.textContent?.trim() ?? '')).length)
    pays === 2 ? ok('both still have their Pay button — a day is not a payment') : bad(`${pays} Pay buttons`)
    await page.$eval('[data-pay-later]', (b) => b.click())
    await page.waitForSelector('[data-pay-later-form]', { timeout: 5000 }).catch(() => null)
    const picked = await page.$eval('[data-pay-later-form] input[type="date"]', (i) => ({ value: i.value, min: i.min, max: i.max })).catch(() => null)
    picked && picked.value === inDays(21) && picked.min === inDays(1) && picked.max === inDays(60) ? ok(`the form opens on the due date (${picked.value}), from tomorrow to sixty days out`) : bad(`form: ${JSON.stringify(picked)}`)
    ;(await bothThemes(page, 'form')) ? ok('fits 375px, light and dark') : bad('wider than the phone')
    await page.$eval('[data-pay-later-form] input[type="date"]', (el, v) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }, inDays(10))
    await page.$eval('[data-pay-later-save]', (b) => b.click())
    await page.waitForSelector(`[data-promised="${inDays(10)}"]`, { timeout: 10000 }).catch(() => null)
    const sent = calls.filter((c) => c.fn === 'promise_to_pay')
    sent.length === 1 && sent[0].body.p_request === req.id && sent[0].body.p_player === ZOE && sent[0].body.p_by === inDays(10)
      ? ok('"Set the day" sends the fee, the child and the day, once')
      : bad(`sent: ${JSON.stringify(sent)}`)
    ;(await page.$$(`[data-promised]`)).length === 2 ? ok('and the list reads again: both fees now show their day') : bad('the list did not refresh')
    await context.close()
  }

  // ---------------------------------------------------------------------------
  head("2. The club's register lists a promised family last, with the day (stood in)")
  {
    const reg = (player_id, player_name, status, promised_by = null) => ({ player_id, player_name, guardian: 'Sam Whitfield', guardian_phone: '+61400000011', status, paid_at: null, amount_cents: 2500, promised_by })
    const { context, page } = await open(owner, '/admin/payments', {
      payment_register: [reg(LEO, 'Leo Whitfield', 'unpaid', inDays(7)), reg(ZOE, 'Zoe Whitfield', 'unpaid'), reg('00000000-0000-4000-8000-000000000001', 'Max Testing', 'paid')],
    })
    await page.waitForFunction((tag) => document.body.innerText.includes(tag), { timeout: 20000 }, `${TAG} U8 socks`).catch(() => null)
    await page.$$eval('button', (bs, tag) => bs.find((b) => b.textContent?.includes(tag))?.click(), `${TAG} U8 socks`)
    await page.waitForSelector('[data-promised]', { timeout: 10000 }).catch(() => null)
    const t = await text(page)
    t.includes('2 outstanding (1 promised)') ? ok('"1 paid · 2 outstanding (1 promised)"') : bad(`summary: ${t.slice(t.indexOf('paid ·') - 10, t.indexOf('paid ·') + 80)}`)
    // The rows themselves, not the card that holds them.
    const order = await page.$$eval('li', (ls) => ls.filter((l) => !l.querySelector('li') && /Whitfield/.test(l.textContent ?? '')).map((l) => l.textContent?.trim().slice(0, 12)))
    t.includes('promised by') && order[0]?.startsWith('Zoe') ? ok('Leo: "promised by …", listed after Zoe, who is the one to ring') : bad(`order: ${JSON.stringify(order)}`)
    ;(await bothThemes(page, 'register')) ? ok('fits 375px, light and dark') : bad('wider than the phone')
    await context.close()
  }

  // ---------------------------------------------------------------------------
  head('3. Against the database')
  if (!has0227) {
    note('waiting for 0227 on squadroom-dev (the Supabase token) — Sam names a day, the register and who-owes show it, another parent cannot name one for Leo, a day too far is refused; test-rls 158–160 prove it locally meanwhile')
  } else {
    const { data: p, error } = await sam.client.rpc('promise_to_pay', { p_request: req.id, p_player: LEO, p_by: inDays(10) })
    p?.by_date === inDays(10) ? ok(`Sam names ${inDays(10)} for Leo`) : bad(`promise: ${error?.message} ${JSON.stringify(p)}`)
    const { error: far } = await sam.client.rpc('promise_to_pay', { p_request: req.id, p_player: LEO, p_by: inDays(90) })
    far ? ok(`ninety days out is refused: "${far.message}"`) : bad('ninety days was accepted')
    const { error: notMine } = await hanasParent.client.rpc('promise_to_pay', { p_request: req.id, p_player: LEO, p_by: inDays(10) })
    notMine?.code === '42501' ? ok("Hana's parent cannot name a day for Leo") : bad(`other parent: ${notMine?.message ?? 'allowed'}`)
    const { data: reg } = await owner.client.rpc('payment_register', { p_request: req.id })
    const { data: owes } = await owner.client.rpc('outstanding_fees', { p_academy: NRIFA })
    const { data: mine } = await sam.client.rpc('my_payment_requests', { p_academy: NRIFA })
    const leoReg = (reg ?? []).find((r) => r.player_id === LEO)
    const leoOwes = (owes ?? []).find((r) => r.request_id === req.id && r.player_id === LEO)
    const leoMine = (mine ?? []).find((r) => r.request_id === req.id && r.player_id === LEO)
    leoReg?.promised_by === inDays(10) && leoOwes?.promised_by === inDays(10) && leoMine?.promised_by === inDays(10)
      ? ok('the register, who-owes and Sam\'s own list all show the day')
      : bad(`register ${leoReg?.promised_by}, owes ${leoOwes?.promised_by}, mine ${leoMine?.promised_by}`)
    const { data: peek } = await hanasParent.client.from('payment_promises').select('id').eq('request_id', req.id)
    ;(peek ?? []).length === 0 ? ok('another family reads none of it') : bad('another family read the promise')
    const { context, page } = await open(sam, '/payments')
    await page.waitForSelector(`[data-promised="${inDays(10)}"]`, { timeout: 20000 }).catch(() => null)
    ;(await page.$(`[data-promised="${inDays(10)}"]`)) && (await fits(page)) ? ok("Sam's real Payments shows the day, at 375px") : bad('the real page does not show the day')
    await context.close()
  }
} finally {
  await browser.close()
  await tidy()
}
console.log(process.exitCode ? '' : '\n  \x1b[32ma day of their own, before the chase\x1b[0m\n')
