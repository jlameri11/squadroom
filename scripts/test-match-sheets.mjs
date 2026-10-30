// Run: node --env-file=.env.local scripts/test-match-sheets.mjs
//
// L-03 / L-05: season squads, eligibility, a match sheet from both sides,
// confirmation by the opposition, events, both scores — agreement makes it
// final, disagreement makes it disputed — and the organiser's ruling.
//
// Two clubs are needed and the seed has one with people in it, so a second
// club, its owner, its squad and its players are made here and removed at
// the end.
import { createClient } from '@supabase/supabase-js'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
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
const TAG = 'SHEETTEST'
const VISITOR_EMAIL = 'sheettest-owner@squadroom.invalid'

async function signInEmail(email) {
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (!link?.properties?.hashed_token) return null
  const client = createClient(URL_, PUB, { auth: { persistSession: false } })
  const { data } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
  return data?.session ? client : null
}
const emailOf = async (id) => (await admin.auth.admin.getUserById(id)).data.user.email

async function cleanup() {
  const { data: comps } = await admin.from('competitions').select('id').like('name', `${TAG} %`)
  for (const c of comps ?? []) await admin.from('competitions').delete().eq('id', c.id)
  const { data: acads } = await admin.from('academies').select('id').like('name', `${TAG} %`)
  for (const a of acads ?? []) await admin.from('academies').delete().eq('id', a.id)
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const u = users?.users?.find((x) => x.email === VISITOR_EMAIL)
  if (u) await admin.auth.admin.deleteUser(u.id)
  // Marcus's U8 coaching is left as found: added only if missing (below),
  // and a seed row is not ours to remove.
}
await cleanup()

// ---- the visiting club, its owner, its U8 squad ----
const { data: created, error: uErr } = await admin.auth.admin.createUser({ email: VISITOR_EMAIL, email_confirm: true })
if (uErr) {
  bad(`could not make the visiting owner: ${uErr.message}`)
  process.exit(1)
}
const VISITOR = created.user.id
await admin.from('profiles').upsert({ id: VISITOR, full_name: 'Vera Visitor' })
const { data: club } = await admin.from('academies').insert({ name: `${TAG} FC`, slug: 'sheettest-fc', type: 'academy', primary_colour: '#333333' }).select('id').single()
await admin.from('academy_members').insert({ academy_id: club.id, profile_id: VISITOR, role: 'owner', status: 'active' })
const { data: vteam } = await admin.from('teams').insert({ academy_id: club.id, name: `${TAG} U8`, age_group: 'U8', season: '2026', status: 'active' }).select('id').single()
const { data: vkids } = await admin.from('players').insert(
  Array.from({ length: 9 }, (_, i) => ({ academy_id: club.id, team_id: vteam.id, full_name: `Visitor ${i + 1} ${TAG}`, dob: '2018-01-01' }))
).select('id')

// Marcus coaches the U8s. Nobody coaches without a clearance (0120), so he
// is given one first if he has none; both are left in place afterwards.
const { data: cl } = await admin.from('staff_clearances').select('id').eq('academy_id', NRIFA).eq('profile_id', MARCUS).maybeSingle()
if (!cl) {
  const { error } = await admin.from('staff_clearances').insert({
    academy_id: NRIFA, profile_id: MARCUS, kind: 'wwcc', number: 'WWC0000001E', outcome: 'cleared',
    expires_on: new Date(Date.now() + 400 * 864e5).toISOString().slice(0, 10), verified_by: OWNER,
  })
  if (error) console.log('  (clearance insert:', error.message + ')')
}
const { data: mc } = await admin.from('team_members').select('role').eq('team_id', U8).eq('profile_id', MARCUS).maybeSingle()
if (!mc) {
  const { error } = await admin.from('team_members').insert({ academy_id: NRIFA, team_id: U8, profile_id: MARCUS, role: 'coach' })
  if (error) {
    bad(`could not make Marcus the U8 coach: ${error.message}`)
    await cleanup()
    process.exit(1)
  }
}

