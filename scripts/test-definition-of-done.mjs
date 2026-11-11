// Run: node --env-file=.env.local scripts/test-definition-of-done.mjs
//   (needs the app running — npm run dev, or serve:test; SHOTS=1 saves every
//   role's Home at 375px in light and dark and every admin screen at laptop
//   width to .shots/)
//
// Big Club Mode, Phase 1's definition of done, proven on Inner West FC (the
// demo scripts/seed-inner-west.mjs makes on dev) with its eleven logins:
// each role does its job and nothing more; a coordinator cannot touch another
// group nor a manager another team; the Treasurer never sees a medical
// record; an incident reaches the Welfare officer and the President and
// nobody else; a parent sends no notice; MiniRoos keep no score unless the
// club says so; the activity log records every admin change; a parent with
// children in two streams sees both on one Home and an adult player their
// own team; every Home fits a phone and every admin screen a laptop.
// Everything it writes it takes back; the demo is left as it was found.
// The 2,000-person message is scripts/scale/message-the-club.mjs, on the
// local big dataset.
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'
import { resolveBaseUrl } from './_base-url.mjs'

const BASE = await resolveBaseUrl()
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const ref = URL_.split('//')[1].split('.')[0]
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SHOTS = process.env.SHOTS === '1'
const PASSWORD = process.env.DEMO_PASSWORD ?? 'squadroom-demo'
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const head = (m) => console.log(`\n${m}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
if (SHOTS) mkdirSync('.shots', { recursive: true })

const IW = '00000000-0000-0000-0000-0000000a0009'
const KEYS = ['president', 'secretary', 'registrar', 'treasurer', 'coordinator', 'manager', 'coach', 'parent', 'player', 'welfare', 'volunteers']
const LABEL = {
  president: 'President', secretary: 'Secretary', registrar: 'Registrar', treasurer: 'Treasurer', coordinator: 'U9–U12 coordinator',
  manager: 'Team manager (U12 Red)', coach: 'Coach (U10 Blue)', parent: 'Parent of two', player: 'Over-35s player', welfare: 'Welfare officer', volunteers: 'Volunteer coordinator',
}

// --- the demo as found ------------------------------------------------------
const count = async (table, build) => { const { count } = await build(admin.from(table).select('*', { count: 'exact', head: true })); return count ?? 0 }
async function snapshot() {
  const byAcademy = (q) => q.eq('academy_id', IW)
  const { data: a } = await admin.from('academies').select('miniroos_scores').eq('id', IW).single()
  return {
    players: await count('players', byAcademy), members: await count('academy_members', byAcademy), roles: await count('club_roles', byAcademy),
    team_members: await count('team_members', byAcademy), incidents: await count('incident_reports', byAcademy), medical: await count('player_medical', byAcademy),
    club_messages: await count('club_messages', byAcademy), notifications: await count('notification_queue', byAcademy), activity: await count('activity_log', byAcademy),
    scored: await count('events', (q) => q.eq('academy_id', IW).not('our_score', 'is', null)), teams: await count('teams', byAcademy),
    miniroos_scores: a?.miniroos_scores ?? null,
  }
}
const before = await snapshot()

// --- the eleven, by password --------------------------------------------------
const who = {}
for (const k of KEYS) {
  const client = createClient(URL_, PUB, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await client.auth.signInWithPassword({ email: `iw.${k}@squadroom-demo.test`, password: PASSWORD })
  if (error || !data.session) { console.log(`  could not sign in as ${k}: ${error?.message ?? 'no session'} — is the Inner West demo seeded?`); process.exit(2) }
  who[k] = { client, session: data.session, id: data.user.id }
}
const c = (k) => who[k].client

// --- the pieces of the demo the checks lean on ---------------------------------
const { data: teamRows } = await admin.from('teams').select('id, name, age_group').eq('academy_id', IW).eq('status', 'active')
const team = Object.fromEntries((teamRows ?? []).map((t) => [t.name, t.id]))
const T = { u8red: team['U8 Red'], u10blue: team['U10 Blue'], u12red: team['U12 Red'], u13black: team['U13 Black'], o35a: team['Over-35 A'] }
T.u10other = (teamRows ?? []).find((t) => t.age_group === 'U10' && t.name !== 'U10 Blue')?.id
T.u12other = (teamRows ?? []).find((t) => t.age_group === 'U12' && t.name !== 'U12 Red')?.id
T.u9 = (teamRows ?? []).find((t) => t.age_group === 'U9')?.id
const lastGame = async (teamId) => (await admin.from('events').select('id, our_score, their_score').eq('team_id', teamId).eq('type', 'match').lt('starts_at', new Date().toISOString()).order('starts_at', { ascending: false }).limit(1).maybeSingle()).data
const G = { u8: await lastGame(T.u8red), u13: await lastGame(T.u13black), u10: await lastGame(T.u10blue) }
const { data: amara } = await admin.from('players').select('id').eq('academy_id', IW).eq('team_id', T.u8red).eq('full_name', 'Amara Okoro').maybeSingle()
const { data: u10kid } = await admin.from('players').select('id').eq('academy_id', IW).eq('team_id', T.u10blue).limit(1).maybeSingle()
const { data: u12otherKid } = await admin.from('players').select('id, preferred_name').eq('academy_id', IW).eq('team_id', T.u12other).limit(1).maybeSingle()
if (!T.u8red || !T.u10blue || !T.u12red || !T.u13black || !T.o35a || !G.u8 || !G.u13 || !G.u10 || !amara) {
  console.log(`  the demo is not as seeded (teams ${JSON.stringify(T)}, games ${JSON.stringify(G)}, Amara ${amara?.id}) — run scripts/seed-inner-west.mjs`)
  process.exit(2)
}

const allowed = (r) => !r.error && r.data != null && !(Array.isArray(r.data) && r.data.length === 0)
const refused = (r) => !allowed(r)
const mark = new Date().toISOString()
const cleanup = { medical: false, incident: null, role: null, renamed: null, score: false, flag: false }

try {
  head('1. Each role does its job and nothing more')
  {
    const PROBES = {
      health: (k) => c(k).rpc('club_health', { p_academy: IW }),
      saturday: (k) => c(k).rpc('saturday_view', { p_academy: IW }),
      owes: (k) => c(k).rpc('outstanding_fees', { p_academy: IW }),
      gaps: (k) => c(k).rpc('volunteer_gaps', { p_academy: IW }),
      checks: (k) => c(k).rpc('accreditation_board', { p_academy: IW }),
      officials: (k) => c(k).rpc('club_officials', { p_academy: IW }),
      log: async (k) => { const { count, error } = await c(k).from('activity_log').select('id', { count: 'exact', head: true }).eq('academy_id', IW); return { error, data: (count ?? 0) > 0 ? count : null } },
      roles: (k) => c(k).rpc('grant_club_role', { p_academy: IW, p_profile: who.parent.id, p_role: 'team_manager', p_scope_kind: 'team', p_team: T.u9 }),
    }
    const WORD = { health: 'club health', saturday: 'the Saturday view', owes: 'who owes', gaps: 'the roster gaps', checks: 'the checks', officials: 'the officials list', log: 'the activity log', roles: 'handing out roles' }
    // Y = must work, N = must be refused, '-' = not this suite's claim.
    const EXPECT = {
      president:   { health: 'Y', saturday: 'Y', owes: 'Y', gaps: 'Y', checks: 'Y', officials: 'Y', log: 'Y', roles: '-' },
      secretary:   { health: 'Y', saturday: 'Y', owes: 'Y', gaps: 'Y', checks: 'Y', officials: 'Y', log: 'Y', roles: '-' },
      registrar:   { health: 'N', saturday: '-', owes: 'N', gaps: 'N', checks: 'N', officials: 'N', log: 'N', roles: 'N' },
      treasurer:   { health: 'N', saturday: 'N', owes: 'Y', gaps: 'N', checks: 'N', officials: 'N', log: 'N', roles: 'N' },
      coordinator: { health: 'N', saturday: '-', owes: 'N', gaps: 'N', checks: 'N', officials: 'N', log: 'N', roles: 'N' },
      manager:     { health: 'N', saturday: '-', owes: 'N', gaps: 'N', checks: 'N', officials: 'N', log: 'N', roles: 'N' },
      coach:       { health: 'N', saturday: 'N', owes: 'N', gaps: 'N', checks: 'N', officials: 'N', log: 'N', roles: 'N' },
      parent:      { health: 'N', saturday: 'N', owes: 'N', gaps: 'N', checks: 'N', officials: 'N', log: 'N', roles: 'N' },
      player:      { health: 'N', saturday: 'N', owes: 'N', gaps: 'N', checks: 'N', officials: 'N', log: 'N', roles: 'N' },
      welfare:     { health: 'N', saturday: '-', owes: 'N', gaps: 'N', checks: 'N', officials: 'N', log: 'N', roles: 'N' },
      volunteers:  { health: 'N', saturday: '-', owes: 'N', gaps: 'Y', checks: 'N', officials: 'N', log: 'N', roles: 'N' },
    }
    for (const k of KEYS) {
      const wrong = []
      const can = [], cannot = []
      for (const [probe, want] of Object.entries(EXPECT[k])) {
        if (want === '-') continue
        const r = await PROBES[probe](k)
        const got = allowed(r) ? 'Y' : 'N'
        if (got !== want) wrong.push(`${WORD[probe]} ${got === 'Y' ? 'answered' : 'refused'}${r.error ? ` (${r.error.message.slice(0, 60)})` : ''}`)
        else (want === 'Y' ? can : cannot).push(WORD[probe])
      }
      wrong.length ? bad(`${LABEL[k]}: ${wrong.join('; ')}`) : ok(`${LABEL[k]}: ${can.length ? `reads ${can.join(', ')}` : 'reads none of the club-wide screens'}${cannot.length ? `; refused ${cannot.length === 8 - (Object.values(EXPECT[k]).filter((v) => v === '-').length) ? 'everything else' : cannot.join(', ')}` : ''}`)
    }
    // Nothing above handed out a role.
    const { count: granted } = await admin.from('club_roles').select('id', { count: 'exact', head: true }).eq('academy_id', IW).eq('profile_id', who.parent.id)
    granted === 0 ? ok('and not one of the refused grants went through') : bad(`${granted} roles landed on the parent`)
  }

  head('2. A coordinator keeps to their groups, a manager to their team, a coach to their squad')
  {
    const coordIn = await c('coordinator').rpc('preview_club_message', { p_academy: IW, p_audience: { kind: 'age_groups', age_groups: ['U10'] } })
    const coordOut = await c('coordinator').rpc('preview_club_message', { p_academy: IW, p_audience: { kind: 'age_groups', age_groups: ['U13'] } })
    coordIn.data?.allowed && coordIn.data.count > 0 ? ok(`the U9–U12 coordinator may message the U10s (${coordIn.data.count} people)`) : bad(`coordinator U10: ${JSON.stringify(coordIn.data ?? coordIn.error?.message)}`)
    !coordOut.data?.allowed ? ok('and not the U13s') : bad(`coordinator reached U13: ${JSON.stringify(coordOut.data)}`)
    const gridIn = await c('coordinator').rpc('availability_grid', { p_team: T.u10blue })
    const gridOut = await c('coordinator').rpc('availability_grid', { p_team: T.u13black })
    allowed(gridIn) ? ok('reads a U10 squad\'s availability') : bad(`coordinator U10 grid: ${gridIn.error?.message ?? 'null'}`)
    refused(gridOut) ? ok('and not a U13 squad\'s') : bad('coordinator read a U13 squad\'s availability')
    const { data: touched } = await c('coordinator').from('teams').update({ name: 'Renamed by a coordinator' }).eq('id', T.u13black).select('id')
    ;(touched ?? []).length === 0 ? ok('changes nothing about a U13 squad (0 rows)') : bad('a coordinator renamed a U13 squad')

    const mgrIn = await c('manager').rpc('preview_club_message', { p_academy: IW, p_audience: { kind: 'teams', ids: [T.u12red] } })
    const mgrOut = await c('manager').rpc('preview_club_message', { p_academy: IW, p_audience: { kind: 'teams', ids: [T.u12other] } })
    mgrIn.data?.allowed && mgrIn.data.count > 0 ? ok(`the U12 Red manager may message U12 Red (${mgrIn.data.count} people)`) : bad(`manager own team: ${JSON.stringify(mgrIn.data ?? mgrIn.error?.message)}`)
    !mgrOut.data?.allowed ? ok('and not the other U12 squad') : bad('a manager reached another squad')
    const mgrGridIn = await c('manager').rpc('availability_grid', { p_team: T.u12red })
    const mgrGridOut = await c('manager').rpc('availability_grid', { p_team: T.u12other })
    allowed(mgrGridIn) && refused(mgrGridOut) ? ok('reads their own squad\'s availability and not the other\'s') : bad(`manager grids: own ${allowed(mgrGridIn)}, other ${allowed(mgrGridOut)}`)
    const { data: mgrTouched } = await c('manager').from('players').update({ preferred_name: 'Touched' }).eq('id', u12otherKid?.id ?? T.u12other).select('id')
    ;(mgrTouched ?? []).length === 0 ? ok('changes nothing about another squad\'s player (0 rows)') : bad('a manager changed another squad\'s player')

    const coachIn = await c('coach').rpc('availability_grid', { p_team: T.u10blue })
    const coachOut = await c('coach').rpc('availability_grid', { p_team: T.u10other })
    allowed(coachIn) && refused(coachOut) ? ok('the U10 Blue coach reads their squad\'s availability and not the other U10\'s') : bad(`coach grids: own ${allowed(coachIn)}, other ${allowed(coachOut)}`)
    const coachClub = await c('coach').rpc('preview_club_message', { p_academy: IW, p_audience: { kind: 'club' } })
    !coachClub.data?.allowed ? ok('and may not message the whole club') : bad('a coach may message the whole club')
  }

  head('3. The Treasurer never sees a medical record')
  {
    const { data: existing } = await admin.from('player_medical').select('player_id').eq('player_id', amara.id).maybeSingle()
    if (!existing) {
      const { error } = await c('parent').from('player_medical').insert({ academy_id: IW, player_id: amara.id, conditions: 'Asthma — inhaler in the bag', first_aid_consent: true })
      error ? bad(`Grace could not add Amara's medical note: ${error.message}`) : ok('Grace adds a medical note for Amara (asthma, inhaler in the bag)')
      cleanup.medical = !error
    }
    const { data: tre } = await c('treasurer').from('player_medical').select('player_id').eq('player_id', amara.id)
    ;(tre ?? []).length === 0 ? ok('the Treasurer reads nothing of it') : bad('the Treasurer read a medical record')
    const { data: treAll } = await c('treasurer').from('player_medical').select('player_id').eq('academy_id', IW)
    ;(treAll ?? []).length === 0 ? ok('nor any medical record in the club') : bad(`the Treasurer read ${treAll.length} medical records`)
    const { data: owes } = await c('treasurer').rpc('outstanding_fees', { p_academy: IW })
    const leak = (owes ?? []).some((r) => JSON.stringify(r).toLowerCase().includes('asthma'))
    !leak && (owes ?? []).length > 0 ? ok(`who owes names the family and the money (${owes.length} rows), never a condition`) : bad(leak ? 'who owes carried a medical note' : 'who owes was empty')
    const { data: pres } = await c('president').from('player_medical').select('player_id').eq('player_id', amara.id)
    ;(pres ?? []).length === 1 ? ok('the staff who may need it on the day can read it') : bad('the President could not read the note')
  }

  head('4. An incident reaches the Welfare officer and the President — nobody else')
  {
    const { data: id, error } = await c('coach').rpc('file_incident_report', {
      p_academy: IW, p_event: G.u10.id, p_player: u10kid?.id ?? null,
      p_what: 'Knock to the head in a tackle, second half. Sat out, watched for twenty minutes, parent took him home.',
      p_first_aid: 'Ice; watched for twenty minutes', p_ambulance: false, p_parent_told: true,
    })
    cleanup.incident = id ?? null
    error ? bad(`the coach could not file: ${error.message}`) : ok('the U10 Blue coach files an incident from Saturday\'s game')
    if (id) {
      const { data: told } = await admin.from('notification_queue').select('profile_id').like('dedupe_key', `report:incident_reports:${id}:%`)
      const set = new Set((told ?? []).map((t) => t.profile_id))
      set.size === 2 && set.has(who.welfare.id) && set.has(who.president.id) ? ok('told to exactly two people: the Welfare officer and the President') : bad(`told to ${set.size}: ${[...set].map((p) => Object.keys(who).find((k) => who[k].id === p) ?? p).join(', ')}`)
      const sees = async (k) => { const { data } = await c(k).rpc('incident_register', { p_academy: IW }); return Array.isArray(data) && data.some((r) => r.id === id) }
      const reads = async (k) => { const { data } = await c(k).from('incident_reports').select('id').eq('id', id); return (data ?? []).length === 1 }
      ;(await sees('welfare')) ? ok('the Welfare officer finds it on the register') : bad('the Welfare officer cannot see it')
      ;(await sees('president')) ? ok('so does the President') : bad('the President cannot see it')
      ;(await reads('coach')) ? ok('the coach who filed it reads their own report') : bad('the filer cannot read their own report')
      const others = []
      for (const k of ['secretary', 'treasurer', 'registrar', 'coordinator', 'manager', 'parent', 'player', 'volunteers']) if ((await sees(k)) || (await reads(k))) others.push(LABEL[k])
      others.length === 0 ? ok('the Secretary, Treasurer, Registrar, coordinator, manager, a parent, a player and the Volunteer coordinator see nothing of it') : bad(`seen by ${others.join(', ')}`)
    }
  }

  head('5. A parent sends no notice')
  {
    const send = await c('parent').rpc('send_club_message', { p_academy: IW, p_body: 'Bake sale on Saturday!' })
    send.error ? ok(`Grace cannot message the club ("${send.error.message.slice(0, 48)}")`) : bad('a parent messaged the club')
    const prev = await c('parent').rpc('preview_club_message', { p_academy: IW, p_audience: { kind: 'club' } })
    !prev.data?.allowed ? ok('nor see how many it would reach') : bad('a parent previewed a club message')
    const { data: notices } = await admin.from('channels').select('id, name').eq('academy_id', IW).eq('type', 'academy_wide').eq('posting_mode', 'hosts_only').limit(1).maybeSingle()
    if (notices) {
      const { error: post } = await c('parent').from('messages').insert({ channel_id: notices.id, sender_id: who.parent.id, body: 'Bake sale on Saturday!' })
      post ? ok(`and cannot post in ${notices.name}`) : bad(`a parent posted in ${notices.name}`)
    } else console.log('  (no hosts-only club channel to try)')
    // 0254: in club mode an age group's channel is notices too — found open
    // here by this suite's first run.
    const { data: ageChan } = await admin.from('channels').select('id, name, posting_mode').eq('academy_id', IW).eq('type', 'age_group').eq('age_group', 'U8').maybeSingle()
    if (ageChan) {
      const { error: agePost } = await c('parent').from('messages').insert({ channel_id: ageChan.id, sender_id: who.parent.id, body: 'Anyone for a lift on Saturday?' })
      agePost && ageChan.posting_mode === 'hosts_only' ? ok(`nor in ${ageChan.name} — an age group's channel is notices in club mode`) : bad(`${ageChan.name} is ${ageChan.posting_mode}${agePost ? '' : ' and a parent posted in it'}`)
    }
    const adult = await c('player').rpc('send_club_message', { p_academy: IW, p_body: 'Beers after the game?' })
    adult.error ? ok('an adult player cannot either') : bad('an adult player messaged the club')
    const { data: sentByThem } = await admin.from('club_messages').select('id').eq('academy_id', IW).in('sender_id', [who.parent.id, who.player.id])
    ;(sentByThem ?? []).length === 0 ? ok('nothing of theirs is on the sent list') : bad(`${sentByThem.length} messages by a parent or player`)
  }

  head('6. MiniRoos keep no score unless the club says so')
  {
    before.miniroos_scores === false ? ok('Inner West FC has not turned MiniRoos scores on (the default)') : bad(`miniroos_scores = ${before.miniroos_scores}`)
    // A score the U8s' game does have, for the length of this check.
    const { error: put } = await admin.from('events').update({ our_score: 4, their_score: 2 }).eq('id', G.u8.id)
    cleanup.score = !put
    // event_result is the stored result (the seed's); event_live is the tally
    // of the game's taps, which these games never had.
    const result = async (id) => (await c('parent').rpc('event_result', { p_event: id })).data?.[0] ?? null
    const live = async (id) => (await c('parent').rpc('event_live', { p_event: id })).data
    const hiddenR = await result(G.u8.id)
    const hiddenL = await live(G.u8.id)
    hiddenR == null && hiddenL && hiddenL.scores_shown === false && hiddenL.score == null ? ok('Amara\'s U8 game shows no result and no live score to her parent, though 4–2 was typed in') : bad(`U8: result ${JSON.stringify(hiddenR)}, live ${JSON.stringify({ shown: hiddenL?.scores_shown, score: hiddenL?.score })}`)
    const shownR = await result(G.u13.id)
    const shownL = await live(G.u13.id)
    shownR && shownR.ours === G.u13.our_score && shownR.theirs === G.u13.their_score && shownL?.scores_shown === true ? ok(`Jonah's U13 game shows its result (${shownR.ours}–${shownR.theirs})`) : bad(`U13: result ${JSON.stringify(shownR)} (stored ${G.u13.our_score}–${G.u13.their_score}), live shown ${shownL?.scores_shown}`)
    const { error: flag } = await admin.from('academies').update({ miniroos_scores: true }).eq('id', IW)
    cleanup.flag = !flag
    const nowR = await result(G.u8.id)
    const nowL = await live(G.u8.id)
    nowR?.ours === 4 && nowR?.theirs === 2 && nowL?.scores_shown === true ? ok('the club turns them on and the same game shows 4–2') : bad(`U8 after the switch: result ${JSON.stringify(nowR)}, live shown ${nowL?.scores_shown}`)
    await admin.from('academies').update({ miniroos_scores: false }).eq('id', IW)
    await admin.from('events').update({ our_score: G.u8.our_score, their_score: G.u8.their_score }).eq('id', G.u8.id)
    cleanup.flag = false; cleanup.score = false
  }

  head('7. The activity log records every admin change')
  {
    // Dev Sharma, the U10 Blue coach, has a current check — a squad with
    // children takes no manager without one (0120).
    const { data: roleId, error } = await c('president').rpc('grant_club_role', { p_academy: IW, p_profile: who.coach.id, p_role: 'team_manager', p_scope_kind: 'team', p_team: T.u9 })
    cleanup.role = roleId ?? null
    error ? bad(`the President could not grant: ${error.message}`) : ok('the President makes the U10 Blue coach a U9 squad\'s manager as well')
    const rows = async () => (await c('president').from('activity_log').select('action, actor_id, subject_kind, subject_name, at').eq('academy_id', IW).gt('at', mark).order('at')).data ?? []
    let log = await rows()
    const grantRow = log.find((r) => r.action === 'role.granted')
    grantRow && grantRow.actor_id === who.president.id ? ok(`logged: role.granted — by the President, at ${grantRow.at.slice(11, 19)}`) : bad(`grant not logged: ${JSON.stringify(log.map((r) => r.action))}`)
    if (roleId) {
      const { error: rev } = await c('president').rpc('revoke_club_role', { p_role_id: roleId })
      if (!rev) cleanup.role = null
      log = await rows()
      log.some((r) => r.action === 'role.revoked' && r.actor_id === who.president.id) ? ok('and the revoke, the same way') : bad(`revoke not logged: ${JSON.stringify(log.map((r) => r.action))}`)
    }
    const { data: t } = await admin.from('teams').select('name').eq('id', T.u8red).single()
    const { error: ren } = await c('president').from('teams').update({ name: `${t.name} (renamed)` }).eq('id', T.u8red)
    if (!ren) {
      cleanup.renamed = { id: T.u8red, name: t.name }
      await c('president').from('teams').update({ name: t.name }).eq('id', T.u8red)
      cleanup.renamed = null
      log = await rows()
      const teamRows = log.filter((r) => r.action.startsWith('team.'))
      teamRows.length >= 2 ? ok(`a squad renamed and renamed back: ${teamRows.length} team rows, each with who and when`) : bad(`team changes logged: ${teamRows.length}`)
    } else bad(`rename refused: ${ren.message}`)
    const { data: treLog } = await c('treasurer').from('activity_log').select('id').eq('academy_id', IW).gt('at', mark)
    ;(treLog ?? []).length === 0 ? ok('the Treasurer reads none of it') : bad('the Treasurer read the activity log')
  }
} catch (e) {
  bad(`threw: ${e.message}`)
}

