// The screen check (Joey, 15 Nov 2026): at key moments of the simulated
// season, open the REAL app at 375px as a sample of people — parents (one
// with children at two clubs), coaches, a team manager, a club president,
// the league organiser, a referee — and check Home, Fixtures, the game page,
// the ladder, the chats and the notices show what the database says.
// Screenshots go to .cache/screens/<moment>/; a mismatch is a bug.
//
// Needs the app built for the local stack and serving on :3300 (stack.mjs
// explains); without it the check is skipped with a note, never failed.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { ROOT, check, clock, ids, note, rpc, scenario, sql, val, who } from './lib.mjs'
import { COMP, LEAGUE, eventFor, gamesOn, guardianOf, ladder, noticesChannel, refereeOf, squad } from './world.mjs'
import { APP_URL, sessionCookie, sessionFor, setDbClock, startStack } from './stack.mjs'

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SC = { draw: 'SC1', washout: 'SC2', dispute: 'SC3', suspension: 'SC4', finals: 'SC5', season5: 'SC6' }
const TITLES = {
  draw: 'Screens after the draw: Home, Fixtures, the game page, the ladder, chats and notices as nine people see them',
  washout: 'Screens on a washout Saturday: every called-off game reads as off to the families, the coach, the league and the referee',
  dispute: 'Screens with a result in dispute: no score stands, the league sees the dispute, the ladder waits',
  suspension: 'Screens after a suspension: the coach and the club see it, the league\'s discipline page lists it',
  finals: 'Screens at the finals: the grand finals, the finished ladders, the champions',
  season5: 'Screens in Season 5: the season switcher, last season\'s page and ladders in full, head to head for this season',
}

const txt = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()
const has = (body, needle) => needle && txt(body).toLowerCase().includes(txt(needle).toLowerCase())

/**
 * Open the app as `person` and photograph `pages`. Returns { path: text }.
 */
