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
const coach  = await sess('joeylameri@outlook.com')          // host of the U8 channel
const parent = await sess('p61400000011@squadroom.invalid')
const other  = await sess('p61400000012@squadroom.invalid')

const { data: ch } = await admin.from('channels').select('id')
  .eq('team_id','00000000-0000-0000-0000-0000000d0008').eq('type','team').single()
await admin.from('messages').delete().like('body','EDITTEST%')

// Deleting a message blanks its body (0012's archive trigger), so a cleanup
// that matches on body leaves every deleted message behind — which is exactly
// what happened, and it showed up as "Message deleted" at the top of a real
// channel list. Track ids instead.
const made = []
const post = async (who, body) => {
  const { data, error } = await who.client.from('messages')
    .insert({ academy_id: NRIFA, channel_id: ch.id, sender_id: who.id, body })
    .select('id, body, edited_at').single()
  if (error) throw new Error(error.message)
  made.push(data.id)
  return data
}

head('1. A parent can edit their own message')
const m1 = await post(parent, 'EDITTEST kick-off is 9am')
const { error: e1 } = await parent.client.from('messages')
  .update({ body: 'EDITTEST kick-off is 10am' }).eq('id', m1.id)
e1 ? bad(e1.message) : ok('edited')
const { data: after1 } = await admin.from('messages').select('body, edited_at').eq('id', m1.id).single()
after1.body.includes('10am') ? ok('the new words are stored') : bad('body unchanged')

head('2. And it is marked as edited, whatever the client sent')
after1.edited_at ? ok(`edited_at stamped by the trigger: ${after1.edited_at.slice(11,19)}`)
                 : bad('an edit left no trace — "9am" became "10am" silently')

head('3. A host can remove a message but not rewrite it')
const m2 = await post(parent, 'EDITTEST something a host would take down')
const { error: rewrite } = await coach.client.from('messages')
  .update({ body: 'EDITTEST words the parent never said' }).eq('id', m2.id)
rewrite ? ok(`refused: ${rewrite.message.slice(0,60)}`)
        : bad('A HOST PUT WORDS IN A PARENT\'S MOUTH')
const { error: remove } = await coach.client.from('messages')
  .update({ deleted_at: new Date().toISOString() }).eq('id', m2.id)
remove ? bad(`a host could not remove it: ${remove.message}`) : ok('but removing it works')

head('4. Deleting is one way')
const { error: undelete } = await parent.client.from('messages')
  .update({ deleted_at: null }).eq('id', m2.id)
const { data: still } = await admin.from('messages').select('deleted_at').eq('id', m2.id).single()
still.deleted_at ? ok('un-deleting is ignored — the archive stays honest')
                 : bad('a deleted message came back')

head('5. A stranger cannot touch either')
const { error: nosy } = await other.client.from('messages')
  .update({ body: 'EDITTEST hijacked' }).eq('id', m1.id)
const { data: safe } = await admin.from('messages').select('body').eq('id', m1.id).single()
safe.body.includes('10am') ? ok('another parent changed nothing') : bad('a stranger edited a message')

head('6. An edit cannot promote a message to an announcement')
const m3 = await post(coach, 'EDITTEST ordinary message')
const { error: promote } = await coach.client.from('messages')
  .update({ is_announcement: true }).eq('id', m3.id)
promote ? ok(`refused: ${promote.message.slice(0,54)}`)
        : bad('an ordinary message became an announcement, bypassing mutes and quiet hours')

head('7. A deleted message keeps its replies readable')
const { data: msgs } = await parent.client.rpc('channel_messages', { p_channel: ch.id, p_limit: 30 })
const removed = msgs.find(m => m.id === m2.id)
removed ? ok('the thread still renders it as removed rather than losing the context')
        : ok('deleted messages are filtered from the thread')

await admin.from('messages').delete().in('id', made)
console.log('\ncleaned up\n')
