// Run: node --env-file=.env.local scripts/shots.mjs [screen...]
//   (needs the app running — npm run dev)
//
// Screenshots every screen at 375px, in light and dark, signed in as whoever
// you ask for.
//
// CLAUDE.md has required this since the beginning — "check every new screen
// at 375px in light and dark" — and it has been the one rule nobody could
// follow from a terminal, so it was followed by reasoning about the CSS and
// hoping. The share cards settled that argument: rendering them and LOOKING
// caught four things no assertion would have, including a heading that
// contradicted the list underneath it.
//
// It drives the Chrome already on the machine through puppeteer-core, so
// there is no browser download and nothing to keep up to date. If Chrome is
// somewhere else, set CHROME.
import { createClient } from '@supabase/supabase-js'
import { mkdirSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const OUT = process.env.OUT ?? '.shots'
const CHROME =
  process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})
const anon = createClient(URL_, PUB, { auth: { persistSession: false } })

/** Who to look as. A parent and a coach see different screens. */
const WHO = process.env.AS ?? 'joeylameri@outlook.com'

// The phone this product is used on. 375 is the narrowest common iPhone and
// the width the rule names.
const WIDTH = 375
const HEIGHT = 812

const SCREENS = [
  ['home', '/'],
  ['calendar', '/calendar'],
  ['chat', '/chat'],
  ['directory', '/directory'],
  ['settings', '/settings'],
  ['admin', '/admin'],
  ['admin-teams', '/admin/teams'],
  ['admin-kit', '/admin/kit'],
  ['admin-clearances', '/admin/clearances'],
  ['admin-registrations', '/admin/registrations'],
  ['admin-import', '/admin/import'],
  ['register', '/nrifa/register'],
]

const wanted = process.argv.slice(2)
const screens = wanted.length
  ? SCREENS.filter(([name]) => wanted.some((w) => name.includes(w)))
  : SCREENS

const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email: WHO })
if (!link?.properties?.hashed_token) {
  console.log("  could not issue a magic link — the project's auth rate limit, not a failure")
  process.exit(2)
}
const { data: s } = await anon.auth.verifyOtp({
  token_hash: link.properties.hashed_token,
  type: 'email',
})
if (!s?.session) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}

const ref = URL_.split('//')[1].split('.')[0]
const cookie = {
  name: `sb-${ref}-auth-token`,
  value: 'base64-' + Buffer.from(JSON.stringify(s.session)).toString('base64'),
  domain: 'localhost',
  path: '/',
}

mkdirSync(OUT, { recursive: true })

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
})

console.log(`\n  ${WHO} · ${WIDTH}px · ${BASE}\n`)

for (const theme of ['light', 'dark']) {
  const page = await browser.newPage()
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 2 })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }])
  await page.setCookie(cookie)

  for (const [name, path] of screens) {
    try {
      await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 45000 })
      // `next dev` paints its own toolbar over the page. It is not part of
      // the product and it sat squarely on top of a fixture card in the
      // first screenshots taken with this.
      await page.addStyleTag({
        content: 'nextjs-portal, [data-nextjs-toolbar], #__next-build-watcher { display: none !important }',
      })
      // Every screen in this product paints a shell and then fetches. A
      // screenshot taken on load is a screenshot of a skeleton, which is
      // exactly the thing nobody needs to look at.
      await new Promise((r) => setTimeout(r, 2500))
      const file = `${OUT}/${name}-${theme}.png`
      // VIEWPORT=1 takes just the first screen, which is what you look at
      // to judge contrast and hierarchy — a full-page shot of a long list
      // scales down until nothing can be read.
      await page.screenshot({ path: file, fullPage: process.env.VIEWPORT !== '1' })
      console.log(`  ${theme.padEnd(6)} ${name.padEnd(22)} ${file}`)
    } catch (e) {
      console.log(`  ${theme.padEnd(6)} ${name.padEnd(22)} FAILED — ${e.message.slice(0, 70)}`)
    }
  }
  await page.close()
}

await browser.close()
console.log(`\n  ${OUT}\n`)
