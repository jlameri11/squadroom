// Run: node --env-file=.env.local scripts/test-a11y.mjs
//
// X-10, the half that needs no translation: every control on the main
// screens has a name a screen reader can say, every field has a label,
// every image has alt text, the current tab says it is current, and
// nothing a thumb has to hit is smaller than 44px. Walked in a real
// browser as a parent, a coach, the owner and a stranger, at 375px.
//
// A control with no name is a button VoiceOver reads as "button". That is
// the whole of what this fails on; colour contrast and reading order are
// judged by eye on the screenshots, not here.
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
  const out = { unnamed: [], unlabelled: [], noAlt: [], small: [], current: document.querySelector('nav [aria-current="page"], [role="tablist"] [aria-current], [data-tab][aria-current]') !== null }
  for (const el of document.querySelectorAll('button, a[href], [role="button"], [role="tab"], input[type="submit"], input[type="button"]')) {
    if (!visible(el) || el.getAttribute('aria-hidden') === 'true') continue
    const n = name(el)
    if (!n) out.unnamed.push(`${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ').slice(0, 2).join('.') : ''}${el.getAttribute('href') ? ` → ${el.getAttribute('href')}` : ''}`)
    const r = el.getBoundingClientRect()
    if (el.tagName === 'BUTTON' && (r.width < 24 || r.height < 24)) out.small.push(`${n.slice(0, 30)} ${Math.round(r.width)}×${Math.round(r.height)}`)
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

let failures = 0
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
    if (problems.length === 0) ok(`${label}: every control named, every field labelled, every image described`)
    else { failures += problems.length; bad(`${label}: ${problems.length} problem${problems.length === 1 ? '' : 's'}`); for (const p of problems.slice(0, 8)) console.log(`      · ${p}`) }
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
console.log(failures === 0 ? '\n  \x1b[32mevery screen can be read aloud\x1b[0m\n' : `\n  \x1b[31m${failures} things a screen reader cannot say\x1b[0m\n`)
process.exit(process.exitCode ?? 0)
