/**
 * Puts the demo season back around today.
 *
 * Seeded data has a shelf life nobody thinks about. The fixtures were written
 * relative to the day they were created, so five weeks later 41 of 43 events
 * were in the past, a parent's home screen had nothing to RSVP to, and the
 * one thing most worth demonstrating — tapping Going for your kid — had
 * nothing to tap.
 *
 * Run this before showing the app to anyone. It is idempotent and it only
 * moves demo rows: real fixtures, imported draws and scanned games are left
 * exactly where they are.
 */
import { createClient } from '@supabase/supabase-js'

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const U8 = '00000000-0000-0000-0000-0000000d0008'
const day = 864e5
const say = (m) => console.log('  ' + m)

const OPPONENTS = [
  'Gladesville Ravens', 'Hornsby Heat', 'Epping Eagles', 'Pennant Hills Panthers',
  'Beecroft Bulls', 'Carlingford Cobras', 'Thornleigh Thunder', 'Normanhurst Nomads',
]
const GROUNDS = [
  'ELS Hall Park, Field 3', 'Pennant Hills Park, Field 1', 'Christie Park, Field 2',
  'Somerset Reserve, Field 4', 'Magdala Park, Field 1',
]

console.log('\nRefreshing the demo\n')

// --- families --------------------------------------------------------------
// Restored first, because everything else depends on them. A parent with no
// guardian link has no children, and therefore no RSVP buttons, no payment
// lines and nothing on the home screen worth showing — which is exactly how
// the demo was found: five weeks of test runs had quietly taken the
// player_guardians rows with them.
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

const { data: existingUsers } = await admin.auth.admin.listUsers()
let links = 0

for (const [name, phone, kids] of FAMILIES) {
  const email = `demo${phone}@squadroom.invalid`
  let user = existingUsers.users.find((u) => u.email === email)
  if (!user) {
    const { data } = await admin.auth.admin.createUser({
      email, email_confirm: true, user_metadata: { full_name: name },
    })
    user = data.user
  }

  await admin.from('profiles').upsert(
    { id: user.id, full_name: name, phone: '+61' + phone.slice(1) }, { onConflict: 'id' })
  await admin.from('academy_members').upsert(
    { academy_id: NRIFA, profile_id: user.id, role: 'parent', status: 'active' },
    { onConflict: 'academy_id,profile_id' })
  await admin.from('team_members').upsert(
    { academy_id: NRIFA, team_id: U8, profile_id: user.id, role: 'parent' },
    { onConflict: 'team_id,profile_id' })

  for (const kid of kids) {
    const { data: found } = await admin.from('players').select('id')
      .eq('academy_id', NRIFA).eq('team_id', U8).eq('full_name', kid).maybeSingle()
    let pid = found?.id
    if (!pid) {
      const { data } = await admin.from('players')
        .insert({ academy_id: NRIFA, team_id: U8, full_name: kid }).select('id').single()
      pid = data.id
    }
    // academy_id is NOT NULL here. Leaving it out failed every time, and
    // because nothing checked the error the script cheerfully reported
    // "13 children linked" while writing none of them — which is how the
    // parent demo had no RSVP buttons and no fees for five weeks.
    const { error: linkError } = await admin.from('player_guardians').upsert(
      { player_id: pid, profile_id: user.id, academy_id: NRIFA },
      { onConflict: 'player_id,profile_id' })
    if (linkError) throw new Error(`linking ${kid} to ${name}: ${linkError.message}`)
    links++
  }
}
say(`${FAMILIES.length} families, ${links} children linked to a parent`)


// --- fixtures --------------------------------------------------------------
// Only rows this script owns. source='manual' and a Round title is the seed's
// own signature; anything imported or scanned carries a different source.
// A fixture posted into a channel leaves a card behind, and the card's only
// content IS the event. Deleting the event sets its event_id to null, which
// leaves a message with no body, no attachments and no event — and
// messages_not_empty refuses it, so the whole delete fails.
//
// This is a real product bug, not just a seeding one: a coach who posts a
// fixture to the team can never afterwards delete it. Fixing it properly
// needs a trigger that takes the card with the event. Until then, take the
// cards out first.
const clearCards = async (titleFilter) => {
  const q = admin.from('events').select('id').eq('academy_id', NRIFA).eq('source', 'manual')
  const { data: doomed } = await (titleFilter.like
    ? q.like('title', titleFilter.like)
    : q.eq('title', titleFilter.eq))
  if (!doomed?.length) return
  const ids = doomed.map((e) => e.id)
  const { data: cards } = await admin
    .from('messages').select('id, body').in('event_id', ids)
  const empty = (cards ?? []).filter((m) => !m.body || !m.body.trim()).map((m) => m.id)
  if (empty.length) await admin.from('messages').delete().in('id', empty)
  const { error } = await admin.from('events').delete().in('id', ids)
  if (error) throw new Error(`clearing ${JSON.stringify(titleFilter)}: ${error.message}`)
}
await clearCards({ like: 'Round %' })
await clearCards({ eq: 'Tuesday training' })

