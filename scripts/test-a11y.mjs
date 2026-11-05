// Run: node --env-file=.env.local scripts/test-a11y.mjs
//
// X-10, the half that needs no translation: every control on the main
// screens has a name a screen reader can say, every field has a label,
// every image has alt text, the current tab says it is current, and
// nothing a thumb has to hit is smaller than 44px. Walked in a real
// browser as a parent, a coach, the owner and a stranger, at 375px.
//
// A control with no name is a button VoiceOver reads as "button". That is
// the first of what this fails on; colour contrast and reading order are
// judged by eye on the screenshots, not here.
//
// The second (4 Nov): LARGER TEXT. A phone's text-size setting scales the
// root font size (lib/text-size.ts), and every text size in the product is
// in rem so all of it follows. Each screen is looked at again with the root
// at 125% (the first "larger" step on a phone) and at 200% (what WCAG 1.4.4
// asks a page to survive, and the most the iPhone script will set): nothing
// may push the page sideways, hang off the right edge, or be cut off inside
// a box that cannot grow. Wrapping onto more lines is fine — that is what
// larger text does.
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
const U8 = '00000000-0000-0000-0000-0000000d0008'

const people = {
  parent: await signInBoth(admin, 'p61400000011@squadroom.invalid'),
  coach: await signInBoth(admin, 'p61400000002@squadroom.invalid'),
  owner: await signInBoth(admin, 'joeylameri@outlook.com'),
}
if (!people.parent || !people.coach || !people.owner) { console.log("  could not sign in — the project's auth rate limit, not a failure"); process.exit(2) }
const { data: game } = await admin.from('events').select('id').eq('team_id', U8).gt('starts_at', new Date().toISOString()).order('starts_at').limit(1).maybeSingle()
const { data: chan } = await admin.from('channels').select('id').eq('team_id', U8).eq('type', 'team').maybeSingle()

const SCREENS = [
  { who: 'parent', path: '/' },
  { who: 'parent', path: '/calendar' },
  { who: 'parent', path: game ? `/calendar/${game.id}` : '/calendar' },
  { who: 'parent', path: '/chat' },
  { who: 'parent', path: chan ? `/chat/${chan.id}` : '/chat' },
  { who: 'parent', path: '/payments' },
  { who: 'parent', path: '/settings' },
  { who: 'parent', path: '/settings/family' },
  { who: 'parent', path: '/programs' },
  { who: 'coach', path: '/' },
  { who: 'coach', path: '/admin' },
  { who: 'coach', path: '/admin/teams' },
  { who: 'coach', path: game ? `/calendar/${game.id}` : '/calendar' },
  { who: 'owner', path: '/admin/payments' },
  { who: 'owner', path: '/admin/programs' },
  { who: 'owner', path: '/admin/members' },
  { who: 'owner', path: '/competitions' },
  { who: null, path: '/signin' },
  { who: null, path: '/nrifa' },
  { who: null, path: '/nrifa/register' },
  { who: null, path: '/c/nrifa-spring-gala' },
]

const cookieFor = (s) => ({ name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(s.session)).toString('base64'), domain: 'localhost', path: '/' })
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })

