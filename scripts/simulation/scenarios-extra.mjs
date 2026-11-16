// Joey's list of 16 Nov 2026 — more to test, added to the Season 4
// simulation as timed steps in the rounds they belong to:
//
//   round 4   RR  role requests mid-season (manager, volunteer, referee), approved and declined
//   round 4   TP  two parents answering differently for the same child; one person on two devices
//   round 5   JF  200+ new families joining mid-season through the sign-up flow (coach link → account → code → team)
//   round 6   FS  real files through the real storage: chat photos (HEIC, a large one), match photos, registration photos, PDFs
//   round 8   SW  feature switches off: a switched-off feature vanishes everywhere for that club
//   round 9   AM  admin mistakes: a wrong import undone, the draw re-published mid-season, a team deleted by mistake
//   round 10  PY  payments through Stripe test mode for a sample of clubs (entry fees, registrations, instalments, a refund)
//   round 11  MD  a family downloads and deletes their data mid-season
//
// Every step is a scenario with checks (PASS / FIXED / FAIL in
// docs/SIMULATION.md); a mismatch is a bug in docs/BUGS.md. Steps that need
// the real app go through live.mjs (the stack up at the season's moment, a
// browser whose clock is the season's). A step can be run on its own with
// scripts/simulation/step.mjs while it is being built.
import { check, clock, ids, mustRefuse, mustWork, note, rpc, run, scenario, sql, val, who } from './lib.mjs'
import { COMP, LEAGUE, eventFor, gamesOn, guardianOf, playerName, queued, rsvp, squad } from './world.mjs'
import { plusDays } from './routine.mjs'
import { openSettled, pageAs, withStack } from './live.mjs'
import { APP_URL, sessionCookie, sessionFor } from './stack.mjs'

/** The steps for round r (Saturday S). `add(at, name, fn)`; a step's checks file under the scenario its name starts with. */
export async function extraPlan(ctx, r, S, add, rand) {
  switch (r) {
    case 4:
      await roleRequests(ctx, S, add, rand)
      await twoParents(ctx, S, add, rand)
      break
    case 5:
      await joiningFamilies(ctx, S, add, rand)
      break
    default:
      break
  }
}

