// Run: node --env-file=.env.local scripts/test-club-results.mjs
//
// X-07, X-11 and the last of X-04 (0204): every squad's season on one
// screen; how was today, one tap per family, seen by the coaches only; the
// Player of the Match as a card the club can post.
import { createClient } from '@supabase/supabase-js'
import { signInBoth } from './_auth.mjs'
import { resolveBaseUrl } from './_base-url.mjs'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const ref = URL_.split('//')[1].split('.')[0]
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const head = (m) => console.log(`\n${m}`)

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const OWNER = '00000000-0000-0000-0000-0000000000a1'
const MARCUS = '00000000-0000-0000-0000-0000000000a2'
const U8 = '00000000-0000-0000-0000-0000000d0008'
const LEO = '00000000-0000-0000-0000-0000000e0001'

const coachS = await signInBoth(admin, 'p61400000002@squadroom.invalid')
const parentS = await signInBoth(admin, 'p61400000011@squadroom.invalid')
const ravensS = await signInBoth(admin, 'p61400000091@squadroom.invalid')
if (!coachS || !parentS || !ravensS) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}
const coach = coachS.client, parent = parentS.client, ravens = ravensS.client
const { data: cl } = await admin.from('staff_clearances').select('id').eq('academy_id', NRIFA).eq('profile_id', MARCUS).maybeSingle()
const addedClearance = !cl
if (addedClearance) await admin.from('staff_clearances').insert({ academy_id: NRIFA, profile_id: MARCUS, kind: 'wwcc', number: 'WWC0000001E', outcome: 'cleared', expires_on: new Date(Date.now() + 400 * 864e5).toISOString().slice(0, 10), verified_by: OWNER })
const { data: mc } = await admin.from('team_members').select('role').eq('team_id', U8).eq('profile_id', MARCUS).maybeSingle()
if (!mc) await admin.from('team_members').insert({ academy_id: NRIFA, team_id: U8, profile_id: MARCUS, role: 'coach' })

const tidy = async () => {
  const { data: evs } = await admin.from('events').select('id').like('title', 'TEST:: club%')
  for (const e of evs ?? []) await admin.from('messages').delete().eq('event_id', e.id)
  await admin.from('events').delete().like('title', 'TEST:: club%')
  if (addedClearance) await admin.from('staff_clearances').delete().eq('academy_id', NRIFA).eq('profile_id', MARCUS).eq('number', 'WWC0000001E')
}
await tidy()
const ago = (d) => new Date(Date.now() - d * 864e5).toISOString()
const { data: g1 } = await admin.from('events').insert({ academy_id: NRIFA, team_id: U8, type: 'match', title: 'TEST:: club win', opponent: 'Hornsby Heat', starts_at: ago(8), our_score: 3, their_score: 1, created_by: OWNER }).select('id').single()
const { data: g2 } = await admin.from('events').insert({ academy_id: NRIFA, team_id: U8, type: 'match', title: 'TEST:: club loss', opponent: 'Ravens', starts_at: ago(1), our_score: 0, their_score: 2, created_by: OWNER }).select('id').single()

head('1. Results across the club')
const { data: table, error: te } = await parent.rpc('academy_results', { p_academy: NRIFA })
if (te) { bad(`academy_results: ${te.message}`); await tidy(); process.exit(1) }
const u8 = table.find((r) => r.team_id === U8)
u8 && u8.played >= 2 && u8.won >= 1 && u8.lost >= 1 ? ok(`a parent reads the club table: U8 P${u8.played} W${u8.won} D${u8.drawn} L${u8.lost} ${u8.gf}–${u8.ga}`) : bad(`U8 row: ${JSON.stringify(u8)}`)
u8 && u8.last[0] === 'L' && u8.latest?.opponent === 'Ravens' ? ok('newest first: the Ravens loss is the latest') : bad(`last: ${JSON.stringify(u8?.last)} latest: ${JSON.stringify(u8?.latest)}`)
table.every((r) => r.season) && table.length >= 2 ? ok(`${table.length} active squads listed, each with its season`) : bad(`table: ${table.length} rows`)
const { error: ve } = await ravens.rpc('academy_results', { p_academy: NRIFA })
ve?.code === '42501' ? ok("another club's owner cannot read it") : bad(`Ravens: ${ve?.code ?? 'allowed'}`)

