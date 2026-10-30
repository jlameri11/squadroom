// Run: node --env-file=.env.local scripts/test-match-day.mjs
//
// L-09: a wet Saturday in one tap — postpone a day or a ground, cancel,
// reschedule, forfeit, bye — and every change reaches the affected club's
// squad through the one path the club's own changes take.
import { createClient } from '@supabase/supabase-js'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`)
  process.exitCode = 1
}
const head = (m) => console.log(`\n${m}`)

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const SPL = '00000000-0000-0000-0000-0000000a0003'
const OWNER = '00000000-0000-0000-0000-0000000000a1'
const PARENT = '00000000-0000-0000-0000-0000000000b1'
const U8 = '00000000-0000-0000-0000-0000000d0008'
const TAG = 'MDTEST'

async function signIn(profileId) {
  const { data: u } = await admin.auth.admin.getUserById(profileId)
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email: u.user.email })
  if (!link?.properties?.hashed_token) return null
  const client = createClient(URL_, PUB, { auth: { persistSession: false } })
  const { data } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
  return data?.session ? client : null
}
const owner = await signIn(OWNER)
const parent = await signIn(PARENT)
if (!owner || !parent) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}

async function cleanup() {
  const { data: comps } = await admin.from('competitions').select('id').like('name', `${TAG} %`)
  for (const c of comps ?? []) {
    const { data: evs } = await admin.from('events').select('id').eq('competition_id', c.id)
    for (const e of evs ?? []) await admin.from('notification_queue').delete().filter('payload->>event_id', 'eq', e.id)
    await admin.from('events').delete().eq('competition_id', c.id)
    await admin.from('competitions').delete().eq('id', c.id)
  }
}
await cleanup()

// A league run by the SPL; NRIFA U8 (a real squad, so events and pushes
// exist) against two names on the draw. Three games next Saturday at two
// grounds, one the Sunday after.
const { data: comp } = await admin.from('competitions').insert({
  organiser_id: SPL, name: `${TAG} League`, type: 'season', season: '2026', status: 'active', mode: 'managed', visibility: 'participants', created_by: OWNER,
}).select('id').single()
await admin.from('competition_clubs').insert({ competition_id: comp.id, academy_id: NRIFA, status: 'active', joined_at: new Date().toISOString() })
const { data: entries } = await admin.from('competition_entries').insert([
  { competition_id: comp.id, academy_id: NRIFA, team_id: U8, display_name: 'NRIFA U8', division: 'U8' },
  { competition_id: comp.id, display_name: `${TAG} Rovers`, division: 'U8' },
  { competition_id: comp.id, display_name: `${TAG} Wanderers`, division: 'U8' },
]).select('id, display_name')
const [nrifa, rovers, wanderers] = entries
// Next Saturday, 9am Sydney.
const sat = new Date()
sat.setUTCDate(sat.getUTCDate() + ((6 - sat.getUTCDay() + 7) % 7 || 7))
const satDate = sat.toISOString().slice(0, 10)
const at = (d, h) => new Date(`${d}T${String(h).padStart(2, '0')}:00:00+11:00`).toISOString()
const sunDate = new Date(sat.getTime() + 864e5).toISOString().slice(0, 10)
const mk = async (round, home, away, when, venue) =>
  (await admin.from('fixtures').insert({ competition_id: comp.id, division: 'U8', round, home_entry_id: home, away_entry_id: away, starts_at: when, venue_label: venue, status: 'scheduled', stage: 'group' }).select('id').single()).data.id
const g1 = await mk('Round 1', nrifa.id, rovers.id, at(satDate, 9), 'ELS Hall')
const g2 = await mk('Round 1', rovers.id, wanderers.id, at(satDate, 10), 'ELS Hall')
const g3 = await mk('Round 1', wanderers.id, nrifa.id, at(satDate, 11), 'Magdala Park')
const g4 = await mk('Round 2', nrifa.id, wanderers.id, at(sunDate, 9), 'ELS Hall')
const eventFor = async (fx) => (await admin.from('events').select('id, cancelled_at, cancellation_reason, starts_at, venue').eq('fixture_id', fx).eq('academy_id', NRIFA).maybeSingle()).data
const pushes = async (ev, kind) => (await admin.from('notification_queue').select('body').eq('kind', kind).filter('payload->>event_id', 'eq', ev)).data ?? []

head('1. The mirror: a league fixture is a club event')
{
  const e = await eventFor(g1)
  e && !e.cancelled_at ? ok('NRIFA U8 has the game on its calendar') : bad('no mirrored event')
}

head('2. Call off one ground on Saturday — only its games, with the reason, to the chat')
{
  const { error: pErr } = await parent.rpc('call_off_fixtures', { p_competition: comp.id, p_date: satDate, p_reason: 'wet_weather' })
  pErr?.code === '42501' ? ok('a parent cannot') : bad('a parent called off a day')
  const { data: r, error } = await owner.rpc('call_off_fixtures', { p_competition: comp.id, p_date: satDate, p_reason: 'wet_weather', p_venue: 'ELS Hall' })
  error ? bad(`call off: ${error.message}`) : ok(`${r.status} ${r.affected}: ${r.games.join(' · ')}`)
  r?.affected === 2 ? ok('the two ELS Hall games, not the Magdala Park one') : bad(`affected ${r?.affected}`)
  const { data: st } = await admin.from('fixtures').select('id, status, cancel_reason').in('id', [g1, g2, g3])
  st.find((f) => f.id === g3)?.status === 'scheduled' ? ok('Magdala Park still on') : bad('Magdala Park was called off')
  st.find((f) => f.id === g1)?.cancel_reason === 'wet_weather' ? ok('the reason is on the fixture') : bad('no reason')
  const e = await eventFor(g1)
  e?.cancelled_at && e?.cancellation_reason === 'wet_weather' ? ok("NRIFA's event is called off, wet weather") : bad(JSON.stringify(e))
  const p = await pushes(e.id, 'event_cancelled')
  p.length > 0 && /wet/i.test(p[0].body) ? ok(`${p.length} families told: "${p[0].body.slice(0, 60)}"`) : bad(`pushes: ${JSON.stringify(p.slice(0, 1))}`)
  const { data: again } = await owner.rpc('call_off_fixtures', { p_competition: comp.id, p_date: satDate, p_reason: 'wet_weather', p_venue: 'ELS Hall' })
  again?.affected === 0 ? ok('a second press calls off nothing new') : bad(`second press affected ${again?.affected}`)
}

head('3. Reschedule: back on, moved, and the chat told')
{
  const newTime = at(sunDate, 14)
  const { error } = await owner.rpc('reschedule_fixture', { p_fixture: g1, p_starts_at: newTime, p_venue_label: 'Magdala Park' })
  error ? bad(`reschedule: ${error.message}`) : ok('round 1 at ELS Hall moved to Sunday 2pm at Magdala Park')
  const { data: f } = await admin.from('fixtures').select('status, cancel_reason, venue_label').eq('id', g1).single()
  f?.status === 'scheduled' && f?.cancel_reason === null && f?.venue_label === 'Magdala Park' ? ok('scheduled again, reason cleared') : bad(JSON.stringify(f))
  const e = await eventFor(g1)
  e && !e.cancelled_at && new Date(e.starts_at).getTime() === new Date(newTime).getTime() && e.venue === 'Magdala Park' ? ok("NRIFA's event is back on at the new time and ground") : bad(JSON.stringify(e))
  const back = await pushes(e.id, 'event_back_on')
  back.length > 0 ? ok(`${back.length} families told it is back on`) : bad('nobody told it is back on')
}

head('4. Forfeit: scored for the ladder; bye: not a game')
{
  const { error } = await owner.rpc('forfeit_fixture', { p_fixture: g3, p_forfeiting_entry: wanderers.id, p_note: 'Wanderers could not raise a side' })
  error ? bad(`forfeit: ${error.message}`) : ok('Wanderers forfeit to NRIFA')
  const { data: f } = await admin.from('fixtures').select('status, home_score, away_score').eq('id', g3).single()
  f?.status === 'forfeit' && f?.home_score === 0 && f?.away_score === 3 ? ok('3–0 to NRIFA (away), status forfeit') : bad(JSON.stringify(f))
  const { data: ladder } = await owner.rpc('competition_ladder', { p_competition: comp.id, p_division: 'U8' })
  const n = ladder?.find((l) => l.entry_id === nrifa.id)
  n?.points === 3 && n?.played === 1 && n?.goals_for === 3 ? ok('NRIFA: 3 points, 1 played, +3') : bad(JSON.stringify(n))
  await owner.from('competition_divisions').upsert({ competition_id: comp.id, division: 'U8', forfeit_score: 5, allow_playing_up: true }, { onConflict: 'competition_id,division' })
  const { error: bye } = await owner.rpc('set_bye', { p_fixture: g4 })
  bye ? bad(`bye: ${bye.message}`) : ok('round 2 is a bye')
  const { data: l2 } = await owner.rpc('competition_ladder', { p_competition: comp.id, p_division: 'U8' })
  l2?.find((l) => l.entry_id === nrifa.id)?.played === 1 ? ok('a bye is not a game played') : bad('the bye counted')
  const { error: late } = await owner.rpc('postpone_fixture', { p_fixture: g3, p_reason: 'other' })
  late ? ok('a played game cannot be postponed') : bad('postponed a played game')
  const { error: pErr } = await parent.rpc('forfeit_fixture', { p_fixture: g2, p_forfeiting_entry: rovers.id })
  pErr?.code === '42501' ? ok('a parent cannot award a forfeit') : bad('a parent awarded a forfeit')
}

await cleanup()
console.log(process.exitCode ? '\n\x1b[31mMATCH DAY IS WRONG\x1b[0m\n' : '\n\x1b[32mall good\x1b[0m\n')
