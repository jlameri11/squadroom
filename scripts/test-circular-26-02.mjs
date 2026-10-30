// Run: node --env-file=.env.local scripts/test-circular-26-02.mjs
//
// R-18: PlayFootball first. A program that requires official registration
// will not accept a child until the club has confirmed it — on the request
// by hand, or by importing the club's own PlayFootball export. The gate
// holds in the approve route and in the database. FFA number and FIFA ID
// are captured and carried onto the roster. A program without the switch
// is untouched.
import { createClient } from '@supabase/supabase-js'
import { resolveBaseUrl } from './_base-url.mjs'

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
const OWNER = '00000000-0000-0000-0000-0000000000a1'
const PARENT = '00000000-0000-0000-0000-0000000000b1'
const TAG = 'C2602'

async function signInEmail(email) {
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (!link?.properties?.hashed_token) return null
  const client = createClient(URL_, PUB, { auth: { persistSession: false } })
  const { data } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
  return data?.session ? { client, session: data.session } : null
}
function cookieFor(session) {
  const ref = URL_.split('//')[1].split('.')[0]
  return `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString('base64')}`
}

async function cleanup() {
  const { data: reqs } = await admin.from('registration_requests').select('id, profile_id').like('child_name', `% ${TAG}`)
  for (const r of reqs ?? []) {
    if (r.profile_id) await admin.auth.admin.deleteUser(r.profile_id).catch(() => {})
  }
  await admin.from('registration_requests').delete().like('child_name', `% ${TAG}`)
  await admin.from('players').delete().like('full_name', `% ${TAG}`)
  await admin.from('programs').delete().like('name', `${TAG} %`)
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const u = users?.users?.find((x) => x.phone === '61400002602' || x.email?.startsWith('61400002602'))
  if (u) await admin.auth.admin.deleteUser(u.id)
}
await cleanup()

const owner = await signInEmail((await admin.auth.admin.getUserById(OWNER)).data.user.email)
const parent = await signInEmail((await admin.auth.admin.getUserById(PARENT)).data.user.email)
if (!owner || !parent) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}
const BASE = await resolveBaseUrl({ quiet: true })

const { data: strict } = await admin.from('programs').insert({ academy_id: NRIFA, name: `${TAG} SPL squad`, kind: 'squad', status: 'open', season: '2026', requires_official_rego: true }).select('id').single()
const { data: loose } = await admin.from('programs').insert({ academy_id: NRIFA, name: `${TAG} Holiday camp`, kind: 'camp', status: 'open', season: '2026' }).select('id').single()

head('1. The switch is per program, and the public form sees it')
{
  const anon = createClient(URL_, PUB, { auth: { persistSession: false } })
  const { data } = await anon.rpc('public_programs', { p_slug: 'nrifa' })
  const s = data.programs.find((p) => p.id === strict.id)
  const l = data.programs.find((p) => p.id === loose.id)
  s?.requires_official_rego === true && l?.requires_official_rego === false ? ok('the squad needs PlayFootball; the camp does not') : bad(JSON.stringify([s, l]))
  const { error } = await parent.client.from('programs').update({ requires_official_rego: false }).eq('id', strict.id)
  const { data: still } = await admin.from('programs').select('requires_official_rego').eq('id', strict.id).single()
  still.requires_official_rego ? ok('a parent cannot switch it off') : bad(`a parent switched it off (${error?.message ?? 'no error'})`)
}

