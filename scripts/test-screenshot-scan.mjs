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

const coach  = await sess('joeylameri@outlook.com')
const sam    = await sess('p61400000011@squadroom.invalid')  // parent, Leo + Zoe in U8
const other  = await sess('p61400000012@squadroom.invalid')  // another U8 parent

// Clean up anything a previous run left behind.
for (const p of [sam.id, other.id, coach.id]) {
  const { data: scans } = await admin.from('event_scans').select('id').eq('profile_id', p)
  for (const s of scans ?? []) await admin.from('events').delete().eq('source_scan_id', s.id)
  await admin.from('event_scans').delete().eq('profile_id', p)
}

async function newScan(who, { team = null, share = false } = {}) {
  const { data, error } = await who.client.from('event_scans')
    .insert({ academy_id: NRIFA, profile_id: who.id, storage_path: `${NRIFA}/${who.id}/test.jpg`,
              team_id: team, share })
    .select('id').single()
  if (error) throw new Error(error.message)
  return data.id
}

// Exactly what the model is asked to return: local wall-clock strings, and
// nothing resembling a timezone.
const SATURDAY = new Date(Date.now() + 6*864e5).toISOString().slice(0,10)
const READING = [
  { local_date: SATURDAY, local_time: '09:00', end_time: '10:00',
    title: 'U8 Blue vs Gladesville Ravens', opponent: 'Gladesville Ravens',
    venue: 'ELS Hall Park, Field 3', round: 'Round 14', type: 'match' },
  { local_date: SATURDAY, local_time: '19:30', end_time: '00:15',
    title: 'Night game vs Hornsby', opponent: 'Hornsby', venue: 'Pennant Hills Park', type: 'match' },
]

head('1. A parent scans their own draw')
const samScan = await newScan(sam)
const { data: made, error: me } = await sam.client.rpc('create_scanned_events',
  { p_scan: samScan, p_events: READING })
me ? bad(me.message) : made.length === 2
  ? ok(`${made.length} games created from one screenshot`)
  : bad(`expected 2, got ${made?.length}`)

head('2. The times are the club\'s times, not the server\'s')
const { data: mine } = await sam.client.from('events')
  .select('title, starts_at, ends_at, private_to, source, confirmed_at, team_id')
  .eq('source_scan_id', samScan).order('starts_at')
const morning = mine?.[0]
const sydney = new Date(morning.starts_at).toLocaleString('en-AU',
  { timeZone: 'Australia/Sydney', hour: 'numeric', minute: '2-digit', hour12: false })
sydney === '09:00' ? ok(`9:00 on screen is 9:00 in Sydney (${morning.starts_at})`)
                   : bad(`kick-off came out as ${sydney} Sydney time`)

head('3. A game finishing after midnight lands on the next day')
const night = mine?.[1]
const spanHours = (new Date(night.ends_at) - new Date(night.starts_at)) / 36e5
spanHours > 0 && spanHours < 6
  ? ok(`19:30 → 00:15 read as ${spanHours.toFixed(2)}h, not negative`)
  : bad(`night game spans ${spanHours}h`)

head('4. Nobody else at the academy can see it')
const { data: seen } = await other.client.from('events').select('id').eq('source_scan_id', samScan)
seen?.length === 0 ? ok('another parent in the same team sees none of it')
                   : bad(`another parent read ${seen?.length} of them`)
const { data: coachSeen } = await coach.client.from('events').select('id').eq('source_scan_id', samScan)
coachSeen?.length === 0 ? ok('nor does the coach — private means private')
                        : bad(`the coach read ${coachSeen?.length}`)

head('5. Nor in anyone else\'s subscribed calendar')
const { data: otherToken } = await other.client.rpc('my_calendar_token')
const { data: otherFeed } = await admin.rpc('calendar_feed_events', { p_token: otherToken })
otherFeed.some(e => made.includes(e.event_id))
  ? bad('a private game leaked into another parent\'s calendar feed')
  : ok('absent from the other parent\'s feed')
