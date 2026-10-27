// Run: node --env-file=.env.local scripts/test-family-view.mjs
//
// Proves 0114 (E-04): home knows who this person's family is.
//
// The filter chips need a stable list of children, and the list is the whole
// risk. A function on the home screen that returns players is one wrong join
// away from handing a parent the squad, and the tempting branch — "staff see
// everything, they already can" — is exactly the bug: a coach opening their
// OWN home screen wants their own family, not a second roster.
//
// So the assertion that carries the weight is the owner who is also a parent:
// the most privileged person in the academy, with one child, who must get
// one child back.
import { createClient } from '@supabase/supabase-js'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})
const anon = createClient(URL_, PUB, { auth: { persistSession: false } })

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`)
  process.exitCode = 1
}
const head = (m) => console.log(`\n${m}`)

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const LEO = '00000000-0000-0000-0000-0000000e0001'
const ZOE = '00000000-0000-0000-0000-0000000e0006'
const ARJUN = '00000000-0000-0000-0000-0000000e0002'

async function sess(email) {
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  const { data: s } = await anon.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: 'email',
  })
  if (!s?.session) {
    console.log(`  could not sign in ${email} — the project's auth rate limit, not a failure`)
    process.exit(2)
  }
  return {
    client: createClient(URL_, PUB, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${s.session.access_token}` } },
    }),
    id: s.user.id,
  }
}

const owner = await sess('joeylameri@outlook.com')
const sam = await sess('p61400000011@squadroom.invalid')

const children = async (who) => {
  const { data, error } = await who.client.rpc('home_screen', { p_academy: NRIFA })
  if (error) throw new Error(error.message)
  return data?.children ?? []
}

head('1. A parent gets their own children, and only those')
{
  const mine = await children(sam)
  const ids = mine.map((c) => c.id).sort()
  JSON.stringify(ids) === JSON.stringify([LEO, ZOE].sort())
    ? ok(`Leo and Zoe, nobody else (${mine.length})`)
    : bad(`got ${mine.length}: ${mine.map((c) => c.name).join(', ')}`)

  mine.every((c) => c.short_name && c.short_name === c.name.split(' ')[0])
    ? ok('each carries a short name a chip can fit')
    : bad(`short names: ${JSON.stringify(mine.map((c) => c.short_name))}`)

  mine.every((c) => c.team_name)
    ? ok(`and the squad they are in (${mine[0].team_name})`)
    : bad('a child has no squad name')

  // The list is sorted so the chips do not reorder themselves between loads.
  const names = mine.map((c) => c.name)
  JSON.stringify(names) === JSON.stringify([...names].sort())
    ? ok('ordered by name — the chips stay put')
    : bad(`unordered: ${names.join(', ')}`)
}

head('2. Somebody with no children gets an empty list, not the roster')
{
  const theirs = await children(owner)
  const { count } = await admin
    .from('players')
    .select('id', { count: 'exact', head: true })
    .eq('academy_id', NRIFA)

  theirs.length === 0
    ? ok(`the owner of a ${count}-player academy gets 0 children`)
    : bad(`the owner got ${theirs.length}: ${theirs.map((c) => c.name).join(', ')}`)
}

head('3. The owner of the academy, who is also a parent, gets ONE child')
{
  // The branch that would break this is "staff already see the roster, so
  // return it" — true about the roster screen and wrong about this one. Set
  // up, asserted, torn down, because no seeded person is both.
  const { error: linkError } = await admin.from('player_guardians').insert({
    academy_id: NRIFA,
    player_id: ARJUN,
    profile_id: owner.id,
    relationship: 'parent',
  })
  if (linkError) {
    bad(`could not set up: ${linkError.message}`)
  } else {
    const theirs = await children(owner)
    theirs.length === 1 && theirs[0].id === ARJUN
      ? ok(`one child (${theirs[0].short_name}), not the squad`)
      : bad(`got ${theirs.length}: ${theirs.map((c) => c.name).join(', ')}`)

    await admin
      .from('player_guardians')
      .delete()
      .eq('player_id', ARJUN)
      .eq('profile_id', owner.id)

    const after = await children(owner)
    after.length === 0 ? ok('and the link is gone again') : bad('teardown left a link behind')
  }
}

head('4. A child in another academy is not in this list')
{
  // my_academy() scopes the whole function, so this is really asserting that
  // the children join did not reach around it — the one join in 0114 that
  // could have been written against players alone.
  const { data: other } = await admin
    .from('players')
    .select('id, academy_id')
    .neq('academy_id', NRIFA)
    .limit(1)
    .maybeSingle()

  if (!other) {
    ok('(no second academy with players to check)')
  } else {
    const { error: linkError } = await admin.from('player_guardians').insert({
      academy_id: other.academy_id,
      player_id: other.id,
      profile_id: sam.id,
      relationship: 'parent',
    })
    if (linkError) {
      // A composite FK refusing the row is itself the right answer.
      ok(`the database refused a cross-academy guardian link (${linkError.code})`)
    } else {
      const mine = await children(sam)
      mine.some((c) => c.id === other.id)
        ? bad("another academy's child appeared in the NRIFA list")
        : ok(`${mine.length} children — the other academy's child stayed there`)
      await admin
        .from('player_guardians')
        .delete()
        .eq('player_id', other.id)
        .eq('profile_id', sam.id)
    }
  }
}

head('5. Nothing else on the home screen moved')
{
  // 0114 replaced home_screen, and 0071 replaced a function like this one and
  // silently dropped a column for three weeks. Cheap to check, expensive to
  // miss.
  const { data } = await sam.client.rpc('home_screen', { p_academy: NRIFA })
  const want = [
    'profile',
    'academy',
    'role',
    'other_academies',
    'is_platform_admin',
    'pending_requests',
    'children',
    'events',
    'channels',
  ]
  const missing = want.filter((k) => !(k in (data ?? {})))
  missing.length === 0
    ? ok(`all ${want.length} keys still there`)
    : bad(`home_screen lost ${missing.join(', ')}`)

  Array.isArray(data?.events) && data.events.every((e) => Array.isArray(e.rsvps))
    ? ok('every fixture still carries its per-child rows')
    : bad('a fixture lost its rsvps')
}

console.log(
  process.exitCode ? '\n\x1b[31msome of this is wrong\x1b[0m' : '\n\x1b[32mall good\x1b[0m'
)
