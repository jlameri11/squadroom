// Run: node --env-file=.env.local scripts/test-league-roles.mjs
//
// L-13: league roles. Owners and admins do everything; a referee
// coordinator runs referees and nothing else; a discipline officer runs
// discipline; a ground manager runs match-day ops; a competition manager
// runs the competition. Every official sees the draw. Only staff hand
// roles out, and a role never shows anyone a club's families.
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
const RAVENS = '00000000-0000-0000-0000-0000000a0002'
const SPL = '00000000-0000-0000-0000-0000000a0003'
const OWNER = '00000000-0000-0000-0000-0000000000a1'
const U8 = '00000000-0000-0000-0000-0000000d0008'
const TAG = 'LROLES'
const EMAILS = { staff: 'lroles-staff@squadroom.invalid', refs: 'lroles-refs@squadroom.invalid', disc: 'lroles-disc@squadroom.invalid', ground: 'lroles-ground@squadroom.invalid', comp: 'lroles-comp@squadroom.invalid' }

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
  await admin.from('referees').delete().like('full_name', `% ${TAG}`)
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 })
  for (const e of Object.values(EMAILS)) {
    const u = users?.users?.find((x) => x.email === e)
    if (u) {
      await admin.from('league_roles').delete().eq('profile_id', u.id)
      await admin.from('academy_members').delete().eq('profile_id', u.id)
      await admin.from('staff_clearances').delete().eq('profile_id', u.id)
      await admin.auth.admin.deleteUser(u.id)
    }
  }
}
await cleanup()

const ids = {}
for (const [k, email] of Object.entries(EMAILS)) {
  const { data } = await admin.auth.admin.createUser({ email, email_confirm: true })
  ids[k] = data.user.id
  await admin.from('profiles').upsert({ id: data.user.id, full_name: `${k[0].toUpperCase()}${k.slice(1)} Official ${TAG}` })
}
// The staff member is an SPL admin (with a clearance, 0120); the rest are plain members of the league.
await admin.from('staff_clearances').insert({ academy_id: SPL, profile_id: ids.staff, kind: 'wwcc', number: 'WWC0000780E', outcome: 'cleared', expires_on: new Date(Date.now() + 400 * 864e5).toISOString().slice(0, 10), verified_by: OWNER })
await admin.from('academy_members').insert([
  { academy_id: SPL, profile_id: ids.staff, role: 'admin', status: 'active' },
  ...['refs', 'disc', 'ground', 'comp'].map((k) => ({ academy_id: SPL, profile_id: ids[k], role: 'parent', status: 'active' })),
])

const { data: comp } = await admin.from('competitions').insert({ organiser_id: SPL, name: `${TAG} League`, type: 'season', season: '2026', status: 'active', mode: 'managed', visibility: 'participants', created_by: OWNER }).select('id').single()
await admin.from('competition_clubs').insert([
  { competition_id: comp.id, academy_id: NRIFA, status: 'active', joined_at: new Date().toISOString() },
  { competition_id: comp.id, academy_id: RAVENS, status: 'active', joined_at: new Date().toISOString() },
])
const { data: entries } = await admin.from('competition_entries').insert([
  { competition_id: comp.id, academy_id: NRIFA, team_id: U8, display_name: 'NRIFA U8', division: 'U8' },
  { competition_id: comp.id, academy_id: RAVENS, team_id: null, display_name: 'Ravens U8', division: 'U8' },
]).select('id')
const [home, away] = entries
const nextSat = new Date(); nextSat.setDate(nextSat.getDate() + ((6 - nextSat.getDay() + 7) % 7 || 7)); nextSat.setHours(9, 0, 0, 0)
const { data: fx } = await admin.from('fixtures').insert([
  { competition_id: comp.id, division: 'U8', round: 'R1', home_entry_id: home.id, away_entry_id: away.id, starts_at: nextSat.toISOString(), status: 'scheduled', stage: 'group' },
  { competition_id: comp.id, division: 'U8', round: 'R1', home_entry_id: away.id, away_entry_id: home.id, starts_at: new Date(nextSat.getTime() + 3 * 3600_000).toISOString(), status: 'scheduled', stage: 'group' },
  { competition_id: comp.id, division: 'U8', round: 'R0', home_entry_id: home.id, away_entry_id: away.id, starts_at: new Date(nextSat.getTime() - 7 * 864e5).toISOString(), status: 'final', home_score: 1, away_score: 0, stage: 'group' },
]).select('id')
await admin.from('entry_squads').insert({ competition_id: comp.id, entry_id: home.id, academy_id: NRIFA, player_id: (await admin.from('players').select('id').eq('team_id', U8).limit(1).single()).data.id })
const kid = (await admin.from('entry_squads').select('player_id').eq('entry_id', home.id).single()).data.player_id

const c = {}
for (const k of Object.keys(EMAILS)) c[k] = await signInEmail(EMAILS[k])
if (Object.values(c).some((x) => !x)) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  await cleanup()
  process.exit(2)
}

