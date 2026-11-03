// Run: node --env-file=.env.local scripts/test-regrading.mjs
//
// R-19: the new season is graded, not copied (0197). The preview is a plan
// the owner edits — move players between the new squads, split one, merge
// two, leave a player out, keep or release the players ageing out of the
// oldest group, open a new intake — and nothing changes until it is
// confirmed. The same move is a tool outside rollover, and in both the
// chat, the number and the calendar follow the child.
import { createClient } from '@supabase/supabase-js'
import { signInAs } from './_auth.mjs'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const head = (m) => console.log(`\n${m}`)

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const OWNER = '00000000-0000-0000-0000-0000000000a1'
const PARENT = '00000000-0000-0000-0000-0000000000b1'
const RAVENS = '00000000-0000-0000-0000-0000000a0002'
const FROM = 'RG-1'
const TO = 'RG-2'

const owner = await signInAs(admin, OWNER)
const parent = await signInAs(admin, PARENT)
if (!owner || !parent) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}

async function cleanup() {
  const { data: teams } = await admin.from('teams').select('id').eq('academy_id', NRIFA).in('season', [FROM, TO])
  const ids = (teams ?? []).map((t) => t.id)
  const { data: ps } = await admin.from('players').select('id').like('full_name', '% Regrade')
  for (const p of ps ?? []) {
    await admin.from('program_registrations').delete().eq('player_id', p.id)
    await admin.from('player_guardians').delete().eq('player_id', p.id)
    await admin.from('squad_numbers').delete().eq('player_id', p.id)
  }
  await admin.from('players').delete().like('full_name', '% Regrade')
  if (ids.length) {
    await admin.from('events').delete().in('team_id', ids)
    await admin.from('programs').delete().in('team_id', ids)
    await admin.from('team_members').delete().in('team_id', ids)
    await admin.from('teams').delete().in('id', ids)
  }
  await admin.from('squad_numbers').delete().eq('academy_id', NRIFA).in('season', [FROM, TO])
}
await cleanup()

// RG-1: U9 Sky (3), U9 Navy (2), U12 Girls (3, the oldest group). Ava's
// parent is the seed U8 parent, who is an active member of the club, so the
// chat can be seen to follow.
const mk = async (name, age) => (await admin.from('teams').insert({ academy_id: NRIFA, name, age_group: age, season: FROM, status: 'active', capacity: 12 }).select('id').single()).data
const sky = await mk('REGRADE U9 Sky', 'U9')
const navy = await mk('REGRADE U9 Navy', 'U9')
const girls = await mk('REGRADE U12 Girls', 'U12')
const kid = async (team, name, dob) => (await admin.from('players').insert({ academy_id: NRIFA, team_id: team.id, full_name: `${name} Regrade`, dob }).select('id, full_name').single()).data
const ava = await kid(sky, 'Ava', '2017-01-01')
const ben = await kid(sky, 'Ben', '2017-02-02')
const cal = await kid(sky, 'Cal', '2017-03-03')
const dee = await kid(navy, 'Dee', '2017-04-04')
const eli = await kid(navy, 'Eli', '2017-05-05')
const fay = await kid(girls, 'Fay', '2014-06-06')
const gus = await kid(girls, 'Gus', '2014-07-07')
const hal = await kid(girls, 'Hal', '2014-08-08')
await admin.from('player_guardians').insert({ academy_id: NRIFA, player_id: ava.id, profile_id: PARENT, relationship: 'parent' })
await admin.from('squad_numbers').insert([
  { academy_id: NRIFA, player_id: ava.id, season: FROM, number: 7, assigned_by: OWNER },
  { academy_id: NRIFA, player_id: dee.id, season: FROM, number: 9, assigned_by: OWNER },
])

