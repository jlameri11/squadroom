// Run: node --env-file=.env.local scripts/test-pitches.mjs
//
// L-29 (0198): the ground, drawn. A venue's layout — full pitches cut into
// halves, thirds, quarters, named, placed, with hours — and the rules that
// use it: a pitch is never double-booked with its parent or sub-pitches,
// a game outside its hours is refused, the draw builder puts a division on
// the right-sized pitches inside their hours around what is booked, a
// washout can take one pitch, and a family sees their pitch on the game.
import { createClient } from '@supabase/supabase-js'
import { signInClient } from './_auth.mjs'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const head = (m) => console.log(`\n${m}`)

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const SPL = '00000000-0000-0000-0000-0000000a0003'
const OWNER = '00000000-0000-0000-0000-0000000000a1'
const U8 = '00000000-0000-0000-0000-0000000d0008'
const TAG = 'PITCHES'
const sydneyDay = (d) => d.toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' })

const owner = await signInClient(admin, 'joeylameri@outlook.com')         // owns NRIFA and the SPL
const parent = await signInClient(admin, 'p61400000011@squadroom.invalid') // U8 parent
const ravens = await signInClient(admin, 'p61400000091@squadroom.invalid') // another club's owner
if (!owner || !parent || !ravens) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}

async function cleanup() {
  const { data: comps } = await admin.from('competitions').select('id').like('name', `${TAG} %`)
  for (const c of comps ?? []) {
    await admin.from('notification_queue').delete().like('url', `/competitions/${c.id}%`)
    await admin.from('competitions').delete().eq('id', c.id)
  }
  await admin.from('venues').delete().like('name', `${TAG} %`)
  await admin.from('pitch_size_rules').delete().eq('academy_id', SPL).in('age_group', ['U8', 'U12'])
  await admin.from('competition_divisions').delete().like('division', `${TAG}%`)
}
await cleanup()

// The league's ground, and a competition with two divisions — U8 (thirds)
// and U12 (full) — four named teams each so the draw is six games a division.
const { data: ground } = await owner.from('venues').insert({ academy_id: SPL, name: `${TAG} Park`, address: '1 Park Rd, North Ryde NSW 2113', lat: -33.79, lng: 151.12, amenities: { parking: 'Street and the school car park', toilets: 'By the canteen', canteen: 'Saturdays from 8' } }).select('id').single()
const { data: comp } = await admin.from('competitions').insert({ organiser_id: SPL, name: `${TAG} League`, type: 'season', season: '2026', status: 'active', mode: 'managed', visibility: 'participants', created_by: OWNER }).select('id').single()
await admin.from('competition_clubs').insert({ competition_id: comp.id, academy_id: NRIFA, status: 'active', joined_at: new Date().toISOString() })
const { data: entries } = await admin.from('competition_entries').insert([
  { competition_id: comp.id, academy_id: NRIFA, team_id: U8, display_name: 'NRIFA U8', division: `${TAG} U8 Lions` },
  { competition_id: comp.id, academy_id: null, team_id: null, display_name: 'Name A', division: `${TAG} U8 Lions` },
  { competition_id: comp.id, academy_id: null, team_id: null, display_name: 'Name B', division: `${TAG} U8 Lions` },
  { competition_id: comp.id, academy_id: null, team_id: null, display_name: 'Name C', division: `${TAG} U8 Lions` },
  { competition_id: comp.id, academy_id: null, team_id: null, display_name: 'Big A', division: `${TAG} U12 Open` },
  { competition_id: comp.id, academy_id: null, team_id: null, display_name: 'Big B', division: `${TAG} U12 Open` },
  { competition_id: comp.id, academy_id: null, team_id: null, display_name: 'Big C', division: `${TAG} U12 Open` },
  { competition_id: comp.id, academy_id: null, team_id: null, display_name: 'Big D', division: `${TAG} U12 Open` },
]).select('id, display_name')
const U8DIV = `${TAG} U8 Lions`, U12DIV = `${TAG} U12 Open`
const entry = (n) => entries.find((e) => e.display_name === n)

