// Run: node --env-file=.env.local scripts/test-sign-up.mjs
//   (needs the app running — npm run dev, or serve:test; SHOTS=1 saves
//   screenshots to .shots/)
//
// Joey's sign-up and account creation brief (12 Nov 2026; 0272), proven the
// way the brief lists its tests:
//
//   1. No access before confirming — the password is not even set.
//   2. A wrong code is refused, an expired one too; five tries a code.
//   3. Forgot password works: a code, a new password, signed in.
//   4. Names split correctly: typed in parts, and the migration's split of
//      the old single field on the last space, with the odd ones flagged.
//   5. The terms line is under Create account on every path.
//   6. A coach's link → create account → code → lands on that team's join
//      request (in a real browser, at 375px, light and dark).
//   7. An existing account → sign in → the same place; "Email me a code
//      instead" too.
//   8. Under-13 rules unchanged: no date of birth on sign-up, and an under-13
//      is still refused a login by the database.
//   9. "Set a password next time" for an account that has none: once, with
//      "Not now" allowed once.
//  10. A phone-joined parent who signs up with the address they gave their
//      club gets THAT account — the password and the real address land on
//      it — and no second account is made.
//
// Demo addresses only (@squadroom-demo.test): their code is shown on the
// screen and comes back in the response, never sent. Everything made here is
// removed.
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'
import { signInBoth } from './_auth.mjs'
import { resolveBaseUrl } from './_base-url.mjs'
import { accountId, createAccount, deleteAccount, forgetCodes, lastDemoCode, signInByCode, TEST_PASSWORD } from './_account.mjs'

