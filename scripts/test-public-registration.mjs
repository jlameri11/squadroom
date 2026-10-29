// Run: node --env-file=.env.local scripts/test-public-registration.mjs
//   (needs the app running — npm run dev)
//
// Proves 0122 (R-02): a family who has never heard of us.
//
// This is the most exposed surface in the product — writable by anyone on the
// internet, with no account, no invite link and no coach who knows their
// name. So the assertions are about what an open endpoint must NOT do:
//
//   · not confirm whether a named child plays at a named club
//   · not distinguish "full" from "closed" from "never existed"
//   · not grant anything at all before a human decides
//   · not publish one child, one family or one phone number
//
// and then that the happy path still works, because a safeguard that stops
// real families registering is a safeguard a club turns off.
import { createClient } from '@supabase/supabase-js'
import { resolveBaseUrl } from './_base-url.mjs'

const BASE = await resolveBaseUrl()
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})
// The anon key alone — exactly what a stranger's browser holds.
const anon = createClient(URL_, PUB, { auth: { persistSession: false } })

/**
 * A client that has never signed in, and never will.
 *
 * `anon` is the client every suite here hands to verifyOtp, which means that
 * after the first sign-in it holds a SESSION and is not anonymous any more.
 * Every "as a stranger" assertion made through it after that point was
 * really being made as whoever signed in last — passing, in at least one
 * case, for entirely the wrong reason.
 *
 * So the stranger gets their own client, used for nothing else.
 */
const stranger = createClient(URL_, PUB, { auth: { persistSession: false } })


const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`)
  process.exitCode = 1
}
const head = (m) => console.log(`\n${m}`)

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const SLUG = 'nrifa'
const TAG = 'TESTREG2'
const PHONE = '+61400007777'
const U8 = '00000000-0000-0000-0000-0000000d0008'

const post = (path, body, cookie) =>
  fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  })

/**
 * A route that is missing returns Next's 404 HTML, and `res.json()` on that
 * throws a SyntaxError that buries the whole suite in a page of markup. The
 * failure is worth reporting, not worth hiding the other twenty assertions
 * behind.
 */
async function jsonOf(res) {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return { error: `not JSON (${res.status}) — is the app built and running?` }
  }
}

async function sess(email) {
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (!link?.properties?.hashed_token) {
    console.log("  could not issue a magic link — the project's auth rate limit, not a failure")
    process.exit(2)
  }
  const { data: s } = await anon.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: 'email',
  })
  if (!s?.session) {
    console.log("  could not sign in — the project's auth rate limit, not a failure")
    process.exit(2)
  }
  return {
    client: createClient(URL_, PUB, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${s.session.access_token}` } },
    }),
    id: s.user.id,
    token: s.session.access_token,
  }
}

async function clean() {
  const { data: reqs } = await admin
    .from('registration_requests')
    .select('id, player_id, profile_id')
    .like('child_name', `${TAG}%`)
  for (const r of reqs ?? []) {
    if (r.player_id) {
      await admin.from('consent_acceptances').delete().eq('player_id', r.player_id)
      await admin.from('program_registrations').delete().eq('player_id', r.player_id)
      await admin.from('player_guardians').delete().eq('player_id', r.player_id)
      await admin.from('players').delete().eq('id', r.player_id)
    }
  }
  await admin.from('registration_requests').delete().like('child_name', `${TAG}%`)
  await admin.from('registration_attempts').delete().neq('id', 0)

  // The account this suite creates, so it can be run again.
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 })
  const mine = users.users.find((u) => u.phone === PHONE.replace('+', ''))
  if (mine) {
    await admin.from('academy_members').delete().eq('profile_id', mine.id)
    await admin.auth.admin.deleteUser(mine.id)
  }
  await admin.from('programs').delete().eq('academy_id', NRIFA).like('name', `${TAG}%`)
}
await clean()