head('1. The layout: full pitches, cut, named, placed')
const { data: f1, error: ae } = await owner.rpc('add_pitch', { p_venue: ground.id })
ae ? bad(`add_pitch: ${ae.message}`) : ok('Field 1 added')
const { data: f2 } = await owner.rpc('add_pitch', { p_venue: ground.id, p_name: 'Top Oval' })
let { data: layout } = await owner.rpc('venue_layout', { p_venue: ground.id })
const top = (layout?.pitches ?? []).filter((p) => !p.parent_id)
top.length === 2 && top[0].name === 'Field 1' && top[1].name === 'Top Oval' ? ok('two full pitches, named by default and by hand') : bad(`pitches: ${JSON.stringify(top.map((p) => p.name))}`)
top.length === 2 && !(top[0].x < top[1].x + top[1].w && top[0].x + top[0].w > top[1].x && top[0].y < top[1].y + top[1].h && top[0].y + top[0].h > top[1].y) ? ok('placed side by side, not on top of each other') : bad('the second pitch overlaps the first')
const { data: cut, error: se } = await owner.rpc('split_pitch', { p_pitch: f1, p_into: 3 })
se ? bad(`split: ${se.message}`) : ok(`Field 1 cut into ${cut} thirds`)
;({ data: layout } = await owner.rpc('venue_layout', { p_venue: ground.id }))
const thirds = layout.pitches.filter((p) => p.parent_id === f1)
const parent1 = layout.pitches.find((p) => p.id === f1)
thirds.length === 3 && thirds.map((p) => p.name).join(',') === '1A,1B,1C' ? ok('named 1A, 1B, 1C') : bad(`thirds: ${thirds.map((p) => p.name).join(',')}`)
thirds.every((p) => p.size === 'third' && p.x >= parent1.x && p.x + p.w <= parent1.x + parent1.w + 0.01 && p.y >= parent1.y && p.y + p.h <= parent1.y + parent1.h + 0.01) ? ok('each inside the full pitch') : bad('a third lies outside its pitch')
const { error: again } = await owner.rpc('split_pitch', { p_pitch: thirds[0].id, p_into: 2 })
again ? ok('a sub-pitch cannot be cut again') : bad('a third was cut')
await owner.rpc('move_pitch', { p_pitch: f1, p_x: 50, p_y: 50 })
;({ data: layout } = await owner.rpc('venue_layout', { p_venue: ground.id }))
const movedParent = layout.pitches.find((p) => p.id === f1)
const movedKids = layout.pitches.filter((p) => p.parent_id === f1)
movedParent.x === 50 && movedParent.y === 50 && movedKids.every((p) => p.x >= 50 && p.y >= 50) ? ok('dragging the full pitch takes its thirds with it') : bad(`moved: ${JSON.stringify({ p: [movedParent.x, movedParent.y], k: movedKids.map((p) => [p.x, p.y]) })}`)
await owner.rpc('move_pitch', { p_pitch: f1, p_x: 90, p_y: 90 })
;({ data: layout } = await owner.rpc('venue_layout', { p_venue: ground.id }))
const clamped = layout.pitches.find((p) => p.id === f1)
clamped.x + clamped.w <= 100.01 && clamped.y + clamped.h <= 100.01 ? ok('and cannot be dragged off the canvas') : bad(`off canvas: ${clamped.x}+${clamped.w}`)
await owner.rpc('move_pitch', { p_pitch: f1, p_x: 3, p_y: 4 })
const { error: rn } = await owner.from('pitches').update({ name: 'Field 1 (main)' }).eq('id', f1)
rn ? bad(`rename: ${rn.message}`) : ok('renamed through the table, as staff')
const { data: hrs, error: he } = await owner.rpc('set_pitch_hours', { p_pitch: f1, p_hours: [{ weekday: 6, opens: '08:00', closes: '12:00' }, { weekday: 0, opens: '09:00', closes: '11:00' }] })
he ? bad(`hours: ${he.message}`) : hrs === 2 ? ok('Saturday 8–12 and Sunday 9–11 on the full pitch') : bad(`hours: ${hrs}`)
;({ data: layout } = await owner.rpc('venue_layout', { p_venue: ground.id }))
layout.lat === -33.79 && layout.amenities?.canteen && layout.can_edit ? ok('the layout carries the pin, the amenities and who may edit') : bad('layout is missing the venue details')
const { data: pl } = await parent.rpc('venue_layout', { p_venue: ground.id })
pl && pl.pitches.length === 5 && pl.can_edit === false ? ok('a parent reads the layout, read-only') : bad(`parent layout: ${JSON.stringify(pl?.can_edit)}`)
const { error: pw } = await parent.rpc('add_pitch', { p_venue: ground.id })
pw?.code === '42501' ? ok('and cannot add a pitch') : bad(`parent add: ${pw?.code ?? 'allowed'}`)
const { data: rv } = await ravens.from('pitches').select('id').eq('venue_id', ground.id)
;(rv ?? []).length === 0 ? ok("another club's owner sees none of it through the table") : bad(`Ravens read ${rv.length} pitches`)

