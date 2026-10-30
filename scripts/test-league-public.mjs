// Run: node --env-file=.env.local scripts/test-league-public.mjs
//
// L-04: a player card opens for the league's officials and, on match day,
// the opposition — and for nobody else outside the club.
// L-12: top scorers on the public page, named by each club's own rule.
import { createClient } from '@supabase/supabase-js'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const anon = createClient(URL_, PUB, { auth: { persistSession: false } })

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`)
  process.exitCode = 1
}
const head = (m) => console.log(`\n${m}`)

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const SPL = '00000000-0000-0000-0000-0000000a0003'
const OWNER = '00000000-0000-0000-0000-0000000000a1'
const U8 = '00000000-0000-0000-0000-0000000d0008'
const TAG = 'LPUBTEST'
const OFFICIAL_EMAIL = 'lpubtest-official@squadroom.invalid'
const VISITOR_EMAIL = 'lpubtest-visitor@squadroom.invalid'

async function signInEmail(email) {
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (!link?.properties?.hashed_token) return null
  const client = createClient(URL_, PUB, { auth: { persistSession: false } })
  const { data } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
  return data?.session ? client : null
}

async function cleanup() {
  const { data: comps } = await admin.from('competitions').select('id').like('name', `${TAG} %`)
  for (const c of comps ?? []) await admin.from('competitions').delete().eq('id', c.id)
  const { data: acads } = await admin.from('academies').select('id').like('name', `${TAG} %`)
  for (const a of acads ?? []) await admin.from('academies').delete().eq('id', a.id)
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 })
  for (const e of [OFFICIAL_EMAIL, VISITOR_EMAIL]) {
    const u = users?.users?.find((x) => x.email === e)
    if (u) await admin.auth.admin.deleteUser(u.id)
  }
}
await cleanup()

// An SPL official who is not at NRIFA; a visiting club with its owner.
const { data: off } = await admin.auth.admin.createUser({ email: OFFICIAL_EMAIL, email_confirm: true })
await admin.from('profiles').upsert({ id: off.user.id, full_name: 'Olive Official' })
// Nobody holds a staff role without a clearance (0120) — a league official included.
await admin.from('staff_clearances').insert({
  academy_id: SPL, profile_id: off.user.id, kind: 'wwcc', number: 'WWC0000777E', outcome: 'cleared',
  expires_on: new Date(Date.now() + 400 * 864e5).toISOString().slice(0, 10), verified_by: OWNER,
})
const { error: memErr } = await admin.from('academy_members').insert({ academy_id: SPL, profile_id: off.user.id, role: 'admin', status: 'active' })
if (memErr) console.log('  (official membership:', memErr.message + ')')
const { data: vis } = await admin.auth.admin.createUser({ email: VISITOR_EMAIL, email_confirm: true })
await admin.from('profiles').upsert({ id: vis.user.id, full_name: 'Vic Visitor' })
const { data: club } = await admin.from('academies').insert({ name: `${TAG} FC`, slug: 'lpubtest-fc', type: 'academy', primary_colour: '#333333' }).select('id').single()
await admin.from('academy_members').insert({ academy_id: club.id, profile_id: vis.user.id, role: 'owner', status: 'active' })
const { data: vteam } = await admin.from('teams').insert({ academy_id: club.id, name: `${TAG} U8`, age_group: 'U8', season: '2026', status: 'active' }).select('id').single()
await admin.from('players').insert([1, 2].map((i) => ({ academy_id: club.id, team_id: vteam.id, full_name: `Visitor ${i} ${TAG}`, dob: '2018-01-01' })))

const { data: comp } = await admin.from('competitions').insert({
  organiser_id: SPL, name: `${TAG} League`, type: 'season', season: '2026', status: 'active', mode: 'managed', visibility: 'participants', created_by: OWNER,
  public_slug: 'lpubtest-league', published_at: new Date().toISOString(),
}).select('id').single()
await admin.from('competition_clubs').insert([
  { competition_id: comp.id, academy_id: NRIFA, status: 'active', joined_at: new Date().toISOString() },
  { competition_id: comp.id, academy_id: club.id, status: 'active', joined_at: new Date().toISOString() },
])
const { data: entries } = await admin.from('competition_entries').insert([
  { competition_id: comp.id, academy_id: NRIFA, team_id: U8, display_name: 'NRIFA U8', division: 'U8' },
  { competition_id: comp.id, academy_id: club.id, team_id: vteam.id, display_name: `${TAG} U8`, division: 'U8' },
]).select('id')
const [home, away] = entries
const { data: fxRow } = await admin.from('fixtures').insert({ competition_id: comp.id, division: 'U8', round: 'Round 1', home_entry_id: home.id, away_entry_id: away.id, starts_at: new Date(Date.now() + 3600_000).toISOString(), status: 'scheduled', stage: 'group' }).select('id').single()
const fxToday = fxRow.id

const official = await signInEmail(OFFICIAL_EMAIL)
const visitor = await signInEmail(VISITOR_EMAIL)
const owner = await signInEmail((await admin.auth.admin.getUserById(OWNER)).data.user.email)
if (!official || !visitor || !owner) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  await cleanup()
  process.exit(2)
}
await owner.rpc('seed_entry_squad', { p_entry: home.id })
await visitor.rpc('seed_entry_squad', { p_entry: away.id })
const { data: sq } = await admin.from('entry_squads').select('player_id').eq('entry_id', home.id)
const kid = sq[0].player_id
const { data: other } = await admin.from('players').select('id').eq('academy_id', NRIFA).not('id', 'in', `(${sq.map((s) => s.player_id).join(',')})`).limit(1).maybeSingle()

head('1. The league\'s official opens a card for a child on a season squad, and no other')
{
  const { data, error } = await official.rpc('player_card', { p_player: kid })
  error ? bad(`official: ${error.message}`) : ok(`the SPL official opens ${data.full_name}'s card`)
  data?.can_edit === false ? ok('and cannot change anything on it') : bad('an official could edit the card')
  if (other) {
    const { error: no } = await official.rpc('player_card', { p_player: other.id })
    no?.code === '42501' ? ok('but not a NRIFA child who is on no SPL squad') : bad('an official opened an unrelated child\'s card')
  }
}

