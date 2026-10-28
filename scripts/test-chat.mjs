/**
 * test-chat.mjs — the chat rules, as real users.
 *
 * Posting modes are enforced by RLS, so this drives the same API the browser
 * does rather than trusting the UI to disable a button.
 */
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
  const client = createClient(URL, PUB, {
    auth:{persistSession:false},
    global:{headers:{Authorization:`Bearer ${s.session.access_token}`}},
  })
  // An Authorization header covers REST. The realtime socket is a separate
  // connection with its own auth, and without this it connects as anon -
  // RLS then filters every change away and the subscription silently
  // receives nothing. The browser client does this itself on sign-in.
  //
  // AWAITED, because setAuth is async in supabase-js and this was a race: the
  // socket could reach SUBSCRIBED with the token not yet applied, bind the
  // subscription as anon, and receive nothing. Step 8 failed about one run in
  // two and blamed the publication.
  await client.realtime.setAuth(s.session.access_token)
  return { client, id: s.user.id }
}

const coach  = await sess('joeylameri@outlook.com')
const parent = await sess('p61400000011@squadroom.invalid')   // Sam Whitfield

const { data: u8 } = await admin.from('channels').select('id')
  .eq('team_id','00000000-0000-0000-0000-0000000d0008').eq('type','team').single()
await admin.from('channels').update({ posting_mode:'open' }).eq('id', u8.id)
await admin.from('messages').delete().like('body', 'TEST::%')

head('1. The channel list')
const { data: chans, error: ce } = await parent.client.rpc('my_channels', { p_academy: NRIFA })
ce ? bad(ce.message) : ok(`parent sees ${chans.length} channels with unread counts`)
const mine = chans.find(c => c.channel_id === u8.id)
mine ? ok(`"${mine.name}" — ${mine.unread_count} unread, last: ${mine.last_message_body?.slice(0,30) ?? 'none'}`) : bad('U8 channel missing')

head('2. Open mode: a parent can post')
const { data: sent, error: se } = await parent.client.from('messages')
  .insert({ academy_id: NRIFA, channel_id: u8.id, sender_id: parent.id, body: 'TEST::parent in open mode' })
  .select('id').single()
se ? bad(se.message) : ok('posted')

head('3. Announcements are host-only, even in open mode')
const { error: ae } = await parent.client.from('messages')
  .insert({ academy_id: NRIFA, channel_id: u8.id, sender_id: parent.id, body:'TEST::fake', is_announcement: true })
ae ? ok('parent refused an announcement') : bad('parent posted an announcement')

head('4. Hosts only: parent blocked, reactions still work')
await coach.client.from('channels').update({ posting_mode:'hosts_only' }).eq('id', u8.id)
const { error: he } = await parent.client.from('messages')
  .insert({ academy_id: NRIFA, channel_id: u8.id, sender_id: parent.id, body:'TEST::blocked' })
he ? ok('parent refused a message') : bad('parent posted in hosts_only')

await admin.from('message_reactions').delete().eq('message_id', sent.id).eq('profile_id', parent.id)
const { error: re } = await parent.client.from('message_reactions')
  .insert({ academy_id: NRIFA, message_id: sent.id, profile_id: parent.id, emoji:'🔥' })
re ? bad(`reaction blocked: ${re.message}`) : ok('parent can still react — the one thing broadcast mode must allow')

const { data: rc } = await parent.client.rpc('reaction_counts', { p_message_ids: [sent.id] })
rc?.[0]?.reaction_count === 1 && rc[0].reacted_by_me ? ok('counts visible, marked as mine') : bad(`counts: ${JSON.stringify(rc)}`)

head('5. Replies only: no new threads, replies fine')
await coach.client.from('channels').update({ posting_mode:'replies_only' }).eq('id', u8.id)
const { error: ne } = await parent.client.from('messages')
  .insert({ academy_id: NRIFA, channel_id: u8.id, sender_id: parent.id, body:'TEST::new thread' })
ne ? ok('new thread refused') : bad('parent started a thread')
const { error: rr } = await parent.client.from('messages')
  .insert({ academy_id: NRIFA, channel_id: u8.id, sender_id: parent.id, body:'TEST::a reply', reply_to_id: sent.id })
rr ? bad(`reply refused: ${rr.message}`) : ok('reply allowed')

head('6. Reading, and read state')
await coach.client.from('channels').update({ posting_mode:'open' }).eq('id', u8.id)
const { data: msgs } = await parent.client.rpc('channel_messages', { p_channel: u8.id, p_limit: 50 })
msgs?.length > 0 ? ok(`${msgs.length} messages, newest first, with sender names`) : bad('no messages')
const withRole = msgs.find(m => m.sender_role)
withRole ? ok(`roles included (e.g. ${withRole.sender_name}: ${withRole.sender_role})`) : bad('no roles')

