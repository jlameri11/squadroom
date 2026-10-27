// Run: node --env-file=.env.local scripts/test-program-fees.mjs
//
// Proves 0126 (B-01): a fee that belongs to a program.
//
// Nothing here touches Stripe, deliberately. The repo's plan says B-01 is
// WIRING — a registration flows through the existing payment_requests and the
// existing checkout — and CLAUDE.md is blunt about why a second money path is
// dangerous. So what is testable without a key is the part that decides who
// owes what, which is also the part that goes wrong expensively.
//
// The assertions are about the two ways a fee lands on the wrong family:
//
//   · scoped too wide — a camp fee owed by every child in the academy,
//     eighteen of whom never registered
//   · scoped too soon — a fee owed by a family whose registration the club
//     has not accepted yet, which is exactly the charge-then-refund problem
//     the design avoids
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
const LEO = '00000000-0000-0000-0000-0000000e0001'
const ZOE = '00000000-0000-0000-0000-0000000e0006'
const ARJUN = '00000000-0000-0000-0000-0000000e0002'
const OWNER = '00000000-0000-0000-0000-0000000000a1'
const TAG = 'TESTFEE'

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
  }
}

const owner = await sess('joeylameri@outlook.com')
const sam = await sess('p61400000011@squadroom.invalid') // Leo and Zoe
const other = await sess('p61400000012@squadroom.invalid') // Arjun

async function clean() {
  const { data: progs } = await admin
    .from('programs')
    .select('id, payment_request_id')
    .eq('academy_id', NRIFA)
    .like('name', `${TAG}%`)
  for (const p of progs ?? []) {
    await admin.from('program_registrations').delete().eq('program_id', p.id)
    await admin.from('programs').update({ payment_request_id: null }).eq('id', p.id)
    if (p.payment_request_id) {
      await admin.from('payments').delete().eq('request_id', p.payment_request_id)
      await admin.from('payment_requests').delete().eq('id', p.payment_request_id)
    }
  }
  await admin.from('payment_requests').delete().eq('academy_id', NRIFA).like('title', `${TAG}%`)
  await admin.from('programs').delete().eq('academy_id', NRIFA).like('name', `${TAG}%`)
}
await clean()

const thisYear = new Date().getFullYear()
const { data: program, error: pErr } = await admin
  .from('programs')
  .insert({
    academy_id: NRIFA,
    name: `${TAG} January Camp`,
    kind: 'camp',
    status: 'open',
    born_from_year: thisYear - 14,
    born_to_year: thisYear - 5,
    created_by: OWNER,
  })
  .select('id')
  .single()
if (pErr) {
  bad(pErr.message)
  process.exit(1)
}

const owed = async (who) => {
  const { data, error } = await who.client.rpc('my_payment_requests', { p_academy: NRIFA })
  if (error) throw new Error(error.message)
  return (data ?? []).filter((r) => r.title.startsWith(TAG))
}

head('1. A club sets the fee in one call')
{
  const { data: requestId, error } = await owner.client.rpc('set_program_fee', {
    p_program: program.id,
    p_amount_cents: 12000,
    p_title: `${TAG} January Camp`,
  })
  if (error) {
    bad(error.message)
  } else {
    ok('fee created')
    const { data: r } = await admin
      .from('payment_requests')
      .select('program_id, team_id, per_player, amount_cents')
      .eq('id', requestId)
      .single()
    r.program_id === program.id ? ok('scoped to the program') : bad(`program_id ${r.program_id}`)
    // Both would mean two answers to "who owes this", and the one that
    // applied would depend on which clause a reader wrote first.
    r.team_id === null ? ok('and not to a team as well') : bad(`team_id ${r.team_id}`)
    r.amount_cents === 12000 ? ok('$120.00 as integer cents') : bad(`amount ${r.amount_cents}`)

    const { data: prog } = await admin
      .from('programs')
      .select('payment_request_id, payment_required')
      .eq('id', program.id)
      .single()
    prog.payment_request_id === requestId && prog.payment_required
      ? ok('and the program points back at it')
      : bad(`program: ${JSON.stringify(prog)}`)
  }
}

head('2. Nobody owes it yet')
{
  // The whole point of scoping by program. A camp fee that landed on every
  // child in the academy would bill eighteen families who never registered.
  const sams = await owed(sam)
  sams.length === 0 ? ok('not Leo and Zoe') : bad(`Sam owes ${sams.length}`)

  const theirs = await owed(other)
  theirs.length === 0 ? ok('not Arjun') : bad(`the other family owes ${theirs.length}`)

  const { data: reg } = await owner.client.rpc('payment_register', {
    p_request: (
      await admin.from('programs').select('payment_request_id').eq('id', program.id).single()
    ).data.payment_request_id,
  })
  ;(reg ?? []).length === 0
    ? ok("and the club's chase list is empty")
    : bad(`${reg.length} on the chase list before anybody registered`)
}

head('3. A PENDING registration owes nothing')
{
  // Which is the charge-then-refund problem the design avoids: a family the
  // club has not accepted must not be billed.
  await admin.from('program_registrations').insert({
    academy_id: NRIFA,
    program_id: program.id,
    player_id: LEO,
    submitted_by: sam.id,
    status: 'pending',
  })

  const sams = await owed(sam)
  sams.length === 0
    ? ok('a family waiting to hear is not billed')
    : bad(`a pending registration was billed: ${JSON.stringify(sams)}`)
}

