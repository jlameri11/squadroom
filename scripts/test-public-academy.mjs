// Run: node --env-file=.env.local scripts/test-public-academy.mjs
//   (the HTTP checks need the app running — npm run dev, or serve:test)
//
// G-02: a club's front door. The page is public, so the test is about what
// it does NOT say as much as what it does.
import { createClient } from '@supabase/supabase-js'
import { resolveBaseUrl } from './_base-url.mjs'

const BASE = await resolveBaseUrl()
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const anon = createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false },
})
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

head('1. A stranger can read the front door, and only what a front door says')
const { data: door, error } = await anon.rpc('public_academy', { p_slug: 'nrifa' })
if (error) bad(`public_academy refused anon: ${error.message} — did 0133 grant it?`)
door?.academy?.name ? ok(`the club: ${door.academy.name}`) : bad('no academy in the payload')
Array.isArray(door?.programs) ? ok(`${door.programs.length} open programs`) : bad('no programs array')
Array.isArray(door?.competitions)
  ? ok(`${door.competitions.length} public competitions`)
  : bad('no competitions array')
door && !('consents' in door)
  ? ok('consents are not carried — the landing page asks nobody to agree to anything')
  : bad('consents are in a payload cached for a hundred readers')

head('2. The programs are exactly the ones the register form shows')
const { data: form } = await anon.rpc('public_programs', { p_slug: 'nrifa' })
JSON.stringify(door?.programs) === JSON.stringify(form?.programs)
  ? ok('same programs, same order, same words — one function, not two')
  : bad('the front door and the form describe the programs differently')
const { count: open } = await admin
  .from('programs')
  .select('*', { count: 'exact', head: true })
  .eq('academy_id', NRIFA)
  .eq('status', 'open')
door?.programs.length === open
  ? ok(`and only OPEN programs: ${open}`)
  : bad(`${door?.programs.length} listed, ${open} open — a draft is showing`)

head('3. Nothing about a person')
const blob = JSON.stringify(door ?? {})
const phoneish = /\+?61\s?4\d{2}\s?\d{3}\s?\d{3}|\b04\d{2}\s?\d{3}\s?\d{3}\b/
!phoneish.test(blob) ? ok('no phone number anywhere in it') : bad('a phone number is in the payload')
const { data: kids } = await admin.from('players').select('full_name').eq('academy_id', NRIFA).limit(50)
const named = (kids ?? []).map((k) => k.full_name.split(' ')[0]).filter((n) => n.length > 3)
const leaked = named.filter((n) => new RegExp(`\\b${n}\\b`).test(blob))
leaked.length === 0
  ? ok(`no child's name (${named.length} checked)`)
  : bad(`a child's name is on the front door: ${leaked.join(', ')}`)
for (const key of ['players', 'members', 'guardians', 'profiles', 'email']) {
  blob.includes(`"${key}"`) ? bad(`a "${key}" key is in the payload`) : null
}
ok('no players, members, guardians or emails keyed in it')

head('4. Every competition listed has a page, by the same rule that makes it public')
for (const c of door?.competitions ?? []) {
  const { data: centre } = await anon.rpc('public_match_centre', { p_slug: c.slug })
  centre?.competition?.name
    ? ok(`${c.name} → /c/${c.slug} answers`)
    : bad(`${c.name} is listed but /c/${c.slug} shows nothing`)
}
const { count: unpublished } = await admin
  .from('competitions')
  .select('*', { count: 'exact', head: true })
  .eq('organiser_id', NRIFA)
  .is('published_at', null)
const listedSlugs = new Set((door?.competitions ?? []).map((c) => c.slug))
const { data: drafts } = await admin
  .from('competitions')
  .select('public_slug')
  .eq('organiser_id', NRIFA)
  .is('published_at', null)
const draftListed = (drafts ?? []).filter((d) => d.public_slug && listedSlugs.has(d.public_slug))
draftListed.length === 0
  ? ok(`no unpublished competition is listed (${unpublished ?? 0} exist)`)
  : bad('an unpublished competition is on the front door')

head('5. An unknown club is not a 404')
const { data: nobody } = await anon.rpc('public_academy', { p_slug: 'no-such-club-xyz' })
nobody === null ? ok('the function returns null') : bad('something came back for a club that is not there')

head('6. The page itself')
try {
  const res = await fetch(`${BASE}/nrifa`, { redirect: 'manual' })
  const html = await res.text()
  res.status === 200 ? ok('GET /nrifa → 200') : bad(`GET /nrifa → ${res.status}`)
  html.includes(door.academy.name) ? ok('the club is named') : bad('the club is not on its own page')
  html.includes(`/nrifa/register`) ? ok('it links to the register form') : bad('no Register link')
  html.includes('noindex')
    ? bad('the front door is noindex — the register page one step in is, this one should not be')
    : ok('indexable, as a front door should be')

  const miss = await fetch(`${BASE}/no-such-club-xyz`, { redirect: 'manual' })
  const missHtml = await miss.text()
  miss.status === 200 && /not found/i.test(missHtml)
    ? ok('an unknown slug renders "not found" with a 200 — no enumeration oracle')
    : bad(`unknown slug → ${miss.status}`)
} catch (e) {
  bad(`no app at ${BASE}: ${e.message.slice(0, 60)}`)
}

console.log(process.exitCode ? '\n\x1b[31mTHE FRONT DOOR IS WRONG\x1b[0m\n' : '\n\x1b[32mall good\x1b[0m\n')