// --- the screens ---------------------------------------------------------------
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
try {
  head('8. Every Home at 375px, light and dark')
  for (const k of KEYS) {
    for (const theme of ['light', 'dark']) {
      const context = await browser.createBrowserContext()
      const page = await context.newPage()
      await page.setViewport({ width: 375, height: 812 })
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }])
      await page.setCookie({ name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(who[k].session)).toString('base64'), domain: 'localhost', path: '/' })
      await page.evaluateOnNewDocument((o) => { try { localStorage.setItem('squadroom.org', o) } catch {} }, IW)
      try {
        await page.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 90000 })
        await sleep(600)
        let text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))
        // A dev server mid-compile answers a near-empty page once; ask again
        // before calling it a fault.
        if (text.length < 200) { await sleep(1500); await page.reload({ waitUntil: 'networkidle2', timeout: 90000 }); await sleep(800); text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ')) }
        const fits = await page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1)
        const faults = []
        if (!text.includes('Inner West')) faults.push('does not name the club')
        if (text.length < 200) faults.push('almost empty')
        if (!fits) faults.push('wider than the phone')
        if (k === 'parent') for (const w of ['Amara', 'Jonah']) if (!text.includes(w)) faults.push(`no ${w}`)
        if (k === 'player') { if (!text.includes('Over-35 A')) faults.push('no Over-35 A'); if (/U8 Red|U13 Black/.test(text)) faults.push('shows a junior squad') }
        faults.length ? bad(`${LABEL[k]} (${theme}): ${faults.join(', ')}`) : ok(`${LABEL[k]} (${theme})${k === 'parent' ? ': both children on one Home' : k === 'player' ? ': their own team, nothing else' : ''}`)
        if (SHOTS) await page.screenshot({ path: `.shots/dod-home-${k}-${theme}.png`, fullPage: true })
      } catch (e) {
        bad(`${LABEL[k]} (${theme}): ${String(e.message).slice(0, 80)}`)
      }
      await context.close()
    }
  }

  head('9. Every admin screen at laptop width, as the President')
  const ADMIN = ['', 'health', 'saturday', 'rosters', 'roles', 'activity', 'members', 'teams', 'venues', 'programs', 'registrations', 'payments', 'requests', 'invites', 'import', 'message', 'clearances', 'safeguarding', 'season', 'kit', 'sponsors']
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 1280, height: 800 })
  await page.setCookie({ name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(who.president.session)).toString('base64'), domain: 'localhost', path: '/' })
  await page.evaluateOnNewDocument((o) => { try { localStorage.setItem('squadroom.org', o) } catch {} }, IW)
  for (const slug of ADMIN) {
    const path = `/admin${slug ? `/${slug}` : ''}`
    try {
      const res = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 90000 })
      await sleep(500)
      let text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))
      if (text.length < 80) { await sleep(1500); await page.reload({ waitUntil: 'networkidle2', timeout: 90000 }); await sleep(800); text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ')) }
      const fits = await page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1)
      const faults = []
      if (res && res.status() >= 400) faults.push(`HTTP ${res.status()}`)
      if (/Something went wrong|Application error|Unhandled Runtime Error|not yours|This page could not be found/i.test(text)) faults.push('an error on the page')
      if (text.length < 80) faults.push('almost empty')
      if (!fits) faults.push('wider than the laptop')
      faults.length ? bad(`${path}: ${faults.join(', ')}`) : ok(`${path} (${text.length} chars)`)
      if (SHOTS) await page.screenshot({ path: `.shots/dod-admin-${slug || 'hub'}.png`, fullPage: true })
    } catch (e) {
      bad(`${path}: ${String(e.message).slice(0, 80)}`)
    }
  }
  await context.close()
} finally {
  await browser.close()
}