head('2. The database refuses an approved registration for an unconfirmed child')
let kid
{
  const { data: p } = await admin.from('players').insert({ academy_id: NRIFA, full_name: `Unconfirmed Kid ${TAG}`, dob: '2017-03-03' }).select('id').single()
  kid = p.id
  const { error } = await admin.from('program_registrations').insert({ academy_id: NRIFA, program_id: strict.id, player_id: kid, status: 'approved', submitted_by: OWNER })
  error?.code === '23514' ? ok(`refused: "${error.message}"`) : bad(`approved an unconfirmed child: ${error?.message ?? 'no error'}`)
  const { error: campOk } = await admin.from('program_registrations').insert({ academy_id: NRIFA, program_id: loose.id, player_id: kid, status: 'approved', submitted_by: OWNER })
  campOk ? bad(`the camp refused too: ${campOk.message}`) : ok('the camp accepts the same child — no switch, no gate')
  await admin.from('players').update({ official_status: 'registered' }).eq('id', kid)
  const { error: now } = await admin.from('program_registrations').insert({ academy_id: NRIFA, program_id: strict.id, player_id: kid, status: 'approved', submitted_by: OWNER })
  now ? bad(`still refused after registration: ${now.message}`) : ok('once registered in PlayFootball, the squad accepts them')
  const { error: pending } = await admin.from('program_registrations').insert({ academy_id: NRIFA, program_id: strict.id, player_id: kid, status: 'pending', submitted_by: OWNER })
  // A second row for the same program and player is a conflict, not a gate check — so use a fresh child.
  const { data: p2 } = await admin.from('players').insert({ academy_id: NRIFA, full_name: `Pending Kid ${TAG}`, dob: '2017-04-04' }).select('id').single()
  const { error: pend2 } = await admin.from('program_registrations').insert({ academy_id: NRIFA, program_id: strict.id, player_id: p2.id, status: 'pending', submitted_by: OWNER })
  pend2 ? bad(`a pending registration was refused: ${pend2.message}`) : ok('a pending registration is fine — the gate is on approval only')
  void pending
}

