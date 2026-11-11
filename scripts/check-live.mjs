// Run: node --env-file=.env.local scripts/check-live.mjs [https://squadroom-dev.netlify.app]
//
// After a deploy: is the live site up, talking to the database, and showing
// a signed-in Home? Reads only. The public pages and the probe with plain
// requests; then the Inner West FC demo President's Home with a real session
// (a password sign-in through Supabase, the session handed to the live site
// as its cookie), at 375px, saved to .shots/live-home-president.png.
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'

const SITE = (process.argv[2] ?? process.env.NEXT_PUBLIC_SITE_URL_LIVE ?? 'https://squadroom-dev.netlify.app').replace(/\/$/, '')
const HOST = new URL(SITE).host
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const ref = URL_.split('//')[1].split('.')[0]
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PASSWORD = process.env.DEMO_PASSWORD ?? 'squadroom-demo'
const IW = '00000000-0000-0000-0000-0000000a0009'
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
mkdirSync('.shots', { recursive: true })

console.log(`\n${SITE}`)
for (const path of ['/', '/signin', '/api/probe']) {
  const t = Date.now()
  const res = await fetch(`${SITE}${path}`, { redirect: 'manual' }).catch((e) => ({ status: 0, text: async () => String(e) }))
  const body = await res.text()
  const ms = Date.now() - t
  res.status === 200 ? ok(`${path} ${res.status} in ${ms} ms${path === '/api/probe' ? ` — ${body.slice(0, 80)}` : ''}`) : bad(`${path} ${res.status} in ${ms} ms`)
}

const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { data: comp } = await admin.from('competitions').select('public_slug, name').not('published_at', 'is', null).not('public_slug', 'is', null).limit(1).maybeSingle()
if (comp) {
  const res = await fetch(`${SITE}/c/${comp.public_slug}`)
  const html = await res.text()
  res.status === 200 && html.includes(comp.name) ? ok(`the public match centre renders ${comp.name} from the database`) : bad(`/c/${comp.public_slug}: ${res.status}`)
}

const client = createClient(URL_, PUB, { auth: { persistSession: false, autoRefreshToken: false } })
const { data, error } = await client.auth.signInWithPassword({ email: 'iw.president@squadroom-demo.test', password: PASSWORD })
if (error || !data.session) {
  bad(`could not sign in as the demo President: ${error?.message ?? 'no session'}`)
} else {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 375, height: 812 })
    await page.setCookie({ name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(data.session)).toString('base64'), domain: HOST, path: '/', secure: true })
    await page.evaluateOnNewDocument((o) => { try { localStorage.setItem('squadroom.org', o) } catch {} }, IW)
    const t = Date.now()
    await page.goto(`${SITE}/`, { waitUntil: 'networkidle2', timeout: 90000 })
    // The jobs arrive after their own round trips; wait for them, not a guess.
    await page.waitForSelector('[data-persona]', { timeout: 20000 }).catch(() => {})
    const ms = Date.now() - t
    const styled = await page.evaluate(() => getComputedStyle(document.body).fontFamily !== '' && document.styleSheets.length > 0)
    styled ? ok('the page has its stylesheet') : bad('the page has no stylesheet — the HTML names assets that were not uploaded')
    const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))
    const persona = await page.$eval('[data-persona]', (el) => el.getAttribute('data-persona')).catch(() => null)
    const fits = await page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1)
    text.includes('Inner West FC') && persona && fits
      ? ok(`the President's Home on the live site in ${ms} ms — persona ${persona}, names the club, fits 375px (${text.length} chars)`)
      : bad(`the live Home: persona ${persona}, names the club ${text.includes('Inner West FC')}, fits ${fits}; ${text.slice(0, 120)}`)
    await page.screenshot({ path: '.shots/live-home-president.png', fullPage: true })
  } finally {
    await browser.close()
  }
}
console.log(process.exitCode ? '\n\x1b[31mTHE LIVE SITE IS NOT RIGHT\x1b[0m\n' : '\n\x1b[32mthe live site is up\x1b[0m\n')
