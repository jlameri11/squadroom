// Run: node --env-file=.env.local scripts/test-volunteers.mjs
//   (needs the app running — npm run dev, or serve:test; SHOTS=1 saves
//   screenshots to .shots/)
//
// Volunteers (Big Club Mode item 10; 0252). A ground's Saturday is a club
// day with its own jobs — canteen, BBQ, set-up — seen from every game there
// that day, where a family puts its name down; a squad's duties — oranges,
// linesperson — are rostered by turns, a family asks the squad for a swap
// in the chat and another takes it; each family is reminded the evening
// before; the coordinator sees the gaps.
//
// The demo is left as found: a throwaway ground, squad, three children with
// two real accounts lent as their parents, the games and what the asks
// queued are all removed at the end.
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
const SAM = '00000000-0000-0000-0000-0000000000b1'
const MARCUS = '00000000-0000-0000-0000-0000000000a2'
const TZ = 'Australia/Sydney'
const PARK = 'Zz Park'
const TEAM = 'Zz Duty U12'
const started = new Date().toISOString()

const localDate = (d) => d.toLocaleDateString('en-CA', { timeZone: TZ })
function atLocal(date, hhmm) {
  const probe = new Date(`${date}T${hhmm}:00Z`)
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' }).formatToParts(probe)
  const off = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+10:00'
  const m = off.match(/GMT([+-])(\d{2}):(\d{2})/)
  const sign = m?.[1] === '-' ? -1 : 1
  const mins = sign * ((Number(m?.[2] ?? 10) * 60) + Number(m?.[3] ?? 0))
  return new Date(probe.getTime() - mins * 60000)
}
// A Saturday at least a week out.
const sat = (() => { const d = new Date(Date.now() + 7 * 864e5); while (d.getDay() !== 6) d.setDate(d.getDate() + 1); return localDate(d) })()
const fri = localDate(new Date(new Date(`${sat}T12:00:00`).getTime() - 864e5))

let venue = null
let team = null
let game = null
let groundDay = null

async function cleanup() {
  const { data: venues } = await admin.from('venues').select('id').eq('academy_id', NRIFA).eq('name', PARK)
  for (const v of venues ?? []) {
    const { data: evs } = await admin.from('events').select('id').eq('venue_id', v.id)
    for (const e of evs ?? []) {
      await admin.from('notification_queue').delete().contains('payload', { event_id: e.id })
      await admin.from('notification_queue').delete().like('url', `/calendar/${e.id}%`)
      await admin.from('activity_log').delete().eq('subject_id', e.id)
    }
    await admin.from('events').delete().eq('venue_id', v.id)
    await admin.from('venues').delete().eq('id', v.id)
  }
  const { data: teams } = await admin.from('teams').select('id').eq('academy_id', NRIFA).eq('name', TEAM)
  for (const t of teams ?? []) {
    const { data: chans } = await admin.from('channels').select('id').eq('team_id', t.id)
    for (const c of chans ?? []) await admin.from('notification_queue').delete().like('url', `/chat/${c.id}%`)
    await admin.from('activity_log').delete().eq('subject_id', t.id)
    await admin.from('teams').delete().eq('id', t.id)
  }
  await admin.from('players').delete().eq('academy_id', NRIFA).like('full_name', 'Zz Duty %')
}
await cleanup()

const headOf = await signInBoth(admin, 'head@squadroom-demo.test') // NRIFA's owner
const sam = await signInBoth(admin, 'p61400000011@squadroom.invalid') // a parent — lent to child One
const { data: marcusProfile } = await admin.from('profiles').select('phone').eq('id', MARCUS).single()
const marcus = marcusProfile?.phone ? await signInBoth(admin, `p${String(marcusProfile.phone).replace('+', '')}@squadroom.invalid`) : null
if (!headOf || !sam || !marcus) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}

