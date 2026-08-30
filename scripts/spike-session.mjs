/**
 * spike-session.mjs — can we sign a parent in without them doing anything?
 *
 * The whole onboarding model rests on one question: can the server mint a
 * real Supabase session for a user who has never entered a code, and who has
 * a phone number but no email address?
 *
 * The route this tests:
 *   1. create the user with a synthetic address (nothing is ever sent to it)
 *   2. admin.generateLink({ type: 'magiclink' }) — returns a token, sends no mail
 *   3. verifyOtp({ token_hash }) server-side — returns the session in the body
 *   4. use that session and confirm RLS still applies to it
 *
 * Run:  node --env-file=.env.local scripts/spike-session.mjs
 */
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
const PUBLISHABLE = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

if (!URL || !SERVICE || !PUBLISHABLE) {
  console.error('\nMissing env. Needs NEXT_PUBLIC_SUPABASE_URL,')
  console.error('SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local.')
  console.error('\nThe service role key is in the dashboard under')
  console.error('Project Settings > API keys > service_role.\n')
  process.exit(1)
}

const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })

const PHONE = '+61400007777'
// Nothing is ever delivered here. .invalid is reserved by RFC 2606 precisely
// so it can never resolve, which is what we want for an address the user
// neither chose nor knows about.
const EMAIL = `p61400007777@squadroom.invalid`

let step = 0
const ok   = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const fail = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const head = (m) => console.log(`\n${++step}. ${m}`)

async function cleanup() {
  const { data } = await admin.auth.admin.listUsers()
  const existing = data?.users?.find((u) => u.email === EMAIL)
  if (existing) await admin.auth.admin.deleteUser(existing.id)
}

console.log('\nSession-minting spike — squadroom-dev\n' + '─'.repeat(46))

await cleanup()

head('Create the user (no password, no code)')
const { data: created, error: createErr } = await admin.auth.admin.createUser({
  email: EMAIL,
  phone: PHONE,
  email_confirm: true,
  phone_confirm: true,
  user_metadata: { full_name: 'Spike Parent' },
})
if (createErr) { fail(`createUser: ${createErr.message}`); process.exit(1) }
ok(`user ${created.user.id}`)

head('Confirm the profile trigger fired')
const { data: prof } = await admin.from('profiles').select('id, full_name, phone').eq('id', created.user.id).single()
prof ? ok(`profile exists, phone ${prof.phone}`) : fail('no profile row — handle_new_user did not run')

head('Generate a magic link token WITHOUT sending anything')
const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email: EMAIL })
if (linkErr) { fail(`generateLink: ${linkErr.message}`); await cleanup(); process.exit(1) }
const tokenHash = link?.properties?.hashed_token
tokenHash ? ok(`token_hash obtained (${tokenHash.slice(0, 12)}…)`) : fail('no hashed_token in response')

head('Exchange it for a session, server-side')
const anon = createClient(URL, PUBLISHABLE, { auth: { autoRefreshToken: false, persistSession: false } })
const { data: sess, error: verifyErr } = await anon.auth.verifyOtp({ token_hash: tokenHash, type: 'email' })
if (verifyErr) { fail(`verifyOtp: ${verifyErr.message}`); await cleanup(); process.exit(1) }
sess?.session?.access_token
  ? ok(`session minted, expires in ${sess.session.expires_in}s`)
  : fail('no session returned')

head('Check the session is a real, RLS-bound identity')
const asUser = createClient(URL, PUBLISHABLE, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { headers: { Authorization: `Bearer ${sess.session.access_token}` } },
})
const { data: me } = await asUser.auth.getUser()
me?.user?.id === created.user.id ? ok('session identifies the right user') : fail('wrong user')

// Belongs to no academy yet, so tenant-scoped tables must come back empty.
const { data: msgs } = await asUser.from('messages').select('id')
msgs?.length === 0 ? ok('RLS applies: 0 messages for a user with no academy') : fail(`RLS leak: saw ${msgs?.length} messages`)

const { data: acads } = await asUser.from('academies').select('id')
acads?.length === 0 ? ok('RLS applies: 0 academies visible') : fail(`RLS leak: saw ${acads?.length} academies`)

head('Refresh token works (the session must outlive the tab)')
const { data: refreshed, error: refreshErr } = await anon.auth.refreshSession({ refresh_token: sess.session.refresh_token })
refreshErr ? fail(`refresh: ${refreshErr.message}`) : ok('refresh token exchanged for a new access token')

await cleanup()
console.log('\n' + '─'.repeat(46))
console.log(process.exitCode ? '\x1b[31mSPIKE FAILED\x1b[0m — fall back to one-tap OTP\n'
                             : '\x1b[32mSPIKE PASSED\x1b[0m — no-signup onboarding is buildable\n')
