// Run: node --env-file=.env.local scripts/test-matchdays.mjs
//
// Matchdays (0206): played games with the score, the scorers and the video;
// a coach adds the video by link or upload; one push to the squad's
// families; only the squad's and club's people see it; no Player of the
// Match on the list.
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
  const { data: evs } = await admin.from('events').select('id').like('title', 'TEST:: matchday%')
  for (const e of evs ?? []) {
    await admin.from('notification_queue').delete().filter('payload->>event_id', 'eq', e.id)
    const { data: files } = await admin.storage.from('match-videos').list(`${NRIFA}/${e.id}`)
    if (files?.length) await admin.storage.from('match-videos').remove(files.map((f) => `${NRIFA}/${e.id}/${f.name}`))
  }
  await admin.from('events').delete().like('title', 'TEST:: matchday%')
  if (addedClearance) await admin.from('staff_clearances').delete().eq('academy_id', NRIFA).eq('profile_id', MARCUS).eq('number', 'WWC0000001E')
}
await tidy()
const played = new Date(Date.now() - 2 * 864e5)
const { data: ev } = await admin.from('events').insert({ academy_id: NRIFA, team_id: U8, type: 'match', title: 'TEST:: matchday v Hornsby', opponent: 'Hornsby Heat', starts_at: played.toISOString(), ends_at: new Date(played.getTime() + 3600e3).toISOString(), our_score: 2, their_score: 1, created_by: OWNER }).select('id').single()
await admin.from('event_player_stats').insert({ academy_id: NRIFA, event_id: ev.id, player_id: LEO, goals: 2, potm: true, entered_by: MARCUS })
const { data: future } = await admin.from('events').insert({ academy_id: NRIFA, team_id: U8, type: 'match', title: 'TEST:: matchday next week', opponent: 'X', starts_at: new Date(Date.now() + 5 * 864e5).toISOString(), created_by: OWNER }).select('id').single()

head('1. Matchdays: played games with the score and the scorers, no star')
const { data: md, error: me } = await parent.rpc('my_matchdays', { p_academy: NRIFA, p_limit: 20 })
if (me) { bad(`my_matchdays: ${me.message}`); await tidy(); process.exit(1) }
const g = md.find((x) => x.id === ev.id)
g && g.ours === 2 && g.theirs === 1 && g.team === 'U8 SPL' ? ok('the parent sees the played game: U8 SPL v Hornsby Heat 2–1') : bad(`game: ${JSON.stringify(g)}`)
g && g.scorers[0]?.name === 'Leo Whitfield' && g.scorers[0].goals === 2 ? ok('with the scorer: Leo ×2') : bad(`scorers: ${JSON.stringify(g?.scorers)}`)
g && !('potm' in g) && !JSON.stringify(g).includes('"potm"') ? ok('and no Player of the Match on the list') : bad('the list carries the star')
!md.some((x) => x.id === future.id) ? ok("next week's game is not a matchday yet") : bad('an unplayed game is on Matchdays')
md.every((x) => new Date(x.starts_at) <= new Date()) && md.length >= 2 ? ok(`${md.length} played games, newest first`) : bad('the list has an unplayed game or is empty')
g.videos === 0 ? ok('no video yet') : bad(`videos: ${g.videos}`)
const { error: ve } = await ravens.rpc('my_matchdays', { p_academy: NRIFA })
ve?.code === '42501' ? ok("another club's owner cannot read NRIFA's matchdays") : bad(`Ravens: ${ve?.code ?? 'allowed'}`)