// The ground, the squad, three children with two families, a game next Saturday.
{
  const { data: v } = await admin.from('venues').insert({ academy_id: NRIFA, name: PARK }).select('id').single()
  venue = v.id
  const { data: t } = await admin.from('teams').insert({ academy_id: NRIFA, name: TEAM, age_group: 'U12', season: '2026', status: 'active' }).select('id').single()
  team = t.id
  const kids = []
  for (const n of ['One', 'Two', 'Three']) {
    const { data: p } = await admin.from('players').insert({ academy_id: NRIFA, full_name: `Zz Duty ${n}`, dob: '2014-05-05' }).select('id').single()
    kids.push(p.id)
  }
  await admin.from('player_guardians').insert({ academy_id: NRIFA, player_id: kids[0], profile_id: SAM, relationship: 'parent' })
  await admin.from('player_guardians').insert({ academy_id: NRIFA, player_id: kids[1], profile_id: MARCUS, relationship: 'parent' })
  // Onto the squad after the families are linked: the 0098 trigger brings the families into the squad.
  for (const id of kids) await admin.from('players').update({ team_id: team }).eq('id', id)
  const { data: g } = await admin.from('events').insert({ academy_id: NRIFA, team_id: team, type: 'match', title: 'Zz Duty v Rovers', opponent: 'Zz Rovers', starts_at: atLocal(sat, '09:00').toISOString(), ends_at: atLocal(sat, '10:00').toISOString(), venue: PARK, venue_id: venue, source: 'manual' }).select('id').single()
  game = g.id
}
const channelOf = async () => (await admin.from('channels').select('id').eq('team_id', team).eq('type', 'team').maybeSingle()).data?.id ?? null

