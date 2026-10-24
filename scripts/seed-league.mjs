// Run: node --env-file=.env.local scripts/seed-league.mjs
//
// Makes the "runs a league AND an academy" case real.
//
// Squadroom's model has always allowed it — `academies` means ORGANISATION,
// separated by `type`, and Sydney Premier League has existed as a `league` row
// since 0021 — but nothing in the demo data expressed it. Joey owned one
// academy, SPL was owned by a profile nobody signs in as, and SPL Season 3 was
// four teams and two fixtures. So the product's most distinctive claim against
// Dribl, that one account can run a league and a club, could not be seen.
//
// After this:
//   · Joey owns NRIFA Football Academy (academy) AND Sydney Premier League
//     (league), so the organisation switcher has something to switch to.
//   · SPL Season 3 is a mid-season league: three divisions, six clubs each,
//     home and away, ten rounds on Sunday mornings, seven rounds played.
//
// WHY THE FIXTURES ARE WRITTEN HERE RATHER THAN GENERATED
//
// generate_fixtures (0047) packs games into consecutive slots of
// (game_mins + gap_mins) from one start time, and places any game whose teams
// are free. That is exactly right for a gala day and cannot express a league:
// there is no way to say "all of Round 1 this Sunday, Round 2 next Sunday",
// and the greedy placement happily puts Round 1 and Round 2 games in the same
// slot. Recorded as X-15.
//
// So this writes the rounds directly, in the shape 0081 will produce once
// generate_fixtures takes a p_round_every_days. Regenerating after that
// migration should give the same draw, which is the point of matching it.
//
// Idempotent: it rebuilds its own season each run.
import { createClient } from '@supabase/supabase-js'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const SPL = '00000000-0000-0000-0000-0000000a0003'
const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const RAVENS = '00000000-0000-0000-0000-0000000a0002'

const say = (m) => console.log('  ' + m)
const die = (m) => {
  throw new Error(m)
}

console.log('\nBuilding Sydney Premier League, Season 3\n')

// --- who runs it -----------------------------------------------------------
const { data: joey } = await admin
  .from('profiles')
  .select('id, full_name')
  .ilike('full_name', '%joey%')
  .limit(1)
  .maybeSingle()
if (!joey) die('no profile matching "joey" — run scripts/refresh-demo.mjs first')

// Owner of the league as well as the academy. This single row is what the
// organisation switcher exists for.
const { error: memberError } = await admin
  .from('academy_members')
  .upsert(
    { academy_id: SPL, profile_id: joey.id, role: 'owner', status: 'active' },
    { onConflict: 'academy_id,profile_id' }
  )
if (memberError) die(`making ${joey.full_name} a league owner: ${memberError.message}`)
say(`${joey.full_name} now owns the league as well as the academy`)

// --- the season ------------------------------------------------------------
await admin.from('competitions').delete().eq('organiser_id', SPL).eq('name', 'SPL Season 3')

const { data: comp, error: compError } = await admin
  .from('competitions')
  .insert({
    organiser_id: SPL,
    name: 'SPL Season 3',
    season: '2026',
    mode: 'managed',
    status: 'active',
    created_by: joey.id,
  })
  .select('id')
  .single()
if (compError) die(`creating the season: ${compError.message}`)

// The two clubs that are actually ON Squadroom. The rest of the league is
// names — which is the normal case, and why competition_entries.team_id is
// nullable. Being in a competition together lets them see the DRAW, never
// each other's people.
for (const academy_id of [NRIFA, RAVENS]) {
  const { error } = await admin
    .from('competition_clubs')
    .insert({ competition_id: comp.id, academy_id, status: 'active', invited_by: joey.id })
  if (error) die(`entering club ${academy_id}: ${error.message}`)
}

// --- divisions and clubs ---------------------------------------------------
// Six clubs per division, which is what makes a ten-round home-and-away
// season: five opponents, played twice.
const DIVISIONS = {
  'U8s Championship': [
    'NRIFA U8 SPL', 'Ravens U8', 'Killarney Dragons', 'Joga Bonito U8',
    'Manly Vale Vipers', 'Lindfield Lions',
  ],
  'U10s Championship': [
    'NRIFA U10', 'Ravens U10', 'Killarney Dragons', 'Joga Bonito U10',
    'Chatswood Chargers', 'St Ives Strikers',
  ],
  'U12s Championship': [
    'NRIFA U12', 'Ravens U12', 'Killarney Dragons', 'Joga Bonito U12',
    'Turramurra Tigers', 'Roseville Rangers',
  ],
}

