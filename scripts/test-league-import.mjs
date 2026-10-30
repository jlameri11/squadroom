// Run: node --env-file=.env.local scripts/test-league-import.mjs
//
// L-14: a league imports its draw from a file it exported. Teams become
// entries (linked to an entered club by name), games become fixtures at
// the league's local time; a re-import moves a moved game and leaves a
// played one alone; byes and half-rows are skipped and named.
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
const TAG = 'LIMPORT'

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
}
await cleanup()

const owner = await signInEmail((await admin.auth.admin.getUserById(OWNER)).data.user.email)
const parent = await signInEmail((await admin.auth.admin.getUserById(PARENT)).data.user.email)
if (!owner || !parent) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}
const { data: comp } = await admin.from('competitions').insert({ organiser_id: SPL, name: `${TAG} League`, type: 'season', season: '2026', status: 'active', mode: 'managed', visibility: 'participants', created_by: OWNER }).select('id').single()
await admin.from('competition_clubs').insert({ competition_id: comp.id, academy_id: NRIFA, status: 'active', joined_at: new Date().toISOString() })

const rows = [
  { division: 'U8', round: 'Round 1', local_date: '2027-03-06', local_time: '09:00', home: 'NRIFA Football Academy', away: 'Hills Hawks', venue: 'ELS Hall', field: 'Field 1', external_ref: 'M-1001' },
  { division: 'U8', round: 'Round 1', local_date: '2027-03-06', local_time: '10:00', home: 'Carlingford Cobras', away: 'West Pennant Hills', venue: 'ELS Hall', field: 'Field 2', external_ref: 'M-1002' },
  { division: 'U10', round: 'Round 1', local_date: '2027-03-06', local_time: '11:00', home: 'Hills Hawks', away: 'NRIFA U10', home_club: 'Hills Hawks', away_club: 'NRIFA Football Academy', external_ref: 'M-2001' },
  { division: 'U10', round: 'Round 1', local_date: '2027-03-06', local_time: '', home: 'Carlingford Cobras', away: 'Thornleigh Thunder' },
  { division: 'U8', round: 'Round 2', local_date: '2027-03-13', local_time: '09:00', home: 'Hills Hawks', away: '', external_ref: 'M-1003' },
  { division: 'U8', round: 'Round 2', local_date: '2027-03-13', local_time: '09:00', home: 'West Pennant Hills', away: 'bye', bye: 'yes' },
  { division: '', round: 'Round 2', local_date: '2027-03-13', local_time: '10:00', home: 'A', away: 'B' },
  { division: 'U8', round: 'Round 2', local_date: '13/03/2027', local_time: '10:00', home: 'Carlingford Cobras', away: 'NRIFA Football Academy', external_ref: 'M-1004' },
]

head('1. Only the organiser imports')
{
  const { error } = await parent.rpc('import_league_draw', { p_competition: comp.id, p_rows: rows })
  error?.code === '42501' ? ok('a parent is refused') : bad(`a parent imported: ${error?.message ?? 'no error'}`)
}

head('2. The first import: entries, fixtures, local time, skips')
{
  const { data, error } = await owner.rpc('import_league_draw', { p_competition: comp.id, p_rows: rows })
  error ? bad(`import: ${error.message}`) : ok(`created ${data.created}, updated ${data.updated}, entries ${data.entries}, skipped ${data.skipped.length}`)
  data?.created === 4 && data.updated === 0 ? ok('four games written (two U8 round 1, one U10 timed, one U10 untimed)') : bad(JSON.stringify(data))
  const whys = (data?.skipped ?? []).map((s) => `${s.row}:${s.why}`).join(' ')
  const skipsNamed = /5:one team missing/.test(whys) && /6:a bye/.test(whys) && /7:no division/.test(whys) && /8:could not read the date/.test(whys)
  skipsNamed
    ? ok(`skipped and named: ${whys}`)
    : bad(`skips: ${whys}`)
  const { data: entries } = await admin.from('competition_entries').select('display_name, division, academy_id').eq('competition_id', comp.id).order('division').order('display_name')
  entries.length === 8 ? ok('eight entries, four per division') : bad(`entries: ${entries.map((e) => `${e.division}/${e.display_name}`).join(', ')}`)
  const nrifaU8 = entries.find((e) => e.division === 'U8' && e.display_name === 'NRIFA Football Academy')
  const nrifaU10 = entries.find((e) => e.division === 'U10' && e.display_name === 'NRIFA U10')
  nrifaU8?.academy_id === NRIFA ? ok('"NRIFA Football Academy" linked to the entered club by name') : bad('NRIFA U8 entry not linked')
  nrifaU10?.academy_id === NRIFA ? ok('"NRIFA U10" linked through its club column') : bad('NRIFA U10 entry not linked')
  entries.find((e) => e.display_name === 'Hills Hawks' && e.division === 'U8')?.academy_id === null ? ok('a club not on Squadroom is a name on the draw') : bad('Hills Hawks got an academy')
  const { data: fx } = await admin.from('fixtures').select('external_ref, starts_at, venue_label, field_label, round').eq('competition_id', comp.id).eq('external_ref', 'M-1001').single()
  fx?.starts_at === '2027-03-05T22:00:00+00:00' ? ok('9:00 on 6 March in Sydney is 22:00 UTC the day before — local time honoured') : bad(`starts_at: ${fx?.starts_at}`)
  fx?.venue_label === 'ELS Hall' && fx.field_label === 'Field 1' && fx.round === 'Round 1' ? ok('venue, field and round carried') : bad(JSON.stringify(fx))
}

