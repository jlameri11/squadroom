// Run: node --env-file=.env.local scripts/test-photo-consent.mjs
//
// Proves 0128 (S-04): before you post that photo.
//
// Photo consent has been recorded since R-06, refusals included, and nothing
// read it back — so a coach could photograph a training session and post it
// into a chat containing the family who said no.
//
// What this must get right is not the lookup. It is the three states, which
// are three different sentences to a coach:
//
//   REFUSED — a decision a family made. A hard no, and the only one that
//     should look alarming.
//   NOT ANSWERED — a question the club has not asked. Merging it with a
//     refusal makes the warning fire for every child at a club that has just
//     started, and a warning that always fires trains people past the real
//     one.
//   NO POLICY — a club that does not track this at all gets nothing, because
//     a prompt about a policy somebody has not adopted is noise.
import { createClient } from '@supabase/supabase-js'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})
const anon = createClient(URL_, PUB, { auth: { persistSession: false } })
// A client that has never signed in. `anon` is handed to verifyOtp below and
// stops being anonymous after that.
const stranger = createClient(URL_, PUB, { auth: { persistSession: false } })

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`)
  process.exitCode = 1
}
const head = (m) => console.log(`\n${m}`)

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const U8 = '00000000-0000-0000-0000-0000000d0008'
const LEO = '00000000-0000-0000-0000-0000000e0001'
const ZOE = '00000000-0000-0000-0000-0000000e0006'
const SAM = '00000000-0000-0000-0000-0000000000b1'

async function sess(email) {
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (!link?.properties?.hashed_token) {
    console.log("  could not issue a magic link — the project's auth rate limit, not a failure")
    process.exit(2)
  }
  const { data: s } = await anon.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: 'email',
  })
  if (!s?.session) {
    console.log("  could not sign in — the project's auth rate limit, not a failure")
    process.exit(2)
  }
  return {
    client: createClient(URL_, PUB, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${s.session.access_token}` } },
    }),
    id: s.user.id,
  }
}

const coach = await sess('joeylameri@outlook.com')
const parent = await sess('p61400000011@squadroom.invalid')

const { data: doc } = await admin
  .from('consent_documents')
  .select('id, version, title')
  .eq('academy_id', NRIFA)
  .eq('kind', 'photo_media')
  .is('retired_at', null)
  .not('published_at', 'is', null)
  .order('version', { ascending: false })
  .limit(1)
  .single()

const { data: teamChannel } = await admin
  .from('channels')
  .select('id')
  .eq('team_id', U8)
  .eq('type', 'team')
  .single()
const { data: wideChannel } = await admin
  .from('channels')
  .select('id')
  .eq('academy_id', NRIFA)
  .eq('type', 'academy_wide')
  .limit(1)
  .single()

async function clean() {
  await admin.from('consent_acceptances').delete().eq('document_id', doc.id)
}
await clean()

const check = async (who, channel) => {
  const { data, error } = await who.client.rpc('photo_consent_check', { p_channel: channel })
  if (error) throw new Error(error.message)
  return data
}

const answer = (player, accepted) =>
  admin.from('consent_acceptances').insert({
    academy_id: NRIFA,
    document_id: doc.id,
    profile_id: SAM,
    player_id: player,
    accepted,
    accepted_at: new Date().toISOString(),
  })

head('1. A club that has not started asking is told that, not given a wall')
{
  const d = await check(coach, teamChannel.id)
  d.applies === true ? ok('the check applies') : bad(`applies: ${JSON.stringify(d)}`)
  // Listing twenty-six names here is a wall a coach learns to dismiss. One
  // sentence they can act on is not.
  d.nobody_has_answered === true
    ? ok(`nobody in the squad has answered (${d.squad_size} children)`)
    : bad(`nobody_has_answered: ${d.nobody_has_answered}`)
  d.refused.length === 0
    ? ok('and nothing is reported as refused, because nothing was')
    : bad(`${d.refused.length} reported refused with no answers on file`)
}

