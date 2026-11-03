// Run: node --env-file=.env.local scripts/test-match-day-list.mjs
//
// F-07 (0200): the match-day list on a game, and the push an hour before
// kick-off. Items the database can see tick themselves; the rest the coach
// ticks; a parent has no list; the push goes to the squad's coaches once.
import { createClient } from '@supabase/supabase-js'
import { signInClient } from './_auth.mjs'
import { runSql } from './_sql.mjs'

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
if (!coach || !parent) {
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
    await admin.from('event_lineups').delete().eq('event_id', e.id)
    await admin.from('event_attendance').delete().eq('event_id', e.id)
  }
  await admin.from('events').delete().like('title', 'TEST:: matchday%')
  if (addedClearance) await admin.from('staff_clearances').delete().eq('academy_id', NRIFA).eq('profile_id', MARCUS).eq('number', 'WWC0000001E')
}
await tidy()

head('1. The list on a game that came from a league export')
const soon = new Date(Date.now() + 60 * 60e3)
const { data: ev } = await admin.from('events').insert({ academy_id: NRIFA, team_id: U8, type: 'match', title: 'TEST:: matchday v Hornsby', opponent: 'Hornsby Heat', starts_at: soon.toISOString(), ends_at: new Date(soon.getTime() + 3600e3).toISOString(), venue: 'ELS Hall Park', created_by: OWNER }).select('id').single()
const { data: training } = await admin.from('events').insert({ academy_id: NRIFA, team_id: U8, type: 'training', title: 'TEST:: matchday training', starts_at: soon.toISOString(), ends_at: new Date(soon.getTime() + 3600e3).toISOString(), created_by: OWNER }).select('id').single()
let { data: list, error: le } = await coach.rpc('event_checklist', { p_event: ev.id })
if (le) { bad(`checklist: ${le.message}`); await tidy(); process.exit(1) }
list.length === 5 && list.map((i) => i.item).join(',') === 'sheet,lineup,kit,register,score' ? ok('five items, in match-day order') : bad(`items: ${list.map((i) => i.item).join(',')}`)
const sheet = list.find((i) => i.item === 'sheet')
sheet && !sheet.auto && /at the league/.test(sheet.label) && /fined/.test(sheet.hint) ? ok(`the sheet is the league's: "${sheet.label}" — ${sheet.hint}`) : bad(`sheet: ${JSON.stringify(sheet)}`)
list.every((i) => !i.done) ? ok('nothing done yet') : bad('something is already done')
list.filter((i) => i.auto).map((i) => i.item).join(',') === 'lineup,register,score' ? ok('the side, the register and the score tick themselves') : bad(`auto: ${list.filter((i) => i.auto).map((i) => i.item)}`)
const { data: tl } = await coach.rpc('event_checklist', { p_event: training.id })
Array.isArray(tl) && tl.length === 0 ? ok('training has no list') : bad(`training list: ${JSON.stringify(tl)}`)
const { error: pe } = await parent.rpc('event_checklist', { p_event: ev.id })
pe?.code === '42501' ? ok('a parent has no list') : bad(`parent list: ${pe?.code ?? 'allowed'}`)

head('2. Ticks: by hand, and by the database')
const { data: t1 } = await coach.rpc('tick_checklist', { p_event: ev.id, p_item: 'sheet', p_done: true })
t1.find((i) => i.item === 'sheet')?.done && /Marcus/.test(t1.find((i) => i.item === 'sheet').ticked_by ?? '') ? ok('the coach ticks the league sheet, by name') : bad(`sheet tick: ${JSON.stringify(t1.find((i) => i.item === 'sheet'))}`)
const { data: t2 } = await coach.rpc('tick_checklist', { p_event: ev.id, p_item: 'kit', p_done: true })
t2.find((i) => i.item === 'kit')?.done ? ok('and the kit') : bad('kit tick failed')
const { data: t3 } = await coach.rpc('tick_checklist', { p_event: ev.id, p_item: 'kit', p_done: false })
!t3.find((i) => i.item === 'kit')?.done ? ok('and unticks it') : bad('kit untick failed')
const { error: te } = await parent.rpc('tick_checklist', { p_event: ev.id, p_item: 'kit', p_done: true })
te?.code === '42501' ? ok('a parent cannot tick') : bad(`parent tick: ${te?.code ?? 'allowed'}`)
await coach.rpc('set_lineup', { p_event: ev.id, p_players: [{ player_id: LEO, role: 'starting', position: 'GK', sort_order: 1 }] })
;({ data: list } = await coach.rpc('event_checklist', { p_event: ev.id }))
!list.find((i) => i.item === 'lineup')?.done ? ok('a saved, unpublished side does not count') : bad('an unpublished side ticked the item')
await coach.rpc('publish_lineup', { p_event: ev.id, p_published: true })
;({ data: list } = await coach.rpc('event_checklist', { p_event: ev.id }))
list.find((i) => i.item === 'lineup')?.done ? ok('publishing it does') : bad('a published side did not tick the item')
await admin.from('event_attendance').insert({ academy_id: NRIFA, event_id: ev.id, player_id: LEO, status: 'present', marked_by: MARCUS })
await admin.from('events').update({ our_score: 2, their_score: 1 }).eq('id', ev.id)
;({ data: list } = await coach.rpc('event_checklist', { p_event: ev.id }))
list.find((i) => i.item === 'register')?.done && list.find((i) => i.item === 'score')?.done ? ok('a register taken and a score entered tick themselves') : bad(`register/score: ${JSON.stringify(list.filter((i) => ['register', 'score'].includes(i.item)))}`)
await admin.from('events').update({ our_score: null, their_score: null }).eq('id', ev.id)
await admin.from('event_attendance').delete().eq('event_id', ev.id)
await coach.rpc('publish_lineup', { p_event: ev.id, p_published: false })

