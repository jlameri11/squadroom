// Run: node --env-file=.env.local scripts/test-safeguarding-gate.mjs
//
// W-03: a Working With Children Check that LAPSES removes coaching rights
// on the spot — the roster, the children's channel, the sheets — and gives
// them back when renewed. Nothing recorded stays the 0120 backlog, not a
// block. And the reportable-conduct register: any member files; only the
// club's safeguarding officers read.
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
const OWNER = '00000000-0000-0000-0000-0000000000a1'
const MARCUS = '00000000-0000-0000-0000-0000000000a2'
const PARENT = '00000000-0000-0000-0000-0000000000b1'
const OUTSIDER = '00000000-0000-0000-0000-0000000000c2'
const U8 = '00000000-0000-0000-0000-0000000d0008'
const TAG = 'SGGATE'

// Sessions are cached across suites (scripts/_auth.mjs), so a full run no
// longer trips the auth rate limit.
const signInEmail = (email) => signInClient(admin, email)
const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10)
const nextYear = new Date(Date.now() + 400 * 864e5).toISOString().slice(0, 10)
async function cleanup() {
  await admin.from('staff_clearances').delete().eq('profile_id', MARCUS).eq('academy_id', NRIFA).eq('number', 'WWCLAPSE1')
  await admin.from('messages').delete().like('body', `${TAG}%`)
  await admin.from('conduct_reports').delete().like('description', `${TAG}%`)
}
await cleanup()

const marcus = await signInEmail((await admin.auth.admin.getUserById(MARCUS)).data.user.email)
const owner = await signInEmail((await admin.auth.admin.getUserById(OWNER)).data.user.email)
const parent = await signInEmail((await admin.auth.admin.getUserById(PARENT)).data.user.email)
const outsider = await signInEmail((await admin.auth.admin.getUserById(OUTSIDER)).data.user.email)
if (!marcus || !owner || !parent || !outsider) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}
const { data: ch } = await admin.from('channels').select('id').eq('team_id', U8).eq('status', 'active').limit(1).single()
const post = (client, body) => client.from('messages').insert({ academy_id: NRIFA, channel_id: ch.id, sender_id: MARCUS, body, status: 'published' })
const { data: hadClearance } = await admin.from('staff_clearances').select('id').eq('profile_id', MARCUS).eq('academy_id', NRIFA).maybeSingle()

head('1. With nothing recorded, Marcus coaches as before (the 0120 backlog, not a block)')
{
  if (hadClearance) console.log('  (Marcus already has a clearance; the lapse below replaces it for the test)')
  const { data: kids } = await marcus.from('players').select('id').eq('team_id', U8)
  const kidsRows = kids ?? []
  kidsRows.length > 0 ? ok(`Marcus sees his ${kidsRows.length} U8 players`) : bad('Marcus cannot see his roster to begin with')
  const { error } = await post(marcus, `${TAG} training is on`)
  error ? bad(`post before: ${error.message}`) : ok('and posts in the U8 channel')
}

head('2. His check expired yesterday: no roster, no channel, no sheet')
{
  if (hadClearance) await admin.from('staff_clearances').delete().eq('id', hadClearance.id)
  const { error } = await admin.from('staff_clearances').insert({ academy_id: NRIFA, profile_id: MARCUS, kind: 'wwcc', number: 'WWCLAPSE1', outcome: 'cleared', expires_on: yesterday, verified_by: OWNER })
  error ? bad(`lapsed clearance: ${error.message}`) : ok('a clearance that expired yesterday is recorded')
  const { data: kids } = await marcus.from('players').select('id').eq('team_id', U8)
  const kidsRows = kids ?? []
  kidsRows.length === 0 ? ok('Marcus no longer sees the roster') : bad(`a lapsed coach still sees ${kidsRows.length} players`)
  const { error: pe } = await post(marcus, `${TAG} should not land`)
  pe ? ok('and cannot post to the children\'s channel') : bad('a lapsed coach posted to the team channel')
  const { data: canRead } = await marcus.from('channels').select('id').eq('id', ch.id)
  const readRows = canRead ?? []
  readRows.length === 1 ? ok('he can still read it — membership stays, rights go') : bad('a lapsed coach lost the channel entirely')
  const { data: board } = await owner.rpc('clearance_board', { p_academy: NRIFA })
  const row = (board ?? []).find((r) => r.profile_id === MARCUS)
  row?.state === 'expired' ? ok('the board shows him expired') : bad(`board: ${JSON.stringify(row)}`)
}

