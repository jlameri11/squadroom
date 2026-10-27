// Run: npm run dev, then node --env-file=.env.local scripts/test-contacts.mjs
//
// The two directions of "linked to phone contacts", and adding somebody.
//
// The assertion that matters most is the last one: adding a contact creates
// PRESENCE, not ACCESS. A coach vouching for somebody is good enough to put
// them in a directory so the club can ring them; it is not good enough to put
// a live session on an unknown device. If adding a contact ever handed out a
// way to sign in, a coach's typo would put a stranger in a channel full of
// children's names.
import { createClient } from '@supabase/supabase-js'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})
const anon = createClient(URL_, PUB, { auth: { persistSession: false } })
const SITE = process.env.SITE ?? 'http://localhost:3000'

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`)
  process.exitCode = 1
}
const head = (m) => console.log(`\n${m}`)

// Hoisted, because a line that STARTS with a regex literal is parsed as
// division against whatever the previous statement evaluated to. Caught this
// in test-join-codes and then did it again here.
const HAS_MOBILE = /TEL;TYPE=CELL:\+61/
const HAS_ANY_TEL = /TEL/
const HAS_EMAIL = /EMAIL/i

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const TAG = 'TESTCONTACT'
// A number nobody real has, in a range that parses as Australian.
const PHONE = '0400555901'

/**
 * A cookie jar good enough to be a signed-in browser.
 *
 * Signed in by LINK rather than password. The demo password only exists on
 * the synthetic @squadroom.invalid accounts — demo-passwords.mjs deliberately
 * leaves real addresses alone, so the owner has no password to use here and
 * the first version of this could not sign in as them at all.
 */
async function browser(email) {
  const client = createClient(URL_, PUB, { auth: { persistSession: false } })
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  // generateLink is rate limited per project as well as verifyOtp, and
  // returns null when it trips — so the property read below throws
  // before any session check runs, and the runner reports a crash
  // that is really the auth budget.
  if (!link?.properties?.hashed_token) {
    console.log(`  could not issue a link for ${email} — the project's auth rate limit, not a failure`)
    process.exit(2)
  }
  const { data, error } = await client.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: 'email',
  })
  if (error || !data.session) {
    console.log(`  could not sign in ${email}: ${error?.message ?? 'auth rate limit'}`)
    process.exit(2)
  }
  // @supabase/ssr reads the session from a cookie named for the project ref.
  const ref = URL_.replace('https://', '').split('.')[0]
  const cookie = `sb-${ref}-auth-token=base64-${Buffer.from(
    JSON.stringify(data.session)
  ).toString('base64')}`
  return { cookie, id: data.user.id, token: data.session.access_token }
}

async function clean() {
  const { data: people } = await admin
    .from('profiles')
    .select('id')
    .eq('phone', '+61400555901')
  for (const p of people ?? []) {
    await admin.from('team_members').delete().eq('profile_id', p.id)
    await admin.from('academy_members').delete().eq('profile_id', p.id)
    await admin.auth.admin.deleteUser(p.id).catch(() => {})
  }
}
await clean()

const coach = await browser('joeylameri@outlook.com')
const parent = await browser('p61400000011@squadroom.invalid')

head('1. Saving somebody to your phone')
{
  // The coach, whose number a parent IS allowed to see.
  const { data: staff } = await admin
    .from('academy_members')
    .select('profile_id')
    .eq('academy_id', NRIFA)
    .eq('role', 'coach')
    .limit(1)
    .single()

  const res = await fetch(`${SITE}/api/contacts/${staff.profile_id}`, {
    headers: { cookie: parent.cookie },
  })
  const body = await res.text()

  res.ok ? ok(`the card downloads (${res.status})`) : bad(`returned ${res.status}`)
  res.headers.get('content-type')?.includes('text/vcard')
    ? ok('as text/vcard, which is what makes iOS offer "Add to Contacts"')
    : bad(`content-type is ${res.headers.get('content-type')}`)
  body.startsWith('BEGIN:VCARD') && body.includes('END:VCARD')
    ? ok('a well-formed vCard')
    : bad(`malformed: ${body.slice(0, 60)}`)
  body.includes('VERSION:3.0')
    ? ok('version 3.0, which every phone agrees about')
    : bad('wrong vCard version')
  HAS_MOBILE.test(body)
    ? ok("and it carries the coach's number, which a parent may see")
    : bad('no phone number on a card a parent is allowed one for')
  body.includes('ORG:')
    ? ok('with the club on it, so the contact is recognisable in a year')
    : bad('no organisation')
  // A synthetic address in somebody's address book is a dead address they
  // will try to use.
  HAS_EMAIL.test(body) ? bad('an email address was included') : ok('and no email address')
}

