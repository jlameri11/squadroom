// Run: node --env-file=.env.local scripts/test-helpers.mjs
//   (needs the app running — npm run dev, or serve:test; SHOTS=1 saves the
//   screens at 375px, light and dark, in .shots/)
//
// G-07, helpers wanted (0225): a game or a club day lists the jobs it needs
// done — canteen, a linesman, set-up — each with a time on the day and a
// number of spots; families put their own names down; the coach sets the
// jobs, asks once, and can take someone off.
//
// Two halves, like test-match-photos. The screens are checked now, in a
// browser at 375px in light and dark, with 0225's answers stood in: a
// family puts their name down and takes it off, a full job says so, the
// coach builds the list from suggestions and asks the squad — and exactly
// what each sends. The rest runs against squadroom-dev once 0225 is
// applied, and says it is waiting until then; test-rls 150–154 prove the
// rules locally meanwhile.
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'
import { signInBoth } from './_auth.mjs'
import { resolveBaseUrl } from './_base-url.mjs'

const BASE = await resolveBaseUrl()
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const ref = URL_.split('//')[1].split('.')[0]
const host = new URL(URL_).host
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SHOTS = process.env.SHOTS === '1'
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const note = (m) => console.log(`  \x1b[2m… ${m}\x1b[0m`)
const head = (m) => console.log(`\n${m}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const OWNER = '00000000-0000-0000-0000-0000000000a1'
const MARCUS = '00000000-0000-0000-0000-0000000000a2'
const U8 = '00000000-0000-0000-0000-0000000d0008'
const TAG = 'TEST:: helpers'

const coach = await signInBoth(admin, 'p61400000002@squadroom.invalid')
const parent = await signInBoth(admin, 'p61400000011@squadroom.invalid')
const other = await signInBoth(admin, 'p61400000091@squadroom.invalid')
if (!coach || !parent || !other) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}
const { error: no0225 } = await admin.from('event_jobs').select('id').limit(1)
const has0225 = !no0225
if (SHOTS) mkdirSync('.shots', { recursive: true })

const { data: cl } = await admin.from('staff_clearances').select('id').eq('academy_id', NRIFA).eq('profile_id', MARCUS).maybeSingle()
const addedClearance = !cl
if (addedClearance) await admin.from('staff_clearances').insert({ academy_id: NRIFA, profile_id: MARCUS, kind: 'wwcc', number: 'WWC0000003E', outcome: 'cleared', expires_on: new Date(Date.now() + 400 * 864e5).toISOString().slice(0, 10), verified_by: OWNER })
const { data: mc } = await admin.from('team_members').select('role').eq('team_id', U8).eq('profile_id', MARCUS).maybeSingle()
const addedCoach = !mc
if (addedCoach) await admin.from('team_members').insert({ academy_id: NRIFA, team_id: U8, profile_id: MARCUS, role: 'coach' })

async function tidy() {
  const { data: evs } = await admin.from('events').select('id').like('title', `${TAG}%`)
  for (const e of evs ?? []) await admin.from('notification_queue').delete().filter('payload->>event_id', 'eq', e.id)
  await admin.from('events').delete().like('title', `${TAG}%`)
}
await tidy()
const day = new Date(Date.now() + 3 * 864e5)
const { data: ev } = await admin.from('events').insert({ academy_id: NRIFA, team_id: U8, type: 'match', title: `${TAG} v Hornsby`, opponent: 'Hornsby Heat', starts_at: day.toISOString(), ends_at: new Date(day.getTime() + 3600e3).toISOString(), created_by: OWNER }).select('id').single()

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })

async function open(who, path, answers = null) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 375, height: 812 })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
  await page.setCookie({ name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(who.session)).toString('base64'), domain: 'localhost', path: '/' })
  await page.evaluateOnNewDocument((org) => { try { localStorage.setItem('squadroom.org', org) } catch {} }, NRIFA)
  const calls = []
  if (answers) {
    await page.setRequestInterception(true)
    page.on('request', (r) => {
      const u = new URL(r.url())
      const fn = u.host === host && u.pathname.startsWith('/rest/v1/rpc/') ? u.pathname.slice('/rest/v1/rpc/'.length) : null
      if (fn && fn in answers && r.method() === 'POST') {
        let body = {}
        try { body = JSON.parse(r.postData() ?? '{}') } catch {}
        calls.push({ fn, body })
        const value = typeof answers[fn] === 'function' ? answers[fn](body) : answers[fn]
        r.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(value) }).catch(() => {})
        return
      }
      r.continue().catch(() => {})
    })
  }
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 90000 })
  return { context, page, calls }
}
const text = (page) => page.evaluate(() => document.body.innerText)
// The section's own words, as written — innerText would report the eyebrow in capitals.
const section = (page) => page.$eval('[data-helpers]', (e) => e.textContent ?? '').catch(() => '')
const fits = (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1)
async function bothThemes(page, name) {
  let fitted = true
  await page.$eval('[data-helpers]', (el) => el.scrollIntoView({ block: 'start' })).catch(() => null)
  for (const scheme of ['light', 'dark']) {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }])
    await sleep(250)
    fitted = fitted && (await fits(page))
    if (SHOTS) await page.screenshot({ path: `.shots/helpers-${name}-${scheme}.png` })
  }
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
  return fitted
}
async function clickText(page, label) {
  return page.$$eval('button', (bs, l) => {
    const b = bs.find((x) => x.textContent?.trim() === l)
    b?.click()
    return Boolean(b)
  }, label)
}

const ID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const sam = { profile_id: parent.session.user.id, name: 'Sam Whitfield' }

try {
  // ---------------------------------------------------------------------------
  head("1. A family puts their name down (0225's answers stood in)")
  {
    let canteen = [{ profile_id: ID(90), name: 'Priya Nair', me: false }]
    const linesman = [{ profile_id: ID(91), name: 'Dev Rahman', me: false }]
    const data = () => ({
      can_manage: false, can_help: true,
      jobs: [
        { id: ID(1), title: 'Canteen', start_time: '08:00', end_time: '10:00', time: '8:00 am–10:00 am', spots: 2, note: null, helpers: canteen },
        { id: ID(2), title: 'Linesman', start_time: null, end_time: null, time: null, spots: 1, note: null, helpers: linesman },
      ],
    })
    const { context, page, calls } = await open(parent, `/calendar/${ev.id}`, {
      event_helpers: data,
      help_with: (b) => { if (b.p_job === ID(1)) canteen = [...canteen, { ...sam, me: true }]; return data() },
      stop_helping: (b) => { if (b.p_job === ID(1) && !b.p_profile) canteen = canteen.filter((h) => !h.me); return data() },
    })
    await page.waitForSelector('[data-helpers]', { timeout: 20000 }).catch(() => null)
    let t = await section(page)
    t.includes('Helpers · 2 of 3') && t.includes('Canteen') && t.includes('8:00 am–10:00 am') ? ok('the game\'s Preview lists the jobs: "Helpers · 2 of 3", Canteen 8:00 am–10:00 am') : bad(`helpers: ${t.slice(0, 200)}`)
    ;(await page.$$('[data-helper-take]')).length === 1 && t.includes('Full') ? ok('"I can help" on the canteen; the linesman says Full') : bad('the buttons are wrong')
    t.includes('Edit') || t.includes('Ask for helpers') ? bad('a family is offered the coach\'s controls') : ok('a family is not offered the coach\'s controls')
    ;(await bothThemes(page, 'family')) ? ok('fits 375px, light and dark') : bad('wider than the phone')
    await page.$eval(`[data-helper-take="${ID(1)}"]`, (b) => b.click())
    await page.waitForFunction(() => document.body.innerText.includes("Can't now"), { timeout: 10000 }).catch(() => null)
    t = await section(page)
    calls.filter((c) => c.fn === 'help_with').length === 1 && t.includes('Priya Nair, You') && t.includes('Helpers · 3 of 3') ? ok('"I can help" puts Sam down: "Priya Nair, You", 3 of 3') : bad(`after: ${t.slice(0, 240)}`)
    await clickText(page, "Can't now")
    await page.waitForFunction(() => document.querySelector('[data-helpers]')?.textContent?.includes('Helpers · 2 of 3'), { timeout: 10000 }).catch(() => null)
    const stops = calls.filter((c) => c.fn === 'stop_helping')
    stops.length === 1 && stops[0].body.p_job === ID(1) && !('p_profile' in stops[0].body) ? ok('"Can\'t now" takes Sam off — Sam, not someone else') : bad(`stop: ${JSON.stringify(stops)}`)
    await context.close()
  }

  // ---------------------------------------------------------------------------
  head("2. The coach sets the jobs and asks the squad (stood in)")
  {
    let jobs = []
    const data = () => ({ can_manage: true, can_help: true, jobs })
    const { context, page, calls } = await open(coach, `/calendar/${ev.id}`, {
      event_helpers: data,
      set_event_jobs: (b) => {
        jobs = b.p_jobs.map((j, i) => ({ id: ID(10 + i), title: j.title, start_time: j.start_time, end_time: j.end_time, time: j.start_time ? `${Number(j.start_time.slice(0, 2)) % 12 || 12}:${j.start_time.slice(3)} am` : null, spots: j.spots, note: null, helpers: [] }))
        return data()
      },
      ask_for_helpers: () => 14,
    })
    await page.waitForSelector('[data-helpers-edit]', { timeout: 20000 }).catch(() => null)
    ;(await text(page)).includes('Need a hand on the day?') ? ok('with no jobs yet, the coach is offered "Ask for helpers"') : bad('no way in for the coach')
    await page.$eval('[data-helpers-edit]', (b) => b.click())
    await page.waitForSelector('[data-helpers-editor]', { timeout: 5000 }).catch(() => null)
    await page.$eval('[data-helper-suggest="Canteen"]', (b) => b.click())
    await page.$eval('[data-helper-suggest="Linesman"]', (b) => b.click())
    const drafts = await page.$$('[data-helper-draft]')
    drafts.length === 2 ? ok('the suggestions make two jobs in two taps') : bad(`${drafts.length} drafts`)
    await page.$eval('[data-helper-draft="0"] input[type="time"]', (el) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(el, '08:00')
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await page.$eval('[data-helper-draft="0"] input[type="number"]', (el) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(el, '2')
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
    ;(await bothThemes(page, 'editor')) ? ok('the editor fits 375px, light and dark') : bad('the editor is wider than the phone')
    await page.$eval('[data-helpers-save]', (b) => b.click())
    await page.waitForFunction(() => !document.querySelector('[data-helpers-editor]'), { timeout: 10000 }).catch(() => null)
    const saved = calls.filter((c) => c.fn === 'set_event_jobs')
    const sent = saved[0]?.body?.p_jobs ?? []
    saved.length === 1 && sent.length === 2 && sent[0].title === 'Canteen' && sent[0].start_time === '08:00' && sent[0].spots === 2 && sent[1].title === 'Linesman' && sent[1].spots === 1
      ? ok('"Save the jobs" sends the whole list: Canteen from 8:00 for two, Linesman for one')
      : bad(`saved: ${JSON.stringify(saved)}`)
    const ask = await page.$eval('[data-helpers-ask]', (b) => b.textContent?.trim()).catch(() => null)
    ask === 'Ask the squad — 3 spots open' ? ok('"Ask the squad — 3 spots open"') : bad(`ask button: ${ask}`)
    await page.$eval('[data-helpers-ask]', (b) => b.click())
    await page.waitForFunction(() => document.body.innerText.includes('Asked 14 people'), { timeout: 10000 }).catch(() => null)
    calls.filter((c) => c.fn === 'ask_for_helpers').length === 1 && (await text(page)).includes('Asked 14 people') ? ok('one tap asks, and says how many were asked') : bad('asking did not work')
    ;(await bothThemes(page, 'coach')) ? ok('fits 375px, light and dark') : bad('wider than the phone')
    await context.close()
  }

  // ---------------------------------------------------------------------------
  head('3. Against the database')
  if (!has0225) {
    note('waiting for 0225 on squadroom-dev (the Supabase token) — who sets jobs, putting a name down, a full job, the reminder, asking the squad and being taken off run then; test-rls 150–154 prove them locally meanwhile')
  } else {
    await endToEnd()
  }
} finally {
  await browser.close()
  await tidy()
  if (addedClearance) await admin.from('staff_clearances').delete().eq('academy_id', NRIFA).eq('profile_id', MARCUS).eq('number', 'WWC0000003E')
  if (addedCoach) await admin.from('team_members').delete().eq('team_id', U8).eq('profile_id', MARCUS)
}
console.log(process.exitCode ? '' : '\n  \x1b[32mhelpers wanted, and found\x1b[0m\n')

// -----------------------------------------------------------------------------
async function endToEnd() {
  const { error: e1 } = await parent.client.rpc('set_event_jobs', { p_event: ev.id, p_jobs: [{ title: 'Canteen' }] })
  e1?.code === '42501' ? ok('a family cannot set the jobs') : bad(`family set jobs: ${e1?.message}`)
  const { data: d1, error: e2 } = await coach.client.rpc('set_event_jobs', { p_event: ev.id, p_jobs: [{ title: 'Canteen', start_time: '08:00', end_time: '10:00', spots: 2 }, { title: 'Linesman', spots: 1 }] })
  const lines = d1?.jobs?.find((j) => j.title === 'Linesman')
  d1?.jobs?.length === 2 ? ok('the coach sets two jobs') : bad(`coach set jobs: ${e2?.message}`)
  const { data: d2 } = await parent.client.rpc('help_with', { p_job: lines.id })
  d2?.jobs?.find((j) => j.id === lines.id)?.helpers?.some((h) => h.me) ? ok('Sam takes the linesman\'s flag') : bad('Sam could not put a name down')
  const { data: rem } = await admin.from('notification_queue').select('scheduled_for, title').eq('kind', 'helper_reminder').eq('profile_id', parent.session.user.id).filter('payload->>event_id', 'eq', ev.id).is('sent_at', null)
  const at = rem?.[0] ? new Date(rem[0].scheduled_for).toLocaleString('en-AU', { timeZone: 'Australia/Sydney', hour: 'numeric', minute: '2-digit' }) : null
  rem?.length === 1 && /6:00\s?pm/i.test(at ?? '') ? ok(`and is reminded the evening before at ${at}: "${rem[0].title}"`) : bad(`reminder: ${JSON.stringify(rem)} ${at}`)
  const { error: e3 } = await other.client.rpc('event_helpers', { p_event: ev.id })
  e3 ? ok('another club sees none of it') : bad('another club read the helpers')
  const n = (await coach.client.rpc('ask_for_helpers', { p_event: ev.id })).data
  const { data: pushes } = await admin.from('notification_queue').select('profile_id, title, body').eq('kind', 'helpers_wanted').filter('payload->>event_id', 'eq', ev.id)
  n > 0 && pushes?.some((p) => p.profile_id === parent.session.user.id) && pushes.every((p) => p.body.includes('Canteen')) ? ok(`asking reaches the squad (${n}), naming what is open`) : bad(`ask: ${n} ${JSON.stringify(pushes?.slice(0, 2))}`)
  await coach.client.rpc('stop_helping', { p_job: lines.id, p_profile: parent.session.user.id })
  const { data: told } = await admin.from('notification_queue').select('title').eq('kind', 'helper_changed').eq('profile_id', parent.session.user.id).filter('payload->>event_id', 'eq', ev.id)
  told?.length === 1 ? ok(`taken off by the coach, Sam is told: "${told[0].title}"`) : bad(`told: ${JSON.stringify(told)}`)
  const { context, page } = await open(parent, `/calendar/${ev.id}`)
  await page.waitForSelector('[data-helpers]', { timeout: 20000 }).catch(() => null)
  ;(await page.$$('[data-helper-take]')).length === 2 && (await fits(page)) ? ok('Sam\'s real page offers both jobs again, at 375px') : bad('the real page is wrong')
  await context.close()
}
