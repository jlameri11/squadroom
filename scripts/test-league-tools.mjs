// Run: node --env-file=.env.local scripts/test-league-tools.mjs
//
// L-25, L-27, L-28 (0191): a decline needs a reason and a late one is
// refused; referees of the right grade take open games; a club puts up its
// own referee inside the window; an under-18 names who is paid. A club
// nominates a division and the squad locks; the league sets the division,
// unlocks, and exempts a player from the age band. Scores in bulk, a round
// moved, a round called off.
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
const TAG = 'TOOLSTEST'
const VISITOR_EMAIL = 'toolstest-owner@squadroom.invalid'
const REF1_EMAIL = 'toolstest-ref1@squadroom.invalid'
const REF2_EMAIL = 'toolstest-ref2@squadroom.invalid'

const signInEmail = (email) => signInClient(admin, email)
const emailOf = async (id) => (await admin.auth.admin.getUserById(id)).data.user.email
const hours = (n) => new Date(Date.now() + n * 3600_000).toISOString()

async function cleanup() {
  const { data: comps } = await admin.from('competitions').select('id').like('name', `${TAG} %`)
  for (const c of comps ?? []) {
    await admin.from('notification_queue').delete().like('url', `/competitions/${c.id}%`)
    await admin.from('competitions').delete().eq('id', c.id)
  }
  const { data: acads } = await admin.from('academies').select('id').like('name', `${TAG} %`)
  for (const a of acads ?? []) await admin.from('academies').delete().eq('id', a.id)
  await admin.from('referees').delete().like('full_name', `${TAG} %`)
  await admin.from('referees').delete().eq('full_name', 'Uncle Bob')
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 })
  for (const email of [VISITOR_EMAIL, REF1_EMAIL, REF2_EMAIL]) {
    const u = users?.users?.find((x) => x.email === email)
    if (u) {
      await admin.from('notification_queue').delete().eq('profile_id', u.id)
      await admin.auth.admin.deleteUser(u.id)
    }
  }
}
await cleanup()

const mkUser = async (email, name) => {
  const { data } = await admin.auth.admin.createUser({ email, email_confirm: true })
  await admin.from('profiles').upsert({ id: data.user.id, full_name: name })
  return data.user.id
}
const VISITOR = await mkUser(VISITOR_EMAIL, 'Vera Visitor')
const REF1 = await mkUser(REF1_EMAIL, 'Rita Referee')
const REF2 = await mkUser(REF2_EMAIL, 'Lenny Learner')
const { data: club } = await admin.from('academies').insert({ two_step_required: false, name: `${TAG} FC`, slug: 'toolstest-fc', type: 'academy', primary_colour: '#333333' }).select('id').single()
await admin.from('academy_members').insert({ academy_id: club.id, profile_id: VISITOR, role: 'owner', status: 'active' })
const { data: vteam } = await admin.from('teams').insert({ academy_id: club.id, name: `${TAG} U8`, age_group: 'U8', season: '2026', status: 'active' }).select('id').single()
const { data: vkids } = await admin.from('players').insert([
  ...Array.from({ length: 8 }, (_, i) => ({ academy_id: club.id, team_id: vteam.id, full_name: `Visitor ${i + 1} ${TAG}`, dob: '2018-03-01' })),
  { academy_id: club.id, team_id: vteam.id, full_name: `Visitor Older ${TAG}`, dob: '2016-06-01' },
]).select('id, full_name')
const older = vkids.find((k) => /Older/.test(k.full_name))

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
  { competition_id: comp.id, academy_id: NRIFA, team_id: U8, display_name: 'NRIFA U8', division: 'Tools' },
  { competition_id: comp.id, academy_id: club.id, team_id: vteam.id, display_name: `${TAG} U8`, division: 'Tools' },
  { competition_id: comp.id, academy_id: null, team_id: null, display_name: 'Name A', division: 'Tools' },
  { competition_id: comp.id, academy_id: null, team_id: null, display_name: 'Name B', division: 'Tools' },
]).select('id, display_name')
const nrifa8 = entries.find((e) => e.display_name === 'NRIFA U8')
const visitor8 = entries.find((e) => e.display_name === `${TAG} U8`)
await admin.from('competition_divisions').insert({ competition_id: comp.id, division: 'Tools', rank: 1, forfeit_score: 3, born_after: '2017-01-01', born_before: '2018-12-31' })

