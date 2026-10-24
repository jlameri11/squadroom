/**
 * test-league-draw.mjs — 0081: weekly league seasons, and field clashes.
 *
 * Two faults in 0047, both found by using it rather than reading it.
 *
 *   X-15  It could only build ONE DAY, so Squadroom could run a tournament
 *         and not a league season.
 *   X-14  It double-booked fields across divisions, because it tracks which
 *         TEAMS are busy in a slot and never which FIELDS.
 *
 * Needs 0081 applied. Until then the p_round_every_days argument does not
 * exist and PostgREST answers PGRST202, which this reports as such rather
 * than as a draw that came out wrong.
 */
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

const SPL_ORG = '00000000-0000-0000-0000-0000000a0003'

const { data: link } = await admin.auth.admin.generateLink({
  type: 'magiclink',
  email: 'p61400000301@squadroom.invalid',
})
const { data: session } = await anon.auth.verifyOtp({
  token_hash: link.properties.hashed_token,
  type: 'email',
})
if (!session?.session) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(1)
}
const spl = createClient(URL_, PUB, {
  auth: { persistSession: false },
  global: { headers: { Authorization: `Bearer ${session.session.access_token}` } },
})

await admin.from('competitions').delete().eq('name', 'TESTDRAW Season')

const { data: comp, error: compError } = await spl
  .from('competitions')
  .insert({
    organiser_id: SPL_ORG,
    name: 'TESTDRAW Season',
    type: 'season',
    season: '2026',
  })
  .select('id')
  .single()
if (compError) {
  bad(compError.message)
  process.exit(1)
}

/** Six clubs in a division, which is a ten-round home-and-away season. */
async function enter(division, names) {
  const { data } = await spl.rpc('bulk_invite_clubs', {
    p_competition: comp.id,
    p_division: division,
    p_clubs: names.map((club_name) => ({ club_name })),
  })
  return data
}

await enter('U9s', ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'])
await enter('U11s', ['Golf', 'Hotel', 'India', 'Juliet', 'Kilo', 'Lima'])

const START = new Date('2026-03-01T09:00:00+11:00')

head('1. A weekly league season: rounds a week apart')
const { data: made, error: genError } = await spl.rpc('generate_fixtures', {
  p_competition: comp.id,
  p_division: 'U9s',
  p_start_at: START.toISOString(),
  p_game_mins: 60,
  p_gap_mins: 0,
  p_fields: ['Field 1', 'Field 2', 'Field 3'],
  p_venue_label: 'ELS Hall Park',
  p_round_every_days: 7,
})

if (genError?.code === 'PGRST202') {
  bad('0081 is not applied — generate_fixtures has no p_round_every_days yet')
  await admin.from('competitions').delete().eq('id', comp.id)
  process.exit(1)
}
if (genError) {
  bad(genError.message)
  await admin.from('competitions').delete().eq('id', comp.id)
  process.exit(1)
}

// Six clubs, single round robin = five rounds of three games.
made === 15 ? ok(`${made} games drawn`) : bad(`${made} games, expected 15`)

const { data: u9 } = await admin
  .from('fixtures')
  .select('round, starts_at, field_label, venue_label, home_entry_id, away_entry_id')
  .eq('competition_id', comp.id)
  .eq('division', 'U9s')
  .order('starts_at')

const rounds = [...new Set(u9.map((f) => f.round))].sort(
  (a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, ''))
)

