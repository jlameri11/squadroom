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
const coach = await sess('joeylameri@outlook.com')
const sam   = await sess('p61400000011@squadroom.invalid')

const clear = () => admin.from('notification_queue').delete()
  .in('kind',['event_cancelled','event_changed','event_back_on'])

async function makeEvent(daysAhead) {
  const start = new Date(Date.now() + daysAhead*864e5)
  const { data, error } = await admin.from('events').insert({
    academy_id: NRIFA, team_id: U8, type:'match', title:'Cancellation probe',
    starts_at: start.toISOString(), ends_at: new Date(+start + 5400e3).toISOString(),
    venue:'ELS Hall Park, Field 3',
  }).select('id').single()
  if (error) throw new Error(error.message)
  return data.id
}
const queued = (id, kind) => admin.from('notification_queue')
  .select('profile_id, title, body, escalate_sms, scheduled_for')
  .eq('kind', kind).contains('payload', { event_id: id })

head('1. Calling a game off notifies the whole team')
await clear()
const far = await makeEvent(7)
await coach.client.from('events').update({
  cancelled_at: new Date().toISOString(), cancellation_reason: 'wet_weather',
  cancellation_note: 'Council closed all grounds',
}).eq('id', far)
const { data: sent } = await queued(far, 'event_cancelled')
sent?.length > 0 ? ok(`${sent.length} people told`) : bad('nobody was notified — the old hole')

head('2. Including families who never RSVP\'d')
const { data: everyone } = await admin.from('team_members').select('profile_id').eq('team_id', U8)
const { data: responders } = await admin.from('event_rsvps').select('profile_id').eq('event_id', far)
sent.length >= (everyone?.length ?? 0)
  ? ok(`${sent.length} notified vs ${responders?.length ?? 0} who had answered — the silent ones are the point`)
  : bad(`only ${sent.length} of ${everyone?.length} team members`)

head('3. The message says why, not just that it is off')
const msg = sent[0]
;/wet weather/i.test(msg.body) ? ok(`"${msg.title}" — "${msg.body}"`) : bad(`body was "${msg.body}"`)
;/council closed/i.test(msg.body) ? ok('the coach\'s note came through') : bad('note dropped')

head('4. A week out, it does NOT send a text')
msg.escalate_sms === false ? ok('push only — SMS is not for a game next Saturday')
                           : bad('would have texted for a game a week away')

head('5. Quiet hours do not delay it')
await admin.from('user_settings').update({
  quiet_hours_enabled: true, quiet_hours_start: '00:00', quiet_hours_end: '23:59',
}).eq('profile_id', sam.id)
await clear()
const far2 = await makeEvent(6)
await coach.client.from('events').update({ cancelled_at: new Date().toISOString(), cancellation_reason: 'ground_closed' }).eq('id', far2)
const { data: quiet } = await queued(far2, 'event_cancelled')
const samRow = quiet.find(r => r.profile_id === sam.id)
samRow && new Date(samRow.scheduled_for) <= new Date(Date.now()+60e3)
  ? ok('sent immediately even inside quiet hours — that is what the exception is for')
  : bad('a cancellation was held until morning')
await admin.from('user_settings').update({ quiet_hours_enabled: false }).eq('profile_id', sam.id)

head('6. Inside 24 hours it escalates to SMS')
await clear()
const soon = await makeEvent(0.5)
await coach.client.from('events').update({
  cancelled_at: new Date().toISOString(), cancellation_reason: 'wet_weather',
}).eq('id', soon)
const { data: urgent } = await queued(soon, 'event_cancelled')
urgent?.every(r => r.escalate_sms) ? ok(`${urgent.length} flagged for a text as well as a push`)
                                   : bad('a game in 12 hours did not escalate')

head('7. Moving a game tells people the new time')
await clear()
const moving = await makeEvent(5)
const newStart = new Date(Date.now() + 5.25*864e5)
await coach.client.from('events').update({
  starts_at: newStart.toISOString(), ends_at: new Date(+newStart + 5400e3).toISOString(),
}).eq('id', moving)
const { data: moved } = await queued(moving, 'event_changed')
moved?.length > 0 ? ok(`"${moved[0].title}" — "${moved[0].body}"`) : bad('a moved game notified nobody')

head('8. Saving the same change twice sends one message')
const before = (await queued(moving,'event_changed')).data.length
await coach.client.from('events').update({ venue: 'ELS Hall Park, Field 3' }).eq('id', moving)
const after = (await queued(moving,'event_changed')).data.length
after === before ? ok('a no-op save sent nothing') : bad(`sent ${after-before} more`)

head('9. Putting it back on says so')
await clear()
await coach.client.from('events').update({ cancelled_at: null, cancellation_reason: null }).eq('id', far)
const { data: backOn } = await queued(far, 'event_back_on')
backOn?.length > 0 ? ok(`"${backOn[0].title}" — "${backOn[0].body}"`) : bad('nobody told it was back on')

head('10. A parent cannot call a game off')
const { error: parentCancel } = await sam.client.from('events')
  .update({ cancelled_at: new Date().toISOString() }).eq('id', moving)
const { data: still } = await admin.from('events').select('cancelled_at').eq('id', moving).single()
still.cancelled_at === null ? ok('the game is still on') : bad('A PARENT CANCELLED A FIXTURE')

await clear()
await admin.from('events').delete().eq('title','Cancellation probe')
console.log('\ncleaned up\n')
