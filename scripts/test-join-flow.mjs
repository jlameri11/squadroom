/**
 * test-join-flow.mjs — the join journey, over real HTTP (the sign-up brief,
 * 12 Nov 2026).
 *
 * Coach posts a link → a parent with no account is turned away by the API →
 * the parent creates an account (the six-digit code) → asks to join → "has
 * my coach approved?" says not yet → coach approves → the parent is in
 * (membership, roster, channels) → the check says approved, with no second
 * sign-in → the old device-secret path is closed for a request made this way.
 * Asserts the database ended up in the right state at each step.
 *
 * Needs the dev server running:  npm run dev
 * Then:  node --env-file=.env.local scripts/test-join-flow.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { resolveBaseUrl } from './_base-url.mjs'
import { listAllUsers } from './_users.mjs'
import { createAccount, deleteAccount } from './_account.mjs'

const BASE = await resolveBaseUrl()
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const REF = URL.replace('https://', '').split('.')[0]
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const anon = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const ACADEMY = '00000000-0000-0000-0000-0000000a0001'
const TEAM_U8 = '00000000-0000-0000-0000-0000000d0008'
const COACH   = '00000000-0000-0000-0000-0000000000a1'
const PHONE   = '+61400008888'
const PARENT_EMAIL = 'testy.parent@squadroom-demo.test'

let step = 0
let failed = false
const ok   = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad  = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); failed = true }
const head = (m) => console.log(`\n${++step}. ${m}`)
const post = (path, body, cookie) =>
  fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  })

async function cleanup() {
  await deleteAccount(admin, PARENT_EMAIL)
  const { data: u } = await listAllUsers(admin)
  const parent = u?.users?.find((x) => x.phone === PHONE.replace('+', ''))
  if (parent) await admin.auth.admin.deleteUser(parent.id)
  await admin.from('join_requests').delete().eq('phone', PHONE)
  await admin.from('join_links').delete().eq('label', 'e2e-test')
  await admin.from('players').delete().eq('full_name', 'Testy Testerson')
}

console.log('\nJoin flow, end to end — squadroom-dev\n' + '─'.repeat(48))
await cleanup()

head('Coach creates a team join link')
const { data: link, error: linkErr } = await admin
  .from('join_links')
  .insert({ academy_id: ACADEMY, team_id: TEAM_U8, role: 'parent', label: 'e2e-test', created_by: COACH })
  .select('token')
  .single()
if (linkErr) { bad(linkErr.message); process.exit(1) }
ok(`token ${link.token.slice(0, 10)}…`)

head('Without an account, the API turns the parent away')
const anonRes = await post('/api/join/request', { token: link.token, children: [{ name: 'Testy Testerson', dob: '2017-03-03' }] })
const anonBody = await anonRes.json().catch(() => ({}))
anonRes.status === 401 && /account/i.test(anonBody.error ?? '') ? ok(`401 — "${anonBody.error}"`) : bad(`expected 401, got ${anonRes.status} ${JSON.stringify(anonBody)}`)

head('The parent creates an account and asks to join')
let parent
try {
  parent = await createAccount(BASE, { first: 'Testy', last: 'Parent', email: PARENT_EMAIL, mobile: '0400 008 888' })
  ok('account made: names, email, mobile, password — confirmed by the code')
} catch (e) {
  bad(`account: ${e.message}`)
  await cleanup()
  process.exit(1)
}
const reqRes = await post('/api/join/request', { token: link.token, children: [{ name: 'Testy Testerson', dob: '2017-03-03' }] }, parent.cookie)
const reqBody = await reqRes.json()
reqRes.ok && reqBody.requestId ? ok('request created') : bad(`request: ${reqRes.status} ${JSON.stringify(reqBody)}`)
const { data: reqRow } = await admin.from('join_requests').select('profile_id, full_name, phone, email, status').eq('id', reqBody.requestId).maybeSingle()
reqRow?.profile_id && reqRow.full_name === 'Testy Parent' && reqRow.phone === PHONE && reqRow.email === PARENT_EMAIL && reqRow.status === 'pending'
  ? ok('the request carries the account — name, mobile and email from it, not from the form — and is pending')
  : bad(`request row: ${JSON.stringify(reqRow)}`)
const again = await post('/api/join/request', { token: link.token, children: [] }, parent.cookie)
const againBody = await again.json().catch(() => ({}))
again.ok && againBody.requestId === reqBody.requestId && againBody.already ? ok('asking twice is the same ask') : bad(`second ask: ${again.status} ${JSON.stringify(againBody)}`)

head('A dead link is refused, and says nothing useful about why')
const deadRes = await post('/api/join/request', { token: 'not-a-real-token', children: [] }, parent.cookie)
deadRes.status === 404 ? ok('unknown token → 404, generic message') : bad(`expected 404, got ${deadRes.status}`)

head('Asking before approval: not yet')
const early = await post('/api/join/claim', { requestId: reqBody.requestId }, parent.cookie)
early.status === 202 ? ok('202 pending — nothing opens') : bad(`expected 202, got ${early.status}`)

head('Coach signs in')
// The coach's address is LOOKED UP from their id, never hard-coded.
//
// It used to name p61400000001@squadroom.invalid, the synthetic address the
// seed gave this coach. Joey's auth email was later changed to his real one,
// which left that address unclaimed — and generateLink SIGNS UP an unknown
// email rather than failing, so a past run created a brand-new user on it.
// From then on this test signed in as a stranger who is a member of nothing,
// and the failure read like an RLS bug.
const { data: coachUser } = await admin.auth.admin.getUserById(COACH)
if (!coachUser?.user?.email) {
  bad(`the coach ${COACH} has no email address to sign in with`)
  process.exit(1)
}
const { data: cl } = await admin.auth.admin.generateLink({ type: 'magiclink', email: coachUser.user.email })
// generateLink is rate limited per project as well as verifyOtp, and
// returns null when it trips — so this property read throws before any
// session check runs, and the runner reports a crash that is really the
// auth budget.
if (!cl?.properties?.hashed_token) {
  console.log("  could not issue a magic link — the project's auth rate limit, not a failure")
  await cleanup()
  process.exit(2)
}
const { data: cs, error: csErr } = await anon.auth.verifyOtp({ token_hash: cl.properties.hashed_token, type: 'email' })
if (csErr) { bad(`coach session: ${csErr.message}`); process.exit(1) }
if (cs.user.id !== COACH) {
  bad(`session is user ${cs.user.id}, not the coach — generateLink created a new user`)
  process.exit(1)
}
ok('session belongs to the coach')
// Reproduce the cookie @supabase/ssr writes, so the route sees a real coach.
const cookie = `sb-${REF}-auth-token=base64-${Buffer.from(JSON.stringify(cs.session)).toString('base64')}`

head("Somebody else's session cannot ask about the request")
const other = await post('/api/join/claim', { requestId: reqBody.requestId }, cookie)
other.status === 404 ? ok('404, indistinguishable from a missing request') : bad(`expected 404, got ${other.status}`)

head('Coach approves')
const appr = await post('/api/join/approve', { requestId: reqBody.requestId, decision: 'approve' }, cookie)
const apprBody = await appr.json().catch(() => ({}))
appr.ok ? ok('approved') : bad(`approve: ${appr.status} ${JSON.stringify(apprBody)}`)

head('The cascade ran: membership, roster, channels — on the account that asked')
const { data: prof } = await admin.from('profiles').select('id, first_name, last_name').eq('phone', PHONE).maybeSingle()
prof && prof.id === reqRow?.profile_id ? ok('the same account, no second one made') : bad(`profile: ${JSON.stringify(prof)} vs request ${reqRow?.profile_id}`)
if (prof) {
  prof.first_name === 'Testy' && prof.last_name === 'Parent' ? ok('first and last name as typed') : bad(`name parts: ${prof.first_name} / ${prof.last_name}`)
  const { count: am } = await admin.from('academy_members').select('*', { count: 'exact', head: true })
    .eq('profile_id', prof.id).eq('academy_id', ACADEMY)
  am === 1 ? ok('academy member') : bad(`academy_members = ${am}`)

  const { count: tm } = await admin.from('team_members').select('*', { count: 'exact', head: true })
    .eq('profile_id', prof.id).eq('team_id', TEAM_U8)
  tm === 1 ? ok('team member') : bad(`team_members = ${tm}`)

  const { count: ch } = await admin.from('channel_members').select('*', { count: 'exact', head: true })
    .eq('profile_id', prof.id)
  ch >= 3 ? ok(`auto-joined ${ch} channels (team, age group, announcements)`) : bad(`channel_members = ${ch}`)

  const { data: guard } = await admin.from('player_guardians').select('player_id').eq('profile_id', prof.id)
  guard?.length === 1 ? ok('linked as guardian of 1 child') : bad(`player_guardians = ${guard?.length}`)
}

head("The parent's check says approved — already signed in, nothing minted")
const claim = await post('/api/join/claim', { requestId: reqBody.requestId }, parent.cookie)
const claimBody = await claim.json().catch(() => ({}))
claim.status === 200 && claimBody.status === 'approved' ? ok('200 approved') : bad(`claim: expected 200 approved, got ${claim.status} ${JSON.stringify(claimBody)}`)

head('The old device-secret path is closed for a request made signed in')
const replay = await post('/api/join/claim', { requestId: reqBody.requestId, secret: 'not-the-secret' })
replay.status === 404 ? ok('404 — no secret was ever issued') : bad(`expected 404, got ${replay.status}`)

await cleanup()
console.log('\n' + '─'.repeat(48))
console.log(failed ? '\x1b[31mFAILED\x1b[0m\n' : '\x1b[32mJOIN FLOW PASSES END TO END\x1b[0m\n')
process.exit(failed ? 1 : 0)