head('2. The opposition opens it on match day, once the child is on the sheet — not before, not otherwise')
{
  const { error: before } = await visitor.rpc('player_card', { p_player: kid })
  before?.code === '42501' ? ok('before the sheet: refused') : bad('the opposition opened a card with no sheet')
  const { error: s } = await owner.rpc('submit_match_sheet', { p_fixture: fxToday, p_entry: home.id, p_players: sq.slice(0, 9).map((x, i) => ({ player_id: x.player_id, number: i + 1, starting: true })) })
  s ? bad(`sheet: ${s.message}`) : ok('NRIFA submits today\'s sheet')
  const { data, error } = await visitor.rpc('player_card', { p_player: kid })
  error ? bad(`opposition on match day: ${error.message}`) : ok(`the visiting manager opens ${data.full_name}'s card`)
  await admin.from('fixtures').update({ starts_at: new Date(Date.now() - 5 * 864e5).toISOString() }).eq('id', fxToday)
  const { error: stale } = await visitor.rpc('player_card', { p_player: kid })
  stale?.code === '42501' ? ok('a sheet from five days ago opens nothing') : bad('the opposition kept access after match day')
  await admin.from('fixtures').update({ starts_at: new Date(Date.now() + 3600_000).toISOString() }).eq('id', fxToday)
}

head('3. Top scorers on the public page, by each club\'s own naming rule')
{
  const [a, b] = sq.slice(0, 2).map((x) => x.player_id)
  await admin.from('match_events').insert([
    { competition_id: comp.id, fixture_id: fxToday, entry_id: home.id, player_id: a, kind: 'goal', minute: 5 },
    { competition_id: comp.id, fixture_id: fxToday, entry_id: home.id, player_id: a, kind: 'goal', minute: 50 },
    { competition_id: comp.id, fixture_id: fxToday, entry_id: home.id, player_id: b, kind: 'goal', minute: 30 },
  ])
  let { data: centre } = await anon.rpc('public_match_centre', { p_slug: 'lpubtest-league' })
  const noneYet = centre?.top_scorers?.U8 ?? []
  noneYet.length === 0 ? ok('nothing while the game is not final') : bad(`${noneYet.length} scorers before the final whistle`)
  await admin.from('fixtures').update({ status: 'final', home_score: 3, away_score: 0 }).eq('id', fxToday)
  ;({ data: centre } = await anon.rpc('public_match_centre', { p_slug: 'lpubtest-league' }))
  const list = centre?.top_scorers?.U8 ?? []
  const { data: names } = await admin.from('players').select('id, full_name').in('id', [a, b])
  const fullA = names.find((n) => n.id === a).full_name
  list[0]?.goals === 2 && list[0]?.team === 'NRIFA U8' ? ok(`top: ${list[0].name} (${list[0].team}) — 2`) : bad(JSON.stringify(list))
  const { data: setting } = await admin.from('academies').select('public_player_names').eq('id', NRIFA).single()
  const expectFull = setting.public_player_names === 'full'
  const expectInitials = setting.public_player_names === 'initials'
  expectFull ? (list[0]?.name === fullA ? ok('named in full — NRIFA publishes full names') : bad(`name "${list[0]?.name}"`))
    : expectInitials ? (list[0]?.name !== fullA ? ok('initialled — NRIFA publishes initials') : bad('full name shown under the initials setting'))
    : (list[0]?.name === 'A NRIFA U8 player' ? ok('unnamed — NRIFA publishes no names') : bad(`name "${list[0]?.name}"`))
  await admin.from('players').update({ public_name_hidden: true }).eq('id', a)
  ;({ data: centre } = await anon.rpc('public_match_centre', { p_slug: 'lpubtest-league' }))
  const hidden = (centre?.top_scorers?.U8 ?? []).find((r) => r.goals === 2)
  hidden?.name === 'A NRIFA U8 player' ? ok('a family\'s opt-out wins: "A NRIFA U8 player", still 2 goals') : bad(`after opt-out: ${JSON.stringify(hidden)}`)
  await admin.from('players').update({ public_name_hidden: false }).eq('id', a)
  await admin.from('competition_divisions').upsert({ competition_id: comp.id, division: 'U8', scores_public: false, allow_playing_up: true }, { onConflict: 'competition_id,division' })
  ;({ data: centre } = await anon.rpc('public_match_centre', { p_slug: 'lpubtest-league' }))
  centre?.top_scorers?.U8 === undefined ? ok('a hidden-score division publishes no scorers') : bad('scorers published for a hidden division')
}

await cleanup()
console.log(process.exitCode ? '\n\x1b[31mTHE LEAGUE PUBLIC SIDE IS WRONG\x1b[0m\n' : '\n\x1b[32mall good\x1b[0m\n')
