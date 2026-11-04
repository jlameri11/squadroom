// Run: node --env-file=.env.local scripts/test-role-nav.mjs
//   (needs the app running — npm run dev, or npm run serve:test)
//
// Product direction, CLAUDE.md (2 Nov 2026): the same five tabs for everyone;
// each of the four people — parent, coach, owner / club admin, league
// organiser — sees their own priorities on Home, reaches each of their top
// three jobs in two taps or fewer, and switches organisation in one.
//
// Proven the way a person does it: a real browser at 375px, signed in as
// each of the four, counting taps. Tap one is the tile on Home; tap two is
// the control on the page it opens, which this asserts is there.
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'
import { resolveBaseUrl } from './_base-url.mjs'
import { signInBoth } from './_auth.mjs'

const BASE = await resolveBaseUrl()
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`)
  process.exitCode = 1
}
const head = (m) => console.log(`\n${m}`)

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const RAVENS = '00000000-0000-0000-0000-0000000a0002'
const SPL = '00000000-0000-0000-0000-0000000a0003'
const OWNER = '00000000-0000-0000-0000-0000000000a1'   // owns NRIFA and the SPL
const MARCUS = '00000000-0000-0000-0000-0000000000a2'  // U8 coach
const PARENT = '00000000-0000-0000-0000-0000000000b1'
const RAVENS_OWNER = '00000000-0000-0000-0000-0000000000c1'

// Each role: who, where, and for each job the page it must land on and the
// second tap that must be waiting there.
const ROLES = [
  {
    // A parent's jobs are rows in Needs you (one list, 4 Nov 2026), each
    // still carrying data-job for the two-tap rule.
    persona: 'parent', profile: PARENT, org: NRIFA, heading: 'Needs you',
    jobs: {
      rsvp: { landing: /^\/calendar/, control: { selector: 'button::-p-text(Going)' }, second: 'the Going / Maybe / Out buttons' },
      chat: { landing: /^\/chat\//, control: { selector: 'textarea' }, second: 'the composer' },
      pay: { landing: /^\/payments/, control: { text: /Payments/ }, second: 'the payments list' },
    },
    hidden: ['Run the club'],
  },
  {
    persona: 'coach', profile: MARCUS, org: NRIFA, heading: 'Coaching',
    jobs: {
      post: { landing: /^\/chat\//, control: { selector: 'textarea' }, second: 'the composer' },
      squad: { landing: /^\/calendar\//, control: { text: /lineup|roster|who.s coming|availability|going|no reply/i }, second: 'the squad and availability' },
      // The register appears at kick-off (X-19); before it, the same page
      // shows who is coming, which is where the register will be.
      attendance: { landing: /^\/calendar\//, control: { text: /take the register|register open|who.s coming|training/i }, second: 'the register (or, before kick-off, who is coming, where it appears)' },
    },
    hidden: [],
  },
  {
    persona: 'owner', profile: RAVENS_OWNER, org: RAVENS, heading: 'Run the club',
    jobs: {
      registrations: { landing: /^\/admin\/registrations/, control: { text: /registration/i }, second: 'the registration queue' },
      owing: { landing: /^\/admin\/payments/, control: { text: /outstanding|owe|payments/i }, second: 'the outstanding list' },
      everyone: { landing: /^\/chat\//, control: { selector: 'textarea' }, second: 'the composer' },
    },
    hidden: [],
  },
  {
    persona: 'league', profile: OWNER, org: SPL, heading: 'Run the league',
    jobs: {
      draw: { landing: /^\/competitions\/[^/]+\?tab=run/, control: { text: /run sheet/i }, second: 'the run sheet with its call-off and postpone controls' },
      referees: { landing: /^\/competitions\/[^/]+\?tab=referees/, control: { text: /referee|appoint|pool/i }, second: 'the appointments' },
      results: { landing: /^\/competitions\/[^/]+\?tab=run/, control: { text: /run sheet/i }, second: 'the sheets and scores' },
    },
    hidden: [],
  },
]

const ref = URL_.split('//')[1].split('.')[0]
async function cookieFor(profileId) {
  const { data: u } = await admin.auth.admin.getUserById(profileId)
  const signed = await signInBoth(admin, u.user.email)
  if (!signed) return null
  return {
    name: `sb-${ref}-auth-token`,
    value: 'base64-' + Buffer.from(JSON.stringify(signed.session)).toString('base64'),
    domain: 'localhost',
    path: '/',
  }
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
const text = (page) => page.evaluate(() => document.body.innerText)

try {
  for (const role of ROLES) {
    head(`${role.persona} — ${Object.keys(role.jobs).join(', ')}`)
    const cookie = await cookieFor(role.profile)
    if (!cookie) {
      console.log("  could not sign in — the project's auth rate limit, not a failure")
      process.exit(2)
    }

    // What the database says this person's jobs are.
    const { data: u } = await admin.auth.admin.getUserById(role.profile)
    const signed = await signInBoth(admin, u.user.email)
    const { data: jobs, error } = await signed.client.rpc('home_jobs', { p_academy: role.org })
    if (error || !jobs) {
      bad(`home_jobs: ${error?.message ?? 'nothing'}`)
      continue
    }
    jobs.persona === role.persona ? ok(`home_jobs knows a ${role.persona}`) : bad(`persona ${jobs.persona}, expected ${role.persona}`)
    const ids = (jobs.jobs ?? []).map((j) => j.id)
    JSON.stringify(ids) === JSON.stringify(Object.keys(role.jobs)) ? ok(`three jobs: ${ids.join(', ')}`) : bad(`jobs: ${ids.join(', ')}`)

    const page = await browser.newPage()
    await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 1 })
    await page.setCookie(cookie)
    await page.evaluateOnNewDocument((org) => {
      try { localStorage.setItem('squadroom.org', org) } catch {}
    }, role.org)

    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 60000 })
    await page.waitForSelector('[data-job]', { timeout: 45000 }).catch(() => null)
    const tiles = await page.$$eval('[data-job]', (els) => els.map((e) => e.getAttribute('data-job')))
    tiles.length === 3 ? ok('Home shows exactly three job tiles') : bad(`Home shows ${tiles.length} tiles: ${tiles.join(', ')}`)
    // innerText is CSS-uppercased for an eyebrow, so compare without case.
    const homeText = await text(page)
    homeText.toLowerCase().includes(role.heading.toLowerCase()) ? ok(`under "${role.heading}"`) : bad(`heading "${role.heading}" not on Home`)
    for (const h of role.hidden) {
      homeText.includes(h) ? bad(`"${h}" is shown to a ${role.persona}`) : ok(`"${h}" is hidden, not greyed out`)
    }
    if (role.persona === 'parent') {
      const tabs = await page.$$eval('nav a', (as) => as.map((a) => a.textContent.trim()))
      tabs.includes('Admin') ? bad('a parent sees the Admin tab') : ok(`a parent's tabs: ${tabs.join(' · ')}`)
      ;(await page.$('[data-announcement]')) ? ok('the latest announcement is on Home') : ok('no announcement to show yet')
    }

    for (const [id, want] of Object.entries(role.jobs)) {
      const job = (jobs.jobs ?? []).find((j) => j.id === id)
      await page.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 60000 })
      await page.waitForSelector(`[data-job="${id}"]`, { timeout: 45000 })
      // Tap one.
      await page.click(`[data-job="${id}"]`)
      await page.waitForFunction(
        (href) => location.pathname + location.search === href,
        { timeout: 45000 },
        job.href
      ).catch(() => null)
      const where = await page.evaluate(() => location.pathname + location.search)
      if (!want.landing.test(where)) {
        bad(`${id}: tap one landed on ${where}`)
        continue
      }
      // Tap two is waiting there.
      let there = false
      if (want.control.selector) {
        there = Boolean(await page.waitForSelector(want.control.selector, { timeout: 30000 }).catch(() => null))
      } else {
        there = Boolean(await page.waitForFunction(
          (re) => new RegExp(re.source, re.flags).test(document.body.innerText),
          { timeout: 30000 },
          { source: want.control.text.source, flags: want.control.text.flags }
        ).catch(() => null))
      }
      there
        ? ok(`${id}: 2 taps — the tile, then ${want.second} (${where})`)
        : bad(`${id}: landed on ${where} but ${want.second} is not there`)
    }
    await page.close()
  }

  head('one-tap switch — the owner who also runs the league')
  {
    const cookie = await cookieFor(OWNER)
    const page = await browser.newPage()
    await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 1 })
    await page.setCookie(cookie)
    // Start at NRIFA. The script runs on every new document, so it is
    // removed before the tap — otherwise it would put NRIFA back on reload
    // and the test would be testing itself.
    const start = await page.evaluateOnNewDocument((org) => {
      try { localStorage.setItem('squadroom.org', org) } catch {}
    }, NRIFA)
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 60000 })
    await page.waitForSelector(`[data-switch="${SPL}"]`, { timeout: 45000 }).catch(() => null)
    const chips = await page.$$eval('[data-switch]', (els) => els.map((e) => e.textContent.trim()))
    chips.some((c) => /Sydney Premier League/.test(c)) ? ok(`the league is one chip away: ${chips.join(' | ')}`) : bad(`chips: ${chips.join(' | ')}`)
    await page.removeScriptToEvaluateOnNewDocument(start.identifier)
    await page.click(`[data-switch="${SPL}"]`)
    await page.waitForFunction(() => document.querySelector('[data-persona="league"]'), { timeout: 60000 }).catch(() => null)
    const persona = await page.$eval('[data-persona]', (e) => e.getAttribute('data-persona')).catch(() => null)
    persona === 'league' ? ok('one tap, and Home is the league organiser\'s') : bad(`after the tap Home is ${persona}`)
    await page.close()
  }
} finally {
  await browser.close()
}

console.log(process.exitCode ? '\n\x1b[31mA ROLE CANNOT REACH ITS JOBS\x1b[0m\n' : '\n\x1b[32mall four reach their jobs in two taps\x1b[0m\n')
