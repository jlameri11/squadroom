// Run: node --env-file=.env.local scripts/test-trial-offers.mjs
//
// R-13: a trial ends in an offer — a dated, pre-approved squad place the
// family accepts (and pays), declines, or lets lapse.
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
const OUTSIDER = '00000000-0000-0000-0000-0000000000c2'
const TAG = 'OFFERTEST'

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
const outsider = await signIn(OUTSIDER)
if (!owner || !parent || !outsider) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}

async function cleanup() {
  const { data: teams } = await admin.from('teams').select('id').eq('academy_id', NRIFA).like('name', `${TAG} %`)
  const { data: progs } = await admin.from('programs').select('id').eq('academy_id', NRIFA).like('name', `${TAG} %`)
  const pids = (progs ?? []).map((p) => p.id)
  const { data: kids } = await admin.from('players').select('id').eq('academy_id', NRIFA).like('full_name', `% ${TAG}`)
  for (const k of kids ?? []) {
    await admin.from('notification_queue').delete().eq('kind', 'offer').filter('payload->>player_id', 'eq', k.id)
    await admin.from('offers').delete().eq('player_id', k.id)
    await admin.from('program_registrations').delete().eq('player_id', k.id)
    await admin.from('player_guardians').delete().eq('player_id', k.id)
  }
  await admin.from('players').delete().eq('academy_id', NRIFA).like('full_name', `% ${TAG}`)
  if (pids.length) {
    await admin.from('payment_requests').delete().in('program_id', pids)
    await admin.from('programs').delete().in('id', pids)
  }
  for (const t of teams ?? []) await admin.from('teams').delete().eq('id', t.id)
}
await cleanup()

// A trial, a squad program with a team and a fee, and three trialists.
const { data: team } = await admin.from('teams').insert({ academy_id: NRIFA, name: `${TAG} U9`, age_group: 'U9', season: '2027', status: 'active' }).select('id').single()
const { data: trial } = await admin.from('programs').insert({ academy_id: NRIFA, name: `${TAG} Trials`, kind: 'trial', status: 'open', created_by: OWNER }).select('id').single()
const { data: squad } = await admin.from('programs').insert({ academy_id: NRIFA, name: `${TAG} U9 Squad`, kind: 'squad', status: 'open', team_id: team.id, capacity: 2, created_by: OWNER }).select('id').single()
const { data: fee } = await admin.from('payment_requests').insert({ academy_id: NRIFA, title: `${TAG} season fee`, amount_cents: 42000, program_id: squad.id, created_by: OWNER }).select('id').single()
const { data: kids } = await admin
  .from('players')
  .insert(['Ava', 'Ben', 'Cal'].map((n, i) => ({ academy_id: NRIFA, full_name: `${n} ${TAG}`, dob: `2018-0${i + 1}-01` })))
  .select('id, full_name')
for (const k of kids) await admin.from('player_guardians').insert({ academy_id: NRIFA, player_id: k.id, profile_id: PARENT, relationship: 'parent' })
const { data: regs } = await admin
  .from('program_registrations')
  .insert(kids.map((k) => ({ academy_id: NRIFA, program_id: trial.id, player_id: k.id, submitted_by: PARENT, status: 'approved' })))
  .select('id, player_id')
const regOf = (kid) => regs.find((r) => r.player_id === kid.id).id
const [ava, ben, cal] = kids

head('1. Only a coach offers, only out of a trial, only into an open squad')
{
  const { error } = await parent.rpc('make_offer', { p_registration: regOf(ava), p_squad_program: squad.id, p_days: 7 })
  error?.code === '42501' ? ok('a parent cannot') : bad(error ? error.message : 'a parent made an offer')
  const { error: notTrial } = await owner.rpc('make_offer', { p_registration: regOf(ava), p_squad_program: trial.id, p_days: 7 })
  notTrial ? ok(`into a non-squad program: "${notTrial.message.slice(0, 50)}"`) : bad('offered a place in a trial')
  const { data: id, error: made } = await owner.rpc('make_offer', { p_registration: regOf(ava), p_squad_program: squad.id, p_days: 7 })
  made ? bad(`make_offer: ${made.message}`) : ok("Ava is offered a place, seven days")
  const { data: q } = await admin.from('notification_queue').select('title, body, url').eq('kind', 'offer').filter('payload->>player_id', 'eq', ava.id).maybeSingle()
  q?.url === `/offer/${id}` && /accept by/i.test(q?.body ?? '') ? ok(`the parent is told: "${q.title}" — "${q.body}"`) : bad(JSON.stringify(q))
}

head('2. The family sees it, nobody else does')
{
  const { data: mine } = await parent.rpc('my_offers')
  const o = (mine ?? []).find((x) => x.player_id === ava.id)
  o?.state === 'open' && o?.fee_cents === 42000 && o?.squad === `${TAG} U9` ? ok(`open, $420, ${o.squad}`) : bad(JSON.stringify(o))
  const { data: theirs } = await outsider.rpc('my_offers')
  const leaked = (theirs ?? []).some((x) => x.player_id === ava.id)
  leaked ? bad('an outsider sees the offer') : ok('an outsider sees nothing')
  const { error } = await outsider.rpc('accept_offer', { p_offer: o.id })
  error?.code === '42501' ? ok('and cannot accept it') : bad(error ? error.message : 'an outsider accepted it')
}

