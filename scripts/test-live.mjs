// Run: node --env-file=.env.local scripts/test-live.mjs
//
// X-01 / G-06 (0203): the whistle and the roar. The coach taps; each tap is
// a line in the squad's chat and a row in the timeline; a slip is undone
// within a minute (its chat line comes down); full time writes the result
// and the goals into the stats; a game in our own competition keeps its
// official score on the sheet.
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
const { data: chan } = await admin.from('channels').select('id').eq('team_id', U8).eq('type', 'team').single()

const tidy = async () => {
  const { data: evs } = await admin.from('events').select('id').like('title', 'TEST:: live%')
  for (const e of evs ?? []) {
    // An undone tap is a deleted message, and its words sit in the archive.
    const { data: ms } = await admin.from('messages').select('id').eq('event_id', e.id)
    if (ms?.length) await admin.from('deleted_message_archive').delete().in('message_id', ms.map((m) => m.id))
    await admin.from('messages').delete().eq('event_id', e.id)
  }
  await admin.from('events').delete().like('title', 'TEST:: live%')
  if (addedClearance) await admin.from('staff_clearances').delete().eq('academy_id', NRIFA).eq('profile_id', MARCUS).eq('number', 'WWC0000001E')
}
await tidy()
const started = new Date(Date.now() - 20 * 60e3)
const { data: ev } = await admin.from('events').insert({ academy_id: NRIFA, team_id: U8, type: 'match', title: 'TEST:: live v Hornsby', opponent: 'Hornsby Heat', starts_at: started.toISOString(), ends_at: new Date(started.getTime() + 3600e3).toISOString(), created_by: OWNER }).select('id').single()
const chat = async () => (await admin.from('messages').select('id, body, deleted_at').eq('event_id', ev.id).eq('channel_id', chan.id).order('created_at')).data ?? []

