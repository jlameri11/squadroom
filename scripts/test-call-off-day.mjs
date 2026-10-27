// Run: node --env-file=.env.local scripts/test-call-off-day.mjs
//
// Proves 0101 (X-13): calling off a whole morning.
//
// Three things here would do real damage if they were wrong, so they are what
// this leans on:
//
//   · It must not touch a session that has already STARTED. Cancelling a game
//     at half time sends "it's off" to families who are standing at the
//     ground watching it.
//   · A second press must notify nobody twice. A coach who is not sure it
//     worked WILL press it again, and three hundred families getting the same
//     cancellation twice is how an app gets muted.
//   · The day must be the ACADEMY'S day. A Saturday in Sydney begins eleven
//     hours before a Saturday in UTC, and getting that wrong calls off Friday
//     evening training while leaving Saturday afternoon running.
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
const TAG = 'TESTOFF'
const SYDNEY = 'Australia/Sydney'

async function sess(email) {
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  // generateLink is rate limited per project as well as verifyOtp, and
  // returns null when it trips — so the property read below throws
  // before any session check runs, and the runner reports a crash
  // that is really the auth budget.
  if (!link?.properties?.hashed_token) {
    console.log(`  could not issue a link for ${email} — the project's auth rate limit, not a failure`)
    process.exit(2)
  }
  const { data: s } = await anon.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: 'email',
  })
  if (!s?.session) {
    console.log(`  could not sign in ${email} — the project's auth rate limit, not a failure`)
    process.exit(2)
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
  const { data: evs } = await admin
    .from('events')
    .select('id')
    .eq('academy_id', NRIFA)
    .like('title', `${TAG}%`)
  for (const e of evs ?? []) {
    await admin.from('notification_queue').delete().eq('payload->>event_id', e.id)
    await admin.from('event_rsvps').delete().eq('event_id', e.id)
  }
  await admin.from('events').delete().eq('academy_id', NRIFA).like('title', `${TAG}%`)
  await admin.from('teams').delete().eq('academy_id', NRIFA).like('name', `${TAG}%`)
}
await clean()

const { data: team } = await admin
  .from('teams')
  .insert({ academy_id: NRIFA, name: `${TAG} Squad`, age_group: 'U11', season: 'TESTOFF' })
  .select('id')
  .single()

/**
 * A Saturday a fortnight out, as the academy's own calendar date.
 *
 * Derived in Sydney rather than from the server's clock, because that is what
 * the function is asked for and the two are a different day for eleven hours
 * of every evening.
 */
const sydneyToday = new Date(
  new Date().toLocaleString('en-US', { timeZone: SYDNEY })
)
const saturday = new Date(sydneyToday)
saturday.setDate(saturday.getDate() + ((6 - saturday.getDay() + 7) % 7 || 7) + 7)
const DAY = saturday.toISOString().slice(0, 10)

/** An event at a local Sydney time on the chosen day. */
async function makeEvent(title, hour, venue, extra = {}) {
  const at = new Date(`${DAY}T${String(hour).padStart(2, '0')}:00:00+11:00`)
  const { data, error } = await admin
    .from('events')
    .insert({
      academy_id: NRIFA,
      team_id: team.id,
      type: 'match',
      title: `${TAG} ${title}`,
      starts_at: at.toISOString(),
      ends_at: new Date(at.getTime() + 3600e3).toISOString(),
      venue,
      source: 'manual',
      ...extra,
    })
    .select('id')
    .single()
  if (error) throw new Error(`${title}: ${error.message}`)
  return data.id
}

const elsEarly = await makeEvent('ELS 9am', 9, 'ELS Hall Park')
const elsField3 = await makeEvent('ELS Field 3 10am', 10, 'ELS Hall Park, Field 3')
const elsShort = await makeEvent('ELS Hall 11am', 11, 'ELS Hall')
const elsewhere = await makeEvent('Christie Park 9am', 9, 'Christie Park')
const alreadyOff = await makeEvent('Already off', 12, 'ELS Hall Park', {
  cancelled_at: new Date().toISOString(),
  cancellation_reason: 'forfeit',
})

