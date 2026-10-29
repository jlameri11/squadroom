// Run: node --env-file=.env.local scripts/test-season-rollover.mjs
//
// R-12: a new season starts from the old one — clone, move, keep, ask, end
// — and the club can see and chase who has not re-registered.
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
const OWNER = '00000000-0000-0000-0000-0000000000a1'
const PARENT = '00000000-0000-0000-0000-0000000000b1'
const FROM = 'RT-1'
const TO = 'RT-2'

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
  const { data: teams } = await admin.from('teams').select('id').eq('academy_id', NRIFA).in('season', [FROM, TO])
  const ids = (teams ?? []).map((t) => t.id)
  if (ids.length) {
    const { data: ps } = await admin.from('players').select('id').in('team_id', ids)
    for (const p of ps ?? []) {
      await admin.from('notification_queue').delete().eq('kind', 'reregister_nudge').filter('payload->>player_id', 'eq', p.id)
      await admin.from('program_registrations').delete().eq('player_id', p.id)
      await admin.from('player_guardians').delete().eq('player_id', p.id)
      await admin.from('squad_numbers').delete().eq('player_id', p.id)
    }
    await admin.from('players').delete().in('team_id', ids)
    await admin.from('programs').delete().in('team_id', ids)
    await admin.from('squad_numbers').delete().eq('academy_id', NRIFA).in('season', [FROM, TO])
    await admin.from('teams').delete().in('id', ids)
  }
}
await cleanup()

// Two squads in RT-1: U8 SPL with three players and numbers 7, 9, 10; U12
// Girls with one player. Number 9 is already taken in RT-2 by somebody
// else, so it cannot carry.
const { data: u8 } = await admin.from('teams').insert({ academy_id: NRIFA, name: 'ROLLTEST U8 SPL', age_group: 'U8', season: FROM, status: 'active', capacity: 14 }).select('id').single()
const { data: u12 } = await admin.from('teams').insert({ academy_id: NRIFA, name: 'ROLLTEST U12 Girls', age_group: 'U12', season: FROM, status: 'active' }).select('id').single()
const { data: kids } = await admin
  .from('players')
  .insert([
    // First name first: the nudge is addressed by the first word.
    { academy_id: NRIFA, team_id: u8.id, full_name: 'Ava Rolltest', dob: '2018-01-01' },
    { academy_id: NRIFA, team_id: u8.id, full_name: 'Ben Rolltest', dob: '2018-02-02' },
    { academy_id: NRIFA, team_id: u8.id, full_name: 'Cal Rolltest', dob: '2018-03-03' },
    { academy_id: NRIFA, team_id: u12.id, full_name: 'Dee Rolltest', dob: '2014-04-04' },
  ])
  .select('id, full_name')
const [ava, ben, cal] = kids
await admin.from('player_guardians').insert({ academy_id: NRIFA, player_id: ava.id, profile_id: PARENT, relationship: 'parent' })
await admin.from('squad_numbers').insert([
  { academy_id: NRIFA, player_id: ava.id, season: FROM, number: 7, assigned_by: OWNER },
  { academy_id: NRIFA, player_id: ben.id, season: FROM, number: 9, assigned_by: OWNER },
  { academy_id: NRIFA, player_id: cal.id, season: FROM, number: 10, assigned_by: OWNER },
  // Somebody else holds 9 next season already.
  { academy_id: NRIFA, player_id: kids[3].id, season: TO, number: 9, assigned_by: OWNER },
])

head('1. The preview names what will happen, before anything does')
{
  const { data, error } = await owner.rpc('preview_season_rollover', { p_academy: NRIFA, p_from: FROM, p_to: TO })
  if (error) bad(`preview: ${error.message}`)
  const p8 = (data ?? []).find((t) => t.id === u8.id)
  p8?.new_name === 'ROLLTEST U9 SPL' && p8?.new_age_group === 'U9' ? ok('U8 SPL → U9 SPL') : bad(`preview: ${JSON.stringify(p8)}`)
  p8?.players === 3 && p8?.numbers === 3 && p8?.numbers_clashing === 1 ? ok('3 players, 3 numbers, 1 clashing') : bad(`counts: ${JSON.stringify(p8)}`)
  const { count: before } = await admin.from('teams').select('*', { count: 'exact', head: true }).eq('season', TO).eq('academy_id', NRIFA)
  before === 0 ? ok('and nothing was created') : bad(`${before} squads appeared in ${TO}`)
}

head('2. A parent cannot')
{
  const { error } = await parent.rpc('roll_over_season', { p_academy: NRIFA, p_from: FROM, p_to: TO })
  error?.code === '42501' ? ok(`refused: "${error.message}"`) : bad(error ? error.message : 'a parent rolled the season over')
}

