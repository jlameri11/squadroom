// Run: node --env-file=.env.local scripts/test-tenant-guards.mjs
//
// An outsider cannot WRITE into somebody else's academy, by any route.
//
// This exists because of a bug 0092 fixed, and the shape of that bug is worth
// stating because it will be tempting to write again:
//
//   app_private.academy_role_of(p) returns NULL when you are not a member.
//   is_academy_coach(p) was `academy_role_of(p) in ('owner','admin','coach')`,
//   and `NULL in (...)` is NULL rather than false.
//   `if not NULL then raise` is NULL, which is not true, so the guard was
//   SKIPPED — for strangers specifically.
//
// It fired correctly for a parent (false → not false → true) and not at all
// for somebody from another club. Exactly backwards, and invisible to every
// test that only tried the parent case, which is what all of them did.
//
// In an RLS policy the same helper was always safe, because `using (NULL)`
// denies. Only the procedural `if not ...` guards were exposed. So this file
// tests the procedural ones, as a stranger, which is the case nobody checked.
//
// Every function here that takes an academy or a competition id gets called
// with one the signed-in person has nothing to do with.
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
const RAVENS = '00000000-0000-0000-0000-0000000a0002'
const U8 = '00000000-0000-0000-0000-0000000d0008'

async function sess(id) {
  const { data: u } = await admin.auth.admin.getUserById(id)
  if (!u?.user?.email) throw new Error(`no email for ${id}`)
  const { data: link } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: u.user.email,
  })
  // generateLink is rate limited per project as well as verifyOtp, and
  // returns null when it trips — so this property read throws before any
  // session check runs, and the runner reports a crash that is really the
  // auth budget.
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
    process.exit(1)
  }
  return createClient(URL_, PUB, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${s.session.access_token}` } },
  })
}

// Somebody who owns a DIFFERENT academy and is a member of nothing here. An
// owner on purpose: the highest privilege available anywhere in the product,
// pointed at a club that is not theirs.
const { data: theirs } = await admin
  .from('academy_members')
  .select('profile_id, role')
  .eq('academy_id', RAVENS)
  .eq('status', 'active')
  .order('role')
  .limit(1)
  .single()

const { data: alsoHere } = await admin
  .from('academy_members')
  .select('role')
  .eq('academy_id', NRIFA)
  .eq('profile_id', theirs.profile_id)
  .maybeSingle()

if (alsoHere) {
  bad(
    `the outsider is also a ${alsoHere.role} of NRIFA, so this test proves nothing — ` +
      'pick somebody who belongs to one academy only'
  )
  process.exit(1)
}

const { data: who } = await admin
  .from('profiles')
  .select('full_name')
  .eq('id', theirs.profile_id)
  .single()

const outsider = await sess(theirs.profile_id)
console.log(`\n  As ${who.full_name}, ${theirs.role} of Ravens FC and nothing at NRIFA`)

/** Every one of these must come back with an error, not a result. */
async function refuses(label, promise) {
  const { data, error } = await promise
  if (error) return ok(`${label} — refused: ${error.message.slice(0, 48)}…`)
  bad(`${label} — ALLOWED, returned ${JSON.stringify(data)?.slice(0, 80)}`)
}

head('1. is_academy_coach guards')
await refuses(
  'create a channel in their academy',
  outsider.rpc('create_channel', { p_academy: NRIFA, p_name: 'TENANTGUARD intrusion' })
)
await refuses(
  'schedule training in their academy',
  outsider.rpc('create_event_series', {
    p_academy: NRIFA,
    p_title: 'TENANTGUARD training',
    p_days: [2],
    p_time: '17:00',
    p_from: '2027-06-01',
    p_until: '2027-06-30',
  })
)
await refuses(
  'schedule into one of their teams',
  outsider.rpc('create_event_series', {
    p_academy: NRIFA,
    p_title: 'TENANTGUARD team training',
    p_team: U8,
    p_days: [3],
    p_time: '17:00',
    p_from: '2027-06-01',
    p_until: '2027-06-30',
  })
)

head('2. is_academy_staff guards')
const { data: comp } = await admin
  .from('competitions')
  .select('id')
  .eq('organiser_id', NRIFA)
  .limit(1)
  .maybeSingle()
if (comp) {
  await refuses(
    'invite clubs to their competition',
    outsider.rpc('bulk_invite_clubs', {
      p_competition: comp.id,
      p_division: 'TENANTGUARD',
      p_clubs: [{ club_name: 'TENANTGUARD FC' }],
    })
  )
  await refuses(
    'build a draw for their competition',
    outsider.rpc('generate_fixtures', {
      p_competition: comp.id,
      p_division: 'U8 Championship',
      p_start_at: new Date('2027-06-05T09:00:00+10:00').toISOString(),
      p_fields: ['Field 1'],
    })
  )
}

head('3. Nothing was actually written')
// The assertions above read the error. This reads the database, because a
// function that raises AFTER inserting would pass the test above and still
// have put a row in somebody else's club.
for (const [table, column, like] of [
  ['channels', 'name', 'TENANTGUARD%'],
  ['event_series', 'title', 'TENANTGUARD%'],
  ['events', 'title', 'TENANTGUARD%'],
  ['competition_entries', 'display_name', 'TENANTGUARD%'],
]) {
  const { count } = await admin
    .from(table)
    .select('*', { count: 'exact', head: true })
    .like(column, like)
  count === 0 ? ok(`${table}: nothing`) : bad(`${table}: ${count} rows written by an outsider`)
}

head('4. The helpers answer the question, rather than shrugging')
// The root cause, asserted directly. A guard cannot act on "I don't know",
// and these two returned exactly that for a non-member until 0092.
const { data: shrug } = await admin.rpc('tenant_guard_probe', { p_academy: NRIFA }).then(
  (r) => r,
  () => ({ data: null })
)
if (shrug === null) {
  // No probe function exists, and there should not be one — app_private is
  // deliberately unreachable over the API. Assert the behaviour instead.
  const { error: e1 } = await outsider.rpc('create_channel', {
    p_academy: NRIFA,
    p_name: 'TENANTGUARD second',
  })
  e1
    ? ok('a non-member is refused definitively, not ambiguously')
    : bad('still allowed — is_academy_coach is returning NULL again')
}

head('5. And a parent of this academy still cannot do staff things')
// The case that always worked, kept so a future fix cannot swing the other
// way and start denying members.
const { data: parentRow } = await admin
  .from('academy_members')
  .select('profile_id')
  .eq('academy_id', NRIFA)
  .eq('role', 'parent')
  .eq('status', 'active')
  .limit(1)
  .single()
const parent = await sess(parentRow.profile_id)
await refuses(
  'a parent creating a channel',
  parent.rpc('create_channel', { p_academy: NRIFA, p_name: 'TENANTGUARD by parent' })
)

head('6. A real coach of this academy still can')
// The other direction: 0092 must not have made the guards deny everybody.
const { data: coachRow } = await admin
  .from('academy_members')
  .select('profile_id')
  .eq('academy_id', NRIFA)
  .in('role', ['owner', 'admin', 'coach'])
  .eq('status', 'active')
  .limit(1)
  .single()
const coach = await sess(coachRow.profile_id)
const { data: made, error: coachError } = await coach.rpc('create_event_series', {
  p_academy: NRIFA,
  p_title: 'TENANTGUARD legitimate',
  p_days: [2],
  p_time: '17:00',
  p_from: '2027-06-01',
  p_until: '2027-06-15',
})
coachError
  ? bad(`a real coach was refused: ${coachError.message}`)
  : ok(`a coach of the academy created ${made.created} sessions`)

if (made?.series_id) {
  await admin.from('events').delete().eq('series_id', made.series_id)
  await admin.from('event_series').delete().eq('id', made.series_id)
}
await admin.from('channels').delete().like('name', 'TENANTGUARD%')
await admin.from('competition_entries').delete().like('display_name', 'TENANTGUARD%')

console.log(
  process.exitCode
    ? '\n\x1b[31mTENANT GUARDS BROKEN\x1b[0m\n'
    : '\n\x1b[32mAn outsider can write nothing, and a member still can.\x1b[0m\n'
)
process.exit(process.exitCode ?? 0)