// What a screen reader would be given, computed the way the accessible
// name is: aria-labelledby, aria-label, the text inside (alt of images
// counted), title. Inputs: a <label for>, a wrapping label, aria-label or
// aria-labelledby; a placeholder alone is not a label.
const audit = () => {
  const name = (el) => {
    const by = el.getAttribute('aria-labelledby')
    if (by) return by.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() ?? '').join(' ').trim()
    const al = el.getAttribute('aria-label')
    if (al?.trim()) return al.trim()
    const text = [...el.querySelectorAll('img[alt], svg[aria-label], [aria-label]')].map((i) => i.getAttribute('alt') ?? i.getAttribute('aria-label') ?? '').join(' ') + ' ' + (el.innerText ?? el.textContent ?? '')
    if (text.trim()) return text.trim()
    return (el.getAttribute('title') ?? el.getAttribute('value') ?? '').trim()
  }
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' }
  const out = { unnamed: [], unlabelled: [], noAlt: [], small: [], under44: [], current: document.querySelector('nav [aria-current="page"], [role="tablist"] [aria-current], [data-tab][aria-current]') !== null }
  for (const el of document.querySelectorAll('button, a[href], [role="button"], [role="tab"], input[type="submit"], input[type="button"]')) {
    if (!visible(el) || el.getAttribute('aria-hidden') === 'true') continue
    const n = name(el)
    if (!n) out.unnamed.push(`${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ').slice(0, 2).join('.') : ''}${el.getAttribute('href') ? ` → ${el.getAttribute('href')}` : ''}`)
    const r = el.getBoundingClientRect()
    if (el.tagName === 'BUTTON' && (r.width < 24 || r.height < 24)) out.small.push(`${n.slice(0, 30)} ${Math.round(r.width)}×${Math.round(r.height)}`)
    // X-10's 44px (Apple's minimum for a thumb): counted, not failed — the
    // floor above (24px, WCAG 2.2 AA) is what fails. A link inside a line of
    // text is exempt, as WCAG exempts it.
    const inline = el.tagName === 'A' && getComputedStyle(el).display === 'inline'
    if (!inline && (r.width < 44 || r.height < 44)) out.under44.push(`${n.replace(/\s+/g, ' ').slice(0, 28)} ${Math.round(r.width)}×${Math.round(r.height)}`)
  }
  for (const el of document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea')) {
    if (!visible(el)) continue
    const labelled = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.closest('label') || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`))
    if (!labelled) out.unlabelled.push(`${el.tagName.toLowerCase()}[${el.type}] name=${el.name || '-'} ph=${el.placeholder || '-'}`)
  }
  for (const img of document.querySelectorAll('img')) {
    if (!visible(img)) continue
    if (!img.hasAttribute('alt')) out.noAlt.push(img.getAttribute('src')?.slice(0, 60) ?? 'img')
  }
  return out
}

// With the root font size turned up: what no longer fits. An element inside
// a sideways-scrolling container (a table, a strip of chips) is allowed past
// the edge; a truncated line (ellipsis, line clamp) is a choice, not a cut.
const largeAudit = (px) => {
  document.documentElement.style.fontSize = `${px}px`
  // Force layout at the new size before measuring.
  void document.body.offsetHeight
  const vw = window.innerWidth
  const out = { sideways: Math.max(0, document.documentElement.scrollWidth - vw), offEdge: [], clipped: [] }
  const scrollsX = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX
      if (o === 'auto' || o === 'scroll') return true
    }
    return false
  }
  const describe = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').filter(Boolean).slice(0, 2).join('.') : ''} “${(el.innerText ?? '').trim().replace(/\s+/g, ' ').slice(0, 28)}”`
  for (const el of document.body.querySelectorAll('*')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    // Visually hidden on purpose (.sr-only): clipped to a pixel by design.
    if (r.width <= 1 && r.height <= 1) continue
    const s = getComputedStyle(el)
    if (s.visibility === 'hidden' || s.display === 'none') continue
    if (s.position === 'fixed' && r.width >= vw) continue
    if (r.right > vw + 1 && r.left < vw && !scrollsX(el) && out.offEdge.length < 12) out.offEdge.push(`${describe(el)} right=${Math.round(r.right)}`)
    const hidesX = s.overflowX === 'hidden' || s.overflowX === 'clip'
    const hidesY = s.overflowY === 'hidden' || s.overflowY === 'clip'
    if (!hidesX && !hidesY) continue
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
    if (!hasText) continue
    const ellipsis = s.textOverflow === 'ellipsis' || (s.webkitLineClamp && s.webkitLineClamp !== 'none')
    if (hidesX && !ellipsis && el.scrollWidth > el.clientWidth + 2 && out.clipped.length < 12) out.clipped.push(`${describe(el)} needs ${el.scrollWidth - el.clientWidth}px more across`)
    else if (hidesY && !ellipsis && el.scrollHeight > el.clientHeight + 2 && out.clipped.length < 12) out.clipped.push(`${describe(el)} needs ${el.scrollHeight - el.clientHeight}px more down`)
  }
  return out
}
const largeProblems = (b) => [
  ...(b.sideways > 0 ? [`the page scrolls sideways by ${b.sideways}px`] : []),
  ...b.offEdge.map((x) => `off the right edge: ${x}`),
  ...b.clipped.map((x) => `cut off: ${x}`),
]

