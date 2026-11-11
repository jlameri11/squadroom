// Run: node --env-file=.env.local scripts/test-game-day.mjs
//   (needs the app running — npm run dev, or serve:test; SHOTS=1 saves
//   screenshots to .shots/)
//
// Game day (Big Club Mode item 9; 0251). MiniRoos (U5–U11) keep no score in
// any reader until the club turns scores on; a recorded result reaches the
// squad's chat, once, and a correction says so; the team manager is asked
// for the team sheet the evening before, once; and the club's Saturday is
// one screen for the people who run it, and nobody else.
//
// The demo is left as found: two throwaway squads, their games, a
// team-manager role and what the publishes queued are removed at the end,
// and the club's MiniRoos setting is put back.
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
const TZ = 'Australia/Sydney'
const started = new Date().toISOString()

/** Today's date in the club's timezone, and an instant on a local date and time. */
const localDate = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: TZ })
function atLocal(date, hhmm) {
  // The offset Sydney has on that date, read back from Intl.
  const probe = new Date(`${date}T${hhmm}:00Z`)
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' }).formatToParts(probe)
  const off = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+10:00'
  const m = off.match(/GMT([+-])(\d{2}):(\d{2})/)
  const sign = m?.[1] === '-' ? -1 : 1
  const mins = sign * ((Number(m?.[2] ?? 10) * 60) + Number(m?.[3] ?? 0))
  return new Date(probe.getTime() - mins * 60000)
}

let u8 = null
let u12 = null
let g8 = null
let g12 = null
let tomorrow = null
let headId = null
// The demo club keeps MiniRoos scores (its U8 SPL results are part of the demo); the run probes the default and puts it back.
let flagBefore = null

async function cleanup() {
  const { data: teams } = await admin.from('teams').select('id').eq('academy_id', NRIFA).like('name', 'Zz Day %')
  for (const t of teams ?? []) {
    const { data: evs } = await admin.from('events').select('id').eq('team_id', t.id)
    for (const e of evs ?? []) {
      await admin.from('notification_queue').delete().contains('payload', { event_id: e.id })
      await admin.from('notification_queue').delete().like('url', `/calendar/${e.id}%`)
    }
    const { data: chans } = await admin.from('channels').select('id').eq('team_id', t.id)
    for (const c of chans ?? []) await admin.from('notification_queue').delete().like('url', `/chat/${c.id}%`)
    await admin.from('club_roles').delete().eq('team_id', t.id)
    await admin.from('events').delete().eq('team_id', t.id)
    await admin.from('teams').delete().eq('id', t.id)
  }
  if (flagBefore !== null) await admin.from('academies').update({ miniroos_scores: flagBefore }).eq('id', NRIFA)
}
{
  const { data: before } = await admin.from('academies').select('miniroos_scores').eq('id', NRIFA).single()
  flagBefore = Boolean(before?.miniroos_scores)
}
await cleanup()
await admin.from('academies').update({ miniroos_scores: false }).eq('id', NRIFA)

const headOf = await signInBoth(admin, 'head@squadroom-demo.test') // NRIFA's owner
const sam = await signInBoth(admin, 'p61400000011@squadroom.invalid') // a parent
const { data: marcusProfile } = await admin.from('profiles').select('phone').eq('id', MARCUS).single()
const marcus = marcusProfile?.phone ? await signInBoth(admin, `p${String(marcusProfile.phone).replace('+', '')}@squadroom.invalid`) : null
if (!headOf || !sam) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}
headId = headOf.session.user.id

// Two squads, two games this morning, one tomorrow.
const today = localDate()
const tmrw = localDate(new Date(Date.now() + 864e5))
{
  const { data: a } = await admin.from('teams').insert({ academy_id: NRIFA, name: 'Zz Day U8', age_group: 'U8', season: '2026', status: 'active' }).select('id').single()
  const { data: b } = await admin.from('teams').insert({ academy_id: NRIFA, name: 'Zz Day U12', age_group: 'U12', season: '2026', status: 'active' }).select('id').single()
  u8 = a.id
  u12 = b.id
  const twoHoursAgo = new Date(Date.now() - 2 * 3600e3).toISOString()
  const oneHourAgo = new Date(Date.now() - 3600e3).toISOString()
  const { data: e8 } = await admin.from('events').insert({ academy_id: NRIFA, team_id: u8, type: 'match', title: 'Zz Day U8 v Rovers', opponent: 'Zz Rovers', starts_at: twoHoursAgo, ends_at: oneHourAgo, venue: 'Zz Oval', source: 'manual' }).select('id').single()
  const { data: e12 } = await admin.from('events').insert({ academy_id: NRIFA, team_id: u12, type: 'match', title: 'Zz Day U12 v United', opponent: 'Zz United', starts_at: twoHoursAgo, ends_at: oneHourAgo, venue: 'Zz Oval', source: 'manual' }).select('id').single()
  const { data: et } = await admin.from('events').insert({ academy_id: NRIFA, team_id: u12, type: 'match', title: 'Zz Day U12 v City', opponent: 'Zz City', starts_at: atLocal(tmrw, '09:00').toISOString(), ends_at: atLocal(tmrw, '10:00').toISOString(), venue: 'Zz Oval', source: 'import' }).select('id').single()
  g8 = e8.id
  g12 = e12.id
  tomorrow = et.id
  await admin.from('club_roles').insert({ academy_id: NRIFA, profile_id: headId, role: 'team_manager', scope_kind: 'team', team_id: u12, granted_by: headId })
}
const channelOf = async (teamId) => (await admin.from('channels').select('id').eq('team_id', teamId).eq('type', 'team').maybeSingle()).data?.id ?? null