head('1. The preview is a plan: every squad, every player, the oldest group on its own')
const { data: pv, error: pe } = await owner.rpc('preview_season_plan', { p_academy: NRIFA, p_from: FROM, p_to: TO })
if (pe) { bad(`preview: ${pe.message}`); await cleanup(); process.exit(1) }
const pSky = pv.squads.find((s) => s.from[0] === sky.id)
const pNavy = pv.squads.find((s) => s.from[0] === navy.id)
const pGirls = pv.squads.find((s) => s.from[0] === girls.id)
pSky?.name === 'REGRADE U10 Sky' && pSky.age_group === 'U10' ? ok('U9 Sky → U10 Sky by default') : bad(`sky: ${JSON.stringify(pSky)}`)
pSky?.players.length === 3 && pSky.players.some((p) => p.id === ava.id && p.number === 7) ? ok('with its three players and Ava’s number 7') : bad('sky players missing')
pv.oldest_age_group === 'U12' && pGirls?.oldest === true ? ok('U12 is the club’s oldest group') : bad(`oldest: ${pv.oldest_age_group}`)
pv.ageing_out.length === 3 && pv.ageing_out.every((p) => p.from_key === `t:${girls.id}`) ? ok('its three players are listed as ageing out, separately') : bad(`ageing out: ${JSON.stringify(pv.ageing_out)}`)
const { count: before } = await admin.from('teams').select('*', { count: 'exact', head: true }).eq('academy_id', NRIFA).eq('season', TO)
before === 0 ? ok('and nothing has changed') : bad(`${before} squads already in ${TO}`)
const { error: parentPreview } = await parent.rpc('preview_season_plan', { p_academy: NRIFA, p_from: FROM, p_to: TO })
parentPreview?.code === '42501' ? ok('a parent cannot see the plan') : bad(`parent preview: ${parentPreview?.code ?? 'allowed'}`)

head('2. The plan is checked before anything moves')
const base = { p_academy: NRIFA, p_from: FROM, p_to: TO }
let r = await owner.rpc('roll_over_season', { ...base, p_plan: { squads: [{ key: 'a', name: 'X', age_group: 'U10', from: [sky.id] }], players: { [ava.id]: 'a' } } })
r.error && /no destination/.test(r.error.message) ? ok(`a child without a destination stops it: "${r.error.message.slice(0, 60)}…"`) : bad(`missing player: ${r.error?.message ?? 'accepted'}`)
r = await owner.rpc('roll_over_season', { ...base, p_plan: { ...pv, squads: pv.squads, players: Object.fromEntries([ava, ben, cal, dee, eli, fay, gus, hal].map((p) => [p.id, 'nowhere'])) } })
r.error && /not in the plan/.test(r.error.message) ? ok('a destination that is not a squad stops it') : bad(`bad key: ${r.error?.message ?? 'accepted'}`)
const { data: ravenTeam } = await admin.from('teams').select('id').eq('academy_id', RAVENS).limit(1).single()
r = await owner.rpc('roll_over_season', { ...base, p_plan: { squads: [{ key: 'a', name: 'X', age_group: 'U10', from: [ravenTeam.id] }], players: {} } })
r.error ? ok('another club’s squad in the plan stops it') : bad('a Ravens squad was accepted in an NRIFA plan')
const { count: still } = await admin.from('teams').select('*', { count: 'exact', head: true }).eq('academy_id', NRIFA).eq('season', TO)
still === 0 ? ok('and still nothing has changed') : bad(`${still} squads in ${TO} after refused plans`)

