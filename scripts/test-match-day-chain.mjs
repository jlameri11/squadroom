// Run: node --env-file=.env.local scripts/test-match-day-chain.mjs
//
// L-18, L-20, L-22 (0190): cards carry the federation's sanction codes and
// the club is told when a player is one yellow from a suspension; a forfeit
// is asked for by the coach, approved by the club and decided by the league;
// and the scorer's phone, handed to the referee, verifies and ends the game
// on the referee's mobile number and the word Confirm.
import { createClient } from '@supabase/supabase-js'
import { signInClient } from './_auth.mjs'
import { listAllUsers } from './_users.mjs'

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
const TAG = 'CHAINTEST'
const VISITOR_EMAIL = 'chaintest-owner@squadroom.invalid'
const COACH_EMAIL = 'chaintest-coach@squadroom.invalid'
const REF_EMAIL = 'chaintest-ref@squadroom.invalid'
const REF_PHONE = '0400 000 777'

const signInEmail = (email) => signInClient(admin, email)
const emailOf = async (id) => (await admin.auth.admin.getUserById(id)).data.user.email
const mins = (n) => new Date(Date.now() + n * 60_000).toISOString()

async function cleanup() {
  const { data: comps } = await admin.from('competitions').select('id').like('name', `${TAG} %`)
  for (const c of comps ?? []) {
    await admin.from('notification_queue').delete().like('url', `/competitions/${c.id}%`)
    await admin.from('competitions').delete().eq('id', c.id)
  }
  const { data: acads } = await admin.from('academies').select('id').like('name', `${TAG} %`)
  for (const a of acads ?? []) await admin.from('academies').delete().eq('id', a.id)
  await admin.from('referees').delete().like('full_name', `${TAG} %`)
  const { data: users } = await listAllUsers(admin)
  for (const email of [VISITOR_EMAIL, COACH_EMAIL, REF_EMAIL]) {
    const u = users?.users?.find((x) => x.email === email)
    if (u) {
      await admin.from('notification_queue').delete().eq('profile_id', u.id)
      await admin.auth.admin.deleteUser(u.id)
    }
  }
}
await cleanup()

// ---- the visiting club: an owner (club staff), a coach, a squad; a referee ----
const mkUser = async (email, name) => {
  const { data } = await admin.auth.admin.createUser({ email, email_confirm: true })
  await admin.from('profiles').upsert({ id: data.user.id, full_name: name })
  return data.user.id
}
const VISITOR = await mkUser(VISITOR_EMAIL, 'Vera Visitor')
const COACH = await mkUser(COACH_EMAIL, 'Carl Coach')
const REF = await mkUser(REF_EMAIL, 'Rita Referee')
const { data: club } = await admin.from('academies').insert({ two_step_required: false, name: `${TAG} FC`, slug: 'chaintest-fc', type: 'academy', primary_colour: '#333333' }).select('id').single()
// The owner first; then the coach's clearance, then the coach — 0120 refuses
// a coach without one, and a multi-row insert fails as a whole.
const { error: ownerErr } = await admin.from('academy_members').insert({ academy_id: club.id, profile_id: VISITOR, role: 'owner', status: 'active' })
if (ownerErr) console.log(`  (owner row: ${ownerErr.message})`)
await admin.from('staff_clearances').insert({ academy_id: club.id, profile_id: COACH, kind: 'wwcc', number: 'WWC0000777E', outcome: 'cleared', expires_on: new Date(Date.now() + 400 * 864e5).toISOString().slice(0, 10), verified_by: VISITOR })
const { error: memberErr } = await admin.from('academy_members').insert({ academy_id: club.id, profile_id: COACH, role: 'coach', status: 'active' })
if (memberErr) console.log(`  (coach membership: ${memberErr.message})`)
const { data: vteam } = await admin.from('teams').insert({ academy_id: club.id, name: `${TAG} U8`, age_group: 'U8', season: '2026', status: 'active' }).select('id').single()
const { error: coachErr } = await admin.from('team_members').insert({ academy_id: club.id, team_id: vteam.id, profile_id: COACH, role: 'coach' })
if (coachErr) console.log(`  (coach row: ${coachErr.message})`)
const { data: vkids } = await admin.from('players').insert(
  Array.from({ length: 9 }, (_, i) => ({ academy_id: club.id, team_id: vteam.id, full_name: `Visitor ${i + 1} ${TAG}`, dob: '2018-01-01' }))
).select('id')

