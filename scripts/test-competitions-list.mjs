// Run: node --env-file=.env.local scripts/test-competitions-list.mjs
//   (needs the app running — npm run dev, or serve:test)
//
// The competitions a person can see are listed — on /competitions and on
// Home's Competitions card — with the league's name beside each. Found on
// 9 Nov 2026: both joined the organiser through a foreign-key hint that did
// not exist (`academies!competitions_organiser_id_fkey`), so PostgREST
// answered 400 and both screens quietly showed nothing, for everyone, and
// no suite looked. They join through the column now (`academies!organiser_id`);
// this looks.
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
const head = (m) => console.log(`\n${m}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const SPL_ORG = '00000000-0000-0000-0000-0000000a0003'

let leagueName = null
const league = await signInBoth(admin, 'p61400000301@squadroom.invalid') // the SPL's owner
const sam = await signInBoth(admin, 'p61400000011@squadroom.invalid') // a parent at NRIFA, which is in the SPL
if (!league || !sam) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}

head('1. The query the screens make answers, with the organiser beside each competition')
{
  const { data, error } = await sam.client.from('competitions').select('id, name, season, status, academies!organiser_id(name)').neq('status', 'ended').limit(10)
  !error && (data ?? []).length >= 1 ? ok(`a parent reads ${data.length} competition(s), each with its league`) : bad(`parent: ${error?.message ?? 'no rows'}`)
  const spl = (data ?? []).find((c) => c.name === 'SPL Season 3')
  spl ? ok('SPL Season 3 is among them') : bad(`SPL Season 3 missing from ${JSON.stringify((data ?? []).map((c) => c.name))}`)
  // The league's own row is withheld from another club's parent by policy
  // (the organiser's people are not the competition's); the competition's
  // own `organiser` text names it for them. Either is the league's name.
  const { data: named } = await sam.client.from('competitions').select('organiser, academies!organiser_id(name)').eq('name', 'SPL Season 3').maybeSingle()
  const rel = Array.isArray(named?.academies) ? named.academies[0] : named?.academies
  leagueName = rel?.name ?? named?.organiser ?? null
  leagueName ? ok(`a parent sees it is run by "${leagueName}"`) : console.log('  \x1b[2m… the league\'s row is withheld from a parent and the competition carries no organiser text — the list shows the competition alone\x1b[0m')
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
async function open(who, path, org, waitFor) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 375, height: 812 })
  await page.setCookie({ name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(who.session)).toString('base64'), domain: 'localhost', path: '/' })
  await page.evaluateOnNewDocument((o) => { try { localStorage.setItem('squadroom.org', o) } catch {} }, org)
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 90000 })
  if (waitFor) await page.waitForSelector(waitFor, { timeout: 20000 }).catch(() => null)
  await sleep(300)
  return { context, page }
}

try {
  head('2. /competitions lists them')
  {
    const { context, page } = await open(sam, '/competitions', NRIFA, 'a[href^="/competitions/"]')
    const links = await page.$$eval('a[href^="/competitions/"]', (as) => as.map((a) => a.textContent?.replace(/\s+/g, ' ').trim() ?? ''))
    const spl = links.find((t) => t.includes('SPL Season 3'))
    links.length >= 1 ? ok(`${links.length} competition row(s) for a parent whose club is entered`) : bad('an empty competitions list')
    const named = spl && (!leagueName || spl.includes(leagueName))
    named ? ok(leagueName ? `SPL Season 3, run by ${leagueName}` : 'SPL Season 3 is listed') : bad(`SPL row: ${spl ?? 'missing'} (expected "${leagueName}")`)
    const fits = await page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1)
    fits ? ok('fits 375px') : bad('wider than the phone')
    await context.close()
  }

  head("3. Home's Competitions card, for the league's owner")
  {
    const { context, page } = await open(league, '/', SPL_ORG, '[data-home-competitions]')
    const card = await page.$eval('[data-home-competitions]', (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '')
    card.includes('SPL Season 3') ? ok('the card names SPL Season 3') : bad(`card: ${card.slice(0, 160) || 'missing'} — ${await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 160))}`)
    ;/Sydney Premier League/.test(card) ? ok('and who runs it') : bad(`no organiser in: ${card.slice(0, 160)}`)
    await context.close()
  }
} finally {
  await browser.close()
}
console.log(process.exitCode ? '' : '\n  \x1b[32mthe competitions are listed, with their leagues\x1b[0m\n')