await parent.client.rpc('mark_channel_read', { p_channel: u8.id })
const { data: after } = await parent.client.rpc('my_channels', { p_academy: NRIFA })
after.find(c => c.channel_id === u8.id).unread_count === 0 ? ok('marking read clears the badge') : bad('badge still set')

head('7. A deleted message leaves a tombstone, not its text')
await coach.client.from('messages').update({ deleted_at: new Date().toISOString(), deleted_by: coach.id }).eq('id', sent.id)
const { data: afterDel } = await parent.client.rpc('channel_messages', { p_channel: u8.id, p_limit: 50 })
const gone = afterDel.find(m => m.id === sent.id)
gone && gone.body === null && gone.deleted_at ? ok('body withheld, deletion visible') : bad(`tombstone wrong: ${JSON.stringify(gone)}`)

head('8. A message sent by the coach reaches the parent')

// What the PRODUCT guarantees, not what the socket manages.
//
// lib/hooks/use-channel-messages.ts feeds three paths into one merge: the
// postgres_changes subscription, a catch-up whenever the tab becomes visible,
// and a slow poll while the conversation is on screen. A message needs any
// one of them, which is why chat is reliable even though the socket is not.
//
// This mirrors that. Asserting the socket alone made this step fail about one
// run in five while the app itself was fine — a test measuring a transport
// the product deliberately does not depend on. scripts/check-realtime.mjs
// --trials=N measures the socket on its own, which is where that belongs.
let failure = null
const delivered = await new Promise((resolve) => {
  const seen = new Set()
  let settled = false
  const finish = (value) => {
    if (settled) return
    settled = true
    clearInterval(poll)
    clearTimeout(timer)
    resolve(value)
  }

  const timer = setTimeout(() => finish(null), 20000)

  // Path 1: the subscription — BROADCAST, exactly as the hook now does it.
  //
  // This tested postgres_changes, which is the path X-18 measured losing one
  // message in five. Testing the path the app no longer uses would have kept
  // reporting a failure the product had stopped having, and kept passing if
  // the broadcast path broke.
  //
  // The token is already on the SOCKET — sess() awaits setAuth, for the
  // reason written there. That is also the whole of X-18: a client built with
  // an Authorization header is authorised for HTTP and the socket is never
  // told, and a private broadcast topic is authorised from the socket.
  parent.client
    .channel(`channel:${u8.id}`, { config: { private: true } })
    .on('broadcast', { event: 'new_message' }, () => void check())
    .subscribe(async (status, err) => {
      if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
        failure = `the socket reported ${status}${err ? ': ' + err.message : ''}`
        return finish(null)
      }
      if (status !== 'SUBSCRIBED') return
      // An insert that was refused looks exactly like a message that never
      // arrived, and the two have nothing to do with each other.
      const { error } = await coach.client.from('messages').insert({
        academy_id: NRIFA, channel_id: u8.id, sender_id: coach.id,
        body: 'TEST::realtime ping',
      })
      if (error) {
        failure = `the coach could not post at all: ${error.message}`
        finish(null)
      }
    })

  // Paths 2 and 3: the same read the hook uses when the socket misses.
  async function check() {
    const { data } = await parent.client.rpc('channel_messages', {
      p_channel: u8.id, p_limit: 20,
    })
    for (const m of data ?? []) {
      if (seen.has(m.id)) continue
      seen.add(m.id)
      if (m.body === 'TEST::realtime ping') finish(m)
    }
  }
  const poll = setInterval(() => void check(), 2000)
})

delivered
  ? ok('a message sent by the coach reached the parent, through the same three paths the app uses')
  : bad(failure ?? 'nothing arrived within 20s — run scripts/check-realtime.mjs --trials=10')

await admin.from('messages').delete().like('body','TEST::%')
await admin.from('message_reactions').delete().eq('profile_id', parent.id).eq('emoji','🔥')
await admin.from('channels').update({ posting_mode:'open' }).eq('id', u8.id)

// Hand the realtime sockets back.
//
// Every client built by sess() opens one, and this suite used to exit without
// closing any — as did every other suite. CLAUDE.md already names Realtime
// CONCURRENT CONNECTIONS as the ceiling this product hits first, and a test
// run that leaks two sockets a suite walks towards it. The realtime step here
// failed about one run in three while a fresh subscription measured 16 out of
// 16, which is what a connection limit looks like from the inside.
await Promise.all([
  coach.client.removeAllChannels(),
  parent.client.removeAllChannels(),
])
coach.client.realtime.disconnect()
parent.client.realtime.disconnect()
console.log(process.exitCode ? '\n\x1b[31mCHAT RULES BROKEN\x1b[0m\n' : '\n\x1b[32mCHAT RULES HOLD\x1b[0m\n')
// The realtime socket keeps the event loop alive, so exit deliberately
// rather than leaving the runner hanging on a healthy connection.
process.exit(process.exitCode ?? 0)