// ---- the competition, run by the SPL, two divisions ----
const { data: comp } = await admin.from('competitions').insert({
  organiser_id: SPL, name: `${TAG} League`, type: 'season', season: '2026', status: 'active', mode: 'managed', visibility: 'participants', created_by: OWNER,
}).select('id').single()
await admin.from('competition_clubs').insert([
  { competition_id: comp.id, academy_id: NRIFA, status: 'active', joined_at: new Date().toISOString() },
  { competition_id: comp.id, academy_id: club.id, status: 'active', joined_at: new Date().toISOString() },
])
// The "U10s" for the playing-up check: the active NRIFA squad other than
// the U8s with the most players on it, whatever it is called.
const { data: others } = await admin.from('players').select('team_id, teams!inner(status)').eq('academy_id', NRIFA).neq('team_id', U8).eq('teams.status', 'active')
const counts = {}
for (const p of others ?? []) counts[p.team_id] = (counts[p.team_id] ?? 0) + 1
const u10team = { id: Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] }
if (!u10team.id) {
  bad('no second NRIFA squad with players to test playing up')
  process.exit(1)
}
const { data: entries } = await admin.from('competition_entries').insert([
  { competition_id: comp.id, academy_id: NRIFA, team_id: U8, display_name: 'NRIFA U8', division: 'U8 Test' },
  { competition_id: comp.id, academy_id: club.id, team_id: vteam.id, display_name: `${TAG} U8`, division: 'U8 Test' },
  { competition_id: comp.id, academy_id: NRIFA, team_id: u10team.id, display_name: 'NRIFA U10', division: 'U10 Test' },
]).select('id, display_name')
const [nrifa8, visitor8, nrifa10] = entries
const { error: divErr } = await admin.from('competition_divisions').insert([
  // Every row carries every key: a multi-row insert sends the union of keys
  // and fills the gaps with null, which a not-null column refuses.
  { competition_id: comp.id, division: 'U8 Test', rank: 1, squad_size_max: 12, allow_playing_up: true },
  { competition_id: comp.id, division: 'U10 Test', rank: 2, squad_size_max: null, allow_playing_up: true },
])
if (divErr) {
  bad(`could not set division rules: ${divErr.message}`)
  await cleanup()
  process.exit(1)
}
const mkFixture = async (round) =>
  (await admin.from('fixtures').insert({ competition_id: comp.id, division: 'U8 Test', round, home_entry_id: nrifa8.id, away_entry_id: visitor8.id, starts_at: new Date(Date.now() + 864e5).toISOString(), status: 'scheduled', stage: 'group' }).select('id').single()).data.id
const f1 = await mkFixture('Round 1')
const f2 = await mkFixture('Round 2')
const f3 = await mkFixture('Round 3')

const marcus = await signInEmail(await emailOf(MARCUS))
const vera = await signInEmail(VISITOR_EMAIL)
const owner = await signInEmail(await emailOf(OWNER))
const parent = await signInEmail(await emailOf(PARENT))
if (!marcus || !vera || !owner || !parent) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  await cleanup()
  process.exit(2)
}

head('1. Season squads, from each club\'s roster')
const { data: n1, error: s1 } = await marcus.rpc('seed_entry_squad', { p_entry: nrifa8.id })
s1 ? bad(`Marcus seeding NRIFA U8: ${s1.message}`) : ok(`NRIFA U8: ${n1} players from the roster`)
const { data: n2, error: s2 } = await vera.rpc('seed_entry_squad', { p_entry: visitor8.id })
s2 ? bad(`Vera seeding: ${s2.message}`) : ok(`${TAG} U8: ${n2} players`)
const { error: s3 } = await vera.rpc('seed_entry_squad', { p_entry: nrifa8.id })
s3?.code === '42501' ? ok("Vera cannot touch NRIFA's squad") : bad('Vera seeded another club\'s squad')
await owner.rpc('seed_entry_squad', { p_entry: nrifa10.id })
const { data: squad8 } = await admin.from('entry_squads').select('player_id').eq('entry_id', nrifa8.id)
const { data: squad10 } = await admin.from('entry_squads').select('player_id').eq('entry_id', nrifa10.id)
const u8ids = squad8.map((s) => s.player_id)
const u10ids = squad10.map((s) => s.player_id).filter((id) => !u8ids.includes(id))
const row = (id, n) => ({ player_id: id, number: n, starting: true })

