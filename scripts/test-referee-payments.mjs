// Run: node --env-file=.env.local scripts/test-referee-payments.mjs
//
// L-07: match fees per role, a payment run built from the games referees
// checked in to, marked paid by bank transfer, exported; the referee sees
// what they are owed and what was paid. The Stripe transfer itself waits
// on a key, and the route says so plainly.
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
const RAVENS_OWNER = '00000000-0000-0000-0000-0000000000c1'
const U8 = '00000000-0000-0000-0000-0000000d0008'
const TAG = 'REFPAY'
const OFFICIAL_EMAIL = 'refpay-official@squadroom.invalid'
const REF_EMAIL = 'refpay-ref@squadroom.invalid'

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
  for (const e of [OFFICIAL_EMAIL, REF_EMAIL]) {
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
await admin.from('staff_clearances').insert({ academy_id: SPL, profile_id: officialId, kind: 'wwcc', number: 'WWC0000779E', outcome: 'cleared', expires_on: new Date(Date.now() + 400 * 864e5).toISOString().slice(0, 10), verified_by: OWNER })
await admin.from('academy_members').insert({ academy_id: SPL, profile_id: officialId, role: 'admin', status: 'active' })
const refId = await makeUser(REF_EMAIL, `Pat Whistle ${TAG}`)

const { data: comp } = await admin.from('competitions').insert({ organiser_id: SPL, name: `${TAG} League`, type: 'season', season: '2026', status: 'active', mode: 'managed', visibility: 'participants', created_by: OWNER }).select('id').single()
await admin.from('competition_clubs').insert([
  { competition_id: comp.id, academy_id: NRIFA, status: 'active', joined_at: new Date().toISOString() },
  { competition_id: comp.id, academy_id: RAVENS, status: 'active', joined_at: new Date().toISOString() },
])
const { data: entries } = await admin.from('competition_entries').insert([
  { competition_id: comp.id, academy_id: NRIFA, team_id: U8, display_name: 'NRIFA U8', division: 'U8' },
  { competition_id: comp.id, academy_id: RAVENS, team_id: null, display_name: 'Ravens U8', division: 'U8' },
]).select('id')
const [home, away] = entries
// Two games last Saturday, one next Saturday.
const lastSat = new Date(); lastSat.setDate(lastSat.getDate() - ((lastSat.getDay() + 1) % 7 || 7)); lastSat.setHours(9, 0, 0, 0)
const nextSat = new Date(lastSat.getTime() + 7 * 864e5)
const { data: fx } = await admin.from('fixtures').insert([
  { competition_id: comp.id, division: 'U8', round: 'R1', home_entry_id: home.id, away_entry_id: away.id, starts_at: lastSat.toISOString(), status: 'final', home_score: 1, away_score: 0, stage: 'group' },
  { competition_id: comp.id, division: 'U8', round: 'R1', home_entry_id: away.id, away_entry_id: home.id, starts_at: new Date(lastSat.getTime() + 3 * 3600_000).toISOString(), status: 'final', home_score: 2, away_score: 2, stage: 'group' },
  { competition_id: comp.id, division: 'U8', round: 'R2', home_entry_id: home.id, away_entry_id: away.id, starts_at: nextSat.toISOString(), status: 'scheduled', stage: 'group' },
]).select('id')
const { data: pool } = await admin.from('referees').insert({ academy_id: SPL, profile_id: refId, full_name: `Pat Whistle ${TAG}`, grade: 'Level 3', claimed_at: new Date().toISOString() }).select('id').single()
// Pat refereed both of last Saturday's games and checked in to the first only; is asked for next week.
const { data: appts } = await admin.from('referee_appointments').insert([
  { competition_id: comp.id, fixture_id: fx[0].id, referee_id: pool.id, academy_id: SPL, role: 'referee', status: 'accepted', checked_in_at: lastSat.toISOString() },
  { competition_id: comp.id, fixture_id: fx[1].id, referee_id: pool.id, academy_id: SPL, role: 'assistant', status: 'accepted' },
  { competition_id: comp.id, fixture_id: fx[2].id, referee_id: pool.id, academy_id: SPL, role: 'referee', status: 'offered' },
]).select('id')

const official = await signInEmail(OFFICIAL_EMAIL)
const ref = await signInEmail(REF_EMAIL)
const club = await signInEmail((await admin.auth.admin.getUserById(RAVENS_OWNER)).data.user.email)
if (!official || !ref || !club) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  await cleanup()
  process.exit(2)
}

head('1. Fees per role, set by the league')
{
  const { error: notClub } = await club.rpc('set_referee_fee', { p_competition: comp.id, p_role: 'referee', p_fee_cents: 5000 })
  notClub?.code === '42501' ? ok('a club cannot set the league\'s fees') : bad(`a club set a fee: ${notClub?.message ?? 'no error'}`)
  const { error: tooMuch } = await official.rpc('set_referee_fee', { p_competition: comp.id, p_role: 'referee', p_fee_cents: 500000 })
  tooMuch ? ok('a $5,000 match fee is refused') : bad('a $5,000 fee went through')
  const { error: e1 } = await official.rpc('set_referee_fee', { p_competition: comp.id, p_role: 'referee', p_fee_cents: 4500 })
  const { error: e2 } = await official.rpc('set_referee_fee', { p_competition: comp.id, p_role: 'assistant', p_fee_cents: 2500 })
  e1 || e2 ? bad(`fees: ${e1?.message ?? e2?.message}`) : ok('referee $45, assistant $25')
  const { data: p } = await official.rpc('referee_payments', { p_competition: comp.id })
  p?.fees?.referee === 4500 && p.unpaid.length === 1 && p.unpaid[0].fee_cents === 4500 ? ok('owed: one game (the checked-in one), $45') : bad(JSON.stringify(p?.unpaid))
  const { data: cp } = await club.rpc('referee_payments', { p_competition: comp.id })
  cp === null ? ok('a club sees none of it') : bad('a club read the league\'s referee payments')
}

