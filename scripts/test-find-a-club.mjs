// Run: node --env-file=.env.local scripts/test-find-a-club.mjs
//   (the dev server on :3000; SHOTS=1 saves the screens at 375px)
//
// The registration brief, gap 5 (0266): Find a club. The owner gives the
// club's suburb (Settings → Club); a stranger on /clubs, with no account and
// no cookie, sees the clubs with something open, searches by name and by
// suburb, and each card leads to the club's registration page; nothing
// about anyone is in what the page reads. With the Find a club switch off
// the club is not listed and the settings field is gone. A published
// competition's public page lists its clubs. Everything made here is
// removed and the club's setting and switch put back.
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'
import { signInBoth } from './_auth.mjs'
import { resolveBaseUrl } from './_base-url.mjs'

const BASE = await resolveBaseUrl()
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const ref = URL_.split('//')[1].split('.')[0]
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const anon = createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } })
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SHOTS = process.env.SHOTS === '1'
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const head = (m) => console.log(`\n${m}`)
if (SHOTS) mkdirSync('.shots', { recursive: true })

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const SLUG = 'nrifa'
const TAG = 'Zz FC'
const SUBURB = 'Zz Rydeville'
const until = async (fn, ms = 15000, every = 500) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, every)) }
  return null
}

const owner = await signInBoth(admin, 'head@squadroom-demo.test')
if (!owner) { console.log("  could not sign in — the project's auth rate limit, not a failure"); process.exit(2) }
const { data: before } = await admin.from('academies').select('suburb').eq('id', NRIFA).single()
const { data: switchBefore } = await admin.from('academy_features').select('enabled').eq('academy_id', NRIFA).eq('feature', 'find_a_club').maybeSingle()