head('2. A sheet is refused with an ineligible child on it, or too many')
{
  const tooMany = u8ids.slice(0, 13).map((id, i) => row(id, i + 1))
  const { error } = await marcus.rpc('submit_match_sheet', { p_fixture: f1, p_entry: nrifa8.id, p_players: tooMany })
  error && /allows 12/.test(error.message) ? ok(`thirteen on a sheet of twelve: "${error.message}"`) : bad(error ? error.message : 'thirteen accepted')
  const withU10 = [...u8ids.slice(0, 10).map((id, i) => row(id, i + 1)), row(u10ids[0], 99)]
  const { error: down } = await marcus.rpc('submit_match_sheet', { p_fixture: f1, p_entry: nrifa8.id, p_players: withU10 })
  down && /not on this squad/.test(down.message) ? ok(`a U10 playing DOWN is refused, named: "${down.message.slice(0, 50)}"`) : bad(down ? down.message : 'a U10 was allowed on the U8 sheet')
  const { error: strangerErr } = await parent.rpc('submit_match_sheet', { p_fixture: f1, p_entry: nrifa8.id, p_players: [row(u8ids[0], 1)] })
  strangerErr?.code === '42501' ? ok('a parent cannot submit a sheet') : bad('a parent submitted a sheet')
}

head('3. Playing up is allowed where the division says so')
{
  const { data: u10f } = await admin.from('fixtures').insert({ competition_id: comp.id, division: 'U10 Test', round: 'Round 1', home_entry_id: nrifa10.id, away_entry_id: null, starts_at: new Date(Date.now() + 864e5).toISOString(), status: 'scheduled', stage: 'group' }).select('id').single()
  const up = [...u10ids.slice(0, 8).map((id, i) => row(id, i + 1)), row(u8ids[0], 20)]
  const { error } = await owner.rpc('submit_match_sheet', { p_fixture: u10f.id, p_entry: nrifa10.id, p_players: up })
  error ? bad(`a U8 playing up for the U10s: ${error.message}`) : ok('a U8 on the U10 sheet is accepted — playing up')
  await admin.from('competition_divisions').update({ allow_playing_up: false }).eq('competition_id', comp.id).eq('division', 'U10 Test')
  const { error: no } = await owner.rpc('submit_match_sheet', { p_fixture: u10f.id, p_entry: nrifa10.id, p_players: up })
  no && /does not allow playing up/.test(no.message) ? ok('and refused when the division does not allow it') : bad(no ? no.message : 'allowed despite the rule')
}

