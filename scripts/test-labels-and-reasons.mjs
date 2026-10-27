// Run: node --env-file=.env.local scripts/test-labels-and-reasons.mjs
//
// Proves 0111 and 0112 — C-02 and E-02.
//
// C-02, WHO IS THIS PERSON. The assertion that carries the weight is not that
// the label appears, it is WHERE it does not: a team channel may name the
// children in that squad, because everyone in it can already read the roster;
// an academy-wide channel may name no child at all, because it holds families
// from every age group and a child's name is not academy-wide information
// just because their parent typed something.
//
// E-02, WHY CAN'T THEY PLAY. A reason is required on 'no' and on nothing
// else, and it must hold on every write path — three screens and two
// functions write an RSVP, and a rule in three places is a rule in none. So
// the poll conversion is tested here too, in the same file, because that is
// the path nobody would notice breaking.
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
const U8_TEAM = '00000000-0000-0000-0000-0000000d0008'
const U8_CHANNEL = 'af98a103-0629-460d-a7a0-062cf3ea3a0c' // 'U8 SPL' — a team channel
const WIDE_CHANNEL = '3135c786-e489-4c76-8a36-ed7833f26459' // 'Announcements' — academy-wide
const SAM = '00000000-0000-0000-0000-0000000000b1' // parent of Leo and Zoe, both U8
const LEO = '00000000-0000-0000-0000-0000000e0001'
const COACH = '00000000-0000-0000-0000-0000000000a1' // the U8 coach
const TAG = 'TESTLABEL'

async function sess(email) {
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
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
  const { data: msgs } = await admin.from('messages').select('id').like('body', `${TAG}%`)
  for (const m of msgs ?? []) {
    await admin.from('notification_queue').delete().eq('payload->>message_id', m.id)
  }
  await admin.from('messages').delete().like('body', `${TAG}%`)

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

  const { data: polls } = await admin
    .from('polls')
    .select('id')
    .eq('academy_id', NRIFA)
    .like('question', `${TAG}%`)
  for (const p of polls ?? []) {
    await admin.from('poll_votes').delete().eq('poll_id', p.id)
  }
  await admin.from('polls').delete().eq('academy_id', NRIFA).like('question', `${TAG}%`)
}
await clean()

// Posted with the service role rather than through the app, because posting
// modes are another feature's rule and this test is about the LABEL. What
// matters is the sender and the channel.
async function post(channel, sender, body) {
  const { data, error } = await admin
    .from('messages')
    .insert({ academy_id: NRIFA, channel_id: channel, sender_id: sender, body })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return data.id
}

async function labelsIn(channel) {
  const { data, error } = await coach.client.rpc('channel_messages', {
    p_channel: channel,
    p_limit: 100,
  })
  if (error) throw new Error(error.message)
  const mine = (data ?? []).filter((m) => (m.body ?? '').startsWith(TAG))
  return new Map(mine.map((m) => [m.sender_id, m.sender_label]))
}

head('1. A team channel says who someone is')
{
  await post(U8_CHANNEL, SAM, `${TAG} what time is the warm-up?`)
  await post(U8_CHANNEL, COACH, `${TAG} 8:30 at the far field.`)

  const labels = await labelsIn(U8_CHANNEL)

  const sam = labels.get(SAM)
  // "Leo & Zoe's parent". Both children are in this squad, the relationship is
  // the word the family typed, and the order is by full name.
  sam === "Leo & Zoe's parent"
    ? ok(`a parent of two reads "${sam}"`)
    : bad(`expected "Leo & Zoe's parent", got ${JSON.stringify(sam)}`)

  const c = labels.get(COACH)
  c === 'Coach'
    ? ok('the squad\'s coach reads "Coach"')
    : bad(`expected "Coach", got ${JSON.stringify(c)}`)
}