head('4. An approved registration owes it, and only for that child')
{
  await admin
    .from('program_registrations')
    .update({ status: 'approved', decided_by: OWNER, decided_at: new Date().toISOString() })
    .eq('program_id', program.id)
    .eq('player_id', LEO)

  const sams = await owed(sam)
  sams.length === 1 ? ok('one bill') : bad(`${sams.length} bills: ${JSON.stringify(sams.map((r) => r.player_name))}`)
  sams[0]?.player_id === LEO
    ? ok(`and it is for Leo, not for both children (${sams[0].player_name})`)
    : bad(`billed for ${sams[0]?.player_name}`)
  sams[0]?.amount_cents === 12000 ? ok('$120.00') : bad(`amount ${sams[0]?.amount_cents}`)
  sams[0]?.team_name?.startsWith(TAG)
    ? ok(`named after the program, not a blank squad ("${sams[0].team_name}")`)
    : bad(`team_name ${JSON.stringify(sams[0]?.team_name)}`)
  sams[0]?.status === 'unpaid' ? ok('and unpaid') : bad(`status ${sams[0]?.status}`)

  const theirs = await owed(other)
  theirs.length === 0 ? ok('the other family still owes nothing') : bad(`they owe ${theirs.length}`)
}

head('5. A second child registering is a second bill')
{
  await admin.from('program_registrations').insert({
    academy_id: NRIFA,
    program_id: program.id,
    player_id: ZOE,
    submitted_by: sam.id,
    status: 'approved',
    decided_by: OWNER,
    decided_at: new Date().toISOString(),
  })

  const sams = await owed(sam)
  sams.length === 2
    ? ok('two children, two bills — a family needs to see which is outstanding')
    : bad(`${sams.length} bills`)
  new Set(sams.map((r) => r.player_id)).size === 2
    ? ok('one row each, not one row twice')
    : bad('the same child billed twice')
}

head('6. The club can chase exactly the right people')
{
  const { data: prog } = await admin
    .from('programs')
    .select('payment_request_id')
    .eq('id', program.id)
    .single()
  const { data: reg, error } = await owner.client.rpc('payment_register', {
    p_request: prog.payment_request_id,
  })
  if (error) {
    bad(error.message)
  } else {
    reg.length === 2 ? ok('2 on the chase list') : bad(`${reg.length} on the chase list`)
    reg.every((r) => [LEO, ZOE].includes(r.player_id))
      ? ok('and they are the two who registered')
      : bad(`chasing ${reg.map((r) => r.player_name).join(', ')}`)
    reg.every((r) => r.guardian)
      ? ok('each with a guardian to ring, because a count cannot be chased')
      : bad('a row has no guardian')
  }
}

head('7. A team fee still behaves exactly as it did')
{
  // The most expensive mistake here would be changing how a club's existing
  // fees work, so this asserts the untouched path.
  const { data: teamFee } = await admin
    .from('payment_requests')
    .insert({
      academy_id: NRIFA,
      team_id: U8,
      title: `${TAG} U8 Season Fee`,
      amount_cents: 25000,
      currency: 'aud',
      per_player: true,
      created_by: OWNER,
    })
    .select('id')
    .single()

  const sams = await owed(sam)
  const team = sams.filter((r) => r.title.includes('Season Fee'))
  team.length === 2
    ? ok('a U8 team fee is owed for both U8 children, by team as before')
    : bad(`${team.length} team-fee rows`)

  // And the two kinds do not contaminate each other.
  const camp = sams.filter((r) => r.title.includes('Camp'))
  camp.length === 2 ? ok('and the camp fee is unchanged alongside it') : bad(`${camp.length} camp rows`)

  await admin.from('payment_requests').delete().eq('id', teamFee.id)
}

head('8. A fee cannot be scoped to a team AND a program')
{
  const { error } = await admin
    .from('payment_requests')
    .insert({
      academy_id: NRIFA,
      team_id: U8,
      program_id: program.id,
      title: `${TAG} Both`,
      amount_cents: 100,
      currency: 'aud',
      per_player: true,
      created_by: OWNER,
    })
  error
    ? ok('refused — two scopes is two answers to "who owes this"')
    : bad('a fee was scoped to both a team and a program')
}

head('9. Setting it twice corrects it rather than billing twice')
{
  const { error } = await owner.client.rpc('set_program_fee', {
    p_program: program.id,
    p_amount_cents: 9500,
  })
  if (error) {
    bad(error.message)
  } else {
    const sams = await owed(sam)
    sams.length === 2 ? ok('still two bills, not four') : bad(`${sams.length} bills`)
    sams.every((r) => r.amount_cents === 9500)
      ? ok('at the corrected price')
      : bad(`amounts ${sams.map((r) => r.amount_cents).join(', ')}`)
  }
}

head('10. Only a club admin sets a fee')
{
  const { error } = await sam.client.rpc('set_program_fee', {
    p_program: program.id,
    p_amount_cents: 1,
  })
  error ? ok(`a parent cannot (${error.code})`) : bad('a parent set a program fee')

  const { error: zero } = await owner.client.rpc('set_program_fee', {
    p_program: program.id,
    p_amount_cents: 0,
  })
  zero ? ok('and a fee of nothing is refused') : bad('a $0 fee was accepted')
}

await clean()
console.log(
  process.exitCode ? '\n\x1b[31msome of this is wrong\x1b[0m' : '\n\x1b[32mall good\x1b[0m'
)
