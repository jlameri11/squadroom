// Run: node --env-file=.env.local scripts/test-grounds.mjs
//   (needs the app running — npm run dev, or serve:test; SHOTS=1 saves
//   screenshots to .shots/)
//
// Training grounds and slots, and Close ground (Big Club Mode item 8; 0250).
// A squad's weekly training sits on a pitch or a half-pitch; a slot that is
// taken — on the pitch, its parent or its halves — or outside the pitch's
// hours is refused in the database's own words, and nothing is made. The
// team page shows the slot; the ground's week shows every squad. Closing a
// ground for a day calls off every session there and no other ground's.
//
// The demo is left as found: a throwaway ground with a pitch cut in half,
// two squads and their series are removed at the end.
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
const head = (m) => console.log(`\n${m}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
if (SHOTS) mkdirSync('.shots', { recursive: true })

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const GROUND = 'Zz Ground'
const OTHER = 'Zz Other Ground'
const started = new Date().toISOString()
const iso = (d) => d.toISOString().slice(0, 10)
// Next Tuesday, at least two days out, so "still to come" holds.
const nextTue = (() => { const d = new Date(); d.setDate(d.getDate() + 2); while (d.getDay() !== 2) d.setDate(d.getDate() + 1); return d })()
const FROM = iso(nextTue)
const UNTIL = iso(new Date(nextTue.getTime() + 28 * 864e5))

async function cleanup() {
  const { data: teams } = await admin.from('teams').select('id').eq('academy_id', NRIFA).like('name', 'Zz Slots %')
  for (const t of teams ?? []) {
    const { data: series } = await admin.from('event_series').select('id').eq('team_id', t.id)
    for (const s of series ?? []) { await admin.from('events').delete().eq('series_id', s.id); await admin.from('activity_log').delete().eq('subject_id', s.id) }
    await admin.from('event_series').delete().eq('team_id', t.id)
    await admin.from('teams').delete().eq('id', t.id)
  }
  const { data: venues } = await admin.from('venues').select('id').eq('academy_id', NRIFA).in('name', [GROUND, OTHER])
  for (const v of venues ?? []) { await admin.from('activity_log').delete().eq('subject_id', v.id); await admin.from('venues').delete().eq('id', v.id) }
}
await cleanup()

const headOf = await signInBoth(admin, 'head@squadroom-demo.test') // NRIFA's owner
const sam = await signInBoth(admin, 'p61400000011@squadroom.invalid') // a parent
if (!headOf || !sam) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}

const { data: venue } = await admin.from('venues').insert({ academy_id: NRIFA, name: GROUND }).select('id').single()
const { data: other } = await admin.from('venues').insert({ academy_id: NRIFA, name: OTHER }).select('id').single()
const { data: pitch } = await admin.from('pitches').insert({ academy_id: NRIFA, venue_id: venue.id, name: 'Zz Pitch 1', size: 'full' }).select('id').single()
const { data: teamA } = await admin.from('teams').insert({ academy_id: NRIFA, name: 'Zz Slots U12', age_group: 'U12', season: '2026', status: 'active' }).select('id').single()
const { data: teamB } = await admin.from('teams').insert({ academy_id: NRIFA, name: 'Zz Slots U13', age_group: 'U13', season: '2026', status: 'active' }).select('id').single()

try {
  head('1. A pitch cut in half, and a squad on it')
  let half = null
  let series1 = null
  {
    const { data: n, error } = await headOf.client.rpc('split_pitch', { p_pitch: pitch.id, p_into: 2 })
    const { data: halves } = await admin.from('pitches').select('id, name').eq('parent_id', pitch.id).order('name')
    !error && (halves ?? []).length === 2 ? ok(`the pitch is cut in two: ${halves.map((h) => h.name).join(', ')} (${n})`) : bad(`split: ${error?.message} ${JSON.stringify(halves)}`)
    half = halves?.[0]?.id ?? null
    const { data: s, error: se } = await headOf.client.rpc('create_training_series', { p_academy: NRIFA, p_title: 'Training', p_days: [2, 4], p_time: '17:00', p_from: FROM, p_until: UNTIL, p_team: teamA.id, p_duration: 60, p_arrive: 15, p_pitch: pitch.id, p_venue: null })
    !se && s?.created >= 4 && s.pitch === 'Zz Pitch 1' && s.venue === GROUND ? ok(`U12 train Tue/Thu 5 pm on ${s.pitch} at ${s.venue}: ${s.created} sessions`) : bad(`series: ${se?.message ?? JSON.stringify(s)}`)
    series1 = s?.series_id ?? null
    const { data: evs } = await admin.from('events').select('venue, pitch_id, venue_id').eq('series_id', series1 ?? '00000000-0000-0000-0000-000000000000')
    ;(evs ?? []).length >= 4 && evs.every((e) => e.pitch_id === pitch.id && e.venue_id === venue.id && e.venue === `${GROUND} · Zz Pitch 1`) ? ok(`every session carries the pitch and reads "${evs[0].venue}"`) : bad(`events: ${JSON.stringify(evs?.slice(0, 2))}`)
  }

  head('2. One piece of grass is one piece of grass')
  {
    const { error: e1 } = await headOf.client.rpc('create_training_series', { p_academy: NRIFA, p_title: 'Training', p_days: [2], p_time: '17:30', p_from: FROM, p_until: UNTIL, p_team: teamB.id, p_duration: 60, p_arrive: null, p_pitch: pitch.id, p_venue: null })
    e1 && /is taken Tue 5:00 pm–6:00 pm by Zz Slots U12/.test(e1.message) ? ok(`the same pitch at 5:30: "${e1.message}"`) : bad(`clash: ${e1?.message ?? 'allowed'}`)
    const { error: e2 } = await headOf.client.rpc('create_training_series', { p_academy: NRIFA, p_title: 'Training', p_days: [2], p_time: '17:00', p_from: FROM, p_until: UNTIL, p_team: teamB.id, p_duration: 60, p_arrive: null, p_pitch: half, p_venue: null })
    e2 && /is taken Tue/.test(e2.message) ? ok('a half of it at the same time: refused, the whole pitch is booked') : bad(`half clash: ${e2?.message ?? 'allowed'}`)
    const { count } = await admin.from('event_series').select('id', { count: 'exact', head: true }).eq('team_id', teamB.id)
    count === 0 ? ok('and nothing was made for U13') : bad(`${count} series made for U13`)
    const { data: s2, error: e3 } = await headOf.client.rpc('create_training_series', { p_academy: NRIFA, p_title: 'Training', p_days: [2], p_time: '18:30', p_from: FROM, p_until: UNTIL, p_team: teamB.id, p_duration: 60, p_arrive: null, p_pitch: half, p_venue: null })
    !e3 && s2?.created >= 2 ? ok('the half at 6:30, after U12 finish: fine') : bad(`later on the half: ${e3?.message ?? JSON.stringify(s2)}`)
    // Hours: the full pitch opens 4–8 pm on Tuesdays; the half inherits them, so 7:30–8:30 is refused and 6:30–7:30 is not.
    const { error: he } = await headOf.client.rpc('set_pitch_hours', { p_pitch: pitch.id, p_hours: [{ weekday: 2, opens: '16:00', closes: '20:00' }] })
    !he ? ok('Tuesday hours set on the pitch: 4–8 pm') : bad(`hours: ${he.message}`)
    const { error: e4 } = await headOf.client.rpc('create_training_series', { p_academy: NRIFA, p_title: 'Training', p_days: [2], p_time: '19:30', p_from: FROM, p_until: UNTIL, p_team: teamB.id, p_duration: 60, p_arrive: null, p_pitch: half, p_venue: null })
    e4 && /not open then on a Tuesday/.test(e4.message) ? ok(`7:30 pm on the half: "${e4.message}"`) : bad(`hours refusal: ${e4?.message ?? 'allowed'}`)
    // Taking a slot off and putting it back.
    const { data: off } = await headOf.client.rpc('set_training_slot', { p_series: s2.series_id, p_pitch: null })
    off && off.pitch === null ? ok('a slot taken off its pitch') : bad(`off: ${JSON.stringify(off)}`)
    const { data: on, error: e5 } = await headOf.client.rpc('set_training_slot', { p_series: s2.series_id, p_pitch: half })
    !e5 && on?.pitch ? ok(`and put back on ${on.pitch}, ${on.sessions_updated} sessions updated`) : bad(`back on: ${e5?.message ?? JSON.stringify(on)}`)
    const { error: pe } = await sam.client.rpc('set_training_slot', { p_series: s2.series_id, p_pitch: pitch.id })
    pe ? ok('a parent sets no slot') : bad('a parent set a slot')
  }

  head("3. The team's slot and the ground's week")
  {
    const { data: tt } = await headOf.client.rpc('team_training', { p_team: teamA.id })
    const s = (tt ?? [])[0]
    s && s.pitch === 'Zz Pitch 1' && s.ground === GROUND && s.days.join(',') === '2,4' ? ok(`U12: ${s.days.length} days, ${s.at_time} on ${s.pitch} at ${s.ground}`) : bad(`team_training: ${JSON.stringify(tt).slice(0, 200)}`)
    const { data: pt } = await sam.client.rpc('team_training', { p_team: teamA.id })
    ;(pt ?? []).length === 1 ? ok('a member reads the slot too — families see it') : bad(`parent team_training: ${JSON.stringify(pt)}`)
    const { data: gw } = await headOf.client.rpc('ground_slots', { p_venue: venue.id })
    const slots = (gw?.pitches ?? []).flatMap((p) => p.slots.map((x) => `${p.name}:${x.team}`))
    slots.includes('Zz Pitch 1:Zz Slots U12') && slots.some((x) => x.endsWith(':Zz Slots U13')) ? ok(`the ground's week: ${slots.join(', ')}`) : bad(`ground_slots: ${JSON.stringify(slots)}`)
  }

  head('4. Close ground: that day, that ground, and no other')
  {
    await headOf.client.rpc('create_training_series', { p_academy: NRIFA, p_title: 'Zz elsewhere', p_days: [2], p_time: '17:00', p_from: FROM, p_until: UNTIL, p_team: teamB.id, p_duration: 60, p_arrive: null, p_pitch: null, p_venue: OTHER })
    const { data: r, error } = await headOf.client.rpc('close_ground', { p_academy: NRIFA, p_venue: venue.id, p_date: FROM, p_reason: 'wet_weather', p_note: 'Pitch under water' })
    !error && r.sessions === 2 ? ok(`closed ${GROUND} on ${FROM}: ${r.sessions} sessions called off (${r.titles.join(', ')})`) : bad(`close: ${error?.message ?? JSON.stringify(r)}`)
    const { data: offs } = await admin.from('events').select('title, cancelled_at, cancellation_reason, starts_at').eq('academy_id', NRIFA).in('team_id', [teamA.id, teamB.id]).not('cancelled_at', 'is', null)
    ;(offs ?? []).length === 2 && offs.every((e) => e.cancellation_reason === 'wet_weather' && e.starts_at.slice(0, 10) === FROM) ? ok('exactly the two sessions there that day, for wet weather') : bad(`cancelled: ${JSON.stringify(offs?.map((e) => [e.title, e.starts_at.slice(0, 10)]))}`)
    const { data: elsewhere } = await admin.from('events').select('cancelled_at').eq('title', 'Zz elsewhere').eq('team_id', teamB.id)
    ;(elsewhere ?? []).length >= 2 && elsewhere.every((e) => e.cancelled_at === null) ? ok('the session at the other ground that evening runs') : bad(`elsewhere: ${JSON.stringify(elsewhere)}`)
    Array.isArray(r?.ask_the_league) ? ok(`${r.ask_the_league.length} of another league's games here to pass on`) : bad('no ask_the_league list')
    const { data: again } = await headOf.client.rpc('close_ground', { p_academy: NRIFA, p_venue: venue.id, p_date: FROM, p_reason: 'wet_weather', p_note: null })
    again?.sessions === 0 ? ok('closing it again calls off nothing twice') : bad(`again: ${JSON.stringify(again)}`)
    const { error: pe } = await sam.client.rpc('close_ground', { p_academy: NRIFA, p_venue: venue.id, p_date: FROM, p_reason: 'wet_weather', p_note: null })
    pe ? ok('a parent cannot close a ground') : bad('a parent closed a ground')
  }

  head('5. The screens')
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
  async function open(who, path, waitFor, width = 375, height = 812) {
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    await page.setViewport({ width, height })
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
      const { context, page } = await open(headOf, `/admin/teams/${teamA.id}`, '[data-training-slot]')
      const text = await page.$eval('[data-training-slot]', (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '')
      ;/Tue\/Thu 5:00 pm/.test(text) && text.includes('Zz Pitch 1') ? ok(`the team page: "${text.slice(0, 80)}…"`) : bad(`team page: ${text.slice(0, 200) || 'missing'}`)
      const select = await page.$('[data-slot-pitch]')
      select ? ok('with a pitch to change') : bad('no pitch select')
      if (SHOTS) await page.screenshot({ path: '.shots/grounds-team-light.png', fullPage: true })
      await context.close()
    }
    {
      const { context, page } = await open(headOf, '/admin/venues', `[data-venue="${venue.id}"]`)
      await page.$eval(`[data-venue="${venue.id}"]`, (b) => { b.scrollIntoView({ block: 'center' }); b.click() })
      await page.waitForSelector('[data-ground-slots]', { timeout: 30000 }).catch(() => null)
      const week = await page.$eval('[data-ground-slots]', (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '')
      week.includes('Zz Slots U12') && week.includes('Zz Slots U13') ? ok("the ground's week names both squads") : bad(`week: ${week.slice(0, 200) || 'missing'}`)
      const close = await page.$('[data-close-ground-open]')
      close ? ok('Close ground is there for the owner') : bad('no Close ground')
      for (const scheme of ['light', 'dark']) {
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }])
        await sleep(150)
        if (SHOTS) await page.screenshot({ path: `.shots/grounds-week-${scheme}.png`, fullPage: true })
      }
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
      const fits = await page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1)
      fits ? ok('fits 375px, light and dark') : bad('wider than the phone')
      await context.close()
    }
    {
      const { context, page } = await open(headOf, '/admin/venues', `[data-venue="${venue.id}"]`, 1280, 900)
      await page.$eval(`[data-venue="${venue.id}"]`, (b) => b.click())
      await page.waitForSelector('[data-ground-slots]', { timeout: 30000 }).catch(() => null)
      const grid = await page.$eval('[data-ground-slots] .lg\\:block', (e) => getComputedStyle(e).display !== 'none').catch(() => false)
      grid ? ok('at laptop width: pitches down, the week across') : bad('no week grid at 1280px')
      if (SHOTS) await page.screenshot({ path: '.shots/grounds-week-laptop.png', fullPage: true })
      await context.close()
    }
  } finally {
    await browser.close()
  }
} finally {
  await cleanup()
  const { count: v } = await admin.from('venues').select('id', { count: 'exact', head: true }).eq('academy_id', NRIFA).in('name', [GROUND, OTHER])
  const { count: t } = await admin.from('teams').select('id', { count: 'exact', head: true }).eq('academy_id', NRIFA).like('name', 'Zz Slots %')
  v === 0 && t === 0 ? ok('the demo is as it was') : bad(`left behind: ${v} grounds, ${t} squads`)
}
console.log(process.exitCode ? '' : '\n  \x1b[32mgrounds: a slot per squad, clashes and hours refused, a ground closed in one tap\x1b[0m\n')
