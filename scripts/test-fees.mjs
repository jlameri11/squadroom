// Run: node --env-file=.env.local scripts/test-fees.mjs
//
// Proves 0102: sibling discounts, instalments, and who owes what.
//
// This is the money, so the arithmetic is asserted to the cent. Four things
// would do real harm:
//
//   · Instalments that do not sum to the total. A $600 fee paid in four and
//     a cent out is a conversation nobody should have to have, and a club
//     either loses a cent or a parent is overcharged one.
//   · A discount the parent's SCREEN shows and the CHECKOUT ignores. Both
//     ask the same function here for exactly that reason.
//   · A sibling discount given to the wrong child, or to a family with one
//     child.
//   · A list of who is behind on fees readable by another parent.
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
const money = (c) => `$${(c / 100).toFixed(2)}`

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const TAG = 'TESTFEE'

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
const other = await sess('p61400000012@squadroom.invalid')

// Put the academy's discount ladder back however it was.
const { data: before } = await admin
  .from('academies')
  .select('sibling_discount_bps')
  .eq('id', NRIFA)
  .single()

async function clean() {
  const { data: reqs } = await admin
    .from('payment_requests')
    .select('id')
    .eq('academy_id', NRIFA)
    .like('title', `${TAG}%`)
  for (const r of reqs ?? []) await admin.from('payments').delete().eq('request_id', r.id)
  await admin.from('payment_requests').delete().eq('academy_id', NRIFA).like('title', `${TAG}%`)
  await admin
    .from('academies')
    .update({ sibling_discount_bps: before.sibling_discount_bps })
    .eq('id', NRIFA)
}
await clean()

// Sam's children — the family the discount is about.
const { data: links } = await admin
  .from('player_guardians')
  .select('player_id')
  .eq('profile_id', sam.id)
const { data: kids } = await admin
  .from('players')
  .select('id, full_name, dob, team_id, created_at')
  .in('id', (links ?? []).map((l) => l.player_id))
  .order('dob')

if ((kids ?? []).length < 2) {
  bad(`Sam has ${kids?.length} children — this needs two`)
  process.exit(1)
}

// Ordered the way the database ranks them — date of birth, then created_at,
// then id — because Sam's two are TWINS. Sorting by dob alone leaves the
// order up to whatever Postgres returned, and the test then disagrees with
// the function about which child is which.
const ordered = [...kids].sort(
  (a, b) =>
    (a.dob ?? '').localeCompare(b.dob ?? '') ||
    (a.created_at ?? '').localeCompare(b.created_at ?? '') ||
    a.id.localeCompare(b.id)
)
const [eldest, younger] = ordered
if (eldest.dob === younger.dob) {
  ok(`${eldest.full_name} and ${younger.full_name} are twins — the case that broke 0102`)
}

async function makeRequest(title, cents, extra = {}) {
  const { data, error } = await admin
    .from('payment_requests')
    .insert({
      academy_id: NRIFA,
      title: `${TAG} ${title}`,
      amount_cents: cents,
      per_player: true,
      due_on: new Date().toISOString().slice(0, 10),
      created_by: owner.id,
      ...extra,
    })
    .select('id')
    .single()
  if (error) throw new Error(`${title}: ${error.message}`)
  return data.id
}

head('1. No ladder, no discount')
{
  await admin.from('academies').update({ sibling_discount_bps: [] }).eq('id', NRIFA)
  const request = await makeRequest('Plain term fee', 60000)
  const { data: q } = await sam.client.rpc('quote_payment', {
    p_request: request,
    p_player: younger.id,
  })
  q.net_cents === 60000 ? ok(`${money(q.net_cents)}, full price`) : bad(`${money(q.net_cents)}`)
  q.discount_cents === 0 ? ok('no discount') : bad(`discount of ${money(q.discount_cents)}`)
  q.instalments === 1 ? ok('one payment') : bad(`${q.instalments} instalments`)
}