// ======================================================= RR · role requests
async function roleRequests(ctx, S, add, rand) {
  const { pool } = ctx
  const c = 11 + rand.int(20)
  const club = ids.club(c)
  add(`${plusDays(S, -4)} 19:30`, 'RR1 parents ask for roles; the committee decides', async () => {
    scenario('RR1', 'Role requests', 'Role requests mid-season (team manager, volunteer, referee): asked from Settings, the committee told and the President\'s Home counting them, a check needed before approval, approved and declined, the person told')
    const team = await val(pool, `select t.id from public.teams t where t.academy_id = $1 and t.season = '2027' order by t.name limit 1`, [club])
    const sq = await squad(pool, team)
    const [p1, p2, p3] = sq.parents
    if (!p1 || !p2 || !p3) { note(`club ${c}'s first squad has fewer than three parents`); return }
    const pres = who.president(c)
    const since = clock.iso()
    const r1 = await rpc(pool, p1, 'request_role', { p_academy: club, p_kind: 'team_manager', p_teams: [team], p_area: null, p_note: 'Happy to run the sheet and the sideline' })
    mustWork(r1, { what: 'a parent asks to be the squad\'s team manager', role: 'parent', where: 'request_role' })
    const again = await rpc(pool, p1, 'request_role', { p_academy: club, p_kind: 'team_manager', p_teams: [team], p_area: null, p_note: 'again' })
    mustRefuse(again, { what: 'asking twice while the first request waits is refused', role: 'parent', where: 'request_role' })
    const r2 = await rpc(pool, p2, 'request_role', { p_academy: club, p_kind: 'volunteer', p_teams: [team], p_area: null, p_note: 'Canteen and the barbecue' })
    mustWork(r2, { what: 'a parent asks to volunteer for the squad', role: 'parent', where: 'request_role' })
    const r3 = await rpc(pool, p3, 'request_role', { p_academy: club, p_kind: 'referee', p_teams: [], p_area: null, p_note: 'Level 4 badge, free most Saturdays' })
    mustWork(r3, { what: 'a parent offers to referee for the club', role: 'parent', where: 'request_role' })
    const stranger = await rpc(pool, ids.parent(c === 60 ? 1 : c + 1, 1), 'request_role', { p_academy: club, p_kind: 'volunteer', p_teams: [], p_area: null, p_note: 'hello' })
    mustRefuse(stranger, { what: 'a parent from another club is told to join the club first', role: 'parent (another club)', where: 'request_role' })
    // The committee is told; the President's list and Home carry them; the parent sees theirs waiting.
    const told = await queued(pool, { kind: 'role_request', since })
    check(told.some((n) => n.profile_id === pres), { what: 'the President is told of a role request', expected: 'a role_request push to the President', actual: `${told.length} queued, to ${[...new Set(told.map((n) => n.profile_id))].length} people`, role: 'club president', where: 'role_requests_log_and_tell' })
    const pending = (await rpc(pool, pres, 'role_requests_pending', { p_academy: club })).data
    const ours = (Array.isArray(pending) ? pending : []).filter((x) => [p1, p2, p3].includes(x.profile_id))
    check(ours.length === 3 && ours.every((x) => x.can_decide), { what: 'the President\'s Requests page lists the three, each decidable', expected: '3, can_decide', actual: `${ours.length} (${ours.map((x) => `${x.kind}:${x.can_decide}`).join(', ')})`, role: 'club president', where: 'role_requests_pending' })
    const mine = (await rpc(pool, p1, 'my_role_requests', { p_academy: club })).data
    check((Array.isArray(mine) ? mine : []).some((x) => x.kind === 'team_manager' && x.status === 'pending'), { what: 'the parent sees their request waiting under Settings', expected: 'team_manager pending', actual: JSON.stringify(mine).slice(0, 120), role: 'parent', where: 'my_role_requests' })
    const jobs = (await rpc(pool, pres, 'home_jobs', { p_academy: club, p_persona: 'president' })).data
    const dec = (jobs?.jobs ?? []).find((j) => j.id === 'decisions')
    check(Boolean(dec) && /role request/i.test(dec.detail ?? ''), { what: 'the President\'s Home counts the role requests among the decisions', expected: '"… role requests"', actual: dec ? `${dec.label}: ${dec.detail}` : 'no decisions tile', role: 'club president', where: 'home_jobs (president)', severity: 'medium' })
    // No approval without a Working With Children Check on file; the club records them, then decides.
    const early = await rpc(pool, pres, 'decide_role_request', { p_request: r1.data, p_approve: true, p_note: null })
    mustRefuse(early, { what: 'approving a team manager with no Working With Children Check recorded is refused', role: 'club president', where: 'decide_role_request' })
    if (!early.ok) check(/Working With Children/.test(early.error), { what: 'the refusal says what to record first', expected: 'names the check', actual: early.error, role: 'club president', where: 'decide_role_request', severity: 'low' })
    for (const [p, n] of [[p1, 'WWC1700001E'], [p3, 'WWC1700003E']]) {
      const rc = await rpc(pool, pres, 'record_clearance', { p_academy: club, p_profile: p, p_number: n, p_outcome: 'cleared', p_expires_on: '2031-06-30', p_kind: 'wwcc', p_note: null })
      mustWork(rc, { what: 'the President records the check', role: 'club president', where: 'record_clearance' })
    }
    const ok1 = await rpc(pool, pres, 'decide_role_request', { p_request: r1.data, p_approve: true, p_note: null })
    mustWork(ok1, { what: 'the team manager request is approved', role: 'club president', where: 'decide_role_request' })
    const role = await val(pool, `select count(*)::int from public.club_roles where academy_id = $1 and profile_id = $2 and role = 'team_manager' and team_id = $3`, [club, p1, team])
    check(role === 1, { what: 'the parent is now the squad\'s team manager', expected: 1, actual: role, role: 'club president', where: 'club_roles' })
    const no2 = await rpc(pool, pres, 'decide_role_request', { p_request: r2.data, p_approve: false, p_note: 'Full for now — thank you' })
    mustWork(no2, { what: 'the volunteer request is declined with a note', role: 'club president', where: 'decide_role_request' })
    const ok3 = await rpc(pool, pres, 'decide_role_request', { p_request: r3.data, p_approve: true, p_note: null })
    mustWork(ok3, { what: 'the referee request is approved', role: 'club president', where: 'decide_role_request' })
    const ref = await val(pool, `select count(*)::int from public.referees where academy_id = $1 and profile_id = $2`, [club, p3])
    check(ref === 1, { what: 'the parent is on the club\'s referee list', expected: 1, actual: ref, role: 'club president', where: 'referees' })
    const decided = await queued(pool, { kind: 'role_decided', since })
    check(decided.some((n) => n.profile_id === p1 && /You're in/.test(n.title ?? '')), { what: 'the new team manager is told "You\'re in"', expected: 'a role_decided push', actual: decided.filter((n) => n.profile_id === p1).map((n) => n.title).join('; ') || 'nothing', role: 'parent', where: 'notification_queue (role_decided)' })
    check(decided.some((n) => n.profile_id === p2 && /Not approved/.test(n.body ?? '') && /Full for now/.test(n.body ?? '')), { what: 'the declined volunteer is told, with the note', expected: '"Not approved — Full for now…"', actual: decided.filter((n) => n.profile_id === p2).map((n) => n.body).join('; ') || 'nothing', role: 'parent', where: 'notification_queue (role_decided)' })
    // The new manager can do a manager's job: the squad's next sheet is theirs to submit.
    const may = (await rpc(pool, p1, 'home_jobs', { p_academy: club, p_persona: 'manager' })).data
    check((may?.jobs ?? []).length >= 1, { what: 'the new manager\'s Home shows the manager\'s jobs', expected: '≥1 job', actual: `${(may?.jobs ?? []).length} jobs (persona ${may?.persona})`, role: 'team manager', where: 'home_jobs (manager)', severity: 'medium' })
    ctx.roleRequests = { club, team, manager: p1, referee: p3 }
  })
}

// ================================================= TP · two parents, two devices
async function twoParents(ctx, S, add, rand) {
  const { pool } = ctx
  void rand
  add(`${plusDays(S, -3)} 20:15`, 'TP1 two parents answer differently for the same child', async () => {
    scenario('TP1', 'Two devices, two parents', 'Two parents answer differently for the same child: one answer per child, the latest, everywhere the coach looks; each parent sees the family\'s answer')
    const row = (await sql(pool, `
      select pl.id as player, pl.full_name, pl.team_id, pl.academy_id, e.id as event,
             array_agg(g.profile_id order by g.is_primary desc, g.profile_id) as guardians
        from public.players pl
        join public.player_guardians g on g.player_id = pl.id
        join public.events e on e.team_id = pl.team_id and e.fixture_id is not null and e.cancelled_at is null
         and (e.starts_at at time zone 'Australia/Sydney')::date = $1::date
       where not exists (select 1 from public.event_rsvps x where x.event_id = e.id and x.player_id = pl.id)
       group by 1, 2, 3, 4, 5 having count(*) = 2
       order by pl.id limit 1`, [S]))[0]
    if (!row) { note('no child with two guardians and an unanswered game this Saturday'); return }
    const [a, b] = row.guardians
    const sq = await squad(pool, row.team_id)
    const pick = (r) => (Array.isArray(r.data) ? r.data[0] : r.data)
    const s0 = pick(await rpc(pool, sq.coach, 'event_rsvp_summary', { p_event: row.event }))
    const yes = await rsvp(pool, a, row.academy_id, row.event, row.player, 'yes')
    mustWork(yes, { what: 'the first parent says yes', role: 'parent', where: 'event_rsvps' })
    clock.advance(2 / 60)
    const no = await rsvp(pool, b, row.academy_id, row.event, row.player, 'no', 'Away at a wedding that weekend')
    mustWork(no, { what: 'the second parent says no, two minutes later', role: 'parent', where: 'event_rsvps' })
    const s1 = pick(await rpc(pool, sq.coach, 'event_rsvp_summary', { p_event: row.event }))
    check(s1 && s0 && s1.going === s0.going && s1.out_count === s0.out_count + 1 && s1.no_reply === s0.no_reply - 1,
      { what: 'the coach\'s tally counts the child once, with the family\'s latest answer', expected: `going ${s0?.going}, out ${(s0?.out_count ?? 0) + 1}, no reply ${(s0?.no_reply ?? 0) - 1}`, actual: JSON.stringify(s1), role: 'coach', where: 'event_rsvp_summary' })
    const reg = (await rpc(pool, sq.coach, 'event_register', { p_event: row.event })).data
    const mine = (Array.isArray(reg) ? reg : []).find((x) => x.player_id === row.player)
    check(mine?.rsvp === 'no', { what: 'the register shows the family\'s latest answer', expected: 'no', actual: mine?.rsvp ?? 'no row', role: 'coach', where: 'event_register', severity: 'medium' })
    const screen = (await rpc(pool, sq.coach, 'game_screen', { p_event: row.event })).data
    const entries = (screen?.roster ?? []).filter((x) => x.player_id === row.player)
    check(entries.length === 1 && entries[0].status === 'no', { what: 'Who\'s coming lists the child once, with the latest answer', expected: '1 row, no', actual: `${entries.length} rows: ${entries.map((x) => x.status).join(', ')}`, role: 'coach', where: 'game_screen (roster)', severity: 'medium' })
    const not = (await rpc(pool, sq.coach, 'who_hasnt_answered', { p_event: row.event })).data
    check(!(Array.isArray(not) ? not : []).some((x) => x.player_id === row.player), { what: 'an answered child is not on the "not answered" list', expected: 'absent', actual: 'listed', role: 'coach', where: 'who_hasnt_answered' })
    const seenByA = (await rpc(pool, a, 'my_rsvps_for_event', { p_event: row.event })).data
    const aRow = (Array.isArray(seenByA) ? seenByA : []).find((x) => x.player_id === row.player)
    check(aRow?.status === 'no', { what: 'the first parent sees the family\'s current answer (the other parent said no after them)', expected: 'no', actual: aRow?.status ?? 'no row', role: 'parent', where: 'my_rsvps_for_event', severity: 'medium' })
    ctx.twoParents = { ...row, a, b, coach: sq.coach }
  })
  add(`${plusDays(S, -2)} 19:40`, 'TP2 one person on two devices', async () => {
    scenario('TP2', 'Two devices, two parents', 'One person on two devices: an answer given on one phone is on the other after a refresh; a tap on each device leaves one answer, the latest')
    const tp = ctx.twoParents
    if (!tp) { note('TP1 found no family to follow'); return }
    await withStack(ctx, 'TP2 two devices', async ({ db, browser }) => {
      const d1 = await pageAs(browser, db, tp.a, { org: tp.academy_id })
      const d2 = await pageAs(browser, db, tp.a, { org: tp.academy_id })
      try {
        await openSettled(d1.page, `/calendar/${tp.event}`)
        await openSettled(d2.page, `/calendar/${tp.event}`)
        const sel = (choice) => `button[data-choice="${choice}"][data-player="${tp.player}"]`
        const btn = await d1.page.$(sel('maybe'))
        check(Boolean(btn), { what: 'the game page offers the answer buttons for the child', expected: 'Going · Maybe · Out', actual: btn ? 'buttons' : 'none', role: 'parent', where: `/calendar/${tp.event}` })
        if (!btn) return
        await btn.click()
        await new Promise((r) => setTimeout(r, 3000))
        const saved = await val(pool, `select status::text from public.event_rsvps where event_id = $1 and player_id = $2 and profile_id = $3`, [tp.event, tp.player, tp.a])
        check(saved === 'maybe', { what: 'the tap on device 1 is saved', expected: 'maybe', actual: saved, role: 'parent', where: 'event_rsvps' })
        await openSettled(d2.page, `/calendar/${tp.event}`)
        const pressed = await d2.page.$eval(sel('maybe'), (el) => el.getAttribute('aria-pressed')).catch(() => null)
        check(pressed === 'true', { what: 'device 2 shows the answer given on device 1 after a refresh', expected: 'Maybe pressed', actual: String(pressed), role: 'parent', where: 'game page (device 2)', severity: 'medium' })
        const b2 = await d2.page.$(sel('yes'))
        if (b2) { await b2.click(); await new Promise((r) => setTimeout(r, 3000)) }
        const rows = await sql(pool, `select status::text from public.event_rsvps where event_id = $1 and player_id = $2 and profile_id = $3`, [tp.event, tp.player, tp.a])
        check(rows.length === 1 && rows[0].status === 'yes', { what: 'two devices, one row: the latest tap stands', expected: '1 row, yes', actual: JSON.stringify(rows), role: 'parent', where: 'event_rsvps' })
        await d1.page.screenshot({ path: `.cache/screens/${ctx.seed ?? 1}-tp2-device1.png` }).catch(() => null)
        await d2.page.screenshot({ path: `.cache/screens/${ctx.seed ?? 1}-tp2-device2.png` }).catch(() => null)
      } finally {
        await d1.context.close().catch(() => null)
        await d2.context.close().catch(() => null)
      }
    }, { browser: true })
  })
}

// ============================================== JF · families joining mid-season
const FIRST = ['Amelia', 'Noah', 'Isla', 'Oliver', 'Mia', 'Leo', 'Zara', 'Kai', 'Ruby', 'Ethan', 'Ava', 'Lucas', 'Priya', 'Omar', 'Chloe', 'Mateo']
const LAST = ['Nguyen', 'Smith', 'Patel', 'Kowalski', 'Rossi', 'Haddad', 'Okafor', 'Li', 'Garcia', 'Brown', 'Fitzgerald', 'Yamamoto', 'Singh', 'Murphy', 'Costa', 'Abdi']
const CHILD = ['Theo', 'Ella', 'Max', 'Sienna', 'Jack', 'Harper', 'Finn', 'Layla', 'Archie', 'Poppy', 'Hugo', 'Isabella', 'Rafael', 'Mila', 'Oscar', 'Zoe']

/** Run `fn` over `items`, `width` at a time. */
async function parallel(items, width, fn) {
  const out = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i) }
  }))
  return out
}

