// Run: node --env-file=.env.local scripts/sweep-screens.mjs [--base http://localhost:3000]
//
// The final sweep's screens pass (Joey, 24 Nov 2026): every demo role opens
// Home, Chat, Fixtures, Team, Admin and Settings at 375px wide, in light and
// in dark, and each page must answer 200, show no error text, and fit the
// phone (no sideways scroll). A screenshot of every page goes to
// .shots/sweep/ for a look. Demo accounts only (docs/DEMO.md); nothing is
// written.
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'
import { signInBoth } from './_auth.mjs'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const BASE = process.argv.includes('--base') ? process.argv[process.argv.indexOf('--base') + 1] : 'http://localhost:3000'
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ref = new URL(URL_).hostname.split('.')[0]
mkdirSync('.shots/sweep', { recursive: true })

const PEOPLE = [
  ['head', 'head@squadroom-demo.test', 'NRIFA owner'],
  ['organiser', 'organiser@squadroom-demo.test', 'League organiser'],
  ['marcus', 'p61400000002@squadroom.invalid', 'coach, NRIFA'],
  ['sam', 'p61400000011@squadroom.invalid', 'parent of two, NRIFA'],
  ['iw-president', 'iw.president@squadroom-demo.test', 'President'],
  ['iw-secretary', 'iw.secretary@squadroom-demo.test', 'Secretary'],
  ['iw-registrar', 'iw.registrar@squadroom-demo.test', 'Registrar'],
  ['iw-treasurer', 'iw.treasurer@squadroom-demo.test', 'Treasurer'],
  ['iw-coordinator', 'iw.coordinator@squadroom-demo.test', 'Coordinator'],
  ['iw-manager', 'iw.manager@squadroom-demo.test', 'Team manager'],
  ['iw-coach', 'iw.coach@squadroom-demo.test', 'Coach'],
  ['iw-parent', 'iw.parent@squadroom-demo.test', 'Parent of two'],
  ['iw-player', 'iw.player@squadroom-demo.test', 'Over-35s player'],
  ['iw-welfare', 'iw.welfare@squadroom-demo.test', 'Welfare officer'],
  ['iw-volunteers', 'iw.volunteers@squadroom-demo.test', 'Volunteer coordinator'],
]
const PAGES = ['/', '/chat', '/calendar', '/team', '/admin', '/settings']
const ERROR_TEXT = /couldn.t load|something went wrong|application error|unhandled runtime|internal server error|this page could not be found/i

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
const rows = []
let bad = 0
try {
  for (const [key, email, role] of PEOPLE) {
    const signed = await signInBoth(admin, email)
    if (!signed) { rows.push({ key, role, page: '*', theme: '*', result: 'could not sign in' }); bad++; continue }
    const { data: { session } } = await signed.client.auth.getSession()
    for (const theme of ['light', 'dark']) {
      const context = await browser.createBrowserContext()
      const page = await context.newPage()
      await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 1 })
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }])
      const errors = []
      page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 80)))
      await page.setCookie({ name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64'), domain: 'localhost', path: '/' })
      for (const path of PAGES) {
        const t0 = Date.now()
        errors.length = 0
        let result = 'ok'
        try {
          const res = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 45000 })
          await new Promise((r) => setTimeout(r, 400))
          const status = res?.status() ?? 0
          const { text, wide } = await page.evaluate(() => ({
            text: document.body.innerText.slice(0, 4000),
            wide: document.documentElement.scrollWidth > window.innerWidth + 1,
          }))
          const landed = new URL(page.url()).pathname
          if (status >= 400) result = `HTTP ${status}`
          else if (errors.length) result = `page error: ${errors[0]}`
          else if (ERROR_TEXT.test(text)) result = `error text: ${(ERROR_TEXT.exec(text) ?? [''])[0]}`
          else if (landed.startsWith('/signin')) result = 'sent to sign in'
          else if (wide) result = 'wider than 375px'
          else if (text.trim().length < 20) result = 'blank'
        } catch (e) {
          result = `failed: ${String(e.message).slice(0, 60)}`
        }
        await page.screenshot({ path: `.shots/sweep/${key}${path === '/' ? '-home' : path.replace(/\//g, '-')}-${theme}.png`, fullPage: true }).catch(() => null)
        if (result !== 'ok') bad++
        rows.push({ key, role, page: path, theme, result, ms: Date.now() - t0 })
      }
      await context.close()
    }
    const mine = rows.filter((r) => r.key === key)
    const wrong = mine.filter((r) => r.result !== 'ok')
    console.log(`  ${wrong.length ? '✗' : '✓'} ${role} (${key}): ${mine.length} pages${wrong.length ? ' — ' + wrong.map((w) => `${w.page} ${w.theme}: ${w.result}`).join('; ') : ''}`)
  }
} finally {
  await browser.close()
}
// The public match centre and a public game page, as a stranger.
{
  const b2 = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
  const page = await b2.newPage()
  await page.setViewport({ width: 375, height: 812 })
  for (const path of ['/c/spl-season-4', '/nrifa', '/nrifa/register']) {
    const res = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => null)
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1).catch(() => true)
    const text = await page.evaluate(() => document.body.innerText.slice(0, 2000)).catch(() => '')
    const result = !res || res.status() >= 400 ? `HTTP ${res?.status()}` : ERROR_TEXT.test(text) ? 'error text' : wide ? 'wider than 375px' : 'ok'
    if (result !== 'ok') bad++
    await page.screenshot({ path: `.shots/sweep/stranger${path.replace(/\//g, '-')}.png`, fullPage: true }).catch(() => null)
    console.log(`  ${result === 'ok' ? '✓' : '✗'} a stranger: ${path} ${result}`)
    rows.push({ key: 'stranger', role: 'stranger', page: path, theme: 'light', result })
  }
  await b2.close()
}
console.log(`\n${rows.length} page loads, ${bad} not right. Screenshots in .shots/sweep/`)
process.exitCode = bad ? 1 : 0