// Marcus coaches the U8s (seed: no clearance on file; added only if missing, removed at the end).
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
const { data: entries } = await admin.from('competition_entries').insert([
  { competition_id: comp.id, academy_id: NRIFA, team_id: U8, display_name: 'NRIFA U8', division: 'Chain' },
  { competition_id: comp.id, academy_id: club.id, team_id: vteam.id, display_name: `${TAG} U8`, division: 'Chain' },
]).select('id, display_name')
const [nrifa8, visitor8] = entries
await admin.from('competition_divisions').insert({ competition_id: comp.id, division: 'Chain', rank: 1, forfeit_score: 3, sheet_lock_mins: 30 })
await admin.from('competition_discipline_rules').upsert({ competition_id: comp.id, yellows_per_suspension: 3, games_per_yellow_suspension: 1, games_per_red: 2 }, { onConflict: 'competition_id' })

const owner = await signInEmail(await emailOf(OWNER))
const marcus = await signInEmail(await emailOf(MARCUS))
const vera = await signInEmail(VISITOR_EMAIL)
const carl = await signInEmail(COACH_EMAIL)
const parent = await signInEmail(await emailOf(PARENT))
const ref = await signInEmail(REF_EMAIL)
if (!owner || !marcus || !vera || !carl || !parent || !ref) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  await cleanup()
  process.exit(2)
}
await marcus.rpc('seed_entry_squad', { p_entry: nrifa8.id })
await vera.rpc('seed_entry_squad', { p_entry: visitor8.id })
const { data: squad8 } = await admin.from('entry_squads').select('player_id').eq('entry_id', nrifa8.id)
const u8ids = squad8.map((s) => s.player_id)
const row = (id, n) => ({ player_id: id, number: n, starting: true })
const eleven = u8ids.slice(0, 11).map((id, i) => row(id, i + 1))
const vrows = vkids.map((k, i) => row(k.id, i + 1))
const mkFixture = async (at, home = nrifa8.id, away = visitor8.id) =>
  (await admin.from('fixtures').insert({ competition_id: comp.id, division: 'Chain', round: 'Round 1', home_entry_id: home, away_entry_id: away, starts_at: at, status: 'scheduled', stage: 'group' }).select('id').single()).data.id
const pushes = async (profile, kind) => (await admin.from('notification_queue').select('title, body').eq('profile_id', profile).eq('kind', kind).like('url', `/competitions/${comp.id}%`)).data ?? []

