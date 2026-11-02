// Run: node --env-file=.env.local scripts/test-concussion.mjs
//
// W-02: a concussion keeps a child off every team sheet, by name, until
// the club accepts a medical clearance. A parent or a coach records it; a
// parent can upload the clearance; only the club clears. The card says
// "no play" to the referee. Nobody outside the family and the club sees
// the record or the file.
import { createClient } from '@supabase/supabase-js'
import { signInClient } from './_auth.mjs'

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
const OUTSIDER = '00000000-0000-0000-0000-0000000000c2'
const U8 = '00000000-0000-0000-0000-0000000d0008'
const TAG = 'CONCUSS'

// Sessions are cached across suites (scripts/_auth.mjs), so a full run no
// longer trips the auth rate limit.
const signInEmail = (email) => signInClient(admin, email)
const { data: kidRow } = await admin.from('player_guardians').select('player_id, players(full_name, team_id)').eq('profile_id', PARENT).limit(1).single()
const kid = kidRow.player_id
const kidName = kidRow.players.full_name
async function cleanup() {
  const { data: comps } = await admin.from('competitions').select('id').like('name', `${TAG} %`)
  for (const c of comps ?? []) await admin.from('competitions').delete().eq('id', c.id)
  const { data: files } = await admin.storage.from('medical-clearances').list(`${NRIFA}/${kid}`)
  if (files?.length) await admin.storage.from('medical-clearances').remove(files.map((f) => `${NRIFA}/${kid}/${f.name}`))
  await admin.from('player_concussions').delete().eq('player_id', kid)
}
await cleanup()

const owner = await signInEmail((await admin.auth.admin.getUserById(OWNER)).data.user.email)
const parent = await signInEmail((await admin.auth.admin.getUserById(PARENT)).data.user.email)
const outsider = await signInEmail((await admin.auth.admin.getUserById(OUTSIDER)).data.user.email)
if (!owner || !parent || !outsider) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}

// A game next week for the sheet.
const { data: comp } = await admin.from('competitions').insert({ organiser_id: SPL, name: `${TAG} League`, type: 'season', season: '2026', status: 'active', mode: 'managed', visibility: 'participants', created_by: OWNER }).select('id').single()
await admin.from('competition_clubs').insert({ competition_id: comp.id, academy_id: NRIFA, status: 'active', joined_at: new Date().toISOString() })
const { data: entries } = await admin.from('competition_entries').insert([
  { competition_id: comp.id, academy_id: NRIFA, team_id: U8, display_name: 'NRIFA U8', division: 'U8' },
  { competition_id: comp.id, display_name: 'Visitors U8', division: 'U8' },
]).select('id')
const [home, away] = entries
const { data: fx } = await admin.from('fixtures').insert({ competition_id: comp.id, division: 'U8', round: 'R1', home_entry_id: home.id, away_entry_id: away.id, starts_at: new Date(Date.now() + 7 * 864e5).toISOString(), status: 'scheduled', stage: 'group' }).select('id').single()
await owner.rpc('seed_entry_squad', { p_entry: home.id })
const { data: sq } = await admin.from('entry_squads').select('player_id').eq('entry_id', home.id)
const sheetWith = (players) => players.slice(0, 9).map((id, i) => ({ player_id: id, number: i + 1, starting: true }))
const withKid = [kid, ...sq.map((s) => s.player_id).filter((id) => id !== kid)]

head(`1. The parent records a concussion for ${kidName}`)
let cId
{
  const { error: future } = await parent.rpc('record_concussion', { p_player: kid, p_occurred_on: '2099-01-01' })
  future ? ok('a date in the future is refused') : bad('a future concussion was recorded')
  const { error: stranger } = await outsider.rpc('record_concussion', { p_player: kid, p_occurred_on: '2026-10-24' })
  stranger?.code === '42501' ? ok('a stranger cannot record one') : bad('a stranger recorded a concussion')
  const { data, error } = await parent.rpc('record_concussion', { p_player: kid, p_occurred_on: '2026-10-24', p_note: 'Head clash at training' })
  error ? bad(`record: ${error.message}`) : ok('recorded by the parent, 24 Oct, "head clash at training"')
  cId = data
  const { data: rows } = await outsider.from('player_concussions').select('id').eq('player_id', kid)
  const seen = rows ?? []
  seen.length === 0 ? ok('a stranger sees no record') : bad('a stranger read the concussion')
}

