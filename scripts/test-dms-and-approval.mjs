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
const coach   = await sess('joeylameri@outlook.com')            // owner
const sam     = await sess('p61400000011@squadroom.invalid')    // parent
const priya   = await sess('p61400000012@squadroom.invalid')    // parent
const ravens  = await sess('p61400000092@squadroom.invalid')    // other academy

await admin.from('channels').delete().eq('type','direct').eq('academy_id', NRIFA)

head('1. A parent can message their coach')
const { data: dm, error: e1 } = await sam.client.rpc('open_direct_channel', { p_academy: NRIFA, p_other: coach.id })
e1 ? bad(e1.message) : ok('DM opened')

head('2. Opening it again returns the same conversation')
const { data: again } = await sam.client.rpc('open_direct_channel', { p_academy: NRIFA, p_other: coach.id })
again === dm ? ok('same channel, not a duplicate') : bad(`got a different channel: ${again}`)

head('3. And from the coach’s side too')
const { data: fromCoach } = await coach.client.rpc('open_direct_channel', { p_academy: NRIFA, p_other: sam.id })
fromCoach === dm ? ok('same channel regardless of who opens it') : bad('created a second conversation')

head('4. Parent to parent is refused while the academy is staff_only')
const { error: e4 } = await sam.client.rpc('open_direct_channel', { p_academy: NRIFA, p_other: priya.id })
e4 ? ok('refused — the safeguarding default holds') : bad('two parents opened a private channel')

head('5. Unless the academy opens it')
await coach.client.from('academies').update({ dm_policy: 'open' }).eq('id', NRIFA)
const { error: e5 } = await sam.client.rpc('open_direct_channel', { p_academy: NRIFA, p_other: priya.id })
e5 ? bad(`still refused: ${e5.message}`) : ok('allowed once the academy sets dm_policy = open')
await coach.client.from('academies').update({ dm_policy: 'staff_only' }).eq('id', NRIFA)

head('6. Nobody can message across academies')
const { error: e6 } = await sam.client.rpc('open_direct_channel', { p_academy: NRIFA, p_other: ravens.id })
e6 ? ok('refused — not a member of this academy') : bad('opened a DM with another academy')

head('7. A DM is named after the other person')
const { data: chans } = await sam.client.rpc('my_channels', { p_academy: NRIFA })
const row = chans.find(c => c.channel_id === dm)
row?.name === 'Joey Lameri' ? ok(`listed as "${row.name}"`) : bad(`named "${row?.name}"`)

head('8. And is private to the two of them')
const { data: seen } = await priya.client.rpc('my_channels', { p_academy: NRIFA })
seen.some(c => c.channel_id === dm) ? bad('another parent sees the DM') : ok('invisible to everyone else')

// ---------- approval queue ----------
const { data: u8 } = await admin.from('channels').select('id')
  .eq('team_id','00000000-0000-0000-0000-0000000d0008').eq('type','team').single()
await coach.client.from('channels').update({ restrictions: { approval_required: true } }).eq('id', u8.id)
await admin.from('messages').delete().like('body','AQ::%')

head('9. With approval on, a parent’s message is held')
const { data: held, error: e9 } = await sam.client.from('messages')
  .insert({ academy_id: NRIFA, channel_id: u8.id, sender_id: sam.id, body:'AQ::held', status:'pending' })
  .select('id, status').single()
e9 ? bad(e9.message) : held.status === 'pending' ? ok('queued') : bad(`status ${held.status}`)

head('10. The author cannot publish it themselves')
const { error: e10 } = await sam.client.from('messages').update({ status:'published' }).eq('id', held.id)
e10 ? ok(`blocked: ${e10.message.slice(0,48)}`) : bad('author self-published — the queue is decorative')

head('11. Nor promote it to an announcement, or pin it')
const { error: e11a } = await sam.client.from('messages').update({ is_announcement: true }).eq('id', held.id)
const { error: e11b } = await sam.client.from('messages').update({ pinned_at: new Date().toISOString() }).eq('id', held.id)
e11a && e11b ? ok('both refused') : bad(`announcement ${e11a?'ok':'ALLOWED'}, pin ${e11b?'ok':'ALLOWED'}`)

head('12. Other parents cannot see it while it waits')
const { data: priyaSees } = await priya.client.rpc('channel_messages', { p_channel: u8.id, p_limit: 50 })
priyaSees.some(m => m.id === held.id) ? bad('a pending message was visible') : ok('hidden until approved')

head('13. The host sees the queue and approves')
const { data: queue } = await coach.client.rpc('pending_messages', { p_channel: u8.id })
queue?.length === 1 ? ok(`${queue.length} waiting, from ${queue[0].sender_name}`) : bad(`queue length ${queue?.length}`)
const { data: parentQueue } = await sam.client.rpc('pending_messages', { p_channel: u8.id })
parentQueue?.length === 0 ? ok('a parent sees no queue') : bad('parent saw the queue')

const { error: e13 } = await coach.client.from('messages').update({ status:'published' }).eq('id', held.id)
e13 ? bad(e13.message) : ok('host approved it')

const { data: nowVisible } = await priya.client.rpc('channel_messages', { p_channel: u8.id, p_limit: 50 })
nowVisible.some(m => m.id === held.id) ? ok('and it appears for everyone') : bad('still hidden after approval')

const { data: rec } = await admin.from('messages').select('approved_by, approved_at').eq('id', held.id).single()
rec.approved_by === coach.id && rec.approved_at ? ok('who approved it is recorded') : bad('no approval record')

head('14. Editing leaves a trace')
const { error: e14 } = await sam.client.from('messages').update({ body: 'AQ::edited' }).eq('id', held.id)
const { data: edited } = await admin.from('messages').select('edited_at').eq('id', held.id).single()
!e14 && edited.edited_at ? ok('edited_at set by the database, not the client') : bad('no edit trace')

await coach.client.from('channels').update({ restrictions: {} }).eq('id', u8.id)
await admin.from('messages').delete().like('body','AQ::%')
console.log(process.exitCode ? '\n\x1b[31mBROKEN\x1b[0m\n' : '\n\x1b[32mDMs AND APPROVAL QUEUE HOLD\x1b[0m\n')
process.exit(process.exitCode ?? 0)