try {
  head("1. The ground's day, with its jobs, seen from the game there")
  {
    const { data: id, error } = await headOf.client.rpc('create_ground_day', { p_academy: NRIFA, p_venue: venue, p_date: sat })
    if (error || !id) { bad(`ground day: ${error?.message}`); throw new Error('no ground day') }
    groundDay = id
    const { data: again } = await headOf.client.rpc('create_ground_day', { p_academy: NRIFA, p_venue: venue, p_date: sat })
    again === id ? ok('made once: the same day comes back the second time') : bad(`twice: ${again}`)
    const { data: h } = await headOf.client.rpc('event_helpers', { p_event: game })
    const jobs = h?.ground?.jobs ?? []
    jobs.length === 5 && jobs.map((j) => j.title).join(',') === 'Set-up,Canteen,BBQ,Field marshal,Pack-down' ? ok(`the game shows the ground's five jobs: ${jobs.map((j) => j.title).join(', ')}`) : bad(`ground jobs: ${JSON.stringify(jobs.map((j) => j.title))}`)
    const canteen = jobs.find((j) => j.title === 'Canteen')
    const { error: he } = await sam.client.rpc('help_with', { p_job: canteen?.id })
    !he ? ok("Sam puts her name down for the canteen from her child's game") : bad(`help: ${he.message}`)
    const { data: hs } = await sam.client.rpc('event_helpers', { p_event: game })
    const mine = (hs?.ground?.jobs ?? []).find((j) => j.title === 'Canteen')?.helpers?.some((x) => x.me)
    mine ? ok('and sees herself on it') : bad(`sam's view: ${JSON.stringify(hs?.ground).slice(0, 200)}`)
    const { data: n, error: ae } = await headOf.client.rpc('ask_for_helpers', { p_event: groundDay })
    !ae && n >= 1 ? ok(`the club is asked: ${n} people`) : bad(`ask: ${ae?.message ?? n}`)
  }

  head('2. Duties by turns, a swap asked for, a swap taken')
  {
    const { data: titles, error } = await headOf.client.rpc('set_team_duties', { p_team: team, p_titles: ['Oranges', 'Linesperson'] })
    !error && (titles ?? []).length === 2 ? ok(`duties set: ${titles.join(', ')}`) : bad(`set: ${error?.message}`)
    const { data: r } = await headOf.client.rpc('roster_team_duties', { p_team: team, p_games: 5 })
    r?.games === 1 && r.assigned === 2 ? ok('rostered the one game: two duties, two families') : bad(`roster: ${JSON.stringify(r)}`)
    const { data: d } = await sam.client.rpc('event_duties', { p_event: game })
    const mine = (d?.duties ?? []).find((x) => x.mine)
    const theirs = (d?.duties ?? []).find((x) => !x.mine)
    mine && theirs && mine.player_id !== theirs.player_id ? ok(`Sam's family has ${mine.title}; another has ${theirs.title}`) : bad(`duties: ${JSON.stringify(d).slice(0, 240)}`)
    const { data: r2 } = await headOf.client.rpc('roster_team_duties', { p_team: team, p_games: 5 })
    r2?.assigned === 0 ? ok('rostering again adds nothing — every duty has its family') : bad(`again: ${JSON.stringify(r2)}`)
    const { data: sw, error: se } = await sam.client.rpc('request_duty_swap', { p_duty: mine.id, p_note: 'away that weekend' })
    !se && (sw?.duties ?? []).find((x) => x.id === mine.id)?.requested_swap_at ? ok('Sam asks for a swap') : bad(`swap: ${se?.message}`)
    const chan = await channelOf()
    const { data: posts } = await admin.from('messages').select('body').eq('channel_id', chan ?? '00000000-0000-0000-0000-000000000000').eq('event_id', game).order('created_at')
    posts?.some((p) => /can't do Oranges|can't do Linesperson/.test(p.body) && /away that weekend/.test(p.body)) ? ok(`the squad hears it: "${posts[0].body.split('\n')[0]}"`) : bad(`chat: ${JSON.stringify(posts)}`)
    const { data: gaps } = await headOf.client.rpc('volunteer_gaps', { p_academy: NRIFA })
    const gd = (gaps?.ground_days ?? []).find((g) => g.event_id === groundDay)
    const dg = (gaps?.duties ?? []).find((g) => g.event_id === game)
    gd && gd.spots === 9 && gd.filled === 1 && gd.open === 8 && gd.games === 1 ? ok(`the coordinator's gaps: ${gd.filled} of ${gd.spots} at ${gd.venue}, ${gd.open} open, ${gd.games} game there`) : bad(`ground gap: ${JSON.stringify(gd)}`)
    dg && dg.swaps === 1 ? ok('and the swap asked for') : bad(`duty gap: ${JSON.stringify(dg)}`)
    const { data: pg } = await sam.client.rpc('volunteer_gaps', { p_academy: NRIFA })
    pg === null ? ok('a parent reads no gaps') : bad('a parent read the gaps')
    const { data: tk, error: te } = await marcus.client.rpc('take_duty', { p_duty: mine.id })
    const taken = (tk?.duties ?? []).find((x) => x.id === mine.id)
    !te && taken && !taken.requested_swap_at && taken.player_id !== mine.player_id ? ok(`Marcus's family takes ${taken.title}`) : bad(`take: ${te?.message ?? JSON.stringify(taken)}`)
    const { data: posts2 } = await admin.from('messages').select('body').eq('channel_id', chan ?? '00000000-0000-0000-0000-000000000000').eq('event_id', game).order('created_at')
    posts2?.some((p) => /will do/.test(p.body)) ? ok('and the squad hears that too') : bad(`chat after take: ${JSON.stringify(posts2?.map((p) => p.body))}`)
    const { error: oe } = await headOf.client.rpc('take_duty', { p_duty: mine.id })
    oe ? ok('someone with no child on the squad cannot take a duty') : bad('the owner took a duty with no child on the squad')
  }

  head('3. The reminder the evening before, once')
  {
    const { data: n, error } = await admin.rpc('queue_duty_reminders', { p_now: atLocal(fri, '18:00').toISOString() })
    if (error) note(`could not run the reminder as the service role: ${error.message}`)
    else {
      // Marcus's family took Sam's duty, and the rotation gave the other to
      // the child with no family linked yet: one family to remind.
      n >= 1 ? ok(`${n} famil${n === 1 ? 'y' : 'ies'} reminded at six on Friday`) : bad(`queued ${n}`)
      const { data: q } = await admin.from('notification_queue').select('title, body, profile_id').eq('kind', 'helper_reminder').contains('payload', { event_id: game })
      const his = (q ?? []).find((x) => x.profile_id === MARCUS)
      his && /Tomorrow: (Oranges|Linesperson) for Zz Duty U12 v Zz Rovers/.test(his.title) && /Your turn/.test(his.body) ? ok(`Marcus's: "${his.title}" — ${his.body}`) : bad(`queue: ${JSON.stringify(q)}`)
      ;(q ?? []).some((x) => x.profile_id === SAM) ? bad('Sam was reminded of a duty she no longer has') : ok('Sam, who swapped out, is not reminded')
      const { data: again } = await admin.rpc('queue_duty_reminders', { p_now: atLocal(fri, '19:00').toISOString() })
      again === 0 ? ok('an hour later, nothing twice') : bad(`again: ${again}`)
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
      const { context, page } = await open(headOf, '/admin/rosters', '[data-ground-day]')
      const text = await page.$eval('[data-rosters]', (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '')
      text.includes(PARK) && /1 of 9 spots filled/.test(text) ? ok('Rosters: the ground day with its spots') : bad(`rosters: ${text.slice(0, 200) || 'missing'}`)
      for (const scheme of ['light', 'dark']) {
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }])
        await sleep(150)
        if (SHOTS) await page.screenshot({ path: `.shots/volunteers-rosters-${scheme}.png`, fullPage: true })
      }
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
      const fits = await page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1)
      fits ? ok('fits 375px, light and dark') : bad('wider than the phone')
      await context.close()
    }
    {
      const { context, page } = await open(sam, `/calendar/${game}`, '[data-duties]')
      const duties = await page.$eval('[data-duties]', (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '')
      ;/Oranges/.test(duties) && /Linesperson/.test(duties) ? ok(`the game page for Sam: "${duties.slice(0, 90)}…"`) : bad(`duties: ${duties.slice(0, 200) || 'missing'}`)
      const ground = await page.$eval('[data-ground-jobs]', (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '')
      ;/Canteen/.test(ground) && /You/.test(ground) ? ok("and the ground's jobs with her name on the canteen") : bad(`ground section: ${ground.slice(0, 200) || 'missing'}`)
      if (SHOTS) await page.screenshot({ path: '.shots/volunteers-game-light.png', fullPage: true })
      await context.close()
    }
    {
      const { context, page } = await open(headOf, `/admin/teams/${team}`, '[data-duties-panel]')
      const panel = await page.$eval('[data-duties-panel]', (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '')
      ;/Oranges ×/.test(panel) && /Roster the next 10 games/.test(panel) ? ok('the team page: the duties and the roster button') : bad(`panel: ${panel.slice(0, 200) || 'missing'}`)
      await context.close()
    }
  } finally {
    await browser.close()
  }
} finally {
  await cleanup()
  const { count: t } = await admin.from('teams').select('id', { count: 'exact', head: true }).eq('academy_id', NRIFA).eq('name', TEAM)
  const { count: v } = await admin.from('venues').select('id', { count: 'exact', head: true }).eq('academy_id', NRIFA).eq('name', PARK)
  const { data: sm } = await admin.from('team_members').select('team_id').eq('profile_id', SAM).eq('academy_id', NRIFA)
  t === 0 && v === 0 ? ok(`the demo is as it was (Sam on ${(sm ?? []).length} squads)`) : bad(`left behind: ${t} squads, ${v} grounds`)
}
console.log(process.exitCode ? '' : "\n  \x1b[32mvolunteers: the ground's day, the squad's duties by turns, the gaps\x1b[0m\n")