const owner = await signInEmail(await emailOf(OWNER))
const marcus = await signInEmail(await emailOf(MARCUS))
const vera = await signInEmail(VISITOR_EMAIL)
const parent = await signInEmail(await emailOf(PARENT))
const rita = await signInEmail(REF1_EMAIL)
const lenny = await signInEmail(REF2_EMAIL)
if (!owner || !marcus || !vera || !parent || !rita || !lenny) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  await cleanup()
  process.exit(2)
}
const mkFixture = async (at, round = 'Round 1', home = nrifa8.id, away = visitor8.id) =>
  (await admin.from('fixtures').insert({ competition_id: comp.id, division: 'Tools', round, home_entry_id: home, away_entry_id: away, starts_at: at, status: 'scheduled', stage: 'group', venue_label: `${TAG} Park`, field_label: 'Field 1' }).select('id').single()).data.id
const pushes = async (profile, kind) => (await admin.from('notification_queue').select('title, body').eq('profile_id', profile).eq('kind', kind).like('url', `/competitions/${comp.id}%`)).data ?? []

head('1. L-25: the league\'s referee rules')
{
  const { error: pe } = await parent.rpc('set_referee_rules', { p_competition: comp.id, p_late_decline_hours: 24, p_self_appoint: true, p_grades: ['Level 3'], p_club_allocate_hours: 48 })
  pe?.code === '42501' ? ok('a parent cannot set them') : bad('a parent set referee rules')
  const { error } = await owner.rpc('set_referee_rules', { p_competition: comp.id, p_late_decline_hours: 24, p_self_appoint: true, p_grades: ['Level 3'], p_club_allocate_hours: 48 })
  error ? bad(`rules: ${error.message}`) : ok('no pulling out inside 24 h; Level 3s may take open games; clubs may allocate inside 48 h')
}
const { data: ritaId } = await owner.rpc('add_referee', { p_competition: comp.id, p_full_name: `${TAG} Rita`, p_phone: '0400 000 777', p_grade: 'Level 3', p_profile: REF1 })
const { data: lennyId } = await owner.rpc('add_referee', { p_competition: comp.id, p_full_name: `${TAG} Lenny`, p_phone: '0400 000 778', p_grade: 'Level 1', p_profile: REF2 })

head('2. L-25: a decline needs a reason; a late one is refused')
{
  const soon = await mkFixture(hours(2))
  const later = await mkFixture(hours(72), 'Round 2')
  const { data: ap1 } = await owner.rpc('appoint_referee', { p_fixture: soon, p_referee: ritaId, p_role: 'referee' })
  const { data: ap2 } = await owner.rpc('appoint_referee', { p_fixture: later, p_referee: ritaId, p_role: 'referee' })
  const { error: bare } = await rita.rpc('respond_appointment', { p_appointment: ap2, p_accept: false })
  bare && /say why/.test(bare.message) ? ok('a decline with no reason is refused') : bad(bare ? bare.message : 'declined with no reason')
  await rita.rpc('respond_appointment', { p_appointment: ap1, p_accept: true })
  await rita.rpc('respond_appointment', { p_appointment: ap2, p_accept: true })
  const { error: late } = await rita.rpc('respond_appointment', { p_appointment: ap1, p_accept: false, p_note: 'car trouble' })
  late && /inside 24 hours/.test(late.message) ? ok(`pulling out of the game in two hours is refused: "${late.message}"`) : bad(late ? late.message : 'a late pull-out went through')
  const { error: fine } = await rita.rpc('respond_appointment', { p_appointment: ap2, p_accept: false, p_note: 'away that weekend' })
  fine ? bad(`declining the game in three days: ${fine.message}`) : ok('pulling out of the game in three days, with a reason, is fine')
  const { data: a } = await admin.from('referee_appointments').select('status, response_note').eq('id', ap2).single()
  a?.status === 'declined' && a.response_note === 'away that weekend' ? ok('and the reason is kept') : bad(JSON.stringify(a))
}

