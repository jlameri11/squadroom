// Run: node --env-file=.env.local scripts/test-referees.mjs
//
// L-06: a league's referee pool. A referee claims their link, blocks out
// a weekend, is asked to take a game (with a push), says yes, checks in at
// the ground and writes the report. The organiser cannot ask someone who is
// blocked out or already on another pitch; a club manager sees the name on
// the run sheet and nothing more; a parent sees nothing at all.
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
const RAVENS = '00000000-0000-0000-0000-0000000a0002'
const SPL = '00000000-0000-0000-0000-0000000a0003'
const OWNER = '00000000-0000-0000-0000-0000000000a1'
// NRIFA's owner also owns the SPL in the seed, so the club in these checks is Ravens.
const RAVENS_OWNER = '00000000-0000-0000-0000-0000000000c1'
const PARENT = '00000000-0000-0000-0000-0000000000b1'
const U8 = '00000000-0000-0000-0000-0000000d0008'
const TAG = 'REFTEST'
const OFFICIAL_EMAIL = 'reftest-official@squadroom.invalid'
const REF_A_EMAIL = 'reftest-ref-a@squadroom.invalid'
const REF_B_EMAIL = 'reftest-ref-b@squadroom.invalid'

async function signInEmail(email) {
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (!link?.properties?.hashed_token) return null
  const client = createClient(URL_, PUB, { auth: { persistSession: false } })
  const { data } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
  return data?.session ? client : null
}

async function cleanup() {
  const { data: comps } = await admin.from('competitions').select('id').like('name', `${TAG} %`)
  for (const c of comps ?? []) await admin.from('competitions').delete().eq('id', c.id)
  await admin.from('referees').delete().like('full_name', `% ${TAG}`)
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 })
  for (const e of [OFFICIAL_EMAIL, REF_A_EMAIL, REF_B_EMAIL]) {
    const u = users?.users?.find((x) => x.email === e)
    if (u) {
      await admin.from('academy_members').delete().eq('profile_id', u.id)
      await admin.from('staff_clearances').delete().eq('profile_id', u.id)
      await admin.auth.admin.deleteUser(u.id)
    }
  }
}
await cleanup()

async function makeUser(email, name) {
  const { data } = await admin.auth.admin.createUser({ email, email_confirm: true })
  await admin.from('profiles').upsert({ id: data.user.id, full_name: name })
  return data.user.id
}
const officialId = await makeUser(OFFICIAL_EMAIL, 'Olive Official')
await admin.from('staff_clearances').insert({
  academy_id: SPL, profile_id: officialId, kind: 'wwcc', number: 'WWC0000778E', outcome: 'cleared',
  expires_on: new Date(Date.now() + 400 * 864e5).toISOString().slice(0, 10), verified_by: OWNER,
})
const { error: memErr } = await admin.from('academy_members').insert({ academy_id: SPL, profile_id: officialId, role: 'admin', status: 'active' })
if (memErr) console.log('  (official membership:', memErr.message + ')')
const refAId = await makeUser(REF_A_EMAIL, `Pat Whistle ${TAG}`)
await makeUser(REF_B_EMAIL, `Sam Flag ${TAG}`)

