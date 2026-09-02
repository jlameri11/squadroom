/**
 * Fills the demo academy out into something you can actually use.
 *
 * A chat app with three messages in it cannot be judged, and neither can an
 * RSVP screen where nobody has answered. This makes NRIFA's U8 SPL team look
 * like a real team mid-season: a full squad with parents, a season of
 * fixtures behind and ahead, conversation with replies and reactions, and
 * enough RSVPs that the tallies mean something.
 *
 * Idempotent — safe to run again. Everything it creates is tagged so it can
 * find and replace its own work rather than duplicating it.
 */
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const U8 = '00000000-0000-0000-0000-0000000d0008'
const say = (m) => console.log('  ' + m)

// --- families -------------------------------------------------------------
const FAMILIES = [
  ['Sarah Whitfield', '0412000101', ['Leo Whitfield']],
  ['Daniel Okafor', '0412000102', ['Ada Okafor']],
  ['Priya Nair', '0412000103', ['Arjun Nair', 'Meera Nair']],
  ['Tom Bradley', '0412000104', ['Charlie Bradley']],
  ['Elena Rossi', '0412000105', ['Matteo Rossi']],
  ['James Chen', '0412000106', ['Oliver Chen']],
  ['Aisha Rahman', '0412000107', ['Zayn Rahman']],
  ['Marcus Deng', '0412000108', ['Kai Deng']],
  ['Holly Fraser', '0412000109', ['Ruby Fraser']],
  ['Nikos Pappas', '0412000110', ['Dimitri Pappas']],
  ['Rachel Kim', '0412000111', ['Sena Kim']],
  ['Ben Turner', '0412000112', ['Alfie Turner']],
]

const OPPONENTS = [
  'Gladesville Ravens', 'Hornsby Heat', 'Epping Eagles', 'Pennant Hills Panthers',
  'Beecroft Bulls', 'Carlingford Cobras', 'Thornleigh Thunder', 'Normanhurst Nomads',
]
const GROUNDS = [
  'ELS Hall Park, Field 3', 'Pennant Hills Park, Field 1', 'Christie Park, Field 2',
  'Somerset Reserve, Field 4', 'Magdala Park, Field 1',
]

async function upsertFamily([name, phone, kids]) {
  const email = `demo${phone}@squadroom.invalid`
  const { data: existing } = await admin.auth.admin.listUsers()
  let user = existing.users.find((u) => u.email === email)
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email, email_confirm: true, user_metadata: { full_name: name },
    })
    if (error) throw new Error(`${name}: ${error.message}`)
    user = data.user
  }

  await admin.from('profiles').upsert(
    { id: user.id, full_name: name, phone: '+61' + phone.slice(1) },
    { onConflict: 'id' }
  )
  await admin.from('academy_members').upsert(
    { academy_id: NRIFA, profile_id: user.id, role: 'parent', status: 'active' },
    { onConflict: 'academy_id,profile_id' }
  )
  await admin.from('team_members').upsert(
    { academy_id: NRIFA, team_id: U8, profile_id: user.id, role: 'parent' },
    { onConflict: 'team_id,profile_id' }
  )

  const playerIds = []
  for (const kid of kids) {
    const { data: found } = await admin.from('players').select('id')
      .eq('academy_id', NRIFA).eq('team_id', U8).eq('full_name', kid).maybeSingle()
    let pid = found?.id
    if (!pid) {
      const { data, error } = await admin.from('players')
        .insert({ academy_id: NRIFA, team_id: U8, full_name: kid })
        .select('id').single()
      if (error) throw new Error(`${kid}: ${error.message}`)
      pid = data.id
    }
    await admin.from('player_guardians').upsert(
      { player_id: pid, profile_id: user.id }, { onConflict: 'player_id,profile_id' }
    )
    playerIds.push(pid)
  }
  return { id: user.id, name, playerIds }
}

console.log('\nSeeding a season for NRIFA U8 SPL\n')

const parents = []
for (const f of FAMILIES) parents.push(await upsertFamily(f))
say(`${parents.length} families, ${parents.flatMap((p) => p.playerIds).length} players`)

// Everyone joins the team channel, or they see nothing.
const { data: channel } = await admin.from('channels').select('id')
  .eq('team_id', U8).eq('type', 'team').single()
for (const p of parents) {
  await admin.from('channel_members').upsert(
    { channel_id: channel.id, academy_id: NRIFA, profile_id: p.id, role: 'member' },
    { onConflict: 'channel_id,profile_id' }
  )
}
say(`all in the team channel`)

// --- a season of fixtures -------------------------------------------------
await admin.from('events').delete().eq('academy_id', NRIFA).like('title', 'Round %')