head('1. L-20: sanction codes on cards; one yellow away, the club is told')
{
  const g1 = await mkFixture(mins(90))
  const g2 = await mkFixture(mins(120))
  await marcus.rpc('submit_match_sheet', { p_fixture: g1, p_entry: nrifa8.id, p_players: eleven })
  await marcus.rpc('submit_match_sheet', { p_fixture: g2, p_entry: nrifa8.id, p_players: eleven })
  const booked = u8ids[0]
  const { error: badCode } = await owner.rpc('record_match_event', { p_fixture: g1, p_entry: nrifa8.id, p_kind: 'yellow', p_player: booked, p_minute: 5, p_code: 'X9' })
  badCode && /Y1 to Y6/.test(badCode.message) ? ok('a caution with a made-up code is refused') : bad(badCode ? badCode.message : 'X9 accepted')
  const { error: goalCode } = await owner.rpc('record_match_event', { p_fixture: g1, p_entry: nrifa8.id, p_kind: 'goal', p_player: booked, p_minute: 5, p_code: 'Y1' })
  goalCode && /only a card/.test(goalCode.message) ? ok('a goal does not take a code') : bad(goalCode ? goalCode.message : 'a coded goal')
  const { error: y1 } = await owner.rpc('record_match_event', { p_fixture: g1, p_entry: nrifa8.id, p_kind: 'yellow', p_player: booked, p_minute: 10, p_code: 'y2' })
  y1 ? bad(`first yellow: ${y1.message}`) : ok('a first yellow, Y2 (dissent), lower case accepted')
  const { data: ev } = await admin.from('match_events').select('sanction_code').eq('fixture_id', g1).eq('kind', 'yellow').single()
  ev?.sanction_code === 'Y2' ? ok('stored as Y2') : bad(JSON.stringify(ev))
  const before = (await pushes(MARCUS, 'discipline_warning')).length
  const { error: y2 } = await owner.rpc('record_match_event', { p_fixture: g2, p_entry: nrifa8.id, p_kind: 'yellow', p_player: booked, p_minute: 30, p_code: 'Y1' })
  y2 ? bad(`second yellow: ${y2.message}`) : ok('a second yellow in the next game')
  const warn = await pushes(MARCUS, 'discipline_warning')
  warn.length === before + 1 && /one yellow from a suspension/.test(warn[warn.length - 1].title) ? ok(`the coach is told: "${warn[warn.length - 1].title}" — ${warn[warn.length - 1].body}`) : bad(JSON.stringify(warn))
  const { data: rep } = await owner.rpc('discipline_report', { p_competition: comp.id })
  const pr = rep?.players?.find((p) => p.player_id === booked)
  pr?.one_away === true && pr?.cards?.length === 2 && pr.cards.every((c) => c.code) ? ok('the discipline tab says one away, and lists both cards with codes') : bad(JSON.stringify(pr))
  const { error: y3 } = await owner.rpc('record_match_event', { p_fixture: g2, p_entry: nrifa8.id, p_kind: 'yellow', p_player: booked, p_minute: 60, p_code: 'Y3' })
  y3 ? bad(`third yellow: ${y3.message}`) : ok('a third yellow')
  const { data: susp } = await admin.from('suspensions').select('reason, games, sanction_code, status').eq('competition_id', comp.id).eq('player_id', booked).maybeSingle()
  susp?.status === 'active' && susp.games === 1 && susp.sanction_code === 'Y3' ? ok(`suspended for ${susp.games} game, carrying the code of the card that tipped it (${susp.sanction_code})`) : bad(JSON.stringify(susp))
  const told = await pushes(MARCUS, 'discipline_suspension')
  told.some((t) => /is suspended/.test(t.title)) ? ok(`and the coach is told: "${told[told.length - 1].title}"`) : bad(JSON.stringify(told))
  const { error: red } = await owner.rpc('record_match_event', { p_fixture: g2, p_entry: nrifa8.id, p_kind: 'red', p_player: u8ids[1], p_minute: 70, p_code: 'R2' })
  red ? bad(`red: ${red.message}`) : ok('a red, R2 (violent conduct)')
  const { data: rs } = await admin.from('suspensions').select('games, sanction_code').eq('competition_id', comp.id).eq('player_id', u8ids[1]).maybeSingle()
  rs?.games === 2 && rs.sanction_code === 'R2' ? ok('two games, code R2') : bad(JSON.stringify(rs))
}