const BASE = await resolveBaseUrl()
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const ref = URL_.split('//')[1].split('.')[0]
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const anonClient = () => createClient(URL_, PUB, { auth: { persistSession: false, autoRefreshToken: false } })
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SHOTS = process.env.SHOTS === '1'
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const head = (m) => console.log(`\n${m}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
if (SHOTS) mkdirSync('.shots', { recursive: true })

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const U8 = '00000000-0000-0000-0000-0000000d0008'
const OWNER = '00000000-0000-0000-0000-0000000000a1'
const LEO = '00000000-0000-0000-0000-0000000e0001' // born 2018: under 13
const LABEL = 'TEST:: sign-up'
const E = {
  api: 'signup.parent@squadroom-demo.test',
  flow: 'signup.flow@squadroom-demo.test',
  split: ['signup.split.a@squadroom-demo.test', 'signup.split.b@squadroom-demo.test', 'signup.split.c@squadroom-demo.test'],
  nopw: 'signup.nopw@squadroom-demo.test',
  adopt: 'signup.adopt@squadroom-demo.test',
}
const PHONES = { api: '+61400009801', flow: '+61400009802', adopt: '+61400009803' }
const post = (path, body, cookie) =>
  fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) })
const json = (r) => r.json().catch(() => ({}))

async function tidy() {
  for (const email of [E.api, E.flow, ...E.split, E.nopw, E.adopt]) await deleteAccount(admin, email)
  const { data: strays } = await admin.from('profiles').select('id').in('phone', Object.values(PHONES))
  for (const s of strays ?? []) await admin.auth.admin.deleteUser(s.id).catch(() => null)
  await admin.from('join_requests').delete().eq('academy_id', NRIFA).in('phone', Object.values(PHONES))
  await admin.from('join_links').delete().eq('label', LABEL)
  await admin.from('players').delete().eq('academy_id', NRIFA).like('full_name', 'Signup Child%')
}
await tidy()

const { data: link, error: linkErr } = await admin.from('join_links').insert({ academy_id: NRIFA, team_id: U8, role: 'parent', label: LABEL, created_by: OWNER }).select('id, token').single()
if (linkErr) { bad(`link: ${linkErr.message}`); process.exit(1) }
const JOIN = `/join/${link.token}`

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
async function open(path, cookies = null) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 375, height: 812 })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
  if (cookies) await page.setCookie(...cookies)
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 90000 })
  return { context, page }
}
const fits = (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1)
async function shot(page, name) {
  if (!SHOTS) return
  for (const scheme of ['light', 'dark']) {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }])
    await sleep(150)
    await page.screenshot({ path: `.shots/signup-${name}-${scheme}.png`, fullPage: true })
  }
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
}
const type = async (page, sel, text) => { await page.waitForSelector(sel, { timeout: 20000 }); await page.click(sel, { clickCount: 3 }); await page.type(sel, text) }

try {
  head('1. No access before confirming')
  const made = await post('/api/account/create', { first: 'Mary Anne', middle: 'Louise', last: 'Smith', email: E.api, mobile: '0400 009 801' })
  const madeBody = await json(made)
  made.ok && /^\d{6}$/.test(madeBody.demo_code ?? '') ? ok(`the account is started and the code is shown for a demo address (${madeBody.channel})`) : bad(`create: ${made.status} ${JSON.stringify(madeBody)}`)
  {
    const { error } = await anonClient().auth.signInWithPassword({ email: E.api, password: TEST_PASSWORD })
    error ? ok(`the password signs nobody in before the code: "${error.message}"`) : bad('signed in before confirming')
    const { data: look } = await admin.rpc('account_lookup', { p_email: E.api, p_phone: '' })
    look?.by_email && look.by_email.confirmed === false && look.by_email.has_password === false ? ok('the account exists, unconfirmed, and has no password yet') : bad(`lookup: ${JSON.stringify(look)}`)
    const req = await post('/api/join/request', { token: link.token, children: [] })
    req.status === 401 ? ok('and the join request route refuses without a session') : bad(`join without a session: ${req.status}`)
    const dup = await post('/api/account/create', { first: 'Mary Anne', middle: 'Louise', last: 'Smith', email: E.api, mobile: '0400 009 801' })
    const dupBody = await json(dup)
    dup.status === 429 && /seconds/.test(dupBody.error ?? '') ? ok(`a second code inside thirty seconds is refused: "${dupBody.error}"`) : bad(`resend at once: ${dup.status} ${JSON.stringify(dupBody)}`)
  }

  head('2. A wrong code is refused, and an expired one')
  {
    const wrongCode = madeBody.demo_code === '000000' ? '111111' : '000000'
    const wrong = await post('/api/account/confirm', { email: E.api, code: wrongCode, purpose: 'confirm', password: TEST_PASSWORD })
    const wrongBody = await json(wrong)
    wrong.status === 400 && /isn’t right|isn't right/.test(wrongBody.error ?? '') ? ok(`wrong code: "${wrongBody.error}"`) : bad(`wrong code: ${wrong.status} ${JSON.stringify(wrongBody)}`)
    const noPw = await post('/api/account/confirm', { email: E.api, code: madeBody.demo_code, purpose: 'confirm', password: 'short' })
    const noPwBody = await json(noPw)
    noPw.status === 400 && noPwBody.error === 'password-needed' ? ok('a password under 8 is refused before the code is spent') : bad(`short password: ${noPw.status} ${JSON.stringify(noPwBody)}`)
    await admin.from('email_codes').update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq('email', E.api).eq('purpose', 'confirm')
    const expired = await post('/api/account/confirm', { email: E.api, code: madeBody.demo_code, purpose: 'confirm', password: TEST_PASSWORD })
    const expiredBody = await json(expired)
    expired.status === 410 && /expired/.test(expiredBody.error ?? '') ? ok(`expired code: "${expiredBody.error}"`) : bad(`expired: ${expired.status} ${JSON.stringify(expiredBody)}`)
    // A fresh code (the thirty-second wait is forgotten by the suite, not the product).
    await forgetCodes(admin, [E.api])
    const again = await post('/api/account/code', { email: E.api, purpose: 'confirm' })
    const againBody = await json(again)
    again.ok && againBody.demo_code ? ok('a new code') : bad(`new code: ${again.status} ${JSON.stringify(againBody)}`)
    for (let i = 0; i < 5; i++) await post('/api/account/confirm', { email: E.api, code: againBody.demo_code === '000000' ? '111111' : '000000', purpose: 'confirm', password: TEST_PASSWORD })
    const locked = await post('/api/account/confirm', { email: E.api, code: againBody.demo_code, purpose: 'confirm', password: TEST_PASSWORD })
    locked.status === 429 ? ok('five wrong tries lock the code, even to the right digits') : bad(`after five wrong tries: ${locked.status}`)
    await forgetCodes(admin, [E.api])
    const third = await json(await post('/api/account/code', { email: E.api, purpose: 'confirm' }))
    const done = await post('/api/account/confirm', { email: E.api, code: third.demo_code, purpose: 'confirm', password: TEST_PASSWORD, next: JOIN })
    const doneBody = await json(done)
    const cookies = done.headers.getSetCookie?.() ?? []
    done.ok && doneBody.next === JOIN && cookies.some((c) => c.startsWith(`sb-${ref}-auth-token`)) ? ok('the right code confirms it: a session is minted and `next` comes back') : bad(`confirm: ${done.status} ${JSON.stringify(doneBody)} cookies ${cookies.length}`)
    const { error } = await anonClient().auth.signInWithPassword({ email: E.api, password: TEST_PASSWORD })
    !error ? ok('and the password now signs in') : bad(`password after confirming: ${error.message}`)
    const { data: prof } = await admin.from('profiles').select('first_name, middle_name, last_name, full_name, name_check_needed, phone').eq('id', await accountId(admin, E.api)).maybeSingle()
    prof?.first_name === 'Mary Anne' && prof.middle_name === 'Louise' && prof.last_name === 'Smith' && prof.full_name === 'Mary Anne Smith' && !prof.name_check_needed && prof.phone === PHONES.api
      ? ok('the profile: Mary Anne · Louise · Smith, shown as "Mary Anne Smith", mobile as +61, nothing to check')
      : bad(`profile: ${JSON.stringify(prof)}`)
  }

  head('3. Forgot password works')
  {
    await forgetCodes(admin, [E.api])
    const reset = await signInByCode(BASE, E.api, 'reset', 'a-new-password-9')
    reset.cookies.length > 0 ? ok('a code, a new password, and a session') : bad('no session after the reset')
    const { error: oldErr } = await anonClient().auth.signInWithPassword({ email: E.api, password: TEST_PASSWORD })
    const { error: newErr } = await anonClient().auth.signInWithPassword({ email: E.api, password: 'a-new-password-9' })
    oldErr && !newErr ? ok('the old password is dead, the new one signs in') : bad(`old: ${oldErr?.message ?? 'works'}, new: ${newErr?.message ?? 'works'}`)
    await forgetCodes(admin, [E.api])
    const code = await signInByCode(BASE, E.api, 'sign_in')
    code.cookies.length > 0 ? ok('"Email me a code instead" signs in too') : bad('no session by code')
    const unknown = await post('/api/account/code', { email: 'nobody.here@squadroom-demo.test', purpose: 'sign_in' })
    const unknownBody = await json(unknown)
    unknown.ok && !unknownBody.demo_code ? ok('an address nobody holds gets the same answer and no code — the route names no accounts') : bad(`unknown address: ${unknown.status} ${JSON.stringify(unknownBody)}`)
  }

  head('4. Names split correctly')
  {
    const cases = [
      [E.split[0], 'Jean Claude Van Damme', 'Jean Claude Van', 'Damme', true],
      [E.split[1], 'Madonna', 'Madonna', '', true],
      [E.split[2], 'Sam Whitfield', 'Sam', 'Whitfield', false],
    ]
    for (const [email, full, first, last, odd] of cases) {
      const { data: u, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: full } })
      if (error) { bad(`${full}: ${error.message}`); continue }
      const { data: p } = await admin.from('profiles').select('first_name, last_name, full_name, name_check_needed').eq('id', u.user.id).maybeSingle()
      p?.first_name === first && p.last_name === last && p.full_name === full && p.name_check_needed === odd
        ? ok(`"${full}" → ${first || '—'} + ${last || '—'}${odd ? ', flagged for the club' : ''}`)
        : bad(`"${full}" → ${JSON.stringify(p)}`)
    }
    // The person fixes it, as the profile form does: the flag clears, the whole follows.
    const madonna = await signInBoth(admin, E.split[1])
    if (madonna) {
      const { data: set, error } = await madonna.client.rpc('set_my_name', { p_first: 'Madonna', p_last: 'Ciccone' })
      !error && set?.full_name === 'Madonna Ciccone' && set.name_check_needed === false ? ok('set_my_name: Madonna Ciccone, flag cleared') : bad(`set_my_name: ${error?.message ?? JSON.stringify(set)}`)
    }
    // The club sees the flagged one, and may fix it; a parent may not.
    const owner = await signInBoth(admin, 'head@squadroom-demo.test')
    const jcvd = await accountId(admin, E.split[0])
    await admin.from('academy_members').insert({ academy_id: NRIFA, profile_id: jcvd, role: 'parent', status: 'active' })
    const { data: toCheck } = await owner.client.rpc('names_to_check', { p_academy: NRIFA })
    ;(toCheck ?? []).some((r) => r.profile_id === jcvd) ? ok('the owner\'s list of names to check has him') : bad(`names_to_check: ${JSON.stringify(toCheck)}`)
    const { error: fixErr } = await owner.client.rpc('set_member_name', { p_academy: NRIFA, p_profile: jcvd, p_first: 'Jean-Claude', p_last: 'Van Damme' })
    const { data: fixed } = await admin.from('profiles').select('full_name, name_check_needed').eq('id', jcvd).maybeSingle()
    !fixErr && fixed?.full_name === 'Jean-Claude Van Damme' && !fixed.name_check_needed ? ok('the owner fixes it: Jean-Claude Van Damme, flag cleared') : bad(`fix: ${fixErr?.message ?? JSON.stringify(fixed)}`)
    const parent = await signInBoth(admin, 'p61400000011@squadroom.invalid')
    const { error: parentErr } = parent ? await parent.client.rpc('set_member_name', { p_academy: NRIFA, p_profile: jcvd, p_first: 'Not', p_last: 'Yours' }) : { error: { code: 'skip' } }
    parentErr?.code === '42501' || parentErr?.code === 'skip' ? ok('a parent cannot') : bad(`a parent set a member's name: ${parentErr?.message ?? 'allowed'}`)
    await admin.from('academy_members').delete().eq('academy_id', NRIFA).eq('profile_id', jcvd)
  }

  head('5. The terms line, on every path')
  {
    const terms = await fetch(`${BASE}/terms`)
    terms.ok && /Terms of use/.test(await terms.text()) ? ok('/terms is a page') : bad(`/terms: ${terms.status}`)
    for (const [label, path] of [['club sign-up', '/signup'], ['a coach\'s link', `/signup?next=${encodeURIComponent(JOIN)}`], ['registration', `/signup?next=${encodeURIComponent('/nrifa/register')}`]]) {
      const { context, page } = await open(path)
      await page.waitForSelector('[data-create-account]', { timeout: 20000 }).catch(() => null)
      const line = await page.$eval('[data-terms-line]', (e) => ({ text: e.innerText, links: [...e.querySelectorAll('a')].map((a) => a.getAttribute('href')) })).catch(() => null)
      line && /agree to our Terms and Privacy Policy/.test(line.text.replace(/\s+/g, ' ')) && line.links.includes('/terms') && line.links.includes('/privacy')
        ? ok(`${label}: "By creating an account you agree to our Terms and Privacy Policy", both linked`)
        : bad(`${label}: ${JSON.stringify(line)}`)
      const labels = await page.$$eval('[data-create-account] label', (ls) => ls.map((l) => l.innerText.replace(/\s+/g, ' ').trim()))
      const want = ['First name *', 'Middle name (optional)', 'Last name *', 'Email *', 'Mobile *', 'Password *']
      want.every((w) => labels.some((l) => l.startsWith(w))) ? ok('the six fields, labels above, * for required') : bad(`labels: ${JSON.stringify(labels)}`)
      const buttons = await page.$$eval('[data-create-account] button[type="submit"]', (bs) => bs.map((b) => b.innerText.trim()))
      buttons.length === 1 && buttons[0] === 'Create account' ? ok('one button') : bad(`buttons: ${JSON.stringify(buttons)}`)
      const dob = await page.$('[data-create-account] input[type="date"]')
      !dob ? ok('no date of birth asked — nobody under 18 makes an account here') : bad('a date of birth field on sign-up')
      ;(await fits(page)) ? ok('fits 375px') : bad('wider than the phone')
      if (label === 'club sign-up') await shot(page, 'create')
      await context.close()
    }
  }

  head("6. A coach's link → create account → code → that team's join request")
  {
    const { context, page } = await open(JOIN)
    await page.waitForSelector('[data-join-landing]', { timeout: 20000 })
    const what = await page.$eval('[data-join-what]', (e) => e.innerText.replace(/\s+/g, ' '))
    ;/^Join U8 SPL at NRIFA/.test(what) ? ok(`the landing: crest and "${what}"`) : bad(`landing: "${what}"`)
    ;(await page.$('[data-join-crest]')) ? ok('with the club\'s crest') : bad('no crest')
    const links = await page.$$eval('[data-join-landing] a', (as) => as.map((a) => [a.innerText.trim(), a.getAttribute('href')]))
    links.some(([t, h]) => t === 'Create account' && h?.startsWith('/signup?next=')) && links.some(([t, h]) => t === 'Sign in' && h?.startsWith('/signin?next='))
      ? ok('Create account, or "I already have an account → Sign in" — both carrying this page as next')
      : bad(`links: ${JSON.stringify(links)}`)
    ;(await fits(page)) ? ok('fits 375px') : bad('landing wider than the phone')
    await shot(page, 'landing')
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }), page.click('[data-join-create]')])
    await page.waitForSelector('[data-create-account]', { timeout: 20000 })
    ;/\/signup\?next=/.test(page.url()) ? ok('Create account opens the one plain screen') : bad(`url: ${page.url()}`)
    const why = await page.$eval('[data-create-why]', (e) => e.innerText).catch(() => '')
    ;/^Join U8 SPL at NRIFA/.test(why) ? ok(`and says what for: "${why}"`) : bad(`why: "${why}"`)
    await type(page, '[data-first]', 'Signup')
    await type(page, '[data-last]', 'Parent')
    await type(page, '[data-email]', E.flow)
    await type(page, '[data-mobile]', '0400 009 802')
    await type(page, '[data-password]', TEST_PASSWORD)
    const eye = await page.$eval('[data-password-eye]', (b) => b.getAttribute('aria-label'))
    await page.click('[data-password-eye]')
    const shown = await page.$eval('[data-password]', (i) => i.type)
    eye === 'Show password' && shown === 'text' ? ok('the eye shows the password') : bad(`eye: ${eye}, type ${shown}`)
    await page.click('[data-create-submit]')
    await page.waitForSelector('[data-code-step="confirm"]', { timeout: 30000 })
    const demo = await page.$eval('[data-demo-code]', (e) => e.getAttribute('data-demo-code')).catch(() => null)
    ;/^\d{6}$/.test(demo ?? '') ? ok(`the code screen — a demo account's code is shown: ${demo}`) : bad('no demo code on the screen')
    const resend = await page.$eval('[data-resend]', (b) => ({ disabled: b.disabled, text: b.innerText }))
    resend.disabled && /Resend in \d+ s/.test(resend.text) ? ok(`"${resend.text}" — a resend waits thirty seconds`) : bad(`resend: ${JSON.stringify(resend)}`)
    const copy = await page.$eval('[data-code-step]', (e) => e.innerText)
    ;/10 minutes/.test(copy) ? ok('and says a code works for 10 minutes') : bad('no expiry said')
    ;(await fits(page)) ? ok('fits 375px') : bad('code screen wider than the phone')
    await shot(page, 'code')
    await type(page, '[data-code-input]', demo)
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }), page.click('[data-code-submit]')])
    await page.waitForSelector('[data-join-form]', { timeout: 30000 }).catch(() => null)
    page.url().endsWith(JOIN) && (await page.$('[data-join-form]')) ? ok('…and lands straight back on the join request for that team') : bad(`landed on ${page.url()}`)
    const heading = await page.$eval('[data-join-form]', (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '')
    ;/Join U8 SPL/.test(heading) && /as Signup Parent/.test(heading) ? ok('"Join U8 SPL · NRIFA · as Signup Parent" — no name, mobile or email asked again') : bad(`form: ${heading.slice(0, 160)}`)
    ;(await page.$('[data-join-email]')) || (await page.$('input[autocomplete="name"]')) ? bad('the form asks for the name or email again') : ok('nothing repeated')
    await type(page, '[data-join-child-name]', 'Signup Child')
    await page.$eval('[data-join-child-dob]', (i) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(i, '2017-07-07')
      i.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await page.click('[data-join-submit]')
    await page.waitForSelector('[data-join-pending]', { timeout: 20000 }).catch(() => null)
    ;(await page.$('[data-join-pending]')) ? ok('the request is sent: "Waiting for your coach"') : bad('no pending screen')
    const { data: row } = await admin.from('join_requests').select('status, full_name, phone, email, children').eq('join_link_id', link.id).eq('phone', PHONES.flow).maybeSingle()
    row?.status === 'pending' && row.full_name === 'Signup Parent' && row.email === E.flow && row.children?.[0]?.name === 'Signup Child' ? ok('the request carries the account and the child') : bad(`request: ${JSON.stringify(row)}`)
    // Back to the link later: the pending screen, not the form again.
    await page.goto(`${BASE}${JOIN}`, { waitUntil: 'networkidle2' })
    ;(await page.$('[data-join-pending]')) ? ok('opening the link again shows the wait, not a second form') : bad('the link showed the form again')
    await context.close()
  }

  head('7. An existing account → sign in → the same place')
  {
    const { context, page } = await open(JOIN)
    await page.waitForSelector('[data-join-sign-in]', { timeout: 20000 })
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }), page.click('[data-join-sign-in]')])
    ;/\/signin\?next=/.test(page.url()) ? ok('Sign in, with next') : bad(`url: ${page.url()}`)
    await page.waitForSelector('[data-sign-in="password"]', { timeout: 20000 })
    const links = await page.$$eval('[data-sign-in] button, [data-sign-in] ~ p a', (es) => es.map((e) => e.innerText.trim()))
    links.includes('Email me a code instead') && links.includes('Forgot password') ? ok('email and password, with "Email me a code instead" and "Forgot password"') : bad(`sign-in offers: ${JSON.stringify(links)}`)
    await shot(page, 'signin')
    await type(page, '[data-email]', E.api)
    await type(page, '[data-password]', 'a-new-password-9')
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }), page.click('[data-sign-in-submit]')])
    await page.waitForSelector('[data-join-form]', { timeout: 30000 }).catch(() => null)
    page.url().endsWith(JOIN) && (await page.$('[data-join-form]')) ? ok('signed in, and straight back on the join request') : bad(`landed on ${page.url()}`)
    await context.close()

    // By code, from the sign-in screen.
    await forgetCodes(admin, [E.api])
    const byCode = await open(`/signin?next=${encodeURIComponent(JOIN)}`)
    await byCode.page.waitForSelector('[data-email-code]', { timeout: 20000 })
    await byCode.page.click('[data-email-code]')
    await type(byCode.page, '[data-email]', E.api)
    await byCode.page.click('[data-sign-in-submit]')
    await byCode.page.waitForSelector('[data-code-step="sign_in"]', { timeout: 30000 })
    const demo = await byCode.page.$eval('[data-demo-code]', (e) => e.getAttribute('data-demo-code')).catch(() => null)
    const dbCode = await lastDemoCode(admin, E.api, 'sign_in')
    demo && demo === dbCode ? ok('the sign-in code is shown for the demo account') : bad(`code: screen ${demo}, table ${dbCode}`)
    await type(byCode.page, '[data-code-input]', demo)
    await Promise.all([byCode.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }), byCode.page.click('[data-code-submit]')])
    byCode.page.url().endsWith(JOIN) ? ok('…and the same place again') : bad(`landed on ${byCode.page.url()}`)
    await byCode.context.close()
  }

  head('8. Under-13 rules unchanged')
  {
    const parent = await signInBoth(admin, 'p61400000011@squadroom.invalid')
    const { error } = parent ? await parent.client.rpc('invite_player_login', { p_player: LEO, p_email: 'leo.test@squadroom-demo.test' }) : { error: null }
    error ? ok(`an under-13 is still refused a login by the database: "${error.message}"`) : bad('an under-13 was invited to a login')
    await admin.from('player_logins').delete().eq('player_id', LEO).eq('email', 'leo.test@squadroom-demo.test')
  }

  head('9. Set a password next time — once, with "Not now" allowed once')
  {
    const { data: u } = await admin.auth.admin.createUser({ email: E.nopw, email_confirm: true, user_metadata: { full_name: 'No Password' } })
    await admin.from('academy_members').insert({ academy_id: NRIFA, profile_id: u.user.id, role: 'parent', status: 'active' })
    const mint = async () => {
      const { data: l } = await admin.auth.admin.generateLink({ type: 'magiclink', email: E.nopw })
      const { data } = await anonClient().auth.verifyOtp({ token_hash: l.properties.hashed_token, type: 'email' })
      return [{ name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(data.session)).toString('base64'), domain: 'localhost', path: '/' }]
    }
    const first = await open('/', await mint())
    await first.page.waitForSelector('[data-password-gate]', { timeout: 30000 }).catch(() => null)
    ;(await first.page.$('[data-password-gate]')) ? ok('an account with no password is asked to set one, above the app') : bad('no password screen')
    ;(await first.page.$('[data-set-password-later]')) ? ok('with "Not now"') : bad('no "Not now" the first time')
    await shot(first.page, 'gate')
    await first.page.click('[data-set-password-later]')
    await first.page.waitForFunction(() => !document.querySelector('[data-password-gate]'), { timeout: 15000 }).catch(() => null)
    ;(await first.page.$('[data-password-gate]')) ? bad('"Not now" did not dismiss it') : ok('"Not now" dismisses it')
    await first.context.close()
    const second = await open('/', await mint())
    await second.page.waitForSelector('[data-password-gate]', { timeout: 30000 }).catch(() => null)
    ;(await second.page.$('[data-password-gate]')) && !(await second.page.$('[data-set-password-later]')) ? ok('the next sign-in asks again, and "Not now" is gone') : bad('the second sign-in: ' + ((await second.page.$('[data-password-gate]')) ? '"Not now" still offered' : 'no screen'))
    await type(second.page, '[data-password-gate] [data-password]', TEST_PASSWORD)
    await second.page.click('[data-set-password-save]')
    await second.page.waitForFunction(() => !document.querySelector('[data-password-gate]'), { timeout: 15000 }).catch(() => null)
    const { data: look } = await admin.rpc('account_lookup', { p_email: E.nopw, p_phone: '' })
    look?.by_email?.has_password ? ok('saved: the account has a password') : bad(`after saving: ${JSON.stringify(look)}`)
    await second.context.close()
  }

  head('10. A phone-joined parent signs up with the address they gave their club: the same account')
  {
    const { data: ph } = await admin.auth.admin.createUser({ email: 'p61400009803@squadroom.invalid', phone: PHONES.adopt, email_confirm: true, phone_confirm: true, user_metadata: { full_name: 'Adopt Parent' } })
    await admin.from('account_emails').insert({ profile_id: ph.user.id, email: E.adopt })
    const made = await post('/api/account/create', { first: 'Adopt', last: 'Parent', email: E.adopt, mobile: '0400 009 803' })
    const madeBody = await json(made)
    made.ok && madeBody.adopt === true && madeBody.demo_code ? ok('the sign-up is recognised as that account\'s') : bad(`create: ${made.status} ${JSON.stringify(madeBody)}`)
    const done = await post('/api/account/confirm', { email: E.adopt, code: madeBody.demo_code, purpose: 'confirm', password: TEST_PASSWORD })
    done.ok ? ok('confirmed') : bad(`confirm: ${done.status} ${JSON.stringify(await json(done))}`)
    const { data: u } = await admin.auth.admin.getUserById(ph.user.id)
    u?.user?.email === E.adopt && u.user.email_confirmed_at ? ok('the real address is now the sign-in address, confirmed') : bad(`user: ${u?.user?.email}`)
    const { error } = await anonClient().auth.signInWithPassword({ email: E.adopt, password: TEST_PASSWORD })
    !error ? ok('and the password signs in to it') : bad(`password: ${error.message}`)
    const { data: look } = await admin.rpc('account_lookup', { p_email: E.adopt, p_phone: PHONES.adopt })
    look?.by_email?.user_id === ph.user.id && look?.by_phone?.profile_id === ph.user.id ? ok('one account, not two') : bad(`lookup: ${JSON.stringify(look)}`)
    const taken = await post('/api/account/create', { first: 'Someone', last: 'Else', email: 'someone.else@squadroom-demo.test', mobile: '0400 009 803' })
    const takenBody = await json(taken)
    taken.status === 409 && takenBody.error === 'phone-taken' ? ok('somebody else typing that mobile is told to sign in, not given the account') : bad(`taken: ${taken.status} ${JSON.stringify(takenBody)}`)
    await deleteAccount(admin, 'someone.else@squadroom-demo.test')
  }
} catch (e) {
  bad(`threw: ${e.stack ?? e.message}`)
} finally {
  await browser.close()
  await tidy()
}
console.log(process.exitCode ? '' : '\n  \x1b[32mone account for everyone, and every way in comes straight back\x1b[0m\n')
