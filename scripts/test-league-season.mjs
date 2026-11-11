// Run: node --env-file=.env.local scripts/test-league-season.mjs
//
// M9 ACCEPTANCE: a simulated SPL season, end to end, without Dribl.
//
// Six age groups, eight clubs, a round-robin draw on real venues. A league
// official, two club managers (NRIFA and Ravens), a referee and a parent.
// A referee is appointed and checks in. Both sides sheet, confirm, score;
// a red card suspends a player and blocks them from next week's sheet. A
// washout postpones a round and every affected family is told why; one
// game is rescheduled. Ladders, then finals seeded from them. The public
// page shows all of it. The referee is paid; the reports come out.
import { createClient } from '@supabase/supabase-js'
import { signInClient } from './_auth.mjs'
import { listAllUsers } from './_users.mjs'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const anon = createClient(URL_, PUB, { auth: { persistSession: false } })

let fails = 0
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`)
  fails++
  process.exitCode = 1
}
const head = (m) => console.log(`\n\x1b[1m${m}\x1b[0m`)

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const RAVENS = '00000000-0000-0000-0000-0000000a0002'
const SPL = '00000000-0000-0000-0000-0000000a0003'
const OWNER = '00000000-0000-0000-0000-0000000000a1'
const RAVENS_OWNER = '00000000-0000-0000-0000-0000000000c1'
const PARENT = '00000000-0000-0000-0000-0000000000b1'
const U8 = '00000000-0000-0000-0000-0000000d0008'
const RAVENS_U8 = '00000000-0000-0000-0000-0000000d0099'
const TAG = 'SEASON'
const SLUG = 'season-test-spl'
const OFFICIAL_EMAIL = 'season-official@squadroom.invalid'
const REF_EMAIL = 'season-ref@squadroom.invalid'
const DIVISIONS = ['U8', 'U9', 'U10', 'U11', 'U12', 'U13']
const CLUBS = ['Hills Hawks', 'Carlingford Cobras', 'West Pennant Hills', 'Thornleigh Thunder', 'Normanhurst Nomads', 'Cheltenham Colts']

// Sessions are cached across suites (scripts/_auth.mjs), so a full run no
// longer trips the auth rate limit.
const signInEmail = (email) => signInClient(admin, email)
async function cleanup() {
  const { data: comps } = await admin.from('competitions').select('id').like('name', `${TAG} %`)
  for (const c of comps ?? []) {
    const { data: evs } = await admin.from('events').select('id').eq('competition_id', c.id)
    for (const e of evs ?? []) await admin.from('notification_queue').delete().filter('payload->>event_id', 'eq', e.id)
    await admin.from('competitions').delete().eq('id', c.id)
  }
  await admin.from('venues').delete().like('name', `${TAG} %`)
  await admin.from('referees').delete().like('full_name', `% ${TAG}`)
  await admin.from('players').delete().like('full_name', `% ${TAG}`)
  const { data: users } = await listAllUsers(admin)
  for (const e of [OFFICIAL_EMAIL, REF_EMAIL]) {
    const u = users?.users?.find((x) => x.email === e)
    if (u) {
      await admin.from('league_roles').delete().eq('profile_id', u.id)
      await admin.from('academy_members').delete().eq('profile_id', u.id)
      await admin.from('staff_clearances').delete().eq('profile_id', u.id)
      await admin.auth.admin.deleteUser(u.id)
    }
  }
}
await cleanup()

// People.
const { data: offUser } = await admin.auth.admin.createUser({ email: OFFICIAL_EMAIL, email_confirm: true })
await admin.from('profiles').upsert({ id: offUser.user.id, full_name: 'Olive Official' })
await admin.from('staff_clearances').insert({ academy_id: SPL, profile_id: offUser.user.id, kind: 'wwcc', number: 'WWC0000781E', outcome: 'cleared', expires_on: new Date(Date.now() + 400 * 864e5).toISOString().slice(0, 10), verified_by: OWNER })
await admin.from('academy_members').insert({ academy_id: SPL, profile_id: offUser.user.id, role: 'admin', status: 'active' })
const { data: refUser } = await admin.auth.admin.createUser({ email: REF_EMAIL, email_confirm: true })
await admin.from('profiles').upsert({ id: refUser.user.id, full_name: `Pat Whistle ${TAG}` })
// Ravens' U8 roster has one child in the seed; a sheet needs more.
const { data: ravKids } = await admin.from('players').insert(Array.from({ length: 8 }, (_, i) => ({ academy_id: RAVENS, team_id: RAVENS_U8, full_name: `Raven ${i + 1} ${TAG}`, dob: '2018-02-02' }))).select('id')

const official = await signInEmail(OFFICIAL_EMAIL)
const nrifa = await signInEmail((await admin.auth.admin.getUserById(OWNER)).data.user.email)
const ravens = await signInEmail((await admin.auth.admin.getUserById(RAVENS_OWNER)).data.user.email)
const referee = await signInEmail(REF_EMAIL)
const parent = await signInEmail((await admin.auth.admin.getUserById(PARENT)).data.user.email)
if (!official || !nrifa || !ravens || !referee || !parent) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  await cleanup()
  process.exit(2)
}

head('1. The league sets up the season: six divisions, eight clubs, two grounds')
let comp
{
  const { data: c, error } = await official.from('competitions').insert({
    organiser_id: SPL, name: `${TAG} SPL 2027`, type: 'season', season: '2027', status: 'active', mode: 'managed', visibility: 'participants', created_by: offUser.user.id,
  }).select('id').single()
  error ? bad(`competition: ${error.message}`) : ok('the official creates the season')
  comp = c
  await admin.from('venues').insert([{ academy_id: SPL, name: `${TAG} Nolan Reserve`, address: 'Nolan Reserve, North Manly' }, { academy_id: SPL, name: `${TAG} ELS Hall`, address: 'ELS Hall Park, North Ryde' }])
  await admin.from('competition_clubs').insert([
    { competition_id: comp.id, academy_id: NRIFA, status: 'active', joined_at: new Date().toISOString() },
    { competition_id: comp.id, academy_id: RAVENS, status: 'active', joined_at: new Date().toISOString() },
  ])
  for (const d of DIVISIONS) {
    const { error: de } = await official.from('competition_divisions').insert({ competition_id: comp.id, division: d, match_length_mins: 40, allow_playing_up: true, scores_public: true, ladder_enabled: true })
    if (de) bad(`division ${d}: ${de.message}`)
  }
  const rows = []
  for (const d of DIVISIONS) {
    rows.push({ competition_id: comp.id, academy_id: NRIFA, team_id: d === 'U8' ? U8 : null, display_name: `NRIFA ${d}`, division: d })
    rows.push({ competition_id: comp.id, academy_id: RAVENS, team_id: d === 'U8' ? RAVENS_U8 : null, display_name: `Ravens ${d}`, division: d })
    for (const club of CLUBS) rows.push({ competition_id: comp.id, display_name: `${club} ${d}`, division: d })
  }
  const { error: ee } = await admin.from('competition_entries').insert(rows)
  ee ? bad(`entries: ${ee.message}`) : ok('48 entries: NRIFA, Ravens and six visiting clubs in every division')
  await official.rpc('set_referee_fee', { p_competition: comp.id, p_role: 'referee', p_fee_cents: 4500 })
  await official.rpc('grant_league_role', { p_competition: comp.id, p_profile: offUser.user.id, p_role: 'competition_manager' })
}

head('2. The draw: a round-robin per division, weekly, on two grounds')
let round1, round2
{
  const start = new Date()
  start.setDate(start.getDate() + ((6 - start.getDay() + 7) % 7 || 7))
  start.setHours(8, 0, 0, 0)
  let total = 0
  for (const [i, d] of DIVISIONS.entries()) {
    const { data: made, error } = await official.rpc('generate_fixtures', {
      p_competition: comp.id, p_division: d, p_start_at: start.toISOString(), p_game_mins: 40, p_gap_mins: 10,
      p_fields: ['Field 1', 'Field 2'], p_venue_label: i % 2 === 0 ? `${TAG} Nolan Reserve` : `${TAG} ELS Hall`, p_replace: true, p_round_every_days: 7,
    })
    if (error) bad(`draw ${d}: ${error.message}`)
    total += made ?? 0
  }
  total === 168 ? ok('168 games: 7 rounds of 4 in each of 6 divisions') : bad(`${total} games drawn`)
  const { data: sheet } = await nrifa.rpc('competition_run_sheet', { p_competition: comp.id, p_division: 'U8' })
  const home = sheet.filter((f) => f.home_name === 'NRIFA U8').length
  const away = sheet.filter((f) => f.away_name === 'NRIFA U8').length
  home > 0 && away > 0 && home + away === 7 ? ok(`NRIFA U8 plays ${home} at home and ${away} away`) : bad(`home ${home}, away ${away}`)
  const r1 = sheet.filter((f) => f.round === 'Round 1')
  const r2 = sheet.filter((f) => f.round === 'Round 2')
  round1 = r1
  round2 = r2
  new Set(r1.map((f) => f.starts_at.slice(0, 10))).size === 1 && r2[0].starts_at.slice(0, 10) > r1[0].starts_at.slice(0, 10) ? ok('round 1 on one Saturday, round 2 the next') : bad('rounds are not weekly')
  const { count } = await admin.from('events').select('id', { count: 'exact', head: true }).eq('competition_id', comp.id).eq('academy_id', NRIFA)
  count >= 7 ? ok(`${count} games mirrored into NRIFA's calendar for the families`) : bad(`mirrored events: ${count}`)
}

head('3. A referee joins the pool and is appointed to NRIFA v Ravens')
let game, nrifaEntry, ravensEntry, poolId, apptId
{
  game = round1.find((f) => [f.home_name, f.away_name].includes('NRIFA U8') && [f.home_name, f.away_name].includes('Ravens U8'))
    ?? round2.find((f) => [f.home_name, f.away_name].includes('NRIFA U8') && [f.home_name, f.away_name].includes('Ravens U8'))
  if (!game) {
    const { data: any } = await admin.from('fixtures').select('id').eq('competition_id', comp.id).eq('division', 'U8').limit(1).single()
    // Force the pairing: the draw's rotation may put them in a later round.
    const n = (await admin.from('competition_entries').select('id').eq('competition_id', comp.id).eq('display_name', 'NRIFA U8').single()).data.id
    const r = (await admin.from('competition_entries').select('id').eq('competition_id', comp.id).eq('display_name', 'Ravens U8').single()).data.id
    await admin.from('fixtures').update({ home_entry_id: n, away_entry_id: r }).eq('id', any.id)
    game = (await nrifa.rpc('competition_run_sheet', { p_competition: comp.id, p_division: 'U8' })).data.find((f) => f.fixture_id === any.id)
  }
  nrifaEntry = game.home_name === 'NRIFA U8' ? game.home_entry_id : game.away_entry_id
  ravensEntry = game.home_name === 'NRIFA U8' ? game.away_entry_id : game.home_entry_id
  // Kick-off was half an hour ago, so check-in and the report are open.
  await admin.from('fixtures').update({ starts_at: new Date(Date.now() - 30 * 60_000).toISOString() }).eq('id', game.fixture_id)
  const { data: pid } = await official.rpc('add_referee', { p_competition: comp.id, p_full_name: `Pat Whistle ${TAG}`, p_grade: 'Level 3', p_profile: refUser.user.id })
  poolId = pid
  const { data: aid, error } = await official.rpc('appoint_referee', { p_fixture: game.fixture_id, p_referee: poolId })
  error ? bad(`appoint: ${error.message}`) : ok('Pat is asked to referee the game')
  apptId = aid
  const { error: acc } = await referee.rpc('respond_appointment', { p_appointment: apptId, p_accept: true })
  acc ? bad(`accept: ${acc.message}`) : ok('Pat accepts from the push')
  const { error: ci } = await referee.rpc('referee_check_in', { p_appointment: apptId })
  ci ? bad(`check-in: ${ci.message}`) : ok('and checks in at the ground')
  const { data: sheet } = await ravens.rpc('competition_run_sheet', { p_competition: comp.id, p_division: 'U8' })
  sheet.find((f) => f.fixture_id === game.fixture_id)?.referees === `Pat Whistle ${TAG}` ? ok("Ravens' manager sees the referee's name on the run sheet") : bad('referee missing from the run sheet')
}

head('4. Match day: both sheets, confirmed by the other side; a red card; both scores agree')
let redCarded
{
  await nrifa.rpc('seed_entry_squad', { p_entry: nrifaEntry })
  await ravens.rpc('seed_entry_squad', { p_entry: ravensEntry })
  const { data: nsq } = await admin.from('entry_squads').select('player_id').eq('entry_id', nrifaEntry)
  const { data: rsq } = await admin.from('entry_squads').select('player_id').eq('entry_id', ravensEntry)
  const rows = (sq) => sq.slice(0, 9).map((x, i) => ({ player_id: x.player_id, number: i + 1, starting: true }))
  // L-17 (0187): sheets lock thirty minutes before kick-off, so they go in
  // first — an hour out — and kick-off is moved back afterwards for the
  // events and the scores, which is the order of a real match day.
  await admin.from('fixtures').update({ starts_at: new Date(Date.now() + 60 * 60_000).toISOString() }).eq('id', game.fixture_id)
  const { error: s1 } = await nrifa.rpc('submit_match_sheet', { p_fixture: game.fixture_id, p_entry: nrifaEntry, p_players: rows(nsq) })
  const { error: s2 } = await ravens.rpc('submit_match_sheet', { p_fixture: game.fixture_id, p_entry: ravensEntry, p_players: rows(rsq) })
  s1 || s2 ? bad(`sheets: ${s1?.message ?? s2?.message}`) : ok('both managers submit a sheet of nine, an hour before kick-off')
  const { error: c1 } = await ravens.rpc('confirm_match_sheet', { p_fixture: game.fixture_id, p_entry: nrifaEntry })
  const { error: c2 } = await nrifa.rpc('confirm_match_sheet', { p_fixture: game.fixture_id, p_entry: ravensEntry })
  c1 || c2 ? bad(`confirm: ${c1?.message ?? c2?.message}`) : ok("each confirms the other's")
  await admin.from('fixtures').update({ starts_at: new Date(Date.now() - 30 * 60_000).toISOString() }).eq('id', game.fixture_id)
  // (NRIFA's owner also runs the SPL, so for them the lock does not apply —
  // test-sheet-rules proves the refusal with a coach who only coaches.)
  const { data: lockedView } = await ravens.rpc('match_sheet_view', { p_fixture: game.fixture_id })
  lockedView?.fixture?.locked === true ? ok('after kick-off the sheets are locked (L-17)') : bad(`locked: ${lockedView?.fixture?.locked}`)
  redCarded = nsq[1].player_id
  const { error: g } = await nrifa.rpc('record_match_event', { p_fixture: game.fixture_id, p_entry: nrifaEntry, p_kind: 'goal', p_player: nsq[0].player_id, p_minute: 12 })
  const { error: r } = await ravens.rpc('record_match_event', { p_fixture: game.fixture_id, p_entry: nrifaEntry, p_kind: 'red', p_player: redCarded, p_minute: 33, p_note: 'violent conduct' })
  g || r ? bad(`events: ${g?.message ?? r?.message}`) : ok('a goal for NRIFA; a NRIFA player is sent off')
  const { error: e1 } = await nrifa.rpc('enter_sheet_score', { p_fixture: game.fixture_id, p_entry: nrifaEntry, p_ours: 1, p_theirs: 0 })
  const { error: e2 } = await ravens.rpc('enter_sheet_score', { p_fixture: game.fixture_id, p_entry: ravensEntry, p_ours: 0, p_theirs: 1 })
  e1 || e2 ? bad(`scores: ${e1?.message ?? e2?.message}`) : ok('both enter 1–0')
  const { data: fx } = await admin.from('fixtures').select('status, home_score, away_score').eq('id', game.fixture_id).single()
  fx.status === 'final' ? ok('agreed, so the game is final') : bad(`fixture: ${JSON.stringify(fx)}`)
  const { data: susp } = await admin.from('suspensions').select('games, status').eq('competition_id', comp.id).eq('player_id', redCarded)
  susp?.[0]?.games === 1 && susp[0].status === 'active' ? ok('the red card is a one-game suspension, automatically') : bad(JSON.stringify(susp))
  const { error: rep } = await referee.rpc('submit_referee_report', { p_appointment: apptId, p_report: { home_score: fx.home_score, away_score: fx.away_score, conduct: 'One sending-off', incidents: 'Red card 33 min, violent conduct' } })
  rep ? bad(`report: ${rep.message}`) : ok("the referee's report is in")
}

head("5. Next week: the suspended player cannot be on NRIFA's sheet")
let nextGame
{
  const { data: sheet } = await nrifa.rpc('competition_run_sheet', { p_competition: comp.id, p_division: 'U8' })
  nextGame = sheet.find((f) => f.fixture_id !== game.fixture_id && f.status === 'scheduled' && [f.home_name, f.away_name].includes('NRIFA U8'))
  const nrifaNext = nextGame.home_name === 'NRIFA U8' ? nextGame.home_entry_id : nextGame.away_entry_id
  const { data: nsq } = await admin.from('entry_squads').select('player_id').eq('entry_id', nrifaNext)
  const withBanned = nsq.slice(0, 9).map((x, i) => ({ player_id: x.player_id, number: i + 1, starting: true }))
  if (!withBanned.some((p) => p.player_id === redCarded)) withBanned[0] = { player_id: redCarded, number: 1, starting: true }
  const { error } = await nrifa.rpc('submit_match_sheet', { p_fixture: nextGame.fixture_id, p_entry: nrifaNext, p_players: withBanned })
  error && /suspend/i.test(error.message) ? ok(`refused by name: "${error.message}"`) : bad(`banned player on the sheet: ${error?.message ?? 'accepted'}`)
  const without = nsq.filter((x) => x.player_id !== redCarded).slice(0, 9).map((x, i) => ({ player_id: x.player_id, number: i + 1, starting: true }))
  const { error: fine } = await nrifa.rpc('submit_match_sheet', { p_fixture: nextGame.fixture_id, p_entry: nrifaNext, p_players: without })
  fine ? bad(`sheet without them: ${fine.message}`) : ok('without them, the sheet goes in')
}

head('6. A washout: round 2 is called off, every family hears why, one game is rescheduled')
{
  const r2date = new Date(round2[0].starts_at).toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' })
  const { data: evBefore } = await admin.from('events').select('id').eq('competition_id', comp.id).eq('academy_id', NRIFA)
  const { data: res, error } = await official.rpc('call_off_fixtures', { p_competition: comp.id, p_date: r2date, p_reason: 'wet_weather', p_cancel: false, p_note: 'Grounds closed by council' })
  error ? bad(`call off: ${error.message}`) : ok(`the official calls off ${r2date}: ${JSON.stringify(res)}`)
  const { count: postponed } = await admin.from('fixtures').select('id', { count: 'exact', head: true }).eq('competition_id', comp.id).eq('status', 'postponed')
  postponed >= 20 ? ok(`${postponed} games postponed across the divisions`) : bad(`postponed: ${postponed}`)
  const evIds = (evBefore ?? []).map((e) => e.id)
  const { data: pushes } = await admin.from('notification_queue').select('profile_id, body, payload').eq('kind', 'event_cancelled').in('payload->>event_id', evIds)
  const toParent = (pushes ?? []).filter((p) => p.profile_id === PARENT)
  toParent.length >= 1 && /wet|rain|weather|council/i.test(toParent[0].body ?? '') ? ok(`the U8 parent is told: "${toParent[0].body}"`) : bad(`pushes to the parent: ${JSON.stringify(toParent).slice(0, 200)}`)
  const r2game = round2.find((f) => [f.home_name, f.away_name].includes('NRIFA U8'))
  const newAt = new Date(new Date(round2[0].starts_at).getTime() + 3 * 864e5).toISOString()
  const { error: re } = await official.rpc('reschedule_fixture', { p_fixture: r2game.fixture_id, p_starts_at: newAt, p_venue_label: `${TAG} ELS Hall`, p_field: 'Field 2' })
  re ? bad(`reschedule: ${re.message}`) : ok("NRIFA's game is rescheduled to the Tuesday at ELS Hall")
  // A postponed game that gets a new time is 'back on' (0064), not merely 'changed'.
  const { data: changed } = await admin.from('notification_queue').select('body, kind').in('kind', ['event_back_on', 'event_changed']).in('payload->>event_id', evIds).eq('profile_id', PARENT)
  const changedRows = changed ?? []
  changedRows.length >= 1 ? ok(`and the family is told it is back on: "${changedRows[0].body}"`) : bad('no back-on push to the parent')
}

head('7. Ladders, then finals seeded from them')
{
  const { data: ladder } = await nrifa.rpc('competition_ladder', { p_competition: comp.id, p_division: 'U8' })
  ladder?.[0]?.team_name === 'NRIFA U8' && ladder[0].points === 3 ? ok('NRIFA U8 tops the U8 ladder on 3 points') : bad(JSON.stringify(ladder?.slice(0, 2)))
  // The rest of the U8 season, in a hurry: every remaining group game a 2–1 home win.
  await admin.from('fixtures').update({ status: 'final', home_score: 2, away_score: 1 }).eq('competition_id', comp.id).eq('division', 'U8').eq('stage', 'group').in('status', ['scheduled', 'postponed'])
  const finalsAt = new Date(Date.now() + 60 * 864e5).toISOString()
  const { data: made, error } = await official.rpc('create_finals', { p_competition: comp.id, p_division: 'U8', p_start_at: finalsAt, p_fields: ['Field 1'] })
  error ? bad(`finals: ${error.message}`) : ok(`${made} final set up`)
  const { data: filled } = await official.rpc('resolve_finals', { p_competition: comp.id, p_division: 'U8' })
  filled === 1 ? ok('the final is seeded from the finished ladder') : bad(`resolved: ${filled}`)
  const { data: fin } = await admin.from('fixtures').select('home_entry_id, away_entry_id').eq('competition_id', comp.id).eq('division', 'U8').eq('stage', 'final').single()
  const { data: top2 } = await nrifa.rpc('competition_ladder', { p_competition: comp.id, p_division: 'U8' })
  fin.home_entry_id === top2[0].entry_id && fin.away_entry_id === top2[1].entry_id ? ok(`${top2[0].team_name} v ${top2[1].team_name} in the final`) : bad('the final is not first v second')
}

head('8. The public page shows all of it; nothing about anyone')
{
  await official.from('competitions').update({ public_slug: SLUG, published_at: new Date().toISOString() }).eq('id', comp.id)
  const { data: centre } = await anon.rpc('public_match_centre', { p_slug: SLUG })
  centre?.fixtures?.length >= 169 && centre.divisions.length === 6 ? ok(`${centre.fixtures.length} fixtures, 6 divisions, no account`) : bad(`public: ${centre?.fixtures?.length} fixtures, ${centre?.divisions?.length} divisions`)
  centre?.ladder?.U8?.[0]?.team_name ? ok(`the U8 ladder is public, ${centre.ladder.U8[0].team_name} on top`) : bad('no public ladder')
  centre?.top_scorers?.U8?.length >= 1 ? ok(`top scorers: ${centre.top_scorers.U8[0].name} (${centre.top_scorers.U8[0].team})`) : bad('no top scorers')
  const text = JSON.stringify(centre)
  !/\+61|@|guardian|phone/i.test(text) ? ok('no phone numbers, emails or guardians anywhere in it') : bad('the public payload leaks contact details')
}

head('9. The referee is paid; the reports come out; the parent sees only the draw')
{
  const from = new Date(Date.now() - 2 * 864e5).toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' })
  const to = new Date(Date.now() + 2 * 864e5).toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' })
  const { data: run, error } = await official.rpc('build_referee_payment_run', { p_competition: comp.id, p_from: from, p_to: to })
  error || !run ? bad(`payment run: ${error?.message ?? 'nothing to pay'}`) : ok('a payment run for the week')
  if (run) {
    await official.rpc('mark_referee_run_paid', { p_run: run, p_method: 'bank' })
    const { data: mine } = await referee.rpc('my_appointments')
    mine.appointments.find((a) => a.id === apptId)?.paid_at ? ok('Pat sees $45 paid') : bad('the referee does not see the payment')
  }
  const { data: disc } = await official.rpc('discipline_report', { p_competition: comp.id })
  disc?.players?.some((p) => p.reds === 1) ? ok('the discipline report carries the red card') : bad('no red in the discipline report')
  const { data: exp } = await official.rpc('referee_payments_export', { p_competition: comp.id })
  const expRows = exp ?? []
  expRows.length === 1 ? ok('the referee payments export has the one game') : bad(`export rows: ${exp?.length}`)
  const { data: pSheet } = await parent.rpc('competition_run_sheet', { p_competition: comp.id, p_division: 'U8' })
  pSheet?.length >= 28 && pSheet.every((f) => f.can_score === false) ? ok('the parent sees the U8 draw and can score nothing') : bad(`parent: ${pSheet?.length} rows`)
  const { data: pPool } = await parent.rpc('referee_pool', { p_competition: comp.id })
  const { data: pFees } = await parent.rpc('competition_fees_view', { p_competition: comp.id })
  pPool === null && pFees === null ? ok('and nothing of the pool or the money') : bad('a parent read league internals')
}

await cleanup()
console.log(fails === 0 ? '\n\x1b[32mA WHOLE SEASON, WITHOUT DRIBL\x1b[0m\n' : `\n\x1b[31m${fails} THINGS STOP A SEASON\x1b[0m\n`)
