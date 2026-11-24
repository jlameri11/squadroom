/**
 * test-organisations.mjs — 0080: one person, several organisations.
 *
 * The point of the switcher is that the CHOICE is a preference and the
 * ACCESS is not. The browser remembers which organisation it is showing and
 * passes the id to every screen; the database decides whether that person may
 * see it. So the assertion that matters most here is step 4: asking for an
 * organisation you do not belong to returns your own, and never that
 * organisation's name, colour or anything else.
 *
 * Needs 0080 applied. Until then the screen functions take no p_academy and
 * PostgREST answers PGRST202, which this reports as such.
 */
import { createClient } from '@supabase/supabase-js'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})
const anon = createClient(URL_, PUB, { auth: { persistSession: false } })

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`)
  process.exitCode = 1
}
const head = (m) => console.log(`\n${m}`)

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const RAVENS = '00000000-0000-0000-0000-0000000a0002'
const SPL = '00000000-0000-0000-0000-0000000a0003'

async function sess(email) {
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  // generateLink is rate limited per project as well as verifyOtp, and
  // returns null when it trips — so the property read below throws
  // before any session check runs, and the runner reports a crash
  // that is really the auth budget.
  if (!link?.properties?.hashed_token) {
    console.log(`  could not issue a link for ${email} — the project's auth rate limit, not a failure`)
    process.exit(2)
  }
  const { data: s } = await anon.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: 'email',
  })
  if (!s?.session) {
    console.log(`  could not sign in ${email} — the project's auth rate limit, not a failure`)
    process.exit(1)
  }
  return {
    client: createClient(URL_, PUB, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${s.session.access_token}` } },
    }),
    id: s.user.id,
  }
}

// Since 16 Nov 2026 nobody in the demo owns two organisations (Joey owns
// NRIFA only; the League organiser owns the SPL), so the state this suite is
// about — one person, several organisations — is made here and removed at
// the end: the organiser founds a throwaway academy and so sits in both the
// league and an academy. Sam is a parent at NRIFA only.
const org = await sess('organiser@squadroom-demo.test')
const sam = await sess('p61400000011@squadroom.invalid')

const TAG = 'ORGTEST'
async function cleanup() {
  const { data: olds } = await admin.from('academies').select('id').like('name', `${TAG}%`)
  for (const a of olds ?? []) {
    await admin.from('academy_members').delete().eq('academy_id', a.id)
    const { error } = await admin.from('academies').delete().eq('id', a.id)
    if (error) console.log(`  could not remove ${TAG} academy ${a.id}: ${error.message}`)
  }
  const { data: left } = await admin.from('academies').select('id').like('name', `${TAG}%`)
  if ((left ?? []).length) { bad(`${(left ?? []).length} ${TAG} academies left behind`) }
}
await cleanup()
process.on('uncaughtException', async (e) => { console.log(`  crashed: ${e.message}`); await cleanup(); process.exit(1) })
process.on('unhandledRejection', async (e) => { console.log(`  crashed: ${e?.message ?? e}`); await cleanup(); process.exit(1) })

// Guard, so a failure below is about 0080 and not about the fixture.
const { data: mine } = await admin
  .from('academy_members')
  .select('academy_id, role')
  .eq('profile_id', org.id)
  .eq('status', 'active')
if (!(mine ?? []).some((m) => m.academy_id === SPL && m.role === 'owner')) {
  bad('the organiser does not own the league — run scripts/demo-spl-ownership.mjs first')
  process.exit(1)
}
const { data: ACAD, error: foundErr } = await org.client.rpc('create_academy', { p_name: `${TAG} Academy`, p_type: 'academy' })
if (foundErr || !ACAD) {
  bad(`could not found the throwaway academy: ${foundErr?.message}`)
  process.exit(1)
}
// A new organisation asks its staff for two-step sign-in (0231); the demo's do not, and a
// throwaway must not put a wall in front of the organiser's other sessions while it exists.
await admin.from('academies').update({ two_step_required: false }).eq('id', ACAD)


head('1. my_organisations lists every organisation, with what you are in it')
const { data: orgs, error: orgError } = await org.client.rpc('my_organisations')
if (orgError?.code === 'PGRST202') {
  bad('0080 is not applied — my_organisations does not exist yet')
  process.exit(1)
}
if (orgError) {
  bad(orgError.message)
  process.exit(1)
}
orgs.length >= 2 ? ok(`${orgs.length} organisations`) : bad(`${orgs.length} organisation(s), expected 2+`)
const league = orgs.find((o) => o.id === SPL)
league?.type === 'league' && league?.role === 'owner'
  ? ok(`"${league.name}" — type ${league.type}, role ${league.role}`)
  : bad(`league row wrong: ${JSON.stringify(league)}`)
orgs.find((o) => o.id === ACAD)?.type === 'academy'
  ? ok('and the academy, typed as one')
  : bad('the academy is missing or mistyped')

head('2. A person in one organisation gets exactly one')
const { data: samOrgs } = await sam.client.rpc('my_organisations')
samOrgs?.length === 1 ? ok('one — so no switcher is offered') : bad(`${samOrgs?.length} for a single-club parent`)

head('3. Each screen follows the organisation it is asked for')
for (const [fn, args] of [
  ['home_screen', {}],
  ['chat_screen', {}],
  ['fixtures_screen', { p_days: 60 }],
  ['nav_badges', {}],
]) {
  const { data: asLeague, error } = await org.client.rpc(fn, { ...args, p_academy: SPL })
  if (error) {
    bad(`${fn}: ${error.message}`)
    continue
  }
  const served = asLeague?.academy?.id ?? asLeague?.academy_id
  served === SPL ? ok(`${fn} served the league`) : bad(`${fn} served ${served}, not the league`)
}

const { data: asAcademy } = await org.client.rpc('home_screen', { p_academy: ACAD })
asAcademy?.academy?.id === ACAD
  ? ok('and the academy when asked for the academy')
  : bad(`home_screen served ${asAcademy?.academy?.id} when asked for the academy`)

head('4. Asking for an organisation you are not in gives you your own')
// The security assertion. A passed id is a preference, never a grant — so a
// localStorage value edited in devtools, or left behind by an academy
// somebody has been removed from, must leak nothing at all.
const { data: ravens } = await admin.from('academies').select('name').eq('id', RAVENS).single()
const { data: stolen, error: stolenError } = await sam.client.rpc('home_screen', {
  p_academy: RAVENS,
})
if (stolenError) {
  bad(stolenError.message)
} else if (stolen?.academy?.id === RAVENS) {
  bad(`a parent read Ravens FC by asking for it — "${stolen.academy.name}" leaked`)
} else if (stolen?.academy?.id === NRIFA) {
  ok(`fell back to their own academy; "${ravens.name}" never appeared`)
} else {
  bad(`unexpected: ${JSON.stringify(stolen?.academy)}`)
}

// Nothing of that academy's, anywhere in the payload.
const body = JSON.stringify(stolen ?? {})
body.includes(RAVENS) || body.includes(ravens.name)
  ? bad('the other academy appears somewhere in the payload')
  : ok('and nothing of theirs is anywhere in the payload')

head('5. A made-up id is harmless')
const { data: nonsense, error: nonsenseError } = await org.client.rpc('home_screen', {
  p_academy: '00000000-0000-0000-0000-00000000dead',
})
nonsenseError
  ? bad(`errored instead of falling back: ${nonsenseError.message}`)
  : nonsense?.academy?.id
    ? ok(`fell back to ${nonsense.academy.name} rather than failing`)
    : bad('returned nothing at all')

head('6. nav_badges says how many organisations, so the switcher knows')
const { data: joeyBadges } = await org.client.rpc('nav_badges', { p_academy: SPL })
const { data: samBadges } = await sam.client.rpc('nav_badges', {})
joeyBadges?.org_count >= 2 ? ok(`org_count ${joeyBadges.org_count} — switcher shown`) : bad(`org_count ${joeyBadges?.org_count}`)
samBadges?.org_count === 1 ? ok('org_count 1 — switcher hidden') : bad(`org_count ${samBadges?.org_count} for a single-club parent`)
// The counts have to be FOR the organisation served, or the tab bar shows a
// league's unread count under an academy's name.
samBadges?.academy_id === NRIFA ? ok('and names the organisation the counts are for') : bad('no academy_id on the badges')

head('7. Being in a competition together is still not membership')
// The rule CLAUDE.md says must never be blurred. NRIFA and Ravens are both
// entered in SPL Season 3, and that must not make Sam a member of the league.
const samBody = JSON.stringify(samOrgs ?? [])
samBody.includes(SPL)
  ? bad('an entered club became a member of the league that runs the competition')
  : ok('entering a competition did not make a parent a member of the league')

console.log(
  process.exitCode
    ? '\n\x1b[31mORGANISATION RULES BROKEN\x1b[0m\n'
    : '\n\x1b[32mORGANISATION RULES HOLD\x1b[0m\n'
)
// The throwaway goes before the process does.
await cleanup()
process.exit(process.exitCode ?? 0)
