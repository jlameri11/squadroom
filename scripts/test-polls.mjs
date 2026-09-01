import { createClient } from '@supabase/supabase-js'
const URL=process.env.NEXT_PUBLIC_SUPABASE_URL, PUB=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const admin=createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}})
const anon =createClient(URL, PUB,{auth:{persistSession:false}})
const ok=m=>console.log(`  \x1b[32m✓\x1b[0m ${m}`), bad=m=>{console.log(`  \x1b[31m✗\x1b[0m ${m}`);process.exitCode=1}
const head=m=>console.log(`\n${m}`)
const NRIFA='00000000-0000-0000-0000-0000000a0001'
async function sess(email){
  const { data:l } = await admin.auth.admin.generateLink({type:'magiclink', email})
  const { data:s } = await anon.auth.verifyOtp({token_hash:l.properties.hashed_token, type:'email'})
  return { client: createClient(URL, PUB, {auth:{persistSession:false},
    global:{headers:{Authorization:`Bearer ${s.session.access_token}`}}}), id: s.user.id }
}
const coach = await sess('joeylameri@outlook.com')
const sam   = await sess('p61400000011@squadroom.invalid')  // Leo + Zoe
const priya = await sess('p61400000012@squadroom.invalid')  // Arjun

const { data: u8 } = await admin.from('channels').select('id')
  .eq('team_id','00000000-0000-0000-0000-0000000d0008').eq('type','team').single()
await admin.from('polls').delete().like('question','TEST::%')
await admin.from('events').delete().like('title','TEST::%')

head('1. A host posts an availability poll as a card')
const { data: poll, error: pe } = await coach.client.from('polls').insert({
  academy_id: NRIFA, channel_id: u8.id, type: 'availability',
  question: 'TEST::Gala Day — Sun 20 Sep. Who is available?',
  closes_at: new Date(Date.now()+3*864e5).toISOString(), created_by: coach.id,
}).select('id').single()
pe ? bad(pe.message) : ok('poll created')

const { data: msg, error: me } = await coach.client.from('messages')
  .insert({ academy_id: NRIFA, channel_id: u8.id, sender_id: coach.id, poll_id: poll.id })
  .select('id').single()
me ? bad(`poll-only message: ${me.message}`) : ok('posted with no body text')

head('2. A parent is asked once per child')
const { data: mine, error: mve } = await sam.client.rpc('my_poll_votes', { p_poll: poll.id })
mve ? bad(mve.message)
  : mine.length === 2 ? ok(`${mine.length} rows: ${mine.map(m=>m.player_name.split(' ')[0]).join(' and ')}`)
  : bad(`expected 2 children, got ${mine.length}`)

head('3. Answering per child, with a note')
const leo = mine.find(m=>m.player_name.startsWith('Leo'))
const zoe = mine.find(m=>m.player_name.startsWith('Zoe'))
const { error: v1 } = await sam.client.rpc('cast_poll_vote', { p_poll: poll.id, p_options: ['yes'], p_player: leo.player_id })
const { error: v2 } = await sam.client.rpc('cast_poll_vote', { p_poll: poll.id, p_options: ['maybe'], p_player: zoe.player_id, p_note: 'leaving at half time' })
v1 || v2 ? bad(`${v1?.message ?? ''} ${v2?.message ?? ''}`) : ok('one yes, one maybe with a note')

head('4. Changing an answer replaces it rather than adding one')
await sam.client.rpc('cast_poll_vote', { p_poll: poll.id, p_options: ['no'], p_player: leo.player_id })
const { count: votes } = await admin.from('poll_votes').select('*',{count:'exact',head:true}).eq('poll_id', poll.id).eq('profile_id', sam.id)
votes === 2 ? ok('still 2 rows for this parent') : bad(`${votes} rows`)

head('5. You cannot answer for someone else’s child')
const { error: v3 } = await priya.client.rpc('cast_poll_vote', { p_poll: poll.id, p_options:['yes'], p_player: leo.player_id })
v3 ? ok('refused') : bad('answered for another family’s child')

head('6. Results are visible to the channel')
await sam.client.rpc('cast_poll_vote', { p_poll: poll.id, p_options: ['yes'], p_player: leo.player_id })
const { data: res } = await priya.client.rpc('poll_results', { p_poll: poll.id })
const yes = res.find(r=>r.option_id==='yes'), maybe = res.find(r=>r.option_id==='maybe')
yes?.votes === 1 && maybe?.votes === 1 ? ok(`yes ${yes.votes} · maybe ${maybe.votes} · no ${res.find(r=>r.option_id==='no').votes}`) : bad(JSON.stringify(res))

head('7. The coach can see who has not answered')
const { data: missing } = await coach.client.rpc('poll_non_responders', { p_poll: poll.id })
missing.length > 0 ? ok(`${missing.length} still to answer, e.g. ${missing[0].player_name}`) : bad('nobody listed')
const { data: parentView } = await sam.client.rpc('poll_non_responders', { p_poll: poll.id })
parentView.length === 0 ? ok('a parent sees no such list') : bad('parent saw the non-responders')

head('8. Turning it into an event carries the answers over')
const { data: eventId, error: ce } = await coach.client.rpc('convert_poll_to_event', {
  p_poll: poll.id, p_title: 'TEST::Spring Gala Day',
  p_starts_at: new Date(Date.now()+14*864e5).toISOString(),
  p_venue: 'Valentine Park', p_type: 'tournament',
})
ce ? bad(ce.message) : ok('event created')
const { data: rsvps } = await admin.from('event_rsvps').select('status, player_id, note').eq('event_id', eventId)
rsvps.length === 2 ? ok(`${rsvps.length} RSVPs pre-filled, nobody asked twice`) : bad(`${rsvps.length} RSVPs`)
rsvps.find(r=>r.status==='maybe')?.note === 'leaving at half time' ? ok('the note came with it') : bad('note lost')
rsvps.every(r=>r.status!=='yes' || true) && rsvps.some(r=>r.status==='maybe') ? ok('a maybe stayed a maybe') : bad('maybe was promoted')

head('9. A closed poll takes no more answers')
const { error: v4 } = await sam.client.rpc('cast_poll_vote', { p_poll: poll.id, p_options:['yes'], p_player: zoe.player_id })
v4 ? ok('refused — the poll closed on conversion') : bad('accepted a vote after closing')

head('10. And it cannot be converted twice')
const { error: ce2 } = await coach.client.rpc('convert_poll_to_event', {
  p_poll: poll.id, p_title:'TEST::Again', p_starts_at: new Date().toISOString() })
ce2 ? ok('refused') : bad('created a second event from one poll')

head('11. A parent cannot convert anything')
const { data: p2 } = await coach.client.from('polls').insert({
  academy_id: NRIFA, channel_id: u8.id, type:'availability', question:'TEST::Second', created_by: coach.id,
}).select('id').single()
const { error: ce3 } = await sam.client.rpc('convert_poll_to_event', {
  p_poll: p2.id, p_title:'TEST::Nope', p_starts_at: new Date().toISOString() })
ce3 ? ok('refused — hosts only') : bad('a parent created an event')

await admin.from('events').delete().like('title','TEST::%')
await admin.from('polls').delete().like('question','TEST::%')
console.log(process.exitCode ? '\n\x1b[31mPOLLS BROKEN\x1b[0m\n' : '\n\x1b[32mPOLLS WORK\x1b[0m\n')
process.exit(process.exitCode ?? 0)
