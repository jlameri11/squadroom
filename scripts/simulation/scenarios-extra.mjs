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
import { asAnon, check, clock, ids, mustRefuse, mustWork, note, rpc, run, scenario, sql, val, who } from './lib.mjs'
import { COMP, LEAGUE, eventFor, gamesOn, guardianOf, playerName, queued, rsvp, say, squad } from './world.mjs'
import { plusDays } from './routine.mjs'
import { apiAs, appUp, has, openSettled, pageAs, text, withStack } from './live.mjs'
import { APP_URL, SUPABASE_URL, sessionCookie, sessionFor } from './stack.mjs'
import { existsSync, readFileSync } from 'node:fs'

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
    case 6:
      await realFiles(ctx, S, add, rand)
      break
    case 8:
      await featureSwitches(ctx, S, add, rand)
      break
    case 9:
      await adminMistakes(ctx, S, add, rand)
      break
    case 11:
      await familyData(ctx, S, add, rand)
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

// ============================================ FS · real files through real storage
const FIX = (name) => `${process.cwd()}/.cache/fixtures/${name}`
/** Sign a storage path as a person, through the stack, the way the app does. Returns { status, url }. */
async function signAs(db, personId, bucket, path) {
  const session = await sessionFor(db, personId)
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${bucket}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: session.access_token, authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ expiresIn: 60 }) })
  let data = null
  try { data = await r.json() } catch {}
  return { status: r.status, ok: r.ok, url: data?.signedURL ? `${SUPABASE_URL}/storage/v1${data.signedURL}` : null, error: data?.message ?? data?.error ?? null }
}
async function fetchSigned(url) {
  const r = await fetch(url)
  return { status: r.status, type: r.headers.get('content-type'), bytes: (await r.arrayBuffer()).byteLength }
}
/** A new family through the sign-up routes (an account with a session cookie), for the public register flow. */
async function newFamily(tag, i, seed = 0) {
  const ip = `10.80.${i % 250}.${1 + (seed % 200)}`
  const email = `sim-file-${tag}-${i}@squadroom-demo.test`
  const mobile = `+6146${seed % 10}${String(100000 + i).slice(-6)}`
  const post = async (path, body, cookie) => {
    const r = await fetch(`${APP_URL}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) })
    let data = null
    try { data = await r.json() } catch {}
    return { status: r.status, ok: r.ok, data, headers: r.headers }
  }
  let r = await post('/api/account/create', { first: 'Frida', last: `Filer ${tag}`, email, mobile })
  if (!r.ok || !r.data?.demo_code) return { ok: false, step: 'create', error: JSON.stringify(r.data).slice(0, 120) }
  r = await post('/api/account/confirm', { email, code: r.data.demo_code, purpose: 'confirm', password: 'squadroom-sim-2027', next: '/' })
  if (!r.ok) return { ok: false, step: 'confirm', error: JSON.stringify(r.data).slice(0, 120) }
  const cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  return { ok: true, email, cookie, ip, post }
}

async function realFiles(ctx, S, add, rand) {
  const { pool } = ctx
  const c = 11 + rand.int(9)
  const club = ids.club(c)
  add(`${plusDays(S, -5)} 18:30`, 'FS0 the club has a photo consent form, and one family said no', async () => {
    scenario('FS1', 'Files & storage', 'Chat photos through the real storage: a coach posts a photo in the squad chat, is warned who must not be in it, the squad sees it, nobody else can open it')
    if (!existsSync(FIX('photo.jpg'))) { note('no fixture files in .cache/fixtures — run the generator first'); return }
    const team = await val(pool, `select id from public.teams where academy_id = $1 and season = '2027' order by name limit 1`, [club])
    const sq = await squad(pool, team)
    const doc = (await sql(pool, `insert into public.consent_documents (academy_id, kind, title, version, body, required, published_at, created_by)
      values ($1, 'photo_media', 'Photos and media', 1, 'We may photograph and film training and games for the club''s own channels.', false, now(), $2) returning id`, [club, who.president(c)]))[0].id
    const refused = sq.players[2]
    const guardian = await guardianOf(pool, refused)
    await sql(pool, `insert into public.consent_acceptances (academy_id, document_id, profile_id, player_id, accepted, accepted_at) values ($1, $2, $3, $4, false, now())`, [club, doc, guardian, refused])
    ctx.files = { club, c, team, coach: sq.coach, channel: sq.channel, parents: sq.parents, refused, refusedName: await playerName(pool, refused), stranger: ids.parent(c === 19 ? 11 : c + 1, 1), president: who.president(c) }
    note(`club ${c}: ${ctx.files.refusedName} must not be photographed`)
  })
  const sendFile = async (page, file) => {
    const input = await page.$('input[type="file"]')
    if (!input) return { ok: false, why: 'no file input in the composer' }
    await input.uploadFile(file)
    await new Promise((r) => setTimeout(r, 1800))
    const txt = await page.evaluate(() => document.body.innerText)
    return { ok: true, txt }
  }
  const latestWithFile = async (channel, sender, since) => (await sql(pool, `select id, attachments from public.messages where channel_id = $1 and sender_id = $2 and created_at >= $3 and jsonb_array_length(attachments) > 0 order by created_at desc limit 1`, [channel, sender, since]))[0] ?? null
  const chatStep = (name, at, file, run) => add(at, name, async () => {
    const f = ctx.files
    if (!f) return
    await withStack(ctx, name, async ({ db, browser }) => {
      const co = await pageAs(browser, db, f.coach, { org: f.club })
      try {
        await openSettled(co.page, `/chat/${f.channel}`)
        const since = new Date(clock.now.getTime() - 1000).toISOString()
        const picked = await sendFile(co.page, FIX(file))
        await run({ db, browser, page: co.page, picked, since })
      } finally { await co.context.close().catch(() => null) }
    }, { browser: true })
  })
  chatStep('FS1 a photo in the squad chat', `${plusDays(S, -5)} 19:00`, 'photo.jpg', async ({ db, browser, page, picked, since }) => {
    const f = ctx.files
    check(picked.ok, { what: 'the composer takes a photo', expected: 'picked', actual: picked.why ?? 'picked', role: 'coach', where: '/chat composer' })
    if (!picked.ok) return
    check(has(picked.txt, 'must not be photographed') && has(picked.txt, f.refusedName.split(' ')[0]), { what: 'the coach is warned who must not be in the picture, before it goes', expected: `${f.refusedName} must not be photographed`, actual: text(picked.txt).slice(-200), role: 'coach', where: 'photo consent warning (0128)' })
    await page.click('[aria-label="Send"]')
    let msg = null
    for (let i = 0; i < 20 && !msg; i++) { await new Promise((r) => setTimeout(r, 500)); msg = await latestWithFile(f.channel, f.coach, since) }
    check(Boolean(msg), { what: 'the photo is sent', expected: 'a message with an attachment', actual: msg ? 'sent' : 'nothing arrived in 10 s', role: 'coach', where: 'messages' })
    if (!msg) return
    const a = msg.attachments[0]
    check(a.path?.startsWith(`${f.club}/${f.channel}/${f.coach}/`) && a.mime === 'image/jpeg', { what: 'the file sits in the squad chat\'s own folder as a JPEG', expected: `${f.club.slice(0, 8)}…/${f.channel.slice(0, 8)}…/coach/…jpg`, actual: `${a.path} (${a.mime})`, role: 'coach', where: 'attachments (path, mime)' })
    const obj = await val(pool, `select count(*)::int from storage.objects where bucket_id = 'attachments' and name = $1`, [a.path])
    const onDisk = existsSync(`${process.cwd()}/.cache/storage/attachments/${a.path}`)
    check(obj === 1 && onDisk, { what: 'the bytes are in the bucket, with their row', expected: 'row + file', actual: `${obj} rows, file ${onDisk ? 'present' : 'missing'}`, role: 'coach', where: 'storage.objects' })
    const inSquad = await signAs(db, f.parents[0], 'attachments', a.path)
    check(inSquad.ok, { what: 'a parent in the squad can open it', expected: 'a signed link', actual: `${inSquad.status} ${inSquad.error ?? ''}`, role: 'parent', where: 'storage sign (attachments)' })
    if (inSquad.url) { const got = await fetchSigned(inSquad.url); check(got.status === 200 && /image\/jpeg/.test(got.type ?? ''), { what: 'and the picture comes down', expected: '200 image/jpeg', actual: `${got.status} ${got.type}`, role: 'parent', where: 'storage signed GET' }) }
    const outside = await signAs(db, f.stranger, 'attachments', a.path)
    check(!outside.ok || !outside.url, { what: 'a parent at another club cannot', expected: 'refused', actual: `${outside.status}`, role: 'parent (another club)', where: 'storage sign (attachments)' })
    const staff = await signAs(db, f.president, 'attachments', a.path)
    check(staff.ok, { what: 'the President, who may read the squad chat (0278), can open its photos too', expected: 'a signed link', actual: `${staff.status} ${staff.error ?? ''}`, role: 'club president', where: 'storage sign (attachments policy)', severity: 'medium' })
    // The parent's phone shows the picture.
    const pa = await pageAs(browser, db, f.parents[0], { org: f.club })
    try {
      await openSettled(pa.page, `/chat/${f.channel}`)
      await new Promise((r) => setTimeout(r, 1500))
      const imgs = await pa.page.$$eval('img', (els) => els.filter((i) => i.src.includes('/storage/v1/')).map((i) => ({ w: i.naturalWidth, complete: i.complete })))
      check(imgs.length >= 1 && imgs.some((i) => i.w > 0), { what: 'the parent sees the photo in the chat', expected: 'an image that loaded', actual: `${imgs.length} storage images, widths ${imgs.map((i) => i.w).join(',')}`, role: 'parent', where: '/chat (attachment)' })
      await pa.page.screenshot({ path: `.cache/screens/${ctx.seed ?? 1}-files-chat-photo.png`, fullPage: true }).catch(() => null)
    } finally { await pa.context.close() }
    ctx.files.chatPhoto = a.path
  })
  chatStep('FS2 an iPhone HEIC photo', `${plusDays(S, -5)} 19:10`, 'photo.heic', async ({ db, browser, page, picked, since }) => {
    scenario('FS2', 'Files & storage', 'An iPhone HEIC photo in the chat: either it goes up as a picture everyone can see, or the sender is told at once what to do — never a broken image for the squad')
    const f = ctx.files
    if (!picked.ok) return
    if (has(picked.txt, 'iPhone') || has(picked.txt, 'HEIC')) {
      check(/Most Compatible|JPEG|screenshot/i.test(picked.txt), { what: 'the sender is told, at once, how to send an iPhone photo others can see', expected: 'a sentence naming Most Compatible or a JPEG', actual: text(picked.txt).slice(-200), role: 'coach', where: '/chat composer (HEIC)' })
      const sent = await latestWithFile(f.channel, f.coach, since)
      check(!sent, { what: 'and nothing unviewable was sent', expected: 'no message', actual: sent ? `sent as ${sent.attachments[0]?.mime}` : 'nothing sent', role: 'coach', where: 'messages' })
      return
    }
    await page.click('[aria-label="Send"]')
    let msg = null
    for (let i = 0; i < 20 && !msg; i++) { await new Promise((r) => setTimeout(r, 500)); msg = await latestWithFile(f.channel, f.coach, since) }
    check(Boolean(msg), { what: 'the HEIC photo is sent', expected: 'a message with an attachment', actual: msg ? `sent as ${msg.attachments[0]?.mime}` : `nothing arrived: ${text(picked.txt).slice(-160)}`, role: 'coach', where: 'messages' })
    if (!msg) return
    const a = msg.attachments[0]
    const pa = await pageAs(browser, db, f.parents[1] ?? f.parents[0], { org: f.club })
    try {
      await openSettled(pa.page, `/chat/${f.channel}`)
      await new Promise((r) => setTimeout(r, 2000))
      const imgs = await pa.page.$$eval('img', (els) => els.filter((i) => i.src.includes('/storage/v1/')).map((i) => ({ src: i.src, w: i.naturalWidth })))
      const mine = imgs.find((i) => i.src.includes(encodeURIComponent(a.path).replace(/%2F/g, '/')) || i.src.includes(a.path))
      check(Boolean(mine) && mine.w > 0, { what: 'a parent on another phone can see an iPhone photo', expected: 'the picture loads (converted to JPEG on the way up)', actual: mine ? `the image is there but ${mine.w === 0 ? 'cannot be decoded' : 'loaded'} (${a.mime})` : `no image for it (${a.mime})`, role: 'parent', where: '/chat (HEIC attachment)', severity: 'medium' })
    } finally { await pa.context.close() }
  })
  chatStep('FS3 a photo that is too big', `${plusDays(S, -5)} 19:15`, 'big.jpg', async ({ page, picked, since }) => {
    scenario('FS3', 'Files & storage', 'A file over the limit: refused on the phone with a sentence, nothing uploaded')
    const f = ctx.files
    const before = await val(pool, `select count(*)::int from storage.objects where bucket_id = 'attachments' and name like $1`, [`${f.club}/${f.channel}/%`])
    check(picked.ok && has(picked.txt, 'too big'), { what: 'a 26 MB photo is refused with a sentence', expected: '"… is too big …"', actual: text(picked.txt).slice(-160), role: 'coach', where: '/chat composer' })
    await new Promise((r) => setTimeout(r, 1500))
    const after = await val(pool, `select count(*)::int from storage.objects where bucket_id = 'attachments' and name like $1`, [`${f.club}/${f.channel}/%`])
    check(after === before, { what: 'nothing was uploaded', expected: before, actual: after, role: 'coach', where: 'storage.objects' })
    void since
  })
  chatStep('FS4 a PDF in the chat', `${plusDays(S, -5)} 19:20`, 'draw.pdf', async ({ db, page, picked, since }) => {
    scenario('FS4', 'Files & storage', 'A PDF in the chat: the draw as a document, opened by a parent')
    const f = ctx.files
    if (!picked.ok) return
    await page.click('[aria-label="Send"]')
    let msg = null
    for (let i = 0; i < 20 && !msg; i++) { await new Promise((r) => setTimeout(r, 500)); msg = await latestWithFile(f.channel, f.coach, since) }
    check(Boolean(msg) && msg?.attachments[0]?.mime === 'application/pdf', { what: 'the PDF is sent as a PDF', expected: 'application/pdf', actual: msg ? msg.attachments[0]?.mime : 'nothing arrived', role: 'coach', where: 'messages (attachments)' })
    if (!msg) return
    const signed = await signAs(db, f.parents[0], 'attachments', msg.attachments[0].path)
    const got = signed.url ? await fetchSigned(signed.url) : null
    check(got?.status === 200 && /pdf/.test(got.type ?? ''), { what: 'a parent opens the PDF', expected: '200 application/pdf', actual: got ? `${got.status} ${got.type}` : `sign ${signed.status}`, role: 'parent', where: 'storage signed GET (pdf)' })
  })
  add(`${S} 16:30`, 'FS5 match photos after the game', async () => {
    scenario('FS5', 'Files & storage', 'Match photos: the coach adds them after the game and is warned who must not be in them; only the squad sees them; a family takes one down at once; the coach puts it back')
    const f = ctx.files
    if (!f) return
    const ev = await val(pool, `select e.id from public.events e join public.fixtures fx on fx.id = e.fixture_id where e.team_id = $1 and fx.status in ('final', 'forfeit') and (e.starts_at at time zone 'Australia/Sydney')::date <= $2::date order by e.starts_at desc limit 1`, [f.team, S])
    if (!ev) { note('the squad has no played game today'); return }
    await withStack(ctx, 'FS5 match photos', async ({ db, browser }) => {
      const co = await pageAs(browser, db, f.coach, { org: f.club })
      try {
        await openSettled(co.page, `/calendar/${ev}?tab=sheet`)
        const input = await co.page.$('[data-photos-file]')
        check(Boolean(input), { what: 'the coach can add photos to a played game', expected: 'a photo picker on the match sheet', actual: input ? 'picker' : 'none', role: 'coach', where: '/calendar (photos)' })
        if (!input) return
        await input.uploadFile(FIX('photo.jpg'))
        await new Promise((r) => setTimeout(r, 1500))
        const txt = await co.page.evaluate(() => document.body.innerText)
        check(has(txt, 'must not be photographed'), { what: 'the warning names who must not be in them, before the Add button', expected: `${f.refusedName} must not be photographed`, actual: text(txt).slice(-200), role: 'coach', where: 'match photos (consent)' })
        await co.page.click('[data-photos-add]')
        let photo = null
        for (let i = 0; i < 24 && !photo; i++) { await new Promise((r) => setTimeout(r, 500)); photo = (await sql(pool, `select id, storage_path, thumb_path from public.event_photos where event_id = $1 order by created_at desc limit 1`, [ev]))[0] ?? null }
        check(Boolean(photo), { what: 'the photo is added to the game', expected: 'an event_photos row', actual: photo ? 'added' : `nothing in 12 s: ${text(await co.page.evaluate(() => document.body.innerText)).slice(-160)}`, role: 'coach', where: 'add_match_photos' })
        if (!photo) return
        const inSquad = await signAs(db, f.parents[0], 'match-photos', photo.thumb_path ?? photo.storage_path)
        check(inSquad.ok, { what: 'a family in the squad can see it', expected: 'a signed link', actual: `${inSquad.status}`, role: 'parent', where: 'storage sign (match-photos)' })
        const outside = await signAs(db, f.stranger, 'match-photos', photo.storage_path)
        check(!outside.ok, { what: 'a family at another club cannot', expected: 'refused', actual: `${outside.status}`, role: 'parent (another club)', where: 'storage sign (match-photos)' })
        const down = await rpc(pool, f.parents[1] ?? f.parents[0], 'take_down_match_photo', { p_photo: photo.id })
        mustWork(down, { what: 'any family in the squad takes it down at once, no reason asked', role: 'parent', where: 'take_down_match_photo' })
        const hidden = await signAs(db, f.parents[0], 'match-photos', photo.storage_path)
        check(!hidden.ok, { what: 'taken down, the squad cannot open it any more', expected: 'refused', actual: `${hidden.status}`, role: 'parent', where: 'storage sign after takedown' })
        const coachStill = await signAs(db, f.coach, 'match-photos', photo.storage_path)
        check(coachStill.ok, { what: 'the coach still can', expected: 'a signed link', actual: `${coachStill.status}`, role: 'coach', where: 'storage sign after takedown' })
        const back = await rpc(pool, f.coach, 'restore_match_photo', { p_photo: photo.id })
        mustWork(back, { what: 'only the coach puts it back', role: 'coach', where: 'restore_match_photo' })
        const notParent = await rpc(pool, f.parents[0], 'restore_match_photo', { p_photo: photo.id })
        mustRefuse(notParent, { what: 'a parent cannot put it back', role: 'parent', where: 'restore_match_photo' })
        await co.page.screenshot({ path: `.cache/screens/${ctx.seed ?? 1}-files-match-photos.png`, fullPage: true }).catch(() => null)
      } finally { await co.context.close().catch(() => null) }
    }, { browser: true })
  })
  add(`${plusDays(S, -4)} 19:00`, 'FS6 a registration photo, private until approved', async () => {
    scenario('FS6', 'Files & storage', 'A registration photo: sent with the request, private to the club until approved, then on the player card for the family and nobody else')
    // A program open today, at this club, that a child born in 2017 may join — made by the President if the club has none.
    const fits = `p.status = 'open' and (p.opens_at is null or p.opens_at <= now()) and (p.closes_at is null or p.closes_at > now())
      and (p.born_from_year is null or p.born_from_year <= 2017) and (p.born_to_year is null or p.born_to_year >= 2017)`
    let program = (await sql(pool, `select p.id, p.academy_id, a.slug from public.programs p join public.academies a on a.id = p.academy_id where p.academy_id = $1 and ${fits} order by p.created_at limit 1`, [club]).catch(() => []))[0]
    if (!program) {
      const made = await run(pool, who.president(c), `insert into public.programs (academy_id, name, kind, status, season, born_from_year, born_to_year) values ($1, $2, 'camp', 'open', '2027', 2015, 2018) returning id`, [club, `Autumn holiday camp ${S}`])
      if (!made.ok) { note(`no open program and the President could not make one: ${made.error}`); return }
      program = { id: made.data[0].id, academy_id: club, slug: await val(pool, `select slug from public.academies where id = $1`, [club]) }
    }
    const clubOf = program.academy_id
    const cnum = await val(pool, `select n from (select id, row_number() over (order by name) n from public.academies where type <> 'league') x where id = $1`, [clubOf]).catch(() => null)
    await withStack(ctx, 'FS6 registration photo', async ({ db }) => {
      const fam = await newFamily(`${S.replace(/-/g, '')}${ctx.seed ?? 0}`, 1, ctx.seed ?? 0)
      check(fam.ok, { what: 'a new family makes an account', expected: 'a session', actual: fam.ok ? 'session' : `${fam.step}: ${fam.error}`, role: 'parent (new)', where: '/api/account' })
      if (!fam.ok) return
      const child = { name: `Pia Filer ${S}`, dob: '2017-02-11' }
      const req = await fam.post('/api/register/request', { slug: program.slug, programId: program.id, childName: child.name, childDob: child.dob, childGender: 'female', answers: {}, consents: [], forSelf: false }, fam.cookie)
      check(req.ok && req.data?.requestId, { what: 'the family registers a child', expected: 'a request id and a secret', actual: `${req.status} ${JSON.stringify(req.data).slice(0, 100)}`, role: 'parent (new)', where: '/api/register/request' })
      if (!req.ok) return
      const image = `data:image/jpeg;base64,${readFileSync(FIX('photo.jpg')).toString('base64')}`
      const up = await fam.post('/api/register/photo', { requestId: req.data.requestId, secret: req.data.secret, image }, fam.cookie)
      check(up.ok, { what: 'the photo goes with the request', expected: 200, actual: `${up.status} ${JSON.stringify(up.data).slice(0, 80)}`, role: 'parent (new)', where: '/api/register/photo' })
      const pending = await val(pool, `select photo_path from public.registration_requests where id = $1`, [req.data.requestId])
      check(Boolean(pending) && pending.startsWith(`${clubOf}/pending/`), { what: 'it waits in the club\'s pending folder', expected: `${clubOf.slice(0, 8)}…/pending/…`, actual: String(pending), role: 'registrar', where: 'player-photos (pending)' })
      if (!pending) return
      const registrar = await val(pool, `select profile_id from public.club_roles where academy_id = $1 and role = 'registrar' limit 1`, [clubOf]) ?? await val(pool, `select profile_id from public.academy_members where academy_id = $1 and role = 'owner' limit 1`, [clubOf])
      const reg = await signAs(db, registrar, 'player-photos', pending)
      check(reg.ok, { what: 'the club\'s Registrar can see it while it waits', expected: 'a signed link', actual: `${reg.status} ${reg.error ?? ''}`, role: 'registrar', where: 'storage sign (pending photo)' })
      const someParent = await val(pool, `select profile_id from public.academy_members where academy_id = $1 and role = 'parent' and status = 'active' limit 1`, [clubOf])
      const par = await signAs(db, someParent, 'player-photos', pending)
      check(!par.ok, { what: 'another family at the club cannot', expected: 'refused', actual: `${par.status}`, role: 'parent', where: 'storage sign (pending photo)' })
      const owner = await val(pool, `select profile_id from public.academy_members where academy_id = $1 and role = 'owner' and status = 'active' limit 1`, [clubOf])
      const ownerSession = await sessionFor(db, owner)
      const ck = sessionCookie(ownerSession)
      const approve = await fetch(`${APP_URL}/api/register/approve`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: `${ck.name}=${ck.value}` }, body: JSON.stringify({ requestId: req.data.requestId, decision: 'approve' }) })
      check(approve.ok, { what: 'the club accepts the registration', expected: 200, actual: `${approve.status} ${(await approve.text()).slice(0, 100)}`, role: 'club president', where: '/api/register/approve' })
      const player = (await sql(pool, `select id, photo_url from public.players where academy_id = $1 and full_name = $2 order by created_at desc limit 1`, [clubOf, child.name]))[0]
      check(Boolean(player?.photo_url) && player.photo_url.startsWith(`${clubOf}/${player.id}/`), { what: 'approved, the photo moves to the player\'s own folder', expected: `${clubOf.slice(0, 8)}…/<player>/registration.jpg`, actual: String(player?.photo_url), role: 'registrar', where: 'player-photos (approved)' })
      if (!player?.photo_url) return
      const me = await val(pool, `select id from auth.users where lower(email) = $1`, [fam.email])
      const guardian = await signAs(db, me, 'player-photos', player.photo_url)
      check(guardian.ok, { what: 'the family sees it on the player card', expected: 'a signed link', actual: `${guardian.status} ${guardian.error ?? ''}`, role: 'parent (new)', where: 'storage sign (player photo)' })
      const stranger = await signAs(db, ids.parent(c === 19 ? 11 : c + 1, 2), 'player-photos', player.photo_url)
      check(!stranger.ok, { what: 'a family at another club cannot', expected: 'refused', actual: `${stranger.status}`, role: 'parent (another club)', where: 'storage sign (player photo)' })
      void cnum
    })
  })
}

// ============================================ SW · feature switches off
const SWITCHES = ['scheduled_messages', 'polls', 'match_photos', 'match_video', 'helpers', 'duty_roster', 'role_requests', 'scan', 'digest', 'training_slots', 'kit', 'sponsors', 'game_day', 'club_health', 'development', 'accreditations', 'bans', 'registrations_csv', 'trial_ratings']

async function featureSwitches(ctx, S, add, rand) {
  const { pool } = ctx
  const c = 31 + rand.int(9)
  const club = ids.club(c)
  const other = ids.club(c === 39 ? 31 : c + 1)
  add(`${plusDays(S, -5)} 19:00`, 'SW1 the president switches every non-core feature off', async () => {
    scenario('SW1', 'Feature switches', 'Feature switches off: the President turns every non-core feature off for the club; the switches hold, and a switched-off feature refuses through its functions, not only its screens')
    const pres = who.president(c)
    let off = 0
    for (const key of SWITCHES) {
      const r = await rpc(pool, pres, 'set_feature', { p_academy: club, p_feature: key, p_enabled: false })
      if (r.ok) off++; else note(`${key}: ${r.error}`)
    }
    check(off === SWITCHES.length, { what: 'the President switches the features off', expected: SWITCHES.length, actual: off, role: 'club president', where: 'set_feature' })
    const list = (await rpc(pool, pres, 'features_off', { p_academy: club })).data ?? []
    check(SWITCHES.every((k) => list.includes(k)), { what: 'features_off lists them all', expected: `${SWITCHES.length} keys`, actual: `${list.length}`, role: 'club president', where: 'features_off' })
    const parent = ids.parent(c, 2)
    const no = await rpc(pool, parent, 'set_feature', { p_academy: club, p_feature: 'polls', p_enabled: true })
    mustRefuse(no, { what: 'a parent cannot switch a feature back on', role: 'parent', where: 'set_feature' })
    // Switched off means off through the functions too, not only hidden on a screen.
    const team = await val(pool, `select id from public.teams where academy_id = $1 and season = '2027' order by name limit 1`, [club])
    const sq = await squad(pool, team)
    const later = await rpc(pool, sq.coach, 'schedule_message', { p_channel: sq.channel, p_body: 'A line for later, with the switch off', p_at: new Date(clock.now.getTime() + 3600_000).toISOString(), p_announcement: false })
    mustRefuse(later, { what: 'with Scheduled messages off, a coach cannot schedule one through the function', role: 'coach', where: 'schedule_message (feature off)', severity: 'medium' })
    if (later.ok) await sql(pool, `delete from public.scheduled_messages where id = $1`, [later.data]).catch(() => null)
    const ask = await rpc(pool, sq.parents[0], 'request_role', { p_academy: club, p_kind: 'volunteer', p_teams: [team], p_area: null, p_note: 'with the switch off' })
    mustRefuse(ask, { what: 'with Role requests off, a parent cannot file one through the function', role: 'parent', where: 'request_role (feature off)', severity: 'medium' })
    if (ask.ok) await sql(pool, `delete from public.role_requests where id = $1`, [ask.data]).catch(() => null)
    ctx.switchesOff = { club, c, team, coach: sq.coach, parent: sq.parents[0], channel: sq.channel, other }
  })
  add(`${plusDays(S, -5)} 19:20`, 'SW2 the switched-off features are gone from every screen for that club', async () => {
    scenario('SW2', 'Feature switches', 'Feature switches off: the composer, the game page, Settings, the Admin hub and Fixtures show nothing of a switched-off feature for that club — and another club still has them')
    const sw = ctx.switchesOff
    if (!sw) { note('SW1 did not run'); return }
    await withStack(ctx, 'SW2 switched-off screens', async ({ db, browser }) => {
      const ev = await val(pool, `select e.id from public.events e where e.team_id = $1 and e.fixture_id is not null and e.cancelled_at is null and e.starts_at > now() order by e.starts_at limit 1`, [sw.team])
      const absent = (txt, words, where, role) => {
        for (const w of words) check(!has(txt, w), { what: `${role}: "${w}" is gone with its switch off`, expected: 'absent', actual: 'still shown', role, where, severity: 'medium' })
      }
      const dir = `.cache/screens/${ctx.seed ?? 1}-switches`
      const { mkdirSync } = await import('node:fs')
      mkdirSync(dir, { recursive: true })
      // The coach: the composer and the game page.
      const co = await pageAs(browser, db, sw.coach, { org: sw.club })
      try {
        const chat = await openSettled(co.page, `/chat/${sw.channel}`)
        absent(chat, ['Send later'], `/chat (club ${sw.c})`, 'coach')
        const poll = await co.page.$('[aria-label="Create a poll"]')
        check(!poll, { what: 'coach: the poll button is gone with Polls off', expected: 'absent', actual: poll ? 'a Create a poll button' : 'absent', role: 'coach', where: '/chat composer', severity: 'medium' })
        await co.page.screenshot({ path: `${dir}/coach-chat.png`, fullPage: true }).catch(() => null)
        if (ev) {
          const game = await openSettled(co.page, `/calendar/${ev}?tab=sheet`)
          absent(game, ['Game video', 'Duties', 'Helpers'], `/calendar/${ev}`, 'coach')
          const photos = await co.page.$('[data-photos-file]')
          check(!photos, { what: 'coach: the photo picker is gone with Game photos off', expected: 'absent', actual: photos ? 'shown' : 'absent', role: 'coach', where: '/calendar (match sheet)', severity: 'medium' })
          await co.page.screenshot({ path: `${dir}/coach-game.png`, fullPage: true }).catch(() => null)
        }
        const fixtures = await openSettled(co.page, '/calendar')
        absent(fixtures, ['From a screenshot'], '/calendar', 'coach')
      } finally { await co.context.close() }
      // A parent: Settings.
      const pa = await pageAs(browser, db, sw.parent, { org: sw.club })
      try {
        const settings = await openSettled(pa.page, '/settings')
        absent(settings, ['Request a role', 'Message pushes'], '/settings', 'parent')
        await pa.page.screenshot({ path: `${dir}/parent-settings.png`, fullPage: true }).catch(() => null)
      } finally { await pa.context.close() }
      // The President: the Admin hub, here and at the club next door.
      const pr = await pageAs(browser, db, who.president(sw.c), { org: sw.club })
      try {
        const hub = await openSettled(pr.page, '/admin')
        absent(hub, ['Club health', 'Game day', 'Rosters', 'Kit list', 'Sponsors'], '/admin', 'club president')
        await pr.page.screenshot({ path: `${dir}/president-admin.png`, fullPage: true }).catch(() => null)
      } finally { await pr.context.close() }
      const nx = await pageAs(browser, db, who.president(sw.c === 39 ? 31 : sw.c + 1), { org: sw.other })
      try {
        const hub2 = await openSettled(nx.page, '/admin')
        check(has(hub2, 'Kit list') && has(hub2, 'Sponsors'), { what: 'the club next door still has every feature', expected: 'Kit list, Sponsors', actual: text(hub2).slice(0, 120), role: 'club president (another club)', where: '/admin' })
      } finally { await nx.context.close() }
    }, { browser: true })
  })
  add(`${plusDays(S, 1)} 20:00`, 'SW3 the features come back on', async () => {
    const sw = ctx.switchesOff
    if (!sw) return
    let on = 0
    for (const key of SWITCHES) { const r = await rpc(pool, who.president(sw.c), 'set_feature', { p_academy: sw.club, p_feature: key, p_enabled: true }); if (r.ok) on++ }
    const list = (await rpc(pool, who.president(sw.c), 'features_off', { p_academy: sw.club })).data ?? []
    check(on === SWITCHES.length && list.length === 0, { what: 'switched back on, nothing is off', expected: 'features_off empty', actual: `${list.length} still off`, role: 'club president', where: 'set_feature' })
  })
}

// ================================================== AM · admin mistakes
async function adminMistakes(ctx, S, add, rand) {
  const { pool } = ctx
  const c = 51 + rand.int(9)
  const club = ids.club(c)
  const staff = (job) => (typeof who[job] === 'function' ? who[job](c) : who.president(c))
  add(`${plusDays(S, -5)} 19:45`, 'AM1 a wrong import, undone', async () => {
    scenario('AM1', 'Admin mistakes', 'A wrong import undone: a roster import of the wrong file is undone in one tap and nothing else moves; a wrong draw import can be undone the same way')
    const registrar = staff('registrar')
    const team = await val(pool, `select id from public.teams where academy_id = $1 and season = '2027' order by name limit 1`, [club])
    const before = await val(pool, `select count(*)::int from public.players where team_id = $1`, [team])
    const batch = await rpc(pool, registrar, 'start_import_batch', { p_academy: club, p_kind: 'players', p_file: 'wrong-season.xlsx' })
    mustWork(batch, { what: 'the Registrar starts an import', role: 'registrar', where: 'start_import_batch' })
    if (!batch.ok) return
    const rows = Array.from({ length: 10 }, (_, i) => ({ full_name: `Wrong Import ${i + 1} ${S}`, dob: `2015-0${1 + (i % 9)}-1${i % 9}` }))
    const imp = await rpc(pool, registrar, 'import_players', { p_academy: club, p_team: team, p_rows: JSON.stringify(rows), p_season: '2027', p_batch: batch.data })
    mustWork(imp, { what: 'the wrong file goes in', role: 'registrar', where: 'import_players' })
    check(imp.data?.created === 10, { what: 'ten strangers land on the squad', expected: 10, actual: imp.data?.created, role: 'registrar', where: 'import_players' })
    const undo = await rpc(pool, registrar, 'undo_import_batch', { p_batch: batch.data })
    mustWork(undo, { what: 'the Registrar undoes the import', role: 'registrar', where: 'undo_import_batch' })
    check(undo.data?.removed === 10, { what: 'all ten are removed', expected: 10, actual: JSON.stringify(undo.data).slice(0, 80), role: 'registrar', where: 'undo_import_batch' })
    const after = await val(pool, `select count(*)::int from public.players where team_id = $1`, [team])
    check(after === before, { what: 'the roster is as it was', expected: before, actual: after, role: 'registrar', where: 'players' })
    const again = await rpc(pool, registrar, 'undo_import_batch', { p_batch: batch.data })
    mustRefuse(again, { what: 'an import cannot be undone twice', role: 'registrar', where: 'undo_import_batch' })
    // The same mistake with a draw file.
    const coach = (await squad(pool, team)).coach
    const refs = [1, 2, 3].map((i) => `WRONG-${S}-${i}`)
    const evs = refs.map((ref, i) => ({ external_ref: ref, title: `Wrong import game ${i + 1}`, starts_at: new Date(clock.now.getTime() + (i + 20) * 86400_000).toISOString(), venue: 'Nowhere Park', opponent: 'Nobody FC', round: `W${i + 1}`, was_home: true, type: 'match' }))
    const fx = await rpc(pool, coach, 'create_imported_events', { p_academy: club, p_team: team, p_events: JSON.stringify(evs), p_cancel_missing: false })
    mustWork(fx, { what: 'a coach imports a draw file — the wrong one', role: 'coach', where: 'create_imported_events' })
    const made = await val(pool, `select count(*)::int from public.events where academy_id = $1 and external_ref = any($2::text[])`, [club, refs])
    const undoFx = await rpc(pool, coach, 'undo_event_import', { p_academy: club, p_team: team, p_refs: refs })
    check(undoFx.ok && undoFx.data === made, { what: 'a wrong draw import can be undone too, in one call', expected: `${made} games removed`, actual: undoFx.ok ? `${undoFx.data} removed` : `${undoFx.code}: ${undoFx.error}`.slice(0, 120), role: 'coach', where: 'undo_event_import', severity: 'medium' })
    const left = await val(pool, `select count(*)::int from public.events where academy_id = $1 and external_ref = any($2::text[])`, [club, refs])
    if (left) await sql(pool, `delete from public.events where academy_id = $1 and external_ref = any($2::text[])`, [club, refs])
    check(left === 0, { what: 'the wrong games are gone from the families\' calendars', expected: 0, actual: left, role: 'parent', where: 'events' })
  })
  add(`${plusDays(S, -4)} 19:45`, 'AM2 the draw re-published mid-season', async () => {
    scenario('AM2', 'Admin mistakes', 'The draw re-published mid-season: played games, moved games and call-offs survive; only unplayed, unpinned games are redrawn, from today on; no pair meets more than the draw allows')
    const division = 'U13 Division 2'
    const before = await sql(pool, `select id, round, status::text, starts_at, pinned, home_entry_id, away_entry_id from public.fixtures where competition_id = $1 and division = $2`, [COMP, division])
    const played = before.filter((f) => f.status === 'final' || f.status === 'forfeit')
    const pinned = before.filter((f) => f.pinned && f.status === 'scheduled')
    const offs = before.filter((f) => f.status === 'postponed' || f.status === 'cancelled')
    const venue = await val(pool, `select venue_id from public.fixtures where competition_id = $1 and division = $2 and venue_id is not null limit 1`, [COMP, division])
    // Re-published from the season's first Saturday: the rounds already played are skipped, the rest keep their calendar.
    const first = await val(pool, `select min((starts_at at time zone 'Australia/Sydney')::date)::text from public.fixtures where competition_id = $1 and division = $2`, [COMP, division])
    const r = await rpc(pool, who.compManager, 'generate_fixtures_on_pitches', { p_competition: COMP, p_division: division, p_venue: venue, p_first_date: first, p_game_mins: null, p_gap_mins: 5, p_replace: true, p_round_every_days: 7, p_legs: 2, p_skip_dates: ['2027-04-17'] })
    mustWork(r, { what: 'the competition manager re-publishes the division\'s draw with results already in', role: 'competition manager', where: 'generate_fixtures_on_pitches (p_replace)' })
    const after = await sql(pool, `select id, round, status::text, starts_at, pinned, home_entry_id, away_entry_id from public.fixtures where competition_id = $1 and division = $2`, [COMP, division])
    const keptPlayed = played.filter((p) => after.some((a) => a.id === p.id && a.status === p.status))
    check(keptPlayed.length === played.length, { what: 'every played game is still there, as it finished', expected: `${played.length} kept`, actual: `${keptPlayed.length} kept`, role: 'competition manager', where: 'generate_fixtures (p_replace)' })
    const keptPinned = pinned.filter((p) => after.some((a) => a.id === p.id && new Date(a.starts_at).getTime() === new Date(p.starts_at).getTime()))
    check(keptPinned.length === pinned.length, { what: 'every moved game keeps its new time', expected: `${pinned.length} kept`, actual: `${keptPinned.length} kept`, role: 'ground manager', where: 'generate_fixtures (p_replace)' })
    const keptOff = offs.filter((p) => after.some((a) => a.id === p.id))
    check(keptOff.length === offs.length, { what: 'called-off games are still on record', expected: `${offs.length}`, actual: `${keptOff.length}`, role: 'competition manager', where: 'generate_fixtures (p_replace)' })
    const dup = await sql(pool, `select least(home_entry_id, away_entry_id) a, greatest(home_entry_id, away_entry_id) b, count(*)::int n from public.fixtures where competition_id = $1 and division = $2 and status <> 'bye' and home_entry_id is not null and away_entry_id is not null group by 1, 2 having count(*) > 2`, [COMP, division])
    check(dup.length === 0, { what: 'no pair of teams meets more than twice', expected: 'none', actual: `${dup.length} pairs meet ${dup[0]?.n ?? ''} times`, role: 'competition manager', where: 'generate_fixtures (p_replace)' })
    const future = after.filter((a) => a.status === 'scheduled' && !a.pinned)
    const past = future.filter((a) => new Date(a.starts_at) < clock.now)
    // A game that was already unplayed in the past before the redraw (a round the season never got to — the
    // step runner's data, not a real season) keeps its slot; only a NEW past date is wrong.
    const pastBefore = before.filter((f) => f.status === 'scheduled' && !f.pinned && new Date(f.starts_at) < clock.now).length
    if (pastBefore) note(`${pastBefore} unplayed games were already in the past before the redraw (data at an earlier round)`)
    else check(past.length === 0, { what: 'the redrawn games are all ahead of today', expected: 'none in the past', actual: `${past.length} dated before today`, role: 'competition manager', where: 'generate_fixtures (p_replace)' })
    const games = after.filter((a) => a.status !== 'bye').length
    const teams = await val(pool, `select count(*)::int from public.competition_entries where competition_id = $1 and division = $2 and withdrawn_at is null`, [COMP, division]).catch(() => null)
    if (teams) check(games === teams * (teams - 1), { what: 'the division still has a full home-and-away season', expected: teams * (teams - 1), actual: games, role: 'competition manager', where: 'generate_fixtures (p_replace)', severity: 'medium' })
  })
  add(`${plusDays(S, -3)} 19:45`, 'AM3 a team deleted by mistake', async () => {
    scenario('AM3', 'Admin mistakes', 'A team deleted by mistake: a squad with players, games or money cannot be deleted outright — the club ends its season instead and nothing is lost')
    const team = await val(pool, `select id from public.teams where academy_id = $1 and season = '2027' order by name offset 1 limit 1`, [club])
    const counts = async () => ({
      players: await val(pool, `select count(*)::int from public.players where team_id = $1`, [team]),
      events: await val(pool, `select count(*)::int from public.events where team_id = $1`, [team]),
      members: await val(pool, `select count(*)::int from public.team_members where team_id = $1`, [team]),
      team: await val(pool, `select count(*)::int from public.teams where id = $1`, [team]),
    })
    const b = await counts()
    const del = await run(pool, who.president(c), `delete from public.teams where id = $1 returning id`, [team])
    mustRefuse(del, { what: 'deleting a squad with players and games is refused', role: 'club president', where: 'teams (delete)' })
    if (!del.ok) check(/end|season|players|games|instead/i.test(del.error), { what: 'the refusal says what to do instead', expected: 'end its season instead', actual: del.error.slice(0, 120), role: 'club president', where: 'teams (delete)', severity: 'low' })
    const a = await counts()
    check(a.team === 1 && a.players === b.players && a.events === b.events && a.members === b.members, { what: 'nothing was lost', expected: JSON.stringify(b), actual: JSON.stringify(a), role: 'club president', where: 'teams' })
    const end = await run(pool, who.president(c), `update public.teams set status = 'ended', ended_at = now() where id = $1 returning id`, [team])
    mustWork(end, { what: 'ending the squad\'s season works instead', role: 'club president', where: 'teams (status ended)' })
    await sql(pool, `update public.teams set status = 'active', ended_at = null where id = $1`, [team])
  })
}

// ================================================= MD · a family's data
async function familyData(ctx, S, add, rand) {
  const { pool } = ctx
  const c = 41 + rand.int(9)
  const club = ids.club(c)
  add(`${plusDays(S, -4)} 20:30`, 'MD1 a family downloads their data', async () => {
    scenario('MD1', "A family's data", 'A family downloads their data: the export carries their children, their answers, their messages and their payments, and nothing of anyone else')
    const row = (await sql(pool, `
      select g.profile_id, count(*)::int as kids, array_agg(pl.full_name) as names
        from public.player_guardians g join public.players pl on pl.id = g.player_id
       where pl.academy_id = $1 group by g.profile_id order by count(*) desc, g.profile_id limit 1`, [club]))[0]
    if (!row) { note('no family at this club'); return }
    const sq = await squad(pool, (await val(pool, `select team_id from public.players pl join public.player_guardians g on g.player_id = pl.id where g.profile_id = $1 limit 1`, [row.profile_id])))
    const said = await say(pool, row.profile_id, sq.channel, club, 'A line of mine, for the export')
    mustWork(said, { what: 'the parent posts a line in the squad chat', role: 'parent', where: 'messages' })
    const ex = await rpc(pool, row.profile_id, 'export_my_data', {})
    mustWork(ex, { what: 'a parent asks for a copy of their data', role: 'parent', where: 'export_my_data' })
    const d = ex.data ?? {}
    check(Array.isArray(d.children) && d.children.length === row.kids && row.names.every((n) => d.children.some((k) => k.name === n)), { what: 'the export names their children, all of them', expected: row.names.join(', '), actual: (d.children ?? []).map((k) => k.name).join(', '), role: 'parent', where: 'export_my_data (children)' })
    check(JSON.stringify(d.your_messages ?? []).includes('for the export'), { what: 'and their own messages', expected: 'the line just posted', actual: `${(d.your_messages ?? []).length} messages: ${JSON.stringify((d.your_messages ?? [])[0] ?? {}).slice(0, 120)}`, role: 'parent', where: 'export_my_data (your_messages)' })
    check((d.your_answers ?? []).length >= 1, { what: 'and their answers for games', expected: '≥1', actual: (d.your_answers ?? []).length, role: 'parent', where: 'export_my_data (your_answers)' })
    const othersNames = await sql(pool, `select pl.full_name from public.players pl where pl.academy_id = $1 and pl.id not in (select player_id from public.player_guardians where profile_id = $2) limit 200`, [club, row.profile_id])
    const blob = JSON.stringify(d)
    const leaked = othersNames.filter((o) => blob.includes(o.full_name)).map((o) => o.full_name)
    check(leaked.length === 0, { what: 'nothing of another family is in it', expected: 'no other child named', actual: leaked.slice(0, 3).join(', ') || 'none', role: 'parent', where: 'export_my_data' })
    check(!('account_email' in d) || Boolean(d.account_email), { what: 'the export says which email the account has (0214)', expected: 'the account email', actual: 'account_email' in d ? d.account_email : 'not included', role: 'parent', where: 'export_my_data', severity: 'low' })
  })
  add(`${plusDays(S, -3)} 20:30`, 'MD2 a family deletes their data mid-season', async () => {
    scenario('MD2', "A family's data", 'A family deletes their data mid-season through the real route: their messages become tombstones, their answers and guardian links go, the club keeps the roster record and the money records, the owners are told of a child with no contact, and the person is gone from the club')
    const row = (await sql(pool, `
      select g.profile_id, pl.id as player, pl.full_name, pl.team_id,
             (select count(*) from public.payments pm where pm.profile_id = g.profile_id) as paid
        from public.player_guardians g join public.players pl on pl.id = g.player_id
       where pl.academy_id = $1 and (select count(*) from public.player_guardians x where x.player_id = pl.id) = 1
         and (select count(*) from public.player_guardians y where y.profile_id = g.profile_id) = 1
       order by paid desc, g.profile_id limit 1`, [club]))[0]
    if (!row) { note('no sole guardian of one child at this club'); return }
    const me = row.profile_id
    const sq = await squad(pool, row.team_id)
    const said = await say(pool, me, sq.channel, club, 'A line I will take with me')
    const msgId = said.data?.[0]?.id ?? null
    const payments = await val(pool, `select count(*)::int from public.payments where profile_id = $1`, [me])
    if (!payments) note('this family has no payment on record — the "money kept" check is trivial here')
    const before = { msgs: await val(pool, `select count(*)::int from public.messages where sender_id = $1`, [me]), rsvps: await val(pool, `select count(*)::int from public.event_rsvps where profile_id = $1`, [me]) }
    const out = await withStack(ctx, 'MD2 erase through the route', async ({ db }) => {
      const r = await apiAs(db, me, '/api/me/erase', { method: 'POST', body: {} })
      return r
    })
    if (!out) return
    check(out.status === 200 && out.data?.manifest, { what: 'the route erases and hands back a manifest', expected: '200 + manifest', actual: `${out.status} ${JSON.stringify(out.data).slice(0, 120)}`, role: 'parent', where: '/api/me/erase' })
    const after = {
      guardian: await val(pool, `select count(*)::int from public.player_guardians where profile_id = $1`, [me]),
      rsvps: await val(pool, `select count(*)::int from public.event_rsvps where profile_id = $1`, [me]),
      msgBody: msgId ? await val(pool, `select body from public.messages where id = $1`, [msgId]) : 'n/a',
      msgRow: msgId ? await val(pool, `select count(*)::int from public.messages where id = $1`, [msgId]) : 0,
      member: await val(pool, `select count(*)::int from public.academy_members where profile_id = $1 and status = 'active'`, [me]),
      profile: await val(pool, `select full_name from public.profiles where id = $1`, [me]),
      authUser: await val(pool, `select count(*)::int from auth.users where id = $1`, [me]),
      email: await val(pool, `select count(*)::int from public.account_emails where profile_id = $1`, [me]),
      payments: await val(pool, `select count(*)::int from public.payments where profile_id = $1`, [me]),
      child: await val(pool, `select count(*)::int from public.players where id = $1`, [row.player]),
      told: await val(pool, `select count(*)::int from public.notification_queue where kind = 'guardian_erased' and payload->>'player_id' = $1`, [row.player]),
    }
    check(after.guardian === 0 && after.rsvps === 0, { what: 'their guardian links and answers are gone', expected: '0 and 0', actual: `${after.guardian} links, ${after.rsvps} answers (had ${before.rsvps})`, role: 'parent', where: 'erase_me' })
    check(after.msgRow === 1 && after.msgBody == null, { what: 'their messages stay as tombstones with no words', expected: 'row kept, body null', actual: `row ${after.msgRow}, body ${JSON.stringify(after.msgBody)}`, role: 'parent', where: 'erase_me (messages)' })
    check(after.member === 0, { what: 'they are no longer a member of the club', expected: 0, actual: after.member, role: 'club president', where: 'academy_members' })
    check(after.child === 1, { what: "the child's roster record stays with the club", expected: 1, actual: after.child, role: 'coach', where: 'players' })
    check(after.told >= 1, { what: 'the owners are told the child has no contact now', expected: '≥1', actual: after.told, role: 'club president', where: 'notification_queue (guardian_erased)' })
    check(after.payments === payments, { what: 'the money records are kept, as the manifest promises', expected: payments, actual: after.payments, role: 'treasurer', where: 'payments' })
    check(after.email === 0 && (after.profile === 'Removed' || after.profile == null), { what: 'no email or name is left behind', expected: 'no account email; profile Removed or gone', actual: `${after.email} emails, profile ${after.profile}`, role: 'parent', where: 'erase_me / the route' })
    const roster = (await rpc(pool, sq.coach, 'who_hasnt_answered', { p_event: await val(pool, `select e.id from public.events e where e.team_id = $1 and e.starts_at > now() and e.cancelled_at is null order by e.starts_at limit 1`, [row.team_id]) })).data ?? []
    const mine = roster.find((x) => x.player_id === row.player)
    check(!mine || mine.guardian_id == null, { what: 'the coach sees the child with nobody to nudge', expected: 'no guardian', actual: JSON.stringify(mine ?? 'not listed').slice(0, 80), role: 'coach', where: 'who_hasnt_answered' })
    ctx.erased = { me, player: row.player, authUser: after.authUser }
  })
}

// ========================================= LS · a brand-new organiser's league
const CLUB_NAMES = ['Lindfield Lions', 'Killara Kites', 'Gordon Gulls', 'Pymble Panthers', 'Turramurra Tigers', 'Wahroonga Wolves', 'Hornsby Hawks', 'Asquith Arrows',
  'Chatswood Comets', 'Roseville Rangers', 'Willoughby Wanderers', 'Artarmon Aces', 'Lane Cove Lynx', 'Gladesville Gazelles', 'Epping Eagles', 'Beecroft Bears']
/**
 * Joey (16 Nov 2026): "a brand-new organiser starts a league from sign-up to
 * published draw" — two divisions, sixteen teams, two venues — timed against
 * the thirty-minute target. The clock moves at a human's pace per step; the
 * wall time of the calls is reported beside it.
 */
export async function leagueSetup(ctx) {
  const { pool } = ctx
  scenario('LS1', 'League setup', 'A brand-new organiser starts a league from sign-up to a published draw: two divisions, sixteen teams, two venues — the checklist ticks itself from the data, and it takes under thirty minutes')
  clock.set('2027-01-18 10:00')
  const t0 = Date.now()
  const tag = `ls${(ctx.seed ?? 0)}${Date.now().toString(36).slice(-4)}`
  let uid = null
  // Sign-up through the real routes when the app is serving; else the account goes straight in, as the seed's do.
  if (await appUp(ctx, 'LS1 sign-up')) {
    await withStack(ctx, 'LS1 sign-up', async () => {
      // The index names the mobile and the address, so a run never reuses one.
      const fam = await newFamily(tag, 300000 + Math.floor(Math.random() * 600000), ctx.seed ?? 0)
      if (fam.ok) uid = await val(pool, `select id from auth.users where lower(email) = $1`, [fam.email])
      check(fam.ok, { what: 'the organiser creates an account (name, email, mobile, the six-digit code)', expected: 'an account', actual: fam.ok ? 'signed up' : `${fam.step}: ${fam.error}`, role: 'league organiser (new)', where: '/api/account' })
    })
  }
  if (!uid) {
    uid = (await sql(pool, `insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at, aud, role)
      values (gen_random_uuid(), $1, 'x', now(), '{"full_name":"Nadia Organiser","first_name":"Nadia","last_name":"Organiser"}'::jsonb, now(), now(), 'authenticated', 'authenticated') returning id`, [`${tag}-organiser@squadroom-demo.test`]))[0].id
    note('the app was not serving: the organiser account went straight in')
  }
  const as = (fn, args) => rpc(pool, uid, fn, args, { aal2: true })
  const own = (text, params) => run(pool, uid, text, params, { aal2: true })
  // The clock moves at a thumb's pace, the same model as test-playfootball-first:
  // six seconds a typed field, three a tap, thirty seconds to read each screen,
  // plus any wait (scanning a QR code, picking a crest, the draw building).
  const spent = { fields: 0, taps: 0, screens: 0, wait: 0 }
  const human = ({ fields = 0, taps = 0, screens = 1, wait = 0 }) => {
    spent.fields += fields; spent.taps += taps; spent.screens += screens; spent.wait += wait
    clock.advance((fields * 6 + taps * 3 + screens * 30 + wait) / 3600)
  }
  // 1. Found the league (a minute).
  const org = await rpc(pool, uid, 'create_academy', { p_name: `Northern Districts Football League ${tag}`, p_type: 'league' })
  mustWork(org, { what: 'they found the league from /start', role: 'league organiser (new)', where: 'create_academy' })
  if (!org.ok) return
  const league = org.data
  human({ fields: 1, taps: 2 })                        // the name, the kind, Create it
  // A league's staff sign in with two steps (0231): the founder sets up the
  // authenticator now (two minutes). The stack has no authenticator, so every
  // call and page from here is the two-step session the app would give them.
  human({ fields: 1, taps: 2, wait: 15 })              // scan the code, type the six digits
  const list0 = (await as('setup_progress', { p_academy: league })).data
  check(list0?.type === 'league' && (list0.steps ?? []).length === 9 && list0.done <= 1 && !list0.complete, { what: 'Home shows the league\'s own nine-step list, nothing ticked yet', expected: '9 steps, 0–1 done', actual: list0 ? `${list0.type}: ${list0.steps?.length} steps, ${list0.done} done` : 'null', role: 'league organiser (new)', where: 'setup_progress (league)' })
  // 2. Crest & colours (two minutes).
  mustWork(await own(`update public.academies set primary_colour = '#1f6f8b' where id = $1 returning id`, [league]), { what: 'the league picks its colour', role: 'league organiser (new)', where: 'academies' })
  human({ taps: 1, wait: 20 })                         // a swatch, the crest from the photo roll
  // 3. Venues & pitches (five minutes): two grounds, a full field and two halves at each.
  const venues = []
  for (const name of ['Lindfield Oval', 'Pymble Park']) {
    const v = await own(`insert into public.venues (academy_id, name) values ($1, $2) returning id`, [league, `${name} ${tag}`])
    mustWork(v, { what: `a ground: ${name}`, role: 'league organiser (new)', where: 'venues' })
    if (!v.ok) continue
    const full = await as('add_pitch', { p_venue: v.data[0].id, p_name: 'Field 1' })
    const second = await as('add_pitch', { p_venue: v.data[0].id, p_name: 'Field 2' })
    if (second.ok) await as('split_pitch', { p_pitch: second.data, p_into: 2 })
    mustWork(full, { what: 'and its pitches', role: 'league organiser (new)', where: 'add_pitch / split_pitch' })
    venues.push(v.data[0].id)
  }
  human({ fields: 6, taps: 8, screens: 2 })            // two grounds, four pitch names, add and split
  // 4. Create the competition (two minutes).
  const comp = await own(`insert into public.competitions (organiser_id, name, type, mode, season, organiser, starts_on) values ($1, $2, 'season', 'managed', '2027', $3, '2027-04-10') returning id`,
    [league, `NDFL Winter ${tag}`, `Northern Districts Football League ${tag}`])
  mustWork(comp, { what: 'they create the competition', role: 'league organiser (new)', where: 'competitions' })
  if (!comp.ok) return
  const C = comp.data[0].id
  human({ fields: 3, taps: 2 })                        // name, season, first Saturday
  const setup0 = (await as('competition_setup', { p_competition: C })).data
  check(setup0 && setup0.steps?.[0]?.done && setup0.steps?.[1]?.done && !setup0.complete && !setup0.published, { what: 'the competition opens on its Setup tab: venues and the competition ticked, the rest waiting', expected: 'grounds ✓ competition ✓ 6 to go', actual: setup0 ? setup0.steps.map((s) => `${s.id}:${s.done ? '✓' : '○'}`).join(' ') : 'null', role: 'league organiser (new)', where: 'competition_setup' })
  // 5. Divisions & rules (three minutes).
  const d1 = await as('add_division', { p_competition: C, p_division: 'U12 Division 1', p_age_group: 'U12', p_pitch_size: 'half' })
  const d2 = await as('add_division', { p_competition: C, p_division: 'U16 Division 1', p_age_group: 'U16', p_pitch_size: 'full' })
  mustWork(d1, { what: 'two divisions are named before any club enters', role: 'league organiser (new)', where: 'add_division' })
  mustWork(await own(`update public.competition_divisions set match_length_mins = 50, points_win = 3, points_draw = 1 where competition_id = $1 returning id`, [C]), { what: 'and their rules set', role: 'league organiser (new)', where: 'competition_divisions' })
  human({ fields: 12, taps: 4, screens: 2 })           // two divisions, their rules
  // 6. Invite clubs / open entries (five minutes): sixteen teams by name, entries open.
  const inv1 = await as('bulk_invite_clubs', { p_competition: C, p_division: 'U12 Division 1', p_clubs: JSON.stringify(CLUB_NAMES.slice(0, 8).map((n) => ({ club_name: n }))) })
  const inv2 = await as('bulk_invite_clubs', { p_competition: C, p_division: 'U16 Division 1', p_clubs: JSON.stringify(CLUB_NAMES.slice(8, 16).map((n) => ({ club_name: n }))) })
  mustWork(inv1, { what: 'eight clubs invited into U12 Division 1', role: 'league organiser (new)', where: 'bulk_invite_clubs' })
  mustWork(inv2, { what: 'and eight into U16 Division 1', role: 'league organiser (new)', where: 'bulk_invite_clubs' })
  mustWork(await own(`update public.competitions set entries_open = true where id = $1 returning id`, [C]), { what: 'entries opened', role: 'league organiser (new)', where: 'competitions.entries_open' })
  human({ fields: 16, taps: 3, screens: 2 })           // sixteen club names, Invite, Open entries
  // 7. Entry fees (two minutes).
  mustWork(await as('set_competition_fee', { p_competition: C, p_division: '', p_fee_cents: 35000, p_instructions: 'Bank transfer to the league before round one' }), { what: 'an entry fee for every division', role: 'league organiser (new)', where: 'set_competition_fee' })
  human({ fields: 2, taps: 1 })                        // the fee and how to pay it
  // 8. Referees (four minutes): six into the pool.
  let refs = 0
  for (let i = 0; i < 6; i++) {
    const r = await as('add_referee', { p_competition: C, p_full_name: `${['Ava', 'Ben', 'Chloe', 'Dev', 'Ella', 'Finn'][i]} Whistle`, p_phone: `+6148${String(100000 + i).slice(-6)}0`, p_grade: 'Level 4' })
    if (r.ok) refs++
  }
  check(refs === 6, { what: 'six referees in the pool', expected: 6, actual: refs, role: 'league organiser (new)', where: 'add_referee' })
  human({ fields: 18, taps: 6 })                       // six referees: name, mobile, grade
  // 9. Build & check the draw (five minutes): each division on a ground, two legs, from 10 April.
  let drawn = 0
  for (const [division, venue] of [['U12 Division 1', venues[0]], ['U16 Division 1', venues[1]]]) {
    const r = await as('generate_fixtures_on_pitches', { p_competition: C, p_division: division, p_venue: venue, p_first_date: '2027-04-10', p_game_mins: null, p_gap_mins: 5, p_replace: false, p_round_every_days: 7, p_legs: 2, p_skip_dates: null })
    if (r.ok) drawn++; else note(`${division}: ${r.error}`)
  }
  check(drawn === 2, { what: 'both divisions drawn onto their grounds', expected: 2, actual: drawn, role: 'league organiser (new)', where: 'generate_fixtures_on_pitches' })
  const q = await as('draw_quality', { p_competition: C, p_division: 'U12 Division 1' })
  mustWork(q, { what: 'the draw is checked', role: 'league organiser (new)', where: 'draw_quality' })
  mustWork(await as('note_draw_checked', { p_competition: C }), { what: 'and the check is noted', role: 'league organiser (new)', where: 'note_draw_checked' })
  human({ fields: 2, taps: 7, screens: 2, wait: 20 })  // venue, date, legs, Build — twice — and Check
  const setup1 = (await as('competition_setup', { p_competition: C })).data
  check(setup1 && setup1.done === 7 && !setup1.complete, { what: 'every step but Publish is ticked', expected: '7 of 8', actual: setup1 ? `${setup1.done} of ${setup1.total}: ${setup1.steps.filter((s) => !s.done).map((s) => s.id).join(', ') || 'all'}` : 'null', role: 'league organiser (new)', where: 'competition_setup' })
  // The screens, at 375px in light and dark (CLAUDE.md): the competition opens
  // on its Setup tab, Home's checklist is the league's, /start has the four.
  await withStack(ctx, 'LS1 the Setup tab in the browser', async ({ db, browser }) => {
    const { mkdirSync } = await import('node:fs')
    const dir = `.cache/screens/${ctx.seed ?? 1}-league`
    mkdirSync(dir, { recursive: true })
    for (const dark of [false, true]) {
      const { context, page } = await pageAs(browser, db, uid, { org: league, dark, aal2: true })
      try {
        const txt = await openSettled(page, `/competitions/${C}`)
        const onSetup = Boolean(await page.$('[data-competition-setup]'))
        const count = await page.$eval('[data-setup-count]', (el) => el.textContent).catch(() => null)
        check(onSetup && /7 of 8/.test(count ?? ''), { what: `the competition opens on its Setup tab (${dark ? 'dark' : 'light'}), 7 of 8 ticked`, expected: 'Setup first, "7 of 8"', actual: onSetup ? `Setup tab, "${count}"` : txt.slice(0, 160), role: 'league organiser (new)', where: `/competitions/${C}` })
        check(Boolean(await page.$('#publish')) && Boolean(await page.$('[data-add-division]')), { what: 'with the division form and the publish control on it', expected: 'both', actual: `publish ${Boolean(await page.$('#publish'))}, divisions ${Boolean(await page.$('[data-add-division]'))}`, role: 'league organiser (new)', where: 'Setup tab' })
        await page.screenshot({ path: `${dir}/setup-${dark ? 'dark' : 'light'}.png`, fullPage: true }).catch(() => null)
        if (!dark) {
          const home = await openSettled(page, '/start/setup')
          const clockText = await page.$eval('[data-setup-clock]', (el) => el.textContent).catch(() => null)
          check(/7 of 9|8 of 9/.test(clockText ?? ''), { what: 'Home\'s checklist is the league\'s nine steps with the clock running', expected: '8 of 9 done · N min so far', actual: clockText ?? home.slice(0, 120), role: 'league organiser (new)', where: '/start/setup' })
          await page.screenshot({ path: `${dir}/home-checklist.png`, fullPage: true }).catch(() => null)
          await openSettled(page, '/start')
          const choices = await page.$$eval('[data-start-type]', (els) => els.map((e) => e.getAttribute('data-start-type')))
          check(choices.join('|') === 'Academy|Club|League|Tournament & league organiser', { what: '/start offers the four agreed choices and no others', expected: 'Academy, Club, League, Tournament & league organiser', actual: choices.join(', '), role: 'anyone', where: '/start' })
          await page.screenshot({ path: `${dir}/start.png`, fullPage: true }).catch(() => null)
        }
      } finally {
        await context.close().catch(() => null)
      }
    }
  }, { browser: true })
  // 10. Publish (a minute).
  const slug = `ndfl-${tag}`
  mustWork(await own(`update public.competitions set public_slug = $2, published_at = now() where id = $1 returning id`, [C, slug]), { what: 'they publish', role: 'league organiser (new)', where: 'competitions (publish)' })
  human({ fields: 1, taps: 1 })                        // the address, Publish
  const games = await val(pool, `select count(*)::int from public.fixtures where competition_id = $1 and status <> 'bye'`, [C])
  check(games === 112, { what: 'a full home-and-away season for sixteen teams', expected: 112, actual: games, role: 'league organiser (new)', where: 'fixtures' })
  const setup2 = (await as('competition_setup', { p_competition: C })).data
  check(Boolean(setup2?.complete && setup2.published), { what: 'the competition\'s setup is complete', expected: 'complete, published', actual: JSON.stringify({ done: setup2?.done, total: setup2?.total, published: setup2?.published }), role: 'league organiser (new)', where: 'competition_setup' })
  const prog = (await as('setup_progress', { p_academy: league })).data
  check(Boolean(prog?.complete && prog.completed_at), { what: 'the league\'s checklist on Home is complete and the clock stopped', expected: 'complete', actual: prog ? `${prog.done}/${prog.total}, ${prog.minutes} min` : 'null', role: 'league organiser (new)', where: 'setup_progress (league)' })
  check(Number(prog?.minutes) <= 30, { what: 'from sign-up to a published draw in under thirty minutes (at a human\'s pace)', expected: '≤ 30 min', actual: `${prog?.minutes} min simulated, ${Math.round((Date.now() - t0) / 1000)} s of calls`, role: 'league organiser (new)', where: 'setup_progress.minutes' })
  const pub = await asAnon(pool, async (c) => (await c.query(`select public.public_match_centre($1) j`, [slug])).rows[0].j)
  check(pub.ok && (pub.data?.fixtures ?? []).length === 112 && Object.keys(pub.data?.ladder ?? {}).length === 2, { what: 'the public match centre shows the whole draw and both ladders', expected: '112 games, 2 ladders', actual: pub.ok ? `${(pub.data?.fixtures ?? []).length} games, ${Object.keys(pub.data?.ladder ?? {}).length} ladders` : pub.error, role: 'stranger', where: 'public_match_centre' })
  note(`league ${tag}: ${prog?.minutes} min at a thumb's pace (${spent.fields} fields typed, ${spent.taps} taps, ${spent.screens} screens read, ${spent.wait} s waiting), ${Math.round((Date.now() - t0) / 1000)} s of calls`)
  ctx.leagueSetup = { league, competition: C, slug, uid }
  // The pre-season proper starts the week after.
  clock.set('2027-01-25 09:00')
}

export { plusDays }