// NRIFA's and Ravens' own squads get linked to the real teams, so their
// parents see league fixtures in the app rather than a name on a draw.
const { data: teams } = await admin
  .from('teams')
  .select('id, name, academy_id')
  .in('academy_id', [NRIFA, RAVENS])

const linkTeam = (display) => {
  const stripped = display.replace(/^(NRIFA|Ravens)\s+/, '')
  const owner = display.startsWith('NRIFA') ? NRIFA : display.startsWith('Ravens') ? RAVENS : null
  if (!owner) return { team_id: null, academy_id: null }
  const hit = (teams ?? []).find(
    (t) => t.academy_id === owner && (t.name === stripped || t.name === display)
  )
  return { team_id: hit?.id ?? null, academy_id: owner }
}

const entryIds = {}
for (const [division, clubs] of Object.entries(DIVISIONS)) {
  entryIds[division] = []
  for (const display_name of clubs) {
    const { team_id, academy_id } = linkTeam(display_name)
    const { data, error } = await admin
      .from('competition_entries')
      .insert({ competition_id: comp.id, division, display_name, team_id, academy_id })
      .select('id, display_name')
      .single()
    if (error) die(`${division} / ${display_name}: ${error.message}`)
    entryIds[division].push(data)
  }
}
say(`${Object.keys(DIVISIONS).length} divisions, 6 clubs each`)

/**
 * Who plays who, round by round: the circle method, played twice.
 *
 * The same algorithm generate_fixtures uses, so the draw is the shape the
 * product will produce rather than a hand-written fixture list. The second
 * half of the season is the first half with home and away swapped, which is
 * how every league does it and means nobody has ten home games.
 */
function roundRobin(entries) {
  const ids = entries.map((e) => e.id)
  const n = ids.length
  const rounds = []
  let rotation = ids.slice()

  for (let r = 0; r < n - 1; r++) {
    const games = []
    for (let i = 0; i < n / 2; i++) {
      const home = rotation[i]
      const away = rotation[n - 1 - i]
      // Alternate who is nominally at home each round, or the same club tops
      // every round's home column.
      games.push(r % 2 === 0 ? [home, away] : [away, home])
    }
    rounds.push(games)
    // Hold the first, rotate the rest.
    rotation = [rotation[0], ...rotation.slice(2), rotation[1]]
  }

  // The return half, reversed.
  return [...rounds, ...rounds.map((games) => games.map(([h, a]) => [a, h]))]
}

// --- when ------------------------------------------------------------------
// Sunday mornings. Round 1 was nine Sundays ago, so seven rounds are played,
// one is this weekend and two are to come — a ladder worth looking at, which
// is the only kind worth demonstrating.
const ROUNDS = 10
const PLAYED = 7

const sunday = new Date()
sunday.setDate(sunday.getDate() - ((sunday.getDay() + 7) % 7))
sunday.setHours(0, 0, 0, 0)
const round1 = new Date(sunday)
round1.setDate(round1.getDate() - 7 * PLAYED)

// Each division kicks off at its own time on its own fields. A league plays at
// its member clubs' grounds, so the home club's ground is the venue.
const SLOTS = {
  'U8s Championship': { hour: 9, mins: 40 },
  'U10s Championship': { hour: 10, mins: 50 },
  'U12s Championship': { hour: 12, mins: 60 },
}

