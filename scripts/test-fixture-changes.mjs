// Run: node --env-file=.env.local scripts/test-fixture-changes.mjs
//
// W-07: a club proposes a change to a game, the other club agrees or
// declines, the league decides — approval moves the game through the
// ordinary reschedule so every family hears. A notes thread between the
// managers that a parent never sees. And the overdue-fee block: on, a
// family with a fee past due cannot say yes until it is paid.
import { createClient } from '@supabase/supabase-js'
import { signInClient } from './_auth.mjs'

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
const RAVENS_OWNER = '00000000-0000-0000-0000-0000000000c1'
const PARENT = '00000000-0000-0000-0000-0000000000b1'
const MARCUS = '00000000-0000-0000-0000-0000000000a2'
const U8 = '00000000-0000-0000-0000-0000000d0008'
const RAVENS_U8 = '00000000-0000-0000-0000-0000000d0099'
const TAG = 'FXCHG'
const OFFICIAL_EMAIL = 'fxchg-official@squadroom.invalid'

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
  await admin.from('notification_queue').delete().like('kind', 'fixture_change_%')
  const { data: reqs } = await admin.from('payment_requests').select('id').like('title', `${TAG} %`)
  for (const r of reqs ?? []) {
    await admin.from('payments').delete().eq('request_id', r.id)
    await admin.from('payment_requests').delete().eq('id', r.id)
  }
  await admin.from('events').delete().like('title', `${TAG} %`)
  await admin.from('academies').update({ block_rsvp_when_overdue: false, overdue_grace_days: 14 }).eq('id', NRIFA)
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const u = users?.users?.find((x) => x.email === OFFICIAL_EMAIL)
  if (u) {
    await admin.from('academy_members').delete().eq('profile_id', u.id)
    await admin.from('staff_clearances').delete().eq('profile_id', u.id)
    await admin.auth.admin.deleteUser(u.id)
  }
}
await cleanup()

const { data: offUser } = await admin.auth.admin.createUser({ email: OFFICIAL_EMAIL, email_confirm: true })
await admin.from('profiles').upsert({ id: offUser.user.id, full_name: 'Olive Official' })
await admin.from('staff_clearances').insert({ academy_id: SPL, profile_id: offUser.user.id, kind: 'wwcc', number: 'WWC0000783E', outcome: 'cleared', expires_on: new Date(Date.now() + 400 * 864e5).toISOString().slice(0, 10), verified_by: OWNER })
await admin.from('academy_members').insert({ academy_id: SPL, profile_id: offUser.user.id, role: 'admin', status: 'active' })

const official = await signInEmail(OFFICIAL_EMAIL)
// NRIFA's owner also owns the SPL in the seed, so NRIFA's manager here is Marcus, the U8 coach.
const nrifa = await signInEmail((await admin.auth.admin.getUserById(MARCUS)).data.user.email)
const ravens = await signInEmail((await admin.auth.admin.getUserById(RAVENS_OWNER)).data.user.email)
const parent = await signInEmail((await admin.auth.admin.getUserById(PARENT)).data.user.email)
if (!official || !nrifa || !ravens || !parent) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  await cleanup()
  process.exit(2)
}

const { data: comp } = await admin.from('competitions').insert({ organiser_id: SPL, name: `${TAG} League`, type: 'season', season: '2026', status: 'active', mode: 'managed', visibility: 'participants', created_by: offUser.user.id }).select('id').single()
await admin.from('competition_clubs').insert([
  { competition_id: comp.id, academy_id: NRIFA, status: 'active', joined_at: new Date().toISOString() },
  { competition_id: comp.id, academy_id: RAVENS, status: 'active', joined_at: new Date().toISOString() },
])
const { data: entries } = await admin.from('competition_entries').insert([
  { competition_id: comp.id, academy_id: NRIFA, team_id: U8, display_name: 'NRIFA U8', division: 'U8' },
  { competition_id: comp.id, academy_id: RAVENS, team_id: RAVENS_U8, display_name: 'Ravens U8', division: 'U8' },
]).select('id')
const [home, away] = entries
const sat = new Date(); sat.setDate(sat.getDate() + ((6 - sat.getDay() + 7) % 7 || 7)); sat.setHours(9, 0, 0, 0)
const { data: fx } = await admin.from('fixtures').insert({ competition_id: comp.id, division: 'U8', round: 'R1', home_entry_id: home.id, away_entry_id: away.id, starts_at: sat.toISOString(), venue_label: 'Nolan Reserve', field_label: 'Field 1', status: 'scheduled', stage: 'group' }).select('id').single()
const sunday2pm = new Date(sat.getTime() + 29 * 3600_000).toISOString()

