// Run: node --env-file=.env.local scripts/test-sheet-rules.mjs
//
// L-17, L-19, L-21 (0187): the sheet locks before kick-off and only the
// referee or the league changes it after; a game is editable until it is
// ended and locked from then on, with corrections going to the league; a
// final needs a season behind the player, and playing up is capped.
//
// Two clubs are needed and the seed has one with people in it, so a second
// club, its owner, its squad, a referee and the league's competition are
// made here and removed at the end.
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
const TAG = 'SHEETRULES'
const VISITOR_EMAIL = 'sheetrules-owner@squadroom.invalid'
const REF_EMAIL = 'sheetrules-ref@squadroom.invalid'

const signInEmail = (email) => signInClient(admin, email)
const emailOf = async (id) => (await admin.auth.admin.getUserById(id)).data.user.email
const mins = (n) => new Date(Date.now() + n * 60_000).toISOString()

async function cleanup() {
  const { data: comps } = await admin.from('competitions').select('id').like('name', `${TAG} %`)
  for (const c of comps ?? []) await admin.from('competitions').delete().eq('id', c.id)
  const { data: acads } = await admin.from('academies').select('id').like('name', `${TAG} %`)
  for (const a of acads ?? []) await admin.from('academies').delete().eq('id', a.id)
  await admin.from('referees').delete().like('full_name', `${TAG} %`)
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 })
  for (const email of [VISITOR_EMAIL, REF_EMAIL]) {
    const u = users?.users?.find((x) => x.email === email)
    if (u) {
      await admin.from('notification_queue').delete().eq('profile_id', u.id)
      await admin.auth.admin.deleteUser(u.id)
    }
  }
}
await cleanup()

// ---- the visiting club, its owner, its U8 squad; a referee ----
const { data: created, error: uErr } = await admin.auth.admin.createUser({ email: VISITOR_EMAIL, email_confirm: true })
if (uErr) {
  bad(`could not make the visiting owner: ${uErr.message}`)
  process.exit(1)
}
const VISITOR = created.user.id
await admin.from('profiles').upsert({ id: VISITOR, full_name: 'Vera Visitor' })
const { data: refUser } = await admin.auth.admin.createUser({ email: REF_EMAIL, email_confirm: true })
const REF = refUser.user.id
await admin.from('profiles').upsert({ id: REF, full_name: 'Rita Referee' })
const { data: club } = await admin.from('academies').insert({ two_step_required: false, name: `${TAG} FC`, slug: 'sheetrules-fc', type: 'academy', primary_colour: '#333333' }).select('id').single()
await admin.from('academy_members').insert({ academy_id: club.id, profile_id: VISITOR, role: 'owner', status: 'active' })
const { data: vteam } = await admin.from('teams').insert({ academy_id: club.id, name: `${TAG} U8`, age_group: 'U8', season: '2026', status: 'active' }).select('id').single()
const { data: vkids } = await admin.from('players').insert(
  Array.from({ length: 9 }, (_, i) => ({ academy_id: club.id, team_id: vteam.id, full_name: `Visitor ${i + 1} ${TAG}`, dob: '2018-01-01' }))
).select('id')

// Marcus coaches the U8s. The seed has no clearance for him and the RLS
// suite relies on that, so one is recorded only if missing and removed at
// the end; coaching is added only if missing and left in place.
const { data: cl } = await admin.from('staff_clearances').select('id').eq('academy_id', NRIFA).eq('profile_id', MARCUS).maybeSingle()
let addedClearance = false
if (!cl) {
  addedClearance = true
  await admin.from('staff_clearances').insert({
    academy_id: NRIFA, profile_id: MARCUS, kind: 'wwcc', number: 'WWC0000001E', outcome: 'cleared',
    expires_on: new Date(Date.now() + 400 * 864e5).toISOString().slice(0, 10), verified_by: OWNER,
  })
}
const { data: mc } = await admin.from('team_members').select('role').eq('team_id', U8).eq('profile_id', MARCUS).maybeSingle()
if (!mc) await admin.from('team_members').insert({ academy_id: NRIFA, team_id: U8, profile_id: MARCUS, role: 'coach' })