const GROUNDS = {
  'NRIFA U8 SPL': 'ELS Hall Park',
  'NRIFA U10': 'ELS Hall Park',
  'NRIFA U12': 'ELS Hall Park',
  'Ravens U8': 'Gladesville Reserve',
  'Ravens U10': 'Gladesville Reserve',
  'Ravens U12': 'Gladesville Reserve',
  'Killarney Dragons': 'Killarney Heights Oval',
  'Joga Bonito U8': 'Christie Park',
  'Joga Bonito U10': 'Christie Park',
  'Joga Bonito U12': 'Christie Park',
  'Manly Vale Vipers': 'Nolan Reserve',
  'Lindfield Lions': 'Tryon Road Oval',
  'Chatswood Chargers': 'Beauchamp Park',
  'St Ives Strikers': 'Hassall Park',
  'Turramurra Tigers': 'Karuah Park',
  'Roseville Rangers': 'Roseville Park',
}

const rows = []
for (const [division, entries] of Object.entries(entryIds)) {
  const nameOf = Object.fromEntries(entries.map((e) => [e.id, e.display_name]))
  const slot = SLOTS[division]
  const draw = roundRobin(entries)

  draw.slice(0, ROUNDS).forEach((games, r) => {
    const kickoff = new Date(round1)
    kickoff.setDate(kickoff.getDate() + 7 * r)
    kickoff.setHours(slot.hour, 0, 0, 0)

    for (const [home, away] of games) {
      rows.push({
        competition_id: comp.id,
        division,
        round: `Round ${r + 1}`,
        home_entry_id: home,
        away_entry_id: away,
        starts_at: kickoff.toISOString(),
        duration_mins: slot.mins,
        // The home club's ground, which is what makes it a league rather
        // than a tournament at one venue.
        venue_label: GROUNDS[nameOf[home]] ?? 'ELS Hall Park',
        field_label: 'Field 1',
        status: 'scheduled',
        stage: 'group',
      })
    }
  })
}

const { error: fixtureError } = await admin.from('fixtures').insert(rows)
if (fixtureError) die(`writing the draw: ${fixtureError.message}`)
say(`${rows.length} fixtures over ${ROUNDS} rounds`)

// --- results ---------------------------------------------------------------
// Scores on every round that has already been played. Deterministic from the
// fixture, so a refresh does not reshuffle the ladder and the demo tells the
// same story twice.
const { data: toScore } = await admin
  .from('fixtures')
  .select('id, round, starts_at')
  .eq('competition_id', comp.id)
  .lt('starts_at', new Date().toISOString())

let scored = 0
for (const f of toScore ?? []) {
  const seed = [...f.id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 9973, 7)
  const { error } = await admin
    .from('fixtures')
    .update({
      home_score: seed % 5,
      away_score: Math.floor(seed / 5) % 4,
      status: 'final',
      score_entered_by: joey.id,
      score_entered_at: new Date(f.starts_at).toISOString(),
    })
    .eq('id', f.id)
  if (error) die(`scoring ${f.round}: ${error.message}`)
  scored++
}
say(`${scored} results in, ${rows.length - scored} still to play`)

// --- prove the ladder reads ------------------------------------------------
//
// As the organiser, not as the service role. competition_ladder is gated on
// app_private.is_competition_participant, and the service role has no
// auth.uid() at all — so it returns nothing and looks like a broken ladder
// rather than an unauthenticated one. Checking it with a real session is the
// only check worth making: it is the path the app uses.
const anon = createClient(URL_, PUB, { auth: { persistSession: false } })
const { data: link } = await admin.auth.admin.generateLink({
  type: 'magiclink',
  email: 'joeylameri@outlook.com',
})
const { data: verified, error: otpError } = await anon.auth.verifyOtp({
  token_hash: link.properties.hashed_token,
  type: 'email',
})
if (otpError) die(`signing in as the organiser: ${otpError.message}`)
const organiser = createClient(URL_, PUB, {
  auth: { persistSession: false },
  global: { headers: { Authorization: `Bearer ${verified.session.access_token}` } },
})

for (const division of Object.keys(DIVISIONS)) {
  const { data: ladder, error } = await organiser.rpc('competition_ladder', {
    p_competition: comp.id,
    p_division: division,
  })
  if (error) die(`ladder for ${division}: ${error.message}`)
  const top = (ladder ?? []).slice(0, 3)
  if (top.length === 0) die(`${division} ladder came back empty`)
  say(`${division}: ${top.map((r) => `${r.team_name} ${r.points}`).join(' · ')}`)
}

console.log('\nDone. Switch to Sydney Premier League to see it.\n')