head('1. Roles are handed out by staff, to members of the league')
{
  const { error: notStaff } = await c.comp.rpc('grant_league_role', { p_competition: comp.id, p_profile: ids.refs, p_role: 'referee_coordinator' })
  notStaff?.code === '42501' ? ok('a plain member cannot hand out a role') : bad(`a member granted a role: ${notStaff?.message ?? 'no error'}`)
  const { error: stranger } = await c.staff.rpc('grant_league_role', { p_competition: comp.id, p_profile: '00000000-0000-0000-0000-0000000000b1', p_role: 'referee_coordinator' })
  stranger ? ok(`a NRIFA parent, not in the league, cannot be given one: "${stranger.message}"`) : bad('a non-member was given a league role')
  for (const [k, r] of [['refs', 'referee_coordinator'], ['disc', 'discipline_officer'], ['ground', 'ground_manager'], ['comp', 'competition_manager']]) {
    const { error } = await c.staff.rpc('grant_league_role', { p_competition: comp.id, p_profile: ids[k], p_role: r })
    if (error) bad(`${r}: ${error.message}`)
  }
  ok('staff hand out all four roles')
  const { data: list } = await c.staff.rpc('league_officials', { p_competition: comp.id })
  list?.officials?.length === 4 && list.members.length >= 5 ? ok(`the list shows 4 officials and ${list.members.length} members to pick from`) : bad(JSON.stringify(list)?.slice(0, 200))
  const { data: none } = await c.comp.rpc('league_officials', { p_competition: comp.id })
  none === null ? ok('a competition manager does not see the officials list (staff only)') : bad('a non-staff official read the officials list')
  const { data: acc, error: accErr } = await c.refs.rpc('my_competition_access', { p_competition: comp.id })
  JSON.stringify(acc?.areas) === '["referees"]' ? ok('the coordinator\'s access is exactly ["referees"]') : bad(`access: ${JSON.stringify(acc)} ${accErr?.message ?? ''}`)
  const { data: sacc, error: saccErr } = await c.staff.rpc('my_competition_access', { p_competition: comp.id })
  if (saccErr) console.log('   staff access error:', saccErr.message)
  const every = ['staff', 'competition', 'referees', 'discipline', 'grounds'].every((a) => sacc?.areas?.includes(a))
  every ? ok('staff hold every area') : bad(JSON.stringify(sacc))
}

head('2. Every official sees the draw; none sees a club\'s people')
{
  for (const k of ['refs', 'disc', 'ground', 'comp']) {
    const { data: sheet } = await c[k].rpc('competition_run_sheet', { p_competition: comp.id })
    if ((sheet ?? []).length !== 3) bad(`${k} sees ${sheet?.length ?? 0} games on the run sheet`)
  }
  ok('all four read the run sheet')
  const { data: ppl } = await c.refs.from('players').select('id').eq('academy_id', NRIFA)
  const refsSees = ppl ?? []
  refsSees.length === 0 ? ok('the coordinator sees no NRIFA player rows') : bad(`the coordinator read ${refsSees.length} NRIFA players`)
  const { data: msgs } = await c.comp.from('channels').select('id').eq('academy_id', NRIFA)
  const compSees = msgs ?? []
  compSees.length === 0 ? ok('the competition manager sees no NRIFA channels') : bad('a league official read a club\'s channels')
}