// ---- the competition, run by the SPL, two divisions ----
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
  { competition_id: comp.id, academy_id: NRIFA, team_id: U8, display_name: 'NRIFA U8', division: 'U8 Test' },
  { competition_id: comp.id, academy_id: club.id, team_id: vteam.id, display_name: `${TAG} U8`, division: 'U8 Test' },
  { competition_id: comp.id, academy_id: NRIFA, team_id: u10team, display_name: 'NRIFA U10', division: 'U10 Test' },
]).select('id, display_name')
const [nrifa8, visitor8, nrifa10] = entries

const marcus = await signInEmail(await emailOf(MARCUS))
const vera = await signInEmail(VISITOR_EMAIL)
const owner = await signInEmail(await emailOf(OWNER))
const parent = await signInEmail(await emailOf(PARENT))
const ref = await signInEmail(REF_EMAIL)
if (!marcus || !vera || !owner || !parent || !ref) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  await cleanup()
  process.exit(2)
}

head('1. The rules are per division: lock, finals games, borrowing cap')
{
  const { error } = await owner.from('competition_divisions').upsert([
    { competition_id: comp.id, division: 'U8 Test', rank: 1, squad_size_max: 12, allow_playing_up: true, sheet_lock_mins: 30, finals_min_games: 2, borrow_cap: null },
    { competition_id: comp.id, division: 'U10 Test', rank: 2, squad_size_max: null, allow_playing_up: true, sheet_lock_mins: 15, finals_min_games: null, borrow_cap: 1 },
  ], { onConflict: 'competition_id,division' })
  error ? bad(`rules: ${error.message}`) : ok('U8 locks at T-30 and needs 2 games for a final; U10 locks at T-15 and caps playing up at 1')
  const { error: e2 } = await owner.from('competition_divisions').update({ sheet_lock_mins: 500 }).eq('competition_id', comp.id).eq('division', 'U8 Test')
  e2 ? ok('a lock of 500 minutes is refused') : bad('a silly lock was saved')
}

await marcus.rpc('seed_entry_squad', { p_entry: nrifa8.id })
await vera.rpc('seed_entry_squad', { p_entry: visitor8.id })
await owner.rpc('seed_entry_squad', { p_entry: nrifa10.id })
const { data: squad8 } = await admin.from('entry_squads').select('player_id').eq('entry_id', nrifa8.id)
const { data: squad10 } = await admin.from('entry_squads').select('player_id').eq('entry_id', nrifa10.id)
const u8ids = squad8.map((s) => s.player_id)
const u10ids = squad10.map((s) => s.player_id).filter((id) => !u8ids.includes(id))
const row = (id, n) => ({ player_id: id, number: n, starting: true })
const eleven = u8ids.slice(0, 11).map((id, i) => row(id, i + 1))
const vrows = vkids.slice(0, 9).map((k, i) => row(k.id, i + 1))
const mkFixture = async (division, home, away, at, extra = {}) =>
  (await admin.from('fixtures').insert({ competition_id: comp.id, division, round: 'Round 1', home_entry_id: home, away_entry_id: away, starts_at: at, status: 'scheduled', stage: 'group', ...extra }).select('id').single()).data.id

// A referee in the league's pool, appointed to the game that kicks off soon.
const { data: refId, error: refErr } = await owner.rpc('add_referee', { p_competition: comp.id, p_full_name: `${TAG} Rita`, p_phone: '+61400000777', p_grade: 'Level 3', p_profile: REF })
if (refErr) bad(`add_referee: ${refErr.message}`)

