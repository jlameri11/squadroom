// Run: node --env-file=.env.local scripts/test-withdrawals.mjs
//   (the HTTP checks need the app running — npm run dev, or serve:test)
//
// R-15: a family withdraws a child; the refund is worked out from what was
// paid and the program's cut-off, recorded, and issued by the club.
import { createClient } from '@supabase/supabase-js'
import { resolveBaseUrl } from './_base-url.mjs'

const BASE = await resolveBaseUrl()
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`)
  process.exitCode = 1
}
const head = (m) => console.log(`\n${m}`)

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const OWNER = '00000000-0000-0000-0000-0000000000a1'
const PARENT = '00000000-0000-0000-0000-0000000000b1'
const OUTSIDER = '00000000-0000-0000-0000-0000000000c2'
const TAG = 'WDTEST'
const ref = URL_.split('//')[1].split('.')[0]

async function session(profileId) {
  const { data: u } = await admin.auth.admin.getUserById(profileId)
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email: u.user.email })
  if (!link?.properties?.hashed_token) return null
  const client = createClient(URL_, PUB, { auth: { persistSession: false } })
  const { data } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
  if (!data?.session) return null
  return { client, cookie: `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(data.session)).toString('base64')}` }
}
const owner = await session(OWNER)
const parent = await session(PARENT)
const outsider = await session(OUTSIDER)
if (!owner || !parent || !outsider) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}

async function cleanup() {
  const { data: kids } = await admin.from('players').select('id').eq('academy_id', NRIFA).like('full_name', `% ${TAG}`)
  for (const k of kids ?? []) {
    await admin.from('refunds').delete().eq('player_id', k.id)
    await admin.from('payments').delete().eq('player_id', k.id)
    await admin.from('program_registrations').delete().eq('player_id', k.id)
    await admin.from('player_guardians').delete().eq('player_id', k.id)
  }
  await admin.from('players').delete().eq('academy_id', NRIFA).like('full_name', `% ${TAG}`)
  const { data: progs } = await admin.from('programs').select('id').eq('academy_id', NRIFA).like('name', `${TAG} %`)
  for (const p of progs ?? []) {
    await admin.from('payment_requests').delete().eq('program_id', p.id)
    await admin.from('programs').delete().eq('id', p.id)
  }
}
await cleanup()

// A $300 program, three children of one family, each with the fee paid.
const { data: program } = await admin.from('programs').insert({ academy_id: NRIFA, name: `${TAG} Term`, kind: 'term_class', status: 'open', created_by: OWNER }).select('id').single()
const { data: fee } = await admin.from('payment_requests').insert({ academy_id: NRIFA, title: `${TAG} fee`, amount_cents: 30000, program_id: program.id, created_by: OWNER }).select('id').single()
await admin.from('programs').update({ payment_request_id: fee.id }).eq('id', program.id)
const { data: kids } = await admin
  .from('players')
  .insert(['Ava', 'Ben', 'Cal'].map((n, i) => ({ academy_id: NRIFA, full_name: `${n} ${TAG}`, dob: `2017-0${i + 1}-01` })))
  .select('id, full_name')
for (const k of kids) await admin.from('player_guardians').insert({ academy_id: NRIFA, player_id: k.id, profile_id: PARENT, relationship: 'parent' })
const { data: regs } = await admin
  .from('program_registrations')
  .insert(kids.map((k) => ({ academy_id: NRIFA, program_id: program.id, player_id: k.id, submitted_by: PARENT, status: 'approved' })))
  .select('id, player_id')
const regOf = (k) => regs.find((r) => r.player_id === k.id).id
for (const [i, k] of kids.slice(0, 2).entries()) {
  await admin.from('payments').insert({
    academy_id: NRIFA, request_id: fee.id, player_id: k.id, profile_id: PARENT,
    stripe_session_id: `cs_${TAG}_${i}`, stripe_payment_intent: `pi_${TAG}_${i}`, amount_cents: 30000,
    currency: 'aud', status: 'paid', paid_at: new Date().toISOString(), instalment_seq: 1,
  })
}
const [ava, ben, cal] = kids

head('1. Before the cut-off: a full refund, recorded')
{
  await owner.client.from('programs').update({ withdraw_until: '2099-01-01', refund_bps_after: 0 }).eq('id', program.id)
  const { error: notMine } = await outsider.client.rpc('withdraw_registration', { p_registration: regOf(ava), p_reason: 'x' })
  notMine?.code === '42501' ? ok("an outsider cannot withdraw another family's child") : bad(notMine ? notMine.message : 'an outsider withdrew')
  const { data: r, error } = await parent.client.rpc('withdraw_registration', { p_registration: regOf(ava), p_reason: 'Moving house' })
  error ? bad(`withdraw: ${error.message}`) : ok(`Ava withdrawn: ${r.policy}, $${(r.refund_cents / 100).toFixed(2)} back`)
  r?.policy === 'full' && r?.refund_cents === 30000 && r?.refunds === 1 ? ok('full refund of the $300 paid') : bad(JSON.stringify(r))
  const { data: reg } = await admin.from('program_registrations').select('status, decision_note').eq('id', regOf(ava)).single()
  reg?.status === 'withdrawn' && reg?.decision_note === 'Moving house' ? ok('the registration is withdrawn, with the reason') : bad(JSON.stringify(reg))
  const { data: refund } = await admin.from('refunds').select('status, amount_cents').eq('player_id', ava.id).maybeSingle()
  refund?.status === 'requested' && refund?.amount_cents === 30000 ? ok('a refund is requested, not yet issued') : bad(JSON.stringify(refund))
  const { error: again } = await parent.client.rpc('withdraw_registration', { p_registration: regOf(ava) })
  again ? ok('withdrawing twice is refused') : bad('withdrew twice')
}

head('2. After the cut-off: the share the club set')
{
  await owner.client.from('programs').update({ withdraw_until: '2020-01-01', refund_bps_after: 2500 }).eq('id', program.id)
  const { data: r } = await parent.client.rpc('withdraw_registration', { p_registration: regOf(ben) })
  r?.policy === 'partial' && r?.refund_cents === 7500 ? ok('25% after the cut-off: $75 of $300') : bad(JSON.stringify(r))
  const { error: badShare } = await owner.client.from('programs').update({ refund_bps_after: 12000 }).eq('id', program.id)
  badShare ? ok('a share over 100% is refused') : bad('120% was accepted')
}

head('3. Nothing paid, nothing to refund — and the club can withdraw too')
{
  const { data: r, error } = await owner.client.rpc('withdraw_registration', { p_registration: regOf(cal), p_reason: 'Family asked by phone' })
  error ? bad(error.message) : ok('the club withdrew Cal')
  r?.refund_cents === 0 && r?.refunds === 0 ? ok('no payment, no refund row') : bad(JSON.stringify(r))
}

head('4. The treasurer sees them; issuing without Stripe is said plainly')
{
  const { data: list, error } = await owner.client.rpc('refunds_to_issue', { p_academy: NRIFA })
  const mine = (list ?? []).filter((x) => /WDTEST/.test(x.player))
  error ? bad(error.message) : mine.length === 2 ? ok('two refunds listed, with payment ids') : bad(`${mine.length} listed`)
  mine.every((x) => x.status === 'requested' && x.payment_intent?.startsWith('pi_WDTEST')) ? ok('both requested, both carry the Stripe id') : bad(JSON.stringify(mine))
  const { error: peek } = await parent.client.rpc('refunds_to_issue', { p_academy: NRIFA })
  peek?.code === '42501' ? ok('a parent cannot list them') : bad('a parent listed refunds')
  const { data: seen } = await parent.client.from('refunds').select('id, amount_cents').eq('player_id', ava.id)
  seen?.length === 1 ? ok("but can see their own child's") : bad(`parent sees ${seen?.length}`)

  try {
    const res = await fetch(`${BASE}/api/payments/refund`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: owner.cookie }, body: JSON.stringify({ refundId: mine[0].id }) })
    const body = await res.json().catch(() => ({}))
    res.status === 503 && /Stripe isn't set up/.test(body.error ?? '')
      ? ok(`no key: 503 "${body.error.slice(0, 44)}…"`)
      : res.status === 200
        ? ok('a key is configured and the refund was issued')
        : bad(`issue → ${res.status} ${JSON.stringify(body)}`)
    const { data: still } = await admin.from('refunds').select('status').eq('id', mine[0].id).single()
    res.status === 503 && still?.status === 'requested' ? ok('and the refund stays requested, not lost') : res.status === 200 ? ok('issued') : bad(`status ${still?.status}`)
    const asParent = await fetch(`${BASE}/api/payments/refund`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: parent.cookie }, body: JSON.stringify({ refundId: mine[0].id }) })
    asParent.status === 403 ? ok('a parent cannot issue their own refund') : bad(`parent → ${asParent.status}`)
  } catch (e) {
    bad(`no app at ${BASE}: ${e.message.slice(0, 60)}`)
  }
}

await cleanup()
console.log(process.exitCode ? '\n\x1b[31mWITHDRAWALS ARE WRONG\x1b[0m\n' : '\n\x1b[32mall good\x1b[0m\n')
