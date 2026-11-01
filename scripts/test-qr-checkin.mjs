// Run: node --env-file=.env.local scripts/test-qr-checkin.mjs
//
// W-06: a per-game code the manager shows and the referee scans. The key
// is handed only to the game's managers and the league; it checks in only
// the appointed referee, only inside the window, and a wrong key is
// nothing.
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
const TAG = 'QRCHK'
const REF_EMAIL = 'qrchk-ref@squadroom.invalid'
const REF2_EMAIL = 'qrchk-ref2@squadroom.invalid'

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
  for (const e of [REF_EMAIL, REF2_EMAIL]) {
    const u = users?.users?.find((x) => x.email === e)
    if (u) await admin.auth.admin.deleteUser(u.id)
  }
}
await cleanup()
const { data: r1 } = await admin.auth.admin.createUser({ email: REF_EMAIL, email_confirm: true })
await admin.from('profiles').upsert({ id: r1.user.id, full_name: `Pat Whistle ${TAG}` })
const { data: r2 } = await admin.auth.admin.createUser({ email: REF2_EMAIL, email_confirm: true })
await admin.from('profiles').upsert({ id: r2.user.id, full_name: `Sam Flag ${TAG}` })

const ref = await signInEmail(REF_EMAIL)
const ref2 = await signInEmail(REF2_EMAIL)
const marcus = await signInEmail((await admin.auth.admin.getUserById(MARCUS)).data.user.email)
const parent = await signInEmail((await admin.auth.admin.getUserById(PARENT)).data.user.email)
if (!ref || !ref2 || !marcus || !parent) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  await cleanup()
  process.exit(2)
}
const { data: comp } = await admin.from('competitions').insert({ organiser_id: SPL, name: `${TAG} League`, type: 'season', season: '2026', status: 'active', mode: 'managed', visibility: 'participants', created_by: OWNER }).select('id').single()
await admin.from('competition_clubs').insert({ competition_id: comp.id, academy_id: NRIFA, status: 'active', joined_at: new Date().toISOString() })
const { data: entries } = await admin.from('competition_entries').insert([
  { competition_id: comp.id, academy_id: NRIFA, team_id: U8, display_name: 'NRIFA U8', division: 'U8' },
  { competition_id: comp.id, display_name: 'Visitors U8', division: 'U8' },
]).select('id')
const { data: fx } = await admin.from('fixtures').insert({ competition_id: comp.id, division: 'U8', round: 'R1', home_entry_id: entries[0].id, away_entry_id: entries[1].id, starts_at: new Date(Date.now() + 7 * 864e5).toISOString(), status: 'scheduled', stage: 'group' }).select('id, checkin_key').single()
const { data: poolA } = await admin.from('referees').insert({ academy_id: SPL, profile_id: r1.user.id, full_name: `Pat Whistle ${TAG}`, claimed_at: new Date().toISOString() }).select('id').single()
await admin.from('referees').insert({ academy_id: SPL, profile_id: r2.user.id, full_name: `Sam Flag ${TAG}`, claimed_at: new Date().toISOString() })
await admin.from('referee_appointments').insert({ competition_id: comp.id, fixture_id: fx.id, referee_id: poolA.id, academy_id: SPL, role: 'referee', status: 'accepted' })

head('1. Who gets the code')
{
  const { data: k } = await marcus.rpc('fixture_checkin_key', { p_fixture: fx.id })
  k === fx.checkin_key ? ok("NRIFA's coach, managing the home side, gets the code") : bad(`manager key: ${k}`)
  const { data: pk } = await parent.rpc('fixture_checkin_key', { p_fixture: fx.id })
  pk === null ? ok('a parent does not') : bad('a parent got the check-in key')
  const { data: rk } = await ref.rpc('fixture_checkin_key', { p_fixture: fx.id })
  rk === null ? ok('nor does the referee — it is shown to them, not held by them') : bad('the referee got the key')
}

head('2. Scanning it')
{
  const { error: early } = await ref.rpc('referee_check_in_by_key', { p_fixture: fx.id, p_key: fx.checkin_key })
  early?.message.includes('three hours') ? ok('a week out, the code does nothing yet') : bad(`early: ${early?.message ?? 'checked in'}`)
  await admin.from('fixtures').update({ starts_at: new Date(Date.now() - 20 * 60_000).toISOString() }).eq('id', fx.id)
  const { error: wrong } = await ref.rpc('referee_check_in_by_key', { p_fixture: fx.id, p_key: '00000000-0000-0000-0000-000000000000' })
  wrong?.code === '22023' ? ok('a wrong code is refused') : bad(`wrong key: ${wrong?.message ?? 'checked in'}`)
  const { error: notAppointed } = await ref2.rpc('referee_check_in_by_key', { p_fixture: fx.id, p_key: fx.checkin_key })
  notAppointed?.code === '42501' ? ok('a referee not appointed to this game cannot use it') : bad(`other referee: ${notAppointed?.message ?? 'checked in'}`)
  const { error: parentErr } = await parent.rpc('referee_check_in_by_key', { p_fixture: fx.id, p_key: fx.checkin_key })
  parentErr?.code === '42501' ? ok('a parent with a screenshot of it cannot either') : bad('a parent checked in')
  const { data, error } = await ref.rpc('referee_check_in_by_key', { p_fixture: fx.id, p_key: fx.checkin_key })
  error ? bad(`check in: ${error.message}`) : ok(`Pat scans it: checked in to ${data.game}`)
  const { data: ap } = await admin.from('referee_appointments').select('checked_in_at').eq('fixture_id', fx.id).eq('referee_id', poolA.id).single()
  ap?.checked_in_at ? ok('the appointment carries the check-in time, same as a tap would') : bad('no checked_in_at')
  const { data: again } = await ref.rpc('referee_check_in_by_key', { p_fixture: fx.id, p_key: fx.checkin_key })
  again?.checked_in_at === ap.checked_in_at ? ok('scanning twice keeps the first time') : bad('a second scan moved the time')
}

await cleanup()
console.log(process.exitCode ? '\n\x1b[31mQR CHECK-IN IS WRONG\x1b[0m\n' : '\n\x1b[32mall good\x1b[0m\n')