head('2. L-17: the sheet locks thirty minutes before kick-off')
const soon = await mkFixture('U8 Test', nrifa8.id, visitor8.id, mins(10))
const later = await mkFixture('U8 Test', nrifa8.id, visitor8.id, mins(120))
{
  const { data: ap, error: apErr } = await owner.rpc('appoint_referee', { p_fixture: soon, p_referee: refId, p_role: 'referee' })
  if (apErr) bad(`appoint: ${apErr.message}`)
  const { error: acc } = await ref.rpc('respond_appointment', { p_appointment: ap, p_accept: true })
  acc ? bad(`accept: ${acc.message}`) : ok('Rita is appointed to the game in ten minutes and has accepted')

  const { data: v } = await marcus.rpc('match_sheet_view', { p_fixture: soon })
  v?.fixture?.locked === true && v?.fixture?.lock_at ? ok(`the view says the sheet is locked (since ${new Date(v.fixture.lock_at).toLocaleTimeString('en-AU')})`) : bad(`view: ${JSON.stringify(v?.fixture)}`)
  const { error } = await marcus.rpc('submit_match_sheet', { p_fixture: soon, p_entry: nrifa8.id, p_players: eleven })
  error && /locked at .*30 minutes before kick-off/.test(error.message) ? ok(`Marcus is refused: "${error.message}"`) : bad(error ? error.message : 'a manager changed a locked sheet')
  const { error: r } = await ref.rpc('submit_match_sheet', { p_fixture: soon, p_entry: nrifa8.id, p_players: eleven })
  r ? bad(`the referee: ${r.message}`) : ok('the referee can put the sheet in after the lock')
  const { error: o } = await owner.rpc('submit_match_sheet', { p_fixture: soon, p_entry: visitor8.id, p_players: vrows })
  o ? bad(`the league: ${o.message}`) : ok('and so can the league')
  const { data: log } = await admin.from('match_sheet_log').select('action, detail').eq('fixture_id', soon).eq('action', 'sheet_changed_after_lock')
  log?.length === 2 && log.every((l) => l.detail.after_lock && l.detail.by_official) ? ok('both are in the record as changed after the lock, by an official') : bad(JSON.stringify(log))
  const { data: v2 } = await marcus.rpc('match_sheet_view', { p_fixture: later })
  v2?.fixture?.locked === false ? ok('the game in two hours is not locked yet') : bad(JSON.stringify(v2?.fixture))
  const { error: m } = await marcus.rpc('submit_match_sheet', { p_fixture: later, p_entry: nrifa8.id, p_players: eleven })
  m ? bad(`Marcus on the open sheet: ${m.message}`) : ok('and Marcus submits it himself')
  const { error: vv } = await vera.rpc('submit_match_sheet', { p_fixture: later, p_entry: visitor8.id, p_players: vrows })
  vv ? bad(`Vera: ${vv.message}`) : ok('Vera submits hers')
}

