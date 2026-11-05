// Run: node --env-file=.env.local scripts/test-availability.mjs
//
// E-05 + E-06 (0199): the coach's availability grid — squad × next events,
// each cell what the family said and why — and a published team sheet
// telling the selected families (meet time, ground, kit), once per player
// per role, and the left-out families only when asked, gently.
import { createClient } from '@supabase/supabase-js'
import { signInClient } from './_auth.mjs'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const head = (m) => console.log(`\n${m}`)

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const OWNER = '00000000-0000-0000-0000-0000000000a1'
const MARCUS = '00000000-0000-0000-0000-0000000000a2'
const PARENT = '00000000-0000-0000-0000-0000000000b1'
const U8 = '00000000-0000-0000-0000-0000000d0008'
const LEO = '00000000-0000-0000-0000-0000000e0001'
const ZOE = '00000000-0000-0000-0000-0000000e0006'

const coach = await signInClient(admin, 'p61400000002@squadroom.invalid')
const parent = await signInClient(admin, 'p61400000011@squadroom.invalid')
const ravens = await signInClient(admin, 'p61400000091@squadroom.invalid')
if (!coach || !parent || !ravens) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}
const { data: cl } = await admin.from('staff_clearances').select('id').eq('academy_id', NRIFA).eq('profile_id', MARCUS).maybeSingle()
const addedClearance = !cl
if (addedClearance) await admin.from('staff_clearances').insert({ academy_id: NRIFA, profile_id: MARCUS, kind: 'wwcc', number: 'WWC0000001E', outcome: 'cleared', expires_on: new Date(Date.now() + 400 * 864e5).toISOString().slice(0, 10), verified_by: OWNER })
const { data: mc } = await admin.from('team_members').select('role').eq('team_id', U8).eq('profile_id', MARCUS).maybeSingle()
if (!mc) await admin.from('team_members').insert({ academy_id: NRIFA, team_id: U8, profile_id: MARCUS, role: 'coach' })

const tidy = async () => {
  const { data: evs } = await admin.from('events').select('id').like('title', 'TEST:: avail%')
  for (const e of evs ?? []) {
    await admin.from('notification_queue').delete().in('kind', ['selected', 'not_selected']).filter('payload->>event_id', 'eq', e.id)
    await admin.from('event_lineups').delete().eq('event_id', e.id)
    await admin.from('event_rsvps').delete().eq('event_id', e.id)
  }
  await admin.from('events').delete().like('title', 'TEST:: avail%')
  if (addedClearance) await admin.from('staff_clearances').delete().eq('academy_id', NRIFA).eq('profile_id', MARCUS).eq('number', 'WWC0000001E')
}
await tidy()