async function visit(browser, db, person, pages, dir, label, simNow) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 375, height: 812 })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
  const session = await sessionFor(db, person.id)
  await page.setCookie(sessionCookie(session))
  // The browser's clock is the season's (the database's is, through the stack).
  const shift = simNow.getTime() - Date.now()
  await page.evaluateOnNewDocument((org, shiftMs) => {
    try { localStorage.setItem('squadroom.org', org) } catch {}
    const RealDate = Date
    class SimDate extends RealDate {
      constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + shiftMs) }
      static now() { return RealDate.now() + shiftMs }
    }
    globalThis.Date = SimDate
  }, person.org, shift)
  const out = {}
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)))
  for (const [name, path] of Object.entries(pages)) {
    try {
      await page.goto(`${APP_URL}${path}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
      // Settle: no skeleton, and a quiet moment.
      await page.waitForFunction(() => !document.querySelector('[data-skeleton]'), { timeout: 20000 }).catch(() => null)
      await new Promise((r) => setTimeout(r, 1500))
      const body = await page.evaluate(() => document.body?.innerText ?? '')
      out[name] = body
      await page.screenshot({ path: join(dir, `${label}-${name}.png`), fullPage: true }).catch(() => null)
      writeFileSync(join(dir, `${label}-${name}.txt`), body)
    } catch (e) {
      out[name] = `ERROR ${e.message}`
    }
  }
  out.__errors = errors
  await context.close()
  return out
}

export async function runScreens(ctx, moment, { extraPages = null } = {}) {
  const { pool } = ctx
  const up = await fetch(`${APP_URL}/signin`).then((r) => r.ok).catch(() => false)
  if (!up) { note(`screens (${moment}): the app is not serving at ${APP_URL} — skipped`); ctx.needsJoey?.push(`The screen check at "${moment}" was skipped: the app was not built for the local stack (scripts/simulation/stack.mjs).`); return }
  let puppeteer
  try { puppeteer = (await import('puppeteer-core')).default } catch { note('puppeteer-core is not installed — screens skipped'); return }
  scenario(SC[moment], 'Screens', TITLES[moment])
  const dir = join(ROOT, '.cache', 'screens', `${ctx.seed ?? 1}-${moment}`)
  mkdirSync(dir, { recursive: true })
  const db = new pg.Client({ host: 'localhost', port: 54329, user: 'postgres', password: 'local', database: 'squadroom_local' })
  await db.connect()
  await setDbClock(db, clock.iso())
  const stack = await startStack(db)
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
  const simNow = new Date(clock.now)
  try {
    // ---- the sample: around one game of the day (or the next day with games).
    const today = clock.local().slice(0, 10)
    let games = await gamesOn(pool, today)
    if (!games.length) {
      const next = await val(pool, `select min((starts_at at time zone 'Australia/Sydney')::date)::text from public.fixtures where competition_id = $1 and starts_at > now()`, [COMP])
      games = next ? await gamesOn(pool, next) : []
    }
    const focus = games.find((g) => g.home_team && g.away_team && g.division === 'U11 Division 1') ?? games.find((g) => g.home_team && g.away_team)
    if (!focus) { note('no game to focus the screens on'); return }
    const home = await squad(pool, focus.home_team), away = await squad(pool, focus.away_team)
    const u9 = games.find((g) => g.division.startsWith('U9') && g.home_team)
    const u9sq = u9 ? await squad(pool, u9.home_team) : null
    const ref = await refereeOf(pool, focus.id)
    const notices = await noticesChannel(pool)
    const sample = [
      { label: 'parent-two-clubs', role: 'parent (children at two clubs)', id: ids.parent(1, 1), org: ids.club(1) },
      { label: 'parent-home', role: 'parent', id: await guardianOf(pool, home.players[0]), org: focus.home_club, team: home, game: focus, side: 'home' },
      ...(u9sq ? [{ label: 'parent-u9', role: 'parent (U9)', id: await guardianOf(pool, u9sq.players[0]), org: u9.home_club, team: u9sq, game: u9, side: 'home' }] : []),
      { label: 'coach-home', role: 'coach', id: home.coach, org: focus.home_club, team: home, game: focus, side: 'home' },
      { label: 'coach-away', role: 'coach', id: away.coach, org: focus.away_club, team: away, game: focus, side: 'away' },
      { label: 'manager-away', role: 'team manager', id: away.manager, org: focus.away_club, team: away, game: focus, side: 'away' },
      { label: 'president-home', role: 'club president', id: await val(pool, `select profile_id from public.academy_members where academy_id = $1 and role = 'owner' limit 1`, [focus.home_club]), org: focus.home_club, team: home, game: focus, side: 'home' },
      { label: 'league', role: 'league organiser', id: who.compManager, org: LEAGUE, game: focus },
      ...(ref?.profile_id ? [{ label: 'referee', role: 'referee', id: ref.profile_id, org: LEAGUE, game: focus }] : []),
    ].filter((p) => p.id)

    for (const p of sample) {
      const pages = { home: '/', fixtures: '/calendar', chat: '/chat', ladder: `/competitions/${COMP}?tab=ladder`, notices: `/chat/${notices}` }
      if (p.team) {
        const ev = await eventFor(pool, p.game.id, p.org)
        if (ev) pages.game = `/calendar/${ev}`
        if (p.team.channel) pages.team = `/chat/${p.team.channel}`
      } else if (p.label === 'league') {
        pages.game = `/competitions/${COMP}/match/${p.game.id}`
        pages.run = `/competitions/${COMP}?tab=run`
      } else if (p.label === 'referee') {
        pages.referee = '/referee'
      }
      if (extraPages && (p.label === 'league' || p.label === 'parent-home')) {
        for (const [k, v] of Object.entries(extraPages(p) ?? {})) if (v) pages[k] = v
      }
      const seen = await visit(browser, db, p, pages, dir, p.label, simNow)
      const where = `screens (${moment}) · ${p.label}`
      // Every page rendered something that is not an error or a sign-in.
      for (const [name, body] of Object.entries(seen)) {
        if (name === '__errors') continue
        const bad = body.startsWith('ERROR') || /Application error|Something went wrong|Sign in to Squadroom|Create account/i.test(body) && name !== 'notices'
        check(!bad, { what: `${p.role}: ${name} opens`, expected: 'a screen', actual: body.slice(0, 120), role: p.role, where: `${where} ${pages[name]}` })
      }
      if (seen.__errors.length) check(false, { what: `${p.role}: no page errors`, expected: 'none', actual: seen.__errors.slice(0, 2).join(' | '), role: p.role, where, severity: 'medium' })

      // ---- Home against home_jobs.
      const jobs = await rpc(pool, p.id, 'home_jobs', { p_academy: p.org, p_persona: null })
      // A parent's Home lists a job only while there is something to do (one list, by design); a staff Home shows its tiles always.
      for (const j of (jobs.data?.jobs ?? []).slice(0, 3)) {
        const detail = txt(j.detail).split(' · ')[0]
        const expectedOnScreen = (j.count ?? 0) > 0 || !/parent/.test(p.role)
        if (expectedOnScreen && detail && detail.length > 3) check(has(seen.home, detail) || has(seen.home, j.label), { what: `${p.role}: Home shows "${j.label}" (${detail})`, expected: detail, actual: txt(seen.home).slice(0, 160), role: p.role, where: `${where} /` , severity: 'medium' })
      }
      // ---- Fixtures against my_upcoming_events (the first game's opponent).
      if (p.team) {
        const up = await rpc(pool, p.id, 'my_upcoming_events', { p_academy: p.org, p_days: 21 })
        const first = (up.data ?? []).find((e) => e.type === 'match')
        if (first?.opponent) check(has(seen.fixtures, first.opponent), { what: `${p.role}: Fixtures lists the next game (v ${first.opponent})`, expected: first.opponent, actual: txt(seen.fixtures).slice(0, 200), role: p.role, where: `${where} /calendar` })
        // ---- The game page: opponent, ground and field, and whether it is off.
        const ev = await eventFor(pool, p.game.id, p.org)
        const e = (await sql(pool, `select title, venue, opponent, cancelled_at, cancellation_reason from public.events where id = $1`, [ev]))[0]
        if (e) {
          check(has(seen.game, e.opponent), { what: `${p.role}: the game page names the opponent`, expected: e.opponent, actual: txt(seen.game).slice(0, 160), role: p.role, where: `${where} /calendar/${ev}` })
          const fieldPart = (e.venue ?? '').split(' · ')[1]
          if (fieldPart) check(has(seen.game, fieldPart), { what: `${p.role}: the game page shows the field (${fieldPart})`, expected: fieldPart, actual: txt(seen.game).slice(0, 160), role: p.role, where: `${where} /calendar/${ev}` })
          if (e.cancelled_at) check(/called off|cancelled|postponed|off/i.test(seen.game), { what: `${p.role}: a called-off game reads as off`, expected: 'Called off', actual: txt(seen.game).slice(0, 160), role: p.role, where: `${where} /calendar/${ev}` })
          else check(!/called off/i.test(seen.game), { what: `${p.role}: a game that is on does not read as called off`, expected: 'on', actual: txt(seen.game).slice(0, 120), role: p.role, where: `${where} /calendar/${ev}` })
        }
        // ---- The team chat shows the latest line.
        const last = await val(pool, `select body from public.messages where channel_id = $1 and status = 'published' and deleted_at is null and body is not null order by created_at desc limit 1`, [p.team.channel])
        if (last) check(has(seen.team, last.slice(0, 40)), { what: `${p.role}: the squad chat shows the latest message`, expected: last.slice(0, 40), actual: txt(seen.team).slice(-200), role: p.role, where: `${where} /chat/${p.team.channel}` })
      }
      // ---- The ladder: the leader above the second (U11 Division 1).
      const lad = await ladder(pool, 'U11 Division 1', p.id)
      if (lad.length >= 2 && lad[0].played > 0) {
        const a = txt(seen.ladder).indexOf(lad[0].team_name), b = txt(seen.ladder).indexOf(lad[1].team_name)
        check(a >= 0 && (b < 0 || a < b), { what: `${p.role}: the ladder has ${lad[0].team_name} above ${lad[1].team_name}`, expected: 'leader first', actual: a < 0 ? 'leader not on the page' : 'order differs', role: p.role, where: `${where} ladder`, severity: 'medium' })
      }
      // ---- The notices: the latest notice this person may read.
      const notice = await val(pool, `select body from public.messages m where m.channel_id = $1 and m.status = 'published' and (m.audience = 'everyone' or $2) order by created_at desc limit 1`, [notices, ['league', 'coach', 'club president', 'team manager', 'league organiser'].includes(p.role) || p.role.startsWith('coach')])
      if (notice) check(has(seen.notices, notice.slice(0, 40)), { what: `${p.role}: Notices shows the latest notice`, expected: notice.slice(0, 40), actual: txt(seen.notices).slice(-200), role: p.role, where: `${where} /chat/${notices}`, severity: 'medium' })
      // ---- The league's run sheet counts the day's games; the referee sees the appointment.
      if (p.label === 'league') {
        check(has(seen.run, focus.home_name) && has(seen.run, focus.away_name), { what: 'league organiser: the run sheet lists the focus game', expected: `${focus.home_name} v ${focus.away_name}`, actual: txt(seen.run).slice(0, 200), role: p.role, where: `${where} ?tab=run` })
      }
      if (p.label === 'referee') {
        check(has(seen.referee, focus.home_name) || has(seen.referee, focus.away_name), { what: 'referee: their appointment is on the referee screen', expected: `${focus.home_name} v ${focus.away_name}`, actual: txt(seen.referee).slice(0, 200), role: p.role, where: `${where} /referee` })
      }
      if (moment === 'season5' && seen.centre5) {
        check(/Season 4/.test(seen.centre5) && /Season 5/.test(seen.centre5), { what: `${p.role}: the public match centre's season switcher names Season 4 and Season 5`, expected: 'both seasons', actual: txt(seen.centre5).slice(0, 200), role: p.role, where: `${where} /c/spl-season-5` })
        check(/Final/.test(seen.centre4) && /finished/i.test(seen.centre4), { what: `${p.role}: Season 4's page still reads in full and says it is finished`, expected: 'finals listed, "finished"', actual: txt(seen.centre4).slice(0, 200), role: p.role, where: `${where} /c/spl-season-4`, severity: 'medium' })
        if (seen.publicGame) check(/Head to head/.test(seen.publicGame) && !/2027/.test(seen.publicGame.split('Head to head')[1] ?? ''), { what: `${p.role}: a public game page shows this season's head to head and nothing from 2027`, expected: 'Head to head · 2028', actual: txt(seen.publicGame).slice(0, 240), role: p.role, where: `${where} public game` })
        if (seen.competition4) check(/Season over|read-only/i.test(seen.competition4) || /Ladder/.test(seen.competition4), { what: `${p.role}: last season's competition page opens read-only with its ladder`, expected: 'Season over · read-only', actual: txt(seen.competition4).slice(0, 200), role: p.role, where: `${where} /competitions/<season 4>`, severity: 'medium' })
      }
      if (moment === 'season5' && p.team && seen.fixtures) {
        check(/2027/.test(seen.fixtures), { what: `${p.role}: Fixtures offers the 2027 season`, expected: 'a 2027 chip', actual: txt(seen.fixtures).slice(0, 200), role: p.role, where: `${where} /calendar`, severity: 'medium' })
      }
    }
    note(`screens (${moment}): ${sample.length} people photographed → ${dir}`)
  } finally {
    await browser.close().catch(() => null)
    await stack.stop().catch(() => null)
    await setDbClock(db, null).catch(() => null)
    await db.end().catch(() => null)
  }
}