head('2. How was today?')
const { error: early } = await parent.rpc('pulse_in', { p_event: g1.id, p_mood: 9 })
early ? ok('a pulse is 1, 2 or 3') : bad('a mood of 9 was accepted')
const { data: p1, error: pe } = await parent.rpc('pulse_in', { p_event: g2.id, p_mood: 1, p_note: 'Leo was upset about the sub' })
pe ? bad(`pulse: ${pe.message}`) : p1.mood === 1 ? ok('Leo’s parent: 🙁 with a word') : bad(`pulse: ${JSON.stringify(p1)}`)
const { data: p2 } = await parent.rpc('pulse_in', { p_event: g2.id, p_mood: 2 })
p2.mood === 2 ? ok('tapping again changes it, one per family') : bad('second pulse failed')
const { data: mine } = await parent.rpc('event_pulse_view', { p_event: g2.id })
mine.mine?.mood === 2 && mine.summary === null && !mine.is_coach ? ok('the family sees its own answer and nobody else’s') : bad(`parent view: ${JSON.stringify(mine)}`)
const { data: sum } = await coach.rpc('event_pulse_view', { p_event: g2.id })
sum.is_coach && sum.summary.so_so === 1 && sum.summary.answers[0]?.name === 'Sam Whitfield' ? ok(`the coach sees it with the name: ${sum.summary.answers[0].name} 😐`) : bad(`coach view: ${JSON.stringify(sum.summary)}`)
const { data: future } = await admin.from('events').insert({ academy_id: NRIFA, team_id: U8, type: 'match', title: 'TEST:: club next week', opponent: 'X', starts_at: new Date(Date.now() + 3 * 864e5).toISOString(), created_by: OWNER }).select('id').single()
const { error: notYet } = await parent.rpc('pulse_in', { p_event: future.id, p_mood: 3 })
notYet ? ok('not before the game') : bad('a pulse before the game was accepted')
const { error: re } = await ravens.rpc('pulse_in', { p_event: g2.id, p_mood: 3 })
re?.code === '42501' ? ok("another club's owner cannot answer") : bad(`Ravens pulse: ${re?.code ?? 'allowed'}`)
const { data: raw } = await parent.from('event_pulse').select('profile_id').eq('event_id', g2.id)
raw.length === 1 ? ok('through the table a parent sees only their own row') : bad(`parent rows: ${raw.length}`)

head('3. The Player of the Match as a card')
const BASE = await resolveBaseUrl()
const cookie = (s) => `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(s.session)).toString('base64')}`
const none = await fetch(`${BASE}/api/share/potm/${g1.id}`, { headers: { cookie: cookie(coachS) } })
none.status === 409 ? ok('no star yet: 409') : bad(`no star: ${none.status}`)
await coach.rpc('set_player_of_match', { p_event: g1.id, p_player: LEO, p_note: 'Never stopped running' })
const card = await fetch(`${BASE}/api/share/potm/${g1.id}`, { headers: { cookie: cookie(coachS) } })
card.status === 200 && (card.headers.get('content-type') ?? '').includes('image/png') ? ok('with a star: a PNG') : bad(`card: ${card.status} ${card.headers.get('content-type')}`)
const out = await fetch(`${BASE}/api/share/potm/${g1.id}`)
out.status === 401 ? ok('signed out: 401') : bad(`signed out: ${out.status}`)
const stranger = await fetch(`${BASE}/api/share/potm/${g1.id}`, { headers: { cookie: cookie(ravensS) } })
stranger.status === 404 || stranger.status === 401 || stranger.status === 403 || stranger.status === 500 ? ok(`another club gets nothing (${stranger.status})`) : bad(`stranger: ${stranger.status}`)

await tidy()
for (const c of [coach, parent, ravens]) c.realtime.disconnect()
process.exit(process.exitCode ?? 0)