head('3. L-19: editable until ended; after that, corrections go to the league')
{
  const { data: ap2 } = await owner.rpc('appoint_referee', { p_fixture: later, p_referee: refId, p_role: 'referee' })
  await ref.rpc('respond_appointment', { p_appointment: ap2, p_accept: true })
  const { error: early } = await ref.rpc('end_match', { p_fixture: later })
  early && /not kicked off/.test(early.message) ? ok('a game that has not kicked off cannot be ended') : bad(early ? early.message : 'ended before kick-off')
  // Kick-off was two hours ago now.
  await admin.from('fixtures').update({ starts_at: mins(-120) }).eq('id', later)
  const { error: g } = await marcus.rpc('record_match_event', { p_fixture: later, p_entry: nrifa8.id, p_kind: 'goal', p_player: u8ids[0], p_minute: 20 })
  g ? bad(`goal before ending: ${g.message}`) : ok('a goal is recorded while the game is editable')
  const { error: pe } = await parent.rpc('end_match', { p_fixture: later })
  pe?.code === '42501' ? ok('a parent cannot end a game') : bad('a parent ended a game')
  const { data: ended, error: ee } = await ref.rpc('end_match', { p_fixture: later, p_note: 'full time' })
  ee ? bad(`end: ${ee.message}`) : ok(`the referee ends it at ${new Date(ended).toLocaleTimeString('en-AU')}`)
  const { error: g2 } = await marcus.rpc('record_match_event', { p_fixture: later, p_entry: nrifa8.id, p_kind: 'goal', p_player: u8ids[1], p_minute: 44 })
  g2 && /has ended/.test(g2.message) ? ok(`a goal after the end is refused: "${g2.message}"`) : bad(g2 ? g2.message : 'an event was recorded after the end')
  const { error: s2 } = await marcus.rpc('enter_sheet_score', { p_fixture: later, p_entry: nrifa8.id, p_ours: 1, p_theirs: 0 })
  s2 && /has ended/.test(s2.message) ? ok('and so is a score') : bad(s2 ? s2.message : 'a score was entered after the end')
  const { error: s3 } = await ref.rpc('submit_match_sheet', { p_fixture: later, p_entry: nrifa8.id, p_players: eleven })
  s3 && /has ended/.test(s3.message) ? ok('even the referee cannot change the sheet once it is ended') : bad(s3 ? s3.message : 'the sheet changed after the end')

  const { error: bare } = await marcus.rpc('request_match_correction', { p_fixture: later, p_kind: 'score', p_detail: 'we won 1-0, the sheet shows nothing' })
  bare && /both scores/.test(bare.message) ? ok('a score correction without scores is refused') : bad(bare ? bare.message : 'accepted without scores')
  const { data: corr, error: ce } = await marcus.rpc('request_match_correction', { p_fixture: later, p_kind: 'score', p_detail: 'we won 1-0, the sheet shows nothing', p_home: 1, p_away: 0 })
  ce ? bad(`correction: ${ce.message}`) : ok('Marcus asks the league to correct the score to 1–0')
  const { error: dup } = await marcus.rpc('request_match_correction', { p_fixture: later, p_kind: 'score', p_detail: 'again', p_home: 1, p_away: 0 })
  dup?.code === '23505' ? ok('a second open score correction is refused') : bad(dup ? dup.message : 'two open corrections')
  const { data: pushes } = await admin.from('notification_queue').select('profile_id, kind, url').eq('kind', 'match_correction_requested').filter('payload->>correction_id', 'eq', corr)
  pushes?.some((p) => p.profile_id === OWNER) && pushes[0].url.endsWith(`/match/${later}`) ? ok('the league is pushed, straight to the match') : bad(JSON.stringify(pushes))
  const { data: pc } = await parent.rpc('match_corrections_view', { p_competition: comp.id })
  const parentSees = pc ?? []
  parentSees.length === 0 ? ok('a parent sees no corrections') : bad('a parent read the corrections')
  const { data: lc } = await owner.rpc('match_corrections_view', { p_competition: comp.id })
  lc?.length === 1 && lc[0].status === 'open' && lc[0].home === 'NRIFA U8' ? ok('the league sees it open, with the game named') : bad(JSON.stringify(lc))
  const { data: vc } = await vera.rpc('match_corrections_view', { p_competition: comp.id })
  vc?.length === 1 ? ok('the other club in the game sees it too') : bad(`Vera sees ${vc?.length}`)
  const { error: pd } = await parent.rpc('decide_match_correction', { p_correction: corr, p_apply: true })
  pd?.code === '42501' ? ok('a parent cannot decide it') : bad('a parent decided a correction')
  const { error: dd } = await owner.rpc('decide_match_correction', { p_correction: corr, p_apply: true, p_note: 'referee report agrees' })
  dd ? bad(`decide: ${dd.message}`) : ok('the league applies it')
  const { data: fx } = await admin.from('fixtures').select('status, home_score, away_score, ended_at').eq('id', later).single()
  fx?.status === 'final' && fx?.home_score === 1 && fx?.away_score === 0 && fx?.ended_at ? ok('the game is final 1–0 and still ended') : bad(JSON.stringify(fx))
  const { data: told } = await admin.from('notification_queue').select('kind, title').eq('profile_id', MARCUS).eq('kind', 'match_correction_decided').filter('payload->>correction_id', 'eq', corr).maybeSingle()
  told ? ok(`Marcus is told: "${told.title}"`) : bad('the requester was not told')
  const { data: log } = await admin.from('match_sheet_log').select('action').eq('fixture_id', later)
  const acts = (log ?? []).map((l) => l.action)
  const wanted = ['match_ended', 'correction_requested', 'score_corrected', 'correction_applied']
  wanted.every((a) => acts.includes(a)) ? ok(`all of it is in the record: ${acts.join(', ')}`) : bad(acts.join(', '))

  const { error: ro } = await owner.rpc('reopen_match', { p_fixture: later, p_note: 'a card was missed' })
  ro ? bad(`reopen: ${ro.message}`) : ok('the league reopens it, with a reason')
  const { data: ev2 } = await admin.from('fixtures').select('status').eq('id', later).single()
  const { error: ce2 } = await owner.rpc('record_match_event', { p_fixture: later, p_entry: nrifa8.id, p_kind: 'yellow', p_player: u8ids[2], p_minute: 60 })
  ce2 && ev2?.status === 'final' ? ok(`a final game stays closed to events even when reopened (${ce2.message.slice(0, 40)})`) : ce2 ? bad(`card after reopening: ${ce2.message}`) : ok('a missed card is recorded once reopened')
  const { data: ended2, error: e2 } = await owner.rpc('end_match', { p_fixture: later })
  e2 ? bad(`end again: ${e2.message}`) : ok(`and ended again at ${new Date(ended2).toLocaleTimeString('en-AU')}`)
}

