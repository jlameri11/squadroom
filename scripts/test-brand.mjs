// Run: node --env-file=.env.local scripts/test-brand.mjs
//   (the page checks need the app running — npm run dev, or serve:test)
//
// The Squadroom brand (Joey, 4 Nov 2026; brand/README.md): white on
// near-black #101012, monochrome greys, colour only where it means
// something — orange: needs you; green: going; red: out or called off.
//
// What would quietly undo it, each checked:
//   1. A token pair below AA, or the two dark blocks drifting apart (the
//      media query and [data-theme="dark"] must say the same thing).
//   2. White text on a surface that is white in dark mode. --brand flips
//      (near-black on light, white on dark), so `text-white` or #fff on it
//      is invisible to everyone using dark mode.
//   3. The old marks coming back: the "SQ" tile, gold, the navy.
//   4. Icons that are not the brand's, or the wrong size for their job.
//   5. The bar, the sign-in screen or /for-clubs losing the brand surface.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'
import sharp from 'sharp'
import { signInBoth } from './_auth.mjs'
import { createClient } from '@supabase/supabase-js'
import { resolveBaseUrl } from './_base-url.mjs'

const BASE = await resolveBaseUrl()
const ROOT = new URL('..', import.meta.url).pathname
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const head = (m) => console.log(`\n${m}`)

