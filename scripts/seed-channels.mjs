/**
 * Fills the channels that were empty.
 *
 * A demo dies the moment somebody taps a room and finds nothing in it. Every
 * channel a coach would open during a walkthrough needs to look like a place
 * where things get said — and each kind of channel gets said-to differently.
 * An age-group channel is coordinators talking about the grade; the coaches
 * room is the bit parents never see; the academy channel is the club talking
 * to everyone at once.
 *
 * Idempotent: only touches channels that have no messages.
 */
import { createClient } from '@supabase/supabase-js'

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const day = 864e5
const say = (m) => console.log('  ' + m)

const { data: people } = await admin
  .from('academy_members')
  // No join to profiles: academy_members has two foreign keys to it
  // (the member, and whoever invited them), so PostgREST cannot guess which
  // one is meant. Names are not needed here anyway.
  .select('profile_id, role')
  .eq('academy_id', NRIFA)
  .eq('status', 'active')

const staff = people.filter((p) => p.role === 'owner' || p.role === 'admin' || p.role === 'coach')
const parents = people.filter((p) => p.role === 'parent')
const coach = staff[0]?.profile_id ?? people[0].profile_id
const parentAt = (n) => parents[n % parents.length]?.profile_id ?? coach

// One script per kind of room, because they genuinely sound different.
const SCRIPTS = {
  coaches: [
    [coach, 'Grading is done for U8s and U10s. Lists are in the shared folder — have a look before Tuesday and tell me if anything looks wrong.', 6],
    [coach, 'Reminder we are two balls short in the U10 kit bag. If anyone has spares in their car boot, now is the time.', 4.5],
    [coach, 'Can anyone cover Thursday 5pm? I have a parent meeting until 6.', 2],
    [coach, 'Sorted — Marcus is covering. Thanks.', 1.6],
    [coach, 'Association have confirmed no games on the long weekend. I will put it in the parent channels tomorrow unless anyone objects.', 0.4],
  ],
  age_group: [
    [coach, 'Grading sessions for this age group are the next two Tuesdays, 5pm, Christie Park. Everyone attends both if they can.', 7],
    [parentAt(0), 'Is grading compulsory? We are away the first week.', 6.4],
    [coach, 'Not compulsory — one session is enough, just let your coach know which.', 6.2],
    [coach, 'Draw for the first four rounds is out. Your team channel has your own fixtures.', 3],
    [parentAt(3), 'Thanks Joey 👍', 2.8],
  ],
  academy_wide: [
    [coach, 'Registrations for the summer program open Monday. Places are capped at 60 across all age groups.', 6],
    [coach, 'Reminder that the canteen is card only this season.', 4],
    [coach, 'Working bee at Christie Park this Sunday 8am — bring gloves if you have them. Many hands etc.', 2],
    [coach, 'Presentation day is Sunday 12 October, Magdala Park, 11am. All age groups, every player gets a trophy.', 0.6],
  ],
  team: [
    [coach, 'Welcome everyone. Training is Tuesdays 5pm at Christie Park, and I will post each week’s fixture here as soon as the draw lands.', 7],
    [parentAt(1), 'Thanks! Looking forward to it.', 6.6],
    [coach, 'Kit is navy this week. Shin pads are compulsory — the ref is checking.', 3.2],
    [parentAt(2), 'Are we able to get a second set of bibs for training?', 2.1],
    [coach, 'Ordering them this week.', 1.9],
  ],
}

const { data: channels } = await admin
  .from('channels')
  .select('id, name, type, academy_id')
  .eq('academy_id', NRIFA)

let filled = 0
const now = Date.now()

for (const c of channels) {
  if (c.type === 'direct') continue
  const { count } = await admin
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('channel_id', c.id)
  if (count > 0) continue

  const script = SCRIPTS[c.type] ?? SCRIPTS.team
  for (const [sender, body, daysAgo] of script) {
    // Everyone speaking has to be in the room, or the message is invisible
    // to the very people the demo is showing it to.
    await admin.from('channel_members').upsert(
      { channel_id: c.id, academy_id: NRIFA, profile_id: sender, role: 'member' },
      { onConflict: 'channel_id,profile_id' }
    )
    await admin.from('messages').insert({
      academy_id: NRIFA,
      channel_id: c.id,
      sender_id: sender,
      body,
      created_at: new Date(now - daysAgo * day).toISOString(),
    })
  }
  filled++
  say(`${c.name ?? c.type} — ${script.length} messages`)
}

console.log(`\n${filled} empty channels filled\n`)
