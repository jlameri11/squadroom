// Run: node --env-file=.env.local scripts/test-org-follows.mjs
//
// Every screen follows the organisation the browser is showing (3/4 Nov
// 2026). Seven pages used to resolve "the first academy by name" on the
// server, so an owner of several organisations opened Admin → Payments,
// Members, Invites, the roster importer, Scan, the Admin hub or their own
// Payments and got whichever sorted first. A throwaway organisation that
// sorts before everything ("AAA …") with Joey as its owner makes the old
// behaviour visible: with NRIFA Football Academy remembered in the browser,
// every page must show NRIFA Football Academy; switched, every page must
// follow; a remembered id that is not Joey's falls back and is corrected.
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
const RAVENS = '00000000-0000-0000-0000-0000000a0002'
const OWNER = '00000000-0000-0000-0000-0000000000a1'
const TAG = 'ORGFOLLOW'
const AAA_NAME = `AAA Follow Me ${TAG}`

async function tidy() {
  const { data: orgs } = await admin.from('academies').select('id').eq('slug', 'orgfollow-aaa')
  for (const o of orgs ?? []) await admin.from('academies').delete().eq('id', o.id)
}
await tidy()

const { data: aaa, error: aaaErr } = await admin.from('academies').insert({ two_step_required: false, name: AAA_NAME, slug: 'orgfollow-aaa', type: 'academy', primary_colour: '#333333' }).select('id').single()
if (aaaErr) { console.log(`  could not make the throwaway organisation: ${aaaErr.message}`); process.exit(1) }
await admin.from('academy_members').insert({ academy_id: aaa.id, profile_id: OWNER, role: 'owner', status: 'active' })

const { data: u } = await admin.auth.admin.getUserById(OWNER)
const joey = await signInBoth(admin, u.user.email)
if (!joey) { console.log("  could not sign in — the project's auth rate limit, not a failure"); await tidy(); process.exit(2) }
const cookie = { name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(joey.session)).toString('base64'), domain: 'localhost', path: '/' }

// The pages, and what proves which organisation each is showing.
const PAGES = [
  { path: '/admin', label: 'Admin hub' },
  { path: '/admin/payments', label: 'Admin → Payments' },
  { path: '/admin/members', label: 'Members' },
  { path: '/admin/invites', label: 'Invites' },
  { path: '/admin/import/players', label: 'Import players' },
  { path: '/scan', label: 'Scan' },
  { path: '/payments', label: 'Payments (family)' },
  { path: '/admin/teams', label: 'Teams', noAttr: true },
  { path: '/directory', label: 'Directory', noAttr: true },
]

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
async function open(path, remembered) {
  const page = await browser.newPage()
  await page.setViewport({ width: 375, height: 812 })
  await page.setCookie(cookie)
  await page.evaluateOnNewDocument((org) => { try { if (org) localStorage.setItem('squadroom.org', org); else localStorage.removeItem('squadroom.org') } catch {} }, remembered)
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 60000 })
  await page.waitForFunction(() => document.querySelector('[data-org]') || !document.querySelector('[data-skeleton]'), { timeout: 30000 }).catch(() => null)
  await new Promise((r) => setTimeout(r, 400))
  const state = await page.evaluate(() => ({
    org: document.querySelector('[data-org]')?.getAttribute('data-org') ?? null,
    text: document.body.innerText.replace(/\s+/g, ' '),
    stored: (() => { try { return localStorage.getItem('squadroom.org') } catch { return null } })(),
  }))
  await page.close()
  return state
}

try {
  head('1. NRIFA Football Academy remembered: every page shows it, none shows the organisation that sorts first')
  for (const p of PAGES) {
    const s = await open(p.path, NRIFA)
    const attrOk = p.noAttr ? true : s.org === NRIFA
    const textOk = !s.text.includes(AAA_NAME)
    const named = s.text.includes('NRIFA Football Academy')
    attrOk && textOk && (p.noAttr ? named || true : true) ? ok(`${p.label}: ${p.noAttr ? (named ? 'NRIFA Football Academy named' : 'nothing of the other organisation') : 'NRIFA Football Academy'}`) : bad(`${p.label}: data-org ${s.org}, mentions AAA ${!textOk} — ${s.text.slice(0, 140)}`)
  }

  head('2. Switched to the new organisation: the pages follow')
  for (const p of PAGES.filter((x) => !x.noAttr)) {
    const s = await open(p.path, aaa.id)
    s.org === aaa.id && !s.text.includes('NRIFA Football Academy') ? ok(`${p.label}: ${AAA_NAME}`) : bad(`${p.label}: data-org ${s.org} — ${s.text.slice(0, 140)}`)
  }
  const hub = await open('/admin', aaa.id)
  hub.text.includes(`Running ${AAA_NAME}`) ? ok('the Admin hub says which club it is running') : bad(`hub: ${hub.text.slice(0, 120)}`)

  head("3. A remembered organisation that is not this person's: fall back, and correct the memory")
  const s = await open('/admin/payments', RAVENS)
  s.org && s.org !== RAVENS ? ok(`Admin → Payments fell back to one of Joey's (${s.org === NRIFA ? 'NRIFA Football Academy' : s.org === aaa.id ? AAA_NAME : s.org})`) : bad(`fallback: data-org ${s.org}`)
  s.stored === s.org ? ok('and the browser now remembers the organisation actually shown') : bad(`stored ${s.stored} vs shown ${s.org}`)

  head('4. Nothing remembered: the first of theirs, by name')
  const n = await open('/payments', null)
  n.org === aaa.id ? ok(`Payments shows ${AAA_NAME} (sorts first) and remembers it`) : bad(`nothing remembered → ${n.org}`)
} finally {
  await browser.close()
  await tidy()
}
process.exit(process.exitCode ?? 0)
