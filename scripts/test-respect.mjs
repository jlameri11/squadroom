// Run: node --env-file=.env.local scripts/test-respect.mjs
//
// W-01: after a game the other team's manager and the referee mark a
// team's players, coaches and spectators 1–5. The league sees every
// team's averages and the notes; a club sees its own averages and no
// notes; a parent sees nothing; nothing is public. One mark per marker
// per team per game, changeable on the day; never your own team.
import { createClient } from '@supabase/supabase-js'
import { signInClient } from './_auth.mjs'

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
const RAVENS = '00000000-0000-0000-0000-0000000a0002'
const SPL = '00000000-0000-0000-0000-0000000a0003'
const OWNER = '00000000-0000-0000-0000-0000000000a1'
const MARCUS = '00000000-0000-0000-0000-0000000000a2'
const RAVENS_OWNER = '00000000-0000-0000-0000-0000000000c1'
const PARENT = '00000000-0000-0000-0000-0000000000b1'
const U8 = '00000000-0000-0000-0000-0000000d0008'
const RAVENS_U8 = '00000000-0000-0000-0000-0000000d0099'
const TAG = 'RESPECT'
const OFFICIAL_EMAIL = 'respect-official@squadroom.invalid'
const REF_EMAIL = 'respect-ref@squadroom.invalid'

// Sessions are cached across suites (scripts/_auth.mjs), so a full run no
// longer trips the auth rate limit.
const signInEmail = (email) => signInClient(admin, email)
async function cleanup() {
  const { data: comps } = await admin.from('competitions').select('id').like('name', `${TAG} %`)
  for (const c of comps ?? []) await admin.from('competitions').delete().eq('id', c.id)
  await admin.from('referees').delete().like('full_name', `% ${TAG}`)
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 })
  for (const e of [OFFICIAL_EMAIL, REF_EMAIL]) {
    const u = users?.users?.find((x) => x.email === e)
    if (u) {
      await admin.from('academy_members').delete().eq('profile_id', u.id)
      await admin.from('staff_clearances').delete().eq('profile_id', u.id)
      await admin.auth.admin.deleteUser(u.id)
    }
  }
}
await cleanup()

const { data: offUser } = await admin.auth.admin.createUser({ email: OFFICIAL_EMAIL, email_confirm: true })
await admin.from('profiles').upsert({ id: offUser.user.id, full_name: 'Olive Official' })
await admin.from('staff_clearances').insert({ academy_id: SPL, profile_id: offUser.user.id, kind: 'wwcc', number: 'WWC0000784E', outcome: 'cleared', expires_on: new Date(Date.now() + 400 * 864e5).toISOString().slice(0, 10), verified_by: OWNER })
await admin.from('academy_members').insert({ academy_id: SPL, profile_id: offUser.user.id, role: 'admin', status: 'active' })
const { data: refUser } = await admin.auth.admin.createUser({ email: REF_EMAIL, email_confirm: true })
await admin.from('profiles').upsert({ id: refUser.user.id, full_name: `Pat Whistle ${TAG}` })

const official = await signInEmail(OFFICIAL_EMAIL)
const marcus = await signInEmail((await admin.auth.admin.getUserById(MARCUS)).data.user.email)
const ravens = await signInEmail((await admin.auth.admin.getUserById(RAVENS_OWNER)).data.user.email)
const referee = await signInEmail(REF_EMAIL)
const parent = await signInEmail((await admin.auth.admin.getUserById(PARENT)).data.user.email)
if (!official || !marcus || !ravens || !referee || !parent) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  await cleanup()
  process.exit(2)
}

const { data: comp } = await admin.from('competitions').insert({ organiser_id: SPL, name: `${TAG} League`, type: 'season', season: '2026', status: 'active', mode: 'managed', visibility: 'participants', created_by: offUser.user.id, public_slug: 'respect-test', published_at: new Date().toISOString() }).select('id').single()
await admin.from('competition_clubs').insert([
  { competition_id: comp.id, academy_id: NRIFA, status: 'active', joined_at: new Date().toISOString() },
  { competition_id: comp.id, academy_id: RAVENS, status: 'active', joined_at: new Date().toISOString() },
])
const { data: entries } = await admin.from('competition_entries').insert([
  { competition_id: comp.id, academy_id: NRIFA, team_id: U8, display_name: 'NRIFA U8', division: 'U8' },
  { competition_id: comp.id, academy_id: RAVENS, team_id: RAVENS_U8, display_name: 'Ravens U8', division: 'U8' },
]).select('id')
const [nrifa, rav] = entries
const { data: fx } = await admin.from('fixtures').insert({ competition_id: comp.id, division: 'U8', round: 'R1', home_entry_id: nrifa.id, away_entry_id: rav.id, starts_at: new Date(Date.now() - 2 * 3600_000).toISOString(), status: 'scheduled', stage: 'group' }).select('id').single()
const { data: poolId } = await official.rpc('add_referee', { p_competition: comp.id, p_full_name: `Pat Whistle ${TAG}`, p_profile: refUser.user.id })
await admin.from('referee_appointments').insert({ competition_id: comp.id, fixture_id: fx.id, referee_id: poolId, academy_id: SPL, role: 'referee', status: 'accepted', checked_in_at: new Date().toISOString() })

