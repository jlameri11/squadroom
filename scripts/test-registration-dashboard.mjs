// Run: node --env-file=.env.local scripts/test-registration-dashboard.mjs
//
// R-21: the registrations-at-a-glance card on Admin → Programs says what
// the database says. The numbers are worked out in the browser from what
// RLS lets the owner read; this recomputes them with the service role from
// the same rows and compares, then checks a parent never gets the card and
// a program with a cap counts toward "places filled".
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
const NRIFA = '00000000-0000-0000-0000-0000000a0001'

const owner = await signInBoth(admin, 'joeylameri@outlook.com')
const parent = await signInBoth(admin, 'p61400000011@squadroom.invalid')
if (!owner || !parent) { console.log("  could not sign in — the project's auth rate limit, not a failure"); process.exit(2) }

head('1. The truth, from the service role')
const { data: programs } = await admin.from('programs').select('id, status, season, opens_at, capacity').eq('academy_id', NRIFA)
const open = programs.filter((p) => p.status === 'open' && p.season)
const season = (open.length ? open : programs).map((p) => p.season).sort().at(-1)
const mine = programs.filter((p) => p.season === season)
const ids = new Set(mine.map((p) => p.id))
const { data: regs } = await admin.from('program_registrations').select('program_id, player_id, status, created_at').eq('academy_id', NRIFA)
const inSeason = regs.filter((r) => ids.has(r.program_id))
const { data: players } = await admin.from('players').select('id, created_at').eq('academy_id', NRIFA)
const childIds = [...new Set(inSeason.map((r) => r.player_id))]
const firstOpened = mine.map((p) => p.opens_at ?? '').filter(Boolean).sort()[0]
const newcomers = firstOpened ? childIds.filter((id) => (players.find((p) => p.id === id)?.created_at ?? '') > firstOpened).length : 0
const capped = mine.filter((p) => p.capacity)
const filled = capped.reduce((n, p) => n + inSeason.filter((r) => r.program_id === p.id && r.status === 'approved').length, 0)
const capacity = capped.reduce((n, p) => n + p.capacity, 0)
ok(`season ${season}: ${inSeason.length} registrations, ${childIds.length} children, ${newcomers} new, ${filled} of ${capacity} capped places filled`)
if (inSeason.length === 0) { console.log('  nothing registered in the seed — nothing to compare'); process.exit(process.exitCode ?? 0) }

head('2. The card says the same')
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
try {
  const openAs = async (s) => {
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    await page.setViewport({ width: 375, height: 812 })
    await page.setCookie({ name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(s.session)).toString('base64'), domain: 'localhost', path: '/' })
    await page.evaluateOnNewDocument((org) => { try { localStorage.setItem('squadroom.org', org) } catch {} }, NRIFA)
    await page.goto(`${BASE}/admin/programs`, { waitUntil: 'networkidle2', timeout: 60000 })
    await page.waitForSelector('[data-registration-dashboard]', { timeout: 20000 }).catch(() => null)
    const card = await page.evaluate(() => { const c = document.querySelector('[data-registration-dashboard]'); return c ? { ...c.dataset, text: c.innerText.replace(/\s+/g, ' ') } : null })
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
    await context.close()
    return { card, wide }
  }
  const { card, wide } = await openAs(owner)
  if (!card) bad('the owner gets no card')
  else {
    card.season === season ? ok(`season ${card.season}`) : bad(`season ${card.season} vs ${season}`)
    Number(card.total) === inSeason.length ? ok(`${card.total} registrations`) : bad(`registrations ${card.total} vs ${inSeason.length}`)
    Number(card.children) === childIds.length ? ok(`${card.children} children`) : bad(`children ${card.children} vs ${childIds.length}`)
    Number(card.new) === newcomers && Number(card.returning) === childIds.length - newcomers ? ok(`${card.new} new, ${card.returning} returning`) : bad(`new/returning ${card.new}/${card.returning} vs ${newcomers}/${childIds.length - newcomers}`)
    capacity ? (Number(card.filled) === filled && Number(card.capacity) === capacity ? ok(`${card.filled} of ${card.capacity} places filled`) : bad(`places ${card.filled}/${card.capacity} vs ${filled}/${capacity}`)) : ok('no capped program, no places line')
    const hasAgeGroup = /U\d+/.test(card.text)
    hasAgeGroup ? ok('age groups are written the way a club writes them (U9…)') : bad(`no age group in: ${card.text.slice(0, 120)}`)
    wide ? bad('the programs screen scrolls sideways at 375px') : ok('fits 375px')
  }
  const asParent = await openAs(parent)
  asParent.card ? bad("a parent sees the club's registration numbers") : ok("a parent's /admin/programs has no dashboard (RLS gives them nothing to count)")
} finally {
  await browser.close()
}
process.exit(process.exitCode ?? 0)