head('2. L-22: a forfeit is asked for by the coach, approved by the club, decided by the league')
{
  const g = await mkFixture(mins(3 * 24 * 60))
  const { error: pe } = await parent.rpc('request_forfeit', { p_fixture: g, p_entry: visitor8.id, p_reason: 'no' })
  pe?.code === '42501' ? ok('a parent cannot ask') : bad('a parent asked for a forfeit')
  const { data: req, error } = await carl.rpc('request_forfeit', { p_fixture: g, p_entry: visitor8.id, p_reason: 'six players away on school camp' })
  error ? bad(`coach asks: ${error.message}`) : ok('the visiting coach asks, with a reason')
  const { data: r1 } = await admin.from('forfeit_requests').select('status').eq('id', req).single()
  r1?.status === 'proposed' ? ok('it waits for the club') : bad(`status ${r1?.status}`)
  const v1 = await pushes(VISITOR, 'forfeit_request')
  v1.length === 1 && /Your coach asks/.test(v1[0].title) ? ok(`the club owner is told: "${v1[0].title}"`) : bad(JSON.stringify(v1))
  const { error: m } = await marcus.rpc('club_decide_forfeit', { p_request: req, p_approve: true })
  m?.code === '42501' ? ok('the other club cannot decide it') : bad('NRIFA decided a visitor forfeit')
  const { error: early } = await owner.rpc('league_decide_forfeit', { p_request: req, p_approve: true })
  early ? bad(`league early: ${early.message}`) : ok('(the league may rule before the club does; here it waited)')
  // Undo the league's early ruling for the chain to run in order.
  await admin.from('forfeit_requests').update({ status: 'proposed', league_decided_by: null, league_decided_at: null, league_note: null }).eq('id', req)
  await admin.from('fixtures').update({ status: 'scheduled', home_score: null, away_score: null, cancel_reason: null }).eq('id', g)
  const { error: c } = await vera.rpc('club_decide_forfeit', { p_request: req, p_approve: true, p_note: 'we tried to borrow' })
  c ? bad(`club approves: ${c.message}`) : ok('the club approves')
  const { data: r2 } = await admin.from('forfeit_requests').select('status').eq('id', req).single()
  r2?.status === 'club_approved' ? ok('now it waits for the league') : bad(`status ${r2?.status}`)
  const l1 = await pushes(OWNER, 'forfeit_request')
  l1.some((p) => /ask to forfeit/.test(p.title)) ? ok(`the league is told: "${l1[l1.length - 1].title}"`) : bad(JSON.stringify(l1))
  const { data: ops } = await owner.rpc('match_day_ops', { p_competition: comp.id })
  ops?.forfeits?.some((f) => f.id === req && f.status === 'club_approved') ? ok('and sees it on the match-day list') : bad(JSON.stringify(ops?.forfeits))
  const { error: d } = await owner.rpc('league_decide_forfeit', { p_request: req, p_approve: true, p_note: 'noted' })
  d ? bad(`league decides: ${d.message}`) : ok('the league decides: forfeit')
  const { data: fx } = await admin.from('fixtures').select('status, home_score, away_score').eq('id', g).single()
  fx?.status === 'forfeit' && fx.home_score === 3 && fx.away_score === 0 ? ok('the game is a 3–0 forfeit to NRIFA, the division\'s forfeit score') : bad(JSON.stringify(fx))
  const c1 = await pushes(COACH, 'forfeit_decided')
  c1.some((p) => /forfeit/.test(p.title)) ? ok(`the coach who asked is told: "${c1[c1.length - 1].title}"`) : bad(JSON.stringify(c1))
  const m1 = await pushes(MARCUS, 'forfeit_decided')
  m1.length >= 1 ? ok('and so is the other team') : bad('the other team was not told')

  // Club staff asking skip the club step; declined stays a game.
  const g2 = await mkFixture(mins(4 * 24 * 60))
  const { data: req2 } = await vera.rpc('request_forfeit', { p_fixture: g2, p_entry: visitor8.id, p_reason: 'bus broke down' })
  const { data: r3 } = await admin.from('forfeit_requests').select('status').eq('id', req2).single()
  r3?.status === 'club_approved' ? ok('a club owner\'s own request skips the club step') : bad(`status ${r3?.status}`)
  const { error: dec } = await owner.rpc('league_decide_forfeit', { p_request: req2, p_approve: false, p_note: 'play it Sunday' })
  dec ? bad(`decline: ${dec.message}`) : ok('the league says play it')
  const { data: fx2 } = await admin.from('fixtures').select('status').eq('id', g2).single()
  fx2?.status === 'scheduled' ? ok('and the game stays on') : bad(`status ${fx2?.status}`)
  const { data: list } = await vera.rpc('forfeit_requests_view', { p_competition: comp.id })
  list?.length === 2 ? ok('the club sees both of its requests') : bad(`club sees ${list?.length}`)
  const { data: plist } = await parent.rpc('forfeit_requests_view', { p_competition: comp.id })
  const parentSees = plist ?? []
  parentSees.length === 0 ? ok('a parent sees none') : bad('a parent read forfeit requests')
}

