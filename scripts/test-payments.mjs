import { createClient } from '@supabase/supabase-js'
const URL=process.env.NEXT_PUBLIC_SUPABASE_URL, PUB=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const admin=createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}})
const anon =createClient(URL, PUB,{auth:{persistSession:false}})
const ok=m=>console.log(`  \x1b[32m✓\x1b[0m ${m}`), bad=m=>{console.log(`  \x1b[31m✗\x1b[0m ${m}`);process.exitCode=1}
const head=m=>console.log(`\n${m}`)
const NRIFA='00000000-0000-0000-0000-0000000a0001'
const U8='00000000-0000-0000-0000-0000000d0008'

async function sess(email){
  const { data:l } = await admin.auth.admin.generateLink({type:'magiclink', email})
  const { data:s } = await anon.auth.verifyOtp({token_hash:l.properties.hashed_token, type:'email'})
  return { client: createClient(URL, PUB, {auth:{persistSession:false},
    global:{headers:{Authorization:`Bearer ${s.session.access_token}`}}}), id: s.user.id }
}

const coach  = await sess('joeylameri@outlook.com')            // owner
const sam    = await sess('p61400000011@squadroom.invalid')    // Leo + Zoe in U8
const other  = await sess('p61400000012@squadroom.invalid')

// Only what this test creates. It used to delete every payment request and
// billing row for the academy, which quietly destroyed the demo data every
// time the suite ran — and nobody noticed until a walkthrough showed an empty
// payments screen.
await admin.from('payment_requests').delete().eq('academy_id', NRIFA).like('title','TESTPAY%')

head('1. A parent cannot see the billing configuration')
await admin.from('academy_billing').insert({
  academy_id: NRIFA, stripe_account_id: 'acct_test_squadroom', charges_enabled: true,
})
const { data: parentBilling } = await sam.client.from('academy_billing').select('stripe_account_id')
parentBilling?.length === 0 ? ok('bank setup is invisible to parents')
                            : bad(`a parent read ${JSON.stringify(parentBilling)}`)
const { data: staffBilling } = await coach.client.from('academy_billing').select('stripe_account_id')
staffBilling?.length === 1 ? ok('the owner can see it') : bad('the owner cannot read their own billing')

head('2. Only staff can ask for money')
const { error: parentAsk } = await sam.client.from('payment_requests').insert({
  academy_id: NRIFA, title: 'Pay me instead', amount_cents: 5000,
})
parentAsk ? ok('a parent cannot create a payment request')
          : bad('a parent invoiced the whole academy')

const { data: req, error: coachAsk } = await coach.client.from('payment_requests').insert({
  academy_id: NRIFA, team_id: U8, title: 'TESTPAY Gala Day entry', amount_cents: 4500,
  due_on: new Date(Date.now()+14*864e5).toISOString().slice(0,10), created_by: coach.id,
}).select('id').single()
coachAsk ? bad(coachAsk.message) : ok(`the coach asked for $45.00`)

head('3. A parent sees a line per child, not one per family')
const { data: all, error: oe } = await sam.client.rpc('my_payment_requests', { p_academy: NRIFA })
// Scoped to this test's request. The demo data has its own fee sitting
// alongside, and a parent with two children correctly sees a line per child
// per request — the old assertion only held while nothing else existed.
const owing = (all ?? []).filter(o => o.request_id === req.id)
oe ? bad(oe.message) : owing.length === 2
  ? ok(`${owing.length} rows: ${owing.map(o=>o.player_name.split(' ')[0]).join(' and ')} — chased separately`)
  : bad(`expected 2 children, got ${owing.length}`)
owing?.[0]?.status === 'unpaid' ? ok('both unpaid') : bad('wrong initial status')
owing?.[0]?.can_pay === true ? ok('and the Pay button is live, because Stripe is ready') : bad('can_pay false')

head('4. A parent in another team is not billed for this one')
const { data: otherOwing } = await other.client.rpc('my_payment_requests', { p_academy: NRIFA })
const strays = (otherOwing ?? []).filter(o => o.request_id === req.id && o.player_name)
strays.length === 0 || otherOwing.every(o => o.player_id)
  ? ok('only families with a child in that team are asked')
  : bad('someone was billed for a team their child is not in')

head('5. Nobody can mark themselves paid — the whole point')
const { error: selfPay } = await sam.client.from('payments').insert({
  academy_id: NRIFA, request_id: req.id, profile_id: sam.id,
  player_id: owing[0].player_id, amount_cents: 4500, status: 'paid',
})
selfPay ? ok(`a parent cannot write a payment: ${selfPay.message.slice(0,60)}`)
        : bad('A PARENT MARKED THEMSELVES PAID')
const { error: coachPay } = await coach.client.from('payments').insert({
  academy_id: NRIFA, request_id: req.id, profile_id: coach.id, amount_cents: 4500, status: 'paid',
})
coachPay ? ok('nor can the owner — only Stripe, through the webhook')
         : bad('the owner wrote a payment row by hand')

head('6. Once Stripe says so, everyone sees the same thing')
await admin.from('payments').insert({
  academy_id: NRIFA, request_id: req.id, profile_id: sam.id, player_id: owing[0].player_id,
  amount_cents: 4500, status: 'paid', paid_at: new Date().toISOString(),
  stripe_session_id: 'cs_test_' + Date.now(),
})
const { data: afterAll } = await sam.client.rpc('my_payment_requests', { p_academy: NRIFA })
const after = (afterAll ?? []).filter(o => o.request_id === req.id)
const settled = after.filter(o => o.status === 'paid')
settled.length === 1 ? ok(`${settled[0].player_name.split(' ')[0]} shows paid, the other still owes`)
                     : bad(`expected 1 paid, got ${settled.length}`)

head('7. A parent cannot un-pay, or change the amount')
const { data: mine } = await admin.from('payments').select('id').eq('request_id', req.id).single()
const { error: undo } = await sam.client.from('payments')
  .update({ status: 'refunded' }).eq('id', mine.id)
const { data: stillPaid } = await admin.from('payments').select('status').eq('id', mine.id).single()
stillPaid.status === 'paid' ? ok('the row did not move') : bad(`a parent changed it to ${stillPaid.status}`)
const { error: reprice } = await sam.client.from('payment_requests')
  .update({ amount_cents: 100 }).eq('id', req.id)
const { data: stillPrice } = await admin.from('payment_requests').select('amount_cents').eq('id', req.id).single()
stillPrice.amount_cents === 4500 ? ok('and the price is still $45.00')
                                 : bad(`a parent repriced it to ${stillPrice.amount_cents}`)

head('8. The coach gets a register with names, not a count')
const { data: register, error: re } = await coach.client.rpc('payment_register', { p_request: req.id })
re ? bad(re.message) : register.length > 0
  ? ok(`${register.length} players, unpaid first: ${register[0].player_name} (${register[0].status})`)
  : bad('empty register')
register?.some(r => r.guardian_phone)
  ? ok('with a parent number beside each, so chasing does not need another screen')
  : bad('no contact details to chase with')

head('9. A parent cannot open the register')
const { error: peek } = await sam.client.rpc('payment_register', { p_request: req.id })
peek ? ok(`refused: ${peek.message}`) : bad('a parent read who else has not paid')

await admin.from('payment_requests').delete().eq('academy_id', NRIFA).like('title','TESTPAY%')
await admin.from('academy_billing').delete().eq('academy_id', NRIFA)
console.log('\ncleaned up\n')