head('3. A family registers with their FFA number; the club confirms; the route accepts')
let reqId
{
  // The club's required agreements, as the form would send them.
  const { data: pub } = await createClient(URL_, PUB, { auth: { persistSession: false } }).rpc('public_programs', { p_slug: 'nrifa' })
  const consents = (pub?.consents ?? []).map((c) => ({ id: c.id, version: c.version }))
  const res = await fetch(`${BASE}/api/register/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug: 'nrifa', programId: strict.id, guardianName: 'Casey Guardian', guardianPhone: '0400 002 602', childName: `Riley Form ${TAG}`, childDob: '2018-05-05', childFfa: '1234 5678', childFifa: 'abc', consents }),
  })
  res.status === 400 ? ok('a FIFA ID that is not digits is refused by the form route') : bad(`bad FIFA ID: ${res.status}`)
  const res2 = await fetch(`${BASE}/api/register/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug: 'nrifa', programId: strict.id, guardianName: 'Casey Guardian', guardianPhone: '0400 002 602', childName: `Riley Form ${TAG}`, childDob: '2018-05-05', childFfa: '1234 5678', consents }),
  })
  res2.ok ? ok('the family registers with FFA 12345678') : bad(`request: ${res2.status} ${await res2.text()}`)
  const { data: req } = await admin.from('registration_requests').select('id, ffa_number, fifa_id, official_confirmed_at').like('child_name', `Riley Form ${TAG}`).single()
  reqId = req?.id
  req?.ffa_number === '12345678' && req.fifa_id === null ? ok('the request carries the FFA number, spaces dropped') : bad(JSON.stringify(req))

  const { data: queue } = await owner.client.rpc('registration_queue', { p_academy: NRIFA, p_status: 'pending' })
  const row = queue.find((r) => r.request_id === reqId)
  row?.requires_official === true && row.official_confirmed_at === null && row.ffa_number === '12345678' ? ok('the queue says: needs PlayFootball, not confirmed') : bad(JSON.stringify(row))

  const approve = (cookie) => fetch(`${BASE}/api/register/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ requestId: reqId, decision: 'approve' }),
  })
  const blocked = await approve(cookieFor(owner.session))
  const body = await blocked.json().catch(() => ({}))
  blocked.status === 409 && /PlayFootball/.test(body.error ?? '') ? ok(`Accept is refused: "${body.error}"`) : bad(`approve before confirm: ${blocked.status} ${JSON.stringify(body)}`)

  const { error: notParent } = await parent.client.rpc('confirm_official_rego', { p_request: reqId, p_confirmed: true })
  notParent?.code === '42501' ? ok('a parent cannot confirm it') : bad(`a parent confirmed: ${notParent?.message ?? 'no error'}`)
  const { error: c } = await owner.client.rpc('confirm_official_rego', { p_request: reqId, p_confirmed: true })
  c ? bad(`confirm: ${c.message}`) : ok('the owner ticks "I checked PlayFootball — registered"')

  const accepted = await approve(cookieFor(owner.session))
  accepted.ok ? ok('Accept goes through') : bad(`approve after confirm: ${accepted.status} ${await accepted.text()}`)
  const { data: pl } = await admin.from('players').select('official_status, ff_number, fifa_id').like('full_name', `Riley Form ${TAG}`).maybeSingle()
  pl?.official_status === 'registered' && pl.ff_number === '12345678' ? ok('the roster row is registered with the FFA number on it') : bad(JSON.stringify(pl))
}

head('4. The club\'s PlayFootball export ticks statuses off')
{
  const { data: a } = await admin.from('players').insert({ academy_id: NRIFA, full_name: `Export Alpha ${TAG}`, dob: '2016-01-01', ff_number: '55550001' }).select('id').single()
  const { data: b } = await admin.from('players').insert({ academy_id: NRIFA, full_name: `Export Bravo ${TAG}`, dob: '2016-02-02' }).select('id').single()
  const { data: c } = await admin.from('players').insert({ academy_id: NRIFA, full_name: `Export Charlie ${TAG}`, dob: '2016-03-03' }).select('id').single()
  await admin.from('registration_requests').insert({ academy_id: NRIFA, program_id: strict.id, guardian_name: 'Bravo Parent', guardian_phone: '+61400002603', child_name: `Export Bravo ${TAG}`, child_dob: '2016-02-02', secret_hash: 'test' })
  const rows = [
    { ffa_number: '5555-0001', status: 'Active' },
    { first_name: 'Export', last_name: `Bravo ${TAG}`, dob: '2016-02-02', fifa_id: '900000001', status: 'Registered' },
    { full_name: `Export Charlie ${TAG}`, dob: '2016-03-03', status: 'Pending payment' },
    { full_name: `Nobody Here ${TAG}`, dob: '2010-01-01', status: 'Active' },
  ]
  const { error: notParent } = await parent.client.rpc('import_official_status', { p_academy: NRIFA, p_rows: rows })
  notParent?.code === '42501' ? ok('a parent cannot import') : bad(`a parent imported: ${notParent?.message ?? 'no error'}`)
  const { data: result, error } = await owner.client.rpc('import_official_status', { p_academy: NRIFA, p_rows: rows })
  error ? bad(`import: ${error.message}`) : ok(`matched ${result.matched}, confirmed ${result.confirmed_requests} waiting, ${result.unmatched.length} not found`)
  result?.matched === 3 && result.unmatched[0]?.name === `Nobody Here ${TAG}` ? ok('three matched by FFA number, by first + last + DOB, by name + DOB; the stranger is listed') : bad(JSON.stringify(result))
  const { data: after } = await admin.from('players').select('full_name, official_status, ff_number, fifa_id').in('id', [a.id, b.id, c.id]).order('full_name')
  after[0]?.official_status === 'registered' && after[1]?.official_status === 'registered' && after[1].fifa_id === '900000001' && after[2]?.official_status === 'pending'
    ? ok('Alpha registered, Bravo registered with the FIFA ID, Charlie pending')
    : bad(JSON.stringify(after))
  const { data: req } = await admin.from('registration_requests').select('official_confirmed_at, fifa_id').eq('child_name', `Export Bravo ${TAG}`).single()
  req?.official_confirmed_at && req.fifa_id === '900000001' ? ok('Bravo\'s waiting registration is confirmed by the export, FIFA ID attached') : bad(JSON.stringify(req))
}

head('5. Fees disclosed in PlayFootball, once a season')
{
  const { error } = await owner.client.from('academies').update({ playfootball_fees_disclosed_season: '2026', playfootball_fees_disclosed_at: new Date().toISOString() }).eq('id', NRIFA)
  error ? bad(`tick: ${error.message}`) : ok('the owner ticks 2026')
  const { error: pe } = await parent.client.from('academies').update({ playfootball_fees_disclosed_season: '2099' }).eq('id', NRIFA)
  const { data: a } = await admin.from('academies').select('playfootball_fees_disclosed_season').eq('id', NRIFA).single()
  a.playfootball_fees_disclosed_season === '2026' ? ok('a parent cannot tick it') : bad(`a parent ticked it (${pe?.message ?? 'no error'})`)
  await admin.from('academies').update({ playfootball_fees_disclosed_season: null, playfootball_fees_disclosed_at: null }).eq('id', NRIFA)
}

await cleanup()
console.log(process.exitCode ? '\n\x1b[31mPLAYFOOTBALL FIRST IS WRONG\x1b[0m\n' : '\n\x1b[32mall good\x1b[0m\n')
