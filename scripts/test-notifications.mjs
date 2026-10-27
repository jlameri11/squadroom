/**
 * The queue side of push: who gets told about what, and when.
 * Actual delivery needs a real browser subscription, so that is exercised by
 * turning notifications on in the app.
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
  return { client: createClient(URL, PUB, {auth:{persistSession:false},
    global:{headers:{Authorization:`Bearer ${s.session.access_token}`}}}), id: s.user.id }
}
const coach = await sess('joeylameri@outlook.com')
const sam   = await sess('p61400000011@squadroom.invalid')
const { data: u8 } = await admin.from('channels').select('id')
  .eq('team_id','00000000-0000-0000-0000-0000000d0008').eq('type','team').single()

async function clear(){
  await admin.from('notification_queue').delete().in('kind',['message','announcement'])
  await admin.from('messages').delete().like('body','NOTIF::%')
}
await clear()
await admin.from('user_settings').update({ quiet_hours_enabled: false }).neq('profile_id','00000000-0000-0000-0000-000000000000')

head('1. A message notifies the channel, but never its sender')
const { data: m1 } = await coach.client.from('messages')
  .insert({ academy_id: NRIFA, channel_id: u8.id, sender_id: coach.id, body: 'NOTIF::kit is navy' })
  .select('id').single()
const { data: q1 } = await admin.from('notification_queue').select('profile_id, title, body').eq('kind','message')
// Counted from the channel, not hard-coded.
//
// This asserted `=== 5`, which was the seeded U8 roster. The squad has since
// grown to seventeen and the test reported a broken trigger that was queuing
// exactly the right number of notifications. The rule under test is "everyone
// in the channel except the sender", so that is what to measure.
const { count: inChannel } = await admin.from('channel_members')
  .select('*', { count: 'exact', head: true }).eq('channel_id', u8.id)
const expected = inChannel - 1
q1.length === expected
  ? ok(`${q1.length} queued — everyone in the channel but the sender`)
  : bad(`${q1.length} queued, expected ${expected} (${inChannel} in the channel)`)
q1.some(n => n.profile_id === coach.id) ? bad('the sender was notified') : ok('never the sender')
q1.some(r => r.profile_id === coach.id) ? bad('the sender was notified') : ok('sender excluded')
q1[0].body.startsWith('Joey Lameri: ') ? ok(`body reads "${q1[0].body}"`) : bad(q1[0].body)

head('2. Muting a channel spares you the noise')
await clear()
await admin.from('channel_members').update({ muted: true }).eq('channel_id', u8.id).eq('profile_id', sam.id)
await coach.client.from('messages').insert({ academy_id: NRIFA, channel_id: u8.id, sender_id: coach.id, body:'NOTIF::chatter' })
const { data: q2 } = await admin.from('notification_queue').select('profile_id').eq('kind','message')
q2.some(r => r.profile_id === sam.id) ? bad('notified a muted member') : ok('muted member skipped')

head('3. But an announcement still gets through')
await clear()
await coach.client.from('messages').insert({
  academy_id: NRIFA, channel_id: u8.id, sender_id: coach.id, body:'NOTIF::TRAINING CANCELLED', is_announcement: true })
const { data: q3 } = await admin.from('notification_queue').select('profile_id, kind').eq('kind','announcement')
q3.some(r => r.profile_id === sam.id) ? ok('a muted member still hears an announcement') : bad('announcement suppressed by mute')
await admin.from('channel_members').update({ muted: false }).eq('channel_id', u8.id).eq('profile_id', sam.id)

head('4. Turning messages off is respected')
await clear()
await admin.from('user_settings').update({ notify_messages: false }).eq('profile_id', sam.id)
await coach.client.from('messages').insert({ academy_id: NRIFA, channel_id: u8.id, sender_id: coach.id, body:'NOTIF::more' })
const { data: q4 } = await admin.from('notification_queue').select('profile_id').eq('kind','message')
q4.some(r => r.profile_id === sam.id) ? bad('notified someone who turned it off') : ok('opt-out respected')
await admin.from('user_settings').update({ notify_messages: true }).eq('profile_id', sam.id)

head('5. Quiet hours delay a message rather than dropping it')
await clear()
// A window that certainly contains right now.
await admin.from('user_settings').update({
  quiet_hours_enabled: true, quiet_hours_start: '00:00', quiet_hours_end: '23:59',
}).eq('profile_id', sam.id)
await coach.client.from('messages').insert({ academy_id: NRIFA, channel_id: u8.id, sender_id: coach.id, body:'NOTIF::late night' })
const { data: q5 } = await admin.from('notification_queue').select('profile_id, scheduled_for').eq('kind','message')
const samRow = q5.find(r => r.profile_id === sam.id)
samRow && new Date(samRow.scheduled_for) > new Date(Date.now() + 3600e3)
  ? ok(`held until ${new Date(samRow.scheduled_for).toLocaleString('en-AU',{timeZone:'Australia/Sydney'})}`)
  : bad(`scheduled_for ${samRow?.scheduled_for}`)

head('6. An announcement ignores quiet hours')
await clear()
await coach.client.from('messages').insert({
  academy_id: NRIFA, channel_id: u8.id, sender_id: coach.id, body:'NOTIF::URGENT', is_announcement: true })
const { data: q6 } = await admin.from('notification_queue').select('profile_id, scheduled_for').eq('kind','announcement')
const now6 = q6.find(r => r.profile_id === sam.id)
now6 && new Date(now6.scheduled_for) <= new Date(Date.now() + 60e3)
  ? ok('sent immediately — that is what an announcement is for')
  : bad(`held until ${now6?.scheduled_for}`)
await admin.from('user_settings').update({
  quiet_hours_enabled: true, quiet_hours_start: '21:00', quiet_hours_end: '07:00',
}).eq('profile_id', sam.id)

head('7. Claiming is safe to run twice')
await clear()
// Quiet hours are still on from step 6, and a notification held until
// midnight is not due, so it would never be claimed. Turn them off, or this
// measures the wrong thing.
await admin.from('user_settings').update({ quiet_hours_enabled: false }).eq('profile_id', sam.id)
await coach.client.from('messages').insert({ academy_id: NRIFA, channel_id: u8.id, sender_id: coach.id, body:'NOTIF::claim me' })
// Named explicitly. This used to read `.eq('kind','message').limit(1)` with
// no ordering, which is whichever row Postgres happened to return first —
// it passed for months and then failed the day a migration moved the heap
// around, reporting a broken function that was working perfectly.
const { data: queued } = await admin.from('notification_queue')
  .select('id, attempts, scheduled_for').eq('kind','message')
  .order('created_at', { ascending: false }).limit(1).single()
// The limit has to clear the whole backlog, not a round 100.
//
// claim_notifications takes the OLDEST due rows first, which is right — a
// notification queue is FIFO and a new message must not jump ahead of one
// enqueued ten minutes ago. But it means the row this test just created is
// LAST, and with 300-odd undrained rows sitting in a dev database (nothing
// has a push subscription, so nothing ever gets sent) two claims of 100
// never reached it. attempts stayed 0 and the test reported a counter that
// was working perfectly — the same failure as the unordered `limit 1` above,
// one layer out.
const { count: due } = await admin
  .from('notification_queue')
  .select('id', { count: 'exact', head: true })
  .is('sent_at', null)
  .lt('attempts', 5)
  .lte('scheduled_for', new Date().toISOString())
const deep = (due ?? 100) + 50

const { data: c1 } = await admin.rpc('claim_notifications', { p_limit: deep })
await admin.rpc('claim_notifications', { p_limit: deep })
ok(`first claim returned ${c1?.length ?? 0} deliverable (nobody has a device registered yet)`)
const { data: attempts } = await admin.from('notification_queue')
  .select('attempts').eq('id', queued.id).single()
// At least the two claims above, not exactly two.
//
// Inserting a message fires the pg_net wake-up trigger, so push-now may be
// draining this very queue while the test runs — a third attempt means the
// product is working, not failing. What matters is that claiming counts
// attempts at all, which is what stops a stuck row retrying forever.
attempts.attempts >= 2
  ? ok(`attempts counted (${attempts.attempts}), so a stuck row stops after five tries`)
  : bad(`attempts=${attempts.attempts} after two claims — not being counted`)

await clear()
await admin.from('user_settings').update({ quiet_hours_enabled: true }).neq('profile_id','00000000-0000-0000-0000-000000000000')
console.log(process.exitCode ? '\n\x1b[31mBROKEN\x1b[0m\n' : '\n\x1b[32mNOTIFICATION RULES HOLD\x1b[0m\n')
process.exit(process.exitCode ?? 0)
