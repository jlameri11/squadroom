// Run: node --env-file=.env.local scripts/test-recurring.mjs
//
// Proves 0090: a series creates real sessions at the academy's own clock.
//
// The assertion that matters most is the daylight-saving one. Sydney moves its
// clocks in April and October, and a series built by adding 7 × 24 hours to a
// UTC instant keeps the UTC time constant — so training silently moves from
// 5pm to 4pm halfway through the season, and twenty families turn up an hour
// late once. Building each occurrence from a DATE and a LOCAL TIME is what
// stops that, and nothing else in the schema would catch it.
import { createClient } from '@supabase/supabase-js'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})
const anon = createClient(URL_, PUB, { auth: { persistSession: false } })

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`)
  process.exitCode = 1
}
const head = (m) => console.log(`\n${m}`)

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const U8 = '00000000-0000-0000-0000-0000000d0008'
const SYDNEY = 'Australia/Sydney'
const TITLE = 'TESTSERIES Training'

async function sess(email) {
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  const { data: s } = await anon.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: 'email',
  })
  if (!s?.session) {
    console.log(`  could not sign in ${email} — the project's auth rate limit, not a failure`)
    process.exit(1)
  }
  return {
    client: createClient(URL_, PUB, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${s.session.access_token}` } },
    }),
    id: s.user.id,
  }
}

const coach = await sess('joeylameri@outlook.com')
const parent = await sess('p61400000011@squadroom.invalid')

async function clean() {
  const { data: series } = await admin
    .from('event_series')
    .select('id')
    .eq('academy_id', NRIFA)
    .like('title', 'TESTSERIES%')
  for (const s of series ?? []) {
    const { data: evs } = await admin.from('events').select('id').eq('series_id', s.id)
    for (const e of evs ?? []) {
      await admin.from('event_rsvps').delete().eq('event_id', e.id)
      await admin.from('notification_queue').delete().eq('payload->>event_id', e.id)
    }
    await admin.from('events').delete().eq('series_id', s.id)
    await admin.from('event_series').delete().eq('id', s.id)
  }
  await admin.from('events').delete().eq('academy_id', NRIFA).like('title', 'TESTSERIES%')
}
await clean()

const clock = (iso) =>
  new Date(iso).toLocaleTimeString('en-AU', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: SYDNEY,
  })
const dayName = (iso) =>
  new Date(iso).toLocaleDateString('en-AU', { weekday: 'long', timeZone: SYDNEY })

head('1. A parent cannot schedule anything')
const { error: parentError } = await parent.client.rpc('create_event_series', {
  p_academy: NRIFA,
  p_title: TITLE,
  p_days: [2],
  p_time: '17:00',
  p_from: '2027-02-02',
  p_until: '2027-03-30',
})
parentError ? ok('refused') : bad('a parent created a training series')

head('2. Tuesdays and Thursdays, one decision')
const { data: made, error: makeError } = await coach.client.rpc('create_event_series', {
  p_academy: NRIFA,
  p_title: TITLE,
  p_team: U8,
  p_days: [2, 4],
  p_time: '17:00',
  p_duration: 75,
  p_arrive: 15,
  p_from: '2027-02-02',
  p_until: '2027-03-30',
  p_venue: 'ELS Hall Park',
})
if (makeError) {
  bad(makeError.message)
  process.exit(1)
}
ok(`${made.created} sessions created`)

const { data: sessions } = await admin
  .from('events')
  .select('starts_at, ends_at, arrive_at, title, team_id, type, series_id')
  .eq('series_id', made.series_id)
  .order('starts_at')

const days = new Set(sessions.map((s) => dayName(s.starts_at)))
days.size === 2 && days.has('Tuesday') && days.has('Thursday')
  ? ok('every session is a Tuesday or a Thursday')
  : bad(`landed on ${[...days].join(', ')}`)

const times = new Set(sessions.map((s) => clock(s.starts_at)))
times.size === 1 && times.has('17:00')
  ? ok(`all ${sessions.length} at 17:00 in Sydney`)
  : bad(`times drifted: ${[...times].join(', ')}`)

const span = (new Date(sessions[0].ends_at) - new Date(sessions[0].starts_at)) / 60000
span === 75 ? ok('75 minutes long') : bad(`${span} minutes`)
const lead = (new Date(sessions[0].starts_at) - new Date(sessions[0].arrive_at)) / 60000
lead === 15 ? ok('arrive-by is 15 minutes before, and moves with it') : bad(`lead time ${lead}`)
sessions.every((s) => s.team_id === U8 && s.type === 'training')
  ? ok('all tagged to the U8s as training')
  : bad('team or type is wrong on some sessions')

head('3. Daylight saving does not move training')
// Sydney puts clocks BACK on the first Sunday in April. A series built by
// adding 7 × 24 hours to a UTC instant holds UTC constant and so slides to
// 16:00 local — twenty families an hour late, once.
const { data: dst, error: dstError } = await coach.client.rpc('create_event_series', {
  p_academy: NRIFA,
  p_title: `${TITLE} across April`,
  p_days: [2],
  p_time: '17:00',
  p_from: '2027-03-23',
  p_until: '2027-04-20',
})
if (dstError) {
  bad(dstError.message)
} else {
  const { data: across } = await admin
    .from('events')
    .select('starts_at')
    .eq('series_id', dst.series_id)
    .order('starts_at')
  const localTimes = new Set(across.map((s) => clock(s.starts_at)))
  const utcHours = new Set(across.map((s) => new Date(s.starts_at).getUTCHours()))

  localTimes.size === 1 && localTimes.has('17:00')
    ? ok(`${across.length} Tuesdays either side of the change, all 17:00 local`)
    : bad(`local time drifted to ${[...localTimes].join(', ')}`)
  // The proof it is doing the right thing rather than getting lucky: the UTC
  // hour MUST change across the boundary.
  utcHours.size === 2
    ? ok(`and the UTC hour shifts (${[...utcHours].sort().join(' → ')}), which is the point`)
    : bad(`UTC hour never changed (${[...utcHours].join(',')}) — the local time is being faked`)
}

head('4. A typo in the end date is refused, not half-applied')
const { error: tooMany } = await coach.client.rpc('create_event_series', {
  p_academy: NRIFA,
  p_title: `${TITLE} decade`,
  p_days: [1, 2, 3, 4, 5],
  p_time: '17:00',
  p_from: '2027-01-01',
  p_until: '2037-01-01',
})
tooMany ? ok(`refused: "${tooMany.message.slice(0, 55)}…"`) : bad('created a decade of sessions')

const { error: noneFall } = await coach.client.rpc('create_event_series', {
  p_academy: NRIFA,
  p_title: `${TITLE} impossible`,
  p_days: [0],
  p_time: '17:00',
  p_from: '2027-02-01',
  p_until: '2027-02-05',
})
noneFall ? ok('a window with no matching day is refused') : bad('created an empty series')

const { count: leftovers } = await admin
  .from('event_series')
  .select('id', { count: 'exact', head: true })
  .eq('academy_id', NRIFA)
  .like('title', '%decade%')
leftovers === 0 ? ok('and nothing was left behind') : bad(`${leftovers} orphan series rows`)

head('5. Sessions behave like every other event')
// The whole reason for materialising rather than expanding a rule at read
// time: RSVPs, the calendar feed and the reminders all work untouched.
const first = sessions[0]
const { data: firstRow } = await admin
  .from('events')
  .select('id')
  .eq('series_id', made.series_id)
  .order('starts_at')
  .limit(1)
  .single()

const { data: kids } = await admin
  .from('player_guardians')
  .select('player_id')
  .eq('profile_id', parent.id)
  .limit(1)
  .maybeSingle()

if (kids) {
  const { error: rsvpError } = await parent.client.from('event_rsvps').insert({
    academy_id: NRIFA,
    event_id: firstRow.id,
    profile_id: parent.id,
    player_id: kids.player_id,
    status: 'yes',
  })
  rsvpError
    ? bad(`a parent could not RSVP to a session: ${rsvpError.message}`)
    : ok('a parent can RSVP to one session')
}

const { data: upcoming } = await parent.client.rpc('my_upcoming_events', {
  p_academy: NRIFA,
  p_days: 1000,
})
;(upcoming ?? []).some((e) => e.title === TITLE)
  ? ok('and the sessions appear in their fixture list')
  : bad('the sessions are invisible to the family')

head('6. Ending a series stops the future and keeps the past')
const { data: ended, error: endError } = await coach.client.rpc('end_event_series', {
  p_series: made.series_id,
  p_reason: 'TESTSERIES wrapped up',
})
if (endError) {
  bad(endError.message)
} else {
  ok(`${ended.affected} future sessions called off`)
  const { data: after } = await admin
    .from('events')
    .select('starts_at, cancelled_at, cancellation_reason, cancellation_note')
    .eq('series_id', made.series_id)
    .order('starts_at')
  const future = after.filter((e) => new Date(e.starts_at) > new Date())
  future.every((e) => e.cancelled_at)
    ? ok('every future session carries a cancellation')
    : bad(`${future.filter((e) => !e.cancelled_at).length} future sessions still live`)
  // 'other' from 0064's fixed set, with the sentence in the note beside it —
  // ending a series is not wet weather, a forfeit or a ground closure, and
  // claiming one would put the wrong words in a push notification.
  future.every((e) => e.cancellation_reason === 'other')
    ? ok("categorised as 'other', not as wet weather")
    : bad(`reason was ${future[0]?.cancellation_reason}`)
  future.every((e) => e.cancellation_note === 'TESTSERIES wrapped up')
    ? ok('with the coach’s own sentence, which is what a family reads')
    : bad(`note was ${JSON.stringify(future[0]?.cancellation_note)}`)
}

head('7. Deleting never eats an answer somebody gave')
const { data: dropped } = await coach.client.rpc('end_event_series', {
  p_series: made.series_id,
  p_delete: true,
})
if (kids && dropped) {
  dropped.kept_because_answered >= 0
    ? ok(`${dropped.affected} removed, ${dropped.kept_because_answered} kept because a family had answered`)
    : bad(JSON.stringify(dropped))
  const { data: survivor } = await admin
    .from('events')
    .select('id')
    .eq('id', firstRow.id)
    .maybeSingle()
  // The one we RSVP'd to is in the past relative to the cut, or answered —
  // either way it must still exist.
  survivor ? ok('the answered session is still there') : bad('a session with an RSVP was deleted')
}

head('8. Another academy sees none of it')
const { data: ravens } = await admin
  .from('academy_members')
  .select('profile_id')
  .eq('academy_id', '00000000-0000-0000-0000-0000000a0002')
  .eq('status', 'active')
  .limit(1)
  .maybeSingle()
if (ravens) {
  const { data: u } = await admin.auth.admin.getUserById(ravens.profile_id)
  if (u?.user?.email) {
    const outsider = await sess(u.user.email)
    const { data: seen } = await outsider.client
      .from('event_series')
      .select('id')
      .eq('academy_id', NRIFA)
    seen?.length === 0 ? ok('event_series: nothing') : bad(`${seen?.length} series leaked`)
    const { error: hijack } = await outsider.client.rpc('create_event_series', {
      p_academy: NRIFA,
      p_title: 'TESTSERIES hijack',
      p_days: [2],
      p_time: '17:00',
      p_from: '2027-02-02',
      p_until: '2027-02-09',
    })
    hijack ? ok("and cannot schedule into another academy") : bad('an outsider scheduled training')
  }
}

await clean()
console.log(
  process.exitCode
    ? '\n\x1b[31mRECURRING SESSIONS BROKEN\x1b[0m\n'
    : '\n\x1b[32mRECURRING SESSIONS HOLD\x1b[0m\n'
)
process.exit(process.exitCode ?? 0)