// A program of our own, so the suite does not depend on how full the seeded
// ones happen to be.
const thisYear = new Date().getFullYear()
const { data: program, error: progErr } = await admin
  .from('programs')
  .insert({
    academy_id: NRIFA,
    name: `${TAG} Autumn Skills`,
    kind: 'development',
    status: 'open',
    born_from_year: thisYear - 10,
    born_to_year: thisYear - 8,
    capacity: 2,
    waitlist_enabled: false,
    created_by: '00000000-0000-0000-0000-0000000000a1',
  })
  .select('id')
  .single()
if (progErr) {
  bad(progErr.message)
  process.exit(1)
}

const { data: closed } = await admin
  .from('programs')
  .insert({
    academy_id: NRIFA,
    name: `${TAG} Closed Already`,
    kind: 'development',
    status: 'draft',
    created_by: '00000000-0000-0000-0000-0000000000a1',
  })
  .select('id')
  .single()

const { data: consentDocs } = await admin
  .from('consent_documents')
  .select('id, version, required')
  .eq('academy_id', NRIFA)
  .is('retired_at', null)
  .not('published_at', 'is', null)
const required = (consentDocs ?? []).filter((c) => c.required)
const allConsents = (consentDocs ?? []).map((c) => ({ id: c.id, version: c.version }))

const dobIn = (year) => `${year}-06-15`
const eligible = dobIn(thisYear - 9)

const submit = (over = {}) =>
  post('/api/register/request', {
    slug: SLUG,
    programId: program.id,
    guardianName: `${TAG} Parent`,
    guardianPhone: PHONE,
    childName: `${TAG} Child`,
    childDob: eligible,
    consents: allConsents,
    ...over,
  })

head('1. What a stranger may read')
{
  const { data, error } = await stranger.rpc('public_programs', { p_slug: SLUG })
  if (error) {
    bad(error.message)
  } else {
    const names = data.programs.map((p) => p.name)
    names.includes(`${TAG} Autumn Skills`) ? ok('an open program is listed') : bad(`listed: ${names}`)
    // Not listed as closed — not listed at all. Saying "closed" still
    // confirms it exists.
    names.includes(`${TAG} Closed Already`)
      ? bad('a draft program was published')
      : ok('a draft program is not published, not even as closed')

    const blob = JSON.stringify(data).toLowerCase()
    const { data: kids } = await admin.from('players').select('full_name').eq('academy_id', NRIFA)
    const leaked = (kids ?? [])
      .map((k) => k.full_name.split(' ')[0])
      .filter((n) => n.length > 2 && blob.includes(n.toLowerCase()))
    leaked.length === 0 ? ok('no child is named') : bad(`named: ${leaked.join(', ')}`)
    // Named, not inline: a line starting with `/` is parsed as division
    // against the expression above it. CLAUDE.md records this twice already.
    const looksLikeAPhone = /\+?61\d{8}/
    looksLikeAPhone.test(blob) ? bad('a phone number is published') : ok('no phone number')
    ok(`spots_left is an aggregate a club would print on a flyer (${data.programs.find((p) => p.name.startsWith(TAG))?.spots_left})`)
  }

  // A club that does not exist answers the same as one that does not publish.
  const { data: nobody } = await stranger.rpc('public_programs', { p_slug: 'no-such-club-here' })
  nobody === null ? ok('an unknown slug returns nothing') : bad(`returned ${JSON.stringify(nobody)}`)
}

head('2. What a stranger may NOT read')
{
  const { data: q } = await stranger.from('registration_requests').select('child_name')
  ;(q ?? []).length === 0 ? ok('the queue is invisible') : bad(`read ${q.length} requests`)

  const { data: attempts } = await stranger.from('registration_attempts').select('ip_hash')
  ;(attempts ?? []).length === 0 ? ok('and so is the rate-limit table') : bad('read the IP hashes')

  const { error: fn } = await stranger.rpc('check_registration', {
    p_academy_slug: SLUG,
    p_program: program.id,
    p_child_dob: eligible,
    p_consents: [],
  })
  fn ? ok('and the validation function is not callable directly') : bad('anon called check_registration')
}

