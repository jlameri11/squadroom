// Run: node --env-file=.env.local scripts/test-discipline.mjs
//
// L-08: cards become suspensions by the competition's rules, a suspended
// child is refused on the sheet by name, a suspension is served by missing
// games, and the organiser can add or overturn one with a reason.
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
const TAG = 'DISCTEST'
const VISITOR_EMAIL = 'disctest-owner@squadroom.invalid'

async function signInEmail(email) {
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (!link?.properties?.hashed_token) return null
  const client = createClient(URL_, PUB, { auth: { persistSession: false } })
  const { data } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
  return data?.session ? client : null
}
const emailOf = async (id) => (await admin.auth.admin.getUserById(id)).data.user.email

async function cleanup() {
  const { data: comps } = await admin.from('competitions').select('id').like('name', `${TAG} %`)
  for (const c of comps ?? []) await admin.from('competitions').delete().eq('id', c.id)
  const { data: acads } = await admin.from('academies').select('id').like('name', `${TAG} %`)
  for (const a of acads ?? []) await admin.from('academies').delete().eq('id', a.id)
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const u = users?.users?.find((x) => x.email === VISITOR_EMAIL)
  if (u) await admin.auth.admin.deleteUser(u.id)
}
await cleanup()

// Two clubs, one league run by the SPL, one division, a run of fixtures.
const { data: created } = await admin.auth.admin.createUser({ email: VISITOR_EMAIL, email_confirm: true })
const VISITOR = created.user.id
await admin.from('profiles').upsert({ id: VISITOR, full_name: 'Val Visitor' })
const { data: club } = await admin.from('academies').insert({ name: `${TAG} FC`, slug: 'disctest-fc', type: 'academy', primary_colour: '#333333' }).select('id').single()
await admin.from('academy_members').insert({ academy_id: club.id, profile_id: VISITOR, role: 'owner', status: 'active' })
const { data: vteam } = await admin.from('teams').insert({ academy_id: club.id, name: `${TAG} U8`, age_group: 'U8', season: '2026', status: 'active' }).select('id').single()
const { data: vkids } = await admin.from('players').insert(
  Array.from({ length: 9 }, (_, i) => ({ academy_id: club.id, team_id: vteam.id, full_name: `Visitor ${i + 1} ${TAG}`, dob: '2018-01-01' }))
).select('id')
const { data: comp } = await admin.from('competitions').insert({
  organiser_id: SPL, name: `${TAG} League`, type: 'season', season: '2026', status: 'active', mode: 'managed', visibility: 'participants', created_by: OWNER,
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
const day = (n) => new Date(Date.now() + n * 864e5).toISOString()
const fx = []
for (let r = 1; r <= 4; r++) {
  const { data } = await admin.from('fixtures').insert({ competition_id: comp.id, division: 'U8', round: `Round ${r}`, home_entry_id: home.id, away_entry_id: away.id, starts_at: day(r), status: 'scheduled', stage: 'group' }).select('id').single()
  fx.push(data.id)
}

const owner = await signInEmail(await emailOf(OWNER))
const vera = await signInEmail(VISITOR_EMAIL)
const parent = await signInEmail(await emailOf(PARENT))
if (!owner || !vera || !parent) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  await cleanup()
  process.exit(2)
}
// The owner is SPL staff (organiser) and NRIFA staff (home manager); Vera manages the visitors.
await owner.rpc('seed_entry_squad', { p_entry: home.id })
await vera.rpc('seed_entry_squad', { p_entry: away.id })
const { data: hs } = await admin.from('entry_squads').select('player_id').eq('entry_id', home.id)
const H = hs.map((s) => s.player_id)
const V = vkids.map((k) => k.id)
const rows = (ids) => ids.map((id, i) => ({ player_id: id, number: i + 1, starting: true }))
const nameOf = async (id) => (await admin.from('players').select('full_name').eq('id', id).single()).data.full_name
const submitBoth = async (f, homeIds, awayIds) => {
  const a = await owner.rpc('submit_match_sheet', { p_fixture: f, p_entry: home.id, p_players: rows(homeIds) })
  const b = await vera.rpc('submit_match_sheet', { p_fixture: f, p_entry: away.id, p_players: rows(awayIds) })
  return a.error ?? b.error ?? null
}
const finalise = async (f, h, a) => {
  await owner.rpc('enter_sheet_score', { p_fixture: f, p_entry: home.id, p_ours: h, p_theirs: a })
  await vera.rpc('enter_sheet_score', { p_fixture: f, p_entry: away.id, p_ours: a, p_theirs: h })
}
const hot = H[0]
const hotName = await nameOf(hot)

head('1. The rules, by the organiser; a red on the sheet is a suspension')
{
  const { error: pErr } = await parent.from('competition_discipline_rules').upsert({ competition_id: comp.id, games_per_red: 2 }, { onConflict: 'competition_id' })
  pErr ? ok('a parent cannot set the rules') : bad('a parent set discipline rules')
  const { error } = await owner.from('competition_discipline_rules').upsert({ competition_id: comp.id, yellows_per_suspension: 3, games_per_yellow_suspension: 1, games_per_red: 2 }, { onConflict: 'competition_id' })
  error ? bad(`rules: ${error.message}`) : ok('3 yellows → 1 game; a red → 2 games')
  const e = await submitBoth(fx[0], H.slice(0, 11), V)
  e ? bad(`round 1 sheets: ${e.message}`) : ok('round 1 sheets in')
  const { error: red } = await owner.rpc('record_match_event', { p_fixture: fx[0], p_entry: home.id, p_kind: 'red', p_player: hot, p_minute: 70 })
  red ? bad(`red card: ${red.message}`) : ok(`${hotName} sent off in the 70th`)
  const { data: s } = await admin.from('suspensions').select('reason, games, served, status').eq('player_id', hot).eq('competition_id', comp.id).maybeSingle()
  s?.reason === 'red card' && s?.games === 2 && s?.status === 'active' ? ok('a 2-game suspension, automatically') : bad(JSON.stringify(s))
  await finalise(fx[0], 1, 1)
}

head('2. Suspended means off the sheet, by name')
{
  const e = await submitBoth(fx[1], H.slice(0, 11), V)
  e && /suspended/.test(e.message) && e.message.includes(hotName) ? ok(`round 2 refused: "${e.message}"`) : bad(e ? e.message : 'a suspended child was accepted on the sheet')
  const { data: v } = await owner.rpc('match_sheet_view', { p_fixture: fx[1] })
  const greyed = v?.squads?.home?.find((q) => q.player_id === hot)
  greyed?.ineligible && /suspended/.test(greyed.ineligible) ? ok('and greyed out on the match page with the reason') : bad(JSON.stringify(greyed))
}

head('3. Served by missing games')
{
  const e2 = await submitBoth(fx[1], H.slice(1, 12), V)
  e2 ? bad(`round 2 without them: ${e2.message}`) : ok('round 2 goes in without them')
  await finalise(fx[1], 2, 0)
  let { data: s } = await admin.from('suspensions').select('served, status').eq('player_id', hot).eq('competition_id', comp.id).single()
  s?.served === 1 && s?.status === 'active' ? ok('one game served, one to go') : bad(JSON.stringify(s))
  const e3 = await submitBoth(fx[2], H.slice(0, 11), V)
  e3 && /1 game still to serve/.test(e3.message) ? ok(`round 3 still refused: "${e3.message.slice(0, 60)}"`) : bad(e3 ? e3.message : 'accepted with a game still to serve')
  await submitBoth(fx[2], H.slice(1, 12), V)
  await finalise(fx[2], 0, 0)
  ;({ data: s } = await admin.from('suspensions').select('served, status').eq('player_id', hot).eq('competition_id', comp.id).single())
  s?.served === 2 && s?.status === 'served' ? ok('both games served') : bad(JSON.stringify(s))
  const e4 = await submitBoth(fx[3], H.slice(0, 11), V)
  e4 ? bad(`round 4: ${e4.message}`) : ok(`${hotName} is back for round 4`)
}

head('4. Three yellows add up; the organiser overturns with a reason')
{
  const booked = V[0]
  for (const [f, minute] of [[fx[0], 10], [fx[1], 20], [fx[3], 30]]) {
    const { error } = await owner.rpc('record_match_event', { p_fixture: f, p_entry: away.id, p_kind: 'yellow', p_player: booked, p_minute: minute })
    if (error) bad(`yellow at ${minute}: ${error.message}`)
  }
  const { data: s } = await admin.from('suspensions').select('id, reason, games, status').eq('player_id', booked).eq('competition_id', comp.id).maybeSingle()
  s?.reason === '3 yellow cards' && s?.games === 1 ? ok('the third yellow is a 1-game suspension') : bad(JSON.stringify(s))
  const { error: noNote } = await owner.rpc('overturn_suspension', { p_suspension: s.id, p_note: '' })
  noNote ? ok('overturning without a reason is refused') : bad('overturned with no reason')
  const { error: vErr } = await vera.rpc('overturn_suspension', { p_suspension: s.id, p_note: 'please' })
  vErr?.code === '42501' ? ok('the club cannot overturn its own player\'s') : bad('a club overturned a suspension')
  const { error: appeal } = await vera.rpc('note_appeal', { p_suspension: s.id, p_note: 'Second yellow was mistaken identity' })
  appeal ? bad(`appeal: ${appeal.message}`) : ok('but can note an appeal')
  const { error: ov } = await owner.rpc('overturn_suspension', { p_suspension: s.id, p_note: 'Appeal upheld — referee confirms mistaken identity' })
  ov ? bad(`overturn: ${ov.message}`) : ok('the organiser overturns it')
  const { data: after } = await admin.from('suspensions').select('status, note, appeal_note').eq('id', s.id).single()
  after?.status === 'overturned' && /mistaken/.test(after?.appeal_note ?? '') && /upheld/.test(after?.note ?? '') ? ok('overturned, with both notes kept') : bad(JSON.stringify(after))
}

head('5. The organiser\'s own suspension, and the report')
{
  const { data: id, error } = await owner.rpc('add_suspension', { p_competition: comp.id, p_player: H[5], p_games: 3, p_reason: 'tribunal — abuse of a referee', p_note: 'Hearing 29 Oct' })
  error ? bad(`add: ${error.message}`) : ok('a 3-game tribunal suspension')
  const { error: pErr } = await parent.rpc('add_suspension', { p_competition: comp.id, p_player: H[6], p_games: 1, p_reason: 'x' })
  pErr?.code === '42501' ? ok('a parent cannot') : bad('a parent suspended somebody')
  const { data: rep, error: repErr } = await vera.rpc('discipline_report', { p_competition: comp.id })
  if (repErr) bad(`report: ${repErr.message}`)
  const hotRow = rep?.players?.find((p) => p.player_id === hot)
  const bookedRow = rep?.players?.find((p) => p.player_id === V[0])
  const tribRow = rep?.players?.find((p) => p.player_id === H[5])
  hotRow?.reds === 1 && hotRow?.suspensions?.[0]?.status === 'served' ? ok(`report: ${hotRow.name} — 1 red, served`) : bad(JSON.stringify(hotRow))
  bookedRow?.yellows === 3 && bookedRow?.suspensions?.[0]?.status === 'overturned' ? ok(`${bookedRow.name} — 3 yellows, overturned`) : bad(JSON.stringify(bookedRow))
  tribRow?.suspensions?.[0]?.games === 3 && tribRow?.yellows === 0 ? ok(`${tribRow.name} — tribunal, no cards`) : bad(JSON.stringify(tribRow))
  rep?.rules?.games_per_red === 2 ? ok('with the rules on it') : bad('rules missing from the report')
  void id
}

await cleanup()
console.log(process.exitCode ? '\n\x1b[31mDISCIPLINE IS WRONG\x1b[0m\n' : '\n\x1b[32mall good\x1b[0m\n')