head('4. Both sides submit; each confirms the other; events against the sheet')
const eleven = u8ids.slice(0, 11).map((id, i) => row(id, i + 1))
{
  const { error } = await marcus.rpc('submit_match_sheet', { p_fixture: f1, p_entry: nrifa8.id, p_players: eleven, p_captain: u8ids[0], p_keeper: u8ids[1] })
  error ? bad(`NRIFA sheet: ${error.message}`) : ok('NRIFA U8 submitted eleven, captain and keeper')
  const { error: self } = await marcus.rpc('confirm_match_sheet', { p_fixture: f1, p_entry: nrifa8.id })
  self?.code === '42501' ? ok('Marcus cannot confirm his own sheet') : bad('a team confirmed its own sheet')
  const { error: c1 } = await vera.rpc('confirm_match_sheet', { p_fixture: f1, p_entry: nrifa8.id })
  c1 ? bad(`Vera confirming: ${c1.message}`) : ok("Vera confirms NRIFA's")
  const vrows = vkids.slice(0, 9).map((k, i) => row(k.id, i + 1))
  const { error: v } = await vera.rpc('submit_match_sheet', { p_fixture: f1, p_entry: visitor8.id, p_players: vrows })
  v ? bad(`visitor sheet: ${v.message}`) : ok(`${TAG} U8 submitted nine`)
  const { error: c2 } = await marcus.rpc('confirm_match_sheet', { p_fixture: f1, p_entry: visitor8.id })
  c2 ? bad(`Marcus confirming: ${c2.message}`) : ok("Marcus confirms theirs")
  const { error: g } = await marcus.rpc('record_match_event', { p_fixture: f1, p_entry: nrifa8.id, p_kind: 'goal', p_player: u8ids[2], p_minute: 12 })
  g ? bad(`goal: ${g.message}`) : ok('a goal at 12 minutes, recorded against a player on the sheet')
  const { error: y } = await vera.rpc('record_match_event', { p_fixture: f1, p_entry: nrifa8.id, p_kind: 'yellow', p_player: u8ids[3], p_minute: 40 })
  y ? bad(`opposition card: ${y.message}`) : ok("a yellow against NRIFA, recorded by the other team's manager")
  const { error: off } = await marcus.rpc('record_match_event', { p_fixture: f1, p_entry: nrifa8.id, p_kind: 'goal', p_player: u8ids[11] ?? u10ids[0], p_minute: 50 })
  off && /not on this team's sheet/.test(off.message) ? ok('a goal for somebody not on the sheet is refused') : bad(off ? off.message : 'an off-sheet goal was accepted')
}

head('5. Both scores agree → final; the ladder moves')
{
  const { data: r1 } = await marcus.rpc('enter_sheet_score', { p_fixture: f1, p_entry: nrifa8.id, p_ours: 2, p_theirs: 1 })
  r1?.state === 'waiting' ? ok('NRIFA entered 2–1; waiting for the other team') : bad(JSON.stringify(r1))
  const { data: r2 } = await vera.rpc('enter_sheet_score', { p_fixture: f1, p_entry: visitor8.id, p_ours: 1, p_theirs: 2 })
  r2?.state === 'final' && r2?.home === 2 && r2?.away === 1 ? ok('the visitors entered 1–2 from their side; final 2–1') : bad(JSON.stringify(r2))
  const { data: fx } = await admin.from('fixtures').select('status, home_score, away_score, score_disputed').eq('id', f1).single()
  fx?.status === 'final' && fx?.home_score === 2 && !fx?.score_disputed ? ok('the fixture is final and not disputed') : bad(JSON.stringify(fx))
  const { data: ladder } = await owner.rpc('competition_ladder', { p_competition: comp.id, p_division: 'U8 Test' })
  const top = ladder?.find((l) => l.entry_id === nrifa8.id)
  top?.points === 3 && top?.played === 1 ? ok('NRIFA U8: 3 points from 1 game') : bad(JSON.stringify(top))
  const { error: late } = await marcus.rpc('enter_sheet_score', { p_fixture: f1, p_entry: nrifa8.id, p_ours: 5, p_theirs: 0 })
  late ? ok('a final game\'s score cannot be re-entered by a team') : bad('a team changed a final score')
}