head('1. Not before the final whistle; never your own team')
{
  const { error: early } = await ravens.rpc('give_respect_marks', { p_fixture: fx.id, p_about_entry: nrifa.id, p_players: 4, p_coaches: 4, p_spectators: 4 })
  early?.code === '22023' ? ok('marks come after the game') : bad(`before the final: ${early?.message ?? 'accepted'}`)
  await admin.from('fixtures').update({ status: 'final', home_score: 2, away_score: 2 }).eq('id', fx.id)
  const { error: own } = await marcus.rpc('give_respect_marks', { p_fixture: fx.id, p_about_entry: nrifa.id, p_players: 5, p_coaches: 5, p_spectators: 5 })
  own?.code === '42501' ? ok('NRIFA\'s coach cannot mark NRIFA') : bad('a team marked itself')
  const { error: parentErr } = await parent.rpc('give_respect_marks', { p_fixture: fx.id, p_about_entry: rav.id, p_players: 1, p_coaches: 1, p_spectators: 1 })
  parentErr?.code === '42501' ? ok('a parent cannot mark anyone') : bad('a parent gave marks')
  const { error: range } = await ravens.rpc('give_respect_marks', { p_fixture: fx.id, p_about_entry: nrifa.id, p_players: 6, p_coaches: 4, p_spectators: 4 })
  range ? ok('6 out of 5 is refused') : bad('a mark of 6 went through')
}

head('2. The opposition and the referee each mark; a mark can be changed on the day')
{
  const { error } = await ravens.rpc('give_respect_marks', { p_fixture: fx.id, p_about_entry: nrifa.id, p_players: 5, p_coaches: 4, p_spectators: 2, p_note: 'One parent abusing the linesman all game' })
  error ? bad(`ravens mark: ${error.message}`) : ok('Ravens mark NRIFA 5/4/2 with a note about a parent')
  const { error: m2 } = await marcus.rpc('give_respect_marks', { p_fixture: fx.id, p_about_entry: rav.id, p_players: 4, p_coaches: 5, p_spectators: 5 })
  m2 ? bad(`nrifa mark: ${m2.message}`) : ok('NRIFA\'s coach marks Ravens 4/5/5')
  const { error: r1 } = await referee.rpc('give_respect_marks', { p_fixture: fx.id, p_about_entry: nrifa.id, p_players: 4, p_coaches: 4, p_spectators: 2 })
  const { error: r2 } = await referee.rpc('give_respect_marks', { p_fixture: fx.id, p_about_entry: rav.id, p_players: 5, p_coaches: 5, p_spectators: 4 })
  r1 || r2 ? bad(`referee marks: ${r1?.message ?? r2?.message}`) : ok('the referee marks both sides')
  const { error: again } = await ravens.rpc('give_respect_marks', { p_fixture: fx.id, p_about_entry: nrifa.id, p_players: 5, p_coaches: 4, p_spectators: 3, p_note: 'Calmed down second half' })
  again ? bad(`change on the day: ${again.message}`) : ok('Ravens change their mark on the day')
  const { count } = await admin.from('respect_marks').select('id', { count: 'exact', head: true }).eq('fixture_id', fx.id)
  count === 4 ? ok('four marks in all — one per marker per team') : bad(`marks: ${count}`)
  const { data: mine } = await ravens.rpc('my_respect_marks', { p_fixture: fx.id })
  mine?.[0]?.spectators === 3 ? ok('the form can show what was given') : bad(JSON.stringify(mine))
}

head('3. Who sees what')
{
  const { data: league } = await official.rpc('respect_dashboard', { p_competition: comp.id })
  const n = league.find((r) => r.entry_id === nrifa.id)
  const r = league.find((r) => r.entry_id === rav.id)
  n?.marks === 2 && n.spectators === 2.5 && r?.marks === 2 && r.overall === 4.7 ? ok(`the league: NRIFA crowd ${n.spectators}, Ravens overall ${r.overall}`) : bad(JSON.stringify([n, r]))
  league[0]?.entry_id === nrifa.id ? ok('lowest overall first') : bad('not sorted lowest first')
  n.notes.length === 1 && /abusing|Calmed/.test(n.notes[0].note) ? ok(`the league reads the note: "${n.notes[0].note}"`) : bad(JSON.stringify(n.notes))
  // Ravens lifted their crowd mark to 3 on the day; the referee's 2 stands.
  n.low === 1 ? ok('one mark of 2 or less flagged as low') : bad(`low: ${n.low}`)
  const { data: club } = await marcus.rpc('respect_dashboard', { p_competition: comp.id })
  club?.length === 1 && club[0].entry_id === nrifa.id && club[0].notes.length === 0 ? ok('NRIFA\'s coach sees NRIFA\'s averages only, and no notes') : bad(JSON.stringify(club))
  const { data: none } = await parent.rpc('respect_dashboard', { p_competition: comp.id })
  const noneRows = none ?? []
  noneRows.length === 0 ? ok('a parent sees nothing') : bad('a parent read the dashboard')
  const { data: raw } = await parent.from('respect_marks').select('id')
  const rawRows = raw ?? []
  rawRows.length === 0 ? ok('and cannot read the table') : bad('a parent read respect_marks')
  const { data: centre } = await anon.rpc('public_match_centre', { p_slug: 'respect-test' })
  const publicJson = JSON.stringify(centre)
  !/"spectators"|"coaches"|"overall"/.test(publicJson) ? ok('nothing of it on the public page') : bad('marks leaked to the public page')
}

await cleanup()
console.log(process.exitCode ? '\n\x1b[31mRESPECT MARKS ARE WRONG\x1b[0m\n' : '\n\x1b[32mall good\x1b[0m\n')