// ---- colour arithmetic (WCAG 2.x), the same as lib/brand/colour.ts ----
const rgb = (h) => { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) }
const lum = (h) => { const [r, g, b] = rgb(h).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

head('1. The palette: AA in light and dark, and the two dark blocks agree')
const css = readFileSync(join(ROOT, 'app/globals.css'), 'utf8')
const block = (re) => { const m = re.exec(css); if (!m) return null; const out = {}; for (const t of m[1].matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) out[t[1]] = t[2].trim(); return out }
const light = block(/\n:root \{([\s\S]*?)\n\}/)
const darkMedia = block(/:root:not\(\[data-theme="light"\]\) \{([\s\S]*?)\n  \}/)
const darkPick = block(/\n:root\[data-theme="dark"\] \{([\s\S]*?)\n\}/)
if (!light || !darkMedia || !darkPick) bad('could not find the three token blocks in globals.css')
else {
  const diff = [...new Set([...Object.keys(darkMedia), ...Object.keys(darkPick)])].filter((k) => darkMedia[k] !== darkPick[k])
  diff.length === 0 ? ok(`the dark media query and [data-theme="dark"] define the same ${Object.keys(darkPick).length} tokens`) : bad(`the two dark blocks disagree on: ${diff.join(', ')}`)
  const dark = { ...light, ...darkMedia }
  // Text on ground, for every pairing the screens actually use.
  const PAIRS = [
    ['ink', 'paper'], ['ink', 'surface'], ['ink-2', 'paper'], ['ink-2', 'surface'], ['ink-2', 'surface-2'],
    ['ink-3', 'paper'], ['ink-3', 'surface'], ['ink-3', 'surface-2'],
    ['bar-ink', 'bar'], ['brand-ink', 'brand'], ['brand-text', 'surface'], ['brand-text', 'paper'],
    ['accent-ink', 'accent'], ['accent', 'surface'], ['accent', 'paper'],
    ['yes-ink', 'yes'], ['yes', 'surface'], ['yes', 'paper'],
    ['no-ink', 'no'], ['no', 'surface'], ['no', 'paper'],
    ['maybe-ink', 'maybe'], ['maybe', 'surface'],
    ['ink', 'bubble-out'], ['bubble-out-ink-2', 'bubble-out'], ['ink', 'bubble-in'],
  ]
  for (const [name, t] of [['light', light], ['dark', dark]]) {
    const fails = []
    let worst = [99, '']
    for (const [fg, bg] of PAIRS) {
      const a = t[fg], b = t[bg]
      if (!/^#[0-9a-f]{3,6}$/i.test(a ?? '') || !/^#[0-9a-f]{3,6}$/i.test(b ?? '')) { fails.push(`${fg} on ${bg} is not a plain colour (${a} / ${b})`); continue }
      const c = contrast(a, b)
      if (c < worst[0]) worst = [c, `${fg} on ${bg}`]
      if (c < 4.5) fails.push(`${fg} ${a} on ${bg} ${b} = ${c.toFixed(2)}:1`)
    }
    fails.length === 0 ? ok(`${name}: ${PAIRS.length} text/ground pairs all AA (lowest ${worst[0].toFixed(2)}:1, ${worst[1]})`) : bad(`${name}: below AA — ${fails.join('; ')}`)
  }
  light.bar === '#101012' && darkMedia.bar === '#101012' ? ok('the bar is the brand\'s #101012 in light and dark') : bad(`the bar is ${light.bar} / ${darkMedia.bar}, not #101012`)
  darkMedia.paper === '#101012' ? ok('dark mode stands on #101012') : bad(`dark paper is ${darkMedia.paper}`)
  css.includes('--gold') ? bad('globals.css still defines --gold') : ok('no gold token')
}

head('2. Nothing white sits on a surface that turns white')
const files = []
const walk = (d) => { for (const n of readdirSync(join(ROOT, d))) { const p = `${d}/${n}`; if (statSync(join(ROOT, p)).isDirectory()) walk(p); else if (p.endsWith('.tsx')) files.push(p) } }
walk('app'); walk('components')
const tagEnd = (src, i) => { let depth = 0; for (let j = i + 1; j < src.length; j++) { const c = src[j]; if (c === "'" || c === '"' || c === '`') { const q = c; for (j++; j < src.length && src[j] !== q; j++) if (src[j] === '\\') j++; continue } if (c === '{') depth++; else if (c === '}') depth--; else if (c === '>' && depth === 0) return j } return -1 }
const whiteOnFlip = []
const barInkOnBrand = []
for (const f of files) {
  const src = readFileSync(join(ROOT, f), 'utf8')
  for (const m of src.matchAll(/<[A-Za-z][A-Za-z0-9.]*[\s>]/g)) {
    const end = tagEnd(src, m.index)
    if (end < 0) continue
    const tag = src.slice(m.index, end + 1)
    const paintsFlip = /background:[^,}]*var\(--(brand|yes|no|maybe|accent)\)|bg-\[var\(--(brand|yes|no|maybe|accent)\)\]/.test(tag)
    const white = /\btext-white\b/.test(tag) || /color:\s*'#fff(fff)?'/.test(tag)
    if (paintsFlip && white) whiteOnFlip.push(`${f}:${src.slice(0, m.index).split('\n').length}`)
    if (/background:\s*'#ffffff[0-9a-f]{2}'/.test(tag) && /color:\s*'var\(--brand-ink\)'/.test(tag)) barInkOnBrand.push(`${f}:${src.slice(0, m.index).split('\n').length}`)
  }
}
whiteOnFlip.length === 0 ? ok(`${files.length} files: no white text on --brand, --yes, --no, --maybe or --accent (each has its own ink)`) : bad(`white text on a surface that is light in dark mode: ${whiteOnFlip.join(', ')}`)
barInkOnBrand.length === 0 ? ok('no control on the bar takes the brand\'s ink (which is dark in dark mode)') : bad(`translucent bar controls with --brand-ink: ${barInkOnBrand.join(', ')}`)

head('3. The old marks are gone')
const OLD = []
const CLUB_PICKERS = /settings\/academy\/academy-settings\.tsx|settings\/academy\/club-branding\.tsx|start\/setup\/setup-checklist\.tsx/
for (const f of files) {
  const src = readFileSync(join(ROOT, f), 'utf8')
  if (/>\s*SQ\s*</.test(src)) OLD.push(`${f}: the SQ tile`)
  if (/var\(--gold\)/.test(src)) OLD.push(`${f}: gold`)
  if (/#202842/i.test(src) && !CLUB_PICKERS.test(f)) OLD.push(`${f}: the old navy`)
}
OLD.length === 0 ? ok('no SQ tile, no gold, no navy (bar the club colour pickers, where navy is a club\'s choice)') : bad(OLD.join('; '))

head('4. Icons from the brand kit')
const meta = async (rel) => (existsSync(join(ROOT, rel)) ? sharp(join(ROOT, rel)).metadata() : null)
for (const [rel, size] of [['app/apple-icon.png', 180], ['public/icon-192.png', 192], ['public/icon-512.png', 512], ['public/icon-maskable-512.png', 512], ['public/badge.png', 96]]) {
  const m = await meta(rel)
  m && m.width === size && m.height === size ? ok(`${rel} is ${size}×${size}`) : bad(`${rel}: ${m ? `${m.width}×${m.height}` : 'missing'}, wanted ${size}×${size}`)
}
{
  // The icon is the brand's: a near-black field with white letters.
  const { data, info } = await sharp(join(ROOT, 'public/icon-192.png')).raw().toBuffer({ resolveWithObject: true })
  let black = 0, white = 0
  for (let i = 0; i < data.length; i += info.channels) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]]
    if (Math.abs(r - 16) < 6 && Math.abs(g - 16) < 6 && Math.abs(b - 18) < 6) black++
    else if (r > 240 && g > 240 && b > 240) white++
  }
  const n = info.width * info.height
  black / n > 0.6 && white / n > 0.08 ? ok(`icon-192: ${Math.round((100 * black) / n)}% #101012, ${Math.round((100 * white) / n)}% white`) : bad(`icon-192 does not look like the brand icon (${Math.round((100 * black) / n)}% black, ${Math.round((100 * white) / n)}% white)`)
  const badge = await sharp(join(ROOT, 'public/badge.png')).raw().toBuffer({ resolveWithObject: true })
  let opaque = 0
  for (let i = 3; i < badge.data.length; i += badge.info.channels) if (badge.data[i] > 128) opaque++
  const share = opaque / (badge.info.width * badge.info.height)
  share > 0.05 && share < 0.4 ? ok(`the notification badge is letters on transparent (${Math.round(100 * share)}% opaque)`) : bad(`badge.png is ${Math.round(100 * share)}% opaque — Android would draw a square`)
}
const ico = readFileSync(join(ROOT, 'app/favicon.ico'))
const icoSizes = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => ico.readUInt8(6 + 16 * i) || 256)
icoSizes.join(',') === '16,32,48' ? ok('favicon.ico carries 16, 32 and 48') : bad(`favicon.ico sizes: ${icoSizes.join(', ')}`)
for (const f of ['squadroom-icon-white.svg', 'squadroom-icon-white-small.svg', 'squadroom-logo-white.svg']) {
  existsSync(join(ROOT, 'public/brand', f)) && readFileSync(join(ROOT, 'public/brand', f)).equals(readFileSync(join(ROOT, 'brand', f)))
    ? ok(`public/brand/${f} is the kit's own file`) : bad(`public/brand/${f} is missing or differs from brand/${f} — run scripts/brand-icons.mjs`)
}

