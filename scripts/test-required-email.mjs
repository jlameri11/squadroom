// Run: node --env-file=.env.local scripts/test-required-email.mjs
//   (needs the app running — npm run dev, or serve:test)
//
// Every account has an email (Joey, 5 Nov 2026; 0214), and a child's login
// is 13-and-over only, with a parent's yes (0215).
//
//   1. Joining cannot finish without an email — the API refuses, the form
//      will not send; any address is fine, a placeholder is not.
//   2. Registering a child needs one too.
//   3. The "news and offers" box starts unticked, everywhere it appears.
//   4. A phone-joined parent is never shown their placeholder sign-in address.
//   5. (0214) An account without an email is asked once, and cannot skip it;
//      what it saves is its own, opt-in off.
//   6. (0215) An under-13 gets no login; a 13-and-over login waits for the
//      parent — proven by test-rls 130–133; the screen is noted here.
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'
import { signInBoth } from './_auth.mjs'
import { resolveBaseUrl } from './_base-url.mjs'
import { createAccount, deleteAccount } from './_account.mjs'
import { checkEmail } from '../lib/email.ts'

const BASE = await resolveBaseUrl()
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const ref = URL_.split('//')[1].split('.')[0]
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
const OWNER = '00000000-0000-0000-0000-0000000000a1'
const SAM = '00000000-0000-0000-0000-0000000000b1'
const PHONE = '0400 009 777'
const GOOD = 'test.email.parent@squadroom-demo.test'
const post = (path, body, cookie) => fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) })

const { error: no0214 } = await admin.from('account_emails').select('profile_id').limit(1)
const has0214 = !no0214
const { error: no0215 } = await admin.from('player_logins').select('player_id').limit(1)
const has0215 = !no0215

const tidy = async () => {
  await admin.from('join_requests').delete().eq('phone', '+61400009777')
  await admin.from('join_links').delete().eq('label', 'TEST:: required-email')
  await deleteAccount(admin, GOOD)
}
await tidy()
const { data: link } = await admin.from('join_links')
  .insert({ academy_id: NRIFA, team_id: U8, role: 'parent', label: 'TEST:: required-email', created_by: OWNER })
  .select('token').single()

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
async function open(person, path) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 375, height: 812 })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
  if (person?.session) await page.setCookie({ name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(person.session)).toString('base64'), domain: 'localhost', path: '/' })
  else if (person?.browserCookies) await page.setCookie(...person.browserCookies)
  await page.evaluateOnNewDocument((o) => { try { localStorage.setItem('squadroom.org', o) } catch {} }, NRIFA)
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 90000 })
  return { context, page }
}
const shot = async (page, name) => {
  if (!SHOTS) return
  for (const scheme of ['light', 'dark']) {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }])
    await sleep(150)
    await page.screenshot({ path: `.shots/email-${name}-${scheme}.png` })
  }
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
}