head('2. Off every sheet, by name; the card says no play')
{
  const { error } = await owner.rpc('submit_match_sheet', { p_fixture: fx.id, p_entry: home.id, p_players: sheetWith(withKid) })
  error && /concussion/.test(error.message) ? ok(`the sheet is refused: "${error.message}"`) : bad(`sheet with a concussed child: ${error?.message ?? 'accepted'}`)
  const { data: card } = await owner.rpc('player_card', { p_player: kid })
  card?.concussion?.status === 'active' ? ok('the card carries "no play"') : bad(JSON.stringify(card?.concussion))
  const { error: ok9 } = await owner.rpc('submit_match_sheet', { p_fixture: fx.id, p_entry: home.id, p_players: sheetWith(withKid.filter((id) => id !== kid)) })
  ok9 ? bad(`sheet without them: ${ok9.message}`) : ok('the sheet without them goes in')
}

head("3. The clearance: the parent uploads it; only the club accepts")
{
  const pdf = new Blob(['%PDF-1.4\n% a letter from the doctor\n'], { type: 'application/pdf' })
  const wrongPath = `${NRIFA}/00000000-0000-0000-0000-000000000000/clearance.pdf`
  const { error: wrong } = await parent.storage.from('medical-clearances').upload(wrongPath, pdf, { contentType: 'application/pdf' })
  wrong ? ok("cannot upload under another child's folder") : bad('uploaded under a stranger\'s folder')
  const path = `${NRIFA}/${kid}/clearance-${Date.now()}.pdf`
  const { error: up } = await parent.storage.from('medical-clearances').upload(path, pdf, { contentType: 'application/pdf' })
  up ? bad(`upload: ${up.message}`) : ok('the parent uploads the letter into the private bucket')
  const { error: sub } = await parent.rpc('submit_concussion_clearance', { p_concussion: cId, p_path: path })
  sub ? bad(`submit: ${sub.message}`) : ok('and submits it')
  const { error: parentAccept } = await parent.rpc('decide_concussion_clearance', { p_concussion: cId, p_accept: true })
  parentAccept?.code === '42501' ? ok('the parent cannot accept their own child\'s clearance') : bad('a parent cleared their own child')
  const { error: still } = await owner.rpc('submit_match_sheet', { p_fixture: fx.id, p_entry: home.id, p_players: sheetWith(withKid) })
  still && /waiting for the club/.test(still.message) ? ok('still off the sheet while it waits') : bad(`sheet while waiting: ${still?.message ?? 'accepted'}`)
  const { data: signed } = await outsider.storage.from('medical-clearances').createSignedUrl(path, 60)
  !signed?.signedUrl ? ok('a stranger cannot get a link to the file') : bad('a stranger got a signed URL to the clearance')
  const { data: mine } = await owner.storage.from('medical-clearances').createSignedUrl(path, 60)
  mine?.signedUrl ? ok('the coach can open it') : bad('the coach cannot open the clearance')
  const { error: no } = await owner.rpc('decide_concussion_clearance', { p_concussion: cId, p_accept: false, p_note: 'Needs a doctor\'s letter, not a note' })
  no ? bad(`decline: ${no.message}`) : ok('the club does not accept it, with a reason')
  const { data: back } = await admin.from('player_concussions').select('status, decision_note').eq('id', cId).single()
  back.status === 'active' && /doctor/.test(back.decision_note) ? ok('back to active, reason kept') : bad(JSON.stringify(back))
  const path2 = `${NRIFA}/${kid}/clearance-${Date.now()}-2.pdf`
  await parent.storage.from('medical-clearances').upload(path2, pdf, { contentType: 'application/pdf' })
  await parent.rpc('submit_concussion_clearance', { p_concussion: cId, p_path: path2 })
  const { error: yes } = await owner.rpc('decide_concussion_clearance', { p_concussion: cId, p_accept: true })
  yes ? bad(`accept: ${yes.message}`) : ok('a second letter; the club accepts')
  const { error: play } = await owner.rpc('submit_match_sheet', { p_fixture: fx.id, p_entry: home.id, p_players: sheetWith(withKid) })
  play ? bad(`sheet after clearance: ${play.message}`) : ok(`${kidName} is back on the sheet`)
  const { data: card } = await owner.rpc('player_card', { p_player: kid })
  card?.concussion === null ? ok('the card no longer says no play') : bad(JSON.stringify(card?.concussion))
}

await cleanup()
console.log(process.exitCode ? '\n\x1b[31mTHE CONCUSSION REGISTER IS WRONG\x1b[0m\n' : '\n\x1b[32mall good\x1b[0m\n')
