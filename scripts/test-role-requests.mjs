// Run: node --env-file=.env.local scripts/test-role-requests.mjs
//   (needs the app running — npm run dev, or serve:test — and the Inner West
//   FC demo, scripts/seed-inner-west.mjs; SHOTS=1 saves the screens)
//
// Role requests with the club's approval (Joey, 11 Nov 2026; 0256), on
// Inner West FC with its password logins:
//   * Grace (a parent) asks to coach U8 Red from Settings, to be Treasurer
//     and to volunteer with U10 Blue — pending opens nothing;
//   * the U9–U12 coordinator decides only the U10 volunteer, never the U8
//     coach nor the Treasurer's seat, and even the volunteer waits on a
//     Working With Children Check ("waiting on WWCC");
//   * the Secretary cannot seat a Treasurer — only the owner or President;
//   * Club HQ shows the list with Approve / Decline; the President records
//     the check, approves the coach on Admin → Requests, declines the seat
//     with a note; Grace is told each time; the log has every step;
//   * a coach who is also a parent joins again by a squad's link and asks
//     to volunteer there: the approval never demotes them, and the wish
//     arrives as a pending role request.
// Every screen at 375px, light and dark. The demo is left as it was found.
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
const mark = new Date().toISOString()

// --- who --------------------------------------------------------------------
const who = {}
for (const k of ['president', 'secretary', 'coordinator', 'parent', 'coach']) {
  const client = createClient(URL_, PUB, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await client.auth.signInWithPassword({ email: `iw.${k}@squadroom-demo.test`, password: PASSWORD })
  if (error || !data.session) { console.log(`  could not sign in as ${k}: ${error?.message ?? 'no session'} — is the Inner West demo seeded?`); process.exit(2) }
  who[k] = { client, session: data.session, id: data.user.id }
}
const c = (k) => who[k].client
const cookieOf = (k) => `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(who[k].session)).toString('base64')}`
const { data: teamRows } = await admin.from('teams').select('id, name').eq('academy_id', IW).eq('status', 'active')
const team = Object.fromEntries((teamRows ?? []).map((t) => [t.name, t.id]))
const U8RED = team['U8 Red'], U10BLUE = team['U10 Blue']
if (!U8RED || !U10BLUE) { console.log('  the demo is not as seeded — run scripts/seed-inner-west.mjs'); process.exit(2) }

// --- the demo as found ---------------------------------------------------------
const membership = async (id) => (await admin.from('academy_members').select('roles, role').eq('academy_id', IW).eq('profile_id', id).single()).data
const teamRowsOf = async (id) => (await admin.from('team_members').select('team_id, role').eq('academy_id', IW).eq('profile_id', id)).data ?? []
const count = async (table, build) => { const { count } = await build(admin.from(table).select('*', { count: 'exact', head: true })); return count ?? 0 }
async function snapshot() {
  return {
    grace: JSON.stringify(await membership(who.parent.id)), graceTeams: JSON.stringify((await teamRowsOf(who.parent.id)).sort((a, b) => a.team_id.localeCompare(b.team_id))),
    dev: JSON.stringify(await membership(who.coach.id)), devTeams: JSON.stringify((await teamRowsOf(who.coach.id)).sort((a, b) => a.team_id.localeCompare(b.team_id))),
    clearances: await count('staff_clearances', (q) => q.eq('academy_id', IW)), roles: await count('club_roles', (q) => q.eq('academy_id', IW)),
    requests: await count('role_requests', (q) => q.eq('academy_id', IW)), players: await count('players', (q) => q.eq('academy_id', IW)),
    links: await count('join_links', (q) => q.eq('academy_id', IW)), joins: await count('join_requests', (q) => q.eq('academy_id', IW)),
    referees: await count('referees', (q) => q.eq('academy_id', IW)),
  }
}
const before = await snapshot()
if (before.requests > 0) console.log(`  (${before.requests} role requests already in the demo — left alone)`)

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
async function open(k, path, theme = 'light') {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 375, height: 812 })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }])
  if (k) {
    await page.setCookie({ name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(who[k].session)).toString('base64'), domain: 'localhost', path: '/' })
    await page.evaluateOnNewDocument((o) => { try { localStorage.setItem('squadroom.org', o) } catch {} }, IW)
  }
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 90000 })
  return { page, context }
}
const fits = (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1)
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `.shots/role-requests-${name}.png`, fullPage: true }) }

