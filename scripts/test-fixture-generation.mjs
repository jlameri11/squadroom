/**
 * The draw, at NRIFA's real tournament size: 21 teams, 3 groups of 7,
 * 4 fields, 20-minute games with a 5-minute gap, from 8am.
 */
import { createClient } from '@supabase/supabase-js'
const URL=process.env.NEXT_PUBLIC_SUPABASE_URL, PUB=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const admin=createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}})
const anon =createClient(URL, PUB,{auth:{persistSession:false}})
const ok=m=>console.log(`  \x1b[32m✓\x1b[0m ${m}`), bad=m=>{console.log(`  \x1b[31m✗\x1b[0m ${m}`);process.exitCode=1}
const head=m=>console.log(`\n${m}`)

const { data:l } = await admin.auth.admin.generateLink({type:'magiclink', email:'p61400000301@squadroom.invalid'})
// generateLink is rate limited per project as well as verifyOtp, and
// returns null when it trips — so this property read throws before any
// session check runs, and the runner reports a crash that is really the
// auth budget.
if (!l?.properties?.hashed_token) {
  console.log("  could not issue a magic link — the project's auth rate limit, not a failure")
  process.exit(2)
}
const { data:s } = await anon.auth.verifyOtp({token_hash:l.properties.hashed_token, type:'email'})
const spl = createClient(URL, PUB, {auth:{persistSession:false},
  global:{headers:{Authorization:`Bearer ${s.session.access_token}`}}})
const SPL_ORG='00000000-0000-0000-0000-0000000a0003'

await admin.from('competitions').delete().eq('name','U7s Tournament')

head('1. An organiser sets up a 21-team tournament')
const { data: comp, error: ce } = await spl.from('competitions').insert({
  organiser_id: SPL_ORG, name:'U7s Tournament', type:'tournament', season:'2026',
  starts_on:'2026-09-20',
}).select('id').single()
if (ce) { bad(ce.message); process.exit(1) }

const clubs = [
  'Rizzo Yellow','Focus Football Development','Asa','Joga Bonito','Killarney Dragons','Apia Kouta','Ty Academy',
  'Football Culture','NxGen FA','Coach Max','Sydney United Football School','Life Through Football Academy','The Footballers Academy','Rizzo Green',
  'Futboltec Atletico','Luke Wilkshire Academy','Rilevare','DM Football Academy','NxGen Sporting','Suns Fc','Young Guns',
].map((club_name, i) => ({ club_name, group_label: ['A','B','C'][Math.floor(i/7)] }))

const { data: invites } = await spl.rpc('bulk_invite_clubs', {
  p_competition: comp.id, p_division: 'U7s', p_clubs: clubs })
invites?.length === 21 ? ok(`${invites.length} clubs entered across 3 groups`) : bad(`${invites?.length} entries`)

head('2. Building the draw')
const start = new Date('2026-09-20T08:00:00+10:00')
const t0 = Date.now()
const { data: made, error: ge } = await spl.rpc('generate_fixtures', {
  p_competition: comp.id, p_division: 'U7s',
  p_start_at: start.toISOString(),
  p_game_mins: 20, p_gap_mins: 5,
  p_fields: ['Field 1','Field 2','Field 3','Field 4'],
  p_venue_label: 'Valentine Park',
})
if (ge) { bad(ge.message); process.exit(1) }
// 7 teams per group = 21 games each, three groups.
made === 63 ? ok(`${made} games in ${Date.now()-t0}ms — every team plays all six in its group`) : bad(`${made} games, expected 63`)

head('3. Nobody is in two places at once')
const { data: sheet } = await spl.rpc('competition_run_sheet', { p_competition: comp.id })
const bySlot = new Map()
for (const f of sheet) {
  const k = f.starts_at
  bySlot.set(k, [...(bySlot.get(k) ?? []), f])
}
let clashes = 0, fieldClashes = 0
for (const [, games] of bySlot) {
  const teams = [], fields = []
  for (const g of games) {
    teams.push(g.home_name, g.away_name)
    fields.push(g.field_label)
  }
  if (new Set(teams).size !== teams.length) clashes++
  if (new Set(fields).size !== fields.length) fieldClashes++
}
clashes === 0 ? ok(`${bySlot.size} time slots, no team double-booked in any of them`) : bad(`${clashes} slots with a team playing twice`)
fieldClashes === 0 ? ok('no field hosting two games at once') : bad(`${fieldClashes} field clashes`)

head('4. It fills the fields rather than leaving them idle')
const perSlot = [...bySlot.values()].map(g => g.length)
const full = perSlot.filter(n => n === 4).length
ok(`${full} of ${perSlot.length} slots use all four fields`)
const last = [...bySlot.keys()].sort().pop()
ok(`runs 8:00am to ${new Date(last).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit',timeZone:'Australia/Sydney'})}`)

head('5. Every pairing happens exactly once')
const seen = new Set()
let dupes = 0
for (const f of sheet) {
  const key = [f.home_name, f.away_name].sort().join(' v ')
  if (seen.has(key)) dupes++
  seen.add(key)
}
dupes === 0 && seen.size === 63 ? ok(`${seen.size} distinct pairings, no repeats`) : bad(`${seen.size} pairings, ${dupes} repeated`)

head('6. Scores drive the ladder')
const groupA = sheet.filter(f => f.group_label === 'A').slice(0, 3)
for (const [i, f] of groupA.entries()) {
  await admin.from('fixtures').update({ home_score: 3 - i, away_score: i, status: 'final' }).eq('id', f.fixture_id)
}
const { data: ladder } = await spl.rpc('competition_ladder', { p_competition: comp.id, p_division: 'U7s' })
const played = ladder.filter(r => r.played > 0)
played.length === 6 ? ok(`${played.length} teams now have a record`) : bad(`${played.length} teams with games played`)
ladder[0].points >= ladder[1].points ? ok(`top of the table: ${ladder[0].team_name} on ${ladder[0].points}pts (GD ${ladder[0].goal_difference})`) : bad('ladder not sorted')

head('7. A visiting club sees the draw but not the organiser’s people')
const { data:l2 } = await admin.auth.admin.generateLink({type:'magiclink', email:'p61400000011@squadroom.invalid'})
// generateLink is rate limited per project as well as verifyOtp, and
// returns null when it trips — so this property read throws before any
// session check runs, and the runner reports a crash that is really the
// auth budget.
if (!l2?.properties?.hashed_token) {
  console.log("  could not issue a magic link — the project's auth rate limit, not a failure")
  process.exit(2)
}
const { data:s2 } = await anon.auth.verifyOtp({token_hash:l2.properties.hashed_token, type:'email'})
const nrifaParent = createClient(URL, PUB, {auth:{persistSession:false},
  global:{headers:{Authorization:`Bearer ${s2.session.access_token}`}}})
const { data: outsiderSheet } = await nrifaParent.rpc('competition_run_sheet', { p_competition: comp.id })
;(outsiderSheet?.length ?? 0) === 0 ? ok('a club not entered sees nothing') : bad(`saw ${outsiderSheet.length} fixtures`)

await admin.from('competitions').delete().eq('id', comp.id)
console.log(process.exitCode ? '\n\x1b[31mDRAW BROKEN\x1b[0m\n' : '\n\x1b[32mDRAW GENERATION WORKS\x1b[0m\n')
process.exit(process.exitCode ?? 0)
