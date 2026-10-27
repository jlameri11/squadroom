// Run: node --env-file=.env.local scripts/test-clearances.mjs
//
// Proves 0120 (S-03): nobody stands in front of children without a current
// Working With Children Check.
//
// This is the one defect in this product that is not recoverable after the
// fact, so the assertions are about the ways a gate USUALLY leaks rather than
// about the happy path:
//
//   · a senior person being exempt "just this once" — the owner is not,
//     where it counts
//   · a status that looks fine and is not — 'barred' with a future date
//   · a date that looks fine and is not — a lapsed clearance recorded as
//     current
//   · the person who benefits doing the checking — nobody verifies themselves
//   · the row being written around the function that holds all these rules
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
const U8 = '00000000-0000-0000-0000-0000000d0008'
const MARCUS = '00000000-0000-0000-0000-0000000000a2'
const SAM = '00000000-0000-0000-0000-0000000000b1'

async function sess(email) {
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (!link?.properties?.hashed_token) {
    console.log(`  could not issue a link for ${email} — the project's auth rate limit, not a failure`)
    process.exit(2)
  }
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

const owner = await sess('joeylameri@outlook.com') // also the platform admin
const marcus = await sess('p61400000002@squadroom.invalid')
const parent = await sess('p61400000011@squadroom.invalid')

const day = 864e5
const dateIn = (n) => new Date(Date.now() + n * day).toISOString().slice(0, 10)

// Marcus's team membership is the lever this file pulls, so it goes back the
// way it was found and the clearances this file created are removed.
const marcusWasInU8 = await admin
  .from('team_members')
  .select('role')
  .eq('team_id', U8)
  .eq('profile_id', MARCUS)
  .maybeSingle()
  .then(({ data }) => data?.role ?? null)

async function clean() {
  await admin.from('team_members').delete().eq('team_id', U8).eq('profile_id', MARCUS)
  await admin.from('notification_queue').delete().eq('kind', 'wwcc_expiring')
  await admin.from('staff_clearances').delete().eq('academy_id', NRIFA)
  await admin
    .from('academy_members')
    .update({ role: 'coach' })
    .eq('academy_id', NRIFA)
    .eq('profile_id', MARCUS)
}
await clean()

const record = (who, profile, outcome, expiresOn, extra = {}) =>
  who.client.rpc('record_clearance', {
    p_academy: NRIFA,
    p_profile: profile,
    p_number: 'WWC1234567E',
    p_outcome: outcome,
    p_expires_on: expiresOn,
    ...extra,
  })

const addAsTeamCoach = (profile) =>
  admin
    .from('team_members')
    .insert({ academy_id: NRIFA, team_id: U8, profile_id: profile, role: 'coach' })

head('1. A coach cannot be put in front of a team without one')
{
  const { error } = await addAsTeamCoach(MARCUS)
  error
    ? ok(`refused — "${error.message.slice(0, 60)}…"`)
    : bad('an unverified adult was assigned to a squad')
}

head('2. Recording one opens the gate, and only then')
{
  const { error } = await record(owner, MARCUS, 'cleared', dateIn(400))
  if (error) {
    bad(error.message)
  } else {
    ok('recorded')
    const { error: added } = await addAsTeamCoach(MARCUS)
    added ? bad(added.message) : ok('and the assignment goes through')
    await admin.from('team_members').delete().eq('team_id', U8).eq('profile_id', MARCUS)
  }
}

head('3. The ways a clearance can look fine and not be')
{
  // Barred with a date years away. A gate that only checks the date lets
  // this through, and it is the single worst row in the table.
  await record(owner, MARCUS, 'barred', dateIn(900))
  const { error: barred } = await addAsTeamCoach(MARCUS)
  barred
    ? ok('barred, with a future expiry → still refused')
    : bad('a BARRED adult was assigned to a squad')

  await record(owner, MARCUS, 'not_found', dateIn(900))
  const { error: missing } = await addAsTeamCoach(MARCUS)
  missing ? ok('not found on the register → refused') : bad('an unfindable number was accepted')

  // An expiry in the past cannot be recorded as current at all, which is the
  // earlier of the two places to stop it.
  const { error: lapsed } = await record(owner, MARCUS, 'cleared', dateIn(-1))
  lapsed ? ok('a date that has already passed is refused') : bad('a lapsed clearance was recorded as current')

  // Expiring today is still valid today. Off-by-one in the other direction
  // would take a coach off the field on their renewal date.
  await record(owner, MARCUS, 'cleared', dateIn(0))
  const { error: today } = await addAsTeamCoach(MARCUS)
  today ? bad(`expiring today was refused: ${today.message}`) : ok('expiring today is still valid today')
  await admin.from('team_members').delete().eq('team_id', U8).eq('profile_id', MARCUS)
}

head('4. Nobody verifies themselves')
{
  // Needs a club admin who is NOT a platform admin, and promoting Marcus to
  // admin itself needs a clearance — which is the gate working, so the
  // sequence is: verify him, promote him, then watch him fail to verify
  // himself.
  await record(owner, MARCUS, 'cleared', dateIn(400))
  const { error: promote } = await admin
    .from('academy_members')
    .update({ role: 'admin' })
    .eq('academy_id', NRIFA)
    .eq('profile_id', MARCUS)
  if (promote) {
    bad(`could not promote a cleared coach: ${promote.message}`)
  } else {
    const { error } = await record(marcus, MARCUS, 'cleared', dateIn(900))
    error
      ? ok(`a club admin cannot record their own — "${error.message.slice(0, 50)}…"`)
      : bad('somebody verified themselves')

    // And can still record somebody else's, so the rule is about self, not
    // about being a lesser kind of admin.
    const { error: other } = await record(marcus, SAM, 'cleared', dateIn(400))
    other ? bad(other.message) : ok('but can record somebody else’s')
    await admin.from('staff_clearances').delete().eq('profile_id', SAM)
  }
}

head('5. A coach cannot record anybody’s')
{
  await admin
    .from('academy_members')
    .update({ role: 'coach' })
    .eq('academy_id', NRIFA)
    .eq('profile_id', MARCUS)
  const { error } = await record(marcus, SAM, 'cleared', dateIn(400))
  error ? ok(`refused (${error.code})`) : bad('a coach recorded a clearance')
}

head('6. A parent cannot read a clearance number')
{
  // A government identifier attached to a named adult. "The coach is
  // verified" is a fact a directory can show without it.
  const { data } = await parent.client.from('staff_clearances').select('number')
  ;(data ?? []).length === 0 ? ok('no rows for a parent') : bad(`a parent read ${data.length}`)

  const { data: board, error } = await parent.client.rpc('clearance_board', { p_academy: NRIFA })
  error || (board ?? []).length === 0
    ? ok('and no board either')
    : bad(`a parent read the board: ${board.length} rows`)
}

head('7. The row cannot be written around the function')
{
  // record_clearance holds the self-verification rule, the date rule and the
  // membership rule. A direct insert would skip all three.
  const { error: ins } = await owner.client.from('staff_clearances').insert({
    academy_id: NRIFA,
    profile_id: owner.id,
    number: 'DIRECT',
    outcome: 'cleared',
    expires_on: dateIn(900),
    verified_by: owner.id,
  })
  ins ? ok('direct insert refused, even for an owner') : bad('a clearance was inserted directly')

  // An update that matches no rows is not an error — PostgREST returns 204
  // either way, so `using (false)` looks like success. The only honest check
  // is whether the data moved. (The first version of this assertion read the
  // absence of an error as a leak and failed on a working policy.)
  const numberBefore = await admin
    .from('staff_clearances')
    .select('number')
    .eq('academy_id', NRIFA)
    .eq('profile_id', MARCUS)
    .maybeSingle()
    .then(({ data }) => data?.number)

  await owner.client
    .from('staff_clearances')
    .update({ number: 'TAMPERED', expires_on: dateIn(900) })
    .eq('academy_id', NRIFA)

  const numberAfter = await admin
    .from('staff_clearances')
    .select('number')
    .eq('academy_id', NRIFA)
    .eq('profile_id', MARCUS)
    .maybeSingle()
    .then(({ data }) => data?.number)

  numberBefore && numberAfter === numberBefore
    ? ok(`direct update changed nothing (still ${numberAfter})`)
    : bad(`number went from ${numberBefore} to ${numberAfter}`)

  const before = await admin
    .from('staff_clearances')
    .select('id', { count: 'exact', head: true })
    .eq('academy_id', NRIFA)
    .then(({ count }) => count)
  await owner.client.from('staff_clearances').delete().eq('academy_id', NRIFA)
  const after = await admin
    .from('staff_clearances')
    .select('id', { count: 'exact', head: true })
    .eq('academy_id', NRIFA)
    .then(({ count }) => count)
  before === after ? ok('and a verification record cannot be deleted') : bad('history was deleted')
}

head('8. A clearance cannot be recorded against a stranger')
{
  // Otherwise it would sit there satisfying a gate for somebody nobody at
  // this academy can see.
  const { data: outsider } = await admin
    .from('academy_members')
    .select('profile_id')
    .neq('academy_id', NRIFA)
    .limit(20)
  const { data: ours } = await admin
    .from('academy_members')
    .select('profile_id')
    .eq('academy_id', NRIFA)
  const mine = new Set((ours ?? []).map((r) => r.profile_id))
  const stranger = (outsider ?? []).find((r) => !mine.has(r.profile_id))
  if (!stranger) {
    ok('(no profile outside this academy to try)')
  } else {
    const { error } = await record(owner, stranger.profile_id, 'cleared', dateIn(400))
    error ? ok('refused — they are not at this academy') : bad('a stranger was given a clearance here')
  }
}

head('9. The board shows the GAP, not the paperwork')
{
  await admin.from('staff_clearances').delete().eq('academy_id', NRIFA)
  const { data, error } = await owner.client.rpc('clearance_board', { p_academy: NRIFA })
  if (error) {
    bad(error.message)
  } else {
    // Built from the people, so somebody with no record at all appears. A
    // list of clearances would show a club its filing and hide its risk.
    data.length > 0 && data.every((r) => r.state === 'missing')
      ? ok(`${data.length} staff, all shown as missing`)
      : bad(`states: ${JSON.stringify(data.map((r) => r.state))}`)

    data.some((r) => r.coaches)
      ? ok('and it names the squads they coach, so the urgent ones stand out')
      : bad('no squads named')

    // Worst first.
    await record(owner, MARCUS, 'cleared', dateIn(400))
    const { data: sorted } = await owner.client.rpc('clearance_board', { p_academy: NRIFA })
    sorted[sorted.length - 1]?.state === 'current'
      ? ok('the people who are fine sort to the bottom')
      : bad(`last row is ${sorted[sorted.length - 1]?.state}`)
  }
}

head('10. The club is warned before it lapses, and more than once')
{
  await admin.from('notification_queue').delete().eq('kind', 'wwcc_expiring')
  // 30 days out — inside the 60-day window.
  await record(owner, MARCUS, 'cleared', dateIn(30))

  const { data: sent, error } = await admin.rpc('queue_clearance_warnings')
  if (error) {
    bad(error.message)
  } else {
    sent > 0 ? ok(`${sent} warnings queued`) : bad('nobody was warned 30 days out')

    const { data: rows } = await admin
      .from('notification_queue')
      .select('profile_id, body, payload')
      .eq('kind', 'wwcc_expiring')

    // To the club, not the coach. A reminder only the person affected sees
    // is a reminder that stops when they ignore it.
    const toOwner = rows.some((r) => r.profile_id === owner.id)
    toOwner ? ok('the owner is told') : bad('the owner was not told')
    rows.every((r) => r.payload?.subject_id === MARCUS)
      ? ok('and each one names whose check it is')
      : bad('a warning does not say who it is about')
    rows.some((r) => /\d+ days/.test(r.body ?? ''))
      ? ok(`with the number of days ("${rows[0].body}")`)
      : bad(`body: ${JSON.stringify(rows[0]?.body)}`)

    // Running the sweep again must tell nobody twice — the same lesson as
    // the RSVP nudge, and the reason the rate limit lives in the function.
    const { data: again } = await admin.rpc('queue_clearance_warnings')
    again === 0 ? ok('running it again warns nobody twice') : bad(`${again} duplicates`)
  }

  // Outside the window, nothing is sent.
  await admin.from('notification_queue').delete().eq('kind', 'wwcc_expiring')
  await record(owner, MARCUS, 'cleared', dateIn(400))
  const { data: quiet } = await admin.rpc('queue_clearance_warnings')
  quiet === 0 ? ok('and a check with a year left warns nobody') : bad(`${quiet} warnings at 400 days`)
}

head('11. An owner can run a club unverified, but cannot coach a team')
{
  // The one exemption, and the argument for it: the first owner of a new
  // academy has nobody to verify them, and a product that cannot be started
  // is not a safer product. It is safe only because the place it matters has
  // no exemption at all.
  await admin.from('staff_clearances').delete().eq('academy_id', NRIFA)
  const { data: still } = await owner.client.rpc('clearance_board', { p_academy: NRIFA })
  still.length > 0 ? ok('the owner keeps running the club') : bad('the owner lost access')

  const { error } = await admin
    .from('team_members')
    .insert({ academy_id: NRIFA, team_id: U8, profile_id: owner.id, role: 'coach' })
  error
    ? ok('and is refused as a team coach, exactly like anybody else')
    : bad('an unverified owner was assigned to a squad')
}

await clean()
// Marcus goes back where he was found.
if (marcusWasInU8) {
  await admin.rpc('record_clearance', {
    p_academy: NRIFA,
    p_profile: MARCUS,
    p_number: 'RESTORE',
    p_outcome: 'cleared',
    p_expires_on: dateIn(365),
  })
  await admin
    .from('team_members')
    .insert({ academy_id: NRIFA, team_id: U8, profile_id: MARCUS, role: marcusWasInU8 })
  await admin.from('staff_clearances').delete().eq('academy_id', NRIFA).eq('number', 'RESTORE')
}

console.log(
  process.exitCode ? '\n\x1b[31msome of this is wrong\x1b[0m' : '\n\x1b[32mall good\x1b[0m'
)