head('2. The clash rule: a pitch, its parent and its sub-pitches')
const sat = new Date(Date.now() + ((6 - new Date().getDay() + 7) % 7 || 7) * 864e5)   // next Saturday
const day = sydneyDay(sat)
const at = (hhmm) => new Date(`${day}T${hhmm}:00+11:00`).toISOString()
const game = async (pitch, start, mins, status = 'scheduled', div = U8DIV) =>
  admin.from('fixtures').insert({ competition_id: comp.id, division: div, round: 'R1', home_entry_id: entry('Name A').id, away_entry_id: entry('Name B').id, starts_at: start, duration_mins: mins, status, pitch_id: pitch }).select('id, field_label, venue_id').single()
const g1 = await game(thirds[0].id, at('09:00'), 30)
g1.error ? bad(`book 1A: ${g1.error.message}`) : ok('1A booked 9:00–9:30')
g1.data?.field_label === '1A' && g1.data.venue_id === ground.id ? ok('and the game carries the field label and the venue, for every older screen') : bad(`labels: ${JSON.stringify(g1.data)}`)
const g2 = await game(thirds[1].id, at('09:00'), 30)
g2.error ? bad(`1B alongside 1A: ${g2.error.message}`) : ok('1B at the same time is fine — siblings do not clash')
const g3 = await game(f1, at('09:15'), 30)
g3.error ? ok(`the full pitch cannot be booked while a third is in use: "${g3.error.message.slice(0, 70)}"`) : bad('Field 1 was booked over 1A')
const g4 = await game(f1, at('09:30'), 30)
g4.error ? bad(`Field 1 right after: ${g4.error.message}`) : ok('Field 1 at 9:30, when the thirds are done, is fine')
const g5 = await game(thirds[2].id, at('09:45'), 20)
g5.error ? ok('a third cannot be booked while the full pitch is in use') : bad('1C was booked over Field 1')
const g6 = await game(thirds[2].id, at('10:00'), 20, 'cancelled')
g6.error ? bad(`cancelled game: ${g6.error.message}`) : ok('a cancelled game does not count')
const g7 = await game(f1, at('13:00'), 30)
g7.error ? ok(`outside the hours (Saturday 8–12) is refused: "${g7.error.message.slice(0, 50)}"`) : bad('a 1pm game was booked outside the hours')
const g8 = await game(thirds[0].id, at('11:30'), 30)
g8.error ? bad(`1A at 11:30: ${g8.error.message}`) : ok('a third inherits its parent\'s hours when it has none')
const mon = sydneyDay(new Date(sat.getTime() + 2 * 864e5))
const g9 = await admin.from('fixtures').insert({ competition_id: comp.id, division: U8DIV, round: 'R1', home_entry_id: entry('Name A').id, away_entry_id: entry('Name B').id, starts_at: new Date(`${mon}T09:00:00+11:00`).toISOString(), duration_mins: 30, status: 'scheduled', pitch_id: f2 }).select('id').single()
g9.error ? bad(`Top Oval (no hours): ${g9.error.message}`) : ok('a pitch with no hours is always open')
const { error: mv } = await admin.from('fixtures').update({ starts_at: at('09:10') }).eq('id', g4.data.id)
mv ? ok('moving a game onto a clash is refused too') : bad('Field 1 was moved over 1A')
const { error: del } = await owner.from('pitches').delete().eq('id', f1)
del ? ok(`a pitch with games still to play cannot be removed: "${del.message.slice(0, 50)}"`) : bad('Field 1 was deleted with games on it')
await admin.from('fixtures').delete().eq('competition_id', comp.id)