head('3. Renewed, the rights come back')
{
  await admin.from('staff_clearances').update({ expires_on: nextYear }).eq('profile_id', MARCUS).eq('academy_id', NRIFA).eq('number', 'WWCLAPSE1')
  const { data: kids } = await marcus.from('players').select('id').eq('team_id', U8)
  const kidsRows = kids ?? []
  kidsRows.length > 0 ? ok('the roster is back') : bad('still no roster after renewal')
  const { error } = await post(marcus, `${TAG} back`)
  error ? bad(`post after renewal: ${error.message}`) : ok('and so is posting')
  await admin.from('staff_clearances').update({ outcome: 'barred' }).eq('profile_id', MARCUS).eq('academy_id', NRIFA).eq('number', 'WWCLAPSE1')
  const { data: barred } = await marcus.from('players').select('id').eq('team_id', U8)
  const barredRows = barred ?? []
  barredRows.length === 0 ? ok('a barred outcome blocks the same way, whatever the date') : bad('a barred coach sees the roster')
}

head('4. The reportable-conduct register')
let reportId
{
  const { error: short } = await parent.rpc('file_conduct_report', { p_academy: NRIFA, p_category: 'concern', p_description: 'short' })
  short ? ok('a one-word report is refused') : bad('a one-word report was filed')
  const { error: stranger } = await outsider.rpc('file_conduct_report', { p_academy: NRIFA, p_category: 'concern', p_description: `${TAG} I am not even a member here` })
  stranger?.code === '42501' ? ok('a non-member cannot file at this club') : bad('a non-member filed a report')
  const { data: id, error } = await parent.rpc('file_conduct_report', { p_academy: NRIFA, p_category: 'boundary_breach', p_description: `${TAG} A coach messaged my child directly, late at night, about nothing to do with football.`, p_occurred_on: yesterday, p_subject_name: 'The U8 assistant', p_involves_child: true })
  error ? bad(`file: ${error.message}`) : ok('a parent files a boundary concern')
  reportId = id
  const { data: mine } = await parent.from('conduct_reports').select('id, status').eq('id', reportId)
  const mineRows = mine ?? []
  mineRows.length === 1 ? ok('the parent sees their own report') : bad('the reporter cannot see their own report')
  const { data: notOfficer } = await marcus.rpc('conduct_register', { p_academy: NRIFA })
  notOfficer === null ? ok('a coach who is not an officer sees no register') : bad('a coach read the register')
  const { data: reg } = await owner.rpc('conduct_register', { p_academy: NRIFA })
  const regRows = reg ?? []
  regRows.some((r) => r.id === reportId) ? ok('the owner (an officer by default) sees it on the register') : bad(`register: ${JSON.stringify(reg)?.slice(0, 120)}`)
  const { error: needWho } = await owner.rpc('review_conduct_report', { p_report: reportId, p_status: 'referred' })
  needWho ? ok('"referred" needs a who') : bad('referred to nobody')
  const { error: coachReview } = await marcus.rpc('review_conduct_report', { p_report: reportId, p_status: 'closed', p_outcome: 'nothing' })
  coachReview?.code === '42501' ? ok('a coach cannot review it') : bad('a coach reviewed a report')
  const { error: rv } = await owner.rpc('review_conduct_report', { p_report: reportId, p_status: 'referred', p_referred_to: 'Football NSW member protection' })
  rv ? bad(`review: ${rv.message}`) : ok('the officer refers it to Football NSW')
  const { data: after } = await admin.from('conduct_reports').select('status, referred_to, reviewed_by').eq('id', reportId).single()
  after.status === 'referred' && after.reviewed_by === OWNER ? ok('recorded with who and when') : bad(JSON.stringify(after))
  const { data: none } = await outsider.from('conduct_reports').select('id')
  const noneRows = none ?? []
  noneRows.length === 0 ? ok('another tenant sees nothing') : bad('another tenant read conduct reports')
}

await cleanup()
if (hadClearance) {
  // Put the original back the way the sheet test leaves it.
  await admin.from('staff_clearances').insert({ academy_id: NRIFA, profile_id: MARCUS, kind: 'wwcc', number: 'WWC0000001E', outcome: 'cleared', expires_on: nextYear, verified_by: OWNER })
}
console.log(process.exitCode ? '\n\x1b[31mTHE SAFEGUARDING GATE IS WRONG\x1b[0m\n' : '\n\x1b[32mall good\x1b[0m\n')