/** One family through the HTTP flow the screens use: create account → code → join request → claim. */
async function joinOne(link, i, tag, seed = 0) {
  // One address a family (the rate limits key on it): Next keeps an x-forwarded-for it is given.
  const ip = `10.${60 + Math.floor(i / 2500)}.${Math.floor(i / 10) % 250}.${(i % 10) + 1}`
  const first = FIRST[i % FIRST.length], last = LAST[(i * 7 + 3) % LAST.length]
  const email = `sim-join-${tag}-${i}@squadroom-demo.test`
  // A mobile is one account's for good (0272), so each run's families have their own numbers.
  const mobile = `+6145${seed % 10}${String(100000 + i).slice(-6)}`
  const child = { name: `${CHILD[(i * 5) % CHILD.length]} ${last}`, dob: `201${5 + (i % 4)}-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 27)).padStart(2, '0')}` }
  const post = async (path, body, cookie) => {
    const r = await fetch(`${APP_URL}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) })
    let data = null
    try { data = await r.json() } catch {}
    return { status: r.status, ok: r.ok, data, headers: r.headers }
  }
  const fail = (step, r) => ({ ok: false, step, status: r.status, error: r.data?.message ?? r.data?.error ?? JSON.stringify(r.data ?? {}).slice(0, 80), email })
  let r = await post('/api/account/create', { first, last, email, mobile })
  if (!r.ok || !r.data?.demo_code) return fail('create', r)
  r = await post('/api/account/confirm', { email, code: r.data.demo_code, purpose: 'confirm', password: 'squadroom-sim-2027', next: `/join/${link.token}` })
  if (!r.ok) return fail('confirm', r)
  const cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  if (!cookie) return { ok: false, step: 'confirm', status: r.status, error: 'no session cookie', email }
  r = await post('/api/join/request', { token: link.token, children: [child] }, cookie)
  if (!r.ok || !r.data?.requestId) return fail('request', r)
  const requestId = r.data.requestId
  r = await post('/api/join/claim', { requestId }, cookie)
  if (r.status !== 202) return fail('claim (waiting)', r)
  return { ok: true, email, mobile, first, last, child, cookie, requestId, link, ip, post }
}

async function joiningFamilies(ctx, S, add, rand) {
  const { pool } = ctx
  const clubs = [21 + rand.int(9), 41 + rand.int(9)]
  add(`${plusDays(S, -5)} 19:30`, 'JF1 two hundred families join through their coaches\' links', async () => {
    scenario('JF1', 'Joining mid-season', '200+ new families join mid-season through the sign-up flow (coach link → create account → code → team): approved by the coach, each lands in the squad, the chat and the family\'s Fixtures')
    await withStack(ctx, 'JF1 families joining', async ({ db }) => {
      const teams = []
      for (const c of clubs) for (const t of await sql(pool, `select id from public.teams where academy_id = $1 and season = '2027' order by name limit 4`, [ids.club(c)])) teams.push({ club: ids.club(c), c, team: t.id })
      // Each coach makes a link for their own squad (a link takes sixty requests an hour).
      const links = []
      for (const t of teams) {
        const sq = await squad(pool, t.team)
        const made = await run(pool, sq.coach, `insert into public.join_links (academy_id, team_id, role, created_by) values ($1, $2, 'parent', $3) returning token, code`, [t.club, t.team, sq.coach])
        if (!made.ok) { note(`link for squad ${t.team.slice(0, 8)}: ${made.error}`); continue }
        links.push({ ...t, coach: sq.coach, token: made.data[0].token, code: made.data[0].code, channel: sq.channel, playersBefore: sq.players.length })
      }
      check(links.length === teams.length && links.length >= 6, { what: 'every coach makes a join link for their squad', expected: `${teams.length} links`, actual: `${links.length}`, role: 'coach', where: 'join_links' })
      if (!links.length) return
      const per = Math.ceil(208 / links.length)
      const flows = []
      let n = 0
      for (const l of links) for (let k = 0; k < per; k++) flows.push({ l, i: n++ })
      const t0 = Date.now()
      const tag = `${S.replace(/-/g, '')}-${ctx.seed ?? 0}`
      const families = await parallel(flows, 4, ({ l, i }) => joinOne(l, i, tag, ctx.seed ?? 0))
      const joined = families.filter((f) => f.ok)
      const why = {}
      for (const f of families) if (!f.ok) { const k = `${f.step} ${f.status}: ${f.error}`; why[k] = (why[k] ?? 0) + 1 }
      note(`${joined.length} of ${families.length} families signed up and asked to join in ${Math.round((Date.now() - t0) / 1000)} s${Object.keys(why).length ? `; refused: ${JSON.stringify(why).slice(0, 300)}` : ''}`)
      check(joined.length === families.length && families.length >= 200, { what: 'every family gets through create account → code → join request', expected: `${families.length} of ${families.length}`, actual: `${joined.length} of ${families.length}${Object.keys(why).length ? ` — ${JSON.stringify(why).slice(0, 160)}` : ''}`, role: 'parent (new)', where: '/api/account/create → /api/account/confirm → /api/join/request' })
      if (!joined.length) return
      // The coaches are told, and see the requests waiting on Home.
      const since = new Date(clock.now.getTime() - 60_000).toISOString()
      const told = await sql(pool, `select distinct profile_id from public.notification_queue where created_at >= $1 and kind = 'join_request'`, [since])
      check(told.length >= links.length, { what: 'each coach is told that families asked to join', expected: `≥${links.length} coaches`, actual: `${told.length}`, role: 'coach', where: 'notification_queue (join_request)', severity: 'medium' })
      const coachHome = (await rpc(pool, links[0].coach, 'home_screen', { p_academy: links[0].club })).data
      check(Number(coachHome?.pending_requests ?? 0) >= per, { what: 'the coach\'s Home shows the join requests waiting', expected: `≥${per} waiting`, actual: String(coachHome?.pending_requests), role: 'coach', where: 'home_screen (pending_requests)', severity: 'medium' })
      // Each coach approves their squad's families through the route the Requests screen posts to.
      let approved = 0
      const approveWhy = {}
      for (const l of links) {
        const session = await sessionFor(db, l.coach)
        const ck = sessionCookie(session)
        for (const f of joined.filter((x) => x.link === l)) {
          const r = await fetch(`${APP_URL}/api/join/approve`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: `${ck.name}=${ck.value}` }, body: JSON.stringify({ requestId: f.requestId, decision: 'approve' }) })
          if (r.ok) approved++
          else { let d = null; try { d = await r.json() } catch {} const k = `${r.status}: ${d?.message ?? d?.error ?? ''}`.slice(0, 80); approveWhy[k] = (approveWhy[k] ?? 0) + 1 }
        }
      }
      check(approved === joined.length, { what: 'the coaches approve every request', expected: joined.length, actual: `${approved}${Object.keys(approveWhy).length ? ` — ${JSON.stringify(approveWhy).slice(0, 160)}` : ''}`, role: 'coach', where: '/api/join/approve' })
      // The family's own check: "approved" now.
      const sample = joined.slice(0, 5)
      let done = 0
      for (const f of sample) { const r = await f.post('/api/join/claim', { requestId: f.requestId }, f.cookie); if (r.status === 200 && r.data?.status === 'approved') done++ }
      check(done === sample.length, { what: 'a family that checks again is told they are in', expected: sample.length, actual: done, role: 'parent (new)', where: '/api/join/claim' })
      // What approval wrote, for every family at once.
      const emails = joined.map((f) => f.email)
      const [w] = await sql(pool, `
        with f as (select u.id from auth.users u where lower(u.email) = any($1::text[]))
        select count(*)::int as accounts,
               count(*) filter (where exists (select 1 from public.academy_members am where am.profile_id = f.id and am.status = 'active' and 'parent' = any(am.roles)))::int as members,
               count(*) filter (where exists (select 1 from public.team_members tm where tm.profile_id = f.id and tm.role = 'parent'))::int as on_team,
               count(*) filter (where exists (select 1 from public.player_guardians g where g.profile_id = f.id))::int as guardians,
               count(*) filter (where exists (select 1 from public.channel_members cm join public.channels ch on ch.id = cm.channel_id where cm.profile_id = f.id and ch.type = 'team'))::int as in_chat,
               count(*) filter (where exists (select 1 from public.account_emails ae where ae.profile_id = f.id and ae.verified_at is not null))::int as verified,
               count(*) filter (where exists (select 1 from public.user_settings us where us.profile_id = f.id and us.password_set_at is not null))::int as password_set,
               count(*) filter (where exists (select 1 from public.profiles p where p.id = f.id and p.first_name is not null and p.last_name is not null))::int as named
          from f`, [emails])
      const n2 = joined.length
      check(w.accounts === n2 && w.members === n2 && w.on_team === n2 && w.guardians === n2 && w.in_chat === n2 && w.verified === n2 && w.password_set === n2 && w.named === n2,
        { what: 'every approved family is a member, on the squad, the child\'s guardian, in the squad chat, with a verified email, a password and a three-part name', expected: `${n2} each`, actual: JSON.stringify(w), role: 'coach', where: 'approve (membership rows)' })
      const kids = await val(pool, `select count(distinct pl.id)::int from public.players pl join public.player_guardians g on g.player_id = pl.id join auth.users u on u.id = g.profile_id
        where lower(u.email) = any($1::text[]) and pl.team_id = any($2::uuid[])`, [emails, links.map((l) => l.team)])
      check(kids === n2, { what: 'every child is on the roster of the squad whose link was used', expected: n2, actual: kids, role: 'coach', where: 'players' })
      // A new family's Fixtures lists the squad's next game; the team chat has them.
      const one = joined[0]
      const pid = await val(pool, `select id from auth.users where lower(email) = $1`, [one.email])
      const up = (await rpc(pool, pid, 'my_upcoming_events', { p_academy: one.link.club, p_days: 21 })).data
      const list = Array.isArray(up) ? up : []
      check(list.some((e) => e.team_id === one.link.team), { what: 'a new family\'s Fixtures lists their squad\'s next game', expected: 'the squad\'s game', actual: `${list.length} events`, role: 'parent (new)', where: 'my_upcoming_events' })
      ctx.joined = { links, families: joined, tag }
    })
  })
  add(`${plusDays(S, -4)} 18:30`, 'JF2 a family joins through the real screens', async () => {
    scenario('JF2', 'Joining mid-season', 'A family joins through the real screens at 375px: the coach\'s link, Create account, the code, the join form, waiting, then in after the coach approves')
    const j = ctx.joined
    if (!j?.links?.length) { note('JF1 made no links'); return }
    await withStack(ctx, 'JF2 joining in the browser', async ({ db, browser }) => {
      const link = j.links[j.links.length - 1]
      const i = 9000 + (ctx.seed ?? 0)
      const email = `sim-join-${j.tag}-browser-${i}@squadroom-demo.test`
      const { context, page } = await pageAs(browser, db, null, {})
      const dir = `.cache/screens/${ctx.seed ?? 1}-join`
      const { mkdirSync } = await import('node:fs')
      mkdirSync(dir, { recursive: true })
      const shot = (name) => page.screenshot({ path: `${dir}/${name}.png`, fullPage: true }).catch(() => null)
      try {
        await page.setExtraHTTPHeaders({ 'x-forwarded-for': `10.70.${i % 250}.9` })
        const landing = await openSettled(page, `/join/${link.token}`)
        check(/create account|sign in/i.test(landing), { what: 'the link lands on a page that offers Create account', expected: 'Create account', actual: landing.slice(0, 120), role: 'parent (new)', where: `/join/${link.token}` })
        await shot('1-landing')
        const create = await page.$('a[href^="/signup"]')
        if (create) await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => null), create.click()])
        await new Promise((r) => setTimeout(r, 800))
        for (const [sel, value] of [['[data-first]', 'Harriet'], ['[data-last]', 'Lindqvist'], ['[data-email]', email], ['[data-mobile]', '0451 234 567'], ['[data-password]', 'squadroom-sim-2027']]) {
          const el = await page.$(sel)
          if (el) await el.type(value, { delay: 10 })
          else check(false, { what: `the Create account form has its ${sel} field`, expected: 'a field', actual: 'missing', role: 'parent (new)', where: '/signup' })
        }
        await shot('2-create-account')
        await Promise.all([page.waitForSelector('[data-code-step]', { timeout: 20000 }).catch(() => null), page.click('form button[type="submit"]')])
        const codeOnScreen = await page.$eval('[data-demo-code]', (el) => el.textContent.replace(/\D/g, '')).catch(() => '')
        check(codeOnScreen.length === 6, { what: 'the six-digit code is shown for a demo address', expected: '6 digits', actual: codeOnScreen || 'none', role: 'parent (new)', where: 'code step' })
        await shot('3-code')
        if (codeOnScreen.length === 6) {
          const codeInput = await page.$('[data-code-step] input[autocomplete="one-time-code"]')
          if (codeInput) await codeInput.type(codeOnScreen, { delay: 20 })
          await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null), page.click('[data-code-step] button[type="submit"]')])
        }
        await new Promise((r) => setTimeout(r, 1500))
        const joinText = await page.evaluate(() => document.body.innerText)
        check(/child|children|date of birth|join/i.test(joinText), { what: 'after the code the family is on the join form', expected: 'the join form', actual: joinText.slice(0, 120), role: 'parent (new)', where: `/join/${link.token}` })
        await shot('4-join-form')
        const nameInput = await page.$('[data-join-child-name]')
        if (nameInput) await nameInput.type('Elsa Lindqvist', { delay: 10 })
        const dob = await page.$('[data-join-child-dob]')
        if (dob) await dob.type('14052017')
        await page.click('[data-join-submit]').catch(() => null)
        await new Promise((r) => setTimeout(r, 2500))
        const waiting = await page.evaluate(() => document.body.innerText)
        check(/wait|sent|coach|check again/i.test(waiting), { what: 'the family is told the coach will approve them', expected: 'a waiting message', actual: waiting.slice(0, 120), role: 'parent (new)', where: 'join form' })
        await shot('5-waiting')
        const req = await val(pool, `select jr.id from public.join_requests jr join public.account_emails ae on ae.profile_id = jr.profile_id where lower(ae.email) = $1 order by jr.created_at desc limit 1`, [email])
        check(Boolean(req), { what: 'the request is in the coach\'s queue', expected: 'a join_requests row', actual: req ? 'row' : 'none', role: 'coach', where: 'join_requests' })
        if (req) {
          const session = await sessionFor(db, link.coach)
          const ck = sessionCookie(session)
          const r = await fetch(`${APP_URL}/api/join/approve`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: `${ck.name}=${ck.value}` }, body: JSON.stringify({ requestId: req, decision: 'approve' }) })
          check(r.ok, { what: 'the coach approves', expected: 200, actual: r.status, role: 'coach', where: '/api/join/approve' })
          const home = await openSettled(page, '/')
          const teamName = await val(pool, `select name from public.teams where id = $1`, [link.team])
          check(new RegExp(teamName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(home) || /Elsa/.test(home), { what: 'the new family\'s Home shows their squad', expected: teamName, actual: home.slice(0, 160), role: 'parent (new)', where: '/' })
          await shot('6-home')
        }
      } finally {
        await context.close().catch(() => null)
      }
    }, { browser: true })
  })
}

export { plusDays }