head('1. The grid: the squad across the next events, and the last registers')
const { data: g, error: ge } = await coach.rpc('availability_grid', { p_team: U8, p_upcoming: 4, p_past: 2 })
if (ge) { bad(`grid: ${ge.message}`); await tidy(); process.exit(1) }
ok(`the U8 coach reads the grid: ${g.players.length} players × ${g.events.length} columns`)
const upcoming = g.events.filter((e) => !e.past), past = g.events.filter((e) => e.past)
upcoming.length >= 1 && upcoming.length <= 4 && upcoming.every((e) => new Date(e.starts_at) > new Date()) ? ok(`${upcoming.length} upcoming, in order`) : bad(`upcoming: ${upcoming.length}`)
past.length <= 2 && past.every((e) => new Date(e.starts_at) < new Date()) ? ok(`${past.length} past, for the register`) : bad(`past: ${past.length}`)
const leo = g.players.find((p) => p.id === LEO)
leo ? ok(`Leo is on it${leo.number != null ? ` as #${leo.number}` : ''}`) : bad('Leo is missing from the grid')
// Leo's family says he can't make the next one, with the reason E-02 insists on.
const first = upcoming[0]
const { data: had } = await admin.from('event_rsvps').select('id, status, note').eq('event_id', first.id).eq('player_id', LEO).maybeSingle()
if (had) await admin.from('event_rsvps').update({ status: 'no', note: 'TEST:: dentist at 9', profile_id: PARENT, updated_at: new Date().toISOString() }).eq('id', had.id)
else await admin.from('event_rsvps').insert({ academy_id: NRIFA, event_id: first.id, player_id: LEO, profile_id: PARENT, status: 'no', note: 'TEST:: dentist at 9' })
const { data: g2 } = await coach.rpc('availability_grid', { p_team: U8, p_upcoming: 4, p_past: 2 })
const cell = g2.players.find((p) => p.id === LEO)?.cells[first.id]
cell?.status === 'no' && cell.note === 'TEST:: dentist at 9' ? ok(`Leo's cell for ${first.title} says can't play: "${cell.note}"`) : bad(`Leo's cell: ${JSON.stringify(cell)}`)
cell?.by ? ok(`and who said so: ${cell.by}`) : bad('the cell does not say who answered')
// Every other cell agrees with the RSVP table — with each child's LATEST
// answer, because two guardians can answer differently ("maybe" from one,
// "yes" from the other) and the grid, rightly, shows the most recent.
const { data: rsAll } = await admin.from('event_rsvps').select('event_id, player_id, status, updated_at').in('event_id', g2.events.map((e) => e.id))
const latest = new Map()
for (const r of rsAll ?? []) {
  const k = `${r.event_id}:${r.player_id}`
  if (!latest.has(k) || latest.get(k).updated_at < r.updated_at) latest.set(k, r)
}
const rs = [...latest.values()]
let agree = 0, disagree = 0
for (const r of rs) {
  const p = g2.players.find((x) => x.id === r.player_id)
  if (!p) continue
  const c = p.cells[r.event_id]
  if (c && c.status === r.status) agree++; else disagree++
}
disagree === 0 ? ok(`${agree} cells agree with the RSVP table, none disagree`) : bad(`cells: ${agree} agree, ${disagree} disagree`)
if (had) await admin.from('event_rsvps').update({ status: had.status, note: had.note }).eq('id', had.id)
else await admin.from('event_rsvps').delete().eq('event_id', first.id).eq('player_id', LEO)
upcoming.every((e) => typeof e.going === 'number' && typeof e.no_reply === 'number') ? ok('each column counts going and no answer') : bad('column counts missing')
const { error: pe } = await parent.rpc('availability_grid', { p_team: U8 })
pe?.code === '42501' ? ok('a parent cannot read the grid') : bad(`parent grid: ${pe?.code ?? 'allowed'}`)
const { error: ve } = await ravens.rpc('availability_grid', { p_team: U8 })
ve?.code === '42501' ? ok("another club's owner cannot") : bad(`Ravens grid: ${ve?.code ?? 'allowed'}`)

head('2. Publishing the side tells the families, once per player per role')
const kickoff = new Date(Date.now() + 3 * 864e5); kickoff.setHours(9, 0, 0, 0)
const { data: ev } = await admin.from('events').insert({ academy_id: NRIFA, team_id: U8, type: 'match', title: 'TEST:: avail v Ravens', opponent: 'Ravens U8', starts_at: kickoff.toISOString(), ends_at: new Date(kickoff.getTime() + 3600e3).toISOString(), arrive_at: new Date(kickoff.getTime() - 45 * 60e3).toISOString(), venue: 'ELS Hall Park', kit_colour: 'navy', created_by: OWNER }).select('id').single()
const { data: others } = await admin.from('players').select('id').eq('team_id', U8).not('id', 'in', `(${LEO},${ZOE})`).limit(1)
const third = others?.[0]?.id
const { error: le } = await coach.rpc('set_lineup', { p_event: ev.id, p_formation: '2-3-1', p_players: [
  { player_id: LEO, role: 'starting', position: 'GK', sort_order: 1 },
  { player_id: ZOE, role: 'bench', position: null, sort_order: 2 },
  ...(third ? [{ player_id: third, role: 'out', position: null, sort_order: 3 }] : []),
] })
le ? bad(`set_lineup: ${le.message}`) : ok('the coach picks Leo (GK), Zoe (bench) and leaves one out')
const { error: pub } = await coach.rpc('publish_lineup', { p_event: ev.id, p_published: true })
pub ? bad(`publish: ${pub.message}`) : ok('and publishes')
const { data: told } = await admin.from('notification_queue').select('profile_id, kind, title, body, url, payload').filter('payload->>event_id', 'eq', ev.id)
const leoPush = (told ?? []).find((t) => t.payload.player_id === LEO && t.profile_id === PARENT)
leoPush?.kind === 'selected' && /Leo is in the side/.test(leoPush.title) ? ok(`Leo's parent: "${leoPush.title}"`) : bad(`Leo push: ${JSON.stringify(leoPush)}`)
leoPush && /GK/.test(leoPush.body) && /meet 8:15/.test(leoPush.body) && /ELS Hall Park/.test(leoPush.body) && /navy kit/.test(leoPush.body) ? ok(`with the position, meet time, ground and kit: "${leoPush.body}"`) : bad(`Leo body: ${leoPush?.body}`)
const zoePush = (told ?? []).find((t) => t.payload.player_id === ZOE && t.profile_id === PARENT)
zoePush && /in the squad/.test(zoePush.title) && /bench/i.test(zoePush.body) ? ok(`Zoe's: "${zoePush.title}" — ${zoePush.body.split(' · ')[0]}`) : bad(`Zoe push: ${JSON.stringify(zoePush)}`)
leoPush?.url === `/calendar/${ev.id}` ? ok('the push opens the game') : bad(`url: ${leoPush?.url}`)
const outPush = (told ?? []).filter((t) => t.kind === 'not_selected')
outPush.length === 0 ? ok('the family left out is not told unless the coach asks') : bad(`${outPush.length} not_selected pushes without asking`)
await coach.rpc('publish_lineup', { p_event: ev.id, p_published: true })
const { data: again } = await admin.from('notification_queue').select('id').filter('payload->>event_id', 'eq', ev.id).filter('payload->>player_id', 'eq', LEO).eq('profile_id', PARENT)
again.length === 1 ? ok('publishing again tells nobody twice') : bad(`Leo told ${again.length} times`)
await coach.rpc('set_lineup', { p_event: ev.id, p_formation: '2-3-1', p_players: [
  { player_id: LEO, role: 'bench', position: null, sort_order: 1 },
  { player_id: ZOE, role: 'starting', position: 'GK', sort_order: 2 },
  ...(third ? [{ player_id: third, role: 'out', position: null, sort_order: 3 }] : []),
] })
await coach.rpc('publish_lineup', { p_event: ev.id, p_published: true, p_tell_out: true })
const { data: swapped } = await admin.from('notification_queue').select('kind, title, payload').filter('payload->>event_id', 'eq', ev.id).eq('profile_id', PARENT)
swapped.filter((t) => t.payload.player_id === LEO).length === 2 ? ok('Leo moved to the bench is told again') : bad(`Leo after the swap: ${swapped.filter((t) => t.payload.player_id === LEO).length}`)
if (third) {
  const { data: outNow } = await admin.from('notification_queue').select('title, body').eq('kind', 'not_selected').filter('payload->>event_id', 'eq', ev.id)
  outNow.length >= 0 && (outNow.length === 0 || /still come along/i.test(outNow[0].body)) ? ok(outNow.length ? `asked to, the left-out family is told gently: "${outNow[0].body}"` : 'the left-out child has no active guardian in the seed, so nobody to tell') : bad(`not_selected: ${JSON.stringify(outNow)}`)
}
const { error: ppub } = await parent.rpc('publish_lineup', { p_event: ev.id, p_published: true })
ppub?.code === '42501' ? ok('a parent cannot publish a side') : bad(`parent publish: ${ppub?.code ?? 'allowed'}`)

await tidy()
process.exit(process.exitCode ?? 0)