head('1. A coach can see what is on before calling anything off')
{
  const { data, error } = await coach.client.rpc('whats_on', { p_academy: NRIFA, p_date: DAY })
  if (error) {
    bad(error.message)
  } else {
    const mine = (data ?? []).filter((e) => e.title.startsWith(TAG))
    mine.length === 5 ? ok(`${mine.length} sessions listed`) : bad(`${mine.length} listed, expected 5`)
    mine.some((e) => e.cancelled)
      ? ok('including the one already off, flagged as such')
      : bad('the already-cancelled session is not flagged')
    mine.every((e) => e.venue)
      ? ok('each with its venue, so the list can be checked')
      : bad('a session has no venue')
  }
  const { data: asParent } = await parent.client.rpc('whats_on', { p_academy: NRIFA, p_date: DAY })
  ;(asParent ?? []).length === 0
    ? ok('and a parent gets nothing — this is a coach\'s tool')
    : bad(`a parent read ${asParent.length} rows`)
}

head('2. A parent cannot call off a day')
{
  const { error } = await parent.client.rpc('call_off_day', {
    p_academy: NRIFA,
    p_date: DAY,
    p_reason: 'wet_weather',
  })
  error ? ok('refused') : bad('a parent called off the morning')
}

head('3. One venue, loosely matched, because the venue is free text')
{
  const { data, error } = await coach.client.rpc('call_off_day', {
    p_academy: NRIFA,
    p_date: DAY,
    p_reason: 'ground_closed',
    p_note: 'Ground closed — council called it at 6:40',
    p_venue: 'ELS Hall',
  })
  if (error) {
    bad(error.message)
  } else {
    // All three spellings of the same ground, and not the one already off.
    data.affected === 3
      ? ok(`${data.affected} called off: "ELS Hall Park", "ELS Hall Park, Field 3" and "ELS Hall"`)
      : bad(`${data.affected} affected, expected 3`)

    const { data: after } = await admin
      .from('events')
      .select('id, title, cancelled_at, cancellation_reason, cancellation_note')
      .in('id', [elsEarly, elsField3, elsShort, elsewhere])

    const off = after.filter((e) => e.cancelled_at)
    off.length === 3 ? ok('three off') : bad(`${off.length} off`)

    after.find((e) => e.id === elsewhere)?.cancelled_at
      ? bad('Christie Park was called off too — the venue filter did nothing')
      : ok('and Christie Park is untouched, a different ground entirely')

    off.every((e) => e.cancellation_reason === 'ground_closed')
      ? ok('reason is ground_closed, which is what the notification says')
      : bad('the reason did not stick')
    off.every((e) => e.cancellation_note?.includes('6:40'))
      ? ok("and the coach's own sentence travels with it")
      : bad('the note was lost')
  }
}

head('4. Pressing it twice notifies nobody twice')
{
  // A coach who is not sure it worked WILL press it again.
  const { data } = await coach.client.rpc('call_off_day', {
    p_academy: NRIFA,
    p_date: DAY,
    p_reason: 'ground_closed',
    p_venue: 'ELS Hall',
  })
  data.affected === 0
    ? ok('second press affects nothing')
    : bad(`${data.affected} were cancelled again — families would be told twice`)
}

head('5. It never touches a session already under way')
{
  // Cancelling a game at half time tells families who are watching it.
  const started = await makeEvent('Started an hour ago', 9, 'ELS Hall Park', {
    starts_at: new Date(Date.now() - 3600e3).toISOString(),
    ends_at: new Date(Date.now() + 1800e3).toISOString(),
  })
  const startedDay = new Date(
    new Date(Date.now() - 3600e3).toLocaleString('en-US', { timeZone: SYDNEY })
  )
    .toISOString()
    .slice(0, 10)

  const { data } = await coach.client.rpc('call_off_day', {
    p_academy: NRIFA,
    p_date: startedDay,
    p_reason: 'wet_weather',
    p_venue: 'ELS Hall',
  })
  const { data: row } = await admin
    .from('events')
    .select('cancelled_at')
    .eq('id', started)
    .single()
  row.cancelled_at
    ? bad('a session that had already started was called off')
    : ok(`left alone (${data.affected} others affected)`)
}