head('2. An academy-wide channel names no child')
{
  await post(WIDE_CHANNEL, SAM, `${TAG} is the canteen open Saturday?`)
  await post(WIDE_CHANNEL, COACH, `${TAG} yes, from 8.`)

  const labels = await labelsIn(WIDE_CHANNEL)

  // The whole point of the feature. Every child's first name in the academy,
  // checked against every label — not just Leo's, because a bug here would
  // leak whoever happened to be in the squad.
  const { data: kids } = await admin
    .from('players')
    .select('full_name, preferred_name')
    .eq('academy_id', NRIFA)
  const names = (kids ?? [])
    .map((k) => (k.preferred_name || k.full_name.split(' ')[0]).trim())
    .filter((n) => n.length > 2)

  const all = [...labels.values()].filter(Boolean).join(' | ')
  const leaked = names.filter((n) => new RegExp(`\\b${n}\\b`, 'i').test(all))
  leaked.length === 0
    ? ok(`no child named in an academy-wide label (${labels.size} checked: ${all || 'none'})`)
    : bad(`an academy-wide label named ${leaked.join(', ')} — "${all}"`)

  // A parent with no team gets no label rather than a wrong one, and staff are
  // still described by what they do.
  const c = labels.get(COACH)
  c === 'Coach' || c === 'Club admin'
    ? ok(`staff still read "${c}" academy-wide`)
    : bad(`expected a staff label academy-wide, got ${JSON.stringify(c)}`)
}

head('3. Somebody outside the channel is described to nobody')
{
  // channel_messages is already gated on membership, so this checks the gate
  // did not move when the function was rebuilt in 0111 — 0071 replaced this
  // same function and silently dropped a column for three weeks.
  const { data, error } = await parent.client.rpc('channel_messages', {
    p_channel: 'f1706f9a-6cba-4100-8bd7-075db3cf486e', // 'Coaches'
    p_limit: 10,
  })
  !error && (data ?? []).length === 0
    ? ok('a parent reads nothing from the coaches channel')
    : error
      ? ok(`a parent is refused the coaches channel (${error.code})`)
      : bad(`a parent read ${data.length} messages from the coaches channel`)
}

// ---------------------------------------------------------------------------

const { data: event, error: eventError } = await admin
  .from('events')
  .insert({
    academy_id: NRIFA,
    team_id: U8_TEAM,
    type: 'match',
    title: `${TAG} vs Gladesville`,
    starts_at: new Date(Date.now() + 3 * 864e5).toISOString(),
    ends_at: new Date(Date.now() + 3 * 864e5 + 3600e3).toISOString(),
    source: 'manual',
  })
  .select('id')
  .single()
if (eventError) {
  bad(eventError.message)
  process.exit(1)
}

const rsvp = (status, note) =>
  parent.client.from('event_rsvps').upsert(
    {
      academy_id: NRIFA,
      event_id: event.id,
      profile_id: parent.id,
      player_id: LEO,
      status,
      note: note ?? null,
    },
    { onConflict: 'event_id,profile_id,player_id' }
  )

const stored = async () => {
  const { data } = await admin
    .from('event_rsvps')
    .select('status, note')
    .eq('event_id', event.id)
    .eq('player_id', LEO)
    .maybeSingle()
  return data
}

head('4. "Out" needs a reason')
{
  const { error } = await rsvp('no')
  error
    ? ok(`a bare "no" is refused — "${error.message}"`)
    : bad('a "no" with no reason was accepted')

  const { error: blank } = await rsvp('no', '   ')
  blank
    ? ok('whitespace is not a reason')
    : bad('three spaces counted as a reason')

  const { error: given } = await rsvp('no', 'Away at a wedding')
  if (given) {
    bad(given.message)
  } else {
    const row = await stored()
    row?.note === 'Away at a wedding'
      ? ok('a reason is accepted and kept verbatim')
      : bad(`stored ${JSON.stringify(row)}`)
  }
}

head('5. Turning up needs no explanation')
{
  for (const s of ['yes', 'maybe']) {
    const { error } = await rsvp(s)
    error ? bad(`"${s}" was refused: ${error.message}`) : ok(`"${s}" saves with no reason`)
  }
}