head('2. The referee sees the fee against each game')
{
  const { data: mine } = await ref.rpc('my_appointments')
  const g1 = mine.appointments.find((a) => a.id === appts[0].id)
  const g2 = mine.appointments.find((a) => a.id === appts[1].id)
  g1?.fee_cents === 4500 && g1.paid_at === null && g2?.fee_cents === 2500 ? ok('$45 for the game refereed, $25 for the line, neither paid') : bad(JSON.stringify([g1, g2]))
  const { error } = await ref.rpc('set_my_bank_details', { p_referee: pool.id, p_details: 'P Whistle 062-000 1234 5678' })
  error ? bad(`bank: ${error.message}`) : ok('Pat gives bank details')
  const { error: notYours } = await club.rpc('set_my_bank_details', { p_referee: pool.id, p_details: 'hijack' })
  notYours?.code === '42501' ? ok('nobody else can change them') : bad('somebody else set Pat\'s bank details')
  const { data: seen } = await club.from('referees').select('bank_details').eq('id', pool.id)
  const seenRows = seen ?? []
  seenRows.length === 0 ? ok('and a club cannot read them') : bad('a club read bank details')
}

head('3. A run for last week: the checked-in game only')
let runId
{
  const from = lastSat.toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' })
  const { error: notClub } = await club.rpc('build_referee_payment_run', { p_competition: comp.id, p_from: from, p_to: from })
  notClub?.code === '42501' ? ok('a club cannot build a run') : bad('a club built a run')
  const { data, error } = await official.rpc('build_referee_payment_run', { p_competition: comp.id, p_from: from, p_to: from })
  error ? bad(`build: ${error.message}`) : ok('the league builds a run for Saturday')
  runId = data
  const { data: p } = await official.rpc('referee_payments', { p_competition: comp.id })
  const run = p.runs.find((r) => r.id === runId)
  run?.total_cents === 4500 && run.by_referee[0].games === 1 && run.by_referee[0].bank_details?.includes('062-000') ? ok('one game, $45, with Pat\'s bank details for the treasurer') : bad(JSON.stringify(run))
  p.unpaid.length === 0 ? ok('nothing left owed outside a run') : bad(`unpaid: ${p.unpaid.length}`)
  const { data: again } = await official.rpc('build_referee_payment_run', { p_competition: comp.id, p_from: from, p_to: from })
  again === null ? ok('building again for the same week finds nothing — no double pay') : bad('a second run was built for the same games')
  // The no-show game: Pat checks in late to the second game, and the fee changes.
  await admin.from('referee_appointments').update({ checked_in_at: lastSat.toISOString() }).eq('id', appts[1].id)
  await official.rpc('set_referee_fee', { p_competition: comp.id, p_role: 'assistant', p_fee_cents: 3000 })
  const { data: run2 } = await official.rpc('build_referee_payment_run', { p_competition: comp.id, p_from: from, p_to: from })
  const { data: p2 } = await official.rpc('referee_payments', { p_competition: comp.id })
  const r2 = p2.runs.find((r) => r.id === run2)
  r2?.total_cents === 3000 ? ok('a later check-in lands in the next run at the fee in force then ($30)') : bad(JSON.stringify(r2))
  const { error: v } = await official.rpc('void_referee_run', { p_run: run2 })
  v ? bad(`void: ${v.message}`) : ok('a draft run can be voided')
  const { data: p3 } = await official.rpc('referee_payments', { p_competition: comp.id })
  p3.unpaid.length === 1 && p3.runs.length === 1 ? ok('its game is owed again') : bad(`after void: unpaid ${p3.unpaid.length}, runs ${p3.runs.length}`)
}

head('4. Paid by bank transfer; the referee sees it; the export has it')
{
  const { error: notClub } = await club.rpc('mark_referee_run_paid', { p_run: runId, p_method: 'bank' })
  notClub?.code === '42501' ? ok('a club cannot mark a run paid') : bad('a club marked a run paid')
  const { error } = await official.rpc('mark_referee_run_paid', { p_run: runId, p_method: 'bank' })
  error ? bad(`paid: ${error.message}`) : ok('the treasurer marks it paid by bank transfer')
  const { error: locked } = await official.rpc('void_referee_run', { p_run: runId })
  locked ? ok('a paid run cannot be voided') : bad('a paid run was voided')
  const { data: mine } = await ref.rpc('my_appointments')
  const g1 = mine.appointments.find((a) => a.id === appts[0].id)
  g1?.paid_at && g1.fee_cents === 4500 ? ok('Pat\'s page: $45, paid') : bad(JSON.stringify(g1))
  const { data: rows, error: xe } = await official.rpc('referee_payments_export', { p_competition: comp.id })
  xe ? bad(`export: ${xe.message}`) : rows.length === 1 && rows[0].amount_cents === 4500 && rows[0].item_status === 'paid' && rows[0].paid_method === 'bank' ? ok('the CSV source: one paid row, $45, by bank') : bad(JSON.stringify(rows))
  const { data: crow } = await club.rpc('referee_payments_export', { p_competition: comp.id })
  const clubRows = crow ?? []
  clubRows.length === 0 ? ok('a club gets an empty export') : bad('a club exported the league\'s payments')
}

await cleanup()
console.log(process.exitCode ? '\n\x1b[31mREFEREE PAYMENTS ARE WRONG\x1b[0m\n' : '\n\x1b[32mall good\x1b[0m\n')