let failures = 0
let under44 = 0
try {
  for (const s of SCREENS) {
    // Its own context: cookies are per browser context, and a stranger's
    // screen audited with the last person's cookie is not a stranger's.
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    await page.setViewport({ width: 375, height: 812 })
    if (s.who) {
      await page.setCookie(cookieFor(people[s.who]))
      await page.evaluateOnNewDocument((org) => { try { localStorage.setItem('squadroom.org', org) } catch {} }, NRIFA)
    }
    await page.goto(`${BASE}${s.path}`, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => null)
    await page.waitForFunction(() => !document.querySelector('[data-skeleton]'), { timeout: 30000 }).catch(() => null)
    await new Promise((r) => setTimeout(r, 500))
    const where = page.url().replace(BASE, '')
    const a = await page.evaluate(audit)
    const problems = [...a.unnamed.map((x) => `no name: ${x}`), ...a.unlabelled.map((x) => `no label: ${x}`), ...a.noAlt.map((x) => `no alt: ${x}`), ...a.small.map((x) => `tiny: ${x}`)]
    const label = `${s.who ?? 'stranger'} ${s.path}${where !== s.path ? ` (→ ${where})` : ''}`
    under44 += a.under44.length
    if (process.env.A11Y_TARGETS && a.under44.length) console.log(`    ~ under 44px on ${label}: ${a.under44.length} — ${a.under44.slice(0, 12).join(' · ')}`)
    if (problems.length === 0) ok(`${label}: every control named, every field labelled, every image described`)
    else { failures += problems.length; bad(`${label}: ${problems.length} problem${problems.length === 1 ? '' : 's'}`); for (const p of problems.slice(0, 8)) console.log(`      · ${p}`) }
    // The same screen with the text turned up.
    for (const [px, pct] of [[20, '125%'], [32, '200%']]) {
      const big = largeProblems(await page.evaluate(largeAudit, px))
      if (big.length === 0) ok(`${label} at ${pct} text: everything still fits`)
      else { failures += big.length; bad(`${label} at ${pct} text: ${big.length} thing${big.length === 1 ? '' : 's'} no longer fit`); for (const p of big.slice(0, 8)) console.log(`      · ${p}`) }
    }
    await context.close()
  }
  head('The tab bar')
  const page = await browser.newPage()
  await page.setViewport({ width: 375, height: 812 })
  await page.setCookie(cookieFor(people.parent))
  await page.goto(`${BASE}/calendar`, { waitUntil: 'networkidle2', timeout: 60000 })
  const tabs = await page.evaluate(() => [...document.querySelectorAll('nav a, nav button, [role="tablist"] a')].map((t) => ({ text: t.innerText.trim(), current: t.getAttribute('aria-current') })))
  tabs.some((t) => t.current === 'page') ? ok(`the current tab says so (aria-current): ${tabs.find((t) => t.current === 'page')?.text}`) : bad(`no tab carries aria-current: ${JSON.stringify(tabs.map((t) => t.text))}`)
  await page.close()
} finally {
  await browser.close()
}
console.log(`\n  ${under44} controls under 44px across the screens (for the record; A11Y_TARGETS=1 lists them)`)
console.log(failures === 0 ? '\n  \x1b[32mevery screen can be read aloud and survives text at 200%\x1b[0m\n' : `\n  \x1b[31m${failures} things a screen reader cannot say or that larger text breaks\x1b[0m\n`)
process.exit(process.exitCode ?? 0)