head('6. Changing away from "out" does not leave the reason behind')
{
  await rsvp('no', 'Away at a wedding')
  // The client sends the whole row, so this is the ordinary path. The second
  // case is the one that matters: a note left untouched by an update.
  await rsvp('yes')
  const row = await stored()
  !row?.note
    ? ok('upserting "yes" drops the reason')
    : bad(`"yes" still carries "${row.note}"`)

  await rsvp('no', 'Injured')
  const { error } = await parent.client
    .from('event_rsvps')
    .update({ status: 'yes' })
    .eq('event_id', event.id)
    .eq('player_id', LEO)
  if (error) {
    bad(error.message)
  } else {
    const after = await stored()
    !after?.note
      ? ok('updating only the status clears the reason too')
      : bad(`"yes" sits next to "${after.note}" — a coach reads a stale reason`)
  }
}

head('6b. A note that is NOT about being absent survives (0116)')
{
  // 0113 cleared every note on anything but a 'no', which also threw away
  // "leaving at half time" on a maybe — a thing a parent types once and a
  // coach actually uses. test-polls caught it on an assertion written long
  // before any of this existed.
  await rsvp('maybe', 'Leaving at half time')
  const row = await stored()
  row?.note === 'Leaving at half time'
    ? ok('a note on "maybe" is kept')
    : bad(`stored ${JSON.stringify(row)}`)

  await rsvp('yes', 'Here for the morning games only')
  const y = await stored()
  y?.note === 'Here for the morning games only'
    ? ok('and on "yes"')
    : bad(`stored ${JSON.stringify(y)}`)

  // The distinction 0116 draws: cleared because it was about ABSENCE, not
  // because of what the new status is.
  await rsvp('no', 'Injured')
  const { error } = await parent.client
    .from('event_rsvps')
    .update({ status: 'maybe', note: 'Might make the second half' })
    .eq('event_id', event.id)
    .eq('player_id', LEO)
  if (error) {
    bad(error.message)
  } else {
    const after = await stored()
    after?.note === 'Might make the second half'
      ? ok('a new note supplied in the same write wins over clearing')
      : bad(`stored ${JSON.stringify(after)}`)
  }
}

head('7. Converting a poll still works (0112)')
{
  const { data: poll, error: pollError } = await admin
    .from('polls')
    .insert({
      academy_id: NRIFA,
      channel_id: U8_CHANNEL,
      created_by: COACH,
      question: `${TAG} available for the gala day?`,
      type: 'availability',
      options: [
        { id: 'yes', label: 'Going' },
        { id: 'maybe', label: 'Maybe' },
        { id: 'no', label: 'Out' },
      ],
    })
    .select('id')
    .single()
  if (pollError) {
    bad(pollError.message)
  } else {
    // A 'no' vote with no note at all — the case that broke the conversion.
    const { error: voteError } = await admin.from('poll_votes').insert({
      academy_id: NRIFA,
      poll_id: poll.id,
      profile_id: SAM,
      player_id: LEO,
      option_ids: ['no'],
    })
    if (voteError) {
      bad(voteError.message)
    } else {
      const { data: newEvent, error } = await coach.client.rpc('convert_poll_to_event', {
        p_poll: poll.id,
        p_title: `${TAG} Gala Day`,
        p_starts_at: new Date(Date.now() + 10 * 864e5).toISOString(),
      })
      if (error) {
        bad(`conversion failed: ${error.message}`)
      } else {
        ok('a poll with an unexplained "no" converts')
        const { data: carried } = await admin
          .from('event_rsvps')
          .select('status, note')
          .eq('event_id', newEvent)
          .eq('player_id', LEO)
          .maybeSingle()
        carried?.status === 'no' && carried?.note
          ? ok(`the reason says where it came from — "${carried.note}"`)
          : bad(`carried across as ${JSON.stringify(carried)}`)
      }
    }
  }
}

await clean()
console.log(
  process.exitCode ? '\n\x1b[31msome of this is wrong\x1b[0m' : '\n\x1b[32mall good\x1b[0m'
)
