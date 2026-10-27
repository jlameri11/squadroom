import { createClient } from '@supabase/supabase-js'
const URL=process.env.NEXT_PUBLIC_SUPABASE_URL, PUB=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const admin=createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}})
const anon =createClient(URL, PUB,{auth:{persistSession:false}})
const ok=m=>console.log(`  \x1b[32m✓\x1b[0m ${m}`), bad=m=>{console.log(`  \x1b[31m✗\x1b[0m ${m}`);process.exitCode=1}
const head=m=>console.log(`\n${m}`)
const NRIFA='00000000-0000-0000-0000-0000000a0001'
async function sess(email){
  const { data:l } = await admin.auth.admin.generateLink({type:'magiclink', email})
  // generateLink is rate limited per project as well as verifyOtp, and
  // returns null when it trips — so this property read throws before any
  // session check runs, and the runner reports a crash that is really the
  // auth budget.
  if (!l?.properties?.hashed_token) {
    console.log("  could not issue a magic link — the project's auth rate limit, not a failure")
    process.exit(2)
  }
  const { data:s } = await anon.auth.verifyOtp({token_hash:l.properties.hashed_token, type:'email'})
  return { client: createClient(URL, PUB, {auth:{persistSession:false},
    global:{headers:{Authorization:`Bearer ${s.session.access_token}`}}}), id: s.user.id }
}
const coach  = await sess('joeylameri@outlook.com')
const sam    = await sess('p61400000011@squadroom.invalid')
const priya  = await sess('p61400000012@squadroom.invalid')
const ravens = await sess('p61400000092@squadroom.invalid')

await coach.client.from('academies').update({ directory_visibility: 'staff_only' }).eq('id', NRIFA)

head('1. Staff are always contactable')
const { data: c1 } = await sam.client.rpc('member_contact', { p_academy: NRIFA, p_profile: coach.id })
c1?.[0]?.phone ? ok(`parent can call their coach (${c1[0].phone})`) : bad('coach number withheld')
c1?.[0]?.can_dm ? ok('and message them in-app') : bad('DM button would be dead')

head('2. Another family is not, while the setting is staff_only')
const { data: c2 } = await sam.client.rpc('member_contact', { p_academy: NRIFA, p_profile: priya.id })
c2?.[0] && !c2[0].phone ? ok('number withheld, name and teams still shown') : bad(`leaked: ${c2?.[0]?.phone}`)
c2?.[0]?.can_dm === false ? ok('and the DM button is correctly hidden') : bad('offered a DM the API would refuse')

head('3. Opening the directory changes both')
await coach.client.from('academies').update({ directory_visibility: 'all' }).eq('id', NRIFA)
const { data: c3 } = await sam.client.rpc('member_contact', { p_academy: NRIFA, p_profile: priya.id })
c3?.[0]?.phone ? ok(`now visible (${c3[0].phone})`) : bad('still withheld after opening')
await coach.client.from('academies').update({ directory_visibility: 'staff_only' }).eq('id', NRIFA)

head('4. Never across academies')
const { error: e4 } = await ravens.client.rpc('member_contact', { p_academy: NRIFA, p_profile: coach.id })
e4 ? ok('refused — not a member of this academy') : bad('another academy read a contact card')

head('5. You can read and change your own number')
const { data: mine } = await sam.client.rpc('my_profile')
mine?.[0]?.phone ? ok(`own number readable (${mine[0].phone})`) : bad('cannot read own number')

const { error: e5 } = await sam.client.rpc('set_my_profile', { p_full_name: 'Sam Whitfield', p_phone: '0400 555 777' })
e5 ? bad(e5.message) : ok('own number updated')
const { data: after } = await sam.client.rpc('my_profile')
after?.[0]?.phone === '+61400555777' ? ok('normalised to E.164') : bad(`stored as ${after?.[0]?.phone}`)

head('6. Two accounts cannot share a number')
const { error: e6 } = await priya.client.rpc('set_my_profile', { p_full_name: 'Priya Nair', p_phone: '+61400555777' })
e6 ? ok('refused — otherwise "who sent this" has no answer') : bad('two accounts on one number')

head('7. And still nobody can read the column directly')
const { error: e7 } = await sam.client.from('profiles').select('phone').eq('id', priya.id)
e7 ? ok('profiles.phone remains unreachable') : bad('column grant has regressed')

// Restore both, not just the one the happy path touches: a failure part way
// through used to leave the other account holding a test number.
await admin.from('profiles').update({ phone: '+61400000011' }).eq('id', sam.id)
await admin.from('profiles').update({ phone: '+61400000012' }).eq('id', priya.id)
await admin.from('academies').update({ directory_visibility: 'staff_only' }).eq('id', NRIFA)
console.log(process.exitCode ? '\n\x1b[31mBROKEN\x1b[0m\n' : '\n\x1b[32mCONTACT RULES HOLD\x1b[0m\n')
process.exit(process.exitCode ?? 0)
