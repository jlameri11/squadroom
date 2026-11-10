// Run: node --env-file=.env.local scripts/test-trials.mjs
//   (needs the app running — npm run dev, or serve:test; SHOTS=1 saves
//   screenshots to .shots/)
//
// Trials, grading and "Publish teams" (Big Club Mode item 7; 0249). Coaches
// rate the children who trialled, 1–5 and a note the club's coaches share
// and no family ever sees; the coordinator pencils each into a squad — a
// draft a family cannot read — and publishes: the pencil becomes the squads,
// each squad's chat gets a welcome, each family one message. The Season
// screen publishes moves the same way. Sessions are a club-wide series
// titled after the trial.
//
// The demo is left as found: a throwaway trial, squad and two players, with
// a real parent lent as their guardian for the run; all of it, and what the
// publishes queued, removed at the end.
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
const SAM = '00000000-0000-0000-0000-0000000000b1'
const TEAM = 'Zz Trial U12'
const PROGRAM = 'Zz Trial 2026'
const started = new Date().toISOString()

let team = null
let program = null
let channel = null

async function cleanup() {
  const { data: progs } = await admin.from('programs').select('id').eq('academy_id', NRIFA).eq('name', PROGRAM)
  for (const p of progs ?? []) {
    const { data: series } = await admin.from('event_series').select('id').eq('program_id', p.id)
    for (const s of series ?? []) await admin.from('events').delete().eq('series_id', s.id)
    await admin.from('event_series').delete().eq('program_id', p.id)
    await admin.from('events').delete().eq('program_id', p.id)
    await admin.from('activity_log').delete().eq('subject_id', p.id)
    await admin.from('programs').delete().eq('id', p.id)
  }
  await admin.from('players').delete().eq('academy_id', NRIFA).like('full_name', 'Zz Trial %')
  const { data: teams } = await admin.from('teams').select('id').eq('academy_id', NRIFA).eq('name', TEAM)
  for (const t of teams ?? []) {
    const { data: chans } = await admin.from('channels').select('id').eq('team_id', t.id)
    for (const c of chans ?? []) await admin.from('notification_queue').delete().like('url', `/chat/${c.id}%`)
    await admin.from('teams').delete().eq('id', t.id)
  }
  await admin.from('notification_queue').delete().eq('kind', 'team_published').eq('academy_id', NRIFA).gte('created_at', started)
  await admin.from('activity_log').delete().eq('academy_id', NRIFA).eq('action', 'teams_published').gte('at', started)
}
await cleanup()

const headOf = await signInBoth(admin, 'head@squadroom-demo.test') // NRIFA's owner
const sam = await signInBoth(admin, 'p61400000011@squadroom.invalid') // a parent
const { data: marcusProfile } = await admin.from('profiles').select('phone').eq('id', MARCUS).single()
const marcus = marcusProfile?.phone ? await signInBoth(admin, `p${String(marcusProfile.phone).replace('+', '')}@squadroom.invalid`) : null
if (!headOf || !sam || !marcus) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}

// The trial, a squad to place into, two children who trialled, Sam as their parent.
{
  const { data: t, error: te } = await admin.from('teams').insert({ academy_id: NRIFA, name: TEAM, age_group: 'U12', season: '2026', status: 'active' }).select('id').single()
  if (te) { bad(`team: ${te.message}`); await cleanup(); process.exit(1) }
  team = t.id
  const { data: ch } = await admin.from('channels').select('id').eq('team_id', team).eq('type', 'team').maybeSingle()
  channel = ch?.id ?? null
  const { data: pr, error: pe } = await admin.from('programs').insert({ academy_id: NRIFA, name: PROGRAM, kind: 'trial', status: 'open', season: '2026', born_from_year: 2014, born_to_year: 2014, created_by: headOf.session.user.id }).select('id').single()
  if (pe) { bad(`program: ${pe.message}`); await cleanup(); process.exit(1) }
  program = pr.id
}
const { data: p1 } = await admin.from('players').insert({ academy_id: NRIFA, full_name: 'Zz Trial One', dob: '2014-03-03' }).select('id').single()
const { data: p2 } = await admin.from('players').insert({ academy_id: NRIFA, full_name: 'Zz Trial Two', dob: '2014-04-04' }).select('id').single()
for (const p of [p1, p2]) {
  await admin.from('player_guardians').insert({ academy_id: NRIFA, player_id: p.id, profile_id: SAM, relationship: 'parent' })
  await admin.from('program_registrations').insert({ academy_id: NRIFA, program_id: program, player_id: p.id, status: 'approved', submitted_by: SAM })
}

