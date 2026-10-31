// Run: node --env-file=.env.local scripts/test-referee-auto.mjs
//
// W-05: a day's appointments proposed at once — nobody blocked out, nobody
// on two pitches at the same time, the lightest load first, the same
// referee kept at a ground for back-to-back games — previewed without
// changing anything, applied as ordinary offers under one batch, undone
// as a batch without touching an acceptance.
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
const TAG = 'REFAUTO'
const OFFICIAL_EMAIL = 'refauto-official@squadroom.invalid'
const REF_EMAIL = 'refauto-ref@squadroom.invalid'

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
  for (const e of [OFFICIAL_EMAIL, REF_EMAIL]) {
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

const { data: offUser } = await admin.auth.admin.createUser({ email: OFFICIAL_EMAIL, email_confirm: true })
await admin.from('profiles').upsert({ id: offUser.user.id, full_name: 'Olive Official' })
await admin.from('staff_clearances').insert({ academy_id: SPL, profile_id: offUser.user.id, kind: 'wwcc', number: 'WWC0000782E', outcome: 'cleared', expires_on: new Date(Date.now() + 400 * 864e5).toISOString().slice(0, 10), verified_by: OWNER })
await admin.from('academy_members').insert({ academy_id: SPL, profile_id: offUser.user.id, role: 'admin', status: 'active' })
const { data: refUser } = await admin.auth.admin.createUser({ email: REF_EMAIL, email_confirm: true })
await admin.from('profiles').upsert({ id: refUser.user.id, full_name: `Pat Whistle ${TAG}` })

const official = await signInEmail(OFFICIAL_EMAIL)
const pat = await signInEmail(REF_EMAIL)
const parent = await signInEmail((await admin.auth.admin.getUserById(PARENT)).data.user.email)
if (!official || !pat || !parent) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  await cleanup()
  process.exit(2)
}

const { data: comp } = await admin.from('competitions').insert({ organiser_id: SPL, name: `${TAG} League`, type: 'season', season: '2026', status: 'active', mode: 'managed', visibility: 'participants', created_by: OWNER }).select('id').single()
await admin.from('competition_clubs').insert({ competition_id: comp.id, academy_id: NRIFA, status: 'active', joined_at: new Date().toISOString() })
const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
await admin.from('competition_divisions').insert({ competition_id: comp.id, division: 'U10', match_length_mins: 40, allow_playing_up: true })
const { data: entries } = await admin.from('competition_entries').insert(names.map((n) => ({ competition_id: comp.id, display_name: `Team ${n}`, division: 'U10' }))).select('id, display_name')
const e = Object.fromEntries(entries.map((x) => [x.display_name.slice(-1), x.id]))
const sat = new Date(); sat.setDate(sat.getDate() + ((6 - sat.getDay() + 7) % 7 || 7)); sat.setHours(9, 0, 0, 0)
const at = (h, m = 0) => new Date(sat.getTime() + h * 3600_000 + m * 60_000).toISOString()
// Four games: two at 9:00 on two fields at one ground, one at 10:00 at the same ground, one at 10:00 across town.
const { data: fx } = await admin.from('fixtures').insert([
  { competition_id: comp.id, division: 'U10', round: 'R1', home_entry_id: e.A, away_entry_id: e.B, starts_at: at(0), venue_label: 'Nolan Reserve', field_label: 'Field 1', status: 'scheduled', stage: 'group' },
  { competition_id: comp.id, division: 'U10', round: 'R1', home_entry_id: e.C, away_entry_id: e.D, starts_at: at(0), venue_label: 'Nolan Reserve', field_label: 'Field 2', status: 'scheduled', stage: 'group' },
  { competition_id: comp.id, division: 'U10', round: 'R1', home_entry_id: e.E, away_entry_id: e.F, starts_at: at(1), venue_label: 'Nolan Reserve', field_label: 'Field 1', status: 'scheduled', stage: 'group' },
  { competition_id: comp.id, division: 'U10', round: 'R1', home_entry_id: e.G, away_entry_id: e.H, starts_at: at(1), venue_label: 'ELS Hall', field_label: 'Field 1', status: 'scheduled', stage: 'group' },
]).select('id, starts_at, field_label, venue_label')
const satDate = sat.toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' })
const { data: p1 } = await official.rpc('add_referee', { p_competition: comp.id, p_full_name: `Pat Whistle ${TAG}`, p_profile: refUser.user.id })
const { data: p2 } = await official.rpc('add_referee', { p_competition: comp.id, p_full_name: `Sam Flag ${TAG}` })
const { data: p3 } = await official.rpc('add_referee', { p_competition: comp.id, p_full_name: `Busy Person ${TAG}` })
const { data: p4 } = await official.rpc('add_referee', { p_competition: comp.id, p_full_name: `Dee Free ${TAG}` })
// Busy Person is blocked out all morning; Sam already has two games this season (a heavier load).
await admin.from('referee_blockouts').insert({ referee_id: p3, academy_id: SPL, starts_at: at(-2), ends_at: at(6), reason: 'away' })
const { data: old } = await admin.from('fixtures').insert([
  { competition_id: comp.id, division: 'U10', round: 'R0', home_entry_id: e.A, away_entry_id: e.C, starts_at: at(-7 * 24), status: 'final', home_score: 1, away_score: 0, stage: 'group' },
  { competition_id: comp.id, division: 'U10', round: 'R0', home_entry_id: e.B, away_entry_id: e.D, starts_at: at(-7 * 24 + 1), status: 'final', home_score: 1, away_score: 0, stage: 'group' },
]).select('id')
await admin.from('referee_appointments').insert(old.map((f) => ({ competition_id: comp.id, fixture_id: f.id, referee_id: p2, academy_id: SPL, role: 'referee', status: 'accepted' })))
// Dee has one game behind her (as an assistant on one of them).
await admin.from('referee_appointments').insert({ competition_id: comp.id, fixture_id: old[0].id, referee_id: p4, academy_id: SPL, role: 'assistant', status: 'accepted' })

