// Run: node --env-file=.env.local scripts/test-fee-settings.mjs
//
// B-02 / B-03: the settings that 0102 has carried since it was written, now
// reachable. test-fees proves the arithmetic; this proves the WRITES the
// screens make — exactly the calls they make, under RLS — and who may make
// them.
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

const { data: before } = await admin.from('academies').select('sibling_discount_bps').eq('id', NRIFA).single()
const ladderNow = async () => (await admin.from('academies').select('sibling_discount_bps').eq('id', NRIFA).single()).data.sibling_discount_bps

head('1. The owner sets the family discount from Club settings')
{
  const { error } = await owner.from('academies').update({ sibling_discount_bps: [1000, 2000] }).eq('id', NRIFA)
  error ? bad(`owner: ${error.message}`) : ok('2nd child 10%, 3rd and beyond 20% — saved')
  JSON.stringify(await ladderNow()) === '[1000,2000]' ? ok('and it is what the database holds') : bad(`holds ${JSON.stringify(await ladderNow())}`)
  const { error: off } = await owner.from('academies').update({ sibling_discount_bps: [] }).eq('id', NRIFA)
  off ? bad(`turning it off: ${off.message}`) : ok('and can turn it off again')
}

head('2. What the constraint refuses')
for (const [name, ladder] of [
  ['a negative discount', [-100]],
  ['more than 100% off', [15000]],
]) {
  const { error } = await owner.from('academies').update({ sibling_discount_bps: ladder }).eq('id', NRIFA)
  error ? ok(`${name}: refused`) : bad(`${name} was accepted`)
}

head('3. A parent cannot set it')
{
  const { data } = await parent.from('academies').update({ sibling_discount_bps: [9000] }).eq('id', NRIFA).select('id')
  const after = await ladderNow()
  !data?.length && JSON.stringify(after) !== '[9000]' ? ok('the update matched nothing and changed nothing') : bad(`a parent set ${JSON.stringify(after)}`)
}

head('4. A fee asked for in four quotes a four-part schedule')
{
  await admin.from('payment_requests').delete().eq('academy_id', NRIFA).like('title', 'FEESET %')
  const { data: req, error } = await owner
    .from('payment_requests')
    .insert({
      academy_id: NRIFA,
      title: 'FEESET Term fee',
      amount_cents: 45000,
      instalments: 4,
      instalment_every_days: 30,
      created_by: OWNER,
    })
    .select('id')
    .single()
  if (error) bad(`insert: ${error.message}`)
  else {
    ok('the form\'s insert is accepted')
    const { data: q } = await parent.rpc('quote_payment', { p_request: req.id, p_player: null })
    q?.instalments === 4 && q?.schedule?.length === 4 ? ok('quote: four parts') : bad(`quote: ${JSON.stringify(q)?.slice(0, 160)}`)
    const sum = (q?.schedule ?? []).reduce((n, s) => n + s.amount_cents, 0)
    sum === q?.net_cents ? ok(`summing to ${(sum / 100).toFixed(2)} exactly`) : bad(`parts sum to ${sum}, net ${q?.net_cents}`)
    const { error: bad13 } = await owner.from('payment_requests').insert({ academy_id: NRIFA, title: 'FEESET 13', amount_cents: 1000, instalments: 13, created_by: OWNER })
    bad13 ? ok('thirteen instalments is refused') : bad('thirteen instalments was accepted')
    await admin.from('payment_requests').delete().eq('academy_id', NRIFA).like('title', 'FEESET %')
  }
}

await admin.from('academies').update({ sibling_discount_bps: before.sibling_discount_bps }).eq('id', NRIFA)
console.log(process.exitCode ? '\n\x1b[31mFEE SETTINGS ARE WRONG\x1b[0m\n' : '\n\x1b[32mall good\x1b[0m\n')