head('3. L-25: a referee of the right grade takes an open game')
{
  const open = await mkFixture(hours(5 * 24), 'Round 3')
  const { data: mine } = await rita.rpc('my_appointments')
  mine?.open_games?.some((g) => g.fixture_id === open) ? ok('Rita sees the open game on her page') : bad(JSON.stringify(mine?.open_games))
  const { data: his } = await lenny.rpc('my_appointments')
  his?.open_games?.some((g) => g.fixture_id === open) ? bad('a Level 1 was offered a Level 3 game') : ok('Lenny (Level 1) is not offered it')
  const { error: le } = await lenny.rpc('self_appoint', { p_fixture: open })
  le && /not your grade/.test(le.message) ? ok(`and is refused if he tries: "${le.message}"`) : bad(le ? le.message : 'a Level 1 took it')
  const { error: pe } = await parent.rpc('self_appoint', { p_fixture: open })
  pe?.code === '42501' ? ok('a parent is not in the pool') : bad('a parent self-appointed')
  const { data: apId, error } = await rita.rpc('self_appoint', { p_fixture: open })
  error ? bad(`self-appoint: ${error.message}`) : ok('Rita takes it')
  const { data: ap } = await admin.from('referee_appointments').select('status, offered_by').eq('id', apId).single()
  ap?.status === 'accepted' && ap.offered_by === null ? ok('accepted at once, nobody offered it') : bad(JSON.stringify(ap))
  const told = await pushes(OWNER, 'referee_response')
  told.some((t) => /took/.test(t.title)) ? ok(`the coordinator is told: "${told[told.length - 1].title}"`) : bad(JSON.stringify(told))
  const { error: again } = await rita.rpc('self_appoint', { p_fixture: open })
  again?.code === '23505' ? ok('a second taker is refused') : bad(again ? again.message : 'taken twice')
}

head('4. L-25: a club puts up its own referee inside the window')
{
  const far = await mkFixture(hours(5 * 24), 'Round 4')
  const near = await mkFixture(hours(20), 'Round 5')
  const { error: tooEarly } = await vera.rpc('club_allocate_referee', { p_fixture: far, p_full_name: 'Uncle Bob', p_phone: '0400 999 888' })
  tooEarly && /inside 48 hours/.test(tooEarly.message) ? ok('five days out the league still has its chance') : bad(tooEarly ? tooEarly.message : 'allocated five days out')
  const { error: pe } = await parent.rpc('club_allocate_referee', { p_fixture: near, p_full_name: 'Uncle Bob' })
  pe?.code === '42501' ? ok('a parent cannot') : bad('a parent allocated a referee')
  const { data: w } = await vera.rpc('club_allocate_window', { p_fixture: near })
  w?.open === true && w?.mine === true ? ok('the match page offers it to the club twenty hours out') : bad(JSON.stringify(w))
  const { data: apId, error } = await vera.rpc('club_allocate_referee', { p_fixture: near, p_full_name: 'Uncle Bob', p_phone: '0400 999 888', p_grade: 'Level 1' })
  error ? bad(`allocate: ${error.message}`) : ok('Vera puts up Uncle Bob')
  const { data: ap } = await admin.from('referee_appointments').select('status, fee_cents, referees(full_name, allocated_by_club)').eq('id', apId).single()
  ap?.status === 'accepted' && ap.fee_cents === 0 && ap.referees?.allocated_by_club === club.id ? ok('accepted, unpaid by the league, marked as the club\'s') : bad(JSON.stringify(ap))
  const told = await pushes(OWNER, 'referee_response')
  told.some((t) => /put up Uncle Bob/.test(t.title)) ? ok(`the coordinator is told: "${told[told.length - 1].title}"`) : bad(JSON.stringify(told))
  const { data: sheet } = await marcus.rpc('competition_run_sheet', { p_competition: comp.id, p_division: 'Tools' })
  sheet?.find((f) => f.fixture_id === near)?.referees === 'Uncle Bob' ? ok('and Uncle Bob is on the run sheet') : bad(JSON.stringify(sheet?.find((f) => f.fixture_id === near)))
}

head('5. L-25: an under-18 names who is paid')
{
  const { error } = await rita.rpc('set_my_bank_details', { p_referee: ritaId, p_details: 'BSB 062-000 12345678', p_payee_name: "Rita's mum", p_under_18: true })
  error ? bad(`bank: ${error.message}`) : ok('Rita names her mum as payee')
  const { data: mine } = await rita.rpc('my_appointments')
  mine?.pools?.[0]?.payee_name === "Rita's mum" && mine.pools[0].under_18 === true ? ok('and her page shows it') : bad(JSON.stringify(mine?.pools))
  const { error: le } = await lenny.rpc('set_my_bank_details', { p_referee: ritaId, p_details: 'mine now' })
  le?.code === '42501' ? ok('Lenny cannot touch her details') : bad('Lenny changed Rita\'s bank details')
}

