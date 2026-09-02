import { createClient } from '@supabase/supabase-js'
const URL=process.env.NEXT_PUBLIC_SUPABASE_URL
const admin=createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}})
const ok=m=>console.log(`  \x1b[32m✓\x1b[0m ${m}`), bad=m=>{console.log(`  \x1b[31m✗\x1b[0m ${m}`);process.exitCode=1}
const head=m=>console.log(`\n${m}`)
const NRIFA='00000000-0000-0000-0000-0000000a0001', U8='00000000-0000-0000-0000-0000000d0008'
const EV='00000000-0000-0000-0000-00000000rem1'.replace('rem1','9ee1')

async function reset(){
  await admin.from('notification_queue').delete().eq('kind','event_reminder')
  await admin.from('events').delete().eq('id', EV)
}
await reset()

head('1. An event 24 hours out enqueues one reminder per person')
await admin.from('events').insert({
  id: EV, academy_id: NRIFA, team_id: U8, type: 'match', title: 'Reminder Test Cup',
  starts_at: new Date(Date.now() + 24*3600e3 - 60e3).toISOString(),
  ends_at:   new Date(Date.now() + 25*3600e3).toISOString(),
  arrive_at: new Date(Date.now() + 24*3600e3 - 30*60e3).toISOString(),
  venue: 'ELS Hall Park',
})
const { data: n1 } = await admin.rpc('enqueue_event_reminders')
const { data: q1 } = await admin.from('notification_queue')
  .select('profile_id, title, body, dedupe_key')
  .eq('kind','event_reminder').contains('payload', { event_id: EV })
q1.length > 0 ? ok(`${q1.length} queued for the U8 team`) : bad('nothing queued')
q1[0]?.title.startsWith('Tomorrow: ') ? ok(`titled "${q1[0].title}"`) : bad(`title: ${q1[0]?.title}`)
q1[0]?.body?.includes('arrive') ? ok(`body has the arrival time: "${q1[0].body}"`) : bad(`body: ${q1[0]?.body}`)

// Every assertion below counts rows FOR THIS EVENT. They used to count every
// event_reminder row in the database, while pg_cron queues reminders for
// other events every five minutes — so the numbers depended on what else
// happened to be within 24 hours when the test ran. It passed for months and
// then failed the day another test created a fixture twelve hours out.
const mine = () => admin.from('notification_queue')
  .select('profile_id', { count: 'exact' })
  .eq('kind','event_reminder').contains('payload', { event_id: EV })
const clearMine = () => admin.from('notification_queue')
  .delete().eq('kind','event_reminder').contains('payload', { event_id: EV })

head('2. Running again does not send it twice')
await admin.rpc('enqueue_event_reminders')
const { count: n2 } = await mine()
n2 === q1.length ? ok(`still ${n2} — dedupe_key holds`) : bad(`grew to ${n2}`)

head('3. Opting out is respected')
const sam='00000000-0000-0000-0000-0000000000b1'
await clearMine()
await admin.from('user_settings').update({ notify_reminder_24h: false }).eq('profile_id', sam)
await admin.rpc('enqueue_event_reminders')
const { data: q3 } = await mine()
q3.some(r => r.profile_id === sam) ? bad('queued for someone who turned it off') : ok('skipped the person who opted out')
await admin.from('user_settings').update({ notify_reminder_24h: true }).eq('profile_id', sam)

head('4. Moving the event drops the reminders that were already queued')
await clearMine()
await admin.rpc('enqueue_event_reminders')
const { count: before } = await mine()
const moved = new Date(Date.now() + 8*864e5)
await admin.from('events').update({
  starts_at: moved.toISOString(),
  ends_at: new Date(moved.getTime()+3600e3).toISOString(),
  arrive_at: new Date(moved.getTime()-1800e3).toISOString(),
}).eq('id', EV)
const { count: after } = await mine()
before > 0 && after === 0 ? ok(`${before} cleared — nobody gets yesterday's time`) : bad(`${before} -> ${after}`)

head('5. Cancelling does the same')
// Move the WHOLE window. arrive_at <= starts_at is a constraint, and leaving
// arrive_at eight days ahead silently rejects the update - which then reads
// as 'the reminder did not fire' rather than 'the event never moved'.
const back = new Date(Date.now() + 24*3600e3 - 60e3)
const { error: mv } = await admin.from('events').update({
  starts_at: back.toISOString(),
  ends_at:   new Date(back.getTime() + 3600e3).toISOString(),
  arrive_at: new Date(back.getTime() - 1800e3).toISOString(),
}).eq('id', EV)
if (mv) bad(`could not move the event back: ${mv.message}`)
await admin.rpc('enqueue_event_reminders')
const { count: b2 } = await mine()
await admin.from('events').update({ cancelled_at: new Date().toISOString() }).eq('id', EV)
const { count: a2 } = await mine()
b2 > 0 && a2 === 0 ? ok(`${b2} cleared on cancellation`) : bad(`${b2} -> ${a2}`)

head('6. A reminder is only queued once the window opens')
await clearMine()
const far = new Date(Date.now() + 5*864e5)
await admin.from('events').update({
  cancelled_at: null,
  starts_at: far.toISOString(),
  ends_at:   new Date(far.getTime() + 3600e3).toISOString(),
  arrive_at: new Date(far.getTime() - 1800e3).toISOString(),
}).eq('id', EV)
await admin.rpc('enqueue_event_reminders')
const { count: early } = await mine()
early === 0 ? ok('an event five days out queues nothing yet') : bad(`queued ${early} too early`)

await reset()
console.log(process.exitCode ? '\n\x1b[31mREMINDERS BROKEN\x1b[0m\n' : '\n\x1b[32mREMINDERS WORK\x1b[0m\n')
process.exit(process.exitCode ?? 0)