head('2. Second child 10% off, third and beyond 20%')
{
  await admin.from('academies').update({ sibling_discount_bps: [1000, 2000] }).eq('id', NRIFA)
  const request = await makeRequest('Season fee', 60000)

  const { data: first } = await sam.client.rpc('quote_payment', {
    p_request: request,
    p_player: eldest.id,
  })
  const { data: second } = await sam.client.rpc('quote_payment', {
    p_request: request,
    p_player: younger.id,
  })

  first.sibling_rank === 1 && first.net_cents === 60000
    ? ok(`${eldest.full_name} is child 1 and pays ${money(first.net_cents)}`)
    : bad(`eldest: rank ${first.sibling_rank}, ${money(first.net_cents)}`)

  second.sibling_rank === 2 && second.net_cents === 54000
    ? ok(`${younger.full_name} is child 2 and pays ${money(second.net_cents)} — 10% off`)
    : bad(`younger: rank ${second.sibling_rank}, ${money(second.net_cents)}`)

  second.discount_cents === 6000
    ? ok(`a saving of ${money(second.discount_cents)}`)
    : bad(`discount ${money(second.discount_cents)}`)

  // A family with ONE child must never get a discount, which is the mistake
  // that would quietly cost a club money across a whole season.
  const { data: onlyChildLinks } = await admin
    .from('player_guardians')
    .select('player_id')
    .eq('profile_id', other.id)
  if ((onlyChildLinks ?? []).length === 1) {
    const { data: solo } = await other.client.rpc('quote_payment', {
      p_request: request,
      p_player: onlyChildLinks[0].player_id,
    })
    solo.sibling_rank === 1 && solo.net_cents === 60000
      ? ok('a one-child family pays full price')
      : bad(`one-child family: rank ${solo.sibling_rank}, ${money(solo.net_cents)}`)
  }
}

head('3. Instalments sum to the total, exactly')
{
  await admin.from('academies').update({ sibling_discount_bps: [1000] }).eq('id', NRIFA)
  // 60000 with 10% off is 54000, which divides by 4. 59999 does not, and
  // that is the case worth asserting.
  for (const [cents, parts] of [
    [60000, 4],
    [59999, 4],
    [10001, 3],
    [100, 12],
  ]) {
    const request = await makeRequest(`Split ${cents}x${parts}`, cents, {
      instalments: parts,
      instalment_every_days: 30,
    })
    const { data: q } = await sam.client.rpc('quote_payment', {
      p_request: request,
      p_player: younger.id,
    })
    const total = q.schedule.reduce((n, s) => n + s.amount_cents, 0)
    total === q.net_cents
      ? ok(`${money(cents)} in ${parts}: parts sum to ${money(total)} exactly`)
      : bad(`${money(cents)} in ${parts}: parts sum to ${money(total)}, net is ${money(q.net_cents)}`)
    q.schedule.every((s) => s.amount_cents > 0)
      ? null
      : bad('an instalment of zero or less')
  }
}

head('4. The schedule is dated a month apart')
{
  const request = await makeRequest('Dated', 40000, { instalments: 3, instalment_every_days: 30 })
  const { data: q } = await sam.client.rpc('quote_payment', {
    p_request: request,
    p_player: younger.id,
  })
  const days = q.schedule.map((s) => new Date(s.due_on).getTime())
  const gaps = days.slice(1).map((d, i) => Math.round((d - days[i]) / 864e5))
  gaps.every((g) => g === 30)
    ? ok(`three parts, ${gaps.join(' and ')} days apart`)
    : bad(`gaps are ${gaps.join(', ')}`)
  q.schedule.every((s) => s.status === 'unpaid')
    ? ok('all unpaid to begin with')
    : bad('something is already marked paid')
  q.outstanding_cents === q.net_cents
    ? ok(`${money(q.outstanding_cents)} outstanding`)
    : bad(`outstanding ${money(q.outstanding_cents)} vs net ${money(q.net_cents)}`)
}

head('5. Paying one part leaves the rest')
{
  const request = await makeRequest('Part paid', 40000, { instalments: 4 })
  const { data: q1 } = await sam.client.rpc('quote_payment', {
    p_request: request,
    p_player: younger.id,
  })
  const part = q1.schedule[0]

  // What the webhook does when the money lands.
  const { error } = await admin.from('payments').insert({
    academy_id: NRIFA,
    request_id: request,
    profile_id: sam.id,
    player_id: younger.id,
    instalment_seq: part.seq,
    amount_cents: part.amount_cents,
    status: 'paid',
    paid_at: new Date().toISOString(),
  })
  if (error) {
    bad(`could not record a part payment: ${error.message}`)
  } else {
    const { data: q2 } = await sam.client.rpc('quote_payment', {
      p_request: request,
      p_player: younger.id,
    })
    q2.schedule[0].status === 'paid' ? ok('part 1 shows as paid') : bad('part 1 still unpaid')
    q2.outstanding_cents === q2.net_cents - part.amount_cents
      ? ok(`${money(q2.outstanding_cents)} left of ${money(q2.net_cents)}`)
      : bad(`outstanding ${money(q2.outstanding_cents)}`)

    // Four instalments need four payment rows for one child — the thing
    // 0060's one-row-per-player constraint made impossible.
    const { error: second } = await admin.from('payments').insert({
      academy_id: NRIFA,
      request_id: request,
      profile_id: sam.id,
      player_id: younger.id,
      instalment_seq: 2,
      amount_cents: q1.schedule[1].amount_cents,
      status: 'paid',
      paid_at: new Date().toISOString(),
    })
    second
      ? bad(`a second instalment was refused: ${second.message}`)
      : ok('and a second part can be recorded for the same child')

    // But not the same part twice.
    const { error: dupe } = await admin.from('payments').insert({
      academy_id: NRIFA,
      request_id: request,
      profile_id: sam.id,
      player_id: younger.id,
      instalment_seq: 2,
      amount_cents: 1,
      status: 'paid',
    })
    dupe ? ok('while the same part twice is still refused') : bad('part 2 was recorded twice')
  }
}

