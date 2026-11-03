/**
 * test-development.mjs — what the coach saw (0196, G-05).
 *
 * A coach's note never reaches the family; a shared report does, once, with
 * a notification that opens the card; a clip is a link, never an upload;
 * a parent writes none of it; a teammate's parent and another club see
 * nothing at all.
 */
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
const LEO = '00000000-0000-0000-0000-0000000e0001'
const U8 = '00000000-0000-0000-0000-0000000d0008'
// A U8 game to tie a clip to — whichever the seed (or another suite) left.
const { data: u8Game } = await admin.from('events').select('id').eq('team_id', U8).eq('type', 'match').is('cancelled_at', null).order('starts_at', { ascending: false }).limit(1).maybeSingle()
const GAME = u8Game?.id ?? (await admin.from('events').insert({ academy_id: NRIFA, team_id: U8, type: 'match', title: 'TEST:: Round 12 vs Gladesville Ravens', starts_at: new Date(Date.now() - 3 * 864e5).toISOString(), ends_at: new Date(Date.now() - 3 * 864e5 + 3600e3).toISOString(), created_by: OWNER }).select('id').single()).data.id

const signIn = async (email) => {
  const c = await signInClient(admin, email)
  if (!c) {
    console.log("  could not sign in — the project's auth rate limit, not a failure")
    process.exit(2)
  }
  return c
}
const coach = await signIn('p61400000002@squadroom.invalid')      // Marcus, U8 coach
const parent = await signIn('p61400000011@squadroom.invalid')     // Leo's parent
const other = await signIn('p61400000012@squadroom.invalid')      // another U8 parent
const ravens = await signIn('p61400000091@squadroom.invalid')     // Ravens owner

// Marcus coaches U8 but the seed gives him no clearance; is_team_coach wants
// one. Add it only if missing, and take it away at the end.
const { data: cl } = await admin.from('staff_clearances').select('id').eq('academy_id', NRIFA).eq('profile_id', MARCUS).maybeSingle()
const addedClearance = !cl
if (addedClearance) {
  await admin.from('staff_clearances').insert({ academy_id: NRIFA, profile_id: MARCUS, kind: 'wwcc', number: 'WWC0000001E', outcome: 'cleared', expires_on: new Date(Date.now() + 400 * 864e5).toISOString().slice(0, 10), verified_by: OWNER })
}
const { data: otherKids } = await admin.from('player_guardians').select('player_id').eq('profile_id', '00000000-0000-0000-0000-0000000000b2')
if ((otherKids ?? []).some((k) => k.player_id === LEO)) { bad('the "other" parent is one of Leo\'s guardians; pick another'); process.exit(1) }

const made = { reports: [], clips: [] }
const tidy = async () => {
  if (made.reports.length) await admin.from('player_reports').delete().in('id', made.reports)
  if (made.clips.length) await admin.from('player_clips').delete().in('id', made.clips)
  await admin.from('player_reports').delete().like('body', 'TEST::%')
  await admin.from('player_clips').delete().like('title', 'TEST::%')
  await admin.from('notification_queue').delete().in('kind', ['player_report', 'player_clip']).like('dedupe_key', 'report:%')
  await admin.from('notification_queue').delete().in('kind', ['player_report', 'player_clip']).like('dedupe_key', 'clip:%')
  await admin.from('events').delete().like('title', 'TEST:: Round 12%')
  if (addedClearance) await admin.from('staff_clearances').delete().eq('academy_id', NRIFA).eq('profile_id', MARCUS).eq('number', 'WWC0000001E')
}
await tidy()

head('1. A note is the coach\'s own')
const { data: noteId, error: ne } = await coach.rpc('write_player_report', { p_player: LEO, p_kind: 'note', p_body: 'TEST:: left foot much better; drifts when tired' })
if (ne) { bad(`the coach could not write a note: ${ne.message}`); await tidy(); process.exit(1) }
made.reports.push(noteId)
ok('the U8 coach wrote a private note on Leo')
let { data: asCoach } = await coach.rpc('player_development', { p_player: LEO })
asCoach?.can_write && asCoach.reports.some((r) => r.id === noteId && r.kind === 'note') ? ok('the coach sees it, and may write') : bad('the coach does not see their own note')
let { data: asParent, error: pe } = await parent.rpc('player_development', { p_player: LEO })
pe ? bad(`Leo's parent cannot open the section: ${pe.message}`) : ok("Leo's parent opens the section")
asParent && asParent.is_family && !asParent.can_write ? ok('the parent is family, not a writer') : bad(`parent flags: ${JSON.stringify({ f: asParent?.is_family, w: asParent?.can_write })}`)
asParent && asParent.reports.length === 0 ? ok('the note never reaches the family') : bad(`the parent sees ${asParent?.reports.length} reports`)
const { error: shareNote } = await coach.rpc('share_player_report', { p_report: noteId, p_share: true })
shareNote ? ok(`a note cannot be shared (${shareNote.code})`) : bad('a note was shared with the family')
const { error: noteShared } = await coach.rpc('write_player_report', { p_player: LEO, p_kind: 'note', p_body: 'TEST:: x', p_share: true })
noteShared ? ok('nor written as shared') : bad('a note was written as shared')

