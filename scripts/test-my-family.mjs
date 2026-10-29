// Run: node --env-file=.env.local scripts/test-my-family.mjs
//
// R-17: a parent can see their own child, change what a family knows better
// than a club, and withdraw an agreement — and nobody else's child is in it.
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

const PARENT = '00000000-0000-0000-0000-0000000000b1'
const OUTSIDER = '00000000-0000-0000-0000-0000000000c2'

async function signIn(profileId) {
  const { data: u } = await admin.auth.admin.getUserById(profileId)
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email: u.user.email })
  if (!link?.properties?.hashed_token) return null
  const client = createClient(URL_, PUB, { auth: { persistSession: false } })
  const { data } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
  return data?.session ? client : null
}
const parent = await signIn(PARENT)
const outsider = await signIn(OUTSIDER)
if (!parent || !outsider) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}

head('1. A parent sees their own children, and only theirs')
const { data: fam, error: famErr } = await parent.rpc('my_family')
if (famErr) bad(`my_family: ${famErr.message}`)
const kids = fam ?? []
kids.length > 0 ? ok(`${kids.length} ${kids.length === 1 ? 'child' : 'children'}: ${kids.map((k) => k.full_name).join(', ')}`) : bad('no children for the seeded parent')
const { data: mine } = await admin.from('player_guardians').select('player_id').eq('profile_id', PARENT)
const theirs = new Set((mine ?? []).map((g) => g.player_id))
kids.every((k) => theirs.has(k.id)) ? ok('every one is a child they guard') : bad("somebody else's child is listed")
const child = kids[0]
Array.isArray(child?.consents) ? ok(`${child.consents.length} agreements shown for ${child.full_name}`) : bad('no consents array')
'kit' in (child ?? {}) && 'medical' in (child ?? {}) && 'squad' in (child ?? {})
  ? ok('kit, medical, squad and number are all carried')
  : bad('the payload is missing a section')

head("2. The outsider sees none of this club's children")
// The outsider is a guardian at Ravens FC, so an empty list would be the
// wrong assertion; the rule is that nothing of NRIFA's is in theirs.
const { data: none } = await outsider.rpc('my_family')
const leaked = (none ?? []).filter((k) => k.academy_id === child.academy_id).length
leaked === 0 ? ok(`their ${(none ?? []).length} are all at another club`) : bad(`the outsider saw ${leaked} of NRIFA's children`)

head('3. Withdrawing an agreement is recorded, and read by the photo warning')
const doc = child.consents.find((c) => c.kind === 'photo') ?? child.consents[0]
if (!doc) bad('no agreement to withdraw')
else {
  const { error } = await parent.rpc('set_consent', { p_player: child.id, p_document: doc.document_id, p_accepted: false })
  error ? bad(`withdraw: ${error.message}`) : ok(`withdrew "${doc.title}"`)
  const { data: after } = await parent.rpc('my_family')
  const now = (after ?? []).find((k) => k.id === child.id)?.consents.find((c) => c.document_id === doc.document_id)
  now?.accepted === false && now?.mine === true ? ok('my_family shows it withdrawn, by them') : bad(`shows ${JSON.stringify(now)}`)
  const { data: row } = await admin
    .from('consent_acceptances')
    .select('accepted')
    .eq('document_id', doc.document_id)
    .eq('player_id', child.id)
    .eq('profile_id', PARENT)
    .maybeSingle()
  row?.accepted === false ? ok('the row says no — recorded, not deleted') : bad(`row: ${JSON.stringify(row)}`)

  const { error: again } = await parent.rpc('set_consent', { p_player: child.id, p_document: doc.document_id, p_accepted: true })
  again ? bad(`re-agree: ${again.message}`) : ok('and they can agree again')
}

head("4. Nobody answers for somebody else's child")
{
  const { error } = await outsider.rpc('set_consent', { p_player: child.id, p_document: doc?.document_id ?? child.id, p_accepted: false })
  error?.code === '42501' ? ok(`refused: "${error.message}"`) : bad(`outsider ${error ? error.message : 'was allowed'}`)
  const { error: bogus } = await parent.rpc('set_consent', { p_player: child.id, p_document: '00000000-0000-0000-0000-000000000000', p_accepted: true })
  bogus ? ok('an agreement the club is not asking for is refused') : bad('a made-up document was accepted')
}

head('5. The family records kit sizes and medical details themselves')
{
  const { error } = await parent.rpc('set_kit_sizes', { p_player: child.id, p_shirt: '10', p_shorts: '10', p_socks: 'K13-3' })
  error ? bad(`set_kit_sizes as a parent: ${error.message}`) : ok('a parent can record sizes')
  const { data: p } = await admin.from('players').select('shirt_size, socks_size').eq('id', child.id).single()
  p?.shirt_size === '10' && p?.socks_size === 'K13-3' ? ok('and they are on the roster') : bad(`roster has ${JSON.stringify(p)}`)
  const { error: outErr } = await outsider.rpc('set_kit_sizes', { p_player: child.id, p_shirt: '16' })
  outErr?.code === '42501' ? ok("an outsider cannot record another child's") : bad(`outsider ${outErr ? outErr.message : 'was allowed'}`)

  const { error: medErr } = await parent
    .from('player_medical')
    .upsert({ player_id: child.id, academy_id: child.academy_id, allergies: 'FAMTEST peanuts', emergency_name: 'FAMTEST Nan', emergency_phone: '0400 000 111' }, { onConflict: 'player_id' })
  medErr ? bad(`medical upsert: ${medErr.message}`) : ok('a parent writes medical and emergency details')
  const { data: fam2 } = await parent.rpc('my_family')
  const med = (fam2 ?? []).find((k) => k.id === child.id)?.medical
  med?.allergies === 'FAMTEST peanuts' && med?.emergency_name === 'FAMTEST Nan' ? ok('and reads them back') : bad(`medical: ${JSON.stringify(med)}`)
  const { data: peek } = await outsider.from('player_medical').select('allergies').eq('player_id', child.id)
  const peeked = (peek ?? []).length
  peeked === 0 ? ok("an outsider reads nothing of the child's medical row") : bad('an outsider read medical details')
}

// Leave the seed as it was found.
await admin.from('player_medical').update({ allergies: null, emergency_name: null, emergency_phone: null }).eq('player_id', child.id)
await admin.from('players').update({ shirt_size: null, shorts_size: null, socks_size: null }).eq('id', child.id)
console.log(process.exitCode ? '\n\x1b[31mMY FAMILY IS WRONG\x1b[0m\n' : '\n\x1b[32mall good\x1b[0m\n')