head('6. L-27: the club nominates; the squad locks; the league sets the division')
{
  const { error: early } = await vera.rpc('nominate_entry', { p_entry: visitor8.id, p_division: 'Division 2' })
  early && /squad together first/.test(early.message) ? ok('no squad, no nomination') : bad(early ? early.message : 'nominated with an empty squad')
  await vera.rpc('seed_entry_squad', { p_entry: visitor8.id })
  const { error: pe } = await parent.rpc('nominate_entry', { p_entry: visitor8.id, p_division: 'Division 2' })
  pe?.code === '42501' ? ok('a parent cannot nominate') : bad('a parent nominated')
  const { error } = await vera.rpc('nominate_entry', { p_entry: visitor8.id, p_division: 'Division 2', p_note: 'mid-table last year' })
  error ? bad(`nominate: ${error.message}`) : ok('Vera nominates Division 2 with a comment')
  const { data: e } = await admin.from('competition_entries').select('proposed_division, nomination_note, squad_locked_at, division').eq('id', visitor8.id).single()
  e?.proposed_division === 'Division 2' && e.squad_locked_at && e.division === 'Tools' ? ok('proposed, locked, still in the drawn division until the league says') : bad(JSON.stringify(e))
  const told = await pushes(OWNER, 'nomination')
  told.some((t) => /nominated for Division 2/.test(t.title)) ? ok(`the league is told: "${told[told.length - 1].title}"`) : bad(JSON.stringify(told))
  const { data: newKid } = await admin.from('players').insert({ academy_id: club.id, team_id: vteam.id, full_name: `Visitor Late ${TAG}`, dob: '2018-07-01' }).select('id').single()
  const { error: locked } = await vera.rpc('seed_entry_squad', { p_entry: visitor8.id })
  locked && /locked/.test(locked.message) ? ok(`the squad is locked: "${locked.message}"`) : bad(locked ? locked.message : 'the squad changed while locked')
  const { data: list } = await owner.rpc('entry_nominations', { p_competition: comp.id })
  const row = list?.find((r) => r.entry_id === visitor8.id)
  row?.proposed_division === 'Division 2' && row.locked && row.outside_band === 1 ? ok(`the league sees it: ${row.players} players, 1 outside the age band`) : bad(JSON.stringify(row))
  const { data: plist } = await parent.rpc('entry_nominations', { p_competition: comp.id })
  plist === null ? ok('a parent sees nothing') : bad('a parent read the nominations')
  const { data: mine } = await vera.rpc('my_entries', { p_competition: comp.id })
  mine?.length === 1 && mine[0].locked ? ok('and Vera sees her own team, locked') : bad(JSON.stringify(mine))
  const { error: se } = await owner.rpc('set_entry_division', { p_entry: visitor8.id, p_division: 'Division 2', p_note: 'agreed' })
  se ? bad(`set division: ${se.message}`) : ok('the league puts them in Division 2')
  const { data: e2 } = await admin.from('competition_entries').select('division').eq('id', visitor8.id).single()
  e2?.division === 'Division 2' ? ok('the entry moved') : bad(JSON.stringify(e2))
  const vt = await pushes(VISITOR, 'nomination')
  vt.some((t) => /are in Division 2/.test(t.title)) ? ok(`Vera is told: "${vt[vt.length - 1].title}"`) : bad(JSON.stringify(vt))
  await admin.from('competition_entries').update({ division: 'Tools' }).eq('id', visitor8.id)
  const { error: ue } = await owner.rpc('lock_entry_squad', { p_entry: visitor8.id, p_locked: false })
  ue ? bad(`unlock: ${ue.message}`) : ok('the league unlocks the squad')
  const { data: n, error: re } = await vera.rpc('seed_entry_squad', { p_entry: visitor8.id })
  re ? bad(`after unlock: ${re.message}`) : ok(`and Vera adds the late player (${n} added)`)
  void newKid
}

head('7. L-27: the date-of-birth band, on the sheet; the league exempts')
{
  const g = await mkFixture(hours(48), 'Round 6')
  const { data: sq } = await admin.from('entry_squads').select('player_id').eq('entry_id', visitor8.id)
  const ids = sq.map((s) => s.player_id)
  const rows = ids.slice(0, 9).map((id, i) => ({ player_id: id, number: i + 1, starting: true }))
  const withOlder = [...rows.filter((r) => r.player_id !== older.id).slice(0, 8), { player_id: older.id, number: 20, starting: true }]
  const { error } = await vera.rpc('submit_match_sheet', { p_fixture: g, p_entry: visitor8.id, p_players: withOlder })
  error && /born in 2016; this division is for 2017–2018/.test(error.message) ? ok(`the 2016-born is refused: "${error.message}"`) : bad(error ? error.message : 'a 2016-born went on a 2017–18 sheet')
  const { error: pe } = await parent.rpc('exempt_player_age', { p_entry: visitor8.id, p_player: older.id, p_exempt: true })
  pe?.code === '42501' ? ok('a parent cannot exempt') : bad('a parent exempted a player')
  const { error: ex } = await owner.rpc('exempt_player_age', { p_entry: visitor8.id, p_player: older.id, p_exempt: true })
  ex ? bad(`exempt: ${ex.message}`) : ok('the league exempts them')
  const { error: fine } = await vera.rpc('submit_match_sheet', { p_fixture: g, p_entry: visitor8.id, p_players: withOlder })
  fine ? bad(`after the exemption: ${fine.message}`) : ok('and the sheet goes in')
}

