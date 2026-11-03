// Run: node --env-file=.env.local scripts/test-stats.mjs
//
// X-02 / X-03 (0202): who scored, who starred. The coach enters goals,
// assists and minutes; picks the Player of the Match, which posts once to
// the squad's chat; may open a family vote (one per adult, kick-off to a
// day after); the season adds up on the card and the squad's page.
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
const other = await signInClient(admin, 'p61400000012@squadroom.invalid')
const ravens = await signInClient(admin, 'p61400000091@squadroom.invalid')
if (!coach || !parent || !other || !ravens) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}
const { data: cl } = await admin.from('staff_clearances').select('id').eq('academy_id', NRIFA).eq('profile_id', MARCUS).maybeSingle()
const addedClearance = !cl
if (addedClearance) await admin.from('staff_clearances').insert({ academy_id: NRIFA, profile_id: MARCUS, kind: 'wwcc', number: 'WWC0000001E', outcome: 'cleared', expires_on: new Date(Date.now() + 400 * 864e5).toISOString().slice(0, 10), verified_by: OWNER })
const { data: mc } = await admin.from('team_members').select('role').eq('team_id', U8).eq('profile_id', MARCUS).maybeSingle()
if (!mc) await admin.from('team_members').insert({ academy_id: NRIFA, team_id: U8, profile_id: MARCUS, role: 'coach' })

const tidy = async () => {
  const { data: evs } = await admin.from('events').select('id').like('title', 'TEST:: stats%')
  for (const e of evs ?? []) await admin.from('messages').delete().eq('event_id', e.id)
  await admin.from('events').delete().like('title', 'TEST:: stats%')
  if (addedClearance) await admin.from('staff_clearances').delete().eq('academy_id', NRIFA).eq('profile_id', MARCUS).eq('number', 'WWC0000001E')
}
await tidy()

const yesterday = new Date(Date.now() - 20 * 3600e3)
const { data: ev } = await admin.from('events').insert({ academy_id: NRIFA, team_id: U8, type: 'match', title: 'TEST:: stats v Hornsby', opponent: 'Hornsby Heat', starts_at: yesterday.toISOString(), ends_at: new Date(yesterday.getTime() + 3600e3).toISOString(), our_score: 3, their_score: 1, created_by: OWNER }).select('id').single()

head('1. The coach enters the numbers')
const { data: s1, error: e1 } = await coach.rpc('set_player_stats', { p_event: ev.id, p_rows: [
  { player_id: LEO, goals: 2, assists: 1, minutes: 50 },
  { player_id: ZOE, goals: 1, assists: 0, minutes: 40 },
] })
if (e1) { bad(`set_player_stats: ${e1.message}`); await tidy(); process.exit(1) }
const leo = s1.players.find((p) => p.id === LEO), zoe = s1.players.find((p) => p.id === ZOE)
leo?.goals === 2 && leo.assists === 1 && leo.minutes === 50 && zoe?.goals === 1 ? ok('Leo 2 goals 1 assist 50 min; Zoe 1 goal') : bad(`stats: ${JSON.stringify([leo, zoe])}`)
s1.can_edit && s1.players.length >= 17 ? ok(`the whole squad is listed (${s1.players.length}), the coach may edit`) : bad('squad list or can_edit wrong')
const { data: ps } = await parent.rpc('event_stats', { p_event: ev.id })
ps && !ps.can_edit && ps.players.find((p) => p.id === LEO)?.goals === 2 ? ok("a parent reads the scorers, and cannot edit") : bad(`parent stats: ${JSON.stringify(ps?.can_edit)}`)
const { error: pe } = await parent.rpc('set_player_stats', { p_event: ev.id, p_rows: [{ player_id: LEO, goals: 9 }] })
pe?.code === '42501' ? ok('a parent cannot enter stats') : bad(`parent set: ${pe?.code ?? 'allowed'}`)
const { error: ve } = await ravens.rpc('event_stats', { p_event: ev.id })
ve?.code === '42501' ? ok("another club's owner cannot read them") : bad(`Ravens: ${ve?.code ?? 'allowed'}`)
const { error: oe } = await coach.rpc('set_player_stats', { p_event: ev.id, p_rows: [{ player_id: '00000000-0000-0000-0000-0000000e0099', goals: 1 }] })
oe ? ok("a player who is not the club's is refused") : bad('a foreign player got stats')

head('2. Player of the Match: picked once, posted once')
const { data: s2, error: e2 } = await coach.rpc('set_player_of_match', { p_event: ev.id, p_player: LEO, p_note: 'Never stopped running' })
e2 ? bad(`potm: ${e2.message}`) : s2.players.find((p) => p.potm)?.id === LEO ? ok('Leo is the Player of the Match') : bad('potm not set')
const { data: chan } = await admin.from('channels').select('id').eq('team_id', U8).eq('type', 'team').single()
const { data: posted } = await admin.from('messages').select('body, is_announcement, sender_id').eq('event_id', ev.id).eq('channel_id', chan.id)
posted?.length === 1 && /🏆 Player of the Match: Leo Whitfield/.test(posted[0].body) && /Never stopped running/.test(posted[0].body) && posted[0].is_announcement && posted[0].sender_id === MARCUS ? ok(`an announcement in the U8 chat from the coach: "${posted[0].body.split('\n')[0]}"`) : bad(`posted: ${JSON.stringify(posted)}`)
await coach.rpc('set_player_of_match', { p_event: ev.id, p_player: ZOE })
const { data: s3 } = await coach.rpc('event_stats', { p_event: ev.id })
s3.players.filter((p) => p.potm).length === 1 && s3.players.find((p) => p.potm).id === ZOE ? ok('changing it to Zoe leaves one star') : bad('two stars, or the wrong one')
const { data: posted2 } = await admin.from('messages').select('id').eq('event_id', ev.id).eq('channel_id', chan.id)
posted2.length === 1 ? ok('and the chat is not posted twice') : bad(`${posted2.length} posts`)
await coach.rpc('set_player_of_match', { p_event: ev.id, p_player: null })
const { data: s4 } = await coach.rpc('event_stats', { p_event: ev.id })
!s4.players.some((p) => p.potm) ? ok('clearing it leaves nobody') : bad('a star survived clearing')
const { error: ppe } = await parent.rpc('set_player_of_match', { p_event: ev.id, p_player: LEO })
ppe?.code === '42501' ? ok('a parent cannot pick the star') : bad(`parent potm: ${ppe?.code ?? 'allowed'}`)

