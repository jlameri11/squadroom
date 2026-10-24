import { createClient } from '@supabase/supabase-js'
const URL=process.env.NEXT_PUBLIC_SUPABASE_URL, PUB=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const admin=createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}})
const anon =createClient(URL, PUB,{auth:{persistSession:false}})
const ok=m=>console.log(`  \x1b[32m✓\x1b[0m ${m}`), bad=m=>{console.log(`  \x1b[31m✗\x1b[0m ${m}`);process.exitCode=1}
const head=m=>console.log(`\n${m}`)
const NRIFA='00000000-0000-0000-0000-0000000a0001'
const U8_TEAM='00000000-0000-0000-0000-0000000d0008'

async function sess(email){
  const { data:l } = await admin.auth.admin.generateLink({type:'magiclink', email})
  const { data:s } = await anon.auth.verifyOtp({token_hash:l.properties.hashed_token, type:'email'})
  return { client: createClient(URL, PUB, {auth:{persistSession:false},
    global:{headers:{Authorization:`Bearer ${s.session.access_token}`}}}), id: s.user.id }
}
const coach  = await sess('joeylameri@outlook.com')
const parent = await sess('p61400000011@squadroom.invalid')   // Sam: Leo + Zoe in U8

const { data: u8 } = await admin.from('channels').select('id')
  .eq('team_id', U8_TEAM).eq('type','team').single()

// FOUND, not hard-coded.
//
// This used to name seed.sql's "Round 12 vs Gladesville Ravens" by its fixed
// uuid, and refresh-demo.mjs deletes every manual NRIFA event and re-inserts
// the season with fresh ones — so the test started failing with a foreign key
// violation that said nothing about the cause. Any upcoming U8 match will do;
// what is under test is the card, not that particular Saturday.
const { data: match } = await admin.from('events')
  .select('id, title')
  .eq('academy_id', NRIFA).eq('team_id', U8_TEAM).eq('type', 'match')
  .is('private_to', null)
  .gte('starts_at', new Date().toISOString())
  .order('starts_at')
  .limit(1)
  .maybeSingle()

if (!match) {
  bad('no upcoming U8 match to post — run scripts/refresh-demo.mjs')
  process.exit(1)
}
const MATCH = match.id
console.log(`  (using "${match.title}")`)
await admin.from('messages').delete().eq('event_id', MATCH)

head('1. A coach posts a fixture into the channel')
const { data: msg, error: pe } = await coach.client.from('messages')
  .insert({ academy_id: NRIFA, channel_id: u8.id, sender_id: coach.id, event_id: MATCH, body: null })
  .select('id').single()
pe ? bad(pe.message) : ok('posted as a card, with no body text')

head('2. The card carries the event, in the same round trip')
const { data: msgs } = await parent.client.rpc('channel_messages', { p_channel: u8.id, p_limit: 20 })
const card = msgs.find(m => m.id === msg.id)
card?.event ? ok(`event embedded: "${card.event.title}"`) : bad('no event on the message')
card?.event?.venue ? ok(`venue for the Maps link: ${card.event.venue}`) : bad('no venue')

head('3. A parent sees one RSVP row per child')
const { data: mine, error: re } = await parent.client.rpc('my_rsvps_for_event', { p_event: MATCH })
re ? bad(re.message) : mine.length === 2
  ? ok(`${mine.length} rows: ${mine.map(r=>r.player_name.split(' ')[0]).join(' and ')} — answered separately`)
  : bad(`expected 2 children, got ${mine.length}`)

head('4. Answering from the card')
const leo = mine.find(r => r.player_name.startsWith('Leo'))
const { error: ue } = await parent.client.from('event_rsvps').upsert({
  academy_id: NRIFA, event_id: MATCH, profile_id: parent.id, player_id: leo.player_id, status: 'no',
}, { onConflict: 'event_id,profile_id,player_id' })
ue ? bad(ue.message) : ok('RSVP saved')
const { data: after } = await parent.client.rpc('my_rsvps_for_event', { p_event: MATCH })
after.find(r => r.player_id === leo.player_id)?.status === 'no' ? ok('and reads back') : bad('did not persist')

head('5. The tally is for coaches only')
const { data: coachSum } = await coach.client.rpc('event_rsvp_summary', { p_event: MATCH })
coachSum?.[0] ? ok(`coach sees ${coachSum[0].going} in · ${coachSum[0].maybe} maybe · ${coachSum[0].out_count} out · ${coachSum[0].no_reply} no reply`) : bad('coach got no summary')
const { data: parentSum } = await parent.client.rpc('event_rsvp_summary', { p_event: MATCH })
!parentSum?.[0] || parentSum[0].going === null ? ok('parent gets no tally') : bad(`parent saw ${JSON.stringify(parentSum[0])}`)

head('6. Moving the game updates the card already in the thread')
const moved = new Date(Date.now() + 9*864e5)
// ends_at and arrive_at have to move with it, or events_ends_after_starts
// rejects the whole update. Worth knowing: the app must shift the window,
// not just the kick-off, when a coach reschedules.
const { error: me } = await coach.client.from('events').update({
  starts_at: moved.toISOString(),
  ends_at:   new Date(moved.getTime() + 3600_000).toISOString(),
  arrive_at: new Date(moved.getTime() - 1800_000).toISOString(),
  venue: 'Christie Park',
}).eq('id', MATCH)
me ? bad(`reschedule refused: ${me.message}`) : ok('rescheduled')
const { data: reread } = await parent.client.rpc('channel_messages', { p_channel: u8.id, p_limit: 20 })
const updated = reread.find(m => m.id === msg.id)
updated?.event?.venue === 'Christie Park'
  ? ok('the card shows the new venue — it references the event, not a copy')
  : bad(`card still says ${updated?.event?.venue}`)

// restore
await admin.from('events').update({ venue: 'ELS Hall Park, Field 3' }).eq('id', MATCH)
await admin.from('messages').delete().eq('event_id', MATCH)
await admin.from('event_rsvps').delete().eq('event_id', MATCH).eq('player_id', leo.player_id).eq('profile_id', parent.id)
await admin.from('event_rsvps').insert({ academy_id: NRIFA, event_id: MATCH, profile_id: parent.id, player_id: leo.player_id, status: 'yes' })
console.log(process.exitCode ? '\n\x1b[31mEVENT CARDS BROKEN\x1b[0m\n' : '\n\x1b[32mEVENT CARDS WORK\x1b[0m\n')
process.exit(process.exitCode ?? 0)
