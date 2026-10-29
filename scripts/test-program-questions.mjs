// Run: node --env-file=.env.local scripts/test-program-questions.mjs
//   (the HTTP checks need the app running — npm run dev, or serve:test)
//
// R-11: the questions a program asks have a shape, the club can write them,
// and an answer is checked against the question it answers.
import { createClient } from '@supabase/supabase-js'
import { resolveBaseUrl } from './_base-url.mjs'

const BASE = await resolveBaseUrl()
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

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

// A program of our own, so nothing here touches the seeded ones.
await admin.from('programs').delete().eq('academy_id', NRIFA).like('name', 'QTEST %')
const { data: program, error: mkErr } = await admin
  .from('programs')
  .insert({
    academy_id: NRIFA,
    name: 'QTEST Winter Tour',
    kind: 'tour',
    status: 'open',
    created_by: OWNER,
  })
  .select('id')
  .single()
if (mkErr) {
  bad(`could not make a program: ${mkErr.message}`)
  process.exit(1)
}
const PID = program.id

const setQ = async (client, questions) =>
  client.from('programs').update({ questions }).eq('id', PID).select('questions').maybeSingle()

head('1. The club writes the questions, and the database tidies them')
{
  const { data, error } = await setQ(owner, [
    { id: 'school', label: '  Which school?  ' },
    { id: 'swim', label: 'Can they swim?', type: 'yesno', required: true },
    { id: 'size', label: 'Jacket size', type: 'choice', options: ['S', ' M ', 'L', 'M', '', 'L'] },
    { id: 'passport', label: 'Passport expiry', type: 'date', options: ['junk'] },
  ])
  error ? bad(`refused a valid set: ${error.message}`) : ok('saved')
  const q = data?.questions ?? []
  q[0]?.type === 'text' && q[0]?.required === false
    ? ok('a question with no type is a text question, written back as one')
    : bad(`first question came back as ${JSON.stringify(q[0])}`)
  q[0]?.label === 'Which school?' ? ok('labels are trimmed') : bad(`label "${q[0]?.label}"`)
  JSON.stringify(q[2]?.options) === JSON.stringify(['S', 'M', 'L'])
    ? ok('options are trimmed, blanks and duplicates dropped, order kept')
    : bad(`options came back as ${JSON.stringify(q[2]?.options)}`)
  q[3] && !('options' in q[3])
    ? ok('options on a date question are dropped, not refused')
    : bad('a date question kept its options')
}

head('2. What cannot be made right is refused, in words')
for (const [name, questions, expect] of [
  ['two questions with one id', [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }], /share the id/],
  ['a choice with one option', [{ id: 'c', label: 'C', type: 'choice', options: ['only'] }], /two different options/],
  ['a type this form cannot ask', [{ id: 'f', label: 'F', type: 'file' }], /cannot ask/],
  ['a question with no label', [{ id: 'x', label: '   ' }], /no label/],
  ['an id with a space in it', [{ id: 'has space', label: 'X' }], /letters, digits/],
  ['twenty-one questions', Array.from({ length: 21 }, (_, i) => ({ id: `q${i}`, label: `Q${i}` })), /twenty/],
]) {
  const { error } = await setQ(owner, questions)
  error && expect.test(error.message)
    ? ok(`${name}: "${error.message.slice(0, 60)}"`)
    : bad(`${name}: ${error ? error.message : 'was accepted'}`)
}

head('3. A parent cannot write the questions')
{
  const before = (await admin.from('programs').select('questions').eq('id', PID).single()).data.questions
  const { data } = await setQ(parent, [{ id: 'evil', label: 'Bank details?' }])
  const after = (await admin.from('programs').select('questions').eq('id', PID).single()).data.questions
  !data && JSON.stringify(before) === JSON.stringify(after)
    ? ok('the update matched nothing and changed nothing')
    : bad('a parent rewrote the questions')
}

