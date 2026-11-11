// Run: node --env-file=.env.local scripts/test-inner-west.mjs
//   (needs the app running — npm run dev, or serve:test; SHOTS=1 saves
//   each demo login's Home to .shots/)
//
// The Inner West FC demo (Big Club Mode item 14), as it must be before it
// is shown: the brief's size, the committee in place, the grounds with
// their slots, the weekend's games, the clinic mid-way, the Saturday roster
// with its gaps — and all ten demo logins sign in by password and land on a
// Home with something on it. Reads only; changes nothing.
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'
import { resolveBaseUrl } from './_base-url.mjs'

const BASE = await resolveBaseUrl()
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const ref = URL_.split('//')[1].split('.')[0]
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SHOTS = process.env.SHOTS === '1'
const PASSWORD = process.env.DEMO_PASSWORD ?? 'squadroom-demo'
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const head = (m) => console.log(`\n${m}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
if (SHOTS) mkdirSync('.shots', { recursive: true })

const IW = '00000000-0000-0000-0000-0000000a0009'
const count = async (table, build) => { const { count } = await build(admin.from(table).select('*', { count: 'exact', head: true })); return count ?? 0 }

head("1. The brief's size")
{
  const teams = await count('teams', (q) => q.eq('academy_id', IW).eq('status', 'active'))
  const players = await count('players', (q) => q.eq('academy_id', IW))
  const parents = await count('academy_members', (q) => q.eq('academy_id', IW).eq('role', 'parent'))
  const adults = await count('academy_members', (q) => q.eq('academy_id', IW).eq('role', 'player'))
  const coaches = await count('academy_members', (q) => q.eq('academy_id', IW).eq('role', 'coach'))
  teams === 40 ? ok('40 squads') : bad(`${teams} squads`)
  players >= 800 ? ok(`${players} players`) : bad(`${players} players`)
  parents >= 1000 ? ok(`${parents} parents`) : bad(`${parents} parents`)
  adults >= 100 ? ok(`${adults} adult players, their own members`) : bad(`${adults} adults`)
  coaches >= 30 ? ok(`${coaches} coaches`) : bad(`${coaches} coaches`)
  const { data: streams } = await admin.from('streams').select('name').eq('academy_id', IW).order('sort_order')
  ;(streams ?? []).map((s) => s.name).join(',') === 'MiniRoos,Juniors,Girls,NPL,Seniors,Over-35s' ? ok('six streams, in order') : bad(`streams: ${JSON.stringify(streams)}`)
  const { data: roles } = await admin.from('club_roles').select('role').eq('academy_id', IW)
  const have = new Set((roles ?? []).map((r) => r.role))
  ;['president', 'secretary', 'registrar', 'treasurer', 'coordinator', 'team_manager', 'welfare_officer', 'volunteer_coordinator'].every((r) => have.has(r)) ? ok(`the full committee: ${[...have].join(', ')}`) : bad(`committee: ${[...have].join(', ')}`)
  const clearances = await count('staff_clearances', (q) => q.eq('academy_id', IW))
  clearances >= coaches ? ok(`every coach with a check (${clearances})`) : bad(`${clearances} checks for ${coaches} coaches`)
}

head('2. Grounds, slots, the weekend, the clinic, the roster')
{
  const venues = await count('venues', (q) => q.eq('academy_id', IW))
  const pitches = await count('pitches', (q) => q.eq('academy_id', IW))
  venues === 2 && pitches === 8 ? ok('two grounds, eight pitches and halves') : bad(`${venues} grounds, ${pitches} pitches`)
  const series = await count('event_series', (q) => q.eq('academy_id', IW).not('pitch_id', 'is', null))
  series === 40 ? ok('40 training slots on pitches') : bad(`${series} slots`)
  const trainings = await count('events', (q) => q.eq('academy_id', IW).eq('type', 'training'))
  trainings >= 600 ? ok(`${trainings} sessions`) : bad(`${trainings} sessions`)
  const games = await count('events', (q) => q.eq('academy_id', IW).eq('type', 'match'))
  games === 80 ? ok('80 games: last Saturday and next') : bad(`${games} games`)
  const scored = await count('events', (q) => q.eq('academy_id', IW).eq('type', 'match').not('our_score', 'is', null))
  scored >= 20 ? ok(`${scored} results in, for the squads that keep scores`) : bad(`${scored} results`)
  const rsvps = await count('event_rsvps', (q) => q.eq('academy_id', IW))
  rsvps >= 200 ? ok(`${rsvps} answers for Saturday`) : bad(`${rsvps} answers`)
  const { data: prog } = await admin.from('programs').select('id').eq('academy_id', IW).eq('name', 'Winter Skills Clinic').maybeSingle()
  const regs = prog ? await count('program_registrations', (q) => q.eq('program_id', prog.id)) : 0
  regs >= 50 ? ok(`the Winter Skills Clinic: ${regs} registered`) : bad(`clinic registrations: ${regs}`)
  const paid = await count('payments', (q) => q.eq('academy_id', IW).eq('status', 'paid'))
  paid >= 30 ? ok(`${paid} paid`) : bad(`${paid} paid`)
  const days = await count('events', (q) => q.eq('academy_id', IW).eq('ground_day', true))
  const jobs = await count('event_jobs', (q) => q.eq('academy_id', IW))
  days === 1 && jobs === 5 ? ok('a Saturday at Hawthorne with five jobs') : bad(`${days} ground days, ${jobs} jobs`)
  const duties = await count('event_duties', (q) => q.eq('academy_id', IW))
  const swaps = await count('event_duties', (q) => q.eq('academy_id', IW).not('requested_swap_at', 'is', null))
  duties === 18 && swaps === 1 ? ok('18 duties rostered, one swap asked for') : bad(`${duties} duties, ${swaps} swaps`)
}

head('3. Ten demo logins, each on a Home with something on it')
const LOGINS = [
  ['iw.president@squadroom-demo.test', 'President'], ['iw.secretary@squadroom-demo.test', 'Secretary'], ['iw.registrar@squadroom-demo.test', 'Registrar'],
  ['iw.treasurer@squadroom-demo.test', 'Treasurer'], ['iw.coordinator@squadroom-demo.test', 'U9–U12 coordinator'], ['iw.manager@squadroom-demo.test', 'Team manager'],
  ['iw.coach@squadroom-demo.test', 'Coach'], ['iw.parent@squadroom-demo.test', 'Parent of two'], ['iw.player@squadroom-demo.test', 'Over-35s player'],
  ['iw.welfare@squadroom-demo.test', 'Welfare officer'], ['iw.volunteers@squadroom-demo.test', 'Volunteer coordinator'],
]
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
try {
  for (const [email, label] of LOGINS) {
    const client = createClient(URL_, PUB, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD })
    if (error || !data.session) { bad(`${label}: ${error?.message ?? 'no session'}`); continue }
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    await page.setViewport({ width: 375, height: 812 })
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
    await page.setCookie({ name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(data.session)).toString('base64'), domain: 'localhost', path: '/' })
    await page.evaluateOnNewDocument((o) => { try { localStorage.setItem('squadroom.org', o) } catch {} }, IW)
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 90000 })
    await sleep(600)
    const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))
    const fits = await page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1)
    text.includes('Inner West') && text.length > 200 && fits ? ok(`${label}: signed in, Home shows Inner West FC (${text.length} chars)`) : bad(`${label}: ${text.slice(0, 120)}${fits ? '' : ' — wider than the phone'}`)
    if (SHOTS) await page.screenshot({ path: `.shots/inner-west-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`, fullPage: true })
    await context.close()
  }
} finally {
  await browser.close()
}
console.log(process.exitCode ? '' : '\n  \x1b[32mInner West FC is ready to show\x1b[0m\n')