// --- take it all back --------------------------------------------------------------
head('10. The demo as it was')
if (cleanup.incident) {
  await admin.from('notification_queue').delete().like('dedupe_key', `report:incident_reports:${cleanup.incident}:%`)
  await admin.from('incident_reports').delete().eq('id', cleanup.incident)
}
if (cleanup.medical) await admin.from('player_medical').delete().eq('player_id', amara.id)
if (cleanup.role) await admin.from('club_roles').delete().eq('id', cleanup.role)
if (cleanup.renamed) await admin.from('teams').update({ name: cleanup.renamed.name }).eq('id', cleanup.renamed.id)
if (cleanup.flag) await admin.from('academies').update({ miniroos_scores: false }).eq('id', IW)
if (cleanup.score) await admin.from('events').update({ our_score: G.u8.our_score, their_score: G.u8.their_score }).eq('id', G.u8.id)
await admin.from('notification_queue').delete().eq('academy_id', IW).gt('created_at', mark)
const { error: logErr } = await admin.from('activity_log').delete().eq('academy_id', IW).gt('at', mark)
if (logErr) console.log(`  (the suite's own activity rows stay: ${logErr.message})`)
const after = await snapshot()
const diff = Object.keys(before).filter((k) => before[k] !== after[k])
diff.length === 0 ? ok('every count and the MiniRoos switch as before') : bad(`changed: ${diff.map((k) => `${k} ${before[k]} → ${after[k]}`).join(', ')}`)

console.log(process.exitCode ? '\n\x1b[31mPHASE 1 IS NOT DONE\x1b[0m\n' : '\n\x1b[32mPhase 1: done by its own definition\x1b[0m\n')