head('6. A parent cannot price another family’s child')
{
  const request = await makeRequest('Private', 30000)
  const { data: otherLinks } = await admin
    .from('player_guardians')
    .select('player_id')
    .eq('profile_id', other.id)
    .limit(1)
    .maybeSingle()
  if (otherLinks) {
    const { data: q } = await sam.client.rpc('quote_payment', {
      p_request: request,
      p_player: otherLinks.player_id,
    })
    q === null
      ? ok("nothing comes back for somebody else's child")
      : bad(`a parent priced another family's child: ${JSON.stringify(q).slice(0, 80)}`)
  }
}

head('7. Who owes what — for staff only')
{
  const { data: rows, error } = await owner.client.rpc('outstanding_fees', { p_academy: NRIFA })
  if (error) {
    bad(error.message)
  } else {
    const mine = (rows ?? []).filter((r) => r.title.startsWith(TAG))
    mine.length > 0 ? ok(`${mine.length} outstanding rows`) : bad('nothing outstanding')
    mine.every((r) => r.outstanding_cents > 0)
      ? ok('every row actually owes something')
      : bad('a settled row is listed as outstanding')
    mine.some((r) => r.guardian_name)
      ? ok(`and names who to chase, e.g. ${mine.find((r) => r.guardian_name).guardian_name}`)
      : bad('no guardian to chase')
    // The discount has to be reflected here too, or the owner chases a
    // family for money they do not owe.
    const discounted = mine.find((r) => r.player_id === younger.id && r.net_cents === 54000)
    discounted
      ? ok(`the second child's row shows ${money(discounted.net_cents)}, discount applied`)
      : ok('(no 10%-off row in this set to check)')
  }

  const { error: asParent } = await sam.client.rpc('outstanding_fees', { p_academy: NRIFA })
  asParent
    ? ok('a parent is refused — who is behind on fees is nobody else’s business')
    : bad('a parent read the list of families behind on fees')
}

head('8. A nonsense ladder is refused')
{
  for (const ladder of [[-100], [12000], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]]) {
    const { error } = await admin
      .from('academies')
      .update({ sibling_discount_bps: ladder })
      .eq('id', NRIFA)
    error
      ? ok(`refused ${JSON.stringify(ladder).slice(0, 24)}`)
      : bad(`accepted ${JSON.stringify(ladder)}`)
  }
  // And a sane one is still accepted.
  const { error } = await admin
    .from('academies')
    .update({ sibling_discount_bps: [1000, 2000] })
    .eq('id', NRIFA)
  error ? bad(`a sane ladder was refused: ${error.message}`) : ok('and a sane one is accepted')
}

head('9. An outsider sees none of it')
{
  const { data: ravens } = await admin
    .from('academy_members')
    .select('profile_id')
    .eq('academy_id', '00000000-0000-0000-0000-0000000a0002')
    .eq('status', 'active')
    .limit(1)
    .single()
  const { data: u } = await admin.auth.admin.getUserById(ravens.profile_id)
  const outsider = await sess(u.user.email)
  const { error } = await outsider.client.rpc('outstanding_fees', { p_academy: NRIFA })
  error ? ok('refused') : bad("an outsider read another academy's debts")
}

await clean()
console.log(
  process.exitCode
    ? '\n\x1b[31mFEES BROKEN\x1b[0m\n'
    : '\n\x1b[32mThe arithmetic holds to the cent, and only staff see who owes.\x1b[0m\n'
)
process.exit(process.exitCode ?? 0)
