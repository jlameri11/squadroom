// Run: node --env-file=.env.local scripts/test-league-comms.mjs
//
// L-11: a league's announcement reaches each club's STAFF channel and
// never a family. "See the draw, not each other's people."
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
const MARCUS = '00000000-0000-0000-0000-0000000000a2'
const PARENT = '00000000-0000-0000-0000-0000000000b1'
const TAG = 'COMMSTEST'

async function signIn(profileId) {
  const { data: u } = await admin.auth.admin.getUserById(profileId)
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email: u.user.email })
  if (!link?.properties?.hashed_token) return null
  const client = createClient(URL_, PUB, { auth: { persistSession: false } })
  const { data } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
  return data?.session ? client : null
}
const owner = await signIn(OWNER)
const marcus = await signIn(MARCUS)
const parent = await signIn(PARENT)
if (!owner || !marcus || !parent) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}

async function cleanup() {
  await admin.from('messages').delete().like('body', `%${TAG}%`)
  const { data: comps } = await admin.from('competitions').select('id').like('name', `${TAG} %`)
  for (const c of comps ?? []) await admin.from('competitions').delete().eq('id', c.id)
}
await cleanup()

const { data: comp } = await admin.from('competitions').insert({
  organiser_id: SPL, name: `${TAG} League`, type: 'season', season: '2026', status: 'active', mode: 'managed', visibility: 'participants', created_by: OWNER,
}).select('id').single()
await admin.from('competition_clubs').insert({ competition_id: comp.id, academy_id: NRIFA, status: 'active', joined_at: new Date().toISOString() })

head('1. The organiser sends; it lands in the club\'s coaches channel, not academy-wide')
{
  const { error: pErr } = await parent.rpc('broadcast_to_competition', { p_competition: comp.id, p_body: `${TAG} from a parent` })
  pErr?.code === '42501' ? ok('a parent cannot send to the competition') : bad('a parent broadcast')
  const { data: n, error } = await owner.rpc('broadcast_to_competition', { p_competition: comp.id, p_body: `${TAG} sheets are due Monday 9am` })
  error ? bad(`broadcast: ${error.message}`) : ok(`delivered to ${n} club${n === 1 ? '' : 's'}`)
  const { data: msgs } = await admin.from('messages').select('channel_id, channels(type)').like('body', `%${TAG} sheets%`).eq('academy_id', NRIFA)
  const types = (msgs ?? []).map((m) => m.channels?.type)
  types.length === 1 && types[0] === 'coaches' ? ok("one message, in NRIFA's coaches channel") : bad(`landed in: ${JSON.stringify(types)}`)
}

head('2. Staff read it; a family does not')
{
  const { data: m } = await admin.from('messages').select('channel_id').like('body', `%${TAG} sheets%`).eq('academy_id', NRIFA).single()
  const { data: coachRows } = await marcus.from('messages').select('id, body').eq('channel_id', m.channel_id).like('body', `%${TAG}%`)
  const coachSees = (coachRows ?? []).length
  coachSees === 1 ? ok('Marcus, a coach, reads it') : bad(`the coach reads ${coachSees} copies of the announcement`)
  const { data: parentRows } = await parent.from('messages').select('id').eq('channel_id', m.channel_id).like('body', `%${TAG}%`)
  const leaked = (parentRows ?? []).length
  leaked === 0 ? ok('Sam, a parent, sees nothing') : bad(`a parent read ${leaked} league announcement(s)`)
  const { data: anywhere } = await parent.from('messages').select('id').like('body', `%${TAG}%`)
  const anywhereN = (anywhere ?? []).length
  anywhereN === 0 ? ok('and it is in no channel a parent is in') : bad(`a parent can see it in ${anywhereN} channel(s)`)
}

await cleanup()
console.log(process.exitCode ? '\n\x1b[31mLEAGUE COMMS ARE WRONG\x1b[0m\n' : '\n\x1b[32mall good\x1b[0m\n')