head('4. The public form is told the type and the options')
{
  const anon = createClient(URL_, PUB, { auth: { persistSession: false } })
  const { data } = await anon.rpc('public_programs', { p_slug: 'nrifa' })
  const p = data?.programs?.find((x) => x.id === PID)
  const swim = p?.questions?.find((q) => q.id === 'swim')
  const size = p?.questions?.find((q) => q.id === 'size')
  swim?.type === 'yesno' && swim?.required === true
    ? ok('a yes/no question arrives as one, and required')
    : bad(`swim arrived as ${JSON.stringify(swim)}`)
  JSON.stringify(size?.options) === JSON.stringify(['S', 'M', 'L'])
    ? ok('a choice arrives with its options')
    : bad(`size arrived as ${JSON.stringify(size)}`)
}

head('5. An answer is checked against the question it answers')
// The club's required agreements, accepted — this suite is about answers,
// and the route checks the agreements first.
const { data: pub } = await createClient(URL_, PUB, { auth: { persistSession: false } }).rpc(
  'public_programs',
  { p_slug: 'nrifa' }
)
const consents = (pub?.consents ?? []).filter((c) => c.required).map((c) => ({ id: c.id, version: c.version }))
const submit = (answers) =>
  fetch(`${BASE}/api/register/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slug: 'nrifa',
      programId: PID,
      guardianName: 'Q Test Parent',
      guardianPhone: '0400 777 888',
      childName: 'Q Test Child',
      childDob: '2016-04-04',
      answers,
      consents,
    }),
  })
try {
  let res = await submit({ school: 'Hunters Hill' })
  let body = await res.json()
  res.status === 400 && /swim/i.test(body.error)
    ? ok(`a missing required answer is refused and named: "${body.error}"`)
    : bad(`missing required → ${res.status} ${JSON.stringify(body)}`)

  res = await submit({ swim: 'maybe' })
  body = await res.json()
  res.status === 400 && /yes or no/i.test(body.error)
    ? ok('"maybe" to a yes/no question is refused')
    : bad(`maybe → ${res.status} ${JSON.stringify(body)}`)

  res = await submit({ swim: 'yes', size: 'XL' })
  body = await res.json()
  res.status === 400 && /options/i.test(body.error)
    ? ok('an option the question does not offer is refused')
    : bad(`XL → ${res.status} ${JSON.stringify(body)}`)

  res = await submit({ swim: 'yes', passport: '2026-02-31' })
  body = await res.json()
  res.status === 400 && /date/i.test(body.error)
    ? ok('the 31st of February is not a date')
    : bad(`bad date → ${res.status} ${JSON.stringify(body)}`)

  res = await submit({ swim: 'no', size: 'M', school: ' Hunters Hill ', bogus: 'dropped', passport: '' })
  body = await res.json()
  if (res.status !== 200) bad(`a good registration → ${res.status} ${JSON.stringify(body)}`)
  else {
    ok('a good registration is accepted')
    const { data: stored } = await admin
      .from('registration_requests')
      .select('answers')
      .eq('id', body.requestId)
      .single()
    // Key by key: jsonb stores keys in its own order, not the order sent.
    const want = { swim: 'no', size: 'M', school: 'Hunters Hill' }
    const got = stored?.answers ?? {}
    Object.keys(got).length === 3 && Object.entries(want).every(([k, v]) => got[k] === v)
      ? ok('stored trimmed, without the answer to a question nobody asked')
      : bad(`stored ${JSON.stringify(stored?.answers)}`)
  }
} catch (e) {
  bad(`no app at ${BASE}: ${e.message.slice(0, 60)}`)
}

await admin.from('registration_requests').delete().eq('program_id', PID)
await admin.from('programs').delete().eq('id', PID)
console.log(process.exitCode ? '\n\x1b[31mQUESTIONS ARE WRONG\x1b[0m\n' : '\n\x1b[32mall good\x1b[0m\n')