head('3. The family vote')
const { error: closedVote } = await parent.rpc('vote_player_of_match', { p_event: ev.id, p_player: LEO })
closedVote ? ok('no vote until the coach opens one') : bad('a vote was cast with none open')
await coach.rpc('open_potm_vote', { p_event: ev.id, p_open: true })
const { data: v1, error: v1e } = await parent.rpc('vote_player_of_match', { p_event: ev.id, p_player: LEO })
v1e ? bad(`vote: ${v1e.message}`) : v1.my_vote === LEO && v1.players.find((p) => p.id === LEO).votes === null ? ok("Leo's parent votes Leo, and sees no tally while it is open") : bad(`vote: ${JSON.stringify({ mine: v1?.my_vote, votes: v1?.players.find((p) => p.id === LEO).votes })}`)
await other.rpc('vote_player_of_match', { p_event: ev.id, p_player: ZOE })
const { data: v2 } = await parent.rpc('vote_player_of_match', { p_event: ev.id, p_player: ZOE })
v2.my_vote === ZOE && v2.votes_cast === 2 ? ok('changing a vote keeps it one per adult (2 cast)') : bad(`votes: ${JSON.stringify({ mine: v2.my_vote, cast: v2.votes_cast })}`)
const { data: tally } = await coach.rpc('event_stats', { p_event: ev.id })
tally.players.find((p) => p.id === ZOE)?.votes === 2 && tally.players.find((p) => p.id === LEO)?.votes === 0 ? ok('the coach sees the tally: Zoe 2, Leo 0') : bad(`tally: ${JSON.stringify(tally.players.filter((p) => [LEO, ZOE].includes(p.id)).map((p) => [p.name, p.votes]))}`)
const { error: rv } = await ravens.rpc('vote_player_of_match', { p_event: ev.id, p_player: LEO })
rv?.code === '42501' ? ok("another club's owner cannot vote") : bad(`Ravens vote: ${rv?.code ?? 'allowed'}`)
const { error: nv } = await parent.rpc('vote_player_of_match', { p_event: ev.id, p_player: '00000000-0000-0000-0000-0000000e0099' })
nv ? ok('a vote for someone not on the squad is refused') : bad('a vote for a stranger was accepted')
const old = new Date(Date.now() - 3 * 864e5)
await admin.from('events').update({ starts_at: old.toISOString(), ends_at: new Date(old.getTime() + 3600e3).toISOString() }).eq('id', ev.id)
const { error: late } = await parent.rpc('vote_player_of_match', { p_event: ev.id, p_player: LEO })
late && /closed/.test(late.message) ? ok('a vote a day after the game is refused') : bad(`late vote: ${late?.message ?? 'accepted'}`)
const { data: closed } = await parent.rpc('event_stats', { p_event: ev.id })
closed.vote_closed && closed.players.find((p) => p.id === ZOE)?.votes === 2 ? ok('once closed, the family sees the tally') : bad(`closed: ${JSON.stringify({ c: closed.vote_closed, z: closed.players.find((p) => p.id === ZOE)?.votes })}`)
await coach.rpc('set_player_of_match', { p_event: ev.id, p_player: ZOE })

head('4. The season adds up')
const { data: season, error: se } = await parent.rpc('player_season_stats', { p_player: LEO })
se ? bad(`season: ${se.message}`) : season.goals >= 2 && season.assists >= 1 && season.appearances >= 1 ? ok(`Leo's season: ${season.appearances} games, ${season.goals} goals, ${season.assists} assists, ${season.potm} stars`) : bad(`season: ${JSON.stringify(season)}`)
season?.games?.some((g) => g.event_id === ev.id && g.goals === 2 && g.ours === 3) ? ok('the game is in it with the score') : bad('the game is missing from the season')
const { error: sv } = await ravens.rpc('player_season_stats', { p_player: LEO })
sv?.code === '42501' ? ok("another club's owner cannot read Leo's season") : bad(`Ravens season: ${sv?.code ?? 'allowed'}`)
const { data: team, error: te } = await parent.rpc('team_season_stats', { p_team: U8 })
te ? bad(`team stats: ${te.message}`) : team.find((r) => r.id === LEO)?.goals >= 2 && team.find((r) => r.id === ZOE)?.potm >= 1 ? ok('the squad table has Leo’s goals and Zoe’s star') : bad(`team: ${JSON.stringify(team.filter((r) => [LEO, ZOE].includes(r.id)))}`)
const { error: tv } = await ravens.rpc('team_season_stats', { p_team: U8 })
tv?.code === '42501' ? ok("and is the squad's own") : bad(`Ravens team: ${tv?.code ?? 'allowed'}`)

await tidy()
process.exit(process.exitCode ?? 0)