head('3. Re-grading, split, merge, leave out, ageing out, new intake — then confirm')
// Ben: Sky → Navy's new squad. Navy splits: Dee stays, Eli goes to the new
// half. Cal leaves the club. Girls: Fay moves up to U13, Gus keeps playing
// U12 (a new U12 squad), Hal leaves. A U7 intake opens for new families.
const keep = { key: `keep:${girls.id}`, name: 'REGRADE U12 Girls', age_group: 'U12', from: [girls.id], capacity: 12 }
const split = { key: 'new:1', name: 'REGRADE U10 Navy B', age_group: 'U10', from: [navy.id], capacity: 12 }
const plan = {
  squads: [
    { key: pSky.key, name: pSky.name, age_group: pSky.age_group, from: pSky.from, capacity: pSky.capacity },
    { key: pNavy.key, name: pNavy.name, age_group: pNavy.age_group, from: pNavy.from, capacity: pNavy.capacity },
    split,
    { key: pGirls.key, name: pGirls.name, age_group: pGirls.age_group, from: pGirls.from, capacity: pGirls.capacity },
    keep,
  ],
  players: {
    [ava.id]: pSky.key, [ben.id]: pNavy.key, [cal.id]: null,
    [dee.id]: pNavy.key, [eli.id]: split.key,
    [fay.id]: pGirls.key, [gus.id]: keep.key, [hal.id]: null,
  },
  intake: [{ name: 'REGRADE U7 Rookies', age_group: 'U7', capacity: 10 }],
}
const { data: done, error: de } = await owner.rpc('roll_over_season', { ...base, p_plan: plan })
if (de) { bad(`roll over: ${de.message}`); await cleanup(); process.exit(1) }
done.teams === 5 && done.intake === 1 ? ok('5 graded squads and 1 intake squad made') : bad(`made: ${JSON.stringify(done)}`)
done.players === 6 && done.left_out === 2 ? ok('6 players placed, 2 left out — and said so') : bad(`players: ${JSON.stringify(done)}`)
const newId = (key) => done.squads.find((s) => s.key === key)?.id
const teamOf = async (p) => (await admin.from('players').select('team_id').eq('id', p.id).single()).data.team_id
;(await teamOf(ben)) === newId(pNavy.key) ? ok('Ben was re-graded from Sky into U10 Navy') : bad('Ben is not in U10 Navy')
;(await teamOf(eli)) === newId(split.key) && (await teamOf(dee)) === newId(pNavy.key) ? ok('Navy split: Dee in Navy, Eli in Navy B') : bad('the split did not land')
;(await teamOf(cal)) === null && (await teamOf(hal)) === null ? ok('Cal and Hal are on no squad') : bad('a left-out player is still on a squad')
;(await teamOf(fay)) === newId(pGirls.key) ? ok('Fay moved up to U13') : bad('Fay did not move up')
;(await teamOf(gus)) === newId(keep.key) ? ok('Gus keeps playing in a new U12 squad') : bad('Gus did not keep')
const { data: u13 } = await admin.from('teams').select('age_group, rolled_from').eq('id', newId(pGirls.key)).single()
u13?.age_group === 'U13' && u13.rolled_from === girls.id ? ok('the U13 squad descends from U12 Girls') : bad(`u13: ${JSON.stringify(u13)}`)
const { data: nb } = await admin.from('teams').select('rolled_from').eq('id', newId(split.key)).single()
nb?.rolled_from === navy.id ? ok('so does the split half, so the re-registration report chases it too') : bad('the split squad has no origin')
const { data: intake } = await admin.from('teams').select('id, age_group').eq('academy_id', NRIFA).eq('season', TO).eq('name', 'REGRADE U7 Rookies').maybeSingle()
intake ? ok('the U7 intake squad exists') : bad('no intake squad')
const { data: intakeProg } = await admin.from('programs').select('status, kind, born_from_year, capacity').eq('team_id', intake?.id ?? '00000000-0000-0000-0000-000000000000').maybeSingle()
intakeProg?.status === 'open' && intakeProg.kind === 'squad' ? ok(`with an open squad program (capacity ${intakeProg.capacity}) for new families`) : bad(`intake program: ${JSON.stringify(intakeProg)}`)
const { data: oldTeams } = await admin.from('teams').select('status').in('id', [sky.id, navy.id, girls.id])
oldTeams.every((t) => t.status === 'ended') ? ok('the old squads have ended') : bad('an old squad is still active')
const { data: num } = await admin.from('squad_numbers').select('number').eq('player_id', ava.id).eq('season', TO)
num?.[0]?.number === 7 ? ok('Ava’s number 7 came with her') : bad('Ava lost her number')
const { data: deeNum } = await admin.from('squad_numbers').select('number').eq('player_id', dee.id).eq('season', TO)
deeNum?.[0]?.number === 9 ? ok('and Dee’s 9 came to the split squad') : bad('Dee lost her number')
const { data: chat } = await admin.from('team_members').select('role').eq('team_id', newId(pSky.key)).eq('profile_id', PARENT)
chat?.length === 1 ? ok('Ava’s parent is in the new squad’s chat (0098 followed the child)') : bad('the chat did not follow')
const { data: twice, error: te } = await owner.rpc('roll_over_season', { ...base, p_plan: plan })
te ? ok('rolling the same plan again is refused') : bad(`rolled twice: ${JSON.stringify(twice)}`)
const { data: report } = await owner.rpc('rollover_report', { p_academy: NRIFA, p_season: TO })
const chased = (report ?? []).map((t) => t.team).sort()
chased.includes('REGRADE U10 Navy B') && chased.includes('REGRADE U12 Girls') && !chased.includes('REGRADE U7 Rookies') ? ok('the re-registration report chases the split and kept squads, not the intake') : bad(`report chases: ${chased.join(', ')}`)