head('8. L-28: scores in bulk, a round moved, a round called off')
{
  const a = await mkFixture(hours(-30), 'Round 7')
  const b = await mkFixture(hours(-28), 'Round 7', nrifa8.id, entries.find((e) => e.display_name === 'Name A').id)
  const played = await mkFixture(hours(-26), 'Round 7', nrifa8.id, entries.find((e) => e.display_name === 'Name B').id)
  await admin.from('fixtures').update({ status: 'final', home_score: 1, away_score: 1 }).eq('id', played)
  const { error: pe } = await parent.rpc('bulk_scores', { p_competition: comp.id, p_rows: [{ fixture_id: a, home: 1, away: 0 }] })
  pe?.code === '42501' ? ok('a parent cannot enter scores in bulk') : bad('a parent entered scores')
  const { data: r, error } = await owner.rpc('bulk_scores', { p_competition: comp.id, p_rows: [
    { fixture_id: a, home: 2, away: 1 }, { fixture_id: b, home: 0, away: 0 }, { fixture_id: played, home: 5, away: 0 }, { fixture_id: a, home: 'x', away: 1 },
  ] })
  error ? bad(`bulk: ${error.message}`) : r?.updated === 2 && r.skipped.length === 2 ? ok(`two entered, two skipped (${r.skipped.map((s) => s.why).join('; ')})`) : bad(JSON.stringify(r))
  const { data: fa } = await admin.from('fixtures').select('status, home_score, away_score, ended_at').eq('id', a).single()
  fa?.status === 'final' && fa.home_score === 2 && fa.ended_at ? ok('the first is final 2–1 and ended') : bad(JSON.stringify(fa))
  const { data: fp } = await admin.from('fixtures').select('home_score').eq('id', played).single()
  fp?.home_score === 1 ? ok('the played game kept its result') : bad(JSON.stringify(fp))

  const r2a = await mkFixture(hours(7 * 24), 'Round 8')
  const r2b = await mkFixture(hours(7 * 24 + 1), 'Round 8', nrifa8.id, entries.find((e) => e.display_name === 'Name A').id)
  const before = (await admin.from('fixtures').select('id, starts_at').in('id', [r2a, r2b])).data
  const { data: moved, error: me } = await owner.rpc('shift_round', { p_competition: comp.id, p_division: 'Tools', p_round: 'Round 8', p_days: 7 })
  me ? bad(`shift: ${me.message}`) : moved === 2 ? ok('Round 8 moved a week') : bad(`moved ${moved}`)
  const after = (await admin.from('fixtures').select('id, starts_at, pinned').in('id', [r2a, r2b])).data
  after?.every((f) => new Date(f.starts_at).getTime() - new Date(before.find((x) => x.id === f.id).starts_at).getTime() === 7 * 864e5 && f.pinned) ? ok('both games are seven days later and pinned') : bad(JSON.stringify(after))
  const { error: pe2 } = await parent.rpc('shift_round', { p_competition: comp.id, p_division: 'Tools', p_round: 'Round 8', p_days: 7 })
  pe2?.code === '42501' ? ok('a parent cannot move a round') : bad('a parent moved a round')

  const { data: off, error: oe } = await owner.rpc('abandon_round', { p_competition: comp.id, p_division: 'Tools', p_round: 'Round 8', p_reason: 'wet_weather' })
  oe ? bad(`abandon: ${oe.message}`) : off === 2 ? ok('and then called off for wet weather') : bad(`off ${off}`)
  const { data: st } = await admin.from('fixtures').select('status, cancel_reason').in('id', [r2a, r2b])
  st?.every((f) => f.status === 'postponed' && f.cancel_reason === 'wet_weather') ? ok('both postponed with the reason') : bad(JSON.stringify(st))
}

await cleanup()
if (addedClearance) await admin.from('staff_clearances').delete().eq('academy_id', NRIFA).eq('profile_id', MARCUS).eq('number', 'WWC0000001E')
console.log(process.exitCode ? '\n\x1b[31mTHE TOOLS ARE WRONG\x1b[0m\n' : '\n\x1b[32mall good\x1b[0m\n')