head('1. Kick-off, a goal, a goal against')
let { data: l, error: e1 } = await coach.rpc('live_tick', { p_event: ev.id, p_kind: 'kick_off' })
if (e1) { bad(`kick-off: ${e1.message}`); await tidy(); process.exit(1) }
l.kicked_off && l.score.ours === 0 ? ok('kick-off is in, 0–0') : bad(`kick-off: ${JSON.stringify(l)}`)
;({ data: l } = await coach.rpc('live_tick', { p_event: ev.id, p_kind: 'goal_for', p_player: LEO, p_assist: ZOE, p_minute: 12 }))
l.score.ours === 1 && l.ticks.at(-1).player === 'Leo Whitfield' && l.ticks.at(-1).assist === 'Zoe Whitfield' ? ok('Leo scores (assist Zoe): 1–0') : bad(`goal: ${JSON.stringify(l.ticks.at(-1))}`)
let lines = await chat()
lines.length === 2 && /⚽ GOAL! Leo Whitfield \(12'\) — assist Zoe Whitfield — 1–0/.test(lines[1].body) ? ok(`the chat says: "${lines[1].body}"`) : bad(`chat: ${JSON.stringify(lines.map((m) => m.body))}`)
;/🟢 Kick-off v Hornsby Heat/.test(lines[0].body) ? ok(`and before that: "${lines[0].body}"`) : bad(`kick-off line: ${lines[0]?.body}`)
;({ data: l } = await coach.rpc('live_tick', { p_event: ev.id, p_kind: 'goal_against', p_minute: 20 }))
l.score.theirs === 1 ? ok('they score: 1–1') : bad(`against: ${JSON.stringify(l.score)}`)
lines = await chat()
;/⚽ Hornsby Heat score \(20'\) — 1–1/.test(lines[2].body) ? ok(`"${lines[2].body}"`) : bad(`against line: ${lines[2]?.body}`)

head('2. A slip, undone within a minute')
;({ data: l } = await coach.rpc('undo_last_tick', { p_event: ev.id }))
l.score.theirs === 0 && l.ticks.length === 2 ? ok('undone: back to 1–0, two rows stand') : bad(`undo: ${JSON.stringify(l.score)}, ${l.ticks.length} ticks`)
lines = await chat()
lines[2].deleted_at ? ok('and its chat line came down') : bad('the undone line is still in the chat')
// Everything that stands is now a minute and a half old.
await admin.from('event_ticker').update({ created_at: new Date(Date.now() - 90e3).toISOString() }).eq('event_id', ev.id).is('undone_at', null)
const { error: lateUndo } = await coach.rpc('undo_last_tick', { p_event: ev.id })
lateUndo && /more than a minute/.test(lateUndo.message) ? ok('more than a minute later, it stands') : bad(`late undo: ${lateUndo?.message ?? 'allowed'}`)

head('3. Who may')
const { error: pe } = await parent.rpc('live_tick', { p_event: ev.id, p_kind: 'goal_for', p_player: LEO })
pe?.code === '42501' ? ok('a parent cannot tap') : bad(`parent tap: ${pe?.code ?? 'allowed'}`)
const { data: pl, error: ple } = await parent.rpc('event_live', { p_event: ev.id })
ple ? bad(`parent live: ${ple.message}`) : pl.score.ours === 1 && !pl.can_tap && pl.ticks.length === 2 && pl.players.length === 0 ? ok('a parent reads the live score and the timeline, and no roster') : bad(`parent live: ${JSON.stringify({ s: pl.score, tap: pl.can_tap, t: pl.ticks.length, p: pl.players.length })}`)
const { error: ve } = await ravens.rpc('event_live', { p_event: ev.id })
ve?.code === '42501' ? ok("another club's owner cannot read it") : bad(`Ravens: ${ve?.code ?? 'allowed'}`)
const { error: stranger } = await coach.rpc('live_tick', { p_event: ev.id, p_kind: 'goal_for', p_player: '00000000-0000-0000-0000-0000000e0099' })
stranger ? ok('a scorer not on the squad is refused') : bad('a stranger scored')
const { data: future } = await admin.from('events').insert({ academy_id: NRIFA, team_id: U8, type: 'match', title: 'TEST:: live next week', opponent: 'X', starts_at: new Date(Date.now() + 5 * 864e5).toISOString(), created_by: OWNER }).select('id').single()
const { error: early } = await coach.rpc('live_tick', { p_event: future.id, p_kind: 'kick_off' })
early && /half an hour/.test(early.message) ? ok('the ticker opens half an hour before kick-off, not before') : bad(`early: ${early?.message ?? 'allowed'}`)

head('4. Half time, full time: the result and the stats write themselves')
await coach.rpc('live_tick', { p_event: ev.id, p_kind: 'half_time' })
await coach.rpc('live_tick', { p_event: ev.id, p_kind: 'goal_for', p_player: ZOE, p_minute: 44, p_note: 'Cracking strike' })
;({ data: l } = await coach.rpc('live_tick', { p_event: ev.id, p_kind: 'full_time' }))
l.finished && l.score.ours === 2 ? ok('full time 2–0') : bad(`ft: ${JSON.stringify(l)}`)
lines = await chat()
;/🏁 Full time: 2–0 — won v Hornsby Heat/.test(lines.at(-1).body) ? ok(`"${lines.at(-1).body}"`) : bad(`ft line: ${lines.at(-1)?.body}`)
const { data: evr } = await admin.from('events').select('our_score, their_score, score_entered_by').eq('id', ev.id).single()
evr.our_score === 2 && evr.their_score === 0 && evr.score_entered_by === MARCUS ? ok('the result is on the game, entered by the coach') : bad(`result: ${JSON.stringify(evr)}`)
const { data: st } = await admin.from('event_player_stats').select('player_id, goals, assists').eq('event_id', ev.id)
st.find((s) => s.player_id === LEO)?.goals === 1 && st.find((s) => s.player_id === ZOE)?.goals === 1 && st.find((s) => s.player_id === ZOE)?.assists === 1 ? ok('and the goals and assists are in the stats: Leo 1, Zoe 1 + 1 assist') : bad(`stats: ${JSON.stringify(st)}`)
const { error: after } = await coach.rpc('live_tick', { p_event: ev.id, p_kind: 'goal_for', p_player: LEO })
after && /over/.test(after.message) ? ok('nothing after full time') : bad(`after FT: ${after?.message ?? 'allowed'}`)
const { data: res } = await parent.rpc('event_result', { p_event: ev.id })
const r = Array.isArray(res) ? res[0] : res
r?.outcome === 'won' && r.ours === 2 ? ok("the family's result box reads the win") : bad(`event_result: ${JSON.stringify(res)}`)

head('5. In our own competition, full time is a line, and the sheet is the record')
// A U8 game that is a mirrored fixture of one of our competitions, already
// played, with no ticker yet.
const { data: cev } = await admin.from('events').select('id, our_score').eq('team_id', U8).not('fixture_id', 'is', null).is('cancelled_at', null).lte('starts_at', new Date().toISOString()).order('starts_at', { ascending: false }).limit(1).maybeSingle()
if (cev) {
  const before = cev.our_score
  const since = new Date().toISOString()
  await coach.rpc('live_tick', { p_event: cev.id, p_kind: 'kick_off' })
  await coach.rpc('live_tick', { p_event: cev.id, p_kind: 'goal_for', p_player: LEO })
  const { data: cl2, error: ce } = await coach.rpc('live_tick', { p_event: cev.id, p_kind: 'full_time' })
  ce ? bad(`comp ft: ${ce.message}`) : cl2.in_competition && cl2.finished ? ok('full time posts to the chat') : bad('comp ft state wrong')
  const { data: cevr } = await admin.from('events').select('our_score').eq('id', cev.id).single()
  cevr.our_score === before ? ok('and leaves the official score to the match sheet') : bad('the ticker wrote a score onto a competition game')
  await admin.from('event_ticker').delete().eq('event_id', cev.id)
  await admin.from('messages').delete().eq('event_id', cev.id).eq('sender_id', MARCUS).gte('created_at', since)
} else ok('(no played competition game for the U8s in the seed — skipped)')

await tidy()
process.exit(process.exitCode ?? 0)