const { data: samToken } = await sam.client.rpc('my_calendar_token')
const { data: samFeed } = await admin.rpc('calendar_feed_events', { p_token: samToken })
made.every(id => samFeed.some(e => e.event_id === id))
  ? ok('present in their own') : bad('their own feed is missing them')

head('6. It reminds them, even though nobody else RSVPs to it')
const { data: rsvp } = await admin.from('event_rsvps').select('status')
  .eq('event_id', made[0]).eq('profile_id', sam.id).maybeSingle()
rsvp?.status === 'yes' ? ok('an RSVP of their own puts it in the reminder sweep')
                       : bad('no RSVP, so no reminder would ever fire')

head('7. It is marked as machine-read until a human says otherwise')
morning.source === 'screenshot' && morning.confirmed_at === null
  ? ok('source=screenshot, unconfirmed — the list badges it "Check this"')
  : bad(`source=${morning.source} confirmed_at=${morning.confirmed_at}`)
const { error: fixErr } = await sam.client.from('events')
  .update({ title: 'U8 Blue vs Gladesville', confirmed_at: new Date().toISOString() })
  .eq('id', made[0])
fixErr ? bad(`could not correct it: ${fixErr.message}`) : ok('and they can correct it themselves')

head('8. A parent asking to share with a team is quietly refused')
const parentShare = await newScan(sam, { team: U8, share: true })
const { data: shared } = await sam.client.rpc('create_scanned_events',
  { p_scan: parentShare, p_events: [READING[0]] })
const { data: sharedRow } = await admin.from('events')
  .select('team_id, private_to').eq('id', shared[0]).single()
sharedRow.team_id === null && sharedRow.private_to === sam.id
  ? ok('the flag was ignored and it stayed private to them')
  : bad(`a parent published to a team: team_id=${sharedRow.team_id}`)
const { data: otherSeesShared } = await other.client.from('events').select('id').eq('id', shared[0])
otherSeesShared?.length === 0 ? ok('and the other parent still cannot see it') : bad('it leaked')

head('9. A coach sharing with their team creates a real fixture')
const coachScan = await newScan(coach, { team: U8, share: true })
const { data: teamMade, error: te } = await coach.client.rpc('create_scanned_events',
  { p_scan: coachScan, p_events: [READING[0]] })
te ? bad(te.message) : ok('created')
const { data: teamRow } = await admin.from('events')
  .select('team_id, private_to').eq('id', teamMade[0]).single()
teamRow.team_id === U8 && teamRow.private_to === null
  ? ok('a team fixture, visible to the whole team') : bad('did not attach to the team')
const { data: parentSeesTeam } = await other.client.from('events').select('title').eq('id', teamMade[0])
parentSeesTeam?.length === 1 ? ok(`a parent in that team reads it: "${parentSeesTeam[0].title}"`)
                             : bad('the team cannot see their own fixture')

head('10. A scan belongs to one person')
const { error: stealErr } = await other.client.rpc('create_scanned_events',
  { p_scan: samScan, p_events: [READING[0]] })
stealErr ? ok(`someone else\'s scan is refused: ${stealErr.message}`)
         : bad('another member wrote events off a scan that was not theirs')
const { data: stealRead } = await other.client.from('event_scans').select('id').eq('id', samScan)
stealRead?.length === 0 ? ok('and they cannot even read the row') : bad('event_scans is readable by others')

head('11. Ordinary fixtures are untouched by any of this')
const { data: normal } = await other.client.rpc('my_upcoming_events', { p_academy: NRIFA, p_days: 60 })
normal?.length > 0 ? ok(`the other parent still sees ${normal.length} of their own events`)
                   : bad('the new filter hid everything')

// Leave the database as it was found.
for (const scan of [samScan, parentShare, coachScan]) {
  await admin.from('events').delete().eq('source_scan_id', scan)
  await admin.from('event_scans').delete().eq('id', scan)
}
console.log('\ncleaned up\n')