head('3. Roll over: clone, move, keep, ask, end')
{
  const { data: r, error } = await owner.rpc('roll_over_season', { p_academy: NRIFA, p_from: FROM, p_to: TO })
  if (error) bad(`roll: ${error.message}`)
  r?.teams === 2 && r?.players === 4 ? ok(`2 squads, 4 players`) : bad(JSON.stringify(r))
  r?.numbers_kept === 2 && r?.numbers_not_kept === 1 ? ok('7 and 10 kept, 9 could not be') : bad(`numbers: ${JSON.stringify(r)}`)
  const { data: u9 } = await admin.from('teams').select('id, name, age_group, status, capacity, rolled_from').eq('rolled_from', u8.id).maybeSingle()
  u9?.name === 'ROLLTEST U9 SPL' && u9?.age_group === 'U9' && u9?.status === 'active' && u9?.capacity === 14
    ? ok('the U9s exist, active, with the U8s\' capacity')
    : bad(`u9: ${JSON.stringify(u9)}`)
  const { data: old } = await admin.from('teams').select('status').eq('id', u8.id).single()
  old?.status === 'ended' ? ok('the U8s are ended') : bad(`old squad is ${old?.status}`)
  const { data: moved } = await admin.from('players').select('team_id').in('id', [ava.id, ben.id, cal.id])
  moved?.every((p) => p.team_id === u9?.id) ? ok('all three children moved up') : bad('a child was left behind')
  const { data: nums } = await admin.from('squad_numbers').select('player_id, number').eq('season', TO).in('player_id', [ava.id, ben.id, cal.id])
  const byKid = Object.fromEntries((nums ?? []).map((n) => [n.player_id, n.number]))
  byKid[ava.id] === 7 && byKid[cal.id] === 10 && byKid[ben.id] === undefined ? ok('Ava keeps 7, Cal keeps 10, Ben needs a new one') : bad(JSON.stringify(byKid))
  const { data: prog } = await admin.from('programs').select('name, kind, status, season, capacity').eq('team_id', u9?.id).maybeSingle()
  prog?.kind === 'squad' && prog?.status === 'open' && prog?.season === TO ? ok(`the ask: "${prog.name}" is open`) : bad(`program: ${JSON.stringify(prog)}`)
  const { data: chan } = await admin.from('channels').select('id').eq('team_id', u9?.id).eq('type', 'team').maybeSingle()
  chan ? ok('the U9s have a team chat') : bad('no chat for the new squad')
  // A double tap: the old squads are ended now, so there is nothing to
  // roll, and the U9s must not be made twice.
  const { data: twice } = await owner.rpc('roll_over_season', { p_academy: NRIFA, p_from: FROM, p_to: TO })
  const { count: u9s } = await admin.from('teams').select('*', { count: 'exact', head: true }).eq('rolled_from', u8.id)
  twice?.teams === 0 && u9s === 1 ? ok('a second roll-over finds nothing to roll, and nothing is doubled') : bad(`second roll: ${JSON.stringify(twice)}, ${u9s} U9 squads`)
}

head('4. The report, and the nudge')
{
  const { data: u9 } = await admin.from('teams').select('id').eq('rolled_from', u8.id).single()
  let { data: rep } = await owner.rpc('rollover_report', { p_academy: NRIFA, p_season: TO })
  let r9 = (rep ?? []).find((t) => t.team_id === u9.id)
  r9?.total === 3 && r9?.registered === 0 && r9?.not_yet.length === 3 ? ok('0 of 3 re-registered') : bad(JSON.stringify(r9))
  r9?.not_yet.find((p) => p.player_id === ava.id)?.guardians?.[0]?.phone ? ok("with the parent's number to ring") : bad('no guardian on the report')

  const { data: n1 } = await owner.rpc('nudge_unregistered', { p_academy: NRIFA, p_season: TO })
  n1 === 1 ? ok('one nudge: Ava\'s parent (the others have no guardian linked)') : bad(`nudged ${n1}`)
  const { data: n2 } = await owner.rpc('nudge_unregistered', { p_academy: NRIFA, p_season: TO })
  n2 === 0 ? ok('pressing it again the same week nudges nobody') : bad(`nudged ${n2} again`)
  const { data: q } = await admin.from('notification_queue').select('title, url').eq('kind', 'reregister_nudge').filter('payload->>player_id', 'eq', ava.id).maybeSingle()
  q?.title === `Re-register Ava for ${TO}` && q?.url === '/programs' ? ok(`"${q.title}" → /programs`) : bad(JSON.stringify(q))

  // Ava re-registers: an approved registration in the squad's program.
  const { data: prog } = await admin.from('programs').select('id').eq('team_id', u9.id).single()
  await admin.from('program_registrations').insert({ academy_id: NRIFA, program_id: prog.id, player_id: ava.id, submitted_by: PARENT, status: 'approved' })
  ;({ data: rep } = await owner.rpc('rollover_report', { p_academy: NRIFA, p_season: TO }))
  r9 = (rep ?? []).find((t) => t.team_id === u9.id)
  r9?.registered === 1 && r9?.not_yet.length === 2 && !r9.not_yet.some((p) => p.player_id === ava.id)
    ? ok('once Ava is approved, 1 of 3 — and she is off the list')
    : bad(JSON.stringify(r9))
}

await cleanup()
console.log(process.exitCode ? '\n\x1b[31mROLLOVER IS WRONG\x1b[0m\n' : '\n\x1b[32mall good\x1b[0m\n')
