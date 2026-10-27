import { createClient } from '@supabase/supabase-js'
const URL=process.env.NEXT_PUBLIC_SUPABASE_URL, PUB=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const admin=createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}})
const anon =createClient(URL, PUB,{auth:{persistSession:false}})
const ok=m=>console.log(`  \x1b[32m✓\x1b[0m ${m}`), bad=m=>{console.log(`  \x1b[31m✗\x1b[0m ${m}`);process.exitCode=1}
const head=m=>console.log(`\n${m}`)

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
const parent = await sess('demo0412000103@squadroom.invalid')   // Priya, in U8

head('1. A coach finds their own message')
const { data: r1, error: e1 } = await coach.client.rpc('search_chat', { p_query: 'shin pads' })
e1 ? bad(e1.message) : r1.messages.length > 0
  ? ok(`"${r1.messages[0].body.slice(0,54)}…" in ${r1.messages[0].channel_name}`)
  : bad('found nothing')

head('2. It searches people too')
const { data: r2 } = await coach.client.rpc('search_chat', { p_query: 'Priya' })
r2.people.length > 0 ? ok(`${r2.people[0].full_name} — ${r2.people[0].role}`) : bad('no people found')

head('3. A parent sees only channels they are in')
const { data: r3 } = await parent.client.rpc('search_chat', { p_query: 'shin pads' })
// The seed has several academies; scope to NRIFA's coaches channel.
const { data: coachOnly } = await admin.from('channels').select('id, name')
  .eq('type','coaches').eq('academy_id','00000000-0000-0000-0000-0000000a0001').limit(1).single()
// Post something only coaches can see, then check a parent cannot find it.
const { data: secret } = await admin.from('messages').insert({
  academy_id:'00000000-0000-0000-0000-0000000a0001', channel_id: coachOnly.id,
  sender_id: coach.id, body: 'SEARCHTEST coaches only, selection for the weekend',
}).select('id').single()
const { data: r4 } = await parent.client.rpc('search_chat', { p_query: 'SEARCHTEST' })
r4.messages.length === 0
  ? ok('a parent cannot find a message in the coaches channel')
  : bad(`A PARENT FOUND: ${r4.messages[0].body}`)
const { data: r5 } = await coach.client.rpc('search_chat', { p_query: 'SEARCHTEST' })
r5.messages.length === 1 ? ok('the coach can') : bad('the coach cannot find their own message')

head('4. Deleted messages stay deleted')
await admin.from('messages').update({ deleted_at: new Date().toISOString() }).eq('id', secret.id)
const { data: r6 } = await coach.client.rpc('search_chat', { p_query: 'SEARCHTEST' })
r6.messages.length === 0 ? ok('a removed message is not searchable') : bad('found a deleted message')

head('5. A one-letter query returns nothing rather than everything')
const { data: r7 } = await coach.client.rpc('search_chat', { p_query: 'a' })
r7.messages.length === 0 && r7.people.length === 0
  ? ok('under two characters is ignored')
  : bad(`returned ${r7.messages.length} messages for "a"`)

head('6. It is quick enough to type into')
const t = Date.now()
for (const q of ['kit','ground','water','9:00']) await coach.client.rpc('search_chat', { p_query: q })
const per = Math.round((Date.now()-t)/4)
per < 400 ? ok(`${per}ms per search`) : bad(`${per}ms per search — too slow to type into`)

await admin.from('messages').delete().eq('id', secret.id)
console.log('\ncleaned up\n')