head('3. Sizes: which pitch an age group plays on')
const { data: rules } = await owner.rpc('pitch_size_rules_for', { p_academy: SPL })
const r8 = rules.find((r) => r.age_group === 'U8'), r12 = rules.find((r) => r.age_group === 'U12')
r8?.size === 'third' && r8.is_default && r12?.size === 'full' ? ok('defaults: U8 on a third, U12 on a full pitch') : bad(`rules: ${JSON.stringify([r8, r12])}`)
await owner.rpc('set_pitch_size_rules', { p_academy: SPL, p_rules: { U8: 'half' } })
const { data: rules2 } = await owner.rpc('pitch_size_rules_for', { p_academy: SPL })
rules2.find((r) => r.age_group === 'U8')?.size === 'half' ? ok('the league changes U8 to a half') : bad('the rule did not take')
await admin.from('competition_divisions').upsert({ competition_id: comp.id, division: U8DIV, pitch_size: 'third' }, { onConflict: 'competition_id,division' })
await owner.rpc('set_pitch_size_rules', { p_academy: SPL, p_rules: {} })
const { error: pr } = await parent.rpc('set_pitch_size_rules', { p_academy: SPL, p_rules: { U8: 'full' } })
pr?.code === '42501' ? ok('a parent cannot set the sizes') : bad(`parent rules: ${pr?.code ?? 'allowed'}`)

head('4. The draw on pitches: right size, inside the hours, around what is booked')
const { error: noFull } = await owner.rpc('generate_fixtures_on_pitches', { p_competition: comp.id, p_division: U12DIV, p_venue: ground.id, p_first_date: day, p_game_mins: 40, p_gap_mins: 5 })
noFull ? bad(`U12 on full pitches: ${noFull.message}`) : ok('the U12s draw on the full pitches')
const { data: u12 } = await admin.from('fixtures').select('id, starts_at, pitch_id, field_label').eq('competition_id', comp.id).eq('division', U12DIV).order('starts_at')
u12.length === 6 && u12.every((f) => [f1, f2].includes(f.pitch_id)) ? ok('six games, all on Field 1 or Top Oval') : bad(`u12: ${JSON.stringify(u12.map((f) => f.field_label))}`)
const { data: u8r, error: ue } = await owner.rpc('generate_fixtures_on_pitches', { p_competition: comp.id, p_division: U8DIV, p_venue: ground.id, p_first_date: day, p_game_mins: 30, p_gap_mins: 5 })
ue ? bad(`U8 on thirds: ${ue.message}`) : ok(`the U8s draw on the thirds: ${u8r.placed} placed, ${u8r.overflow} did not fit (size ${u8r.size})`)
const { data: u8g } = await admin.from('fixtures').select('id, starts_at, pitch_id, field_label').eq('competition_id', comp.id).eq('division', U8DIV).order('starts_at')
const thirdIds = thirds.map((t) => t.id)
u8r && u8r.size === 'third' && u8g.filter((f) => f.pitch_id).every((f) => thirdIds.includes(f.pitch_id)) ? ok('every placed U8 game is on 1A, 1B or 1C') : bad(`u8: ${JSON.stringify(u8g.map((f) => f.field_label))}`)
// Nothing clashes: no U8 game on a third overlaps a U12 game on Field 1.
const overlaps = u8g.filter((f) => f.pitch_id).filter((a) => u12.filter((b) => b.pitch_id === f1).some((b) => {
  const as = new Date(a.starts_at).getTime(), ae = as + 30 * 60e3, bs = new Date(b.starts_at).getTime(), be = bs + 40 * 60e3
  return as < be && ae > bs
}))
overlaps.length === 0 ? ok('and none of them overlaps a U12 game on the full pitch') : bad(`${overlaps.length} U8 games overlap Field 1`)
const inHours = u8g.filter((f) => f.pitch_id).every((f) => { const d = new Date(f.starts_at); const h = Number(d.toLocaleTimeString('en-AU', { timeZone: 'Australia/Sydney', hour: '2-digit', hour12: false })); return h >= 8 && h < 12 })
inHours ? ok('every placed game is inside Saturday 8–12') : bad('a game was placed outside the hours')
const { error: noQ } = await owner.rpc('generate_fixtures_on_pitches', { p_competition: comp.id, p_division: `${TAG} U6 Kick`, p_venue: ground.id, p_first_date: day })
noQ && /quarter/.test(noQ.message) ? ok(`no quarter pitches: "${noQ.message.slice(0, 60)}"`) : bad(`U6: ${noQ?.message ?? 'drew on nothing'}`)
const { error: pd } = await parent.rpc('generate_fixtures_on_pitches', { p_competition: comp.id, p_division: U8DIV, p_venue: ground.id, p_first_date: day })
pd?.code === '42501' ? ok('a parent cannot build a draw') : bad(`parent draw: ${pd?.code ?? 'allowed'}`)
const { data: q } = await owner.rpc('draw_quality', { p_competition: comp.id, p_division: U8DIV })
q && q.games === 6 ? ok('the draw check still reads it (six games)') : bad(`draw_quality: ${JSON.stringify(q)}`)

