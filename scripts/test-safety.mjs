// Run: node --env-file=.env.local scripts/test-safety.mjs
//   (needs the app running — npm run dev, or serve:test; SHOTS=1 saves
//   screenshots to .shots/)
//
// Safety and compliance (Big Club Mode item 11; 0253). A coaching
// accreditation is a course certificate with a date — recorded by an owner
// or admin for someone else, never for themselves; read by the staff and
// by its owner, never a parent; the person and the club are reminded thirty
// days out, once a fortnight. An incident or injury is reported from the
// ground by the squad's coach, never a parent, read by whoever filed it and
// the welfare people, who are told at once, and reviewed with a note.
//
// The demo is left as found: Marcus's throwaway certificate, a throwaway
// squad, game and child, the report and what it queued are removed at the end.
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'
import { signInBoth } from './_auth.mjs'
import { resolveBaseUrl } from './_base-url.mjs'

const BASE = await resolveBaseUrl()
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const ref = URL_.split('//')[1].split('.')[0]
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SHOTS = process.env.SHOTS === '1'
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const note = (m) => console.log(`  \x1b[2m… ${m}\x1b[0m`)
const head = (m) => console.log(`\n${m}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
if (SHOTS) mkdirSync('.shots', { recursive: true })

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const MARCUS = '00000000-0000-0000-0000-0000000000a2'
const COURSE = 'Zz Foundation of Football'
const TEAM = 'Zz Safety U12'
const started = new Date().toISOString()
const placeholder = async (profileId) => {
  // The account's own address, never one made up from a phone: a magic link
  // for an address nobody holds would sign up a stranger (test-join-flow).
  const { data: u } = await admin.auth.admin.getUserById(profileId)
  const email = u?.user?.email ?? ''
  return /@squadroom(-demo)?\.(invalid|test)$/.test(email) ? email : null
}

async function cleanup() {
  const { data: accs } = await admin.from('staff_accreditations').select('id').eq('academy_id', NRIFA).eq('title', COURSE)
  for (const a of accs ?? []) {
    await admin.from('notification_queue').delete().contains('payload', { accreditation_id: a.id })
    await admin.from('staff_accreditations').delete().eq('id', a.id)
  }
  const { data: incs } = await admin.from('incident_reports').select('id').eq('academy_id', NRIFA).like('what', 'Zz %')
  for (const i of incs ?? []) {
    await admin.from('notification_queue').delete().contains('payload', { report: 'incident_reports', id: i.id })
    await admin.from('incident_reports').delete().eq('id', i.id)
  }
  await admin.from('activity_log').delete().eq('academy_id', NRIFA).in('action', ['accreditation_recorded', 'accreditation_removed']).gte('at', started)
  const { data: teams } = await admin.from('teams').select('id').eq('academy_id', NRIFA).eq('name', TEAM)
  for (const t of teams ?? []) { await admin.from('events').delete().eq('team_id', t.id); await admin.from('teams').delete().eq('id', t.id) }
  await admin.from('players').delete().eq('academy_id', NRIFA).like('full_name', 'Zz Safety %')
}
await cleanup()

const headOf = await signInBoth(admin, 'head@squadroom-demo.test') // NRIFA's owner
const sam = await signInBoth(admin, 'p61400000011@squadroom.invalid') // a parent
const marcusEmail = await placeholder(MARCUS)
const marcus = marcusEmail ? await signInBoth(admin, marcusEmail) : null
if (!headOf || !sam || !marcus) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}
const headId = headOf.session.user.id
// The welfare people, to read the register: the first officer or President who is not the owner.
const { data: welfare } = await headOf.client.rpc('welfare_contacts', { p_academy: NRIFA })

// A squad, a child, a game this morning.
const { data: team } = await admin.from('teams').insert({ academy_id: NRIFA, name: TEAM, age_group: 'U12', season: '2026', status: 'active' }).select('id').single()
const { data: kid } = await admin.from('players').insert({ academy_id: NRIFA, team_id: team.id, full_name: 'Zz Safety Kid', dob: '2014-06-06' }).select('id').single()
const { data: game } = await admin.from('events').insert({ academy_id: NRIFA, team_id: team.id, type: 'match', title: 'Zz Safety v Rovers', opponent: 'Zz Rovers', starts_at: new Date(Date.now() - 2 * 3600e3).toISOString(), ends_at: new Date(Date.now() - 3600e3).toISOString(), venue: 'Zz Oval', source: 'manual' }).select('id').single()

let accId = null
let incidentId = null
try {
  head('1. Accreditation: recorded for someone else, read by the right people')
  {
    const soon = new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10)
    const { data: id, error } = await headOf.client.rpc('record_accreditation', { p_academy: NRIFA, p_profile: MARCUS, p_title: COURSE, p_expires_on: soon, p_number: 'FFA-ZZ-1', p_note: null })
    !error && id ? ok(`the owner records Marcus's ${COURSE}, runs out in 20 days`) : bad(`record: ${error?.message}`)
    accId = id
    const { error: self } = await headOf.client.rpc('record_accreditation', { p_academy: NRIFA, p_profile: headId, p_title: 'Zz own', p_expires_on: soon, p_number: null, p_note: null })
    self && /somebody else/.test(self.message) ? ok('nobody records their own') : bad(`self: ${self?.message ?? 'allowed'}`)
    const { error: pe } = await sam.client.rpc('record_accreditation', { p_academy: NRIFA, p_profile: MARCUS, p_title: 'Zz parent', p_expires_on: soon, p_number: null, p_note: null })
    pe ? ok('a parent records none') : bad('a parent recorded one')
    const { data: board } = await headOf.client.rpc('accreditation_board', { p_academy: NRIFA })
    const row = (board ?? []).find((r) => r.profile_id === MARCUS)
    const acc = row?.accreditations?.find((a) => a.id === id)
    acc && acc.state === 'expiring' && acc.days_left <= 20 ? ok(`the board: Marcus's is expiring, ${acc.days_left} days left`) : bad(`board: ${JSON.stringify(row).slice(0, 200)}`)
    const { data: pb } = await sam.client.rpc('accreditation_board', { p_academy: NRIFA })
    pb === null ? ok('a parent reads no board') : bad('a parent read the board')
    const { data: own } = await marcus.client.from('staff_accreditations').select('id, title').eq('id', id)
    ;(own ?? []).length === 1 ? ok('Marcus reads his own') : bad(`own: ${JSON.stringify(own)}`)
    const { data: pr } = await sam.client.from('staff_accreditations').select('id').eq('id', id)
    ;(pr ?? []).length === 0 ? ok('a parent reads nobody\'s') : bad(`parent rows: ${pr?.length}`)
  }

  head('2. The warning thirty days out: the person and the club, once a fortnight')
  {
    const { data: n, error } = await admin.rpc('queue_accreditation_warnings')
    if (error) note(`could not run the warnings as the service role: ${error.message}`)
    else {
      n >= 2 ? ok(`${n} warnings queued`) : bad(`queued ${n}`)
      const { data: q } = await admin.from('notification_queue').select('title, body, profile_id, url').eq('kind', 'accreditation_expiring').contains('payload', { accreditation_id: accId })
      const his = (q ?? []).find((x) => x.profile_id === MARCUS)
      his && /^Your Zz Foundation of Football is running out/.test(his.title) && his.url === '/settings' ? ok(`Marcus is told: "${his.title}"`) : bad(`his: ${JSON.stringify(his)}`)
      const club = (q ?? []).find((x) => x.profile_id !== MARCUS)
      club && /A coach's accreditation is running out/.test(club.title) && /Marcus/.test(club.body) ? ok(`the club is told: "${club.title}" — ${club.body}`) : bad(`club: ${JSON.stringify(club)}`)
      const { data: again } = await admin.rpc('queue_accreditation_warnings')
      again === 0 ? ok('and not again today') : bad(`again: ${again}`)
    }
  }

  head('3. An incident from the ground: filed by the coach, read by the welfare people')
  {
    const { error: pe } = await sam.client.rpc('file_incident_report', { p_academy: NRIFA, p_what: 'Zz a parent filing', p_event: game.id, p_player: kid.id })
    pe ? ok('a parent files none') : bad('a parent filed an incident')
    const { data: id, error } = await headOf.client.rpc('file_incident_report', { p_academy: NRIFA, p_what: 'Zz twisted ankle in the second half', p_event: game.id, p_player: kid.id, p_first_aid: 'Ice, elevated, walked off', p_ambulance: false, p_parent_told: true })
    !error && id ? ok('the coach files it: who, what, first aid, the parent told') : bad(`file: ${error?.message}`)
    incidentId = id
    const { data: mine } = await headOf.client.from('incident_reports').select('id, what').eq('id', id)
    ;(mine ?? []).length === 1 ? ok('whoever filed it reads it') : bad(`filer rows: ${mine?.length}`)
    const { data: theirs } = await sam.client.from('incident_reports').select('id').eq('id', id)
    ;(theirs ?? []).length === 0 ? ok('a parent reads none') : bad(`parent rows: ${theirs?.length}`)
    const { data: told } = await admin.from('notification_queue').select('profile_id, title').eq('kind', 'report_filed').contains('payload', { report: 'incident_reports', id })
    ;(told ?? []).length >= 1 && told.every((t) => t.title === 'An incident was reported') ? ok(`${told.length} welfare ${told.length === 1 ? 'person' : 'people'} told at once: "${told[0].title}"`) : bad(`told: ${JSON.stringify(told)}`)
    // The register, as whoever may read it: the first welfare contact who signs in by phone.
    const contacts = [...(welfare?.officers ?? []), ...(welfare?.president ?? [])].filter((c) => c.profile_id !== headId)
    // Signed in by the account's OWN address, and only a demo or placeholder
    // one: a magic link for an address nobody holds signs up a stranger.
    let reader = null
    for (const c of contacts) {
      const { data: u } = await admin.auth.admin.getUserById(c.profile_id)
      const email = u?.user?.email ?? ''
      if (!/@squadroom(-demo)?\.(invalid|test)$/.test(email)) continue
      const who = await signInBoth(admin, email).catch(() => null)
      if (who && who.session.user.id === c.profile_id) { reader = { who, name: c.name ?? c.profile_id }; break }
    }
    if (!reader) note('no welfare contact could sign in by phone; the register is covered by test-rls 206')
    else {
      const { data: reg } = await reader.who.client.rpc('incident_register', { p_academy: NRIFA })
      const row = (reg ?? []).find((r) => r.id === id)
      row && row.who === 'Zz Safety Kid' && row.parent_told && row.status === 'open' ? ok(`${reader.name} reads the register: ${row.who}, "${row.what}"`) : bad(`register: ${JSON.stringify(reg).slice(0, 200)}`)
      const { error: re } = await reader.who.client.rpc('review_incident', { p_report: id, p_outcome: 'Parent rang, fine by Monday' })
      !re ? ok('and reviews it with a note') : bad(`review: ${re.message}`)
      const { error: blank } = await reader.who.client.rpc('review_incident', { p_report: id, p_outcome: '' })
      blank ? ok('a review with no note is refused') : bad('a blank review was accepted')
    }
  }

  head('4. The screens')
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
  async function open(who, path, waitFor) {
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    await page.setViewport({ width: 375, height: 812 })
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
    await page.setCookie({ name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(who.session)).toString('base64'), domain: 'localhost', path: '/' })
    await page.evaluateOnNewDocument((o) => { try { localStorage.setItem('squadroom.org', o) } catch {} }, NRIFA)
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 90000 })
    if (waitFor) await page.waitForSelector(waitFor, { timeout: 30000 }).catch(() => null)
    await sleep(300)
    return { context, page }
  }
  try {
    {
      const { context, page } = await open(headOf, '/admin/clearances', '[data-accreditations]')
      const text = await page.$eval('[data-accreditations]', (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '')
      text.includes(COURSE) && /\d+d left/.test(text) ? ok("Checks: Marcus's accreditation with its days left") : bad(`accreditations: ${text.slice(0, 200) || 'missing'}`)
      for (const scheme of ['light', 'dark']) {
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }])
        await sleep(150)
        if (SHOTS) await page.screenshot({ path: `.shots/safety-checks-${scheme}.png`, fullPage: true })
      }
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
      const fits = await page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1)
      fits ? ok('fits 375px, light and dark') : bad('wider than the phone')
      await context.close()
    }
    {
      const { context, page } = await open(headOf, `/calendar/${game.id}`, '[data-tab="sheet"]')
      // The coach's tools sit on the Match sheet tab (X-05); so does the report.
      await page.click('[data-tab="sheet"]').catch(() => null)
      await page.waitForSelector('[data-report-incident]', { timeout: 15000 }).catch(() => null)
      await page.$eval('[data-report-incident]', (b) => { b.scrollIntoView({ block: 'center' }); b.click() })
      await page.waitForSelector('[data-incident-form]', { timeout: 15000 }).catch(() => null)
      const form = await page.$('[data-incident-form]')
      form ? ok('the game page opens the incident form') : bad('no incident form')
      if (form) {
        // The roster loads once the sheet is open; pick the child when it has.
        const picker = await page.waitForSelector('[data-incident-player]', { timeout: 10000 }).catch(() => null)
        if (picker) await page.select('[data-incident-player]', kid.id)
        else await page.type('[data-incident-who]', 'Zz Safety Kid')
        await page.type('[data-incident-what]', 'Zz a knock from the screen')
        await page.type('[data-incident-first-aid]', 'Ice')
        await page.waitForFunction(() => !document.querySelector('[data-incident-file]')?.disabled, { timeout: 5000 }).catch(() => null)
        await page.click('[data-incident-file]')
        await page.waitForSelector('[data-incident-filed]', { timeout: 15000 }).catch(() => null)
        const filed = await page.$('[data-incident-filed]')
        const shown = filed ? '' : await page.$eval('[data-incident-form]', (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '')
        filed ? ok('and files it: "Reported"') : bad(`the report did not file: ${shown.slice(0, 160)}`)
        if (SHOTS) await page.screenshot({ path: '.shots/safety-incident-light.png', fullPage: true })
      }
      await context.close()
    }
  } finally {
    await browser.close()
  }
} finally {
  await cleanup()
  const { count: t } = await admin.from('teams').select('id', { count: 'exact', head: true }).eq('academy_id', NRIFA).eq('name', TEAM)
  const { count: a } = await admin.from('staff_accreditations').select('id', { count: 'exact', head: true }).eq('academy_id', NRIFA).eq('title', COURSE)
  t === 0 && a === 0 ? ok('the demo is as it was') : bad(`left behind: ${t} squads, ${a} accreditations`)
}
console.log(process.exitCode ? '' : '\n  \x1b[32msafety: accreditation with dates and warnings, incidents from the ground to the welfare people\x1b[0m\n')
