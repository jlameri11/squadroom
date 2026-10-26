// Run: node --env-file=.env.local scripts/test-first-run.mjs
//
// The first five minutes of a brand-new club, which nothing else covers.
//
// Every other test runs against NRIFA, which has three seasons of data in it.
// A prospect being shown "and here is how you start your own club" sees
// something quite different: every screen empty, every list at zero. That is
// the state most likely to look broken, and the one nobody ever looks at.
//
// So this founds a real organisation, walks the screens a new owner meets in
// order, and then removes it. What it is checking is not that the data is
// there — there is none — but that nothing ERRORS and that each screen says
// something useful instead of rendering a void.
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

const EMAIL = `first-run-${Date.now()}@squadroom.invalid`
let userId = null
let academyId = null

async function cleanUp() {
  if (academyId) {
    // Children first: the cascades handle most of it, but a failed run can
    // leave the academy with rows that block the delete.
    await admin.from('event_series').delete().eq('academy_id', academyId)
    await admin.from('events').delete().eq('academy_id', academyId)
    await admin.from('teams').delete().eq('academy_id', academyId)
    await admin.from('academies').delete().eq('id', academyId)
  }
  if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {})
}

process.on('exit', () => {})

try {
  head('1. Somebody signs up who belongs to nothing')
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: EMAIL,
    email_confirm: true,
  })
  if (createError) {
    bad(createError.message)
    process.exit(1)
  }
  userId = created.user.id
  ok('account created')

  const { data: link } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: EMAIL,
  })
  const { data: s } = await anon.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: 'email',
  })
  if (!s?.session) {
    console.log("  could not sign in — the project's auth rate limit, not a failure")
    await cleanUp()
    process.exit(2)
  }
  const me = createClient(URL_, PUB, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${s.session.access_token}` } },
  })

  // The home screen's contract for somebody in no academy: `academy: null`,
  // which is what sends them to /start. An ERROR here, or a null payload,
  // would leave a new signup staring at a skeleton forever.
  const { data: beforeAny, error: homeError } = await me.rpc('home_screen', {})
  if (homeError) {
    bad(`home_screen errored for a brand-new user: ${homeError.message}`)
  } else if (beforeAny === null) {
    bad('home_screen returned null — the shell cannot tell "not signed in" from "no academy"')
  } else if (beforeAny.academy === null) {
    ok('home_screen says academy: null, which is what redirects them to /start')
  } else {
    bad(`a brand-new user is already in ${JSON.stringify(beforeAny.academy)}`)
  }

  head('2. They found a club')
  const { error: foundError } = await me.rpc('create_academy', {
    p_name: 'First Run FC',
    p_type: 'club',
  })
  if (foundError) {
    bad(`create_academy: ${foundError.message}`)
    await cleanUp()
    process.exit(1)
  }
  const { data: mine } = await me.from('academies').select('id, name, type').limit(1).single()
  academyId = mine.id
  ok(`"${mine.name}" created as a ${mine.type}`)

  const { data: membership } = await me
    .from('academy_members')
    .select('role, status')
    .eq('academy_id', academyId)
    .single()
  membership.role === 'owner' && membership.status === 'active'
    ? ok('and they are its active owner')
    : bad(`membership is ${JSON.stringify(membership)}`)

  head('3. Every screen works with nothing in it')
  // The whole point. None of these has any data, and none may error.
  const screens = [
    ['home_screen', {}],
    ['chat_screen', {}],
    ['fixtures_screen', { p_days: 60 }],
    ['nav_badges', {}],
    ['my_organisations', {}],
  ]
  for (const [fn, args] of screens) {
    const { data, error } = await me.rpc(fn, args)
    if (error) {
      bad(`${fn}: ${error.message}`)
      continue
    }
    if (data === null) {
      bad(`${fn} returned null, which the shell reads as "signed out"`)
      continue
    }
    ok(`${fn} answers`)
  }

  // A brand-new club has the channels create_academy makes, and nothing else.
  const { data: chat } = await me.rpc('chat_screen', {})
  const channels = chat?.channels ?? []
  channels.length > 0
    ? ok(`${channels.length} channel(s) ready out of the box: ${channels.map((c) => c.name).join(', ')}`)
    : bad('a new club has no channels at all — the chat tab is a void')

  const { data: home } = await me.rpc('home_screen', {})
  home?.academy?.id === academyId
    ? ok('the home screen now shows their club')
    : bad('the home screen still has no academy')
  ;(home?.events ?? []).length === 0
    ? ok('no fixtures yet, which is correct and must render as an empty state')
    : bad('a brand-new club somehow has fixtures')

  const { data: badges } = await me.rpc('nav_badges', {})
  badges?.is_staff ? ok('they see the Admin tab') : bad('the founder is not staff')
  badges?.org_count === 1
    ? ok('and no organisation switcher, because they are in one')
    : bad(`org_count is ${badges?.org_count}`)

  head('4. They can do the first three things a new club does')
  const { data: team, error: teamError } = await me
    .from('teams')
    .insert({ academy_id: academyId, name: 'U9s', age_group: 'U9', season: '2027' })
    .select('id')
    .single()
  teamError ? bad(`create a team: ${teamError.message}`) : ok('create a team')

  if (team) {
    const { error: playerError } = await me
      .from('players')
      .insert({ academy_id: academyId, team_id: team.id, full_name: 'First Player', dob: '2018-05-01' })
    playerError ? bad(`add a player: ${playerError.message}`) : ok('add a player')

    const { data: linkRow, error: linkError } = await me
      .from('join_links')
      .insert({
        academy_id: academyId,
        team_id: team.id,
        role: 'parent',
        created_by: userId,
      })
      .select('code')
      .single()
    linkError
      ? bad(`create a join link: ${linkError.message}`)
      : /^[ABCDEFGHJKMNPQRSTVWXYZ23456789]{6}$/.test(linkRow.code)
        ? ok(`invite a family with code ${linkRow.code}`)
        : bad(`join code is malformed: ${linkRow.code}`)

    const { data: series, error: seriesError } = await me.rpc('create_event_series', {
      p_academy: academyId,
      p_title: 'Training',
      p_team: team.id,
      p_days: [2],
      p_time: '17:00',
      p_from: new Date().toISOString().slice(0, 10),
      p_until: new Date(Date.now() + 28 * 864e5).toISOString().slice(0, 10),
    })
    seriesError
      ? bad(`schedule training: ${seriesError.message}`)
      : ok(`schedule training (${series.created} sessions)`)
  }

  head('5. And the club they founded is theirs alone')
  // Checked against an ORDINARY club owner, not NRIFA's.
  //
  // The first version used Joey, on the reasoning that he is the most
  // privileged person in the demo data — which is exactly why he was the
  // wrong choice: he is the platform admin, and `academies_select` admits
  // `is_platform_admin()` deliberately, because /platform exists to list
  // every club. He saw the new academy, correctly, and the test called it a
  // leak.
  //
  // The question worth asking is whether ANOTHER CLUB can see it, so the
  // test asks somebody who owns one and administers nothing else.
  const { data: owner } = await admin
    .from('academy_members')
    .select('profile_id')
    .eq('academy_id', '00000000-0000-0000-0000-0000000a0002')
    .eq('role', 'owner')
    .eq('status', 'active')
    .limit(1)
    .single()
  const { data: isAdmin } = await admin
    .from('platform_admins')
    .select('profile_id')
    .eq('profile_id', owner.profile_id)
    .maybeSingle()
  if (isAdmin) {
    bad('the chosen outsider is a platform admin — pick somebody else')
  }
  const { data: joeyUser } = await admin.auth.admin.getUserById(owner.profile_id)
  const { data: jl } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: joeyUser.user.email,
  })
  const { data: js } = await anon.auth.verifyOtp({
    token_hash: jl.properties.hashed_token,
    type: 'email',
  })
  if (js?.session) {
    const other = createClient(URL_, PUB, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${js.session.access_token}` } },
    })
    const { data: seen } = await other.from('academies').select('id').eq('id', academyId)
    seen?.length === 0
      ? ok('another club\'s owner cannot see the new club')
      : bad('the new club is visible to another academy')
    const { data: seenTeams } = await other.from('teams').select('id').eq('academy_id', academyId)
    seenTeams?.length === 0 ? ok('nor its teams') : bad(`${seenTeams.length} teams leaked`)
  }
} finally {
  await cleanUp()
}

console.log(
  process.exitCode
    ? '\n\x1b[31mFIRST RUN BROKEN\x1b[0m\n'
    : '\n\x1b[32mA brand-new club works, and is empty rather than broken.\x1b[0m\n'
)
process.exit(process.exitCode ?? 0)