head('3. The form refuses what it should')
{
  const noConsent = await submit({ consents: [] })
  noConsent.status === 400
    ? ok(`a missing required consent is refused (${required.length} required)`)
    : bad(`expected 400, got ${noConsent.status}`)

  const tooOld = await submit({ childDob: dobIn(thisYear - 30) })
  tooOld.status === 400 ? ok('a 30-year-old is refused') : bad(`got ${tooOld.status}`)

  const notBorn = await submit({ childDob: dobIn(thisYear + 2) })
  notBorn.status === 400 ? ok('and so is a date in the future') : bad(`got ${notBorn.status}`)

  const wrongYear = await submit({ childDob: dobIn(thisYear - 2) })
  wrongYear.status === 400 ? ok('an ineligible birth year is refused') : bad(`got ${wrongYear.status}`)

  // The important one: a draft program and a program that never existed give
  // the SAME answer, so an open endpoint is not a directory of what is real.
  const draft = await submit({ programId: closed.id })
  const ghost = await submit({ programId: '00000000-0000-0000-0000-00000000dead' })
  const draftBody = await jsonOf(draft)
  const ghostBody = await jsonOf(ghost)
  draft.status === ghost.status && draftBody.error === ghostBody.error
    ? ok(`a draft and a non-existent program answer identically ("${ghostBody.error}")`)
    : bad(`draft ${draft.status} "${draftBody.error}" vs ghost ${ghost.status} "${ghostBody.error}"`)

  const noContact = await submit({ guardianPhone: undefined, guardianEmail: undefined })
  noContact.status === 400 ? ok('and a family with no way to be contacted') : bad(`got ${noContact.status}`)

  const junkGender = await submit({ childGender: 'wharever' })
  junkGender.status === 400 ? ok('free text in the gender field is refused') : bad(`got ${junkGender.status}`)
}

head('4. A real registration goes through, and grants nothing')
let requestId, secret
{
  const res = await submit()
  if (res.status !== 200) {
    bad(`expected 200, got ${res.status}: ${JSON.stringify(await jsonOf(res))}`)
  } else {
    const b = await jsonOf(res)
    requestId = b.requestId
    secret = b.secret
    requestId && secret ? ok('submitted') : bad(`body: ${JSON.stringify(b)}`)
    // The id and the secret and nothing else. Anything more is an oracle.
    Object.keys(b).sort().join(',') === 'requestId,secret'
      ? ok('and says nothing else at all')
      : bad(`returned ${Object.keys(b).join(', ')}`)

    const { data: row } = await admin
      .from('registration_requests')
      .select('status, secret_hash, profile_id, player_id')
      .eq('id', requestId)
      .single()
    row.status === 'pending' ? ok('it is pending') : bad(`status ${row.status}`)
    !row.profile_id && !row.player_id
      ? ok('with no account and no roster row — nothing is granted yet')
      : bad('a submission created an account or a player')
    row.secret_hash !== secret
      ? ok('and the database holds only the hash of the secret')
      : bad('the secret is stored in plain text')
  }
}

head('5. The secret cannot be used before a club decides')
{
  const early = await post('/api/register/claim', { requestId, secret })
  early.status === 202 ? ok('202 pending — no session handed out') : bad(`got ${early.status}`)

  const wrong = await post('/api/register/claim', { requestId, secret: 'not-the-secret' })
  const missing = await post('/api/register/claim', {
    requestId: '00000000-0000-0000-0000-00000000dead',
    secret,
  })
  wrong.status === 404 && missing.status === 404
    ? ok('a wrong secret and an unknown id are indistinguishable')
    : bad(`wrong ${wrong.status}, missing ${missing.status}`)
}

head('6. A pending request takes a place, so a club cannot oversell')
{
  const { data: after } = await stranger.rpc('public_programs', { p_slug: SLUG })
  const mine = after.programs.find((p) => p.name.startsWith(TAG))
  // Capacity 2, one pending.
  mine.spots_left === 1
    ? ok('2 places, 1 pending, 1 left')
    : bad(`spots_left ${mine.spots_left}`)
}