let reqCoach, reqTreasurer, reqVolunteer, link, joinChild
try {
  head('1. Grace asks to coach U8 Red, from Settings')
  {
    const { page, context } = await open('parent', '/settings')
    try {
      await page.waitForSelector('[data-request-role-open]', { timeout: 30000 })
      await page.click('[data-request-role-open]')
      await page.waitForSelector('[data-request-role-kind]', { timeout: 15000 })
      await page.select('[data-request-role-kind]', 'coach')
      await page.waitForSelector(`[data-request-role-squad="${U8RED}"]`, { timeout: 15000 })
      await page.click(`[data-request-role-squad="${U8RED}"]`)
      await page.type('[data-request-role-note]', 'I coached my nephew’s U7s last winter; Grassroots certificate done.')
      ;(await fits(page)) ? ok('the sheet fits 375px') : bad('the request sheet is wider than the phone')
      await shot(page, 'sheet-light')
      await page.click('[data-request-role-send]')
      await page.waitForSelector('[data-request-role-sent]', { timeout: 15000 })
      ok('"Asked" — the committee has it')
    } catch (e) {
      bad(`the Settings sheet: ${String(e.message).slice(0, 100)}`)
    }
    await context.close()
    const { data } = await admin.from('role_requests').select('id, kind, team_ids, status, note').eq('academy_id', IW).eq('profile_id', who.parent.id).eq('kind', 'coach').eq('status', 'pending').maybeSingle()
    reqCoach = data?.id
    data && data.team_ids.length === 1 && data.team_ids[0] === U8RED ? ok('pending: coach of U8 Red, with her note') : bad(`request: ${JSON.stringify(data)}`)
  }

  head('2. Two more requests, and pending opens nothing')
  {
    const t = await c('parent').rpc('request_role', { p_academy: IW, p_kind: 'treasurer' })
    const v = await c('parent').rpc('request_role', { p_academy: IW, p_kind: 'volunteer', p_teams: [U10BLUE], p_area: 'oranges and bibs' })
    reqTreasurer = t.data; reqVolunteer = v.data
    reqTreasurer && reqVolunteer ? ok('Grace asks to be Treasurer, and to volunteer with U10 Blue') : bad(`requests: ${t.error?.message} / ${v.error?.message}`)
    const again = await c('parent').rpc('request_role', { p_academy: IW, p_kind: 'coach', p_teams: [U8RED] })
    again.error ? ok(`asking twice is refused ("${again.error.message.slice(0, 50)}")`) : bad('a second coach request went through')
    const grid = await c('parent').rpc('availability_grid', { p_team: U8RED })
    grid.data == null ? ok('pending: she reads no squad\'s availability') : bad('a pending coach read the availability grid')
    const m = await membership(who.parent.id)
    !m.roles.includes('coach') && (await teamRowsOf(who.parent.id)).find((r) => r.team_id === U8RED)?.role === 'parent' ? ok('and is still a parent on U8 Red, with no coach\'s hat') : bad(`membership while pending: ${JSON.stringify(m)}`)
    const self = await c('parent').rpc('decide_role_request', { p_request: reqCoach, p_approve: true })
    self.error ? ok('nobody approves their own request') : bad('Grace approved herself')
    const list = await c('parent').rpc('role_requests_pending', { p_academy: IW })
    list.data == null ? ok('and a parent has no list of anyone\'s') : bad('a parent read the pending list')
  }

  head('3. The coordinator decides inside their groups only — and not a seat')
  {
    const { data: list } = await c('coordinator').rpc('role_requests_pending', { p_academy: IW })
    const ids = (list ?? []).map((r) => r.id)
    ids.length === 1 && ids[0] === reqVolunteer ? ok('the U9–U12 coordinator sees one: the U10 Blue volunteer') : bad(`coordinator list: ${JSON.stringify((list ?? []).map((r) => r.words))}`)
    const coach = await c('coordinator').rpc('decide_role_request', { p_request: reqCoach, p_approve: true })
    coach.error ? ok('cannot approve the U8 coach — outside their age groups') : bad('a coordinator approved a coach outside their groups')
    const seat = await c('coordinator').rpc('decide_role_request', { p_request: reqTreasurer, p_approve: true })
    seat.error ? ok('cannot approve the Treasurer\'s seat') : bad('a coordinator seated a Treasurer')
    const vol = await c('coordinator').rpc('decide_role_request', { p_request: reqVolunteer, p_approve: true })
    vol.error && /waiting on WWCC/.test(vol.error.message) ? ok('the U10 volunteer waits: "waiting on WWCC" — a squad of children') : bad(`volunteer without a check: ${vol.error?.message ?? 'approved'}`)
  }

  head('4. The Secretary sees all three and cannot seat a Treasurer')
  {
    const { data: list } = await c('secretary').rpc('role_requests_pending', { p_academy: IW })
    const seat = (list ?? []).find((r) => r.id === reqTreasurer)
    ;(list ?? []).length >= 3 && seat && seat.committee && !seat.can_decide ? ok('three on the list; the seat marked "only the owner or the President"') : bad(`secretary list: ${JSON.stringify((list ?? []).map((r) => [r.words, r.can_decide]))}`)
    const r = await c('secretary').rpc('decide_role_request', { p_request: reqTreasurer, p_approve: true })
    r.error ? ok('and approving it is refused') : bad('the Secretary seated a Treasurer')
  }

  head('5. Club HQ: the list on the President\'s Home, and the coordinator\'s')
  for (const theme of ['light', 'dark']) {
    const { page, context } = await open('president', '/', theme)
    try {
      await page.waitForSelector('[data-role-requests][data-on-home]', { timeout: 30000 })
      const n = await page.$$eval(`[data-on-home] [data-role-request-id]`, (els) => els.length)
      const words = await page.$eval('[data-on-home]', (el) => el.innerText.replace(/\s+/g, ' '))
      n >= 3 && words.includes('Grace Okoro') && words.includes('waiting on WWCC') && (await fits(page)) ? ok(`President (${theme}): ${n} requests on Home, "waiting on WWCC" on the coach's`) : bad(`President's Home (${theme}): ${n} rows; ${words.slice(0, 140)}`)
      await shot(page, `home-president-${theme}`)
    } catch (e) {
      bad(`President's Home (${theme}): ${String(e.message).slice(0, 100)}`)
    }
    await context.close()
  }
  {
    const { page, context } = await open('coordinator', '/')
    try {
      await page.waitForSelector('[data-role-requests][data-on-home]', { timeout: 30000 })
      const n = await page.$$eval(`[data-on-home] [data-role-request-id]`, (els) => els.length)
      n === 1 ? ok('the coordinator\'s Home shows the one that is theirs') : bad(`coordinator's Home: ${n} rows`)
      await shot(page, 'home-coordinator-light')
    } catch (e) {
      const persona = await page.$eval('[data-persona]', (el) => el.getAttribute('data-persona')).catch(() => '?')
      bad(`coordinator's Home (persona ${persona}): ${String(e.message).slice(0, 80)}`)
    }
    await context.close()
  }

  head('6. The check recorded; the coordinator says yes to the volunteer')
  {
    const { error } = await c('president').rpc('record_clearance', { p_academy: IW, p_profile: who.parent.id, p_number: 'WWC0911223E', p_outcome: 'cleared', p_expires_on: new Date(Date.now() + 400 * 864e5).toISOString().slice(0, 10) })
    error ? bad(`record the check: ${error.message}`) : ok('the President records Grace\'s Working With Children Check')
    const { data, error: e2 } = await c('coordinator').rpc('decide_role_request', { p_request: reqVolunteer, p_approve: true, p_note: 'Welcome aboard' })
    data?.status === 'approved' ? ok(`the coordinator approves: ${data.words}`) : bad(`volunteer: ${e2?.message}`)
    const { count: vr } = await admin.from('club_roles').select('id', { count: 'exact', head: true }).eq('academy_id', IW).eq('profile_id', who.parent.id).eq('role', 'volunteer').eq('team_id', U10BLUE)
    vr === 1 ? ok('a volunteer\'s club role, with U10 Blue') : bad(`${vr} volunteer roles`)
  }

  head('7. Admin → Requests: the President approves the coach, with a note')
  {
    const { page, context } = await open('president', '/admin/requests')
    try {
      const row = `[data-role-request-id="${reqCoach}"]`
      await page.waitForSelector(row, { timeout: 30000 })
      const text = await page.$eval(row, (el) => el.innerText.replace(/\s+/g, ' '))
      text.includes('check on record') && !text.includes('waiting on WWCC') ? ok('the coach\'s row now reads "check on record"') : bad(`row: ${text.slice(0, 160)}`)
      ;(await fits(page)) ? ok('Requests fits 375px') : bad('Requests is wider than the phone')
      await shot(page, 'admin-light')
      await page.type(`${row} [data-role-request-note]`, 'Welcome — Saturday 9 am at Cintra Park')
      await page.click(`${row} [data-approve-role-request]`)
      await page.waitForSelector('[data-role-request-done]', { timeout: 15000 })
      const done = await page.$eval('[data-role-request-done]', (el) => el.innerText)
      done.includes('Grace Okoro is now coach of U8 Red') ? ok(`"${done}"`) : bad(`done line: ${done}`)
    } catch (e) {
      bad(`Requests screen: ${String(e.message).slice(0, 100)}`)
    }
    await context.close()
    const m = await membership(who.parent.id)
    const tr = (await teamRowsOf(who.parent.id)).find((r) => r.team_id === U8RED)
    m.roles.includes('coach') && m.roles.includes('parent') && tr?.role === 'coach' ? ok('Grace coaches U8 Red now, and is still a parent') : bad(`after approval: ${JSON.stringify(m)}, U8 Red ${tr?.role}`)
    const grid = await c('parent').rpc('availability_grid', { p_team: U8RED })
    grid.data ? ok('and reads the squad\'s availability') : bad(`availability after approval: ${grid.error?.message ?? 'null'}`)
    const { page: dark, context: ctx2 } = await open('president', '/admin/requests', 'dark')
    await dark.waitForSelector('[data-role-requests]', { timeout: 30000 }).catch(() => {})
    ;(await fits(dark)) ? ok('Requests fits 375px in dark') : bad('Requests (dark) is wider than the phone')
    await shot(dark, 'admin-dark')
    await ctx2.close()
  }

  head('8. The seat declined with a note; Grace is told every time')
  {
    const { data, error } = await c('president').rpc('decide_role_request', { p_request: reqTreasurer, p_approve: false, p_note: 'We have a Treasurer until the AGM — thank you' })
    data?.status === 'declined' ? ok('the President declines the Treasurer\'s seat, with a note') : bad(`decline: ${error?.message}`)
    const { data: mine } = await c('parent').rpc('my_role_requests', { p_academy: IW })
    const seat = (mine ?? []).find((r) => r.id === reqTreasurer)
    seat?.status === 'declined' && seat.decision_note?.includes('until the AGM') ? ok('her Settings shows it declined, with the note') : bad(`my requests: ${JSON.stringify(seat)}`)
    const { data: told } = await admin.from('notification_queue').select('title, body').eq('academy_id', IW).eq('profile_id', who.parent.id).eq('kind', 'role_decided').gt('created_at', mark)
    ;(told ?? []).length === 3 ? ok(`told three times: ${(told ?? []).map((t) => t.title).join(' · ')}`) : bad(`told ${told?.length}: ${JSON.stringify(told)}`)
    const { data: asked } = await admin.from('notification_queue').select('profile_id').eq('academy_id', IW).eq('kind', 'role_request').gt('created_at', mark)
    const toPresident = (asked ?? []).filter((n) => n.profile_id === who.president.id).length
    const toCoordinator = (asked ?? []).filter((n) => n.profile_id === who.coordinator.id).length
    toPresident === 3 && toCoordinator === 1 ? ok('the President was told of all three, the coordinator of the one that is theirs') : bad(`told of requests: President ${toPresident}, coordinator ${toCoordinator}`)
    const { data: log } = await c('president').from('activity_log').select('action').eq('academy_id', IW).eq('subject_kind', 'role_request').gt('at', mark)
    const n = (a) => (log ?? []).filter((r) => r.action === a).length
    n('role_request.made') === 3 && n('role_request.approved') === 2 && n('role_request.declined') === 1 ? ok('the log: three asked, two approved, one declined') : bad(`log: ${JSON.stringify(log?.map((r) => r.action))}`)
    const { page, context } = await open('parent', '/settings', 'dark')
    await page.waitForSelector('[data-my-role-request]', { timeout: 30000 }).catch(() => {})
    const rows = await page.$$eval('[data-my-role-request]', (els) => els.map((e) => e.getAttribute('data-my-role-request')))
    rows.filter((s) => s === 'approved').length === 2 && rows.includes('declined') && (await fits(page)) ? ok('Settings (dark, 375px): two approved, one declined') : bad(`Settings rows: ${JSON.stringify(rows)}`)
    await shot(page, 'settings-dark')
    await context.close()
  }

  head('9. A coach who is also a parent joins again: never demoted')
  {
    const { data: dev } = await admin.from('profiles').select('phone, full_name').eq('id', who.coach.id).single()
    const was = await membership(who.coach.id)
    await admin.from('academy_members').update({ roles: Array.from(new Set([...was.roles, 'parent'])) }).eq('academy_id', IW).eq('profile_id', who.coach.id)
    const both = await membership(who.coach.id)
    both.role === 'coach' && both.roles.includes('parent') ? ok(`${dev.full_name} coaches U10 Blue and is a parent too`) : bad(`set-up: ${JSON.stringify(both)}`)
    const { data: l, error: le } = await admin.from('join_links').insert({ academy_id: IW, team_id: U10BLUE, role: 'parent', label: 'role-requests-test', created_by: who.president.id }).select('id, token').single()
    link = l?.id
    if (le || !l) bad(`link: ${le?.message}`)
    else {
      // Signed in as the coach: the join form (a stranger would see Create account).
      const { page, context } = await open('coach', `/join/${l.token}`)
      try {
        await page.waitForSelector('[data-join-wanted-role]', { timeout: 30000 })
        await page.select('[data-join-wanted-role]', 'coach')
        await page.waitForSelector(`[data-join-wanted-squad="${U10BLUE}"][aria-pressed="true"]`, { timeout: 10000 })
        ;(await fits(page)) ? ok('the join page offers a role with the squads, the link\'s ticked, at 375px') : bad('the join page is wider than the phone')
        await shot(page, 'join-light')
      } catch (e) {
        bad(`the join page: ${String(e.message).slice(0, 100)}`)
      }
      await context.close()
      const res = await fetch(`${BASE}/api/join/request`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookieOf('coach') },
        body: JSON.stringify({ token: l.token, children: [{ name: 'Rolecheck Sharma', dob: '2016-05-05' }], wantedRole: 'volunteer', wantedTeams: [U10BLUE], wantedNote: 'BBQ on home days' }),
      })
      const body = await res.json().catch(() => ({}))
      res.ok && body.requestId ? ok('he asks to join by U10 Blue\'s link, with a second child, and offers to volunteer') : bad(`join request: ${res.status} ${JSON.stringify(body)}`)
      const appr = await fetch(`${BASE}/api/join/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookieOf('president') }, body: JSON.stringify({ requestId: body.requestId, decision: 'approve' }) })
      appr.ok ? ok('the President approves the join') : bad(`approve: ${appr.status} ${await appr.text()}`)
      const after = await membership(who.coach.id)
      const tr = (await teamRowsOf(who.coach.id)).find((r) => r.team_id === U10BLUE)
      after.role === 'coach' && after.roles.includes('coach') && after.roles.includes('parent') && tr?.role === 'coach' ? ok('still the coach — of the club and of U10 Blue — and a parent') : bad(`after the join: ${JSON.stringify(after)}, U10 Blue ${tr?.role}`)
      const { data: kid } = await admin.from('players').select('id').eq('academy_id', IW).eq('full_name', 'Rolecheck Sharma').maybeSingle()
      joinChild = kid?.id
      const { count: g } = kid ? await admin.from('player_guardians').select('*', { count: 'exact', head: true }).eq('player_id', kid.id).eq('profile_id', who.coach.id) : { count: 0 }
      g === 1 ? ok('his second child is on the roster, with him as guardian') : bad('the child was not linked')
      const { data: wish } = await admin.from('role_requests').select('id, kind, status, team_ids, note').eq('academy_id', IW).eq('profile_id', who.coach.id).eq('status', 'pending').maybeSingle()
      wish?.kind === 'volunteer' && wish.team_ids[0] === U10BLUE && wish.note === 'BBQ on home days' ? ok('and his offer to volunteer is a pending request for the committee') : bad(`the wish: ${JSON.stringify(wish)}`)
    }
  }
} catch (e) {
  bad(`threw: ${e.message}`)
} finally {
  await browser.close()
}

// --- take it all back -------------------------------------------------------------
head('10. The demo as it was')
await admin.from('role_requests').delete().eq('academy_id', IW).in('profile_id', [who.parent.id, who.coach.id]).gt('created_at', mark)
await admin.from('club_roles').delete().eq('academy_id', IW).eq('profile_id', who.parent.id).eq('role', 'volunteer')
await admin.from('staff_clearances').delete().eq('academy_id', IW).eq('profile_id', who.parent.id).eq('number', 'WWC0911223E')
if (joinChild) { await admin.from('player_guardians').delete().eq('player_id', joinChild); await admin.from('players').delete().eq('id', joinChild) }
await admin.from('join_requests').delete().eq('academy_id', IW).eq('full_name', 'Dev Sharma').gt('created_at', mark)
if (link) await admin.from('join_links').delete().eq('id', link)
for (const [id, snap, teamsSnap] of [[who.parent.id, before.grace, before.graceTeams], [who.coach.id, before.dev, before.devTeams]]) {
  const m = JSON.parse(snap)
  await admin.from('academy_members').update({ roles: m.roles }).eq('academy_id', IW).eq('profile_id', id)
  const was = JSON.parse(teamsSnap)
  const now = await teamRowsOf(id)
  for (const r of now) {
    const w = was.find((x) => x.team_id === r.team_id)
    if (!w) await admin.from('team_members').delete().eq('team_id', r.team_id).eq('profile_id', id)
    else if (w.role !== r.role) await admin.from('team_members').update({ role: w.role }).eq('team_id', r.team_id).eq('profile_id', id)
  }
}
await admin.from('notification_queue').delete().eq('academy_id', IW).gt('created_at', mark)
await admin.from('activity_log').delete().eq('academy_id', IW).gt('at', mark)
const after = await snapshot()
const diff = Object.keys(before).filter((k) => before[k] !== after[k])
diff.length === 0 ? ok('Grace, Dev and every count as before') : bad(`changed: ${diff.map((k) => `${k} ${String(before[k]).slice(0, 60)} → ${String(after[k]).slice(0, 60)}`).join('; ')}`)

console.log(process.exitCode ? '\n\x1b[31mROLE REQUESTS ARE WRONG\x1b[0m\n' : '\n\x1b[32mall good\x1b[0m\n')