head('2. A report is private until shared, then the family is told once')
const { data: reportId, error: re } = await coach.rpc('write_player_report', {
  p_player: LEO, p_kind: 'report', p_term: 'Term 4 2026',
  p_body: 'TEST:: Leo has had a strong term. First touch and scanning both improved; keep working on the weaker foot.',
  p_ratings: { technical: 4, tactical: 3, physical: 3, social: 5 }, p_share: false,
})
if (re) { bad(`the coach could not write a report: ${re.message}`); await tidy(); process.exit(1) }
made.reports.push(reportId)
;({ data: asParent } = await parent.rpc('player_development', { p_player: LEO }))
asParent.reports.length === 0 ? ok('an unshared report is invisible to the family') : bad('the parent sees an unshared report')
const { error: se } = await coach.rpc('share_player_report', { p_report: reportId, p_share: true })
se ? bad(`could not share: ${se.message}`) : ok('the coach shares it')
;({ data: asParent } = await parent.rpc('player_development', { p_player: LEO }))
const seen = asParent.reports.find((r) => r.id === reportId)
seen ? ok(`the family sees "${seen.term}" by ${seen.author}`) : bad('the family does not see the shared report')
seen && seen.ratings?.technical === 4 && seen.ratings?.social === 5 ? ok('with the four ratings') : bad(`ratings came back as ${JSON.stringify(seen?.ratings)}`)
seen && !asParent.reports.some((r) => r.id === noteId) ? ok('and still not the note') : bad('the note leaked alongside the report')
const { data: told } = await admin.from('notification_queue').select('profile_id, url, title').eq('kind', 'player_report').filter('payload->>report_id', 'eq', reportId)
const toParent = (told ?? []).find((t) => t.profile_id === '00000000-0000-0000-0000-0000000000b1')
toParent ? ok(`Leo's parent is told: "${toParent.title}"`) : bad('no notification for the parent')
toParent && toParent.url === `/card/${LEO}#development` ? ok('and the notification opens the card, not a home screen') : bad(`url was ${toParent?.url}`)
const { data: leoGuardians } = await admin.from('player_guardians').select('profile_id').eq('player_id', LEO)
const guardianIds = (leoGuardians ?? []).map((g) => g.profile_id)
const toldIds = (told ?? []).map((t) => t.profile_id)
toldIds.length >= 1 && toldIds.every((id) => guardianIds.includes(id)) ? ok(`${toldIds.length} guardian(s) told, nobody else`) : bad(`told: ${toldIds.join(', ') || 'nobody'}`)
await coach.rpc('share_player_report', { p_report: reportId, p_share: false })
await coach.rpc('share_player_report', { p_report: reportId, p_share: true })
const { data: toldAgain } = await admin.from('notification_queue').select('id').eq('kind', 'player_report').filter('payload->>report_id', 'eq', reportId).eq('profile_id', '00000000-0000-0000-0000-0000000000b1')
;(toldAgain ?? []).length === 1 ? ok('un-sharing and re-sharing does not tell them twice') : bad(`the parent was told ${toldAgain?.length} times`)

head('3. What is refused')
const { error: r6 } = await coach.rpc('write_player_report', { p_player: LEO, p_kind: 'report', p_body: 'TEST:: x', p_ratings: { technical: 6 } })
r6 ? ok('a rating of 6 is refused') : bad('a rating of 6 was accepted')
const { error: rk } = await coach.rpc('write_player_report', { p_player: LEO, p_kind: 'report', p_body: 'TEST:: x', p_ratings: { attitude: 3 } })
rk ? ok('an unknown rating is refused') : bad('an unknown rating was accepted')
const { error: rp } = await parent.rpc('write_player_report', { p_player: LEO, p_kind: 'report', p_body: 'TEST:: parent' })
rp?.code === '42501' ? ok('a parent cannot write a report (42501)') : bad(`parent write: ${rp?.code ?? 'allowed'}`)
const { error: ri } = await parent.from('player_reports').insert({ academy_id: NRIFA, player_id: LEO, author_id: '00000000-0000-0000-0000-0000000000b1', kind: 'report', body: 'TEST:: direct' })
ri ? ok(`nor insert one directly (${ri.code})`) : bad('a parent inserted a report row')
const { error: oe } = await other.rpc('player_development', { p_player: LEO })
oe?.code === '42501' ? ok("a teammate's parent is told no (42501)") : bad(`teammate's parent: ${oe?.code ?? 'allowed'}`)
const { data: oRows } = await other.from('player_reports').select('id').eq('player_id', LEO)
;(oRows ?? []).length === 0 ? ok('and reads no rows') : bad(`teammate's parent read ${oRows.length} rows`)
const { error: ve } = await ravens.rpc('player_development', { p_player: LEO })
ve?.code === '42501' ? ok('another club is told no') : bad(`Ravens: ${ve?.code ?? 'allowed'}`)
const { data: vRows } = await ravens.from('player_reports').select('id').eq('player_id', LEO)
;(vRows ?? []).length === 0 ? ok('and reads no rows') : bad(`Ravens read ${vRows.length} rows`)
const { error: de } = await parent.from('player_reports').delete().eq('id', reportId)
const { data: still } = await admin.from('player_reports').select('id').eq('id', reportId)
!de && (still ?? []).length === 1 ? ok("a parent's delete removes nothing") : bad(`parent delete: ${de?.message ?? 'row gone'}`)