head('4. The default plan is 0139’s rollover, unchanged')
const { data: dflt } = await owner.rpc('preview_season_plan', { p_academy: NRIFA, p_from: TO, p_to: 'RG-3' })
dflt.squads.length === 6 && dflt.squads.every((s) => s.players.length >= 0) ? ok('the next season’s preview lists all six squads') : bad(`preview: ${dflt?.squads?.length}`)
await admin.from('teams').delete().eq('academy_id', NRIFA).eq('season', 'RG-3')

head('5. Moving players mid-season: preview, then confirm; chat, number and calendar follow')
const skyNew = newId(pSky.key), navyNew = newId(pNavy.key)
await admin.from('events').insert({ academy_id: NRIFA, team_id: navyNew, type: 'match', title: 'REGRADE Navy vs Someone', starts_at: new Date(Date.now() + 5 * 864e5).toISOString(), ends_at: new Date(Date.now() + 5 * 864e5 + 3600e3).toISOString(), created_by: OWNER })
const moves = [{ player_id: ava.id, team_id: navyNew }, { player_id: cal.id, team_id: skyNew }]
const { data: mp, error: me } = await owner.rpc('preview_player_moves', { p_academy: NRIFA, p_moves: moves })
me ? bad(`move preview: ${me.message}`) : ok('the owner previews two moves')
const mAva = (mp ?? []).find((m) => m.player_id === ava.id)
mAva?.from?.id === skyNew && mAva.to?.id === navyNew ? ok(`Ava: ${mAva.from.name} → ${mAva.to.name}`) : bad(`ava preview: ${JSON.stringify(mAva)}`)
mAva?.guardians_follow === 1 && mAva.number === 7 && mAva.number_kept && mAva.upcoming_events === 1 ? ok('her parent will join the chat, number 7 stays, 1 upcoming game appears') : bad(`ava follow: ${JSON.stringify(mAva)}`)
;(await teamOf(ava)) === skyNew ? ok('and nothing has moved yet') : bad('the preview moved her')
const { error: pm } = await parent.rpc('move_players', { p_academy: NRIFA, p_moves: moves })
pm?.code === '42501' ? ok('a parent cannot move players') : bad(`parent move: ${pm?.code ?? 'allowed'}`)
const { data: ravenKid } = await admin.from('players').select('id').eq('academy_id', RAVENS).limit(1).single()
const { error: xe } = await owner.rpc('move_players', { p_academy: NRIFA, p_moves: [{ player_id: ravenKid.id, team_id: skyNew }] })
xe ? ok('another club’s player cannot be pulled in') : bad('a Ravens player was moved into NRIFA')
const { error: ye } = await owner.rpc('move_players', { p_academy: NRIFA, p_moves: [{ player_id: ava.id, team_id: ravenTeam.id }] })
ye ? ok('nor can one of ours be pushed into another club’s squad') : bad('Ava was moved to a Ravens squad')
const { error: ze } = await owner.rpc('move_players', { p_academy: NRIFA, p_moves: [{ player_id: ava.id, team_id: sky.id }] })
ze ? ok('an ended squad is refused') : bad('Ava was moved to an ended squad')
const { data: mv, error: mve } = await owner.rpc('move_players', { p_academy: NRIFA, p_moves: moves })
mve ? bad(`move: ${mve.message}`) : mv.moved === 2 && mv.guardians_joined === 1 ? ok('both moved; one parent joined a chat') : bad(`move result: ${JSON.stringify(mv)}`)
;(await teamOf(ava)) === navyNew && (await teamOf(cal)) === skyNew ? ok('Ava is in Navy, Cal is back on a squad') : bad('the moves did not land')
const { data: navyChat } = await admin.from('team_members').select('role').eq('team_id', navyNew).eq('profile_id', PARENT)
navyChat?.length === 1 ? ok('Ava’s parent is in Navy’s chat') : bad('the chat did not follow the mid-season move')
const { data: cal7 } = await admin.from('squad_numbers').select('number').eq('player_id', ava.id).eq('season', TO)
cal7?.[0]?.number === 7 ? ok('her number is unchanged') : bad('her number changed')
const { data: upcoming } = await parent.rpc('my_upcoming_events', { p_academy: NRIFA })
;(upcoming ?? []).some((e) => e.title === 'REGRADE Navy vs Someone') ? ok('and Navy’s game is on the family’s calendar') : bad('the calendar did not follow')
const { data: again } = await owner.rpc('move_players', { p_academy: NRIFA, p_moves: moves })
again?.moved === 0 ? ok('moving them again moves nobody') : bad(`second move: ${JSON.stringify(again)}`)

await cleanup()
process.exit(process.exitCode ?? 0)