const day = 864e5
const saturday = (weeksFromNow) => {
  const d = new Date()
  d.setHours(9, 0, 0, 0)
  const untilSat = (6 - d.getDay() + 7) % 7
  return new Date(+d + (untilSat + weeksFromNow * 7) * day)
}

const fixtures = []
for (let i = 0; i < 12; i++) {
  const weeks = i - 6                                  // six behind, six ahead
  const start = saturday(weeks)
  start.setHours(9 + (i % 3), i % 2 ? 30 : 0, 0, 0)
  fixtures.push({
    academy_id: NRIFA, team_id: U8, type: 'match',
    title: `Round ${i + 8} vs ${OPPONENTS[i % OPPONENTS.length]}`,
    opponent: OPPONENTS[i % OPPONENTS.length],
    venue: GROUNDS[i % GROUNDS.length],
    round: `Round ${i + 8}`,
    kit_colour: i % 2 ? 'Navy' : 'White',
    starts_at: start.toISOString(),
    ends_at: new Date(+start + 3600e3).toISOString(),
    arrive_at: new Date(+start - 1800e3).toISOString(),
  })
}
// Training every Tuesday, four weeks out.
for (let i = 0; i < 4; i++) {
  const d = new Date()
  d.setHours(17, 0, 0, 0)
  const untilTue = (2 - d.getDay() + 7) % 7
  const start = new Date(+d + (untilTue + i * 7) * day)
  fixtures.push({
    academy_id: NRIFA, team_id: U8, type: 'training',
    title: 'Tuesday training', venue: 'Christie Park, Field 2',
    starts_at: start.toISOString(),
    ends_at: new Date(+start + 3600e3).toISOString(),
  })
}
const { data: madeEvents, error: evErr } = await admin.from('events').insert(fixtures).select('id, starts_at, title, type')
if (evErr) throw new Error(evErr.message)
say(`${madeEvents.length} events — 6 played, 6 to come, plus training`)

// --- RSVPs so the tallies mean something ---------------------------------
const upcoming = madeEvents.filter((e) => new Date(e.starts_at) > new Date())
let rsvpCount = 0
for (const e of upcoming.slice(0, 4)) {
  for (const p of parents) {
    for (const playerId of p.playerIds) {
      // Not everyone answers, which is the point — a coach needs to see who
      // has not.
      const r = Math.random()
      if (r > 0.82) continue
      const status = r > 0.68 ? 'maybe' : r > 0.58 ? 'no' : 'yes'
      await admin.from('event_rsvps').upsert(
        { academy_id: NRIFA, event_id: e.id, profile_id: p.id, player_id: playerId, status },
        { onConflict: 'event_id,profile_id,player_id' }
      )
      rsvpCount++
    }
  }
}
say(`${rsvpCount} RSVPs across the next four fixtures`)

console.log('\nDone.\n')

// --- conversation ---------------------------------------------------------
//
// Written as a real week in a junior football team, because that is what has
// to be judged: does this beat the WhatsApp group it replaces? Kit colours,
// lifts, a wet-weather scare and somebody's water bottle.

await admin.from('messages').delete().eq('channel_id', channel.id).eq('is_seed_demo', true)
  .then(() => {}, () => {})

const { data: coachProfile } = await admin.from('profiles')
  .select('id').eq('full_name', 'Joey Lameri').maybeSingle()
const coachId = coachProfile?.id ?? parents[0].id
const by = (n) => parents[n % parents.length].id

const nextMatch = upcoming.find((e) => e.type === 'match')

const THREAD = [
  [coachId, `Morning all. ${nextMatch ? nextMatch.title.replace('Round ', 'Round ') : 'This week'} — kit is NAVY, be at the ground 8:30 for a 9:00 kick-off.`, 5],
  [by(0), 'Thanks Joey. Leo will be there.', 4.8],
  [by(2), 'Both of mine are in. Is there parking at ELS Hall or should we use the side street?', 4.6],
  [coachId, 'Side street is easier, the main car park fills by 8:45.', 4.5],
  [by(4), 'Matteo has a birthday party at 11 — will we be done by 10:15?', 4.2],
  [coachId, 'Comfortably. Games are 2 x 20 with a short break.', 4.1],
  [by(6), 'Anyone near Beecroft able to take Zayn? I have to be at work by 8.', 3.6],
  [by(9), 'We can grab him, we go past at about 8:10.', 3.5],
  [by(6), 'Legend, thank you 🙏', 3.4],
  [coachId, 'Reminder: shin pads are compulsory, no exceptions from the ref this season.', 2.9],
  [by(3), 'Charlie left his water bottle at training — blue with a dinosaur on it. Anyone seen it?', 2.4],
  [by(8), 'It is in our car, will bring Saturday.', 2.2],
  [by(1), 'Ada is out this week, we are away for the long weekend.', 1.8],
  [coachId, 'No worries, thanks for letting me know.', 1.7],
  [by(10), 'What time is training Tuesday?', 1.2],
  [coachId, '5pm at Christie Park, Field 2. Same as always.', 1.1],
  [by(5), 'Is the ground still open after all this rain?', 0.5],
  [coachId, 'Checked this morning — all good. I will post here straight away if that changes.', 0.4],
]