head('3. A re-import: a moved game moves, a played game stays, nothing doubles')
{
  // M-1001 moved to 2pm; M-1002 was played in the meantime; a new game appears.
  const { data: played } = await admin.from('fixtures').select('id').eq('competition_id', comp.id).eq('external_ref', 'M-1002').single()
  await admin.from('fixtures').update({ status: 'final', home_score: 2, away_score: 1 }).eq('id', played.id)
  const again = [
    { ...rows[0], local_time: '14:00', field: 'Field 3' },
    { ...rows[1], local_time: '15:00' },
    rows[2],
    { division: 'U8', round: 'Round 3', local_date: '2027-03-20', local_time: '09:00', home: 'NRIFA Football Academy', away: 'Carlingford Cobras', external_ref: 'M-1005' },
  ]
  const { data, error } = await owner.rpc('import_league_draw', { p_competition: comp.id, p_rows: again })
  error ? bad(`re-import: ${error.message}`) : ok(`created ${data.created}, updated ${data.updated}`)
  data?.created === 1 && data.updated === 3 ? ok('one new game, three matched by reference') : bad(JSON.stringify(data))
  const { data: moved } = await admin.from('fixtures').select('starts_at, field_label').eq('competition_id', comp.id).eq('external_ref', 'M-1001').single()
  moved?.starts_at === '2027-03-06T03:00:00+00:00' && moved.field_label === 'Field 3' ? ok('M-1001 moved to 2pm on Field 3') : bad(JSON.stringify(moved))
  const { data: kept } = await admin.from('fixtures').select('starts_at, status, home_score').eq('id', played.id).single()
  kept?.status === 'final' && kept.home_score === 2 && kept.starts_at === '2027-03-05T23:00:00+00:00' ? ok('the played game kept its result and its time') : bad(JSON.stringify(kept))
  const { count } = await admin.from('fixtures').select('id', { count: 'exact', head: true }).eq('competition_id', comp.id)
  count === 5 ? ok('five fixtures in all — nothing doubled') : bad(`fixtures: ${count}`)
  // Without a reference, the same two teams on the same day match too.
  const noRef = [{ division: 'U10', round: 'Round 1', local_date: '2027-03-06', local_time: '12:30', home: 'Carlingford Cobras', away: 'Thornleigh Thunder', venue: 'Christie Park' }]
  const { data: d2 } = await owner.rpc('import_league_draw', { p_competition: comp.id, p_rows: noRef })
  d2?.updated === 1 && d2.created === 0 ? ok('a game with no reference is matched on division, teams and day') : bad(JSON.stringify(d2))
  const { data: sheet } = await owner.rpc('competition_run_sheet', { p_competition: comp.id, p_division: 'U10' })
  const sheetRows = sheet ?? []
  sheetRows.length === 2 && sheetRows.some((r) => r.home_name === 'Carlingford Cobras' && r.starts_at) ? ok('the run sheet shows it, now timed') : bad(JSON.stringify(sheetRows.map((r) => [r.home_name, r.starts_at])))
}

await cleanup()
console.log(process.exitCode ? '\n\x1b[31mTHE LEAGUE IMPORT IS WRONG\x1b[0m\n' : '\n\x1b[32mall good\x1b[0m\n')