try {
  head('1. MiniRoos keep no score; U12 do, and the squad hears it')
  {
    const { error: e1 } = await headOf.client.rpc('set_event_result', { p_event: g8, p_ours: 3, p_theirs: 0 })
    e1 && /MiniRoos/.test(e1.message) ? ok(`a score on the U8 game is refused: "${e1.message}"`) : bad(`U8 score: ${e1?.message ?? 'accepted'}`)
    const { data: r8 } = await headOf.client.rpc('event_result', { p_event: g8 })
    ;(r8 ?? []).length === 0 ? ok('event_result has nothing for the U8 game') : bad(`U8 result: ${JSON.stringify(r8)}`)
    const { error: e2 } = await headOf.client.rpc('set_event_result', { p_event: g12, p_ours: 3, p_theirs: 1, p_note: 'A good one' })
    !e2 ? ok('the U12 result is recorded, 3–1') : bad(`U12 score: ${e2.message}`)
    const { data: r12 } = await headOf.client.rpc('event_result', { p_event: g12 })
    r12?.[0]?.ours === 3 && r12[0].outcome === 'won' ? ok('and read back: won 3–1') : bad(`U12 result: ${JSON.stringify(r12)}`)
    const c12 = await channelOf(u12)
    const { data: posts } = await admin.from('messages').select('body').eq('channel_id', c12 ?? '00000000-0000-0000-0000-000000000000').eq('event_id', g12).order('created_at')
    posts?.length === 1 && /^🏁 Full time: 3–1 — won v Zz United\nA good one$/.test(posts[0].body) ? ok(`the squad's chat: "${posts[0].body.split('\n')[0]}"`) : bad(`chat: ${JSON.stringify(posts)}`)
    await headOf.client.rpc('set_event_result', { p_event: g12, p_ours: 3, p_theirs: 2 })
    const { data: posts2 } = await admin.from('messages').select('body').eq('channel_id', c12 ?? '00000000-0000-0000-0000-000000000000').eq('event_id', g12).order('created_at')
    posts2?.length === 2 && /^Result corrected: 3–2/.test(posts2[1].body) ? ok('a changed score says so, once more') : bad(`correction: ${JSON.stringify(posts2?.map((p) => p.body))}`)
    await headOf.client.rpc('set_event_result', { p_event: g12, p_ours: 3, p_theirs: 2 })
    const { count: same } = await admin.from('messages').select('id', { count: 'exact', head: true }).eq('event_id', g12)
    same === 2 ? ok('saving the same score again posts nothing') : bad(`${same} posts after a no-change save`)

    // The ticker on a MiniRoos game: the goal is cheered, the tally is not.
    const { data: live, error: e3 } = await headOf.client.rpc('live_tick', { p_event: g8, p_kind: 'goal_for' })
    !e3 && live?.scores_shown === false && live.score === null ? ok('the U8 ticker shows no score') : bad(`U8 live: ${e3?.message ?? JSON.stringify(live).slice(0, 160)}`)
    const c8 = await channelOf(u8)
    const { data: goal } = await admin.from('messages').select('body').eq('channel_id', c8 ?? '00000000-0000-0000-0000-000000000000').eq('event_id', g8).order('created_at', { ascending: false }).limit(1)
    const line = goal?.[0]?.body ?? ''
    ;/^⚽ GOAL!/.test(line) && !/\d–\d/.test(line) ? ok(`the chat line: "${line}" — no tally`) : bad(`goal line: "${line}"`)
    const { data: live12 } = await headOf.client.rpc('event_live', { p_event: g12 })
    live12?.scores_shown === true && live12.score ? ok('the U12 live view keeps its score') : bad(`U12 live: ${JSON.stringify(live12).slice(0, 120)}`)

    const { data: ar } = await headOf.client.rpc('academy_results', { p_academy: NRIFA })
    const row8 = (ar ?? []).find((r) => r.team_id === u8)
    const row12 = (ar ?? []).find((r) => r.team_id === u12)
    row8?.scores_shown === false && row8.won === undefined && row12?.scores_shown === true && row12.won === 1 ? ok("the club's results: U8 without numbers, U12 with") : bad(`results: ${JSON.stringify([row8, row12]).slice(0, 240)}`)
    const { data: form } = await headOf.client.rpc('team_form', { p_team: u8 })
    form?.scores_shown === false && form.last.length === 0 ? ok('no form for U8') : bad(`form: ${JSON.stringify(form).slice(0, 120)}`)
    const { data: table } = await headOf.client.rpc('division_table', { p_team: u8 })
    table?.reason === 'miniroos' ? ok('no ladder for U8') : bad(`table: ${JSON.stringify(table).slice(0, 120)}`)
    const { data: shown8 } = await headOf.client.rpc('scores_shown', { p_team: u8 })
    const { data: shown12 } = await headOf.client.rpc('scores_shown', { p_team: u12 })
    shown8 === false && shown12 === true ? ok('scores_shown: U8 no, U12 yes') : bad(`scores_shown: ${shown8}/${shown12}`)

    // The club that keeps MiniRoos scores turns them on.
    await admin.from('academies').update({ miniroos_scores: true }).eq('id', NRIFA)
    const { error: e4 } = await headOf.client.rpc('set_event_result', { p_event: g8, p_ours: 1, p_theirs: 0 })
    const { data: r8on } = await headOf.client.rpc('event_result', { p_event: g8 })
    !e4 && r8on?.[0]?.ours === 1 ? ok('with the setting on, the U8 score is kept and read') : bad(`on: ${e4?.message ?? JSON.stringify(r8on)}`)
    // Taken back, so the U8 game is a game with a goal and no full time for the Saturday view.
    await headOf.client.rpc('set_event_result', { p_event: g8 })
    await admin.from('academies').update({ miniroos_scores: false }).eq('id', NRIFA)
    const { data: r8off } = await headOf.client.rpc('event_result', { p_event: g8 })
    ;(r8off ?? []).length === 0 ? ok('and off again, hidden again') : bad(`off: ${JSON.stringify(r8off)}`)
  }

  head('2. The Saturday view')
  {
    const { data: v } = await headOf.client.rpc('saturday_view', { p_academy: NRIFA, p_date: today })
    const games = v?.games ?? []
    const row8 = games.find((g) => g.event_id === g8)
    const row12 = games.find((g) => g.event_id === g12)
    row8 && row12 ? ok(`${v.counts.games} games today, both throwaways among them, by ground "${row8.venue}"`) : bad(`view: ${JSON.stringify(v).slice(0, 200)}`)
    row8 && row8.scores_shown === false && row8.ours === null && row8.finished === false ? ok('the U8 row: no score, not finished (a goal, no full time)') : bad(`U8 row: ${JSON.stringify(row8)}`)
    row12 && row12.finished && row12.ours === 3 && row12.theirs === 2 && row12.manager ? ok(`the U12 row: finished 3–2, manager ${row12.manager}`) : bad(`U12 row: ${JSON.stringify(row12)}`)
    row8 && row8.yes === 0 && row8.min_players === 7 ? ok('U8 needs 7 and nobody has said yes: short') : bad(`U8 roster: ${row8?.yes} of ${row8?.min_players}`)
    typeof v?.counts?.short === 'number' && v.counts.nobody_in_charge >= 1 ? ok(`counts: ${v.counts.short} short, ${v.counts.nobody_in_charge} nobody in charge`) : bad(`counts: ${JSON.stringify(v?.counts)}`)
    const { data: pv } = await sam.client.rpc('saturday_view', { p_academy: NRIFA, p_date: today })
    pv === null ? ok('a parent gets nothing') : bad('a parent read the Saturday view')
    if (marcus) {
      const { data: mv } = await marcus.client.rpc('saturday_view', { p_academy: NRIFA, p_date: today })
      mv === null ? ok('a coach who does not run the club gets nothing') : bad('a coach read it')
    } else note('Marcus could not sign in; skipped')
    const { data: empty } = await headOf.client.rpc('saturday_view', { p_academy: NRIFA, p_date: '2031-01-01' })
    empty?.games?.length === 0 ? ok('an empty day says so') : bad(`empty: ${JSON.stringify(empty).slice(0, 120)}`)
  }

  head('3. The team sheet, the evening before, once')
  {
    const { data: n, error } = await admin.rpc('queue_team_sheet_reminders', { p_now: atLocal(today, '18:00').toISOString() })
    if (error) note(`could not run the reminder as the service role: ${error.message}`)
    else {
      n >= 1 ? ok(`${n} reminder(s) queued at six`) : bad(`queued ${n}`)
      const { data: q } = await admin.from('notification_queue').select('title, body, profile_id').eq('kind', 'team_sheet_due').contains('payload', { event_id: tomorrow })
      const mine = (q ?? []).find((x) => x.profile_id === headId)
      mine && /Team sheet: Zz Day U12 v Zz City tomorrow/.test(mine.title) && /Dribl/.test(mine.body) ? ok(`the manager is told: "${mine.title}" — ${mine.body}`) : bad(`queue: ${JSON.stringify(q)}`)
      const { data: again } = await admin.rpc('queue_team_sheet_reminders', { p_now: atLocal(today, '19:00').toISOString() })
      again === 0 ? ok('an hour later, nothing twice') : bad(`again: ${again}`)
      const { data: early } = await admin.rpc('queue_team_sheet_reminders', { p_now: atLocal(today, '12:00').toISOString() })
      early === 0 ? ok('and nothing at noon') : bad(`noon: ${early}`)
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
      const { context, page } = await open(headOf, '/admin/saturday', '[data-saturday-game]')
      const text = await page.$eval('[data-saturday]', (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '')
      text.includes('Zz Day U8') && text.includes('Zz Day U12') && /3–2/.test(text) && /MiniRoos · no score/.test(text) ? ok('Game day: both squads, the U12 score, the U8 without one') : bad(`saturday: ${text.slice(0, 240) || 'missing'}`)
      const counts = await page.$eval('[data-saturday-counts]', (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '')
      ;/short of players/.test(counts) ? ok(`the numbers: ${counts}`) : bad(`counts: ${counts}`)
      for (const scheme of ['light', 'dark']) {
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }])
        await sleep(150)
        if (SHOTS) await page.screenshot({ path: `.shots/gameday-saturday-${scheme}.png`, fullPage: true })
      }
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
      const fits = await page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1)
      fits ? ok('fits 375px, light and dark') : bad('wider than the phone')
      await context.close()
    }
    {
      const { context, page } = await open(headOf, `/calendar/${g8}`, '[data-tab="sheet"]')
      // The result lives on the Match sheet tab (X-05); so does the MiniRoos line.
      await page.click('[data-tab="sheet"]').catch(() => null)
      await page.waitForSelector('[data-miniroos-note]', { timeout: 15000 }).catch(() => null)
      const noteEl = await page.$('[data-miniroos-note]')
      const score = await page.$('[data-hero-score]')
      noteEl && !score ? ok('the U8 game page: the MiniRoos line, no score anywhere') : bad(`U8 page: note ${Boolean(noteEl)}, hero score ${Boolean(score)}`)
      if (SHOTS) await page.screenshot({ path: '.shots/gameday-u8-light.png', fullPage: true })
      await context.close()
    }
    {
      const { context, page } = await open(headOf, '/settings/academy', '[data-miniroos-scores]')
      const box = await page.$('[data-miniroos-scores]')
      box ? ok('Club settings: the MiniRoos switch, off') : bad('no MiniRoos switch in Club settings')
      await context.close()
    }
    {
      const { context, page } = await open(headOf, '/admin', 'a[href="/admin/saturday"]')
      const row = await page.$('a[href="/admin/saturday"]')
      row ? ok('the hub has a Game day row') : bad('no Game day row')
      await context.close()
    }
  } finally {
    await browser.close()
  }
} finally {
  await cleanup()
  const { count: t } = await admin.from('teams').select('id', { count: 'exact', head: true }).eq('academy_id', NRIFA).like('name', 'Zz Day %')
  const { data: a } = await admin.from('academies').select('miniroos_scores').eq('id', NRIFA).single()
  t === 0 && a?.miniroos_scores === flagBefore ? ok(`the demo is as it was (MiniRoos scores ${flagBefore ? 'on' : 'off'}, as before)`) : bad(`left behind: ${t} squads; miniroos_scores ${a?.miniroos_scores} (was ${flagBefore})`)
}
console.log(process.exitCode ? '' : '\n  \x1b[32mgame day: MiniRoos keep no score, results reach the chat, the sheet is asked for, the club sees its Saturday\x1b[0m\n')
