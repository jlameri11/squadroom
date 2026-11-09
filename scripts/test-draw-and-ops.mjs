// Run: node --env-file=.env.local scripts/test-draw-and-ops.mjs
//
// L-23, L-24, L-26 (0189): a draw is checked before it goes out and a field
// closure's impact is known before it is closed; a game moved by hand is
// pinned and a rebuild draws around it; inside the fixture-flowing window a
// home club's agreed move is done without the league; and the league's
// match-day list says what is outstanding.
import { createClient } from '@supabase/supabase-js'
import { signInClient } from './_auth.mjs'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`)
  process.exitCode = 1
}
const head = (m) => console.log(`\n${m}`)

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const SPL = '00000000-0000-0000-0000-0000000a0003'
const OWNER = '00000000-0000-0000-0000-0000000000a1'
const MARCUS = '00000000-0000-0000-0000-0000000000a2'
const PARENT = '00000000-0000-0000-0000-0000000000b1'
const U8 = '00000000-0000-0000-0000-0000000d0008'
const TAG = 'DRAWOPS'
const VISITOR_EMAIL = 'drawops-owner@squadroom.invalid'

const signInEmail = (email) => signInClient(admin, email)
const emailOf = async (id) => (await admin.auth.admin.getUserById(id)).data.user.email
const hours = (n) => new Date(Date.now() + n * 3600_000).toISOString()
const sydneyDay = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' })

async function cleanup() {
  const { data: comps } = await admin.from('competitions').select('id').like('name', `${TAG} %`)
  for (const c of comps ?? []) {
    await admin.from('notification_queue').delete().like('url', `/competitions/${c.id}%`)
    await admin.from('competitions').delete().eq('id', c.id)
  }
  const { data: acads } = await admin.from('academies').select('id').like('name', `${TAG} %`)
  for (const a of acads ?? []) await admin.from('academies').delete().eq('id', a.id)
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const u = users?.users?.find((x) => x.email === VISITOR_EMAIL)
  if (u) await admin.auth.admin.deleteUser(u.id)
}
await cleanup()

// ---- a visiting club with a manager; the league's competition ----
const { data: created } = await admin.auth.admin.createUser({ email: VISITOR_EMAIL, email_confirm: true })
const VISITOR = created.user.id
await admin.from('profiles').upsert({ id: VISITOR, full_name: 'Vera Visitor' })
const { data: club } = await admin.from('academies').insert({ two_step_required: false, name: `${TAG} FC`, slug: 'drawops-fc', type: 'academy', primary_colour: '#333333' }).select('id').single()
await admin.from('academy_members').insert({ academy_id: club.id, profile_id: VISITOR, role: 'owner', status: 'active' })
const { data: vteam } = await admin.from('teams').insert({ academy_id: club.id, name: `${TAG} U8`, age_group: 'U8', season: '2026', status: 'active' }).select('id').single()

// The seed has no clearance for Marcus and the RLS suite relies on that: one
// is recorded only if missing and removed at the end.
const { data: cl } = await admin.from('staff_clearances').select('id').eq('academy_id', NRIFA).eq('profile_id', MARCUS).maybeSingle()
let addedClearance = false
if (!cl) {
  addedClearance = true
  await admin.from('staff_clearances').insert({ academy_id: NRIFA, profile_id: MARCUS, kind: 'wwcc', number: 'WWC0000001E', outcome: 'cleared', expires_on: new Date(Date.now() + 400 * 864e5).toISOString().slice(0, 10), verified_by: OWNER })
}
const { data: mc } = await admin.from('team_members').select('role').eq('team_id', U8).eq('profile_id', MARCUS).maybeSingle()
if (!mc) await admin.from('team_members').insert({ academy_id: NRIFA, team_id: U8, profile_id: MARCUS, role: 'coach' })

const { data: comp } = await admin.from('competitions').insert({
  organiser_id: SPL, name: `${TAG} League`, type: 'season', season: '2026', status: 'active', mode: 'managed', visibility: 'participants', created_by: OWNER,
}).select('id').single()
await admin.from('competition_clubs').insert([
  { competition_id: comp.id, academy_id: NRIFA, status: 'active', joined_at: new Date().toISOString() },
  { competition_id: comp.id, academy_id: club.id, status: 'active', joined_at: new Date().toISOString() },
])
const { data: others } = await admin.from('players').select('team_id, teams!inner(status)').eq('academy_id', NRIFA).neq('team_id', U8).eq('teams.status', 'active')
const counts = {}
for (const p of others ?? []) counts[p.team_id] = (counts[p.team_id] ?? 0) + 1
const u10team = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0]
const { data: entries } = await admin.from('competition_entries').insert([
  { competition_id: comp.id, academy_id: NRIFA, team_id: U8, display_name: 'NRIFA U8', division: 'Flow' },
  { competition_id: comp.id, academy_id: club.id, team_id: vteam.id, display_name: `${TAG} U8`, division: 'Flow' },
  { competition_id: comp.id, academy_id: null, team_id: null, display_name: 'Name A', division: 'Flow' },
  { competition_id: comp.id, academy_id: null, team_id: null, display_name: 'Name B', division: 'Flow' },
  { competition_id: comp.id, academy_id: NRIFA, team_id: u10team, display_name: 'NRIFA U10', division: 'Other' },
  { competition_id: comp.id, academy_id: null, team_id: null, display_name: 'Name C', division: 'Other' },
]).select('id, display_name')
const nrifa8 = entries.find((e) => e.display_name === 'NRIFA U8')
const visitor8 = entries.find((e) => e.display_name === `${TAG} U8`)
const nameA = entries.find((e) => e.display_name === 'Name A')
const nrifa10 = entries.find((e) => e.display_name === 'NRIFA U10')
const nameC = entries.find((e) => e.display_name === 'Name C')

const owner = await signInEmail(await emailOf(OWNER))
const marcus = await signInEmail(await emailOf(MARCUS))
const vera = await signInEmail(VISITOR_EMAIL)
const parent = await signInEmail(await emailOf(PARENT))
if (!owner || !marcus || !vera || !parent) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  await cleanup()
  process.exit(2)
}
// Five days out, so round one is inside the ops window — at 9am Sydney, so a
// game three hours later is still the same day (it was not, run at 10pm).
const startAt = new Date(new Date(Date.now() + 5 * 864e5).toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' }) + 'T09:00:00+11:00').toISOString()

head('1. L-24: the draw read back the way an organiser checks it')
{
  const { data: n, error } = await owner.rpc('generate_fixtures', { p_competition: comp.id, p_division: 'Flow', p_start_at: startAt, p_game_mins: 40, p_gap_mins: 10, p_fields: ['Field 1', 'Field 2'], p_venue_label: `${TAG} Park`, p_round_every_days: 7 })
  error ? bad(`draw: ${error.message}`) : ok(`four teams drawn: ${n} games over three Saturdays`)
  const { data: q, error: qe } = await owner.rpc('draw_quality', { p_competition: comp.id, p_division: 'Flow' })
  if (qe || !q) bad(`draw_quality: ${qe?.message}`)
  else {
    q.games === 6 && q.pairs.min === 1 && q.pairs.max === 1 && q.pairs.uneven.length === 0 ? ok('every pair meets exactly once') : bad(JSON.stringify(q.pairs))
    q.teams.length === 4 && q.teams.every((t) => t.games === 3) ? ok('every team has three games') : bad(JSON.stringify(q.teams))
    q.club_clashes.length === 0 && q.double_headers.length === 0 && q.travel.length === 0 && q.empty_slots.length === 0 ? ok('no clashes, double headers, travel or empty slots') : bad(JSON.stringify(q))
  }
  const { data: pq } = await parent.rpc('draw_quality', { p_competition: comp.id, p_division: 'Flow' })
  pq === null ? ok('a parent gets nothing') : bad('a parent read the draw check')

  // A clash the organiser would miss: the U10s drawn at the same moment as the U8s, another division.
  const { data: r1 } = await admin.from('fixtures').select('id, starts_at, home_entry_id, away_entry_id').eq('competition_id', comp.id).eq('division', 'Flow').order('starts_at').limit(2)
  const u8game = r1.find((f) => f.home_entry_id === nrifa8.id || f.away_entry_id === nrifa8.id) ?? r1[0]
  const { data: clash } = await admin.from('fixtures').insert({ competition_id: comp.id, division: 'Other', round: 'Round 1', home_entry_id: nrifa10.id, away_entry_id: nameC.id, starts_at: u8game.starts_at, status: 'scheduled', stage: 'group', venue_label: `${TAG} Park`, field_label: 'Field 3' }).select('id').single()
  const { data: q2 } = await owner.rpc('draw_quality', { p_competition: comp.id, p_division: 'Flow' })
  q2?.club_clashes?.length === 1 && /NRIFA/.test(q2.club_clashes[0].club) ? ok(`a club with two teams on at once is flagged: ${q2.club_clashes[0].club}`) : bad(JSON.stringify(q2?.club_clashes))
  await admin.from('fixtures').delete().eq('id', clash.id)
  // A double header and an uneven pair, by hand.
  const { data: extra } = await admin.from('fixtures').insert({ competition_id: comp.id, division: 'Flow', round: 'Extra', home_entry_id: nrifa8.id, away_entry_id: nameA.id, starts_at: new Date(new Date(u8game.starts_at).getTime() + 3 * 3600_000).toISOString(), status: 'scheduled', stage: 'group', venue_label: 'Elsewhere Oval', field_label: 'Field 1' }).select('id').single()
  const { data: q3 } = await owner.rpc('draw_quality', { p_competition: comp.id, p_division: 'Flow' })
  q3?.double_headers?.some((d) => d.team === 'NRIFA U8') ? ok('a team with two games in a day is flagged') : bad(JSON.stringify(q3?.double_headers))
  q3?.pairs?.uneven?.length >= 1 ? ok(`an uneven pair is named: ${q3.pairs.uneven.map((u) => `${u.a} v ${u.b} ${u.games}×`).join(', ')}`) : bad(JSON.stringify(q3?.pairs))
  q3?.travel?.some((t) => t.team === 'NRIFA U8') ? ok('and a team at two grounds in a day') : bad(JSON.stringify(q3?.travel))
  await admin.from('fixtures').delete().eq('id', extra.id)

  const { data: hit, error: he } = await owner.rpc('field_impact', { p_competition: comp.id, p_date: sydneyDay(u8game.starts_at), p_field: 'Field 1' })
  he ? bad(`field_impact: ${he.message}`) : hit?.length === 1 ? ok(`closing Field 1 that day hits one game: ${hit[0].home} v ${hit[0].away}`) : bad(`impact: ${JSON.stringify(hit)}`)
  const { data: phit } = await parent.rpc('field_impact', { p_competition: comp.id, p_date: sydneyDay(u8game.starts_at) })
  phit === null ? ok('a parent gets nothing there either') : bad('a parent read the field impact')
}

head('2. L-24: a game moved by hand is pinned, and a rebuild keeps it')
{
  const { data: first } = await admin.from('fixtures').select('id, starts_at, home_entry_id, away_entry_id').eq('competition_id', comp.id).eq('division', 'Flow').order('starts_at').limit(1).single()
  const movedTo = new Date(new Date(first.starts_at).getTime() + 26 * 3600_000).toISOString()
  const { error } = await owner.rpc('reschedule_fixture', { p_fixture: first.id, p_starts_at: movedTo, p_venue_label: 'Moved Park', p_field: 'Field 9' })
  error ? bad(`reschedule: ${error.message}`) : ok('the league moves the first game to the next day by hand')
  const { data: pinned } = await admin.from('fixtures').select('pinned').eq('id', first.id).single()
  pinned?.pinned === true ? ok('it is pinned') : bad('not pinned')
  const { data: n, error: re } = await owner.rpc('generate_fixtures', { p_competition: comp.id, p_division: 'Flow', p_start_at: startAt, p_game_mins: 40, p_gap_mins: 10, p_fields: ['Field 1', 'Field 2'], p_venue_label: `${TAG} Park`, p_replace: true, p_round_every_days: 7 })
  re ? bad(`rebuild: ${re.message}`) : ok(`the draw is rebuilt: ${n} games placed around it`)
  const { data: still } = await admin.from('fixtures').select('starts_at, venue_label').eq('id', first.id).maybeSingle()
  still && new Date(still.starts_at).getTime() === new Date(movedTo).getTime() && still.venue_label === 'Moved Park' ? ok('the moved game is still where the league put it') : bad(JSON.stringify(still))
  const { count } = await admin.from('fixtures').select('id', { count: 'exact', head: true }).eq('competition_id', comp.id).eq('division', 'Flow')
  count === 6 ? ok('and the division still has six games — the pair was not drawn twice') : bad(`${count} games`)
  const { count: dup } = await admin.from('fixtures').select('id', { count: 'exact', head: true }).eq('competition_id', comp.id).eq('division', 'Flow').or(`and(home_entry_id.eq.${first.home_entry_id},away_entry_id.eq.${first.away_entry_id}),and(home_entry_id.eq.${first.away_entry_id},away_entry_id.eq.${first.home_entry_id})`)
  dup === 1 ? ok('that pairing exists exactly once') : bad(`that pairing exists ${dup} times`)
  const { data: q } = await owner.rpc('draw_quality', { p_competition: comp.id, p_division: 'Flow' })
  q?.pinned === 1 ? ok('the check says one game is kept by hand') : bad(JSON.stringify(q?.pinned))
}

head('3. L-23: fixture flowing — a home club\'s agreed move is done without the league')
{
  const { error: pe } = await parent.rpc('set_fixture_flowing', { p_competition: comp.id, p_until: hours(7 * 24), p_days: 3 })
  pe?.code === '42501' ? ok('a parent cannot open the window') : bad('a parent opened fixture flowing')
  const { error } = await owner.rpc('set_fixture_flowing', { p_competition: comp.id, p_until: hours(7 * 24), p_days: 3 })
  error ? bad(`open: ${error.message}`) : ok('the league opens flowing for a week, three days either side')
  const { data: told } = await admin.from('notification_queue').select('profile_id').eq('kind', 'fixture_flowing_open').like('url', `/competitions/${comp.id}%`)
  told?.some((t) => t.profile_id === MARCUS) && told?.some((t) => t.profile_id === VISITOR) ? ok('both clubs\' managers are told') : bad(JSON.stringify(told))

  // The one game between the two clubs with managers; NRIFA at home.
  const { data: game } = await admin.from('fixtures').select('id, starts_at').eq('competition_id', comp.id).eq('division', 'Flow').or(`and(home_entry_id.eq.${nrifa8.id},away_entry_id.eq.${visitor8.id}),and(home_entry_id.eq.${visitor8.id},away_entry_id.eq.${nrifa8.id})`).single()
  await admin.from('fixtures').update({ home_entry_id: nrifa8.id, away_entry_id: visitor8.id, pinned: false }).eq('id', game.id)
  const dayLater = new Date(new Date(game.starts_at).getTime() + 24 * 3600_000).toISOString()
  const { data: req, error: pr } = await marcus.rpc('propose_fixture_change', { p_fixture: game.id, p_reason: 'ground booked for a fete', p_starts_at: dayLater, p_venue: 'Flow Field' })
  pr ? bad(`propose: ${pr.message}`) : ok('the home club proposes the next day')
  const { error: ag } = await vera.rpc('answer_fixture_change', { p_request: req, p_agree: true, p_note: 'fine by us' })
  ag ? bad(`agree: ${ag.message}`) : ok('the away club agrees')
  const { data: r } = await admin.from('fixture_change_requests').select('status, decision_note, decided_by').eq('id', req).single()
  r?.status === 'approved' && /flowing/.test(r.decision_note ?? '') && r.decided_by === null ? ok(`done on the spot: "${r.decision_note}"`) : bad(JSON.stringify(r))
  const { data: fx } = await admin.from('fixtures').select('starts_at, venue_label, pinned').eq('id', game.id).single()
  fx && new Date(fx.starts_at).getTime() === new Date(dayLater).getTime() && fx.venue_label === 'Flow Field' && fx.pinned ? ok('the game moved, and is pinned') : bad(JSON.stringify(fx))
  const { data: lp } = await admin.from('notification_queue').select('title').eq('profile_id', OWNER).eq('kind', 'fixture_change_decided').filter('payload->>request_id', 'eq', req).maybeSingle()
  lp ? ok(`the league is told: "${lp.title}"`) : bad('the league was not told')

  // The away club proposing: the league still decides.
  const { data: req2 } = await vera.rpc('propose_fixture_change', { p_fixture: game.id, p_reason: 'bus timetable', p_starts_at: new Date(new Date(dayLater).getTime() + 3600_000).toISOString() })
  await marcus.rpc('answer_fixture_change', { p_request: req2, p_agree: true })
  const { data: r2 } = await admin.from('fixture_change_requests').select('status').eq('id', req2).single()
  r2?.status === 'agreed' ? ok('an away club\'s proposal, agreed, still waits for the league') : bad(`away proposal: ${r2?.status}`)
  await owner.rpc('decide_fixture_change', { p_request: req2, p_approve: false, p_note: 'no' })
  // Too far from the drawn time: the league still decides.
  const { data: req3 } = await marcus.rpc('propose_fixture_change', { p_fixture: game.id, p_reason: 'holiday', p_starts_at: new Date(new Date(dayLater).getTime() + 10 * 86400_000).toISOString() })
  await vera.rpc('answer_fixture_change', { p_request: req3, p_agree: true })
  const { data: r3 } = await admin.from('fixture_change_requests').select('status').eq('id', req3).single()
  r3?.status === 'agreed' ? ok('a move ten days away is outside the window — the league decides') : bad(`far move: ${r3?.status}`)
  await owner.rpc('decide_fixture_change', { p_request: req3, p_approve: false, p_note: 'no' })
  // Window closed: the league decides.
  await owner.rpc('set_fixture_flowing', { p_competition: comp.id, p_until: null })
  const { data: req4 } = await marcus.rpc('propose_fixture_change', { p_fixture: game.id, p_reason: 'rain', p_starts_at: new Date(new Date(dayLater).getTime() + 2 * 3600_000).toISOString() })
  await vera.rpc('answer_fixture_change', { p_request: req4, p_agree: true })
  const { data: r4 } = await admin.from('fixture_change_requests').select('status').eq('id', req4).single()
  r4?.status === 'agreed' ? ok('with the window closed, an agreed move waits for the league (0174 as before)') : bad(`closed window: ${r4?.status}`)
}

head('4. L-26: the league\'s match-day list')
{
  const { data: fxs } = await admin.from('fixtures').select('id').eq('competition_id', comp.id).eq('division', 'Flow').order('starts_at').limit(6)
  // One game kicked off four hours ago with no sheets and nobody ended it.
  await admin.from('fixtures').update({ starts_at: hours(-4) }).eq('id', fxs[5].id)
  const { data: ops, error } = await owner.rpc('match_day_ops', { p_competition: comp.id })
  if (error || !ops) bad(`match_day_ops: ${error?.message}`)
  else {
    ops.missing_sheets.some((g) => g.fixture_id === fxs[5].id && g.sheets === 0) ? ok('the game played with no sheets is listed') : bad(JSON.stringify(ops.missing_sheets))
    ops.not_ended.some((g) => g.fixture_id === fxs[5].id) ? ok('and as not ended') : bad(JSON.stringify(ops.not_ended))
    ops.unfilled.length >= 1 ? ok(`${ops.unfilled.length} games this week have no referee`) : bad('no unfilled games listed')
    ops.change_requests === 1 ? ok('one change request is waiting') : bad(`change requests: ${ops.change_requests}`)
    Array.isArray(ops.corrections) && Array.isArray(ops.suspensions) ? ok('corrections and suspensions are lists, empty here') : bad('shape')
  }
  const { data: pops } = await parent.rpc('match_day_ops', { p_competition: comp.id })
  pops === null ? ok('a parent gets nothing') : bad('a parent read the ops list')
  const { data: vops } = await vera.rpc('match_day_ops', { p_competition: comp.id })
  vops === null ? ok('a club manager gets nothing either — it is the league\'s') : bad('a club read the ops list')
}

await cleanup()
if (addedClearance) await admin.from('staff_clearances').delete().eq('academy_id', NRIFA).eq('profile_id', MARCUS).eq('number', 'WWC0000001E')
console.log(process.exitCode ? '\n\x1b[31mTHE DRAW OR THE OPS ARE WRONG\x1b[0m\n' : '\n\x1b[32mall good\x1b[0m\n')