head('5. Served: the manifest, the head, the logo where it belongs')
const manifest = await fetch(`${BASE}/manifest.webmanifest`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
manifest?.theme_color === '#101012' && manifest?.icons?.length === 3 && manifest.icons.some((i) => i.purpose === 'maskable')
  ? ok(`the manifest: ${manifest.name}, theme #101012, ${manifest.icons.length} icons incl. maskable`)
  : bad(`the manifest is missing or wrong: ${JSON.stringify(manifest)?.slice(0, 200)}`)
const signin = await fetch(`${BASE}/signin`).then((r) => r.text())
const HEAD_LINKS = [/<link rel="manifest"/, /<link rel="apple-touch-icon"[^>]*sizes="180x180"/, /<link rel="icon"[^>]*favicon/, /<meta name="theme-color" content="#101012"/]
HEAD_LINKS.every((re) => re.test(signin)) ? ok('every page head: manifest, apple-touch-icon, favicon, theme colour #101012') : bad(`head links missing: ${HEAD_LINKS.filter((re) => !re.test(signin)).map(String).join(' ')}`)
signin.includes('src="/brand/squadroom-logo-white.svg"') ? ok('sign-in carries the Squadroom logo') : bad('no logo on sign-in')
const forClubs = await fetch(`${BASE}/for-clubs`).then((r) => r.text())
forClubs.includes('src="/brand/squadroom-logo-white.svg"') ? ok('/for-clubs carries the logo') : bad('no logo on /for-clubs')
const join_ = await fetch(`${BASE}/join`).then((r) => r.text())
join_.includes('src="/brand/squadroom-icon-white-small.svg"') ? ok('/join carries the small icon (48px)') : bad('no icon on /join')
for (const [path, html] of [['/signin', signin], ['/for-clubs', forClubs], ['/join', join_]]) if (/>\s*SQ\s*</.test(html)) bad(`${path} still shows "SQ"`)

head('6. In a browser: Black & white (an Appearance choice; club colours are the default — test-branding), and sign-in')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const parent = await signInBoth(admin, 'p61400000011@squadroom.invalid')
if (!parent) { console.log("  could not sign in — the project's auth rate limit, not a failure"); process.exit(2) }
// Since 0209 the choice lives in the person's profile and wins over the
// phone's copy, so Black & white is set the way Settings sets it — on the
// profile, as Sam — and put back exactly afterwards.
const { data: wasAppearance } = await admin.from('profiles').select('appearance, colour_mode').eq('id', parent.session.user.id).maybeSingle()
const hasAppearance = Boolean(wasAppearance && 'appearance' in wasAppearance)
if (hasAppearance) await parent.client.from('profiles').update({ appearance: 'mono', colour_mode: 'system' }).eq('id', parent.session.user.id)
const ref = process.env.NEXT_PUBLIC_SUPABASE_URL.split('//')[1].split('.')[0]
const cookie = { name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(parent.session)).toString('base64'), domain: 'localhost', path: '/' }
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
const toHex = (c) => { const m = c.match(/\d+(\.\d+)?/g); return m ? '#' + m.slice(0, 3).map((n) => Math.round(Number(n)).toString(16).padStart(2, '0')).join('') : c }
try {
  for (const theme of ['light', 'dark']) {
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    await page.setViewport({ width: 375, height: 812 })
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }])
    await page.setCookie(cookie)
    await page.evaluateOnNewDocument(() => { try { localStorage.setItem('squadroom.org', '00000000-0000-0000-0000-0000000a0001'); localStorage.setItem('squadroom.appearance', JSON.stringify({ design: 'mono', mode: 'system' })) } catch {} })
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 60000 })
    await page.waitForSelector('header', { timeout: 30000 })
    const bar = await page.evaluate(() => { const h = document.querySelector('header'); const s = getComputedStyle(h); return { bg: s.backgroundColor, fg: s.color } })
    toHex(bar.bg) === '#101012' && toHex(bar.fg) === '#ffffff' ? ok(`${theme}, Black & white: the app bar is #101012 with white`) : bad(`${theme}, Black & white: the app bar is ${toHex(bar.bg)} with ${toHex(bar.fg)}`)
    await context.close()
    // Signed out: a signed-in visit to /signin goes straight home.
    const out = await browser.createBrowserContext()
    const page2 = await out.newPage()
    await page2.setViewport({ width: 375, height: 812 })
    await page2.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }])
    await page2.goto(`${BASE}/signin`, { waitUntil: 'networkidle2', timeout: 60000 })
    await page2.waitForSelector('button[type="submit"]', { timeout: 30000 })
    const s = await page2.evaluate(() => {
      const main = getComputedStyle(document.querySelector('main')).backgroundColor
      const btn = document.querySelector('button[type="submit"]')
      const b = getComputedStyle(btn)
      const logo = document.querySelector('img[data-brand-logo]')
      return { main, bg: b.backgroundColor, fg: b.color, logo: logo ? logo.naturalWidth > 0 && logo.getBoundingClientRect().height : 0 }
    })
    // The sign-up brief (12 Nov 2026): the form is a card in the page's own
    // paper on the #101012 ground, so its one button is `--brand`, which
    // flips with the theme — near-black on the light card, white on the dark.
    const want = theme === 'light' ? ['#101012', '#ffffff'] : ['#ffffff', '#101012']
    toHex(s.main) === '#101012' && toHex(s.bg) === want[0] && toHex(s.fg) === want[1] && s.logo >= 28
      ? ok(`${theme}: sign-in is the logo (${Math.round(s.logo)}px tall) on #101012, the card's button ${want[0]} on ${want[1]}`)
      : bad(`${theme}: sign-in ground ${toHex(s.main)}, button ${toHex(s.bg)}/${toHex(s.fg)}, logo ${s.logo}`)
    await out.close()
  }
} finally {
  await browser.close()
  if (hasAppearance) await admin.from('profiles').update({ appearance: wasAppearance.appearance, colour_mode: wasAppearance.colour_mode }).eq('id', parent.session.user.id)
}
console.log(process.exitCode ? '' : '\n  \x1b[32mthe brand holds: white on #101012, colour only where it means something\x1b[0m\n')
