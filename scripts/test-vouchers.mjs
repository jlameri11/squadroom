// Run: node --env-file=.env.local scripts/test-vouchers.mjs
//
// B-07 / B-12 / B-04 (0193): a club's vouchers — a government one with a
// dollar value, a club one with a percentage — applied by a family to one
// child's fee, with uses and an expiry honoured and the net recorded; and
// the overdue chase, queued once per bucket to the family.
import { createClient } from '@supabase/supabase-js'
import { signInClient } from './_auth.mjs'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`)
  process.exitCode = 1
}
const head = (m) => console.log(`\n${m}`)

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const RAVENS = '00000000-0000-0000-0000-0000000a0002'
const OWNER = '00000000-0000-0000-0000-0000000000a1'
const PARENT = '00000000-0000-0000-0000-0000000000b1'
const RAVENS_OWNER = '00000000-0000-0000-0000-0000000000c1'
const U8 = '00000000-0000-0000-0000-0000000d0008'
const TAG = 'VOUCHERTEST'

const signInEmail = (email) => signInClient(admin, email)
const emailOf = async (id) => (await admin.auth.admin.getUserById(id)).data.user.email
const days = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10)

async function cleanup() {
  const { data: reqs } = await admin.from('payment_requests').select('id').like('title', `${TAG} %`)
  for (const r of reqs ?? []) {
    await admin.from('notification_queue').delete().filter('payload->>request_id', 'eq', r.id)
    await admin.from('payment_requests').delete().eq('id', r.id)
  }
  await admin.from('vouchers').delete().like('label', `${TAG} %`)
}
await cleanup()

const owner = await signInEmail(await emailOf(OWNER))
const parent = await signInEmail(await emailOf(PARENT))
const ravens = await signInEmail(await emailOf(RAVENS_OWNER))
if (!owner || !parent || !ravens) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  await cleanup()
  process.exit(2)
}
// The parent's U8 children; a fee of $150 per player on the U8s.
const { data: kids } = await admin.from('players').select('id, full_name').eq('team_id', U8).in('id', (await admin.from('player_guardians').select('player_id').eq('profile_id', PARENT)).data.map((g) => g.player_id))
const [kidA, kidB] = kids
const { data: fee } = await admin.from('payment_requests').insert({ academy_id: NRIFA, team_id: U8, title: `${TAG} Term fee`, amount_cents: 15000, currency: 'aud', per_player: true, due_on: days(14), created_by: OWNER, instalments: 1, instalment_every_days: 30 }).select('id').single()

head('1. The club makes vouchers; a parent cannot')
{
  const { error: pe } = await parent.from('vouchers').insert({ academy_id: NRIFA, code: 'SNEAKY', label: `${TAG} sneaky`, kind: 'club', amount_cents: 100 })
  pe ? ok('a parent cannot make a voucher') : bad('a parent made a voucher')
  const { error: g } = await owner.from('vouchers').insert({ academy_id: NRIFA, code: 'ACTIVEKIDS', label: `${TAG} Active Kids 2027`, kind: 'government', amount_cents: 10000, max_uses: 2, expires_on: days(60) })
  g ? bad(`government voucher: ${g.message}`) : ok('a $100 Active Kids voucher, two uses, two months')
  const { error: c } = await owner.from('vouchers').insert({ academy_id: NRIFA, code: 'COACH10', label: `${TAG} Coach family 10%`, kind: 'coach', percent_bps: 1000 })
  c ? bad(`club voucher: ${c.message}`) : ok('a 10% coach-family voucher')
  const { error: old } = await owner.from('vouchers').insert({ academy_id: NRIFA, code: 'LASTYEAR', label: `${TAG} old`, kind: 'club', amount_cents: 5000, expires_on: days(-1) })
  old ? bad(`expired voucher: ${old.message}`) : ok('and one that expired yesterday')
  const { error: both } = await owner.from('vouchers').insert({ academy_id: NRIFA, code: 'BOTH', label: `${TAG} both`, kind: 'club', amount_cents: 100, percent_bps: 100 })
  both ? ok('a voucher is dollars or a percentage, not both') : bad('a voucher with both values was saved')
  const { data: theirs } = await ravens.from('vouchers').select('id').eq('academy_id', NRIFA)
  const ravensSees = theirs ?? []
  ravensSees.length === 0 ? ok('another club\'s owner sees none of ours') : bad('Ravens read NRIFA\'s vouchers')
  const { data: mine } = await parent.from('vouchers').select('id')
  const parentSees = mine ?? []
  parentSees.length === 0 ? ok('a parent lists no vouchers') : bad('a parent listed vouchers')
}

head('2. A family applies a code to one child\'s fee')
{
  const { data: q0 } = await parent.rpc('quote_payment', { p_request: fee.id, p_player: kidA.id })
  const before = q0?.net_cents
  const { error: wrong } = await parent.rpc('redeem_voucher', { p_code: 'NOTACODE', p_request: fee.id, p_player: kidA.id })
  wrong && /not one of this club/.test(wrong.message) ? ok('a made-up code is refused') : bad(wrong ? wrong.message : 'a made-up code worked')
  const { error: expired } = await parent.rpc('redeem_voucher', { p_code: 'lastyear', p_request: fee.id, p_player: kidA.id })
  expired && /expired on/.test(expired.message) ? ok(`the expired one is refused: "${expired.message}"`) : bad(expired ? expired.message : 'an expired code worked')
  const { error: pe } = await ravens.rpc('redeem_voucher', { p_code: 'ACTIVEKIDS', p_request: fee.id, p_player: kidA.id })
  pe?.code === '42501' ? ok('somebody else\'s family cannot use it on this child') : bad(pe ? pe.message : 'a stranger redeemed on another family\'s child')
  const { data: r, error } = await parent.rpc('redeem_voucher', { p_code: 'activekids', p_request: fee.id, p_player: kidA.id })
  error ? bad(`redeem: ${error.message}`) : r?.off_cents === 10000 ? ok(`$100 off ${kidA.full_name}'s fee (typed in lower case)`) : bad(JSON.stringify(r))
  const { data: q1 } = await parent.rpc('quote_payment', { p_request: fee.id, p_player: kidA.id })
  q1?.voucher_cents === 10000 && q1.net_cents === before - 10000 && q1.outstanding_cents === before - 10000 && q1.voucher?.code === 'ACTIVEKIDS' ? ok(`the quote is $${(q1.net_cents / 100).toFixed(2)} with the voucher named`) : bad(JSON.stringify({ before, q1 }))
  const { error: twice } = await parent.rpc('redeem_voucher', { p_code: 'COACH10', p_request: fee.id, p_player: kidA.id })
  twice?.code === '23505' ? ok('a second voucher on the same fee is refused') : bad(twice ? twice.message : 'two vouchers stacked')
  const { data: r2 } = await parent.rpc('redeem_voucher', { p_code: 'COACH10', p_request: fee.id, p_player: kidB.id })
  r2 && r2.off_cents > 0 ? ok(`10% off ${kidB.full_name}'s fee: $${(r2.off_cents / 100).toFixed(2)} (after the sibling discount)`) : bad(JSON.stringify(r2))
  const { data: list } = await parent.rpc('my_payment_requests', { p_academy: NRIFA })
  const rowA = list?.find((x) => x.request_id === fee.id && x.player_id === kidA.id)
  rowA?.voucher_cents === 10000 && /Active Kids/.test(rowA.voucher_label ?? '') ? ok('the family\'s list shows the voucher on the fee') : bad(JSON.stringify(rowA))
  const { data: owed } = await owner.rpc('outstanding_fees', { p_academy: NRIFA })
  const oA = owed?.find((x) => x.request_id === fee.id && x.player_id === kidA.id)
  oA?.outstanding_cents === before - 10000 ? ok('who-owes shows the net after the voucher') : bad(JSON.stringify(oA))
  const { data: ny } = await parent.rpc('needs_you', { p_academy: NRIFA })
  const feesItem = (ny ?? []).find((i) => i.kind === 'fees')
  feesItem ? ok(`Needs you: "${feesItem.title} — ${feesItem.detail}"`) : ok('(no fees item — the seed\'s other fees are parked)')
  const { data: v } = await admin.from('vouchers').select('used_count').eq('code', 'ACTIVEKIDS').eq('academy_id', NRIFA).single()
  v?.used_count === 1 ? ok('one use counted') : bad(JSON.stringify(v))
  await admin.from('vouchers').update({ used_count: 2 }).eq('code', 'ACTIVEKIDS').eq('academy_id', NRIFA)
  await admin.from('voucher_redemptions').delete().eq('request_id', fee.id).eq('player_id', kidB.id)
  const { error: spent } = await parent.rpc('redeem_voucher', { p_code: 'ACTIVEKIDS', p_request: fee.id, p_player: kidB.id })
  spent && /as many times/.test(spent.message) ? ok('a used-up code is refused') : bad(spent ? spent.message : 'a spent code worked')
}

