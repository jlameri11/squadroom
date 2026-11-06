// Run: node --env-file=.env.local scripts/test-text-size.mjs
//   (needs the app running — npm run dev, or serve:test after a build)
//
// X-10, Dynamic Type: the phone's text-size setting reaches every word in
// the product. Three ways it could quietly stop doing so, each checked:
//
//   1. A size written in px. It ignores the root, so it ignores the phone.
//      Checked in the source, so the next one is caught when it is written.
//   2. Something pinning the root. Chrome on Android scales the root's
//      initial size once the page opts in (the text-scale meta tag); a
//      font-size on html or :root, even a clamp, would undo it. Checked by
//      changing the browser's default size and watching the root follow.
//   3. The iPhone script (lib/text-size.ts) measuring wrong, clamping
//      wrong, running where it should not, or being undone by React. Its
//      real code is run with only the platform stubbed — Chrome cannot
//      resolve `-apple-system-body`, so the stub answers what an iPhone at
//      each Dynamic Type setting would.
//
// Whether the screens still FIT at the larger sizes is test-a11y's job (21
// screens at 125% and 200%).
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'
import { resolveBaseUrl } from './_base-url.mjs'

const BASE = await resolveBaseUrl()
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const head = (m) => console.log(`\n${m}`)
const ROOT = new URL('..', import.meta.url).pathname