try {
  head('1. No joining without an account, and no account without an email')
  {
    // The sign-up brief (12 Nov 2026): the account is the door, and the
    // account is where the email is asked for — any address, never a
    // placeholder, never one nobody reads.
    const none = await post('/api/join/request', { token: link.token, children: [] })
    const noneBody = await none.json().catch(() => ({}))
    none.status === 401 && /account/i.test(noneBody.error ?? '') ? ok(`no account → refused: “${noneBody.error}”`) : bad(`no account → ${none.status} ${JSON.stringify(noneBody)}`)
    const who = { first: 'TEST', last: 'Email Parent', mobile: PHONE }
    const noEmail = await post('/api/account/create', who)
    const noEmailBody = await noEmail.json().catch(() => ({}))
    noEmail.status === 400 && /email/i.test(noEmailBody.error ?? '') ? ok(`an account with no email → refused: “${noEmailBody.error}”`) : bad(`no email → ${noEmail.status} ${JSON.stringify(noEmailBody)}`)
    const junk = await post('/api/account/create', { ...who, email: 'not an email' })
    junk.status === 400 ? ok('not an email → refused') : bad(`junk → ${junk.status}`)
    const placeholder = await post('/api/account/create', { ...who, email: 'p61400009777@squadroom.invalid' })
    placeholder.status === 400 ? ok('an address nobody reads → refused') : bad(`placeholder → ${placeholder.status}`)
    const good = await createAccount(BASE, { ...who, email: GOOD })
    ok('any real address → the account is made (no PlayFootball match asked for)')

    // The screens: a stranger is offered an account; a member sees the form
    // with no email field — the account has it — and the box unticked.
    const stranger = await open(null, `/join/${link.token}`)
    ;(await stranger.page.$('[data-join-landing]')) ? ok('a stranger on the coach\'s link is offered Create account, not a form') : bad('a stranger saw something other than the landing')
    await shot(stranger.page, 'landing')
    await stranger.context.close()
    const { context, page } = await open(good, `/join/${link.token}`)
    await page.waitForSelector('[data-join-form]', { timeout: 20000 }).catch(() => null)
    ;(await page.$('[data-join-form]')) ? ok('signed in: the join form') : bad('no join form for the signed-in parent')
    const field = await page.$('[data-join-email]')
    !field ? ok('which asks no email — the account already has one') : bad('the join form still asks for an email')
    const ticked = await page.$eval('[data-news-opt-in]', (c) => c.checked).catch(() => null)
    ticked === false ? ok('"Send me news and offers from Squadroom" starts unticked') : bad(`the opt-in starts ${ticked}`)
    await shot(page, 'join')
    await context.close()

    const req = await post('/api/join/request', { token: link.token, children: [] }, good.cookie)
    req.ok ? ok('and the request goes') : bad(`the request → ${req.status}`)
    const { data: row } = await admin.from('join_requests').select('email, news_opt_in_at').eq('phone', '+61400009777').maybeSingle()
    row?.email === GOOD && row.news_opt_in_at === null ? ok("the account's email rides on the request, news opt-in off") : bad(`kept: ${JSON.stringify(row)}`)
  }

  head('2. No registering a child without an account')
  {
    const res = await post('/api/register/request', { slug: 'nrifa', programId: '00000000-0000-0000-0000-000000000000', guardianName: 'TEST Guardian', guardianPhone: PHONE, childName: 'TEST Child', childDob: '2017-01-01', consents: [] })
    const body = await res.json().catch(() => ({}))
    res.status === 401 && /account/i.test(body.error ?? '') ? ok(`refused: “${body.error}”`) : bad(`no account at registration → ${res.status} ${JSON.stringify(body)}`)
  }

  head('3. Any address, never a placeholder')
  {
    const cases = [['ellie@outlook.com', true], ['coach@club.org.au', true], ['A.Parent@Gmail.com', true], ['', false], ['no-at-sign', false], ['p61400000011@squadroom.invalid', false]]
    const wrong = cases.filter(([e, want]) => checkEmail(e).ok !== want)
    wrong.length === 0 ? ok('outlook, a club domain, mixed case: fine; empty, junk, a placeholder: refused') : bad(`wrong: ${JSON.stringify(wrong)}`)
  }

  const sam = await signInBoth(admin, 'p61400000011@squadroom.invalid')
  if (!sam) { note("could not sign in — the project's auth rate limit"); process.exit(process.exitCode ?? 2) }

  head('4. A phone-joined parent is never shown a placeholder address')
  {
    const { context, page } = await open(sam, '/settings')
    const text = await page.evaluate(() => document.body.innerText)
    !text.includes('@squadroom.invalid') ? ok('Settings shows Sam no "@squadroom.invalid" address') : bad('Settings shows the placeholder sign-in address')
    await context.close()
  }

  head('5. An account without an email is asked once, and cannot skip it')
  if (!has0214) {
    note('waiting for migration 0214 (needs the Supabase token) — test-rls 124–129 prove who sees an email and that the opt-in starts off')
  } else {
    const { data: before } = await admin.from('account_emails').select('*').eq('profile_id', SAM).maybeSingle()
    if (before) await admin.from('account_emails').delete().eq('profile_id', SAM)
    const { context, page } = await open(sam, '/')
    await page.waitForSelector('[data-email-gate]', { timeout: 20000 }).catch(() => null)
    const gate = await page.$('[data-email-gate]')
    gate ? ok('Sam, who joined by phone, is asked for an email on opening the app') : bad('no email screen')
    const buttons = await page.$$eval('[data-email-gate] button', (bs) => bs.map((b) => b.innerText.trim()))
    !buttons.some((b) => /skip|later|not now|close/i.test(b)) ? ok(`no way past but giving one or signing out (${buttons.join(' · ')})`) : bad(`a way to skip: ${buttons}`)
    const unticked = await page.$eval('[data-email-gate] [data-news-opt-in]', (c) => c.checked)
    unticked === false ? ok('the news box is unticked') : bad('the news box starts ticked')
    await shot(page, 'gate')
    await page.type('[data-email-input]', 'sam.whitfield.test@example.com')
    await page.$eval('[data-email-gate] button[type="submit"]', (b) => b.click())
    await page.waitForFunction(() => !document.querySelector('[data-email-gate]'), { timeout: 15000 }).catch(() => null)
    const { data: after } = await admin.from('account_emails').select('email, verified_at, news_opt_in_at').eq('profile_id', SAM).maybeSingle()
    after?.email === 'sam.whitfield.test@example.com' && after.news_opt_in_at === null && after.verified_at === null
      ? ok('saved as Sam\'s, unconfirmed until the link, news off') : bad(`saved: ${JSON.stringify(after)}`)
    await page.reload({ waitUntil: 'networkidle2' })
    await sleep(1500)
    ;(await page.$('[data-email-gate]')) ? bad('asked again after giving one') : ok('and not asked again')
    await context.close()
    await admin.from('account_emails').delete().eq('profile_id', SAM)
    if (before) await admin.from('account_emails').insert(before)
  }

  head('6. A child\'s login: never under 13; from 13, a parent\'s yes')
  if (!has0215) note('waiting for migration 0215 — test-rls 130–133 prove it (an under-13 refused by invitation and by linking; a 13-and-over login waits for approval)')
  else note('the database rules are test-rls 130–133; My family offers "Their own login" only for a child of 13 or over')
} finally {
  await browser.close()
  await tidy()
}
console.log(process.exitCode ? '' : '\n  \x1b[32mevery account has an email, and nobody is told anybody else\'s\x1b[0m\n')