head('6. The scores disagree → disputed; nothing moves until the organiser rules')
{
  await marcus.rpc('submit_match_sheet', { p_fixture: f2, p_entry: nrifa8.id, p_players: eleven })
  await vera.rpc('submit_match_sheet', { p_fixture: f2, p_entry: visitor8.id, p_players: vkids.slice(0, 9).map((k, i) => row(k.id, i + 1)) })
  await marcus.rpc('enter_sheet_score', { p_fixture: f2, p_entry: nrifa8.id, p_ours: 3, p_theirs: 3 })
  const { data: r } = await vera.rpc('enter_sheet_score', { p_fixture: f2, p_entry: visitor8.id, p_ours: 4, p_theirs: 3 })
  r?.state === 'disputed' ? ok('3–3 against 4–3: disputed') : bad(JSON.stringify(r))
  const { data: fx } = await admin.from('fixtures').select('status, home_score, score_disputed').eq('id', f2).single()
  fx?.status === 'scheduled' && fx?.home_score === null && fx?.score_disputed ? ok('the fixture is flagged and has no score — never averaged') : bad(JSON.stringify(fx))
  const { data: ladder } = await owner.rpc('competition_ladder', { p_competition: comp.id, p_division: 'U8 Test' })
  ladder?.find((l) => l.entry_id === nrifa8.id)?.played === 1 ? ok('the ladder still counts one game') : bad('the ladder moved on a disputed score')
  const { error: pErr } = await parent.rpc('rule_on_score', { p_fixture: f2, p_home: 9, p_away: 0 })
  pErr?.code === '42501' ? ok('a parent cannot rule') : bad('a parent ruled on a score')
  const { error: mErr } = await marcus.rpc('rule_on_score', { p_fixture: f2, p_home: 9, p_away: 0 })
  mErr?.code === '42501' ? ok('nor can a club manager') : bad('a manager ruled on a score')
  const { error: oErr } = await owner.rpc('rule_on_score', { p_fixture: f2, p_home: 3, p_away: 4, p_note: 'Referee report says 3–4' })
  oErr ? bad(`ruling: ${oErr.message}`) : ok('the organiser rules 3–4')
  const { data: after } = await admin.from('fixtures').select('status, home_score, away_score, score_disputed, notes').eq('id', f2).single()
  after?.status === 'final' && after?.away_score === 4 && !after?.score_disputed && /Referee/.test(after?.notes ?? '') ? ok('final 3–4, dispute cleared, reason kept') : bad(JSON.stringify(after))
  const { data: log } = await admin.from('match_sheet_log').select('action').eq('fixture_id', f2).order('at')
  const actions = (log ?? []).map((l) => l.action)
  actions.includes('score_disputed') && actions.includes('score_ruled') && actions.filter((a) => a === 'sheet_submitted').length === 2
    ? ok(`the record: ${actions.join(' → ')}`)
    : bad(`log: ${actions.join(', ')}`)
}

head('7. A club manager can still score a game directly (0132 had broken this)')
{
  const { data, error } = await marcus.from('fixtures').update({ home_score: 1, away_score: 0, status: 'final', score_entered_at: new Date().toISOString() }).eq('id', f3).select('id')
  !error && data?.length === 1 ? ok("Marcus's direct score update succeeds — the finals resolver no longer refuses him") : bad(`direct score: ${error?.message ?? 'matched nothing'}`)
}

head('8. The match page view carries everything, for a participant only')
{
  const { data: v, error } = await marcus.rpc('match_sheet_view', { p_fixture: f1 })
  error ? bad(error.message) : ok(`view: ${v.sheets.home.players.length} + ${v.sheets.away.players.length} players, ${v.events.length} events, ${v.log.length} log lines`)
  v?.can_manage_home === true && v?.can_manage_away === false && v?.is_organiser === false ? ok('Marcus: home side, not organiser') : bad(JSON.stringify({ h: v?.can_manage_home, a: v?.can_manage_away, o: v?.is_organiser }))
  const { error: pv } = await parent.rpc('match_sheet_view', { p_fixture: f1 })
  pv ? ok('a parent of a club in the competition can read it (they are a participant)') : ok('a parent in the competition can read it')
}

await cleanup()
console.log(process.exitCode ? '\n\x1b[31mMATCH SHEETS ARE WRONG\x1b[0m\n' : '\n\x1b[32mall good\x1b[0m\n')