// A season with NRIFA and Ravens, two games an hour apart on Saturday.
const { data: comp } = await admin.from('competitions').insert({
  organiser_id: SPL, name: `${TAG} League`, type: 'season', season: '2026', status: 'active', mode: 'managed', visibility: 'participants', created_by: OWNER,
}).select('id').single()
await admin.from('competition_clubs').insert([
  { competition_id: comp.id, academy_id: NRIFA, status: 'active', joined_at: new Date().toISOString() },
  { competition_id: comp.id, academy_id: RAVENS, status: 'active', joined_at: new Date().toISOString() },
])
const { data: ravTeam } = await admin.from('teams').select('id').eq('academy_id', RAVENS).limit(1).maybeSingle()
const { data: entries } = await admin.from('competition_entries').insert([
  { competition_id: comp.id, academy_id: NRIFA, team_id: U8, display_name: 'NRIFA U8', division: 'U8' },
  { competition_id: comp.id, academy_id: RAVENS, team_id: ravTeam?.id ?? null, display_name: 'Ravens U8', division: 'U8' },
  { competition_id: comp.id, academy_id: null, team_id: null, display_name: 'Visitors U8', division: 'U8' },
]).select('id')
const [nrifa, ravens, visitors] = entries
const sat = new Date()
sat.setDate(sat.getDate() + ((6 - sat.getDay() + 7) % 7 || 7))
sat.setHours(9, 0, 0, 0)
const game1At = sat.toISOString()
const game2At = new Date(sat.getTime() + 60 * 60_000).toISOString()
const game3At = new Date(sat.getTime() + 3 * 60 * 60_000).toISOString()
const { data: fx } = await admin.from('fixtures').insert([
  { competition_id: comp.id, division: 'U8', round: 'Round 1', home_entry_id: nrifa.id, away_entry_id: ravens.id, starts_at: game1At, field_label: 'Field 1', status: 'scheduled', stage: 'group' },
  { competition_id: comp.id, division: 'U8', round: 'Round 1', home_entry_id: visitors.id, away_entry_id: nrifa.id, starts_at: game2At, field_label: 'Field 2', status: 'scheduled', stage: 'group' },
  { competition_id: comp.id, division: 'U8', round: 'Round 1', home_entry_id: ravens.id, away_entry_id: visitors.id, starts_at: game3At, field_label: 'Field 1', status: 'scheduled', stage: 'group' },
]).select('id')
const [game1, game2, game3] = fx.map((r) => r.id)

const official = await signInEmail(OFFICIAL_EMAIL)
const refA = await signInEmail(REF_A_EMAIL)
const refB = await signInEmail(REF_B_EMAIL)
const owner = await signInEmail((await admin.auth.admin.getUserById(RAVENS_OWNER)).data.user.email)
const parent = await signInEmail((await admin.auth.admin.getUserById(PARENT)).data.user.email)
if (!official || !refA || !refB || !owner || !parent) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  await cleanup()
  process.exit(2)
}

head('1. The pool: the official adds two referees; one opens their link')
let poolA, poolB
{
  const { data, error } = await official.rpc('add_referee', { p_competition: comp.id, p_full_name: `Pat Whistle ${TAG}`, p_phone: '0400 000 001', p_grade: 'Level 3' })
  error ? bad(`add: ${error.message}`) : ok('Pat is in the pool')
  poolA = data
  const { data: b } = await official.rpc('add_referee', { p_competition: comp.id, p_full_name: `Sam Flag ${TAG}`, p_grade: 'Level 4' })
  poolB = b
  const { error: notMine } = await owner.rpc('add_referee', { p_competition: comp.id, p_full_name: `Nobody ${TAG}` })
  notMine?.code === '42501' ? ok('a club owner cannot add to the league\'s pool') : bad('a club owner added a referee')
  const { data: pool } = await official.rpc('referee_pool', { p_competition: comp.id })
  const pat = pool.find((r) => r.id === poolA)
  pat && !pat.claimed && pat.claim_token ? ok('the pool shows Pat as not yet claimed, with a link') : bad(JSON.stringify(pat))
  const { data: claimed, error: ce } = await refA.rpc('claim_referee', { p_token: pat.claim_token })
  ce ? bad(`claim: ${ce.message}`) : ok(`Pat opens the link: in ${claimed.league}'s pool`)
  const { error: twice } = await refB.rpc('claim_referee', { p_token: pat.claim_token })
  twice?.code === '42501' ? ok('Sam cannot use Pat\'s link') : bad('a second person claimed the same link')
  const { data: sam } = await admin.from('referees').select('claim_token').eq('id', poolB).single()
  const { error: sce } = await refB.rpc('claim_referee', { p_token: sam.claim_token })
  sce ? bad(`Sam's claim: ${sce.message}`) : ok('Sam opens theirs')
  const { data: pool2 } = await official.rpc('referee_pool', { p_competition: comp.id })
  pool2.find((r) => r.id === poolA)?.claim_token == null ? ok('a claimed link is no longer shown') : bad('the claimed link still shows')
}