try {
  head('1. Coaches rate; a parent sees nothing of it')
  {
    const { error: e1 } = await marcus.client.rpc('rate_trial_player', { p_program: program, p_player: p1.id, p_rating: 4, p_note: 'quick feet' })
    !e1 ? ok('Marcus, a coach, rates One 4 with a note') : bad(`Marcus: ${e1.message}`)
    const { error: e2 } = await headOf.client.rpc('rate_trial_player', { p_program: program, p_player: p1.id, p_rating: 3, p_note: null })
    !e2 ? ok('the owner rates One 3') : bad(`owner: ${e2.message}`)
    const { error: e3 } = await headOf.client.rpc('rate_trial_player', { p_program: program, p_player: p1.id, p_rating: 7, p_note: null })
    e3 ? ok('a 7 is refused') : bad('a 7 was accepted')
    const { data: board } = await headOf.client.rpc('trial_board', { p_program: program })
    const one = (board?.players ?? []).find((p) => p.player_id === p1.id)
    one && Number(one.avg) === 3.5 && one.count === 2 && one.ratings.length === 2 && one.mine?.rating === 3
      ? ok(`the board: One averages ${one.avg} from ${one.count} coaches; both notes readable; mine is 3`)
      : bad(`board: ${JSON.stringify(one).slice(0, 240)}`)
    board?.can_place === true ? ok('the owner may place') : bad(`can_place: ${board?.can_place}`)
    const { data: mb } = await marcus.client.rpc('trial_board', { p_program: program })
    const mone = (mb?.players ?? []).find((p) => p.player_id === p1.id)
    mone && mone.ratings.length === 2 && mb.can_place === false ? ok("Marcus reads both ratings too, and may not place") : bad(`Marcus's board: ${JSON.stringify(mone).slice(0, 160)} can_place ${mb?.can_place}`)
    const { data: parentRows } = await sam.client.from('trial_ratings').select('id').eq('program_id', program)
    ;(parentRows ?? []).length === 0 ? ok('a parent reads no ratings') : bad(`a parent read ${parentRows.length} ratings`)
    const { data: pb } = await sam.client.rpc('trial_board', { p_program: program })
    pb === null ? ok('and no board') : bad('a parent read the board')
    const { error: pe } = await sam.client.rpc('rate_trial_player', { p_program: program, p_player: p1.id, p_rating: 5, p_note: null })
    pe ? ok('and cannot rate') : bad('a parent rated')
  }

  head('2. Sessions, club-wide, titled after the trial')
  {
    const from = new Date(Date.now() + 864e5).toISOString().slice(0, 10)
    const until = new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10)
    const { data: made, error } = await headOf.client.rpc('create_trial_sessions', { p_program: program, p_days: [2], p_time: '17:00', p_from: from, p_until: until, p_venue: 'Zz Park', p_duration: 60 })
    !error && made?.created >= 2 ? ok(`${made.created} sessions made`) : bad(`sessions: ${error?.message ?? JSON.stringify(made)}`)
    const { data: evs } = await admin.from('events').select('id, title, team_id, program_id').eq('program_id', program)
    ;(evs ?? []).length >= 2 && evs.every((e) => e.team_id === null && e.title.includes(PROGRAM)) ? ok(`each carries the trial, no squad, titled "${evs[0].title}"`) : bad(`events: ${JSON.stringify(evs).slice(0, 200)}`)
    const { data: board } = await headOf.client.rpc('trial_board', { p_program: program })
    ;(board?.sessions ?? []).length >= 2 ? ok('the board lists them') : bad(`board sessions: ${board?.sessions?.length}`)
    const { error: me } = await marcus.client.rpc('create_trial_sessions', { p_program: program, p_days: [4], p_time: '17:00', p_from: from, p_until: until, p_venue: null, p_duration: 60 })
    !me ? ok('a coach may set sessions too') : bad(`Marcus sessions: ${me.message}`)
  }

  head('3. The pencil: a draft the staff keep and a family cannot read')
  {
    const { error: e1 } = await headOf.client.rpc('place_trial_player', { p_program: program, p_player: p1.id, p_team: team })
    !e1 ? ok(`One pencilled into ${TEAM}`) : bad(`place: ${e1.message}`)
    const { error: e2 } = await marcus.client.rpc('place_trial_player', { p_program: program, p_player: p2.id, p_team: team })
    e2 ? ok('a coach who is not staff cannot place') : bad('Marcus placed')
    const { data: parentRows } = await sam.client.from('trial_placements').select('id').eq('program_id', program)
    ;(parentRows ?? []).length === 0 ? ok('a parent reads no placements') : bad(`a parent read ${parentRows.length} placements`)
    const { data: pl } = await admin.from('players').select('team_id').eq('id', p1.id).single()
    pl?.team_id === null ? ok("and One's squad is unchanged — nothing moves until it is published") : bad(`One is already on ${pl?.team_id}`)
    const { data: board } = await headOf.client.rpc('trial_board', { p_program: program })
    board?.to_publish === 1 ? ok('one to publish') : bad(`to_publish: ${board?.to_publish}`)
    const { data: pv } = await headOf.client.rpc('publish_teams_preview', { p_academy: NRIFA, p_program: program })
    pv && pv.players === 1 && pv.families === 1 && pv.teams === 1 ? ok(`the preview: ${pv.players} player, ${pv.families} family, ${pv.teams} squad`) : bad(`preview: ${JSON.stringify(pv)}`)
  }

  head('4. Publish: the squad, a welcome in its chat, one message to the family')
  {
    const { data: r, error } = await headOf.client.rpc('publish_teams', { p_academy: NRIFA, p_program: program })
    !error && r.players === 1 && r.families === 1 && r.teams === 1 ? ok(`published: ${r.players} player, ${r.families} family, ${r.teams} squad`) : bad(`publish: ${error?.message ?? JSON.stringify(r)}`)
    const { data: pl } = await admin.from('players').select('team_id, team_told_at, team_since').eq('id', p1.id).single()
    pl?.team_id === team && pl.team_told_at && pl.team_since ? ok('One is on the squad, told, since now') : bad(`One: ${JSON.stringify(pl)}`)
    const { data: tm } = await admin.from('team_members').select('role').eq('team_id', team).eq('profile_id', SAM)
    ;(tm ?? []).length === 1 ? ok("Sam followed One into the squad (the 0098 trigger)") : bad(`Sam's team_members: ${JSON.stringify(tm)}`)
    const { data: msgs } = await admin.from('messages').select('body').eq('channel_id', channel ?? '00000000-0000-0000-0000-000000000000').like('body', 'Welcome to %')
    const welcome = (msgs ?? [])[0]?.body ?? ''
    welcome.includes(TEAM) && /Coach: to be confirmed/.test(welcome) && /Training:/.test(welcome) ? ok(`the squad's chat: "${welcome.split('\n')[0]}" with coach, manager, training, ground`) : bad(`welcome: ${welcome.slice(0, 160) || 'missing'}`)
    const { data: q } = await admin.from('notification_queue').select('title, body, url').eq('kind', 'team_published').eq('profile_id', SAM).gte('created_at', started)
    const n = (q ?? [])[0]
    n && n.title === 'Teams are out' && n.body.includes(`is in ${TEAM}`) && n.url === `/chat/${channel}` ? ok(`Sam's one message: "${n.body.split('\n')[0]}" → the squad's chat`) : bad(`queue: ${JSON.stringify(q).slice(0, 240)}`)
    const { data: again } = await headOf.client.rpc('publish_teams', { p_academy: NRIFA, p_program: program })
    again?.players === 0 ? ok('publishing again tells nobody twice') : bad(`again: ${JSON.stringify(again)}`)
    const { error: re } = await headOf.client.rpc('place_trial_player', { p_program: program, p_player: p1.id, p_team: null })
    re && /already published/.test(re.message) ? ok('a published placement cannot be re-pencilled') : bad(`re-place: ${re?.message ?? 'allowed'}`)
    const { data: board } = await headOf.client.rpc('trial_board', { p_program: program })
    const one = (board?.players ?? []).find((p) => p.player_id === p1.id)
    one?.placement?.published_at && one.team === TEAM ? ok('the board shows One published and on the squad') : bad(`board: ${JSON.stringify(one?.placement)}`)
  }

  head('5. The Season screen tells families about moves the same way')
  {
    await admin.from('players').update({ team_id: team }).eq('id', p2.id)
    const { data: pv } = await headOf.client.rpc('publish_teams_preview', { p_academy: NRIFA })
    pv && pv.players === 1 ? ok('one player moved and untold') : bad(`preview: ${JSON.stringify(pv)}`)
    const { data: r } = await headOf.client.rpc('publish_teams', { p_academy: NRIFA, p_program: null, p_teams: [team] })
    r?.players === 1 && r.families === 1 ? ok(`published the move: ${r.players} player, ${r.families} family`) : bad(`publish moves: ${JSON.stringify(r)}`)
    const { data: pv2 } = await headOf.client.rpc('publish_teams_preview', { p_academy: NRIFA })
    pv2?.players === 0 ? ok('nothing left to tell') : bad(`after: ${JSON.stringify(pv2)}`)
    const { error: pe } = await sam.client.rpc('publish_teams', { p_academy: NRIFA })
    pe ? ok('a parent cannot publish') : bad('a parent published')
  }

  head('6. The screens — a phone, then a laptop')
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
      const { context, page } = await open(headOf, `/admin/programs/${program}`, '[data-trial-grading]')
      const text = await page.$eval('[data-trial-grading]', (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '')
      text.includes('Zz Trial One') && /★ 3\.5/.test(text) ? ok('the grading card: One with ★ 3.5') : bad(`grading: ${text.slice(0, 200) || 'missing'}`)
      const rateButtons = await page.$$eval('[data-trial-player] [data-rate]', (bs) => bs.length)
      rateButtons >= 10 ? ok('five rating buttons per player') : bad(`${rateButtons} rating buttons`)
      const published = await page.$('[data-placed-published]')
      published ? ok('One reads as published') : bad('no published marker')
      // Marcus's rating on Two through the screen.
      await page.$eval(`[data-trial-player="${p2.id}"] [data-rate="5"]`, (b) => { b.scrollIntoView({ block: 'center' }); b.click() })
      await page.waitForFunction((id) => document.querySelector(`[data-trial-player="${id}"] [data-rate="5"]`)?.getAttribute('aria-pressed') === 'true', { timeout: 15000 }, p2.id).then(() => ok('a tap rates Two 5')).catch(() => bad('the rating tap did not take'))
      for (const scheme of ['light', 'dark']) {
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }])
        await sleep(150)
        if (SHOTS) await page.screenshot({ path: `.shots/trials-grading-${scheme}.png`, fullPage: true })
      }
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
      const fits = await page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1)
      fits ? ok('fits 375px, light and dark') : bad('wider than the phone')
      await context.close()
    }
    {
      const { context, page } = await open(headOf, `/admin/programs/${program}`, '[data-trial-table]', 1280, 900)
      const headerVisible = await page.$eval('[data-trial-table] > div', (e) => getComputedStyle(e).display !== 'none').catch(() => false)
      headerVisible ? ok('at laptop width the rows line up under a header: a table') : bad('no table header at 1280px')
      if (SHOTS) await page.screenshot({ path: '.shots/trials-grading-laptop.png', fullPage: true })
      await context.close()
    }
    {
      const { context, page } = await open(headOf, '/admin/season', '[data-publish-teams-card]')
      const card = await page.$eval('[data-publish-teams-card]', (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '')
      ;/Every family has been told/.test(card) ? ok('the Season screen: every family has been told') : bad(`season card: ${card.slice(0, 160) || 'missing'}`)
      if (SHOTS) await page.screenshot({ path: '.shots/trials-season-light.png', fullPage: true })
      await context.close()
    }
    {
      const { context, page } = await open(sam, `/admin/programs/${program}`, 'main')
      const grading = await page.$('[data-trial-grading]')
      !grading ? ok('a parent sees no grading card') : bad('a parent saw the grading card')
      await context.close()
    }
  } finally {
    await browser.close()
  }
} finally {
  await cleanup()
  const { count: players } = await admin.from('players').select('id', { count: 'exact', head: true }).eq('academy_id', NRIFA).like('full_name', 'Zz Trial %')
  const { count: teams } = await admin.from('teams').select('id', { count: 'exact', head: true }).eq('academy_id', NRIFA).eq('name', TEAM)
  const { count: tm } = await admin.from('team_members').select('team_id', { count: 'exact', head: true }).eq('profile_id', SAM).eq('academy_id', NRIFA)
  players === 0 && teams === 0 ? ok(`the demo is as it was (Sam back on ${tm} squads)`) : bad(`left behind: ${players} players, ${teams} squads`)
}
console.log(process.exitCode ? '' : '\n  \x1b[32mtrials: the coaches rate, the coordinator pencils, the club publishes once\x1b[0m\n')
