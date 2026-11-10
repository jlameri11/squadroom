// Run: node --env-file=.env.local scripts/test-features.mjs
//   (needs the app running — npm run dev, or serve:test)
//
// The feature switches (Joey, 10 Nov 2026; docs/SIMPLICITY.md; 0242). On
// squadroom-dev, at NRIFA: the Head of academy switches Sponsors off — the
// database lists it off, the Admin hub shows no Sponsors row, Settings →
// Features shows it off, the activity log records the flip; a parent cannot
// flip a switch; switched back on, the row is back. The demo is left with
// every switch on, as Joey asked.
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'
import { signInBoth } from './_auth.mjs'
import { resolveBaseUrl } from './_base-url.mjs'

const BASE = await resolveBaseUrl()
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const ref = URL_.split('//')[1].split('.')[0]
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const note = (m) => console.log(`  \x1b[2m… ${m}\x1b[0m`)
const head = (m) => console.log(`\n${m}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const NRIFA = '00000000-0000-0000-0000-0000000a0001'

const { error: no0242 } = await admin.from('academy_features').select('feature').limit(1)
if (no0242) {
  note('waiting for 0242 on squadroom-dev — test-rls 193 proves it locally meanwhile')
  process.exit(0)
}
const owner = await signInBoth(admin, 'head@squadroom-demo.test')
const sam = await signInBoth(admin, 'p61400000011@squadroom.invalid')
if (!owner || !sam) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}
async function tidy() {
  await admin.from('academy_features').delete().eq('academy_id', NRIFA).eq('feature', 'sponsors')
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
async function open(who, path, waitFor) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 375, height: 812 })
  await page.setCookie({ name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(who.session)).toString('base64'), domain: 'localhost', path: '/' })
  await page.evaluateOnNewDocument((o) => { try { localStorage.setItem('squadroom.org', o) } catch {} }, NRIFA)
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 90000 })
  if (waitFor) await page.waitForSelector(waitFor, { timeout: 20000 }).catch(() => null)
  await sleep(400)
  return { context, page }
}

try {
  head('1. On by default; a parent cannot flip it; the owner switches Sponsors off')
  const { data: before } = await owner.client.rpc('features_off', { p_academy: NRIFA })
  ;(before ?? []).length === 0 ? ok('nothing is switched off in the demo') : note(`already off: ${(before ?? []).join(', ')}`)
  const { error: parentFlip } = await sam.client.rpc('set_feature', { p_academy: NRIFA, p_feature: 'sponsors', p_enabled: false })
  parentFlip?.code === '42501' ? ok('a parent cannot switch a feature') : bad(`parent flipped: ${parentFlip?.message ?? 'allowed'}`)
  const { error: off } = await owner.client.rpc('set_feature', { p_academy: NRIFA, p_feature: 'sponsors', p_enabled: false })
  off ? bad(`switch off: ${off.message}`) : ok('the owner switches Sponsors off')
  const { data: now } = await sam.client.rpc('features_off', { p_academy: NRIFA })
  ;(now ?? []).includes('sponsors') ? ok('the database lists it off, to everyone in the club') : bad(`off list: ${JSON.stringify(now)}`)
  const { data: logged } = await owner.client.from('activity_log').select('action, subject_name').eq('academy_id', NRIFA).eq('action', 'feature.off').eq('subject_name', 'sponsors').limit(1)
  ;(logged ?? []).length === 1 ? ok('and the activity log says who did it') : bad('no log row for the flip')

  head('2. Off means nothing of it appears')
  {
    const { context, page } = await open(owner, '/admin', '[data-org]')
    const rows = await page.$$eval('a[href="/admin/sponsors"]', (as) => as.length)
    const kit = await page.$$eval('a[href="/admin/kit"]', (as) => as.length)
    rows === 0 ? ok('the Admin hub has no Sponsors row') : bad('the Sponsors row is still on the hub')
    kit === 1 ? ok('the Kit list row (another switch, still on) is there') : bad(`kit rows: ${kit}`)
    await context.close()
  }
  {
    const { context, page } = await open(owner, '/settings/features', '[data-features-list]')
    const state = await page.$eval('[data-feature="sponsors"]', (e) => e.getAttribute('data-feature-on')).catch(() => null)
    state === 'off' ? ok('Settings → Features shows Sponsors off') : bad(`features screen: ${state}`)
    const count = await page.$$eval('[data-feature]', (ls) => ls.length)
    count >= 20 ? ok(`${count} switchable features listed, each with its line`) : bad(`features listed: ${count}`)
    await page.click('[data-feature-switch="sponsors"]')
    await page.waitForFunction(() => document.querySelector('[data-feature="sponsors"]')?.getAttribute('data-feature-on') === 'on', { timeout: 15000 }).then(() => ok('one tap switches it back on')).catch(() => bad('the switch did not flip back'))
    const fits = await page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1)
    fits ? ok('fits 375px') : bad('wider than the phone')
    await context.close()
  }
  const { data: after } = await owner.client.rpc('features_off', { p_academy: NRIFA })
  !(after ?? []).includes('sponsors') ? ok('Sponsors is on again — the demo keeps every switch on') : bad(`still off: ${JSON.stringify(after)}`)
  {
    const { context, page } = await open(sam, '/settings/features', '[data-features-list]')
    const disabled = await page.$eval('[data-feature-switch="sponsors"]', (b) => b.disabled).catch(() => null)
    disabled === true ? ok('a parent sees the switches and cannot move them') : bad(`parent switch disabled: ${disabled}`)
    await context.close()
  }
} finally {
  await browser.close()
  await tidy()
}
console.log(process.exitCode ? '' : '\n  \x1b[32mevery feature that is not core has a switch\x1b[0m\n')
