// Run: node --env-file=.env.local scripts/test-adults-only.mjs
//
// Proves 0078: nobody under 18 has an account.
//
// The rule is only worth anything if it holds at the database, under the
// service role, with every trigger and policy in play — because the ways in
// are many and a check in one route handler protects exactly that route.
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const anon = createClient(URL, PUB, { auth: { persistSession: false } })

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const head = (m) => console.log(`\n${m}`)

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const U8 = '00000000-0000-0000-0000-0000000d0008'
const TAG = 'adults-only-test'

async function sess(email) {
  const { data: l } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  // generateLink is rate limited per project as well as verifyOtp, and
  // returns null when it trips — so this property read throws before any
  // session check runs, and the runner reports a crash that is really the
  // auth budget.
  if (!l?.properties?.hashed_token) {
    console.log("  could not issue a magic link — the project's auth rate limit, not a failure")
    process.exit(2)
  }
  const { data: s } = await anon.auth.verifyOtp({ token_hash: l.properties.hashed_token, type: 'email' })
  return { client: createClient(URL, PUB, { auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${s.session.access_token}` } } }), id: s.user.id }
}

async function cleanup() {
  const { data: pls } = await admin.from('players').select('id').eq('notes', TAG)
  for (const p of pls ?? []) await admin.from('player_guardians').delete().eq('player_id', p.id)
  await admin.from('players').delete().eq('notes', TAG)
  const { data: u } = await admin.auth.admin.listUsers({ perPage: 200 })
  for (const x of u.users) if (x.email?.startsWith(TAG)) await admin.auth.admin.deleteUser(x.id)
}

await cleanup()
const coach = await sess('joeylameri@outlook.com')

head('1. The player role cannot be granted, even by the service role')
const { data: u } = await admin.auth.admin.createUser({
  email: `${TAG}-kid@squadroom.invalid`, email_confirm: true,
})
const kidProfile = u.user.id
const { error: e1 } = await admin.from('academy_members').insert({
  academy_id: NRIFA, profile_id: kidProfile, role: 'player', status: 'active',
})
e1 ? ok(`refused: ${e1.message.slice(0, 70)}…`) : bad('a player account was created')

// The message has to tell a coach what to do instead, or they will try again.
e1 && /invite their parent|add the player/i.test(e1.message)
  ? ok('and says what to do instead')
  : bad('the message does not say what to do instead')

head('2. The same refusal through an ordinary signed-in coach')
const { error: e2 } = await coach.client.from('academy_members').insert({
  academy_id: NRIFA, profile_id: kidProfile, role: 'player', status: 'active',
})
e2 ? ok('refused for a coach too') : bad('a coach created a player account')

head('3. Promoting an existing member to player is refused')
await admin.from('academy_members').insert({
  academy_id: NRIFA, profile_id: kidProfile, role: 'parent', status: 'active',
})
const { error: e3 } = await admin.from('academy_members')
  .update({ role: 'player' }).eq('profile_id', kidProfile).eq('academy_id', NRIFA)
e3 ? ok('an existing parent cannot be demoted to player') : bad('role was changed to player')

head('4. A roster record cannot be given a login')
const { data: player } = await admin.from('players').insert({
  academy_id: NRIFA, team_id: U8, full_name: 'Adults Only Test Kid',
  dob: '2015-06-01', notes: TAG,
}).select('id').single()

const { error: e4 } = await admin.from('players')
  .update({ profile_id: kidProfile }).eq('id', player.id)
e4 ? ok(`refused: ${e4.message.slice(0, 70)}…`) : bad('a player row was linked to an account')

head('5. Nor at insert time')
const { error: e5 } = await admin.from('players').insert({
  academy_id: NRIFA, team_id: U8, full_name: 'Adults Only Test Kid 2',
  dob: '2015-06-01', notes: TAG, profile_id: kidProfile,
})
e5 ? ok('refused on insert as well as update') : bad('a player row was created with an account')

head('6. An ADULT cannot be attached to a roster row either')
// A coach whose own child is on the squad is a guardian, not a player. Letting
// an adult's account sit on a roster row would make them a player in every
// query that checks one.
const { error: e6 } = await admin.from('players')
  .update({ profile_id: coach.id }).eq('id', player.id)
e6 ? ok("a coach's own account cannot be put on a roster row") : bad('an adult was linked as a player')

head('7. The parent route still works — that is the whole point')
const { error: e7 } = await admin.from('player_guardians').insert({
  academy_id: NRIFA, player_id: player.id, profile_id: coach.id,
  relationship: 'parent', is_primary: true,
})
e7 ? bad(`a guardian could not be linked: ${e7.message}`) : ok('a parent links to the child normally')

head('8. Nothing in the live database has a player account')
const { count: logins } = await admin.from('players')
  .select('*', { count: 'exact', head: true }).not('profile_id', 'is', null)
const { count: members } = await admin.from('academy_members')
  .select('*', { count: 'exact', head: true }).eq('role', 'player')
logins === 0 ? ok('no roster row carries a login') : bad(`${logins} players have a profile_id`)
members === 0 ? ok('no academy member holds the player role') : bad(`${members} player memberships exist`)

await cleanup()
await admin.auth.admin.deleteUser(kidProfile).catch(() => {})
console.log(process.exitCode ? '\n\x1b[31mBROKEN\x1b[0m\n' : '\n\x1b[32mADULTS ONLY HOLDS\x1b[0m\n')
