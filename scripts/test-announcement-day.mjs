// Run: node --env-file=.env.local scripts/test-announcement-day.mjs
//   (needs the app running — npm run dev, or serve:test)
//
// An announcement can say the day it is about (Joey, 4 Nov 2026; 0217):
// Home's card stops showing it after that day, as it stops at a fortnight.
// The composer offers the date only for an announcement; before 0217 is
// applied the announcement still goes, without it. test-rls and a local run
// (scripts/local-db) prove the database half: a dated announcement that has
// passed gives way to the one before it, and nothing but an announcement
// can carry a date.
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'
import { signInBoth } from './_auth.mjs'
import { resolveBaseUrl } from './_base-url.mjs'
import { purgeTestMessages } from './_purge-test-messages.mjs'

const BASE = await resolveBaseUrl()
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const ref = URL_.split('//')[1].split('.')[0]
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const note = (m) => console.log(`  \x1b[2m… ${m}\x1b[0m`)
const head = (m) => console.log(`\n${m}`)
const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const TAG = 'TEST:: aboutday'

const { error: no0217 } = await admin.from('messages').select('relevant_until').limit(1)
const has0217 = !no0217
const owner = await signInBoth(admin, 'joeylameri@outlook.com')
if (!owner) { console.log("  could not sign in — the project's auth rate limit, not a failure"); process.exit(2) }
const { data: chan } = await admin.from('channels').select('id').eq('academy_id', NRIFA).eq('type', 'academy_wide').single()
await purgeTestMessages(admin, [TAG])

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
try {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 375, height: 812 })
  await page.setCookie({ name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(owner.session)).toString('base64'), domain: 'localhost', path: '/' })
  await page.evaluateOnNewDocument((o) => { try { localStorage.setItem('squadroom.org', o) } catch {} }, NRIFA)
  await page.goto(`${BASE}/chat/${chan.id}`, { waitUntil: 'networkidle2', timeout: 90000 })

  head('1. The date is offered for an announcement, and only then')
  ;(await page.$('[data-about-day]')) ? bad('a date field before "Send as an announcement" is ticked') : ok('no date field on an ordinary message')
  const box = await page.$$eval('label', (ls) => {
    const l = ls.find((x) => x.textContent?.includes('Send as an announcement'))
    l?.querySelector('input')?.click()
    return Boolean(l)
  })
  box ? ok('"Send as an announcement" ticked') : bad('no announcement box for the owner')
  await page.waitForSelector('[data-about-day] input[type="date"]', { timeout: 5000 }).catch(() => null)
  ;(await page.$('[data-about-day] input[type="date"]')) ? ok('"About a day?" appears, with a date') : bad('no date field for an announcement')

  head('2. An announcement with a day goes')
  const tomorrow = new Date(Date.now() + 864e5).toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' })
  await page.$eval('[data-about-day] input[type="date"]', (el, v) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }, tomorrow)
  await page.type('textarea[aria-label="Message"]', `${TAG} Presentation day is tomorrow`)
  await page.$eval('button[aria-label="Send"]', (b) => b.click())
  let row = null
  for (let i = 0; i < 20 && !row; i++) {
    await new Promise((r) => setTimeout(r, 500))
    row = (await admin.from('messages').select('*').eq('channel_id', chan.id).like('body', `${TAG}%`).maybeSingle()).data
  }
  row?.is_announcement ? ok('posted as an announcement') : bad(`posted: ${JSON.stringify(row)?.slice(0, 160)}`)
  if (has0217) {
    const until = row?.relevant_until ? new Date(row.relevant_until).toLocaleString('en-AU', { timeZone: 'Australia/Sydney' }) : null
    until?.includes('11:59') ? ok(`and Home shows it until the end of tomorrow (${until})`) : bad(`relevant_until: ${row?.relevant_until}`)
  } else {
    note('the day itself is kept once 0217 is applied — until then the announcement goes without it, as it does here')
  }
  await context.close()
} finally {
  await browser.close()
  await purgeTestMessages(admin, [TAG])
}
console.log(process.exitCode ? '' : '\n  \x1b[32man announcement about a day stops being news after it\x1b[0m\n')