head('2. A refusal is a decision, and is named')
{
  await answer(LEO, false)
  const d = await check(coach, teamChannel.id)
  d.refused.length === 1 && d.refused[0].player_id === LEO
    ? ok(`Leo is named as refused (${d.refused[0].name})`)
    : bad(`refused: ${JSON.stringify(d.refused)}`)
  // Never merged with the unanswered list. They are different sentences to
  // a coach.
  d.not_answered.some((c) => c.player_id === LEO)
    ? bad('a refusal also appears as unanswered')
    : ok('and is not also listed as unanswered')
  d.nobody_has_answered === false
    ? ok('and the club has now started asking')
    : bad('still reported as nobody having answered')
}

head('3. A yes disappears from both lists')
{
  await answer(ZOE, true)
  const d = await check(coach, teamChannel.id)
  d.refused.some((c) => c.player_id === ZOE) ? bad('a yes was reported as refused') : ok('Zoe is not refused')
  d.not_answered.some((c) => c.player_id === ZOE)
    ? bad('a yes was reported as unanswered')
    : ok('and not unanswered either — there is nothing to say about her')
  // The rest of the squad is still a question.
  d.not_answered.length > 0
    ? ok(`${d.not_answered.length} of the squad still have not answered`)
    : bad('the unanswered list emptied')
}

head('4. The version is named, because consent is to a VERSION')
{
  const d = await check(coach, teamChannel.id)
  d.version === doc.version && d.document === doc.title
    ? ok(`"${d.document}" v${d.version}`)
    : bad(`document: ${d.document} v${d.version}`)

  // An answer to an OLD version is not an answer to the current one. The
  // check reads the published version, so a club that reissues the form
  // starts asking again — which is the whole point of versioning.
  const { data: old } = await admin
    .from('consent_documents')
    .insert({
      academy_id: NRIFA,
      kind: 'photo_media',
      title: doc.title,
      version: doc.version + 1,
      body: 'A reissued photo policy.',
      required: false,
      published_at: new Date().toISOString(),
    })
    .select('id, version')
    .single()

  const after = await check(coach, teamChannel.id)
  after.version === old.version ? ok('a reissue becomes the version checked') : bad(`still v${after.version}`)
  after.refused.length === 0 && after.nobody_has_answered
    ? ok('and every earlier answer stops counting, which is what versioning is for')
    : bad(`after reissue: ${after.refused.length} refused, nobody=${after.nobody_has_answered}`)

  await admin.from('consent_documents').delete().eq('id', old.id)
}

head('5. An academy-wide channel has no squad to check')
{
  // Otherwise it would list every child in the club, which is a list nobody
  // can act on.
  const d = await check(coach, wideChannel.id)
  d.applies === false && d.reason === 'no_team'
    ? ok('nothing, and it says why')
    : bad(`returned ${JSON.stringify(d)}`)
}

head('6. A club with no photo policy gets no prompt about one')
{
  const { data: docs } = await admin
    .from('consent_documents')
    .select('id, published_at')
    .eq('academy_id', NRIFA)
    .eq('kind', 'photo_media')
    .is('retired_at', null)
  // Retire them all, check, put them back.
  const when = new Date().toISOString()
  for (const d of docs ?? []) await admin.from('consent_documents').update({ retired_at: when }).eq('id', d.id)

  const d = await check(coach, teamChannel.id)
  d.applies === false && d.reason === 'no_policy'
    ? ok('nothing, because a prompt about a policy nobody adopted is noise')
    : bad(`returned ${JSON.stringify(d)}`)

  for (const old of docs ?? []) await admin.from('consent_documents').update({ retired_at: null }).eq('id', old.id)
}

head('7. It names children, so it is for staff only')
{
  const asParent = await check(parent, teamChannel.id)
  asParent === null ? ok('a parent gets nothing') : bad(`a parent read ${JSON.stringify(asParent)}`)

  const { error } = await stranger.rpc('photo_consent_check', { p_channel: teamChannel.id })
  error ? ok(`and a stranger cannot call it (${error.code})`) : bad('anon called it')
}

await clean()
console.log(
  process.exitCode ? '\n\x1b[31msome of this is wrong\x1b[0m' : '\n\x1b[32mall good\x1b[0m'
)
