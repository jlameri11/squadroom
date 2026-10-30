// Run: node --env-file=.env.local scripts/test-ladder-adjustments.mjs
//
// L-10: points taken off (or given) with a reason, shown by every ladder
// the same way, never an edit to a score.
import { createClient } from '@supabase/supabase-js'

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

const OWNER = '00000000-0000-0000-0000-0000000000a1'
const PARENT = '00000000-0000-0000-0000-0000000000b1'

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

const { data: comp } = await admin.from('competitions').select('id, public_slug').eq('public_slug', 'nrifa-spring-gala').single()
const { data: divs } = await admin.from('competition_entries').select('division').eq('competition_id', comp.id)
const division = [...new Set(divs.map((d) => d.division))].sort()[0]
await admin.from('ladder_adjustments').delete().eq('competition_id', comp.id)

const { data: before } = await owner.rpc('competition_ladder', { p_competition: comp.id, p_division: division })
const top = before[0]

head(`1. Three points off ${top.team_name}, with a reason`)
{
  const { error: noWhy } = await owner.from('ladder_adjustments').insert({ competition_id: comp.id, division, entry_id: top.entry_id, points: -3, reason: '   ' })
  noWhy ? ok('no reason, no adjustment') : bad('an adjustment with no reason was accepted')
  const { error: zero } = await owner.from('ladder_adjustments').insert({ competition_id: comp.id, division, entry_id: top.entry_id, points: 0, reason: 'nothing' })
  zero ? ok('zero points is not an adjustment') : bad('zero accepted')
  const { error } = await owner.from('ladder_adjustments').insert({ competition_id: comp.id, division, entry_id: top.entry_id, points: -3, reason: 'Ineligible player in round 2' })
  error ? bad(`adjust: ${error.message}`) : ok('−3, "Ineligible player in round 2"')
  const { data: after } = await owner.rpc('competition_ladder', { p_competition: comp.id, p_division: division })
  const row = after.find((r) => r.entry_id === top.entry_id)
  row?.points === top.points - 3 ? ok(`${top.points} → ${row.points} on the ladder`) : bad(`points ${row?.points}`)
  row?.won === top.won && row?.goals_for === top.goals_for ? ok('results untouched') : bad('results changed')
}

head('2. The public page shows the same table')
{
  const { data: centre } = await anon.rpc('public_match_centre', { p_slug: comp.public_slug })
  const pub = (centre?.ladder?.[division] ?? []).find((r) => r.entry_id === top.entry_id)
  pub?.points === top.points - 3 ? ok('the public ladder has the deduction') : bad(`public points ${pub?.points}`)
}

head('3. A parent cannot adjust; every participant can see why')
{
  const { data, error } = await parent.from('ladder_adjustments').insert({ competition_id: comp.id, division, entry_id: top.entry_id, points: 9, reason: 'please' }).select('id')
  error || !data?.length ? ok('a parent is refused') : bad('a parent adjusted the ladder')
  const { data: seen } = await parent.from('ladder_adjustments').select('points, reason').eq('competition_id', comp.id)
  seen?.length === 1 && /Ineligible/.test(seen[0].reason) ? ok(`and reads the reason: "${seen[0].reason}"`) : bad(`parent sees ${JSON.stringify(seen)}`)
}

await admin.from('ladder_adjustments').delete().eq('competition_id', comp.id)
console.log(process.exitCode ? '\n\x1b[31mADJUSTMENTS ARE WRONG\x1b[0m\n' : '\n\x1b[32mall good\x1b[0m\n')