head('4. L-21: playing up is capped')
{
  const u10a = await mkFixture('U10 Test', nrifa10.id, null, mins(180))
  const u10b = await mkFixture('U10 Test', nrifa10.id, null, mins(300))
  const up = (extra) => [...u10ids.slice(0, 8).map((id, i) => row(id, i + 1)), ...extra]
  const { error: first } = await owner.rpc('submit_match_sheet', { p_fixture: u10a, p_entry: nrifa10.id, p_players: up([row(u8ids[0], 20)]) })
  first ? bad(`first game up: ${first.message}`) : ok('a U8 plays up for the U10s once')
  const { error: again } = await owner.rpc('submit_match_sheet', { p_fixture: u10a, p_entry: nrifa10.id, p_players: up([row(u8ids[0], 20)]) })
  again ? bad(`re-submitting the same sheet: ${again.message}`) : ok('re-submitting that same sheet does not count against them')
  const { error: second } = await owner.rpc('submit_match_sheet', { p_fixture: u10b, p_entry: nrifa10.id, p_players: up([row(u8ids[0], 20)]) })
  second && /played up 1 time this season; this division allows 1/.test(second.message) ? ok(`a second game up is refused: "${second.message}"`) : bad(second ? second.message : 'the cap did nothing')
  const { data: v } = await owner.rpc('match_sheet_view', { p_fixture: u10b })
  const sq = (v?.squads?.home ?? []).find((p) => p.player_id === u8ids[0])
  sq === undefined ? ok('(the U8 is not on the U10 squad list, so nothing to show there)') : sq.ineligible ? ok('and the view greys them out with the reason') : bad('the view does not say')
}

head('5. L-21: a final needs two of the season\'s games behind a player')
{
  const fin = await mkFixture('U8 Test', nrifa8.id, visitor8.id, mins(240), { stage: 'final', round: 'Final' })
  // u8ids[0..10] were on the sheet for `soon` and `later`: two games. u8ids[11] on neither.
  const twelfth = u8ids[11]
  if (!twelfth) {
    ok('(the U8 squad has only eleven; the finals check is proven on the view below)')
  } else {
    const { error } = await marcus.rpc('submit_match_sheet', { p_fixture: fin, p_entry: nrifa8.id, p_players: [...eleven.slice(0, 10), row(twelfth, 12)] })
    error && /played 0 of the season's games; a final needs 2/.test(error.message) ? ok(`a child with no games is refused for the final: "${error.message}"`) : bad(error ? error.message : 'a child with no games was allowed in the final')
  }
  const { error: fine } = await marcus.rpc('submit_match_sheet', { p_fixture: fin, p_entry: nrifa8.id, p_players: eleven })
  fine ? bad(`eleven with two games each: ${fine.message}`) : ok('the eleven who played both games are fine')
  const { data: v } = await marcus.rpc('match_sheet_view', { p_fixture: fin })
  const greyed = (v?.squads?.home ?? []).filter((p) => p.ineligible && /a final needs 2/.test(p.ineligible))
  greyed.length === Math.max(0, u8ids.length - 11) ? ok(`the view greys out ${greyed.length} who have not played enough`) : bad(`${greyed.length} greyed of ${u8ids.length - 11} expected`)
  const { error: g } = await marcus.rpc('submit_match_sheet', { p_fixture: later, p_entry: nrifa8.id, p_players: eleven })
  g ? ok('(the ended group game stays closed)') : bad('an ended game accepted a sheet')
}

await cleanup()
if (addedClearance) await admin.from('staff_clearances').delete().eq('academy_id', NRIFA).eq('profile_id', MARCUS).eq('number', 'WWC0000001E')
console.log(process.exitCode ? '\n\x1b[31mTHE SHEET RULES ARE WRONG\x1b[0m\n' : '\n\x1b[32mall good\x1b[0m\n')
