// Run: node --env-file=.env.local scripts/seed-tournament.mjs
//
// Builds NRIFA's Spring Gala Day into something worth showing: eighteen
// visiting academies across three divisions, a generated draw across four
// fields, results on the morning games and a live ladder.
//
// This is the half of the product Dribl actually does — a draw, a ladder,
// results — and an empty competitions screen demonstrates none of it. It
// reuses generate_fixtures (0047), which is the circle method plus greedy
// slot and field assignment, so the draw is the real one rather than a
// hand-written fixture list.
//
// Idempotent: it clears and rebuilds its own competition each run.
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const anon = createClient(URL, PUB, { auth: { persistSession: false } })

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const say = (m) => console.log('  ' + m)

// The organiser has to be a real signed-in person: generate_fixtures is
// granted to authenticated, and it checks who is asking.
const { data: link } = await admin.auth.admin.generateLink({
  type: 'magiclink', email: 'joeylameri@outlook.com',
})
const { data: verified } = await anon.auth.verifyOtp({
  token_hash: link.properties.hashed_token, type: 'email',
})
const organiser = createClient(URL, PUB, {
  auth: { persistSession: false },
  global: { headers: { Authorization: `Bearer ${verified.session.access_token}` } },
})
const organiserId = verified.user.id

console.log('\nBuilding the Spring Gala Day\n')

// --- the competition -------------------------------------------------------
await admin.from('competitions').delete().eq('organiser_id', NRIFA).eq('name', 'Spring Gala Day')

const { data: comp, error: compError } = await admin.from('competitions').insert({
  organiser_id: NRIFA,
  name: 'Spring Gala Day',
  season: '2026',
  mode: 'managed',
  status: 'active',
  created_by: organiserId,
}).select('id').single()
if (compError) throw new Error(compError.message)
say(`competition created`)

// --- who is playing --------------------------------------------------------
// Real academy names from the region. A gala day is mostly teams that are not
// yours, which is why competition_entries.team_id is nullable — a visiting
// club that has never heard of Squadroom is still a name on the draw.
const DIVISIONS = {
  'U8 Championship': [
    'NRIFA U8 SPL', 'Gladesville Ravens', 'Hornsby Heat', 'Epping Eagles',
    'Beecroft Bulls', 'Pennant Hills Panthers',
  ],
  'U10 Championship': [
    'NRIFA U10', 'Carlingford Cobras', 'Thornleigh Thunder', 'Normanhurst Nomads',
    'West Pennant Hills', 'Cheltenham Colts',
  ],
  'U12 Championship': [
    'NRIFA U12', 'Kissing Point', 'Ryde Rovers', 'Marsfield Magpies',
    'Dundas Valley', 'Eastwood Eagles',
  ],
}

// NRIFA's own teams get linked to the real squads so their parents see the
// fixtures in the app; everyone else is a name.
const { data: ourTeams } = await admin.from('teams').select('id, name').eq('academy_id', NRIFA)
const ourTeamByName = Object.fromEntries((ourTeams ?? []).map((t) => [t.name, t.id]))
const link_ = (name) =>
  ourTeamByName[name.replace('NRIFA ', '')] ?? ourTeamByName[name] ?? null

let entries = 0
for (const [division, teams] of Object.entries(DIVISIONS)) {
  for (const name of teams) {
    const { error } = await admin.from('competition_entries').insert({
      competition_id: comp.id,
      division,
      display_name: name,
      team_id: link_(name),
      academy_id: name.startsWith('NRIFA') ? NRIFA : null,
    })
    if (error) throw new Error(`${name}: ${error.message}`)
    entries++
  }
}
say(`${entries} teams across ${Object.keys(DIVISIONS).length} divisions`)

// --- the draw --------------------------------------------------------------
// 20-minute games, 5-minute turnarounds — NRIFA's actual format.
//
// Each division gets its OWN fields. generate_fixtures (0047) tracks which
// TEAMS are busy in a slot so nobody plays twice at once, but it knows nothing
// about fixtures already placed by another division — it assumes it owns the
// fields it is handed. Give all three the same four fields and you draw a
// beautiful timetable in which three games kick off on Field 1 at nine.
//
// That is a real limitation, not a seeding quirk: a coach drawing three age
// groups onto one venue through the interface would hit it. Noted in
// SQUADROOM_SPEC as X-14.
const FIELDS = {
  'U8 Championship': ['Field 1', 'Field 2'],
  'U10 Championship': ['Field 3', 'Field 4'],
  'U12 Championship': ['Field 5', 'Field 6'],
}
const saturday = new Date()
saturday.setDate(saturday.getDate() + ((6 - saturday.getDay() + 7) % 7 || 7))
saturday.setHours(9, 0, 0, 0)

let made = 0
for (const division of Object.keys(DIVISIONS)) {
  const { data, error } = await organiser.rpc('generate_fixtures', {
    p_competition: comp.id,
    p_division: division,
    p_start_at: saturday.toISOString(),
    p_game_mins: 20,
    p_gap_mins: 5,
    p_fields: FIELDS[division],
    p_venue_label: 'ELS Hall Park',
    p_replace: true,
  })
  if (error) throw new Error(`${division}: ${error.message}`)
  made += typeof data === 'number' ? data : (data?.[0]?.created ?? 0)
}

const { data: fixtures } = await admin.from('fixtures')
  .select('id, starts_at, division, home_entry_id, away_entry_id')
  .eq('competition_id', comp.id).order('starts_at')
say(`${fixtures.length} games drawn across 4 fields`)

// --- results on the morning ------------------------------------------------
// A ladder with nothing played is a list of zeroes. Half the day is done,
// which is also when a parent most wants to look at it.
// Half the games, by time — a ladder with everything played is a result
// sheet, and a ladder with nothing played is a list of zeroes. Mid-morning
// is when a parent actually looks at one.
const kickoffs = [...new Set(fixtures.map((f) => f.starts_at))].sort()
const cutoff = new Date(kickoffs[Math.floor(kickoffs.length / 2)])
let scored = 0
for (const f of fixtures) {
  if (new Date(f.starts_at) > cutoff) continue
  const home = Math.floor(Math.random() * 5)
  const away = Math.floor(Math.random() * 4)
  await admin.from('fixtures').update({
    home_score: home, away_score: away, status: 'final',
    score_entered_by: organiserId,
  }).eq('id', f.id)
  scored++
}
say(`${scored} results in, ${fixtures.length - scored} still to play`)

// --- prove the ladder is live ----------------------------------------------
const { data: ladder, error: ladderError } = await organiser.rpc('competition_ladder', {
  p_competition: comp.id, p_division: 'U8 Championship',
})
if (ladderError) {
  say(`ladder could not be read: ${ladderError.message}`)
} else {
  const top = (ladder ?? []).slice(0, 3)
  say(`ladder live — leading: ${top.map((r) => `${r.team_name} ${r.points}pts`).join(', ')}`)
}

console.log('\nDone. Competitions → Spring Gala Day.\n')