head('7. The club sees it, and nobody else does')
{
  const coach = await sess('joeylameri@outlook.com')
  const { data: queue, error } = await coach.client.rpc('registration_queue', {
    p_academy: NRIFA,
    p_status: 'pending',
  })
  if (error) {
    bad(error.message)
  } else {
    const hit = (queue ?? []).find((r) => r.request_id === requestId)
    hit ? ok(`in the queue as "${hit.child_name}"`) : bad('not in the queue')
    hit?.program_name?.startsWith(TAG) ? ok('with the program named') : bad('no program name')
  }

  const parent = await sess('p61400000011@squadroom.invalid')
  const { data: asParent } = await parent.client.rpc('registration_queue', {
    p_academy: NRIFA,
    p_status: 'pending',
  })
  ;(asParent ?? []).length === 0
    ? ok("a parent at the club cannot read other families' registrations")
    : bad(`a parent read ${asParent.length}`)
}

head('8. A club approves, and a stranger becomes a family')
{
  // The coach's address is LOOKED UP from their id, never hard-coded — the
  // lesson test-join-flow records: generateLink SIGNS UP an unknown email
  // rather than failing, so a stale synthetic address silently produces a
  // session for a brand-new user who is a member of nothing, and the failure
  // reads like an RLS bug.
  const OWNER = '00000000-0000-0000-0000-0000000000a1'
  const { data: ownerUser } = await admin.auth.admin.getUserById(OWNER)
  if (!ownerUser?.user?.email) {
    bad('the owner has no email address to sign in with')
  } else {
    const { data: cl } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: ownerUser.user.email,
    })
    if (!cl?.properties?.hashed_token) {
      console.log("  could not issue a magic link — the project's auth rate limit, not a failure")
      process.exit(2)
    }
    const { data: cs } = await anon.auth.verifyOtp({
      token_hash: cl.properties.hashed_token,
      type: 'email',
    })
    if (cs?.user?.id !== OWNER) {
      bad('session is not the owner — generateLink created a new user')
    } else {
      // Reproduce the cookie @supabase/ssr writes, so the route sees a real
      // club admin.
      const ref = URL_.split('//')[1].split('.')[0]
      const cookie = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(cs.session)).toString('base64')}`

      const res = await post(
        '/api/register/approve',
        { requestId, decision: 'approve', teamId: U8 },
        cookie
      )
      const b = await jsonOf(res)
      res.ok ? ok('approved') : bad(`approve: ${res.status} ${JSON.stringify(b)}`)

      const { data: row } = await admin
        .from('registration_requests')
        .select('status, profile_id, player_id, registration_id')
        .eq('id', requestId)
        .single()

      row.status === 'approved' ? ok('the request is approved') : bad(`status ${row.status}`)
      row.profile_id ? ok('an account exists now') : bad('no account')
      row.player_id ? ok('and a roster row') : bad('no player')

      if (row.player_id) {
        const { data: player } = await admin
          .from('players')
          .select('full_name, dob, team_id')
          .eq('id', row.player_id)
          .single()
        // The date of birth is the whole reason it is collected: name alone
        // matches a cousin.
        player.dob === eligible ? ok('with the date of birth kept') : bad(`dob ${player.dob}`)
        player.team_id === U8 ? ok('and put in the squad the club chose') : bad(`team ${player.team_id}`)

        const { count: guardian } = await admin
          .from('player_guardians')
          .select('*', { count: 'exact', head: true })
          .eq('player_id', row.player_id)
          .eq('profile_id', row.profile_id)
        guardian === 1 ? ok('the parent is linked as their guardian') : bad(`guardians ${guardian}`)

        const { count: reg } = await admin
          .from('program_registrations')
          .select('*', { count: 'exact', head: true })
          .eq('player_id', row.player_id)
        reg === 1 ? ok('and registered in the program') : bad(`registrations ${reg}`)

        // The version, not just the document. "They accepted the code of
        // conduct" is worthless without which one.
        const { data: accepted } = await admin
          .from('consent_acceptances')
          .select('document_id, accepted')
          .eq('player_id', row.player_id)
        accepted.length === allConsents.length && accepted.every((a) => a.accepted)
          ? ok(`${accepted.length} consents recorded against the child`)
          : bad(`consents: ${JSON.stringify(accepted)}`)
      }

      if (row.profile_id) {
        // 0098: a child joining a squad brings their family into its
        // channels. Worth asserting here because the whole point of the
        // registration is that the family can be talked to on Saturday.
        const { count: channels } = await admin
          .from('channel_members')
          .select('*', { count: 'exact', head: true })
          .eq('profile_id', row.profile_id)
        channels > 0 ? ok(`and is in ${channels} channels`) : bad('the family is in no channels')
      }
    }
  }
}

head('9. The family comes back and collects their session, once')
{
  const res = await post('/api/register/claim', { requestId, secret })
  const cookie = res.headers.get('set-cookie')
  res.status === 200 ? ok('claimed') : bad(`claim: expected 200, got ${res.status}`)
  cookie?.includes('auth-token') ? ok('session cookie set on the response') : bad('no session cookie')

  // A registration page is public and its URL is meant to be shared, which
  // makes one-use more important here than for a join link.
  const again = await post('/api/register/claim', { requestId, secret })
  again.status === 409 ? ok('409 — a forwarded link is spent') : bad(`replay: got ${again.status}`)
}

head('10. An approved registration takes its place off the board')
{
  const { data: after } = await stranger.rpc('public_programs', { p_slug: SLUG })
  const mine = after.programs.find((p) => p.name.startsWith(TAG))
  // Still 1 left: the pending request became an approved registration, and
  // the count must not drop twice for one child.
  mine.spots_left === 1
    ? ok('still 1 left — the same child is not counted twice')
    : bad(`spots_left ${mine.spots_left}`)
}

head('11. Declining creates nothing')
{
  // A family who was turned away must not be left with an account at a club
  // that said no.
  const res = await submit({ childName: `${TAG} Declined`, guardianPhone: '+61400007778' })
  const b = await jsonOf(res)
  if (!b.requestId) {
    bad(`could not submit a second registration: ${JSON.stringify(b)}`)
  } else {
    const OWNER = '00000000-0000-0000-0000-0000000000a1'
    const { data: ownerUser } = await admin.auth.admin.getUserById(OWNER)
    const { data: cl } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: ownerUser.user.email,
    })
    if (!cl?.properties?.hashed_token) {
      console.log("  could not issue a magic link — the project's auth rate limit, not a failure")
      process.exit(2)
    }
    const { data: cs } = await anon.auth.verifyOtp({
      token_hash: cl.properties.hashed_token,
      type: 'email',
    })
    const ref = URL_.split('//')[1].split('.')[0]
    const cookie = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(cs.session)).toString('base64')}`

    const res2 = await post(
      '/api/register/approve',
      { requestId: b.requestId, decision: 'decline', note: 'Age group full' },
      cookie
    )
    res2.ok ? ok('declined') : bad(`decline: ${res2.status}`)

    const { data: row } = await admin
      .from('registration_requests')
      .select('status, profile_id, player_id, decision_note')
      .eq('id', b.requestId)
      .single()
    row.status === 'declined' ? ok('the request is declined') : bad(`status ${row.status}`)
    !row.profile_id && !row.player_id
      ? ok('with no account and no roster row')
      : bad('declining created an account or a player')
    row.decision_note === 'Age group full' ? ok('and the reason is kept') : bad('no reason')

    const { data: stranger } = await admin
      .from('profiles')
      .select('id')
      .eq('phone', '+61400007778')
      .maybeSingle()
    !stranger ? ok('and no profile anywhere for that number') : bad('a declined family has an account')

    // The secret stops working.
    const claim = await post('/api/register/claim', { requestId: b.requestId, secret: b.secret })
    claim.status === 403
      ? ok('their secret no longer opens anything')
      : bad(`claim after decline: ${claim.status}`)

    await admin.from('registration_requests').delete().eq('id', b.requestId)
  }
}

await clean()
console.log(
  process.exitCode ? '\n\x1b[31msome of this is wrong\x1b[0m' : '\n\x1b[32mall good\x1b[0m'
)