head('2. Not free: Sam blocks out the morning; the official sees why')
{
  const { data: refs } = await refB.from('referees').select('id, academy_id').eq('id', poolB)
  const { error } = await refB.from('referee_blockouts').insert({
    referee_id: poolB, academy_id: refs[0].academy_id,
    starts_at: new Date(sat.getTime() - 60 * 60_000).toISOString(), ends_at: new Date(sat.getTime() + 2 * 60 * 60_000).toISOString(), reason: 'exam',
  })
  error ? bad(`blockout: ${error.message}`) : ok('Sam blocks out Saturday morning (exam)')
  const { error: notPat } = await refB.from('referee_blockouts').insert({ referee_id: poolA, academy_id: refs[0].academy_id, starts_at: game1At, ends_at: game2At })
  notPat ? ok('Sam cannot block out Pat') : bad('Sam blocked out Pat')
  const { data: avail } = await official.rpc('referee_availability', { p_fixture: game1 })
  const sam = avail.find((r) => r.id === poolB)
  sam?.unavailable === 'blocked out: exam' ? ok(`for game 1 Sam is "${sam.unavailable}"`) : bad(JSON.stringify(sam))
  avail.find((r) => r.id === poolA)?.unavailable === null ? ok('Pat is free') : bad('Pat shows as unavailable')
  const { error: blocked } = await official.rpc('appoint_referee', { p_fixture: game1, p_referee: poolB })
  blocked?.message.includes('blocked out') ? ok(`asking Sam anyway is refused: "${blocked.message}"`) : bad(`appointing a blocked-out referee: ${blocked?.message ?? 'went through'}`)
}

head('3. Asked: Pat is appointed to game 1 and gets a push; nobody else may appoint')
let appt1
{
  const { error: notOwner } = await owner.rpc('appoint_referee', { p_fixture: game1, p_referee: poolA })
  notOwner?.code === '42501' ? ok('a club owner cannot appoint') : bad('a club owner appointed a referee')
  const { data, error } = await official.rpc('appoint_referee', { p_fixture: game1, p_referee: poolA })
  error ? bad(`appoint: ${error.message}`) : ok('Pat is asked to referee NRIFA v Ravens')
  appt1 = data
  const { data: q } = await admin.from('notification_queue').select('title, body, url, kind').eq('profile_id', refAId).eq('kind', 'referee_appointment')
  q?.length === 1 && q[0].url === '/referee' ? ok(`the push: "${q[0].title}" — ${q[0].body}`) : bad(`pushes to Pat: ${JSON.stringify(q)}`)
  const { error: clash } = await official.rpc('appoint_referee', { p_fixture: game2, p_referee: poolA })
  clash?.message.includes('already on') ? ok(`game 2 an hour later is refused: "${clash.message}"`) : bad(`a double booking: ${clash?.message ?? 'went through'}`)
  const { error: free } = await official.rpc('appoint_referee', { p_fixture: game3, p_referee: poolA })
  free ? bad(`game 3, three hours on: ${free.message}`) : ok('game 3, three hours later, is fine')
  const { error: second } = await official.rpc('appoint_referee', { p_fixture: game3, p_referee: poolB, p_role: 'referee' })
  second?.code === '23505' ? ok('a second referee on game 3 is refused') : bad(`a second referee: ${second?.message ?? 'went through'}`)
  const { error: ar } = await official.rpc('appoint_referee', { p_fixture: game3, p_referee: poolB, p_role: 'assistant' })
  ar ? bad(`assistant on game 3: ${ar.message}`) : ok('Sam is asked to run the line at game 3 (after the exam)')
}