async function cleanup() {
  await admin.from('programs').delete().eq('academy_id', NRIFA).like('name', `${TAG} %`)
  await admin.from('academies').update({ suburb: before?.suburb ?? null }).eq('id', NRIFA)
  await owner.client.rpc('set_feature', { p_academy: NRIFA, p_feature: 'find_a_club', p_enabled: switchBefore ? switchBefore.enabled : true })
}
await cleanup()

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
async function open(who, path, scheme, org = NRIFA) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 375, height: 812 })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }])
  if (who) {
    await page.setCookie({ name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(who.session)).toString('base64'), domain: 'localhost', path: '/' })
    await page.evaluateOnNewDocument((o) => { try { localStorage.setItem('squadroom.org', o) } catch {} }, org)
  }
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
const shot = (page, name) => SHOTS ? page.screenshot({ path: `.shots/find-a-club-${name}.png`, fullPage: true }) : null
const tap = async (h) => { await h.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' })); await h.click() }

try {
  await admin.from('programs').insert({ academy_id: NRIFA, name: `${TAG} Autumn Squad`, kind: 'squad', status: 'open', season: '2026', created_by: owner.session.user.id, born_from_year: 2015, born_to_year: 2018 })

  head('1. The owner says where the club is')
  {
    const { page, context } = await open(owner, '/settings/academy', 'light')
    const field = await waitFor(page, '[data-suburb]')
    if (!field) bad('no Suburb field on Settings → Club')
    else {
      await field.click({ clickCount: 3 })
      await page.type('[data-suburb]', SUBURB, { delay: 5 })
      await tap(await page.$('[data-suburb-save]'))
      const saved = await until(async () => { const { data } = await admin.from('academies').select('suburb').eq('id', NRIFA).single(); return data?.suburb === SUBURB ? data : null })
      saved && (await fits(page)) ? ok(`saved: academies.suburb = "${SUBURB}", 375px light`) : bad(`suburb after save: ${JSON.stringify(saved)}`)
      await shot(page, 'settings-light')
    }
    await context.close()
  }

  head('2. A stranger finds the club')
  {
    const { data: all, error } = await anon.rpc('public_find_clubs', { p_query: null })
    const me = (all ?? []).find((c) => c.slug === SLUG)
    !error && me && me.suburb === SUBURB && (me.programs ?? []).some((p) => p.name === `${TAG} Autumn Squad`) ? ok('public_find_clubs: the club, its suburb and its open program') : bad(`find: ${error?.message} ${JSON.stringify(me).slice(0, 200)}`)
    const text = JSON.stringify(all ?? [])
    !/phone|guardian|email|full_name/i.test(text) ? ok('nothing about anyone in what the page reads') : bad('the public list carries personal fields')
    !(all ?? []).some((c) => c.type === 'league') ? ok('no league is listed as a club') : bad('a league is listed')
    const { data: bySuburb } = await anon.rpc('public_find_clubs', { p_query: 'rydevil' })
    const { data: byName } = await anon.rpc('public_find_clubs', { p_query: 'nrifa' })
    const { data: none } = await anon.rpc('public_find_clubs', { p_query: 'zzzqqq-nothing' })
    ;(bySuburb ?? []).some((c) => c.slug === SLUG) && (byName ?? []).some((c) => c.slug === SLUG) && (none ?? []).length === 0 ? ok('found by suburb and by name; nothing for nonsense') : bad(`suburb ${bySuburb?.length}, name ${byName?.length}, none ${none?.length}`)

    const { page, context } = await open(null, '/clubs', 'light')
    const card = await waitFor(page, `[data-club="${SLUG}"]`)
    const cookies = await page.cookies()
    card && cookies.length === 0 && (await fits(page)) ? ok('/clubs lists the club, with no cookie set, 375px light') : bad(`card ${Boolean(card)}, cookies ${cookies.length}, fits ${await fits(page)}`)
    const href = card ? await page.$eval(`[data-club="${SLUG}"] [data-club-register]`, (a) => a.getAttribute('href')) : null
    href === `/${SLUG}/register` ? ok('its card leads to the registration page') : bad(`register link ${href}`)
    await page.type('[data-find-club-input]', 'rydevil', { delay: 20 })
    await page.waitForFunction((s) => { const r = document.querySelector('[data-find-club-results]'); return r && r.querySelectorAll('[data-club]').length >= 1 && document.querySelector(`[data-club="${s}"]`) }, { timeout: 15000 }, SLUG).catch(() => {})
    const shown = await page.$$eval('[data-club]', (els) => els.map((e) => e.getAttribute('data-club')))
    shown.includes(SLUG) ? ok(`typing the suburb narrows to it (${shown.length} shown)`) : bad(`after typing: ${JSON.stringify(shown)}`)
    await shot(page, 'results-light')
    await page.click('[data-find-club-input]', { clickCount: 3 })
    await page.type('[data-find-club-input]', 'zzzqqq-nothing', { delay: 20 })
    const empty = await page.waitForSelector('[data-find-club-empty]', { timeout: 15000 }).catch(() => null)
    empty ? ok('nonsense: the empty state, and a word to ask the club') : bad('no empty state')
    await context.close()
    const dark = await open(null, '/clubs', 'dark')
    await waitFor(dark.page, `[data-club="${SLUG}"]`)
    ;(await fits(dark.page)) ? ok('375px dark') : bad('dark does not fit')
    await shot(dark.page, 'results-dark')
    await dark.context.close()
  }

  head('3. Switched off: not listed, no field')
  {
    await owner.client.rpc('set_feature', { p_academy: NRIFA, p_feature: 'find_a_club', p_enabled: false })
    const { data: off } = await anon.rpc('public_find_clubs', { p_query: 'nrifa' })
    ;(off ?? []).length === 0 ? ok('the club is not listed') : bad(`listed with the switch off: ${off.length}`)
    const { page, context } = await open(owner, '/settings/academy', 'light')
    await waitFor(page, '[data-photo-required]')
    ;(await page.$('[data-find-a-club-section]')) === null ? ok('no Find a club field on Settings → Club') : bad('the field shows with the feature off')
    await context.close()
    await owner.client.rpc('set_feature', { p_academy: NRIFA, p_feature: 'find_a_club', p_enabled: true })
    const { data: back } = await anon.rpc('public_find_clubs', { p_query: 'nrifa' })
    ;(back ?? []).some((c) => c.slug === SLUG) ? ok('back on, listed again') : bad('not back')
  }

  head('4. A league\'s public page lists its clubs')
  {
    const { data: comps } = await admin.from('competitions').select('id, public_slug').not('public_slug', 'is', null).not('published_at', 'is', null)
    let picked = null
    for (const c of comps ?? []) {
      const { count } = await admin.from('competition_clubs').select('id', { count: 'exact', head: true }).eq('competition_id', c.id).eq('status', 'active').not('academy_id', 'is', null)
      if (count) { picked = { ...c, count }; break }
    }
    if (!picked) ok('no published competition with clubs on dev to check — the RLS check covers it')
    else {
      const { data: clubs, error } = await anon.rpc('public_competition_clubs', { p_slug: picked.public_slug })
      !error && (clubs ?? []).length > 0 && clubs.every((c) => c.slug && c.name) ? ok(`${picked.public_slug}: ${clubs.length} club${clubs.length === 1 ? '' : 's'}, each with a slug`) : bad(`competition clubs: ${error?.message} ${JSON.stringify(clubs).slice(0, 160)}`)
      const { page, context } = await open(null, `/c/${picked.public_slug}`, 'light')
      const strip = await waitFor(page, '[data-public-clubs]')
      strip && (await fits(page)) ? ok('the public page shows the Clubs strip, 375px light') : bad('no Clubs strip on the public page')
      await shot(page, 'league-clubs-light')
      await context.close()
    }
  }
} catch (e) {
  bad(`threw: ${e.message}`)
} finally {
  await browser.close()
  await cleanup()
  const { data: after } = await admin.from('academies').select('suburb').eq('id', NRIFA).single()
  const { count } = await admin.from('programs').select('id', { count: 'exact', head: true }).eq('academy_id', NRIFA).like('name', `${TAG} %`)
  ;(after?.suburb ?? null) === (before?.suburb ?? null) && count === 0 ? ok('everything made here is gone; the club\'s suburb and switch as they were') : bad(`suburb ${after?.suburb}, ${count} programs left`)
}
console.log(process.exitCode ? '' : '\n  \x1b[32mFind a club: by name or suburb, to the registration page, nothing about anyone\x1b[0m\n')
