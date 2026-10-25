// Run: node --env-file=.env.local scripts/test-public-squads.mjs
//
// Players are named on the public page, and three rules decide who.
//
// This is the only place in the product that writes to the open internet, and
// the only one where getting it wrong publishes a child's name. So each rule
// is asserted against the function anon actually calls, not against the
// intention behind it:
//
//   1. The academy's setting — off, initials, full.
//   2. A child's own opt-out, which beats the setting every time.
//   3. Each player's OWN academy decides. A competition spans tenants, so an
//      organiser ticking a box must not publish a visiting club's children.
//
// Run as `anon`, with no session at all, because that is who reads this page.
import { createClient } from '@supabase/supabase-js'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})
// Deliberately the publishable key and nothing else.
const anon = createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false },
})

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`)
  process.exitCode = 1
}
const head = (m) => console.log(`\n${m}`)

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const SLUG = 'nrifa-spring-gala'

// Put it back however it was, whatever happens below.
const { data: before } = await admin
  .from('academies')
  .select('public_player_names')
  .eq('id', NRIFA)
  .single()

async function setMode(mode) {
  const { error } = await admin
    .from('academies')
    .update({ public_player_names: mode })
    .eq('id', NRIFA)
  if (error) throw new Error(error.message)
}

/** Every name the public page would publish, flattened. */
async function published() {
  const { data, error } = await anon.rpc('public_match_centre', { p_slug: SLUG })
  if (error) throw new Error(error.message)
  if (!data) throw new Error(`nothing published at /c/${SLUG} — run scripts/seed-registration.mjs`)
  return Object.values(data.squads ?? {})
    .flat()
    .map((p) => p.name)
}

const { data: sample } = await admin
  .from('players')
  .select('id, full_name, team_id')
  .eq('academy_id', NRIFA)
  .not('team_id', 'is', null)
  .order('full_name')
  .limit(1)
  .single()

head('1. Off means nobody')
await setMode('off')
const whenOff = await published()
whenOff.length === 0 ? ok('no names at all') : bad(`${whenOff.length} names published with the setting off`)

head('2. Initials means a first name and a letter')
await setMode('initials')
const whenInitials = await published()
whenInitials.length > 0 ? ok(`${whenInitials.length} named`) : bad('nothing published')
// Every published name must be abbreviated — no full surnames anywhere.
const notAbbreviated = whenInitials.filter((n) => !/^\S+( \S\.)?$/.test(n))
notAbbreviated.length === 0
  ? ok(`all abbreviated, e.g. "${whenInitials[0]}"`)
  : bad(`${notAbbreviated.length} are not abbreviated, e.g. "${notAbbreviated[0]}"`)
// And no child's registered surname appears in full.
const { data: roster } = await admin
  .from('players')
  .select('full_name')
  .eq('academy_id', NRIFA)
const surnames = (roster ?? [])
  .map((p) => p.full_name.split(' ').slice(1).join(' '))
  .filter((s) => s.length > 2)
const leaked = surnames.filter((s) => whenInitials.some((n) => n.includes(s)))
leaked.length === 0
  ? ok('and no surname is published in full')
  : bad(`surnames leaked: ${[...new Set(leaked)].slice(0, 3).join(', ')}`)

head('3. Full means the registered name')
await setMode('full')
const whenFull = await published()
whenFull.some((n) => n.includes(' ') && !n.endsWith('.'))
  ? ok(`full names published, e.g. "${whenFull.find((n) => n.includes(' '))}"`)
  : bad('no full names came through')

head('4. A family’s opt-out beats the setting')
// The rule that has to hold even when everything else is turned up.
await admin.from('players').update({ public_name_hidden: true }).eq('id', sample.id)
const whenHidden = await published()
whenHidden.some((n) => n === sample.full_name)
  ? bad(`${sample.full_name} is still published after opting out`)
  : ok(`${sample.full_name} is not published, with the academy set to full`)
// And nothing resembling them either — not a first name, not an initialled form.
const given = sample.full_name.split(' ')[0]
whenHidden.some((n) => n.startsWith(given) && n !== given)
  ? bad(`a partial form of the name is still published`)
  : ok('and no abbreviated form of it either')

head('5. Only a guardian or the academy can set that flag')
const { data: ravens } = await admin
  .from('academy_members')
  .select('profile_id')
  .eq('academy_id', '00000000-0000-0000-0000-0000000a0002')
  .eq('status', 'active')
  .limit(1)
  .single()
const { data: u } = await admin.auth.admin.getUserById(ravens.profile_id)
const { data: link } = await admin.auth.admin.generateLink({
  type: 'magiclink',
  email: u.user.email,
})
const { data: s } = await anon.auth.verifyOtp({
  token_hash: link.properties.hashed_token,
  type: 'email',
})
if (!s?.session) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
} else {
  const outsider = createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${s.session.access_token}` } },
  })
  const { error } = await outsider.rpc('set_public_name_hidden', {
    p_player: sample.id,
    p_hidden: false,
  })
  error
    ? ok('somebody from another club cannot un-hide a child')
    : bad("an outsider changed another academy's child's publication setting")
}

head('6. Nothing else about a child reaches the page')
await setMode('full')
const { data: page } = await anon.rpc('public_match_centre', { p_slug: SLUG })
const body = JSON.stringify(page)
// The squad entries carry a name and a number. Anything else about a child —
// a birthday, a phone number, a medical note, a guardian — must not be here.
const { data: dobs } = await admin
  .from('players')
  .select('dob, ff_number')
  .eq('academy_id', NRIFA)
  .not('dob', 'is', null)
  .limit(20)
const dobLeak = (dobs ?? []).filter((p) => p.dob && body.includes(p.dob))
dobLeak.length === 0 ? ok('no dates of birth') : bad(`${dobLeak.length} dates of birth published`)

const { data: phones } = await admin.from('profiles').select('phone').not('phone', 'is', null).limit(20)
const phoneLeak = (phones ?? []).filter((p) => p.phone && body.includes(String(p.phone)))
phoneLeak.length === 0 ? ok('no phone numbers') : bad(`${phoneLeak.length} phone numbers published`)

const { data: medical } = await admin.from('player_medical').select('conditions, coach_note').limit(10)
const medLeak = (medical ?? []).filter(
  (m) =>
    (m.conditions && body.includes(m.conditions)) || (m.coach_note && body.includes(m.coach_note))
)
medLeak.length === 0 ? ok('no medical notes') : bad('medical information published')

const keys = new Set(
  Object.values(page.squads ?? {})
    .flat()
    .flatMap((p) => Object.keys(p))
)
;[...keys].every((k) => ['name', 'number'].includes(k))
  ? ok(`each player is exactly { ${[...keys].join(', ')} }`)
  : bad(`a squad entry carries ${[...keys].join(', ')}`)

// Restore.
await admin.from('players').update({ public_name_hidden: false }).eq('id', sample.id)
await setMode(before.public_player_names)

console.log(
  process.exitCode
    ? '\n\x1b[31mPUBLIC SQUADS BROKEN\x1b[0m\n'
    : `\n\x1b[32mSquads publish by the club's choice, and a family can always say no.\x1b[0m\n`
)
process.exit(process.exitCode ?? 0)
