// Run: node --env-file=.env.local scripts/test-save-resume.mjs
//   (the dev server on :3000; SHOTS=1 saves the screens at 375px)
//
// The registration brief, gap 8 (0269): save and resume, on Inner West FC.
// A family with no account half-fills the form on one phone, taps "Save
// and get a code", and picks the draft up on another phone with the code —
// the program and the child's name are back; a wrong code is nothing. A
// signed-in parent's draft follows their account as they type and is there
// on a second phone they are signed in on. Everything made here is removed.
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
const SLUG = 'inner-west-fc'
const TAG = 'Zz Draft'
const until = async (fn, ms = 15000, every = 400) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, every)) }
  return null
}

const president = await signInBoth(admin, 'iw.president@squadroom-demo.test')
const parent = await signInBoth(admin, 'iw.parent@squadroom-demo.test')
if (!president || !parent) { console.log("  could not sign in — the project's auth rate limit, not a failure"); process.exit(2) }
await admin.from('registration_attempts').delete().gte('created_at', '1970-01-01')

const codes = []
async function cleanup() {
  for (const c of codes) await admin.from('registration_drafts').delete().eq('code', c.replace(/[^A-Z0-9]/g, ''))
  await admin.from('registration_drafts').delete().eq('academy_id', IW).eq('profile_id', parent.session.user.id)
  await admin.from('programs').delete().eq('academy_id', IW).like('name', `${TAG} %`)
}
await cleanup()

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
async function open(who, scheme) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 375, height: 812 })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }])
  if (who) await page.setCookie({ name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(who.session)).toString('base64'), domain: 'localhost', path: '/' })
  await page.goto(`${BASE}/${SLUG}/register`, { waitUntil: 'networkidle2', timeout: 90000 })
  return { page, context }
}
async function waitFor(page, selector, ms = 45000) {
  const found = await page.waitForSelector(selector, { timeout: ms }).catch(() => null)
  if (found) return found
  await page.reload({ waitUntil: 'networkidle2', timeout: 90000 })
  return page.waitForSelector(selector, { timeout: ms }).catch(() => null)
}
const fits = (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1)
const shot = (page, name) => SHOTS ? page.screenshot({ path: `.shots/save-resume-${name}.png`, fullPage: true }) : null
const tap = async (h) => { await h.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' })); await h.click() }
const byLabel = (text) => `xpath/.//label[contains(., ${JSON.stringify(text)})]//input`
const nameValue = (page) => page.$eval(byLabel('Their full name'), (i) => i.value).catch(() => null)

try {
  const { data: program } = await admin.from('programs').insert({ academy_id: IW, name: `${TAG} Squad`, kind: 'squad', status: 'open', season: '2026', created_by: president.session.user.id, born_from_year: 2014, born_to_year: 2018 }).select('id').single()

  head('1. No account: saved on one phone, picked up on another with a code')
  let code = null
  {
    const { page, context } = await open(null, 'light')
    await waitFor(page, '[data-register-as]')
    await tap(await waitFor(page, `xpath/.//button[@aria-pressed and contains(., ${JSON.stringify(`${TAG} Squad`)})]`))
    await page.waitForSelector(byLabel('Their full name'), { timeout: 15000 })
    await page.type(byLabel('Their full name'), `${TAG} Child`, { delay: 5 })
    await page.$eval('input[type=date]', (el, v) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })) }, '2016-06-06')
    const save = await page.$('[data-save-draft]')
    if (!save) bad('no "Save and get a code"')
    else {
      await tap(save)
      const card = await page.waitForSelector('[data-resume-code]', { timeout: 20000 }).catch(() => null)
      code = card ? await card.evaluate((el) => el.getAttribute('data-resume-code')) : null
      if (code) codes.push(code)
      code && /^[A-Z2-9]{3}-[A-Z2-9]{3}$/.test(code) && (await fits(page)) ? ok(`saved: the code ${code}, 375px light`) : bad(`code ${code}`)
      const { data: row } = code ? await admin.from('registration_drafts').select('academy_id, profile_id, draft, expires_at').eq('code', code.replace('-', '')).maybeSingle() : { data: null }
      row && row.academy_id === IW && row.profile_id === null && row.draft?.childName === `${TAG} Child` && row.draft?.chosen === program.id && new Date(row.expires_at) > new Date(Date.now() + 13 * 864e5) ? ok('the draft row: the club, no account, the child and the program, fourteen days') : bad(`draft row ${JSON.stringify(row)?.slice(0, 200)}`)
      await shot(page, 'code-light')
    }
    await context.close()
  }
  if (code) {
    const { page, context } = await open(null, 'dark')
    await waitFor(page, '[data-register-as]')
    const before = await nameValue(page)
    await tap(await page.$('[data-resume-open]'))
    await page.waitForSelector('[data-resume-input]', { timeout: 10000 })
    await page.type('[data-resume-input]', code.toLowerCase(), { delay: 5 })
    await tap(await page.$('[data-resume-load]'))
    const name = await until(async () => { const v = await nameValue(page); return v === `${TAG} Child` ? v : null }, 20000)
    const pressed = await page.$eval(`xpath/.//button[@aria-pressed and contains(., ${JSON.stringify(`${TAG} Squad`)})]`, (b) => b.getAttribute('aria-pressed')).catch(() => null)
    const dob = await page.$eval('input[type=date]', (el) => el.value).catch(() => null)
    ;(before ?? '') === '' && name && pressed === 'true' && dob === '2016-06-06' ? ok('another phone, the code typed in lower case: the program, the child and the date of birth are back, 375px dark') : bad(`before "${before}", name "${name}", program pressed ${pressed}, dob ${dob}`)
    ;(await fits(page)) ? ok('375px dark fits') : bad('dark overflows')
    await shot(page, 'picked-up-dark')
    await context.close()
    const wrong = await open(null, 'light')
    await waitFor(wrong.page, '[data-register-as]')
    await tap(await wrong.page.$('[data-resume-open]'))
    await wrong.page.type('[data-resume-input]', 'ZZZ-999', { delay: 5 })
    await tap(await wrong.page.$('[data-resume-load]'))
    const err = await wrong.page.waitForSelector('[data-resume-error]', { timeout: 15000 }).catch(() => null)
    const text = err ? await err.evaluate((e) => e.textContent) : ''
    err && /No draft with that code/.test(text ?? '') ? ok('a wrong code: "No draft with that code"') : bad(`wrong code: ${text}`)
    await wrong.context.close()
  }

  head('2. Signed in: the draft follows the account')
  {
    const { page, context } = await open(parent, 'light')
    const mode = await waitFor(page, '[data-save-resume="account"]')
    mode ? ok('a signed-in parent is told the draft saves to their account') : bad(`save-resume mode: ${await page.$eval('[data-save-resume]', (e) => e.getAttribute('data-save-resume')).catch(() => 'absent')}`)
    await tap(await waitFor(page, `xpath/.//button[@aria-pressed and contains(., ${JSON.stringify(`${TAG} Squad`)})]`))
    await page.waitForSelector(byLabel('Their full name'), { timeout: 15000 })
    await page.type(byLabel('Their full name'), `${TAG} Signed`, { delay: 5 })
    const row = await until(async () => { const { data } = await admin.from('registration_drafts').select('draft').eq('academy_id', IW).eq('profile_id', parent.session.user.id).maybeSingle(); return data?.draft?.childName === `${TAG} Signed` ? data : null }, 20000)
    row ? ok('a moment after typing, the draft is on the account') : bad('no account draft')
    const synced = await page.waitForSelector('[data-draft-synced]', { timeout: 15000 }).catch(() => null)
    synced ? ok('and the page says so') : bad('no synced note')
    await shot(page, 'account-light')
    await context.close()
    const other = await open(parent, 'dark')
    const name = await until(async () => { const v = await nameValue(other.page); return v === `${TAG} Signed` ? v : null }, 30000)
    const pressed = await other.page.$eval(`xpath/.//button[@aria-pressed and contains(., ${JSON.stringify(`${TAG} Squad`)})]`, (b) => b.getAttribute('aria-pressed')).catch(() => null)
    name && pressed === 'true' ? ok('a second phone, signed in, with nothing in its browser: the draft is there, 375px dark') : bad(`other phone: name "${name}", program ${pressed}`)
    await shot(other.page, 'account-other-dark')
    await other.context.close()
    const { data: theirs } = await president.client.from('registration_drafts').select('id').eq('academy_id', IW)
    ;(theirs ?? []).length === 0 ? ok('the owner reads nobody\'s draft') : bad(`owner read ${theirs.length} drafts`)
  }
} catch (e) {
  bad(`threw: ${e.message}`)
} finally {
  await browser.close()
  await cleanup()
  const { count } = await admin.from('programs').select('id', { count: 'exact', head: true }).eq('academy_id', IW).like('name', `${TAG} %`)
  const { count: drafts } = await admin.from('registration_drafts').select('id', { count: 'exact', head: true }).eq('academy_id', IW).eq('profile_id', parent.session.user.id)
  count === 0 && drafts === 0 ? ok('everything made here is gone') : bad(`${count} programs, ${drafts} drafts left`)
}
console.log(process.exitCode ? '' : '\n  \x1b[32msave and resume: a code for a stranger, the account for the signed in, any phone\x1b[0m\n')