head('3. B-04: the overdue chase, once per bucket')
{
  await admin.from('notification_queue').delete().filter('payload->>request_id', 'eq', fee.id)
  await admin.from('payment_requests').update({ due_on: days(3) }).eq('id', fee.id)
  const { data: n1 } = await admin.rpc('queue_fee_reminders')
  const { data: q1 } = await admin.from('notification_queue').select('kind, title, body, profile_id').filter('payload->>request_id', 'eq', fee.id)
  q1?.some((x) => x.kind === 'fee_due' && x.profile_id === PARENT) ? ok(`three days before it is due: "${q1[0].title}"`) : bad(JSON.stringify({ n1, q1 }))
  const { data: n2 } = await admin.rpc('queue_fee_reminders')
  n2 === 0 || (await admin.from('notification_queue').select('id', { count: 'exact', head: true }).filter('payload->>request_id', 'eq', fee.id)).count === q1.length ? ok('running it again sends nothing new') : bad(`sent ${n2} more`)
  await admin.from('payment_requests').update({ due_on: days(-7) }).eq('id', fee.id)
  await admin.rpc('queue_fee_reminders')
  const { data: q2 } = await admin.from('notification_queue').select('kind, title, body').filter('payload->>request_id', 'eq', fee.id).eq('kind', 'fee_overdue')
  q2?.length >= 1 && /7 days overdue/.test(q2[0].title) && /to pay/.test(q2[0].body) ? ok(`seven days overdue: "${q2[0].title}" — ${q2[0].body.slice(0, 60)}…`) : bad(JSON.stringify(q2))
  await admin.from('payment_requests').update({ due_on: days(-5) }).eq('id', fee.id)
  const { data: n3 } = await admin.rpc('queue_fee_reminders')
  n3 === 0 ? ok('five days overdue is between buckets — nothing sent') : bad(`sent ${n3} at five days`)
  await admin.from('academies').update({ fee_reminders: false }).eq('id', NRIFA)
  await admin.from('payment_requests').update({ due_on: days(-14) }).eq('id', fee.id)
  const { data: n4 } = await admin.rpc('queue_fee_reminders')
  n4 === 0 ? ok('a club that turned the chase off sends nothing') : bad(`sent ${n4} with reminders off`)
  await admin.from('academies').update({ fee_reminders: true }).eq('id', NRIFA)
  const { error: pe } = await parent.rpc('queue_fee_reminders')
  pe ? ok('a parent cannot run the chase') : bad('a parent ran the chase')
}

await cleanup()
console.log(process.exitCode ? '\n\x1b[31mVOUCHERS OR THE CHASE ARE WRONG\x1b[0m\n' : '\n\x1b[32mall good\x1b[0m\n')