head('4. Answered: Pat says yes, Sam says no, and the official hears both')
{
  const { error: notYours } = await refB.rpc('respond_appointment', { p_appointment: appt1, p_accept: true })
  notYours?.code === '42501' ? ok('Sam cannot answer Pat\'s appointment') : bad('Sam answered for Pat')
  const { error } = await refA.rpc('respond_appointment', { p_appointment: appt1, p_accept: true })
  error ? bad(`accept: ${error.message}`) : ok('Pat accepts')
  const { data: mine } = await refA.rpc('my_appointments')
  const a1 = mine.appointments.find((a) => a.id === appt1)
  a1?.status === 'accepted' && a1.home === 'NRIFA U8' && a1.field === 'Field 1' ? ok(`Pat's page: ${a1.home} v ${a1.away}, ${a1.field}, ${a1.status}`) : bad(JSON.stringify(a1))
  mine.pools.length === 1 && mine.appointments.length === 2 ? ok('one pool, two games on Pat\'s page') : bad(`pools ${mine.pools.length}, games ${mine.appointments.length}`)
  const { data: samMine } = await refB.rpc('my_appointments')
  const samAppt = samMine.appointments.find((a) => a.fixture_id === game3)
  await refB.rpc('respond_appointment', { p_appointment: samAppt.id, p_accept: false, p_note: 'car is in the shop' })
  const { data: q } = await admin.from('notification_queue').select('title, body').eq('profile_id', officialId).eq('kind', 'referee_response').order('created_at')
  q?.length === 2 && q[1].body.includes('car is in the shop') ? ok(`the official hears both: "${q[0].title}" / "${q[1].title} — ${q[1].body.split(' — ')[1]}"`) : bad(JSON.stringify(q))
  const { data: avail } = await official.rpc('referee_availability', { p_fixture: game3 })
  avail.find((r) => r.id === poolB)?.already === 'declined' ? ok('availability for game 3 remembers Sam declined') : bad(JSON.stringify(avail))
}

head('5. Who sees what')
{
  const { data: sheet } = await owner.rpc('competition_run_sheet', { p_competition: comp.id, p_division: 'U8' })
  const row = sheet.find((r) => r.fixture_id === game1)
  row?.referees === `Pat Whistle ${TAG}` ? ok(`Ravens' owner sees "Ref: ${row.referees}" on the run sheet`) : bad(`run sheet referees: ${JSON.stringify(row?.referees)}`)
  const row3 = sheet.find((r) => r.fixture_id === game3)
  row3?.referees === `Pat Whistle ${TAG}?` ? ok('an unanswered ask shows with a ?') : bad(`game 3: ${JSON.stringify(row3?.referees)}`)
  const { data: phones } = await owner.from('referees').select('phone').eq('id', poolA)
  const phoneRows = phones ?? []
  phoneRows.length === 0 ? ok('the club owner cannot read the pool, let alone a phone number') : bad('a club owner read the referee pool')
  const { data: ca } = await owner.rpc('competition_appointments', { p_competition: comp.id, p_division: 'U8' })
  const g1 = ca?.fixtures.find((f) => f.fixture_id === game1)
  g1?.appointments[0]?.name && g1.appointments[0].report == null && ca.summary.length === 0 ? ok('a club sees names and status; no report body, no summary') : bad(JSON.stringify(g1))
  // A parent at an entered club sees the draw, and the referee's name is
  // part of the draw — the same as Dribl's public page. Not the pool.
  const { data: pa } = await parent.rpc('competition_appointments', { p_competition: comp.id })
  pa?.fixtures?.length === 3 && pa.summary.length === 0 ? ok('a parent at NRIFA sees names on the draw, no summary') : bad(`parent: ${JSON.stringify(pa)?.slice(0, 120)}`)
  const { data: ra } = await refB.rpc('competition_appointments', { p_competition: comp.id })
  ra === null ? ok('a referee outside the clubs gets nothing from the competition view (their own page has their games)') : bad('a referee read the whole competition')
  const { data: pp } = await parent.rpc('referee_pool', { p_competition: comp.id })
  pp === null ? ok('a parent gets no pool') : bad('a parent read the pool')
  const { data: oc } = await official.rpc('competition_appointments', { p_competition: comp.id })
  oc.summary.find((s) => s.referee_id === poolA)?.accepted === 1 && oc.summary.find((s) => s.referee_id === poolB)?.declined === 1 ? ok('the official\'s summary: Pat 1 yes, Sam 1 no') : bad(JSON.stringify(oc.summary))
}