head('5. A washout can take one pitch; the family sees their pitch')
const dayU8 = u8g.filter((f) => f.pitch_id && sydneyDay(new Date(f.starts_at)) === day)
ok(`that Saturday: ${dayU8.map((f) => `${f.field_label} ${new Date(f.starts_at).toLocaleTimeString('en-AU', { timeZone: 'Australia/Sydney', hour: '2-digit', minute: '2-digit' })}`).join(', ')}`)
const firstU8 = dayU8[0]
// A control game on 1C at 11:30 that day — a third the call-off must not touch.
const control = await game(thirds[2].id, at('11:30'), 20, 'scheduled', U8DIV)
control.error ? bad(`control game: ${control.error.message}`) : ok('a control game on 1C at 11:30')
const { data: off, error: oe } = await owner.rpc('call_off_fixtures', { p_competition: comp.id, p_date: day, p_reason: 'wet_weather', p_pitch: firstU8.pitch_id })
oe ? bad(`call off a pitch: ${oe.message}`) : ok(`${off.affected} game(s) postponed on ${firstU8.field_label} only`)
const { data: after } = await admin.from('fixtures').select('id, status, pitch_id, starts_at').eq('competition_id', comp.id).eq('division', U8DIV)
const thatDay = after.filter((f) => f.pitch_id && sydneyDay(new Date(f.starts_at)) === day)
thatDay.filter((f) => f.pitch_id === firstU8.pitch_id).every((f) => f.status === 'postponed') ? ok(`every game on ${firstU8.field_label} that day is postponed`) : bad('a game on the called-off third still plays')
thatDay.find((f) => f.id === control.data.id)?.status === 'scheduled' ? ok('the control game on 1C still plays') : bad('the call-off reached another third')
const { data: offAll } = await owner.rpc('call_off_fixtures', { p_competition: comp.id, p_date: day, p_reason: 'ground_closed', p_pitch: f1 })
const { data: after2 } = await admin.from('fixtures').select('id, status, pitch_id, starts_at').eq('competition_id', comp.id).eq('division', U8DIV)
after2.filter((f) => f.pitch_id && sydneyDay(new Date(f.starts_at)) === day).every((f) => f.status === 'postponed') ? ok(`calling off the full pitch takes every third with it (${offAll.affected} more)`) : bad('a third kept playing after its full pitch was called off')
after2.some((f) => f.pitch_id && sydneyDay(new Date(f.starts_at)) !== day && f.status === 'scheduled') ? ok('and the following Saturdays are untouched') : bad('a later round was called off too')
const nrifaGame = u8g.find((f) => f.pitch_id) ?? u8g[0]
const { data: fp, error: fe } = await parent.rpc('fixture_pitch', { p_fixture: nrifaGame.id })
fe ? bad(`fixture_pitch: ${fe.message}`) : fp?.pitch_id === nrifaGame.pitch_id && fp.pitches?.length === 5 && fp.address ? ok(`the family sees the ground drawn with ${fp.field_label} marked, and the address for directions`) : bad(`fixture_pitch: ${JSON.stringify(fp)}`)
const { data: anonLayout, error: ane } = await createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } }).rpc('venue_layout', { p_venue: ground.id })
ane || anonLayout === null ? ok('a stranger with no account gets nothing') : bad('anon read the layout')

await cleanup()
process.exit(process.exitCode ?? 0)