head("2. A parent saving another parent gets no number")
{
  const { data: other } = await admin
    .from('academy_members')
    .select('profile_id')
    .eq('academy_id', NRIFA)
    .eq('role', 'parent')
    .neq('profile_id', parent.id)
    .limit(1)
    .single()

  const res = await fetch(`${SITE}/api/contacts/${other.profile_id}`, {
    headers: { cookie: parent.cookie },
  })
  const body = await res.text()
  res.ok ? ok('the card still downloads') : bad(`returned ${res.status}`)
  HAS_ANY_TEL.test(body)
    ? bad("another parent's number was published in a vCard")
    : ok('with no number, because directory_visibility says staff only')
}

head('3. Somebody from another academy gets nothing')
{
  const { data: ravens } = await admin
    .from('academy_members')
    .select('profile_id')
    .eq('academy_id', '00000000-0000-0000-0000-0000000a0002')
    .eq('status', 'active')
    .limit(1)
    .single()
  const res = await fetch(`${SITE}/api/contacts/${ravens.profile_id}`, {
    headers: { cookie: parent.cookie },
  })
  res.status === 404
    ? ok('404, indistinguishable from no such person')
    : bad(`returned ${res.status} for somebody in another club`)
}

head('4. A parent cannot add people')
{
  const res = await fetch(`${SITE}/api/contacts/add`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: parent.cookie },
    body: JSON.stringify({ academyId: NRIFA, fullName: `${TAG} Nope`, phone: PHONE }),
  })
  res.status === 403 ? ok(`refused (${res.status})`) : bad(`a parent added somebody (${res.status})`)
}

head('5. A coach adds the grandparent who does the driving')
{
  const { data: team } = await admin
    .from('teams')
    .select('id, name')
    .eq('academy_id', NRIFA)
    .eq('status', 'active')
    .limit(1)
    .single()

  const res = await fetch(`${SITE}/api/contacts/add`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: coach.cookie },
    body: JSON.stringify({
      academyId: NRIFA,
      fullName: `${TAG} Nan Driver`,
      phone: PHONE,
      role: 'parent',
      teamId: team.id,
    }),
  })
  const payload = await res.json().catch(() => null)
  if (!res.ok) {
    bad(`${res.status} ${JSON.stringify(payload)}`)
  } else {
    ok(`added (${payload.name})`)

    const { data: profile } = await admin
      .from('profiles')
      .select('id, full_name, phone')
      .eq('id', payload.profileId)
      .single()
    profile.phone === '+61400555901'
      ? ok('number stored in E.164, not as typed')
      : bad(`phone is ${profile.phone}`)

    const { data: member } = await admin
      .from('academy_members')
      .select('role, status')
      .eq('academy_id', NRIFA)
      .eq('profile_id', payload.profileId)
      .single()
    member.role === 'parent' && member.status === 'active'
      ? ok('an active member, so the club can reach them')
      : bad(JSON.stringify(member))

    const { data: tm } = await admin
      .from('team_members')
      .select('team_id')
      .eq('profile_id', payload.profileId)
      .maybeSingle()
    tm?.team_id === team.id ? ok(`and in ${team.name}`) : bad('not in the squad')

    // The trigger that puts a team member in the squad's conversations.
    const { count: channels } = await admin
      .from('channel_members')
      .select('channel_id', { count: 'exact', head: true })
      .eq('profile_id', payload.profileId)
    channels > 0 ? ok(`in ${channels} conversation(s)`) : bad('in no channels')

    // THE ASSERTION THAT MATTERS: presence, not access.
    const { data: user } = await admin.auth.admin.getUserById(payload.profileId)
    user.user.email?.endsWith('@squadroom.invalid')
      ? ok('their address is synthetic, so no sign-in link can ever reach it')
      : bad(`a real address was created: ${user.user.email}`)

    const guessed = await anon.auth.signInWithPassword({
      email: user.user.email,
      password: 'squadroom-demo',
    })
    guessed.error
      ? ok('and no password, so adding somebody hands out no account')
      : bad('an added contact could sign in — presence became access')

    const link = await anon.auth.signInWithOtp({
      email: user.user.email,
      options: { shouldCreateUser: false },
    })
    // Either refused, or accepted and delivered to an address that cannot
    // exist. Both are fine; silently granting a session would not be.
    ok(
      link.error
        ? `and a sign-in link is refused: ${link.error.message.slice(0, 40)}`
        : 'and a link would go to an address that can never receive it'
    )
  }
}