head('1. Ravens propose Sunday 2pm; NRIFA hears; a parent sees nothing')
let req1
{
  const { error: notYours } = await parent.rpc('propose_fixture_change', { p_fixture: fx.id, p_reason: 'bus', p_starts_at: sunday2pm })
  notYours?.code === '42501' ? ok('a parent cannot propose') : bad('a parent proposed a change')
  const { error: why } = await ravens.rpc('propose_fixture_change', { p_fixture: fx.id, p_reason: '  ', p_starts_at: sunday2pm })
  why ? ok('no reason, no request') : bad('a request with no reason went through')
  const { data, error } = await ravens.rpc('propose_fixture_change', { p_fixture: fx.id, p_reason: 'Our bus is booked for a carnival on the Saturday', p_starts_at: sunday2pm, p_venue: 'Magdala Park' })
  error ? bad(`propose: ${error.message}`) : ok('Ravens propose Sunday 2pm at Magdala Park')
  req1 = data
  const { error: twice } = await ravens.rpc('propose_fixture_change', { p_fixture: fx.id, p_reason: 'again', p_starts_at: sunday2pm })
  twice?.code === '23505' ? ok('a second proposal on the same game waits for the first') : bad('two open proposals on one game')
  const { data: q } = await admin.from('notification_queue').select('profile_id, title, body').eq('kind', 'fixture_change_proposed')
  const toNrifa = (q ?? []).filter((p) => p.profile_id === OWNER)
  toNrifa.length === 1 && /Ravens U8 want to move/.test(toNrifa[0].title) ? ok(`NRIFA's owner is told: "${toNrifa[0].title}"`) : bad(JSON.stringify(q))
  const { data: pList } = await parent.rpc('fixture_change_requests', { p_competition: comp.id })
  const parentRows = pList ?? []
  parentRows.length === 0 ? ok('a parent sees no requests') : bad('a parent read the change requests')
  const { data: nList } = await nrifa.rpc('fixture_change_requests', { p_competition: comp.id })
  nList?.[0]?.theirs === true && nList[0].mine === false ? ok("NRIFA's list says it is theirs to answer") : bad(JSON.stringify(nList))
}