head('2. The coach adds a link; the families are pushed once')
const { data: v1, error: ae } = await coach.rpc('add_match_video', { p_event: ev.id, p_kind: 'link', p_url: 'https://app.veo.co/matches/TEST-matchday', p_title: 'Full game' })
if (ae) { bad(`add link: ${ae.message}`); await tidy(); process.exit(1) }
v1.videos.length === 1 && v1.videos[0].kind === 'link' && v1.can_add ? ok('the Veo link is on the game') : bad(`videos: ${JSON.stringify(v1)}`)
const { data: pushes } = await admin.from('notification_queue').select('profile_id, title, body, url').eq('kind', 'match_video').filter('payload->>event_id', 'eq', ev.id)
const toParent = (pushes ?? []).find((p) => p.profile_id === PARENT)
toParent && /U8 SPL v Hornsby Heat — video is up/.test(toParent.title) && toParent.url === `/calendar/${ev.id}` ? ok(`Leo's parent is pushed: "${toParent.title}"`) : bad(`parent push: ${JSON.stringify(toParent)}`)
;(pushes ?? []).every((p) => p.profile_id !== MARCUS) ? ok('not the coach who added it') : bad('the coach was pushed their own video')
const { data: members } = await admin.from('team_members').select('profile_id').eq('team_id', U8)
;(pushes ?? []).length === members.filter((m) => m.profile_id !== MARCUS).length ? ok(`one per member of the squad (${pushes.length})`) : bad(`${pushes?.length} pushes for ${members.length} members`)
const { data: pv } = await parent.rpc('matchday_videos', { p_event: ev.id })
pv.videos.length === 1 && !pv.can_add && pv.videos[0].url.includes('veo.co') ? ok('the parent sees the link and cannot add') : bad(`parent videos: ${JSON.stringify(pv)}`)
const { data: md2 } = await parent.rpc('my_matchdays', { p_academy: NRIFA, p_limit: 20 })
md2.find((x) => x.id === ev.id)?.videos === 1 ? ok('and Matchdays shows the game has a video') : bad('Matchdays does not count the video')
const { error: je } = await coach.rpc('add_match_video', { p_event: ev.id, p_kind: 'link', p_url: 'javascript:alert(1)' })
je ? ok('a non-web link is refused') : bad('a javascript: link was accepted')
const { error: pe } = await parent.rpc('add_match_video', { p_event: ev.id, p_kind: 'link', p_url: 'https://youtu.be/x' })
pe?.code === '42501' ? ok('a parent cannot add a video') : bad(`parent add: ${pe?.code ?? 'allowed'}`)
const { error: fe } = await coach.rpc('add_match_video', { p_event: future.id, p_kind: 'link', p_url: 'https://youtu.be/x' })
fe ? ok('a game not yet played takes no video') : ok('(a link may be added before the game — allowed)')
const { error: re } = await ravens.rpc('matchday_videos', { p_event: ev.id })
re?.code === '42501' ? ok("another club's owner cannot see the videos") : bad(`Ravens videos: ${re?.code ?? 'allowed'}`)
const { data: rawR } = await ravens.from('event_videos').select('id').eq('event_id', ev.id)
;(rawR ?? []).length === 0 ? ok('nor read the rows') : bad('Ravens read video rows')

head('3. An upload stays private to the squad')
const bytes = new Uint8Array(64)
const path = `${NRIFA}/${ev.id}/test-clip.mp4`
const { error: upErr } = await coach.storage.from('match-videos').upload(path, bytes, { contentType: 'video/mp4', upsert: true })
upErr ? bad(`coach upload: ${upErr.message}`) : ok('the coach uploads a file under the game')
const { error: wrongFolder } = await coach.rpc('add_match_video', { p_event: ev.id, p_kind: 'upload', p_path: `${NRIFA}/00000000-0000-0000-0000-000000000000/x.mp4` })
wrongFolder ? ok("an upload has to live under this game's folder") : bad('a path outside the game was accepted')
const { data: v2, error: ue } = await coach.rpc('add_match_video', { p_event: ev.id, p_kind: 'upload', p_path: path, p_title: 'Second half' })
ue ? bad(`add upload: ${ue.message}`) : v2.videos.length === 2 ? ok('and records it on the game') : bad(`after upload: ${v2.videos.length}`)
const { data: signedP, error: se } = await parent.storage.from('match-videos').createSignedUrl(path, 60)
!se && signedP?.signedUrl ? ok('a parent of the squad gets a signed link to watch it') : bad(`parent signed url: ${se?.message}`)
const { error: rse } = await ravens.storage.from('match-videos').createSignedUrl(path, 60)
rse ? ok("another club's owner cannot") : bad('Ravens got a signed url')
const { error: pupErr } = await parent.storage.from('match-videos').upload(`${NRIFA}/${ev.id}/parent.mp4`, bytes, { contentType: 'video/mp4' })
pupErr ? ok('a parent cannot upload') : bad('a parent uploaded a video')
const { data: again } = await admin.from('notification_queue').select('id').eq('kind', 'match_video').filter('payload->>event_id', 'eq', ev.id).eq('profile_id', PARENT)
again.length === 2 ? ok('a second video is a second push (each one is news)') : bad(`pushes to the parent: ${again.length}`)

head('4. Removing')
const { data: after } = await coach.rpc('remove_match_video', { p_video: v1.videos[0].id })
after.videos.length === 1 ? ok('the coach removes the link') : bad(`after remove: ${after.videos.length}`)
const { error: pre } = await parent.rpc('remove_match_video', { p_video: v2.videos[1].id })
pre?.code === '42501' ? ok('a parent cannot remove one') : bad(`parent remove: ${pre?.code ?? 'allowed'}`)

await tidy()
process.exit(process.exitCode ?? 0)
