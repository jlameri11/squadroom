// Run: node --env-file=.env.local scripts/test-official-rego.mjs
//
// R-14: a club records whether a child is registered with PlayFootball,
// and the family is reminded a fortnight before round one until it is.
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
const OWNER = '00000000-0000-0000-0000-0000000000a1'
const PARENT = '00000000-0000-0000-0000-0000000000b1'
const U8 = '00000000-0000-0000-0000-0000000d0008'

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

// A squad of our own, so the only match that counts is the one this test
// makes. The seeded squads have real fixtures inside a fortnight, which is
// exactly why the first version of this test could not prove "nothing for
// a game forty days out".
async function cleanup() {
  const { data: teams } = await admin.from('teams').select('id').eq('academy_id', NRIFA).like('name', 'REGOTEST %')
  for (const t of teams ?? []) {
    const { data: ps } = await admin.from('players').select('id').eq('team_id', t.id)
    for (const p of ps ?? []) {
      await admin.from('notification_queue').delete().eq('kind', 'official_rego_pending').filter('payload->>player_id', 'eq', p.id)
      await admin.from('player_guardians').delete().eq('player_id', p.id)
    }
    await admin.from('players').delete().eq('team_id', t.id)
    await admin.from('events').delete().eq('team_id', t.id)
    await admin.from('teams').delete().eq('id', t.id)
  }
}
await cleanup()
void U8
const { data: team, error: teamErr } = await admin
  .from('teams')
  .insert({ academy_id: NRIFA, name: 'REGOTEST U9', age_group: 'U9', season: '2026', status: 'active' })
  .select('id')
  .single()
if (teamErr) {
  bad(`could not make a squad: ${teamErr.message}`)
  process.exit(1)
}
const { data: kid } = await admin
  .from('players')
  .insert({ academy_id: NRIFA, team_id: team.id, full_name: 'REGOTEST Child', dob: '2017-06-06' })
  .select('id, full_name')
  .single()
await admin.from('player_guardians').insert({ academy_id: NRIFA, player_id: kid.id, profile_id: PARENT, relationship: 'parent' })
const guardians = [PARENT]

const kickOff = new Date(Date.now() + 3 * 864e5)
const { data: ev } = await admin
  .from('events')
  .insert({ academy_id: NRIFA, team_id: team.id, type: 'match', title: 'REGOTEST Round 1', starts_at: kickOff.toISOString() })
  .select('id')
  .single()
const clear = () => admin.from('notification_queue').delete().eq('kind', 'official_rego_pending').filter('payload->>player_id', 'eq', kid.id)
await clear()
const mine = async () =>
  (await admin.from('notification_queue').select('profile_id, body, url').eq('kind', 'official_rego_pending').filter('payload->>player_id', 'eq', kid.id)).data ?? []

head('1. The coach records what they saw in PlayFootball')
{
  const { error } = await owner.rpc('set_official_status', { p_player: kid.id, p_status: 'pending', p_ff_number: ' 12345678 ' })
  error ? bad(`set: ${error.message}`) : ok(`${kid.full_name} marked pending`)
  const { data: p } = await admin.from('players').select('official_status, ff_number, official_status_by').eq('id', kid.id).single()
  p.official_status === 'pending' && p.ff_number === '12345678' && p.official_status_by === OWNER
    ? ok('status, trimmed number and who set it are recorded')
    : bad(JSON.stringify(p))
  const { error: keep } = await owner.rpc('set_official_status', { p_player: kid.id, p_status: 'pending' })
  const { data: p2 } = await admin.from('players').select('ff_number').eq('id', kid.id).single()
  !keep && p2.ff_number === '12345678' ? ok('a blank number leaves the number alone') : bad(`number became ${p2.ff_number}`)
}

head('2. A parent cannot')
{
  const { error } = await parent.rpc('set_official_status', { p_player: kid.id, p_status: 'registered' })
  error?.code === '42501' ? ok(`refused: "${error.message}"`) : bad(error ? error.message : 'a parent marked their own child registered')
}

head('3. A fortnight out, every guardian is reminded — once a week')
{
  const { data: n, error } = await admin.rpc('queue_official_rego_reminders')
  error ? bad(`sweep: ${error.message}`) : ok(`sweep queued ${n}`)
  const rows = await mine()
  rows.length === guardians.length && guardians.every((g) => rows.some((r) => r.profile_id === g))
    ? ok(`one reminder per guardian (${guardians.length})`)
    : bad(`${rows.length} reminders for ${guardians.length} guardians`)
  rows[0]?.body.includes('in 3 days') || rows[0]?.body.includes('in 2 days')
    ? ok(`says when: "${rows[0].body.slice(0, 60)}…"`)
    : bad(`body: ${rows[0]?.body}`)
  rows[0]?.url === '/settings/family' ? ok('and lands on My family') : bad(`url ${rows[0]?.url}`)
  await admin.rpc('queue_official_rego_reminders')
  const again = (await mine()).length
  again === rows.length ? ok('a second sweep the same day adds nothing') : bad('a second sweep nagged again')
}

head('4. Registered means no reminder; so does a game further off')
{
  await clear()
  await owner.rpc('set_official_status', { p_player: kid.id, p_status: 'registered' })
  await admin.rpc('queue_official_rego_reminders')
  const after = await mine()
  after.length === 0 ? ok('nothing once registered') : bad(`${after.length} reminders for a registered child`)

  await owner.rpc('set_official_status', { p_player: kid.id, p_status: 'pending' })
  await admin.from('events').update({ starts_at: new Date(Date.now() + 40 * 864e5).toISOString() }).eq('id', ev.id)
  await admin.rpc('queue_official_rego_reminders')
  const far = await mine()
  far.length === 0 ? ok('nothing for a game forty days out') : bad(`${far.length} reminders forty days early`)

  // 0138: 'unknown' is nobody having checked, not a fact about the child.
  await admin.from('events').update({ starts_at: kickOff.toISOString() }).eq('id', ev.id)
  await owner.rpc('set_official_status', { p_player: kid.id, p_status: 'unknown' })
  await admin.rpc('queue_official_rego_reminders')
  const unknown = await mine()
  unknown.length === 0 ? ok("nothing for 'unknown' — only a club's own 'pending' earns a push") : bad(`${unknown.length} reminders for an unchecked child`)
}

head('5. The family sees it')
{
  await owner.rpc('set_official_status', { p_player: kid.id, p_status: 'pending' })
  const { data: fam } = await parent.rpc('my_family')
  const c = (fam ?? []).find((k) => k.id === kid.id)
  c?.official_status === 'pending' ? ok('my_family carries the status') : bad(`my_family: ${c?.official_status}`)
}

await cleanup()
console.log(process.exitCode ? '\n\x1b[31mOFFICIAL REGO IS WRONG\x1b[0m\n' : '\n\x1b[32mall good\x1b[0m\n')