head('1. The draft: who is free, lightest load first, nobody on two pitches at once')
let rows
{
  const { error: notYours } = await parent.rpc('propose_referee_allocation', { p_competition: comp.id, p_date: satDate })
  notYours?.code === '42501' ? ok('a parent cannot propose') : bad('a parent proposed appointments')
  const { data, error } = await official.rpc('propose_referee_allocation', { p_competition: comp.id, p_date: satDate })
  error ? bad(`propose: ${error.message}`) : ok(`a draft for ${satDate}: ${data.length} games`)
  rows = data
  rows.length === 4 ? ok('all four unappointed games are in it') : bad(`${rows.length} rows`)
  !rows.some((r) => r.referee_id === p3) ? ok('Busy Person (blocked out) is on none') : bad('a blocked-out referee was proposed')
  const nine = rows.filter((r) => new Date(r.starts_at).getTime() === sat.getTime())
  nine.length === 2 && nine[0].referee_id !== nine[1].referee_id ? ok('the two 9:00 games get two different referees') : bad(JSON.stringify(nine.map((r) => r.referee)))
  nine.some((r) => r.referee_id === p1) && nine.some((r) => r.referee_id === p4) ? ok('Pat (0 games) and Dee (1) take 9:00 — the lightest loads; Sam (2) waits') : bad(JSON.stringify(nine.map((r) => [r.referee, r.load])))
  const ten = rows.filter((r) => new Date(r.starts_at).getTime() === sat.getTime() + 3600_000)
  ten.every((r) => r.referee_id) ? ok('both 10:00 games are covered too') : bad(`10:00: ${JSON.stringify(ten.map((r) => [r.home, r.referee, r.why]))}`)
  const nolan10 = ten.find((r) => r.venue === 'Nolan Reserve')
  const nineAtNolanF1 = nine.find((r) => r.field === 'Field 1')
  nolan10?.referee_id === nineAtNolanF1?.referee_id || nolan10?.referee_id === nine.find((r) => r.field === 'Field 2')?.referee_id ? ok(`the 10:00 at Nolan Reserve keeps someone already there (${nolan10?.referee}) — no car trip between two fields`) : bad(`the back-to-back game at the same ground went to ${nolan10?.referee}`)
  const els10 = ten.find((r) => r.venue === 'ELS Hall')
  els10?.referee_id === p2 ? ok('the 10:00 across town goes to Sam, the only one not at Nolan') : bad(`ELS Hall: ${els10?.referee ?? els10?.why}`)
  const { count } = await admin.from('referee_appointments').select('id', { count: 'exact', head: true }).eq('competition_id', comp.id).in('fixture_id', fx.map((f) => f.id))
  count === 0 ? ok('the preview wrote nothing') : bad(`preview created ${count} appointments`)
}