head('4. A clip is a link, shared by default, never public')
const { data: clipId, error: ce } = await coach.rpc('add_player_clip', { p_player: LEO, p_url: 'https://app.veo.co/matches/TEST-leo#t=1234', p_title: 'TEST:: Leo’s run and cross', p_note: 'Watch the first touch.', p_event: GAME })
if (ce) { bad(`could not add a clip: ${ce.message}`); await tidy(); process.exit(1) }
made.clips.push(clipId)
ok('the coach adds a clip from the Gladesville game')
;({ data: asParent } = await parent.rpc('player_development', { p_player: LEO }))
const clip = asParent.clips.find((c) => c.id === clipId)
clip ? ok(`the family sees it: "${clip.title}" from ${clip.event?.title}`) : bad('the family does not see the clip')
const { data: clipTold } = await admin.from('notification_queue').select('profile_id, url').eq('kind', 'player_clip').filter('payload->>clip_id', 'eq', clipId).eq('profile_id', '00000000-0000-0000-0000-0000000000b1')
;(clipTold ?? []).length === 1 && clipTold[0].url.endsWith('#development') ? ok('and was told, to the card') : bad('no clip notification for the parent')
const { data: quiet, error: qe } = await coach.rpc('add_player_clip', { p_player: LEO, p_url: 'https://youtu.be/TEST', p_title: 'TEST:: for the coaches', p_share: false })
if (qe) bad(`unshared clip: ${qe.message}`); else made.clips.push(quiet)
;({ data: asParent } = await parent.rpc('player_development', { p_player: LEO }))
!asParent.clips.some((c) => c.id === quiet) ? ok('an unshared clip stays with the coaches') : bad('the family sees an unshared clip')
for (const u of ['javascript:alert(1)', 'ftp://x.com/a', 'veo.co/match', 'https://x y']) {
  const { error } = await coach.rpc('add_player_clip', { p_player: LEO, p_url: u, p_title: 'TEST:: bad' })
  error ? ok(`refused ${u}`) : bad(`${u} was accepted`)
}
const { error: ge } = await coach.rpc('add_player_clip', { p_player: LEO, p_url: 'https://x.com/a', p_title: 'TEST:: wrong game', p_event: '00000000-0000-0000-0000-0000000f0099' })
ge ? ok("a Ravens game cannot be named on an NRIFA child's clip") : bad('a clip was tied to another club\'s game')
const { error: pc } = await parent.rpc('add_player_clip', { p_player: LEO, p_url: 'https://x.com/a', p_title: 'TEST:: parent' })
pc?.code === '42501' ? ok('a parent cannot add a clip') : bad(`parent clip: ${pc?.code ?? 'allowed'}`)
const { data: oClips } = await other.from('player_clips').select('id').eq('player_id', LEO)
;(oClips ?? []).length === 0 ? ok("a teammate's parent sees no clips") : bad(`teammate's parent read ${oClips.length} clips`)
const { data: slugRow } = await admin.from('academies').select('slug').eq('id', NRIFA).single()
const { data: centre, error: pmErr } = await admin.rpc('public_match_centre', { p_slug: slugRow.slug })
const { data: front, error: faErr } = await admin.rpc('public_academy', { p_slug: slugRow.slug })
const publicText = JSON.stringify([centre, front])
pmErr || faErr
  ? bad(`could not read the public pages: ${pmErr?.message ?? faErr?.message}`)
  : !publicText.includes('TEST::') && !publicText.includes('veo.co') ? ok('nothing of it is on the public pages') : bad('a report or clip reached a public page')

head('5. The coach tidies up')
const { error: rm } = await coach.from('player_reports').delete().eq('id', noteId)
const { data: gone } = await admin.from('player_reports').select('id').eq('id', noteId)
!rm && (gone ?? []).length === 0 ? ok('the coach removes their note') : bad(`coach delete: ${rm?.message ?? 'row still there'}`)
const { data: games } = await coach.rpc('player_development', { p_player: LEO })
Array.isArray(games?.games) ? ok(`the coach is offered ${games.games.length} recent game(s) to tie a clip to`) : bad('no games list for the coach')

await tidy()
for (const c of [coach, parent, other, ravens]) c.realtime.disconnect()
process.exit(process.exitCode ?? 0)