head('2. NRIFA declines with a note; Ravens try again; both agree; the league rejects, then approves the third')
let req3
{
  const { error: notOther } = await ravens.rpc('answer_fixture_change', { p_request: req1, p_agree: true })
  notOther?.code === '42501' ? ok('the proposer cannot answer their own request') : bad('the proposer answered')
  const { error } = await nrifa.rpc('answer_fixture_change', { p_request: req1, p_agree: false, p_note: 'Sunday is our presentation day' })
  error ? bad(`decline: ${error.message}`) : ok('NRIFA decline: "Sunday is our presentation day"')
  const { data: q } = await admin.from('notification_queue').select('profile_id, title, body').eq('kind', 'fixture_change_answered').eq('profile_id', RAVENS_OWNER)
  const answered = q ?? []
  answered.length === 1 && /can't do that time/.test(answered[0].title) ? ok(`Ravens are told: "${answered[0].title} — ${answered[0].body}"`) : bad(JSON.stringify(q))
  const friday = new Date(sat.getTime() - 15 * 3600_000).toISOString()
  const { data: r2 } = await ravens.rpc('propose_fixture_change', { p_fixture: fx.id, p_reason: 'Friday night under lights then?', p_starts_at: friday })
  await nrifa.rpc('add_fixture_change_note', { p_request: r2, p_body: 'Lights cost us $120 — can the league cover it?' })
  await ravens.rpc('add_fixture_change_note', { p_request: r2, p_body: 'We will split it.' })
  const { error: agree } = await nrifa.rpc('answer_fixture_change', { p_request: r2, p_agree: true })
  agree ? bad(`agree: ${agree.message}`) : ok('Friday under lights: notes exchanged, NRIFA agree')
  const { error: parentNote } = await parent.rpc('add_fixture_change_note', { p_request: r2, p_body: 'hi' })
  parentNote?.code === '42501' ? ok('a parent cannot write in the thread') : bad('a parent wrote a note')
  const { error: notLeague } = await nrifa.rpc('decide_fixture_change', { p_request: r2, p_approve: true })
  notLeague?.code === '42501' ? ok('a club cannot decide') : bad('a club decided a change')
  const { error: rej } = await official.rpc('decide_fixture_change', { p_request: r2, p_approve: false, p_note: 'No floodlit games in U8' })
  rej ? bad(`reject: ${rej.message}`) : ok('the league rejects: no floodlit games in U8')
  const { data: list } = await official.rpc('fixture_change_requests', { p_competition: comp.id })
  const rr2 = list.find((r) => r.id === r2)
  rr2?.status === 'rejected' && rr2.notes.length === 2 && rr2.decision_note ? ok('the league sees the whole thread and its own decision') : bad(JSON.stringify(rr2))
  // Third time: Saturday 11am, same ground.
  const eleven = new Date(sat.getTime() + 2 * 3600_000).toISOString()
  const { data: r3 } = await ravens.rpc('propose_fixture_change', { p_fixture: fx.id, p_reason: 'Saturday 11am then — bus is back by 10', p_starts_at: eleven })
  req3 = r3
  const { error: early } = await official.rpc('decide_fixture_change', { p_request: r3, p_approve: true })
  early ? ok('the league cannot approve before the other team agrees') : bad('approved before agreement')
  await nrifa.rpc('answer_fixture_change', { p_request: r3, p_agree: true, p_note: 'Fine by us' })
  const { data: evBefore } = await admin.from('events').select('id').eq('competition_id', comp.id).eq('academy_id', NRIFA)
  const { error: appr } = await official.rpc('decide_fixture_change', { p_request: r3, p_approve: true, p_note: 'Approved' })
  appr ? bad(`approve: ${appr.message}`) : ok('both agree; the league approves')
  const { data: moved } = await admin.from('fixtures').select('starts_at, venue_label').eq('id', fx.id).single()
  moved && new Date(moved.starts_at).getTime() === new Date(eleven).getTime() ? ok('the game is at 11am now, through the ordinary reschedule') : bad(JSON.stringify(moved))
  const evIds = (evBefore ?? []).map((e) => e.id)
  const { data: pushes } = await admin.from('notification_queue').select('kind').in('kind', ['event_changed', 'event_back_on']).in('payload->>event_id', evIds).eq('profile_id', PARENT)
  const pushRows = pushes ?? []
  pushRows.length >= 1 ? ok('the U8 parent is told the game moved') : bad('no push to the parent after the move')
  const { data: dec } = await admin.from('notification_queue').select('profile_id').eq('kind', 'fixture_change_decided')
  const decided = dec ?? []
  decided.some((p) => p.profile_id === MARCUS) && decided.some((p) => p.profile_id === RAVENS_OWNER) ? ok('both managers are told the league moved it') : bad(JSON.stringify(decided))
}

head('3. Withdraw')
{
  const { data: r4 } = await ravens.rpc('propose_fixture_change', { p_fixture: fx.id, p_reason: 'typo', p_venue: 'Elsewhere' })
  const { error: notYours } = await nrifa.rpc('withdraw_fixture_change', { p_request: r4 })
  notYours?.code === '42501' ? ok('only the proposer withdraws') : bad('the other team withdrew it')
  const { error } = await ravens.rpc('withdraw_fixture_change', { p_request: r4 })
  error ? bad(`withdraw: ${error.message}`) : ok('Ravens withdraw their own')
}