head('6. The day is the academy’s day, not UTC’s')
{
  // Sydney is UTC+11, so it is the EARLY MORNING that falls on the previous
  // UTC day: a 9am Saturday kick-off in Sydney is Friday 22:00 in UTC. That
  // is the exact bug CLAUDE.md warns about — "a local midnight in Sydney
  // becomes the previous day in UTC, which moves every Saturday game to
  // Friday" — and my first version of this assertion used a 10pm session,
  // where the two dates agree, so it proved nothing and passed.
  const early = await makeEvent('Early kick-off', 8, 'Dawn Oval')
  const { data: row } = await admin
    .from('events')
    .select('starts_at')
    .eq('id', early)
    .single()
  const utcDay = row.starts_at.slice(0, 10)
  const sydneyDay = new Date(row.starts_at).toLocaleDateString('en-CA', { timeZone: SYDNEY })

  if (utcDay === sydneyDay) {
    bad(`8am Sydney should be the previous UTC day; got ${utcDay} both ways`)
  } else {
    ok(`an 8am Sydney kick-off is ${sydneyDay} locally and ${utcDay} in UTC`)

    // Asking for the UTC date must NOT reach it — that date is a different
    // day to everyone who plays football in Sydney.
    const { data: byUtc } = await coach.client.rpc('call_off_day', {
      p_academy: NRIFA,
      p_date: utcDay,
      p_reason: 'wet_weather',
      p_venue: 'Dawn Oval',
    })
    const { data: afterUtc } = await admin
      .from('events')
      .select('cancelled_at')
      .eq('id', early)
      .single()
    afterUtc.cancelled_at
      ? bad(`the UTC date reached it (${byUtc.affected} affected) — the day is read in the wrong zone`)
      : ok('the UTC date does not reach it')

    // And the Sydney date must.
    const { data: bySydney } = await coach.client.rpc('call_off_day', {
      p_academy: NRIFA,
      p_date: sydneyDay,
      p_reason: 'wet_weather',
      p_venue: 'Dawn Oval',
    })
    const { data: afterSydney } = await admin
      .from('events')
      .select('cancelled_at')
      .eq('id', early)
      .single()
    afterSydney.cancelled_at && bySydney.affected === 1
      ? ok('the Sydney date does — one session, the right one')
      : bad(`the Sydney date affected ${bySydney.affected} and cancelled=${Boolean(afterSydney.cancelled_at)}`)
  }
}

head('7. Everything on the day, when no venue is given')
{
  const { data } = await coach.client.rpc('call_off_day', {
    p_academy: NRIFA,
    p_date: DAY,
    p_reason: 'wet_weather',
    p_note: 'Everything off',
  })
  const { data: left } = await admin
    .from('events')
    .select('id')
    .eq('academy_id', NRIFA)
    .like('title', `${TAG}%`)
    .is('cancelled_at', null)
    .gt('starts_at', new Date().toISOString())
  left?.length === 0
    ? ok(`${data.affected} more called off; nothing future is left standing`)
    : bad(`${left.length} future sessions still live`)
}

head('8. An unknown reason is refused')
{
  const { error } = await coach.client.rpc('call_off_day', {
    p_academy: NRIFA,
    p_date: DAY,
    p_reason: 'because I said so',
  })
  error ? ok('refused — the reason is a fixed set the notification depends on') : bad('accepted free text as a reason')
}

head('9. An outsider cannot call off another academy’s morning')
{
  const { data: ravens } = await admin
    .from('academy_members')
    .select('profile_id')
    .eq('academy_id', '00000000-0000-0000-0000-0000000a0002')
    .eq('status', 'active')
    .limit(1)
    .single()
  const { data: u } = await admin.auth.admin.getUserById(ravens.profile_id)
  const outsider = await sess(u.user.email)
  const { error } = await outsider.client.rpc('call_off_day', {
    p_academy: NRIFA,
    p_date: DAY,
    p_reason: 'wet_weather',
  })
  error ? ok('refused') : bad("an outsider called off another academy's morning")
}

await clean()
console.log(
  process.exitCode
    ? '\n\x1b[31mCALL OFF BROKEN\x1b[0m\n'
    : '\n\x1b[32mA morning goes off in one tap, once, and only ahead of itself.\x1b[0m\n'
)
process.exit(process.exitCode ?? 0)