head('3. L-18: the scorer\'s phone, handed to the referee')
{
  const g = await mkFixture(mins(120))
  await marcus.rpc('submit_match_sheet', { p_fixture: g, p_entry: nrifa8.id, p_players: eleven })
  await vera.rpc('submit_match_sheet', { p_fixture: g, p_entry: visitor8.id, p_players: vrows })
  const { data: refId } = await owner.rpc('add_referee', { p_competition: comp.id, p_full_name: `${TAG} Rita`, p_phone: REF_PHONE, p_grade: 'Level 3', p_profile: REF })
  const { data: ap } = await owner.rpc('appoint_referee', { p_fixture: g, p_referee: refId, p_role: 'referee' })
  await ref.rpc('respond_appointment', { p_appointment: ap, p_accept: true })
  const { error: early } = await marcus.rpc('referee_verify_by_phone', { p_fixture: g, p_phone: REF_PHONE, p_word: 'Confirm' })
  early && /not kicked off/.test(early.message) ? ok('nothing to verify before kick-off') : bad(early ? early.message : 'verified before kick-off')
  await admin.from('fixtures').update({ starts_at: mins(-60) }).eq('id', g)
  await marcus.rpc('enter_sheet_score', { p_fixture: g, p_entry: nrifa8.id, p_ours: 2, p_theirs: 1 })
  const { data: v } = await marcus.rpc('match_sheet_view', { p_fixture: g })
  v?.can_hand_over === true && /Rita/.test(v?.referee_name ?? '') ? ok(`the manager's page offers the handover to ${v.referee_name}`) : bad(JSON.stringify({ hand: v?.can_hand_over, ref: v?.referee_name }))
  const { error: pe } = await parent.rpc('referee_verify_by_phone', { p_fixture: g, p_phone: REF_PHONE, p_word: 'Confirm' })
  pe?.code === '42501' ? ok('a parent\'s phone is not a scorer\'s') : bad('a parent verified a game')
  const { data: wrongPhone } = await marcus.rpc('referee_verify_by_phone', { p_fixture: g, p_phone: '0400 111 222', p_word: 'Confirm' })
  wrongPhone?.ok === false && /not the referee/.test(wrongPhone.reason) ? ok(`the wrong number is refused: "${wrongPhone.reason}" (${wrongPhone.tries_left} tries left)`) : bad(JSON.stringify(wrongPhone))
  const { data: wrongWord } = await marcus.rpc('referee_verify_by_phone', { p_fixture: g, p_phone: REF_PHONE, p_word: 'ok' })
  wrongWord?.ok === false ? ok('and so is the wrong word') : bad('"ok" verified')
  const { data: done, error } = await marcus.rpc('referee_verify_by_phone', { p_fixture: g, p_phone: '+61 400 000 777', p_word: ' confirm ' })
  error || !done?.ok ? bad(`verify: ${error?.message ?? JSON.stringify(done)}`) : ok(`the referee's number, written another way, and Confirm: verified by ${done.referee}`)
  const { data: fx } = await admin.from('fixtures').select('referee_verified_at, referee_verified_by, ended_at').eq('id', g).single()
  fx?.referee_verified_at && fx.referee_verified_by === refId && fx.ended_at ? ok('the game is verified in the referee\'s name and ended') : bad(JSON.stringify(fx))
  const { data: log } = await admin.from('match_sheet_log').select('action').eq('fixture_id', g)
  const acts = (log ?? []).map((l) => l.action)
  acts.includes('referee_verified') && acts.filter((a) => a === 'referee_verify_failed').length === 2 ? ok('the record has the verification and the two failed tries') : bad(acts.join(', '))
  const { error: again } = await marcus.rpc('referee_verify_by_phone', { p_fixture: g, p_phone: REF_PHONE, p_word: 'Confirm' })
  again && /already verified/.test(again.message) ? ok('verifying twice is refused') : bad(again ? again.message : 'verified twice')
  const { data: v2 } = await vera.rpc('match_sheet_view', { p_fixture: g })
  v2?.fixture?.referee_verified_by && /Rita/.test(v2.fixture.referee_verified_by) ? ok('the other club\'s page says who verified it') : bad(JSON.stringify(v2?.fixture))

  // A referee ending the game from their own phone verifies it too. Five
  // hours earlier, clear of the first game's window (0173's clash rule).
  const g2 = await mkFixture(mins(-300))
  const { data: ap2 } = await owner.rpc('appoint_referee', { p_fixture: g2, p_referee: refId, p_role: 'referee' })
  await ref.rpc('respond_appointment', { p_appointment: ap2, p_accept: true })
  const { error: e2 } = await ref.rpc('end_match', { p_fixture: g2 })
  e2 ? bad(`referee ends: ${e2.message}`) : ok('the referee ends another game from their own phone')
  const { data: fx2 } = await admin.from('fixtures').select('referee_verified_by').eq('id', g2).single()
  fx2?.referee_verified_by === refId ? ok('and that counts as verified too') : bad(JSON.stringify(fx2))
}

await cleanup()
if (addedClearance) await admin.from('staff_clearances').delete().eq('academy_id', NRIFA).eq('profile_id', MARCUS).eq('number', 'WWC0000001E')
console.log(process.exitCode ? '\n\x1b[31mTHE CHAIN IS WRONG\x1b[0m\n' : '\n\x1b[32mall good\x1b[0m\n')