// Every game in a round shares a day, and each round is exactly seven days
// after the one before. This is the whole of X-15.
let spacingHolds = true
let sameDayHolds = true
let previous = null
for (const r of rounds) {
  const games = u9.filter((f) => f.round === r)
  const days = new Set(
    games.map((f) => new Date(f.starts_at).toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' }))
  )
  if (days.size !== 1) sameDayHolds = false
  const day = new Date([...days][0] + 'T00:00:00Z').getTime()
  if (previous !== null && day - previous !== 7 * 864e5) spacingHolds = false
  previous = day
}
sameDayHolds ? ok(`each of the ${rounds.length} rounds is on one day`) : bad('a round was split across days')
spacingHolds ? ok('every round is exactly seven days after the last') : bad('rounds are not a week apart')

// And the thing that made greedy placement wrong for a league.
const twice = []
for (const r of rounds) {
  const seen = new Set()
  for (const f of u9.filter((x) => x.round === r)) {
    for (const id of [f.home_entry_id, f.away_entry_id]) {
      if (seen.has(id)) twice.push(r)
      seen.add(id)
    }
  }
}
twice.length === 0 ? ok('no club plays twice in a round') : bad(`a club plays twice in ${twice.join(', ')}`)

head('2. A second division on the SAME fields does not double-book them')
// X-14. 0047 would place U11s Round 1 on Field 1 at 9am, exactly where U9s
// Round 1 already is, because it tracks busy TEAMS and not busy FIELDS.
const { error: genError2 } = await spl.rpc('generate_fixtures', {
  p_competition: comp.id,
  p_division: 'U11s',
  p_start_at: START.toISOString(),
  p_game_mins: 60,
  p_gap_mins: 0,
  p_fields: ['Field 1', 'Field 2', 'Field 3'],
  p_venue_label: 'ELS Hall Park',
  p_round_every_days: 7,
})
genError2 ? bad(genError2.message) : ok('the second division drew without error')

const { data: all } = await admin
  .from('fixtures')
  .select('division, round, starts_at, field_label, venue_label')
  .eq('competition_id', comp.id)

const slots = new Map()
for (const f of all) {
  const key = `${f.venue_label}|${f.field_label}|${f.starts_at}`
  slots.set(key, [...(slots.get(key) ?? []), `${f.division} ${f.round}`])
}
const clashes = [...slots.entries()].filter(([, games]) => games.length > 1)
clashes.length === 0
  ? ok(`${all.length} games, ${slots.size} distinct field-and-time slots, no clash`)
  : bad(
      `${clashes.length} field clashes, e.g. ${clashes[0][0]} has ${clashes[0][1].join(' AND ')}`
    )

head('3. A gala day is unchanged: one block, games packed into slots')
await admin.from('fixtures').delete().eq('competition_id', comp.id)
const { error: galaError } = await spl.rpc('generate_fixtures', {
  p_competition: comp.id,
  p_division: 'U9s',
  p_start_at: START.toISOString(),
  p_game_mins: 20,
  p_gap_mins: 5,
  p_fields: ['Field 1', 'Field 2'],
  p_venue_label: 'ELS Hall Park',
  // The default. Named here because it is the assertion.
  p_round_every_days: 0,
})
galaError ? bad(galaError.message) : null

const { data: gala } = await admin
  .from('fixtures')
  .select('starts_at, field_label')
  .eq('competition_id', comp.id)
  .order('starts_at')

const galaDays = new Set(
  gala.map((f) => new Date(f.starts_at).toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' }))
)
galaDays.size === 1
  ? ok(`all ${gala.length} games on one day, as a gala day should be`)
  : bad(`a gala day was spread over ${galaDays.size} days`)

const galaSlots = new Set(gala.map((f) => `${f.field_label}|${f.starts_at}`))
galaSlots.size === gala.length
  ? ok('two fields used in parallel, no slot used twice')
  : bad('a slot was used twice')

head('4. A negative spacing is refused rather than silently ignored')
const { error: negError } = await spl.rpc('generate_fixtures', {
  p_competition: comp.id,
  p_division: 'U9s',
  p_start_at: START.toISOString(),
  p_fields: ['Field 1'],
  p_round_every_days: -7,
  p_replace: true,
})
negError ? ok(`refused: ${negError.message}`) : bad('a negative round spacing was accepted')

await admin.from('competitions').delete().eq('id', comp.id)
console.log(
  process.exitCode ? '\n\x1b[31mLEAGUE DRAW BROKEN\x1b[0m\n' : '\n\x1b[32mLEAGUE DRAW HOLDS\x1b[0m\n'
)
process.exit(process.exitCode ?? 0)