const now = Date.now()
const inserted = []
for (const [sender, body, daysAgo] of THREAD) {
  const { data, error } = await admin.from('messages').insert({
    academy_id: NRIFA, channel_id: channel.id, sender_id: sender, body,
    created_at: new Date(now - daysAgo * day).toISOString(),
  }).select('id').single()
  if (error) throw new Error(error.message)
  inserted.push(data.id)
}
say(`${inserted.length} messages over the last five days`)

// A few reactions, so the chips are not all empty.
const EMOJI = ['👍', '⚽', '🙏', '😂']
let reacted = 0
for (const id of inserted.slice(0, 10)) {
  for (const p of parents.slice(0, 3 + Math.floor(Math.random() * 4))) {
    if (Math.random() > 0.55) continue
    await admin.from('message_reactions').upsert({
      academy_id: NRIFA, message_id: id, profile_id: p.id,
      emoji: EMOJI[Math.floor(Math.random() * EMOJI.length)],
    }, { onConflict: 'message_id,profile_id,emoji' })
    reacted++
  }
}
say(`${reacted} reactions`)

// The fixture card in the thread, which is the feature that makes this not a
// group chat.
if (nextMatch) {
  await admin.from('messages').insert({
    academy_id: NRIFA, channel_id: channel.id, sender_id: coachId,
    event_id: nextMatch.id, body: null,
    created_at: new Date(now - 0.3 * day).toISOString(),
  })
  say('posted the next fixture as a card in the thread')
}

// An announcement, so the pinned bar and the announcement bubble have
// something to show.
const { data: ann } = await admin.from('messages').insert({
  academy_id: NRIFA, channel_id: channel.id, sender_id: coachId,
  body: 'Presentation day is Sunday 12 October at Magdala Park, 11am. Every player gets a trophy — please let me know numbers for catering.',
  is_announcement: true,
  created_at: new Date(now - 0.2 * day).toISOString(),
}).select('id').single()
if (ann) {
  await admin.from('messages').update({ pinned_at: new Date().toISOString(), pinned_by: coachId }).eq('id', ann.id)
  say('one announcement, pinned')
}

// Something to pay for.
await admin.from('payment_requests').delete().eq('academy_id', NRIFA).eq('title', 'Spring Gala Day entry')
await admin.from('payment_requests').insert({
  academy_id: NRIFA, team_id: U8, title: 'Spring Gala Day entry',
  description: 'Covers referees, ground hire and a medal for every player.',
  amount_cents: 4500, due_on: new Date(now + 12 * day).toISOString().slice(0, 10),
  created_by: coachId,
})
say('a $45 gala day fee to collect')

// --- the academy-wide channel --------------------------------------------
// Empty channels make the chat list look broken. This is the one every
// family is in, so it is the first thing a new parent sees.
const { data: wide } = await admin.from('channels').select('id')
  .eq('academy_id', NRIFA).eq('type', 'academy_wide').maybeSingle()

if (wide) {
  const { count: already } = await admin.from('messages')
    .select('*', { count: 'exact', head: true }).eq('channel_id', wide.id)
  if (!already) {
    for (const p of parents) {
      await admin.from('channel_members').upsert(
        { channel_id: wide.id, academy_id: NRIFA, profile_id: p.id, role: 'member' },
        { onConflict: 'channel_id,profile_id' }
      )
    }
    const WIDE = [
      ['Registrations for the summer program open Monday. Places are capped at 60 across all age groups.', true, 6],
      ['Reminder that the canteen is card only this season.', false, 4],
      ['Working bee at Christie Park this Sunday 8am — bring gloves if you have them. Many hands etc.', false, 2],
      ['Presentation day is Sunday 12 October, Magdala Park, 11am. All age groups, every player gets a trophy.', true, 0.6],
    ]
    for (const [body, announcement, daysAgo] of WIDE) {
      await admin.from('messages').insert({
        academy_id: NRIFA, channel_id: wide.id, sender_id: coachId, body,
        is_announcement: announcement,
        created_at: new Date(now - daysAgo * day).toISOString(),
      })
    }
    say(`${WIDE.length} messages in the academy-wide channel`)
  }
}
