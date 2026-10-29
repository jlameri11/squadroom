// Run: node --env-file=.env.local scripts/test-screens.mjs [screen...]
//   (needs the app running — npm run dev — and Chrome installed)
//
// Loads every screen at 375px in light AND dark and checks the two things
// that have actually gone wrong, repeatedly, and that no other test in this
// repo can see.
//
// CONTRAST. `--brand` is replaced at runtime with whatever colour a club
// picked and was never redefined for dark, so on a near-black ground the
// match times vanished from the fixtures list, the current tab was
// unreadable on every screen, and "Import a draw" disappeared into its own
// background. Each one was found by a human looking at a picture. A rule
// that only holds while somebody remembers to look is not a rule.
//
// OVERFLOW. CLAUDE.md requires 375px and nothing enforced it. A table, a
// long venue name or a row of chips that pushes the page sideways is
// invisible on a desktop and ruins the screen on the phone this product is
// used on.
//
// It deliberately does NOT judge whether a screen looks good. That needs an
// eye, and a test pretending otherwise would pass while the page was a mess.
// It catches the mechanical failures so the eye is spent on the rest.
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'
import { resolveBaseUrl } from './_base-url.mjs'

const BASE = await resolveBaseUrl()
const CHROME =
  process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const WIDTH = 375

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})
const anon = createClient(URL_, PUB, { auth: { persistSession: false } })

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`)
  process.exitCode = 1
}
const head = (m) => console.log(`\n${m}`)

const SCREENS = [
  ['home', '/'],
  ['calendar', '/calendar'],
  ['chat', '/chat'],
  ['directory', '/directory'],
  ['settings', '/settings'],
  ['settings/family', '/settings/family'],
  ['admin', '/admin'],
  ['admin/teams', '/admin/teams'],
  ['admin/kit', '/admin/kit'],
  ['admin/clearances', '/admin/clearances'],
  ['admin/registrations', '/admin/registrations'],
  ['admin/import', '/admin/import'],
  ['register', '/nrifa/register'],
  ['academy', '/nrifa'],
]

const wanted = process.argv.slice(2)
const screens = wanted.length
  ? SCREENS.filter(([name]) => wanted.some((w) => name.includes(w)))
  : SCREENS

const { data: link } = await admin.auth.admin.generateLink({
  type: 'magiclink',
  email: 'joeylameri@outlook.com',
})
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

let browser
try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  })
} catch (e) {
  console.log(`  no Chrome at ${CHROME} — set CHROME to its path. Skipping.`)
  console.log(`  (${e.message.slice(0, 80)})`)
  process.exit(2)
}

/**
 * Runs INSIDE the page.
 *
 * Walks every element that draws its own text and compares its colour
 * against the first ancestor that actually paints a background — which is
 * the thing a naive check gets wrong, because most elements are transparent
 * and report rgba(0,0,0,0).
 */
const inspect = () => {
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/)
    if (!m) return null
    const [r, g, b, a = '1'] = m[1].split(',').map((v) => parseFloat(v))
    return { r, g, b, a }
  }
  const lum = ({ r, g, b }) => {
    const f = (v) => {
      const c = v / 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const contrast = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
    return (x + 0.05) / (y + 0.05)
  }

  const backdrop = (el) => {
    let node = el
    while (node && node !== document.documentElement) {
      const bg = parse(getComputedStyle(node).backgroundColor)
      if (bg && bg.a > 0.5) return bg
      node = node.parentElement
    }
    return parse(getComputedStyle(document.body).backgroundColor) ?? { r: 255, g: 255, b: 255, a: 1 }
  }

  const problems = []
  for (const el of document.querySelectorAll('body *')) {
    // Only elements that draw their OWN text, so a wrapper is not blamed for
    // its child's colour.
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
    if (!own) continue

    const style = getComputedStyle(el)
    if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue

    const box = el.getBoundingClientRect()
    if (box.width < 4 || box.height < 4) continue

    const fg = parse(style.color)
    if (!fg || fg.a < 0.5) continue

    const ratio = contrast(fg, backdrop(el))
    const size = parseFloat(style.fontSize)
    const bold = parseInt(style.fontWeight, 10) >= 600
    // WCAG's large-text threshold: 24px, or 18.66px when bold. Below 3:1 is
    // not "a bit low" — it is the colour having disappeared.
    const large = size >= 24 || (bold && size >= 18.66)
    const floor = large ? 2.6 : 3

    if (ratio < floor) {
      problems.push({
        text: (el.textContent ?? '').trim().slice(0, 48),
        ratio: Math.round(ratio * 100) / 100,
        color: style.color,
        size,
      })
    }
  }

  return {
    // A 1px tolerance: sub-pixel layout rounding is not a sideways page.
    overflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth - 1),
    widest: [...document.querySelectorAll('body *')]
      .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
      .slice(0, 3)
      .map((el) => `${el.tagName.toLowerCase()}.${(el.className || '').toString().slice(0, 30)}`),
    problems: problems.slice(0, 6),
  }
}

for (const theme of ['light', 'dark']) {
  head(`${theme} · ${WIDTH}px`)
  const page = await browser.newPage()
  await page.setViewport({ width: WIDTH, height: 812, deviceScaleFactor: 1 })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }])
  await page.setCookie(cookie)

  for (const [name, path] of screens) {
    try {
      const response = await page.goto(`${BASE}${path}`, {
        waitUntil: 'networkidle2',
        timeout: 45000,
      })
      // An error page is not a screen. "Internal Server Error" in the
      // default font passed the dark-mode contrast check once, and the
      // suite reported a 500 as a readable page.
      if (response && response.status() >= 400) {
        bad(`${name}: HTTP ${response.status()}`)
        continue
      }
      // `next dev` paints its own toolbar over the page, and it would be
      // reported as somebody else's contrast problem.
      await page.addStyleTag({
        content:
          'nextjs-portal, [data-nextjs-toolbar], #__next-build-watcher { display: none !important }',
      })
      // Every screen paints a shell and then fetches. Checking on load is
      // checking a skeleton.
      await new Promise((r) => setTimeout(r, 2500))

      const result = await page.evaluate(inspect)

      if (result.overflow > 0) {
        bad(`${name}: ${result.overflow}px wider than the phone — ${result.widest.join(', ')}`)
      } else if (result.problems.length > 0) {
        bad(
          `${name}: ${result.problems.length} unreadable — ` +
            result.problems
              .map((p) => `"${p.text}" ${p.ratio}:1 ${p.color}`)
              .join(' · ')
        )
      } else {
        ok(name)
      }
    } catch (e) {
      bad(`${name}: ${e.message.slice(0, 70)}`)
    }
  }

  await page.close()
}

await browser.close()
console.log(
  process.exitCode
    ? '\n\x1b[31mSOME SCREENS ARE UNREADABLE OR TOO WIDE\x1b[0m\n'
    : '\n\x1b[32mEVERY SCREEN FITS AND READS\x1b[0m\n'
)