head('3. The push, an hour before kick-off')
const { data: n, error: qe } = await admin.rpc('queue_match_day_pushes')
qe ? bad(`queue: ${qe.message}`) : ok(`the sweep queued ${n} push(es) for games 50–70 minutes out`)
const { data: pushes } = await admin.from('notification_queue').select('profile_id, kind, title, body, url').eq('kind', 'match_day').filter('payload->>event_id', 'eq', ev.id)
const toCoach = (pushes ?? []).find((p) => p.profile_id === MARCUS)
toCoach && /U8 SPL v Hornsby Heat kicks off at/.test(toCoach.title) ? ok(`the coach: "${toCoach.title}"`) : bad(`coach push: ${JSON.stringify(toCoach)}`)
toCoach && /Still to do:/.test(toCoach.body) && /Publish the side/.test(toCoach.body) && /register/.test(toCoach.body) && !/sheet/i.test(toCoach.body) ? ok(`naming what is left (the sheet is ticked): "${toCoach.body}"`) : bad(`body: ${toCoach?.body}`)
toCoach?.url === `/calendar/${ev.id}` ? ok('and opening the game') : bad(`url: ${toCoach?.url}`)
;(pushes ?? []).some((p) => p.profile_id === PARENT) ? bad('a parent was pushed the match-day list') : ok('no parent is told')
const { data: trainingPush } = await admin.from('notification_queue').select('id').eq('kind', 'match_day').filter('payload->>event_id', 'eq', training.id)
;(trainingPush ?? []).length === 0 ? ok('nothing for training') : bad('training got a match-day push')
await admin.rpc('queue_match_day_pushes')
const { data: again } = await admin.from('notification_queue').select('id').eq('kind', 'match_day').filter('payload->>event_id', 'eq', ev.id).eq('profile_id', MARCUS)
again.length === 1 ? ok('the sweep ten minutes later tells nobody twice') : bad(`coach told ${again.length} times`)
await admin.from('events').update({ cancelled_at: new Date().toISOString() }).eq('id', ev.id)
const { data: ev2 } = await admin.from('events').insert({ academy_id: NRIFA, team_id: U8, type: 'match', title: 'TEST:: matchday called off', opponent: 'Nobody', starts_at: soon.toISOString(), ends_at: new Date(soon.getTime() + 3600e3).toISOString(), cancelled_at: new Date().toISOString(), created_by: OWNER }).select('id').single()
await admin.rpc('queue_match_day_pushes')
const { data: cancelledPush } = await admin.from('notification_queue').select('id').eq('kind', 'match_day').filter('payload->>event_id', 'eq', ev2.id)
;(cancelledPush ?? []).length === 0 ? ok('a called-off game gets no push') : bad('a cancelled game was pushed')
// The catalog is read through the management API; without a working
// access token (none, or a dead one) the check is skipped and says so,
// because the product is not what failed.
const cron = process.env.SUPABASE_ACCESS_TOKEN ? await runSql("select schedule from cron.job where jobname = 'queue-match-day'").catch(() => 'unreachable') : 'no token'
if (Array.isArray(cron)) cron[0]?.schedule === '*/10 * * * *' ? ok('and pg_cron runs the sweep every ten minutes') : bad(`cron job: ${JSON.stringify(cron)}`)
else console.log(`  · cron check skipped (management API ${cron}); NEEDS JOEY #12 if the token is dead`)

await tidy()
process.exit(process.exitCode ?? 0)
