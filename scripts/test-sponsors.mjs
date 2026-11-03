// Run: node --env-file=.env.local scripts/test-sponsors.mjs
//
// X-08 (0205): a club's sponsors — kept by its staff, shown as a strip on
// the public match centre (no account), a "with thanks to" line on the
// cards, and a view count per day; another club sees none; a parent reads
// but cannot write; Squadroom takes nothing.
import { createClient } from '@supabase/supabase-js'
import { signInClient, signInBoth } from './_auth.mjs'
import { resolveBaseUrl } from './_base-url.mjs'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const ref = URL_.split('//')[1].split('.')[0]
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const anon = createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } })
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const head = (m) => console.log(`\n${m}`)

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const SPL = '00000000-0000-0000-0000-0000000a0003'
const OWNER = '00000000-0000-0000-0000-0000000000a1'
const U8 = '00000000-0000-0000-0000-0000000d0008'

const ownerS = await signInBoth(admin, 'joeylameri@outlook.com')   // owns NRIFA and the SPL
const parent = await signInClient(admin, 'p61400000011@squadroom.invalid')
const ravens = await signInClient(admin, 'p61400000091@squadroom.invalid')
if (!ownerS || !parent || !ravens) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}
const owner = ownerS.client
await admin.from('academy_sponsors').delete().like('name', 'TEST::%')
await admin.from('events').delete().like('title', 'TEST:: sponsor%')

head('1. The club keeps its list')
const { data: s1, error: ie } = await owner.from('academy_sponsors').insert({ academy_id: SPL, name: 'TEST:: Ryde Physio', url: 'https://rydephysio.example', tagline: 'Keeping the SPL on its feet' }).select('id').single()
if (ie) { bad(`insert: ${ie.message}`); process.exit(1) }
ok('the league owner adds a sponsor')
const { data: s2 } = await owner.from('academy_sponsors').insert({ academy_id: NRIFA, name: 'TEST:: Café Nine', slots: ['cards'] }).select('id').single()
ok('and the club adds one for the cards only')
const { error: pe } = await parent.from('academy_sponsors').insert({ academy_id: NRIFA, name: 'TEST:: parent sponsor' })
pe ? ok('a parent cannot add one') : bad('a parent added a sponsor')
const { data: pr } = await parent.from('academy_sponsors').select('name').eq('academy_id', NRIFA).like('name', 'TEST::%')
pr?.length === 1 ? ok('a parent reads the club list') : bad(`parent read ${pr?.length}`)
const { data: rr } = await ravens.from('academy_sponsors').select('name').eq('academy_id', NRIFA)
;(rr ?? []).length === 0 ? ok("another club's owner sees none of it") : bad('Ravens read NRIFA sponsors')
const { error: ue } = await owner.from('academy_sponsors').insert({ academy_id: NRIFA, name: 'TEST:: bad link', url: 'javascript:alert(1)' })
ue ? ok('a sponsor link must be http(s)') : bad('a javascript: link was accepted')

head('2. The strip on the public match centre, with no account')
// A published league page of the SPL's own, so the strip has somewhere to be.
await admin.from('competitions').delete().like('name', 'TEST:: sponsors%')
const { data: comp, error: compErr } = await admin.from('competitions').insert({ organiser_id: SPL, name: 'TEST:: sponsors league', type: 'season', season: '2026', status: 'active', mode: 'managed', visibility: 'participants', public_slug: `test-sponsors-${Date.now().toString(36)}`, published_at: new Date().toISOString(), created_by: OWNER }).select('id, public_slug').single()
if (compErr) { bad(`could not publish a league page: ${compErr.message}`); process.exit(1) }
const { data: strip, error: se } = await anon.rpc('public_sponsors', { p_slug: comp.public_slug })
se ? bad(`public_sponsors: ${se.message}`) : strip.some((s) => s.name === 'TEST:: Ryde Physio' && s.tagline) ? ok(`anyone sees the SPL's sponsor on ${comp.public_slug}`) : bad(`strip: ${JSON.stringify(strip)}`)
!strip?.some((s) => s.name === 'TEST:: Café Nine') ? ok('a cards-only sponsor is not on the strip (and NRIFA is not the organiser anyway)') : bad('a cards-only sponsor leaked onto the strip')
const { data: none } = await anon.rpc('public_sponsors', { p_slug: 'no-such-competition' })
Array.isArray(none) && none.length === 0 ? ok('an unknown slug: an empty list, not an error') : bad(`unknown slug: ${JSON.stringify(none)}`)
await owner.from('academy_sponsors').update({ active: false }).eq('id', s1.id)
const { data: paused } = await anon.rpc('public_sponsors', { p_slug: comp.public_slug })
!paused.some((s) => s.id === s1.id) ? ok('a paused sponsor disappears from the strip') : bad('a paused sponsor is still shown')
await owner.from('academy_sponsors').update({ active: true }).eq('id', s1.id)

head('3. Views are counted by the server, not the browser')
const BASE = await resolveBaseUrl()
const seen = await fetch(`${BASE}/api/sponsor-seen`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: comp.public_slug }) })
const seenBody = seen.ok ? await seen.json() : null
seen.status === 200 && seenBody?.counted >= 1 ? ok(`the public page tells the server it showed the strip: ${seenBody.counted} sponsor(s) counted`) : bad(`seen: ${seen.status} ${JSON.stringify(seenBody)}`)
const { data: views } = await owner.from('sponsor_impressions').select('views').eq('sponsor_id', s1.id)
views?.[0]?.views >= 1 ? ok(`the league owner sees ${views[0].views} view(s) today`) : bad(`views: ${JSON.stringify(views)}`)
const { error: ce } = await anon.rpc('count_sponsor_views', { p_slug: comp.public_slug })
ce ? ok('a browser cannot call the counter itself') : bad('anon called count_sponsor_views')
const bogus = await fetch(`${BASE}/api/sponsor-seen`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: '../etc' }) })
bogus.status === 400 ? ok('a bad slug is refused') : bad(`bad slug: ${bogus.status}`)
const { data: pv } = await parent.from('sponsor_impressions').select('views').eq('sponsor_id', s1.id)
;(pv ?? []).length === 0 ? ok('a parent cannot read the counts') : bad('a parent read sponsor views')

head('4. The line on the cards')
const { data: cs } = await owner.rpc('card_sponsors', { p_academy: NRIFA })
cs.some((s) => s.name === 'TEST:: Café Nine') ? ok("NRIFA's cards carry Café Nine") : bad(`card_sponsors: ${JSON.stringify(cs)}`)
const { data: rcs } = await ravens.rpc('card_sponsors', { p_academy: NRIFA })
Array.isArray(rcs) && rcs.length === 0 ? ok("another club's owner gets none") : bad(`Ravens card_sponsors: ${JSON.stringify(rcs)}`)
const { data: ev } = await admin.from('events').insert({ academy_id: NRIFA, team_id: U8, type: 'match', title: 'TEST:: sponsor card', opponent: 'Hornsby Heat', starts_at: new Date(Date.now() - 864e5).toISOString(), our_score: 2, their_score: 0, created_by: OWNER }).select('id').single()
const cookie = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(ownerS.session)).toString('base64')}`
const card = await fetch(`${BASE}/api/share/result/${ev.id}`, { headers: { cookie } })
card.status === 200 ? ok('the result card still renders with a sponsor on the club') : bad(`result card: ${card.status}`)

await admin.from('events').delete().eq('id', ev.id)
await admin.from('academy_sponsors').delete().like('name', 'TEST::%')
await admin.from('competitions').delete().eq('id', comp.id)
process.exit(process.exitCode ?? 0)
