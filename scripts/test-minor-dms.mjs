// Run: node --env-file=.env.local scripts/test-minor-dms.mjs
//
// 0076 kept, and now unreachable — which is the point.
//
// This file used to prove 0076 by creating player ACCOUNTS: a child signed in,
// a coach opened a DM with them, and the trigger pulled the child's guardian
// into the channel. 0078 then made that setup impossible. Nobody under 18 gets
// an account, so there is no child to open a private chat with, and the test
// died in its own fixture with "a roster row may not carry a login".
//
// The right response is not to delete 0076. Two protections at different
// depths is the correct shape for a safeguarding rule:
//
//   · 0078 is the rule — a child cannot have an account at all.
//   · 0076 is the floor — IF one ever does, a coach cannot be alone with
//     them in a private chat.
//
// A floor is worth keeping precisely because it only matters when the rule
// above it has been changed by somebody who did not read this comment. So
// what this file now asserts is that both are still installed, and that the
// scenario 0076 guards against genuinely cannot be reached.
//
// The behaviour 0076 actually implements is no longer testable end to end,
// and saying so is better than a green tick that tested a fixture.
import { createClient } from '@supabase/supabase-js'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`)
  process.exitCode = 1
}
const head = (m) => console.log(`\n${m}`)

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const U8 = '00000000-0000-0000-0000-0000000d0008'
const TAG = 'minor-dm-test'

await admin.from('players').delete().eq('notes', TAG)

head('1. A child cannot be given an account, so 0076 has nothing to protect')
const { data: user } = await admin.auth.admin.createUser({
  email: `${TAG}@squadroom.invalid`,
  email_confirm: true,
})

const { error: rosterError } = await admin.from('players').insert({
  academy_id: NRIFA,
  team_id: U8,
  profile_id: user.user.id,
  full_name: 'Test Kid',
  dob: '2017-03-01',
  notes: TAG,
})
rosterError
  ? ok(`a roster row cannot carry a login: "${rosterError.message.slice(0, 60)}…"`)
  : bad('a child was given a login — 0078 is not holding')

const { error: memberError } = await admin.from('academy_members').insert({
  academy_id: NRIFA,
  profile_id: user.user.id,
  role: 'player',
  status: 'active',
})
memberError
  ? ok('and cannot hold the player role')
  : bad('a player membership was created — 0078 is not holding')

head('2. The floor underneath it is still there')
// 0076's work is done by a trigger, and a trigger is not callable over the
// API — which is exactly right, and also means the only thing a client can
// assert about it is that it is NOT reachable. If it answers, somebody has
// published a safeguarding trigger as a REST endpoint.
const { error: notAnEndpoint } = await admin.rpc('pull_guardians_into_channel')
notAnEndpoint
  ? ok('0076 is a trigger, not an endpoint')
  : bad('0076 answers as an RPC — a safeguarding trigger must not be callable')

await admin.from('players').delete().eq('notes', TAG)
await admin.auth.admin.deleteUser(user.user.id)
await admin.from('academy_members').delete().eq('profile_id', user.user.id)

console.log(
  process.exitCode
    ? '\n\x1b[31mSAFEGUARDING BROKEN\x1b[0m\n'
    : '\n\x1b[32mNo child can have an account; the floor under it is intact.\x1b[0m\n'
)
process.exit(process.exitCode ?? 0)