const saturday = (weeks) => {
  const d = new Date()
  d.setHours(9, 0, 0, 0)
  return new Date(+d + (((6 - d.getDay() + 7) % 7) + weeks * 7) * day)
}

const fixtures = []
for (let i = 0; i < 12; i++) {
  const start = saturday(i - 6)            // six played, six to come
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
for (let i = 0; i < 4; i++) {
  const d = new Date()
  d.setHours(17, 0, 0, 0)
  const start = new Date(+d + (((2 - d.getDay() + 7) % 7) + i * 7) * day)
  fixtures.push({
    academy_id: NRIFA, team_id: U8, type: 'training',
    title: 'Tuesday training', venue: 'Christie Park, Field 2',
    starts_at: start.toISOString(),
    ends_at: new Date(+start + 3600e3).toISOString(),
  })
}

const { data: made, error } = await admin.from('events').insert(fixtures).select('id, starts_at, type')
if (error) throw new Error(error.message)
const upcoming = made.filter((e) => new Date(e.starts_at) > new Date())
say(`${made.length} events — ${upcoming.length} still to come`)

// --- RSVPs -----------------------------------------------------------------
// Deliberately incomplete. A coach's screen is only interesting when somebody
// has not answered, and a parent's is only interesting when one of their
// children is still outstanding.
const { data: members } = await admin.from('team_members').select('profile_id').eq('team_id', U8)
let answered = 0
for (const e of upcoming.slice(0, 4)) {
  for (const m of members) {
    const { data: kids } = await admin
      .from('players')
      .select('id')
      .eq('team_id', U8)
      .in('id', (
        await admin.from('player_guardians').select('player_id').eq('profile_id', m.profile_id)
      ).data?.map((g) => g.player_id) ?? ['00000000-0000-0000-0000-000000000000'])

    for (const kid of kids ?? []) {
      const r = Math.random()
      if (r > 0.78) continue                       // some never answer
      await admin.from('event_rsvps').upsert(
        {
          academy_id: NRIFA, event_id: e.id, profile_id: m.profile_id, player_id: kid.id,
          status: r > 0.66 ? 'maybe' : r > 0.56 ? 'no' : 'yes',
        },
        { onConflict: 'event_id,profile_id,player_id' }
      )
      answered++
    }
  }
}
say(`${answered} RSVPs across the next four fixtures, deliberately incomplete`)

// --- something to pay for --------------------------------------------------
const { data: owner } = await admin
  .from('academy_members').select('profile_id').eq('academy_id', NRIFA).eq('role', 'owner').limit(1).single()

await admin.from('payment_requests').delete().eq('academy_id', NRIFA).eq('title', 'Spring Gala Day entry')
await admin.from('payment_requests').insert({
  academy_id: NRIFA, team_id: U8, title: 'Spring Gala Day entry',
  description: 'Covers referees, ground hire and a medal for every player.',
  amount_cents: 4500,
  due_on: new Date(Date.now() + 12 * day).toISOString().slice(0, 10),
  created_by: owner.profile_id,
})
say('a $45 gala day fee to collect')

// --- keep the way in open --------------------------------------------------
//
// join_links expire 30 days after they are created, which is right for a real
// club and wrong for demo data that gets looked at months later. Every one of
// NRIFA's nine links had quietly expired, so "here is how a parent joins"
// showed an expired page — including the six-character codes (0089), which
// are the same link and expire with it.
//
// Re-dated rather than re-created, so the codes a coach may have written down
// keep working.
const { data: joinLinks, error: linkError } = await admin
  .from('join_links')
  .update({ expires_at: new Date(Date.now() + 365 * day).toISOString() })
  .eq('academy_id', NRIFA)
  .is('revoked_at', null)
  .select('code, team_id')
if (linkError) throw new Error(`refreshing join links: ${linkError.message}`)

// Named, because the whole point is that somebody can read one out.
const named = []
for (const l of joinLinks ?? []) {
  if (!l.team_id) continue
  const { data: t } = await admin.from('teams').select('name').eq('id', l.team_id).maybeSingle()
  if (t) named.push(`${t.name}: ${l.code}`)
}
say(`${joinLinks?.length ?? 0} join links live for a year`)
for (const n of named.slice(0, 6)) say(`  ${n}`)

console.log('\nDone. The season now straddles today.\n')