head('4. Overdue fees block a "yes", where the club turns it on')
{
  const { data: ev } = await admin.from('events').insert({ academy_id: NRIFA, team_id: U8, type: 'training', title: `${TAG} Training`, starts_at: new Date(Date.now() + 3 * 864e5).toISOString(), ends_at: new Date(Date.now() + 3 * 864e5 + 3600_000).toISOString(), created_by: OWNER }).select('id').single()
  const { data: kid } = await admin.from('player_guardians').select('player_id').eq('profile_id', PARENT).limit(1).single()
  // A 'no' needs a reason (an older rule); the block is about 'yes'.
  const rsvp = (status) => parent.from('event_rsvps').upsert({ academy_id: NRIFA, event_id: ev.id, profile_id: PARENT, player_id: kid.player_id, status, note: status === 'no' ? 'away that weekend' : null }, { onConflict: 'event_id,profile_id,player_id' })
  // The seed carries older unpaid U8 fees, which would make the family overdue
  // whatever this test does. Parked for the duration, put back afterwards.
  const cutoff = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10)
  const { data: parked } = await admin.from('payment_requests').select('id').eq('academy_id', NRIFA).is('archived_at', null).eq('per_player', true).lt('due_on', cutoff)
  const parkedIds = (parked ?? []).map((r) => r.id)
  if (parkedIds.length) await admin.from('payment_requests').update({ archived_at: new Date().toISOString() }).in('id', parkedIds)
  const { data: pr } = await admin.from('payment_requests').insert({ academy_id: NRIFA, team_id: U8, title: `${TAG} Term fee`, amount_cents: 5000, per_player: true, due_on: new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10), created_by: OWNER }).select('id').single()
  const { error: off } = await rsvp('yes')
  off ? bad(`rsvp with the block off: ${off.message}`) : ok('block off: a family 30 days overdue can still say yes')
  await admin.from('academies').update({ block_rsvp_when_overdue: true, overdue_grace_days: 14 }).eq('id', NRIFA)
  const { error: on } = await rsvp('yes')
  on && /overdue/.test(on.message) ? ok(`block on: "${on.message}"`) : bad(`block on: ${on?.message ?? 'yes went through'}`)
  const { error: no } = await rsvp('no')
  no ? bad(`a no was blocked: ${no.message}`) : ok('they can still say no')
  await admin.from('academies').update({ overdue_grace_days: 60 }).eq('id', NRIFA)
  const { error: grace } = await rsvp('yes')
  grace ? bad(`inside a 60-day grace: ${grace.message}`) : ok('inside a 60-day grace period, yes is fine')
  await admin.from('academies').update({ overdue_grace_days: 14 }).eq('id', NRIFA)
  // The fee is per player on the U8s, and this family has two of them there.
  const { data: kids } = await admin.from('player_guardians').select('player_id, players!inner(team_id)').eq('profile_id', PARENT).eq('players.team_id', U8)
  for (const k of kids ?? []) {
    const { data: quote } = await parent.rpc('quote_payment', { p_request: pr.id, p_player: k.player_id })
    const { error: payErr } = await admin.from('payments').insert({ academy_id: NRIFA, request_id: pr.id, profile_id: PARENT, player_id: k.player_id, amount_cents: quote.net_cents, status: 'paid', paid_at: new Date().toISOString(), instalment_seq: 1 })
    if (payErr) console.log('   (payment insert:', payErr.message + ')')
  }
  ok(`the family pays for ${(kids ?? []).length} children`)
  const { error: paid } = await rsvp('yes')
  paid ? bad(`after paying: ${paid.message}`) : ok('paid, and yes goes through')
  if (parkedIds.length) await admin.from('payment_requests').update({ archived_at: null }).in('id', parkedIds)
}

await cleanup()
console.log(process.exitCode ? '\n\x1b[31mGAME CHANGES ARE WRONG\x1b[0m\n' : '\n\x1b[32mall good\x1b[0m\n')