head('6. Adding the same number twice reuses the person')
{
  const res = await fetch(`${SITE}/api/contacts/add`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: coach.cookie },
    body: JSON.stringify({
      academyId: NRIFA,
      fullName: `${TAG} Different Spelling`,
      phone: '0400 555 901',
      role: 'parent',
    }),
  })
  const payload = await res.json().catch(() => null)
  res.ok && payload.reused
    ? ok('matched on the number, however it was typed')
    : bad(`created a duplicate (${JSON.stringify(payload)})`)

  const { count } = await admin
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('phone', '+61400555901')
  count === 1 ? ok('one person, not two') : bad(`${count} profiles with that number`)

  // And a coach's spelling must not rename somebody who already had a name.
  const { data: profile } = await admin
    .from('profiles')
    .select('full_name')
    .eq('phone', '+61400555901')
    .single()
  profile.full_name === `${TAG} Nan Driver`
    ? ok('and keeps the name it already had')
    : bad(`renamed to ${profile.full_name}`)
}

head('7. A nonsense number is refused before an account exists')
{
  const res = await fetch(`${SITE}/api/contacts/add`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: coach.cookie },
    body: JSON.stringify({ academyId: NRIFA, fullName: `${TAG} Bad`, phone: '12' }),
  })
  res.status === 400 ? ok(`refused (${res.status})`) : bad(`accepted "12" (${res.status})`)

  const noPhone = await fetch(`${SITE}/api/contacts/add`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: coach.cookie },
    body: JSON.stringify({ academyId: NRIFA, fullName: `${TAG} No Number` }),
  })
  noPhone.status === 400
    ? ok('and a name with no number is refused, rather than making an unreachable row')
    : bad(`accepted a contact with no number (${noPhone.status})`)
}

head('8. A coach cannot add another coach')
{
  // Adding staff grants the right to add more staff, so it is owner/admin
  // only. Marcus is a coach and nothing else.
  const marcus = await browser('p61400000002@squadroom.invalid')
  const res = await fetch(`${SITE}/api/contacts/add`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: marcus.cookie },
    body: JSON.stringify({
      academyId: NRIFA,
      fullName: `${TAG} New Coach`,
      phone: '0400555902',
      role: 'coach',
    }),
  })
  res.status === 403
    ? ok('refused — adding staff is owner and admin only')
    : bad(`a coach added a coach (${res.status})`)

  const asParent = await fetch(`${SITE}/api/contacts/add`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: marcus.cookie },
    body: JSON.stringify({
      academyId: NRIFA,
      fullName: `${TAG} A Parent`,
      phone: PHONE,
      role: 'parent',
    }),
  })
  asParent.ok ? ok('but a coach can still add a parent') : bad(`could not add a parent (${asParent.status})`)
}

head('9. An outsider cannot add into this academy')
{
  const { data: ravens } = await admin
    .from('academy_members')
    .select('profile_id')
    .eq('academy_id', '00000000-0000-0000-0000-0000000a0002')
    .eq('role', 'owner')
    .limit(1)
    .single()
  const { data: u } = await admin.auth.admin.getUserById(ravens.profile_id)
  const outsider = await browser(u.user.email)
  const res = await fetch(`${SITE}/api/contacts/add`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: outsider.cookie },
    body: JSON.stringify({ academyId: NRIFA, fullName: `${TAG} Hijack`, phone: '0400555903' }),
  })
  res.status === 403 ? ok(`refused (${res.status})`) : bad(`an outsider added somebody (${res.status})`)
}

await clean()
await admin.from('profiles').select('id').eq('phone', '+61400555902')
console.log(
  process.exitCode
    ? '\n\x1b[31mCONTACTS BROKEN\x1b[0m\n'
    : '\n\x1b[32mA contact saves to a phone, and adding one grants presence without access.\x1b[0m\n'
)
process.exit(process.exitCode ?? 0)