head('6. Match day: check-in opens near kick-off; the report comes after')
{
  const { error: early } = await refA.rpc('referee_check_in', { p_appointment: appt1 })
  early?.message.includes('three hours') ? ok('a week out, check-in is closed') : bad(`early check-in: ${early?.message ?? 'went through'}`)
  const { error: earlyReport } = await refA.rpc('submit_referee_report', { p_appointment: appt1, p_report: { notes: 'x' } })
  earlyReport?.message.includes('after the game') ? ok('and the report cannot be written yet') : bad(`early report: ${earlyReport?.message ?? 'went through'}`)
  // Kick-off was forty minutes ago.
  await admin.from('fixtures').update({ starts_at: new Date(Date.now() - 40 * 60_000).toISOString() }).eq('id', game1)
  const { data: at, error } = await refA.rpc('referee_check_in', { p_appointment: appt1 })
  error ? bad(`check-in: ${error.message}`) : ok(`Pat checks in at the ground (${new Date(at).toLocaleTimeString('en-AU')})`)
  const { error: notSam } = await refB.rpc('referee_check_in', { p_appointment: appt1 })
  notSam?.code === '42501' ? ok('Sam cannot check in for Pat') : bad('Sam checked in for Pat')
  const { error: re } = await refA.rpc('submit_referee_report', { p_appointment: appt1, p_report: { home_score: 2, away_score: 1, conduct: 'Good', incidents: 'None', pitch: 'Fine', notes: null } })
  re ? bad(`report: ${re.message}`) : ok('Pat sends the report')
  const { data: oc } = await official.rpc('competition_appointments', { p_competition: comp.id, p_division: 'U8' })
  const a = oc.fixtures.find((f) => f.fixture_id === game1)?.appointments[0]
  a?.checked_in_at && a.report?.home_score === 2 ? ok('the official sees the check-in and reads the report (2–1, Good)') : bad(JSON.stringify(a))
  const { data: cc } = await owner.rpc('competition_appointments', { p_competition: comp.id, p_division: 'U8' })
  const ca = cc.fixtures.find((f) => f.fixture_id === game1)?.appointments[0]
  ca?.checked_in_at && ca.report == null && ca.reported_at ? ok('the club sees that a report exists, not what it says') : bad(JSON.stringify(ca))
}

head('7. Withdrawn: the official takes Pat off game 3, and Pat is told')
{
  const { data: mine } = await refA.rpc('my_appointments')
  const a3 = mine.appointments.find((a) => a.fixture_id === game3)
  const { error } = await official.rpc('withdraw_appointment', { p_appointment: a3.id, p_note: 'game moved to Sunday' })
  error ? bad(`withdraw: ${error.message}`) : ok('withdrawn')
  const { data: q } = await admin.from('notification_queue').select('title, body').eq('profile_id', refAId).eq('kind', 'referee_withdrawn')
  q?.length === 1 && q[0].body.includes('Sunday') ? ok(`Pat's push: "${q[0].title}" — ${q[0].body.split(' — ')[1]}`) : bad(JSON.stringify(q))
  const { error: again } = await official.rpc('appoint_referee', { p_fixture: game3, p_referee: poolA })
  again ? bad(`re-appoint: ${again.message}`) : ok('and can be asked again for the same game (the row is reused)')
  const { data: sheet } = await owner.rpc('competition_run_sheet', { p_competition: comp.id, p_division: 'U8' })
  sheet.find((r) => r.fixture_id === game3)?.referees === `Pat Whistle ${TAG}?` ? ok('the run sheet shows the new ask') : bad('run sheet after re-ask')
}

await cleanup()
console.log(process.exitCode ? '\n\x1b[31mREFEREES ARE WRONG\x1b[0m\n' : '\n\x1b[32mall good\x1b[0m\n')