head('2. Applied as offers under one batch, each with a push')
let batch
{
  const { data, error } = await official.rpc('apply_referee_allocation', { p_competition: comp.id, p_rows: rows.map((r) => ({ fixture_id: r.fixture_id, referee_id: r.referee_id })) })
  error ? bad(`apply: ${error.message}`) : ok(`${data.appointed} asked, ${data.failed.length} failed`)
  batch = data?.batch_id
  data?.appointed === 4 ? ok('all four offered') : bad(JSON.stringify(data))
  const { data: appts } = await admin.from('referee_appointments').select('status, batch_id, referee_id').eq('batch_id', batch)
  appts.length === 4 && appts.every((a) => a.status === 'offered') ? ok('four offered appointments carry the batch id') : bad(JSON.stringify(appts))
  const { data: pushes } = await admin.from('notification_queue').select('id').eq('profile_id', refUser.user.id).eq('kind', 'referee_appointment')
  const pushRows = pushes ?? []
  pushRows.length >= 1 ? ok(`Pat got ${pushRows.length} push(es) — Sam has no app yet, so none`) : bad('no push to Pat')
  const { data: again } = await official.rpc('propose_referee_allocation', { p_competition: comp.id, p_date: satDate })
  again.length === 0 ? ok('a second preview finds nothing left to appoint') : bad(`second preview: ${again.length}`)
}

head('3. Undo withdraws what nobody accepted, and keeps a yes')
{
  const { data: mine } = await pat.rpc('my_appointments')
  const first = mine.appointments.find((a) => a.status === 'offered')
  await pat.rpc('respond_appointment', { p_appointment: first.id, p_accept: true })
  ok('Pat accepts one of his')
  const { error: notYours } = await parent.rpc('undo_referee_allocation', { p_batch: batch })
  notYours?.code === '42501' ? ok('a parent cannot undo') : bad('a parent undid a batch')
  const { data, error } = await official.rpc('undo_referee_allocation', { p_batch: batch })
  error ? bad(`undo: ${error.message}`) : ok(`undo: ${data.undone} withdrawn, ${data.kept} kept`)
  data?.undone === 3 && data.kept === 1 ? ok('three withdrawn; the accepted one stays') : bad(JSON.stringify(data))
  const { data: after } = await admin.from('referee_appointments').select('status').eq('batch_id', batch)
  after.filter((a) => a.status === 'withdrawn').length === 3 && after.some((a) => a.status === 'accepted') ? ok('the rows say the same') : bad(JSON.stringify(after))
  const { data: wd } = await admin.from('notification_queue').select('body').eq('profile_id', refUser.user.id).eq('kind', 'referee_withdrawn')
  const wdRows = wd ?? []
  wdRows.length >= 1 && /re-done/.test(wdRows[0].body) ? ok('Pat is told the withdrawn one was re-done') : bad(JSON.stringify(wdRows))
  const { data: third } = await official.rpc('propose_referee_allocation', { p_competition: comp.id, p_date: satDate })
  third.length === 3 ? ok('the three undone games are proposable again') : bad(`after undo: ${third.length}`)
}

await cleanup()
console.log(process.exitCode ? '\n\x1b[31mAUTO-ASSIGNMENT IS WRONG\x1b[0m\n' : '\n\x1b[32mall good\x1b[0m\n')