head('3. Each role runs its area and no other')
let poolId
{
  // Referees: the coordinator, not the discipline officer.
  const { data: ref, error: e1 } = await c.refs.rpc('add_referee', { p_competition: comp.id, p_full_name: `Ref Person ${TAG}` })
  e1 ? bad(`coordinator add_referee: ${e1.message}`) : ok('the referee coordinator adds a referee')
  poolId = ref
  const { error: e2 } = await c.disc.rpc('add_referee', { p_competition: comp.id, p_full_name: `Nope ${TAG}` })
  e2?.code === '42501' ? ok('the discipline officer cannot') : bad(`the discipline officer added a referee: ${e2?.message ?? 'no error'}`)
  const { error: e3 } = await c.refs.rpc('appoint_referee', { p_fixture: fx[0].id, p_referee: poolId })
  e3 ? bad(`coordinator appoint: ${e3.message}`) : ok('the coordinator appoints')
  const { error: e4 } = await c.ground.rpc('appoint_referee', { p_fixture: fx[1].id, p_referee: poolId })
  e4?.code === '42501' ? ok('the ground manager cannot appoint') : bad('the ground manager appointed a referee')
  const { data: pool } = await c.refs.rpc('referee_pool', { p_competition: comp.id })
  const poolRows = pool ?? []
  poolRows.length === 1 ? ok('the coordinator reads the pool') : bad(`pool for coordinator: ${JSON.stringify(pool)}`)
  const { data: noPool } = await c.comp.rpc('referee_pool', { p_competition: comp.id })
  noPool === null ? ok('the competition manager does not (referees are the coordinator\'s)') : bad('the competition manager read the pool')

  // Discipline: the officer, not the coordinator.
  const { error: d1 } = await c.disc.rpc('add_suspension', { p_competition: comp.id, p_player: kid, p_games: 1, p_reason: 'tribunal', p_note: 'test' })
  d1 ? bad(`officer add_suspension: ${d1.message}`) : ok('the discipline officer adds a tribunal suspension')
  const { error: d2 } = await c.refs.rpc('add_suspension', { p_competition: comp.id, p_player: kid, p_games: 1, p_reason: 'tribunal', p_note: 'test' })
  d2?.code === '42501' ? ok('the coordinator cannot') : bad('the coordinator added a suspension')
  const { error: d3 } = await c.disc.from('competition_discipline_rules').upsert({ competition_id: comp.id, games_per_red: 2 }, { onConflict: 'competition_id' })
  d3 ? bad(`officer rules: ${d3.message}`) : ok('the officer sets the discipline rules')
  const { error: d4 } = await c.ground.from('competition_discipline_rules').update({ games_per_red: 3 }).eq('competition_id', comp.id)
  const { data: rules } = await admin.from('competition_discipline_rules').select('games_per_red').eq('competition_id', comp.id).single()
  rules.games_per_red === 2 ? ok('the ground manager cannot change them') : bad(`ground manager changed the rules (${d4?.message ?? 'silently'})`)

  // Grounds: the ground manager and the competition manager, not the officer.
  const { error: g1 } = await c.ground.rpc('postpone_fixture', { p_fixture: fx[1].id, p_reason: 'wet_weather', p_cancel: false })
  g1 ? bad(`ground postpone: ${g1.message}`) : ok('the ground manager postpones a game')
  const { error: g2 } = await c.disc.rpc('reschedule_fixture', { p_fixture: fx[1].id, p_starts_at: new Date(nextSat.getTime() + 14 * 864e5).toISOString() })
  g2?.code === '42501' ? ok('the discipline officer cannot reschedule') : bad('the discipline officer rescheduled')
  const { error: g3 } = await c.comp.rpc('reschedule_fixture', { p_fixture: fx[1].id, p_starts_at: new Date(nextSat.getTime() + 14 * 864e5).toISOString() })
  g3 ? bad(`competition manager reschedule: ${g3.message}`) : ok('the competition manager can (grounds are part of running the competition)')

  // The competition: the manager, not the ground manager.
  const { error: c1 } = await c.comp.from('ladder_adjustments').insert({ competition_id: comp.id, division: 'U8', entry_id: home.id, points: -1, reason: 'test' })
  c1 ? bad(`manager adjustment: ${c1.message}`) : ok('the competition manager adjusts the ladder')
  const { error: c2 } = await c.ground.from('ladder_adjustments').insert({ competition_id: comp.id, division: 'U8', entry_id: home.id, points: -1, reason: 'test' })
  c2 ? ok('the ground manager cannot') : bad('the ground manager adjusted the ladder')
  const { error: c3 } = await c.comp.rpc('rule_on_score', { p_fixture: fx[2].id, p_home: 2, p_away: 0, p_note: 'ruled' })
  c3 ? bad(`manager rule_on_score: ${c3.message}`) : ok('the competition manager rules on a score')
  const { error: c4 } = await c.refs.rpc('rule_on_score', { p_fixture: fx[2].id, p_home: 3, p_away: 0, p_note: 'ruled' })
  c4?.code === '42501' ? ok('the coordinator cannot') : bad('the coordinator ruled on a score')
  const { data: card } = await c.comp.rpc('player_card', { p_player: kid })
  card?.id === kid ? ok('the competition manager opens a season-squad child\'s card (L-04)') : bad('the competition manager cannot open the card')
  const { error: card2 } = await c.ground.rpc('player_card', { p_player: kid })
  card2?.code === '42501' ? ok('the ground manager cannot') : bad('the ground manager opened a card')
}

head('4. Revoked, the access goes with it')
{
  const { error } = await c.staff.rpc('revoke_league_role', { p_competition: comp.id, p_profile: ids.refs, p_role: 'referee_coordinator' })
  error ? bad(`revoke: ${error.message}`) : ok('staff revoke the coordinator\'s role')
  const { error: gone } = await c.refs.rpc('add_referee', { p_competition: comp.id, p_full_name: `Late ${TAG}` })
  gone?.code === '42501' ? ok('and the former coordinator can no longer add a referee') : bad('a revoked coordinator still adds referees')
  const { data: sheet } = await c.refs.rpc('competition_run_sheet', { p_competition: comp.id })
  const sheetRows = sheet ?? []
  sheetRows.length === 3 ? ok('they still see the draw as a member of the league') : bad('a league member lost the draw')
}

await cleanup()
console.log(process.exitCode ? '\n\x1b[31mLEAGUE ROLES ARE WRONG\x1b[0m\n' : '\n\x1b[32mall good\x1b[0m\n')