head('3. Accepting: approved, in the squad, fee to pay, once')
{
  const { data: mine } = await parent.rpc('my_offers')
  const o = (mine ?? []).find((x) => x.player_id === ava.id)
  const { data: r, error } = await parent.rpc('accept_offer', { p_offer: o.id })
  error ? bad(`accept: ${error.message}`) : ok('accepted')
  r?.payment_request_id === fee.id ? ok('and handed the squad fee to pay') : bad(`fee: ${JSON.stringify(r)}`)
  const { data: reg } = await admin.from('program_registrations').select('status, program_id').eq('id', r?.registration_id).maybeSingle()
  reg?.status === 'approved' && reg?.program_id === squad.id ? ok('the squad registration is already approved') : bad(JSON.stringify(reg))
  const { data: pl } = await admin.from('players').select('team_id').eq('id', ava.id).single()
  pl?.team_id === team.id ? ok('Ava is in the squad — chat and fixtures follow') : bad('not moved into the squad')
  const { error: again } = await parent.rpc('accept_offer', { p_offer: o.id })
  again ? ok(`accepting twice: "${again.message.slice(0, 40)}"`) : bad('accepted twice')
  const { data: after } = await parent.rpc('my_offers')
  const shown = (after ?? []).find((x) => x.id === o.id)?.state
  shown === 'accepted' ? ok('shown as accepted') : bad(`shown as ${shown}`)
}

head('4. A lapsed offer cannot be accepted; a declined one is declined')
{
  const { data: benOffer } = await owner.rpc('make_offer', { p_registration: regOf(ben), p_squad_program: squad.id, p_days: 3 })
  await admin.from('offers').update({ expires_at: new Date(Date.now() - 3600_000).toISOString() }).eq('id', benOffer)
  const { data: mine } = await parent.rpc('my_offers')
  const benState = (mine ?? []).find((x) => x.id === benOffer)?.state
  benState === 'lapsed' ? ok("Ben's shows as lapsed") : bad(`Ben's is ${benState}`)
  const { error } = await parent.rpc('accept_offer', { p_offer: benOffer })
  error && /lapsed/i.test(error.message) ? ok(`and cannot be accepted: "${error.message.slice(0, 48)}"`) : bad(error ? error.message : 'a lapsed offer was accepted')
  const { data: revived } = await owner.rpc('make_offer', { p_registration: regOf(ben), p_squad_program: squad.id, p_days: 5 })
  const { data: m2 } = await parent.rpc('my_offers')
  revived === benOffer && (m2 ?? []).find((x) => x.id === benOffer)?.state === 'open' ? ok('offering again revives the same offer, open') : bad('revive failed')

  const { data: calOffer } = await owner.rpc('make_offer', { p_registration: regOf(cal), p_squad_program: squad.id, p_days: 7 })
  const { error: dec } = await parent.rpc('decline_offer', { p_offer: calOffer })
  dec ? bad(`decline: ${dec.message}`) : ok('Cal declines')
  const { error: dec2 } = await parent.rpc('decline_offer', { p_offer: calOffer })
  dec2 ? ok('declining twice is refused') : bad('declined twice')
}

head('5. A full squad is the club\'s mistake, not the family\'s')
{
  // Capacity 2: Ava is in; fill the other place; then Ben's revived offer
  // must fail loudly rather than quietly waitlist a child who was told "in".
  const { data: filler } = await admin.from('players').insert({ academy_id: NRIFA, full_name: `Dee ${TAG}`, dob: '2018-05-05' }).select('id').single()
  await admin.from('program_registrations').insert({ academy_id: NRIFA, program_id: squad.id, player_id: filler.id, submitted_by: OWNER, status: 'approved' })
  const { data: mine } = await parent.rpc('my_offers')
  const ben = (mine ?? []).find((x) => x.player_id === kids[1].id)
  const { error } = await parent.rpc('accept_offer', { p_offer: ben.id })
  error && /full/i.test(error.message) ? ok(`"${error.message}"`) : bad(error ? error.message : 'accepted into a full squad')
  const { count } = await admin.from('program_registrations').select('*', { count: 'exact', head: true }).eq('program_id', squad.id).eq('player_id', kids[1].id)
  count === 0 ? ok('and nothing was written') : bad(`${count} registrations left behind`)
}

head('6. The coach sees every offer from the trial')
{
  const { data: list, error } = await owner.rpc('trial_offers', { p_program: trial.id })
  error ? bad(error.message) : ok(`${list.length} offers listed`)
  const states = Object.fromEntries((list ?? []).map((o) => [o.player_id, o.state]))
  states[ava.id] === 'accepted' && states[ben.id] === 'open' && states[cal.id] === 'declined' ? ok('accepted, open, declined') : bad(JSON.stringify(states))
  const { error: peek } = await parent.rpc('trial_offers', { p_program: trial.id })
  peek?.code === '42501' ? ok('a parent cannot') : bad('a parent read the trial list')
}

await cleanup()
console.log(process.exitCode ? '\n\x1b[31mOFFERS ARE WRONG\x1b[0m\n' : '\n\x1b[32mall good\x1b[0m\n')