head('1. No text size in the product is written in px')
// Emails and the generated share images are not pages: an email client and
// an image renderer have no root font size to follow.
// Not the app's pages: emails (read by mail clients, where px is the size
// that works — the sign-in link, a notice, a confirmation) and share cards.
const NOT_PAGES = [/^app\/api\/auth\/send-link\//, /^app\/api\/email\//, /^app\/api\/notices\//, /^lib\/mail\//, /^app\/api\/share\//, /^lib\/share\//]
const files = []
const walk = (dir) => {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel)
    else if (/\.(tsx|ts|css)$/.test(name) && !NOT_PAGES.some((r) => r.test(rel))) files.push(rel)
  }
}
for (const dir of ['app', 'components', 'lib']) walk(dir)
const pxText = []
for (const rel of files) {
  const src = readFileSync(join(ROOT, rel), 'utf8')
  src.split('\n').forEach((line, i) => {
    if (/text-\[\d+(\.\d+)?px\]/.test(line) || /fontSize:\s*['"]?\d+(\.\d+)?(px)?['"]?\s*[,}]/.test(line)) pxText.push(`${rel}:${i + 1}`)
    // CSS: a px font size is allowed only as the floor inside max() (the
    // inputs' 16px, which stops iOS zooming on focus).
    if (/font-size:\s*\d+(\.\d+)?px/.test(line) && !/max\(\s*16px/.test(line)) pxText.push(`${rel}:${i + 1}`)
  })
}
pxText.length === 0
  ? ok(`${files.length} files read: every text size is rem (or a Tailwind size, which is rem)`)
  : bad(`text sized in px, which the phone's setting cannot reach: ${pxText.slice(0, 8).join(', ')}${pxText.length > 8 ? ` and ${pxText.length - 8} more` : ''}`)
const css = readFileSync(join(ROOT, 'app/globals.css'), 'utf8')
const rootRules = [...css.matchAll(/(^|\n)\s*(html|:root)(\s*,[^{]*)?\s*\{([^}]*)\}/g)].map((m) => m[4])
rootRules.some((body) => /font-size/.test(body))
  ? bad('globals.css sets a font size on html or :root — Chrome on Android cannot scale the root past it')
  : ok('globals.css sets no font size on html or :root (Chrome\'s rule for the text-scale opt-in)')

head('2. Android: the page opts in, and nothing pins the root')
const html = await fetch(`${BASE}/signin`).then((r) => r.text())
const OPT_IN = /<meta name="text-scale" content="scale"\s*\/?>/
OPT_IN.test(html)
  ? ok('<meta name="text-scale" content="scale"> is in the page')
  : bad('the text-scale opt-in is missing from the page head')

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
const sizes = () => {
  const px = (el) => (el ? parseFloat(getComputedStyle(el).fontSize) : null)
  return {
    root: px(document.documentElement),
    inline: document.documentElement.style.fontSize || null,
    input: px(document.querySelector('input')),
    small: px(document.querySelector('.text-sm')),
  }
}
try {
  for (const standard of [16, 20, 32]) {
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    await page.setViewport({ width: 375, height: 812 })
    // The browser's default size — what Android's setting becomes once the
    // page opts in, and what a desktop browser's "font size" setting is.
    const cdp = await page.createCDPSession()
    await cdp.send('Page.setFontSizes', { fontSizes: { standard } })
    await page.goto(`${BASE}/signin`, { waitUntil: 'networkidle2', timeout: 60000 })
    const s = await page.evaluate(sizes)
    s.root === standard
      ? ok(`default size ${standard}px → root ${s.root}px, small text ${s.small}px, a field ${s.input}px`)
      : bad(`default size ${standard}px but the root is ${s.root}px — something pins it`)
    if (standard === 16 && s.inline) bad(`a desktop browser got an inline root size (${s.inline}) — the iPhone script ran where it should not`)
    else if (standard === 16) ok('a desktop browser: the iPhone script leaves the root alone')
    if (standard === 32 && s.small !== 28) bad(`.text-sm is ${s.small}px at a 32px root, not 28px — not in rem`)
    await context.close()
  }

  head('3. iPhone: the script follows Dynamic Type, between 100% and 200%')
  // What `-apple-system-body` computes to on an iPhone at each setting, and
  // the root the script should set: 16 × body / 17, held to 16…32.
  const CASES = [
    ['xSmall', 14, 16],
    ['Large (the default)', 17, 16],
    ['xLarge', 19, 17.88],
    ['xxLarge', 21, 19.76],
    ['xxxLarge', 23, 21.65],
    ['AX1', 28, 26.35],
    ['AX3', 40, 32],
    ['AX5 (the largest)', 53, 32],
  ]
  const stub = (sys) => {
    window.__systemBody = sys
    const supports = CSS.supports.bind(CSS)
    CSS.supports = (a, b) => (a === '-webkit-touch-callout' ? true : supports(a, b))
    const gcs = window.getComputedStyle.bind(window)
    window.getComputedStyle = (el, pseudo) =>
      el && el.hasAttribute && el.hasAttribute('data-text-probe') ? { fontSize: `${window.__systemBody}px` } : gcs(el, pseudo)
  }
  for (const [setting, body, want] of CASES) {
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    await page.setViewport({ width: 375, height: 812 })
    const errors = []
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.evaluateOnNewDocument(stub, body)
    await page.goto(`${BASE}/signin`, { waitUntil: 'networkidle2', timeout: 60000 })
    // After React has hydrated and the page has settled: still there?
    await new Promise((r) => setTimeout(r, 600))
    const s = await page.evaluate(sizes)
    const close = Math.abs(s.root - want) < 0.02
    close
      ? ok(`${setting} (${body}px body) → root ${s.root}px${want === 16 ? ' (as designed; no inline size)' : ''}`)
      : bad(`${setting} (${body}px body) → root ${s.root}px, wanted ${want}px`)
    if (want === 16 && s.inline) bad(`${setting}: an inline size (${s.inline}) where none was needed`)
    if (want > 16 && Math.abs(s.small - want * 0.875) > 0.05) bad(`${setting}: .text-sm is ${s.small}px, wanted ${(want * 0.875).toFixed(2)}px`)
    if (want > 16 && s.input !== null && Math.abs(s.input - want) > 0.05) bad(`${setting}: a field is ${s.input}px, wanted ${want}px`)
    const hydration = errors.filter((e) => /hydrat|did not match|didn't match/i.test(e))
    if (hydration.length) bad(`${setting}: React complained about the root — ${hydration[0].slice(0, 160)}`)
    if (setting === 'xxLarge') {
      // Changed in Settings while the app was in the background: measured
      // again when it comes back to the front.
      const after = await page.evaluate(() => {
        window.__systemBody = 28
        document.dispatchEvent(new Event('visibilitychange'))
        return parseFloat(getComputedStyle(document.documentElement).fontSize)
      })
      Math.abs(after - 26.35) < 0.02
        ? ok(`the setting changed to AX1 while away → root ${after}px on coming back`)
        : bad(`the setting changed while away, but the root is ${after}px, not 26.35px`)
      const back = await page.evaluate(() => {
        window.__systemBody = 17
        document.dispatchEvent(new Event('visibilitychange'))
        return { root: parseFloat(getComputedStyle(document.documentElement).fontSize), inline: document.documentElement.style.fontSize || null }
      })
      back.root === 16 && !back.inline
        ? ok('and back to the default → root 16px, the inline size removed')
        : bad(`back to the default but the root is ${back.root}px (inline ${back.inline})`)
    }
    await context.close()
  }
} finally {
  await browser.close()
}
console.log(process.exitCode ? '' : '\n  \x1b[32mthe phone\'s text size reaches every word\x1b[0m\n')
