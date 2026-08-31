/**
 * test-join-flow.mjs — the whole no-signup journey, over real HTTP.
 *
 * Coach posts a link → parent asks to join → claim refused while pending →
 * coach approves → parent's browser collects its session → second claim
 * refused. Asserts the database ended up in the right state at each step.
 *
 * Needs the dev server running:  npm run dev
 * Then:  node --env-file=.env.local scripts/test-join-flow.mjs
 */
import { createClient } from '@supabase/supabase-js'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
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
  const { data: u } = await admin.auth.admin.listUsers()
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

head('Parent taps it and asks to join')
const reqRes = await post('/api/join/request', {
  token: link.token,
  fullName: 'Testy Parent',
  phone: '0400 008 888',
  children: ['Testy Testerson'],
})
const reqBody = await reqRes.json()
reqRes.ok && reqBody.requestId ? ok('request created, secret issued') : bad(`request: ${reqRes.status} ${JSON.stringify(reqBody)}`)

head('A dead link is refused, and says nothing useful about why')
const deadRes = await post('/api/join/request', { token: 'not-a-real-token', fullName: 'Chancer' })
deadRes.status === 404 ? ok('unknown token → 404, generic message') : bad(`expected 404, got ${deadRes.status}`)

head('Claiming before approval is refused')
const early = await post('/api/join/claim', { requestId: reqBody.requestId, secret: reqBody.secret })
early.status === 202 ? ok('202 pending — no session handed out') : bad(`expected 202, got ${early.status}`)

head('A wrong secret is refused')
const wrong = await post('/api/join/claim', { requestId: reqBody.requestId, secret: 'not-the-secret' })
wrong.status === 404 ? ok('404, indistinguishable from a missing request') : bad(`expected 404, got ${wrong.status}`)

head('Coach signs in and approves')
const { data: cl } = await admin.auth.admin.generateLink({ type: 'magiclink', email: 'p61400000001@squadroom.invalid' })
const { data: cs, error: csErr } = await anon.auth.verifyOtp({ token_hash: cl.properties.hashed_token, type: 'email' })
if (csErr) { bad(`coach session: ${csErr.message}`); process.exit(1) }

// generateLink SIGNS UP an unknown email rather than failing, so without this
// check a missing synthetic address silently produces a session for a
// brand-new user who is a member of nothing - which then reads as an RLS bug.
if (cs.user.id !== COACH) {
  bad(`session is user ${cs.user.id}, not the coach — generateLink created a new user`)
  process.exit(1)
}
ok('session belongs to the coach')

// Reproduce the cookie @supabase/ssr writes, so the route sees a real coach.
const cookieValue = 'base64-' + Buffer.from(JSON.stringify(cs.session)).toString('base64')
const cookie = `sb-${REF}-auth-token=${cookieValue}`

const appr = await post('/api/join/approve', { requestId: reqBody.requestId, decision: 'approve' }, cookie)
const apprBody = await appr.json().catch(() => ({}))
appr.ok ? ok('approved') : bad(`approve: ${appr.status} ${JSON.stringify(apprBody)}`)

head('The cascade ran: membership, roster, channels')
const { data: prof } = await admin.from('profiles').select('id').eq('phone', PHONE).maybeSingle()
prof ? ok('profile created') : bad('no profile')
if (prof) {
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

head("The parent's browser collects its session")
const claim = await post('/api/join/claim', { requestId: reqBody.requestId, secret: reqBody.secret })
const setCookie = claim.headers.get('set-cookie')
claim.status === 200 ? ok('claimed') : bad(`claim: expected 200, got ${claim.status}`)
setCookie && setCookie.includes(`sb-${REF}-auth-token`) ? ok('session cookie set on the response') : bad('no session cookie')

head('The same secret cannot be used twice')
const replay = await post('/api/join/claim', { requestId: reqBody.requestId, secret: reqBody.secret })
replay.status === 409 ? ok('409 — a forwarded link is spent') : bad(`expected 409, got ${replay.status}`)

await cleanup()
console.log('\n' + '─'.repeat(48))
console.log(failed ? '\x1b[31mFAILED\x1b[0m\n' : '\x1b[32mJOIN FLOW PASSES END TO END\x1b[0m\n')
process.exit(failed ? 1 : 0)
