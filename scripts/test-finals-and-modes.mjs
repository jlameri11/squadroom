import { createClient } from '@supabase/supabase-js'
const URL=process.env.NEXT_PUBLIC_SUPABASE_URL, PUB=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const admin=createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}})
const anon =createClient(URL, PUB,{auth:{persistSession:false}})
const ok=m=>console.log(`  \x1b[32m✓\x1b[0m ${m}`), bad=m=>{console.log(`  \x1b[31m✗\x1b[0m ${m}`);process.exitCode=1}
const head=m=>console.log(`\n${m}`)
const SPL_ORG='00000000-0000-0000-0000-0000000a0003'
const NRIFA='00000000-0000-0000-0000-0000000a0001', RAVENS='00000000-0000-0000-0000-0000000a0002'

async function sess(email){
  const { data:l } = await admin.auth.admin.generateLink({type:'magiclink', email})
  const { data:s } = await anon.auth.verifyOtp({token_hash:l.properties.hashed_token, type:'email'})
  return { client: createClient(URL, PUB, {auth:{persistSession:false},
    global:{headers:{Authorization:`Bearer ${s.session.access_token}`}}}), id: s.user.id }
}
const spl = await sess('p61400000301@squadroom.invalid')
const sam = await sess('p61400000011@squadroom.invalid')

for (const n of ['Finals Test Cup','Dribl League']) await admin.from('competitions').delete().eq('name', n)

// ---------- managed ----------
head('MANAGED — Squadroom runs it')
const { data: cup } = await spl.client.from('competitions').insert({
  organiser_id: SPL_ORG, name:'Finals Test Cup', type:'tournament', season:'2026', mode:'managed',
}).select('id').single()

const clubs = ['Alpha','Bravo','Charlie','Delta','Echo','Foxtrot'].map((n,i)=>({ club_name:n, group_label: i<3?'A':'B' }))
await spl.client.rpc('bulk_invite_clubs', { p_competition: cup.id, p_division:'U8s', p_clubs: clubs })
const { data: made } = await spl.client.rpc('generate_fixtures', {
  p_competition: cup.id, p_division:'U8s',
  p_start_at: new Date('2026-10-04T08:00:00+11:00').toISOString(),
  p_fields:['Field 1','Field 2'],
})
made === 6 ? ok(`${made} group games across two groups of three`) : bad(`${made} games`)

head('1. Finals are set up before anyone knows who is in them')
const { data: n } = await spl.client.rpc('create_finals', {
  p_competition: cup.id, p_division:'U8s',
  p_start_at: new Date('2026-10-04T15:00:00+11:00').toISOString(),
  p_fields:['Field 1','Field 2'],
})
n === 3 ? ok('two semis and a final, with times and fields') : bad(`${n} fixtures`)
const { data: sheet1 } = await spl.client.rpc('competition_run_sheet', { p_competition: cup.id })
const finals1 = sheet1.filter(f => f.round?.includes('final') || f.round === 'Final')
finals1.every(f => !f.home_name) ? ok('participants still blank — the group stage has not finished') : bad('teams filled too early')

head('2. Nothing resolves until every group game is done')
const groupGames = sheet1.filter(f => f.round?.startsWith('Round'))
await admin.from('fixtures').update({ home_score:3, away_score:0, status:'final' }).eq('id', groupGames[0].fixture_id)
const { data: r1 } = await spl.client.rpc('resolve_finals', { p_competition: cup.id, p_division:'U8s' })
r1 === 0 ? ok('still nothing — "best runner-up" would be a guess') : bad(`resolved ${r1} early`)

head('3. Finishing the groups fills the semi-finals')
for (const [i, g] of groupGames.slice(1).entries()) {
  await admin.from('fixtures').update({ home_score: (i % 3) + 1, away_score: i % 2, status:'final' }).eq('id', g.fixture_id)
}
const { data: sheet2 } = await spl.client.rpc('competition_run_sheet', { p_competition: cup.id })
const semis = sheet2.filter(f => f.round?.startsWith('Semi'))
semis.every(f => f.home_name && f.away_name)
  ? ok(`SF1: ${semis[0].home_name} v ${semis[0].away_name} · SF2: ${semis[1].home_name} v ${semis[1].away_name}`)
  : bad('semi-finals still empty')

head('4. The final waits for the semis')
const finalGame = sheet2.find(f => f.round === 'Final')
!finalGame.home_name ? ok('final still blank, as it should be') : bad('final filled before the semis were played')

head('5. A semi-final result promotes the winner automatically')
const expectHome = semis[0].home_name   // wins SF1 2-1
const expectAway = semis[1].away_name   // wins SF2 0-4
if (!expectHome || !expectAway) bad('semi-finals had no teams to promote')
await admin.from('fixtures').update({ home_score:2, away_score:1, status:'final' }).eq('id', semis[0].fixture_id)
await admin.from('fixtures').update({ home_score:0, away_score:4, status:'final' }).eq('id', semis[1].fixture_id)
const { data: sheet3 } = await spl.client.rpc('competition_run_sheet', { p_competition: cup.id })
const gf = sheet3.find(f => f.round === 'Final')
gf.home_name && gf.home_name === expectHome && gf.away_name === expectAway
  ? ok(`final set: ${gf.home_name} v ${gf.away_name} — no button pressed`)
  : bad(`expected ${expectHome} v ${expectAway}, got ${gf.home_name} v ${gf.away_name}`)

head('6. A drawn semi-final is left alone')
await admin.from('fixtures').update({ home_entry_id:null, away_entry_id:null }).eq('id', gf.fixture_id)
await admin.from('fixtures').update({ home_score:1, away_score:1 }).eq('id', semis[0].fixture_id)
await spl.client.rpc('resolve_finals', { p_competition: cup.id, p_division:'U8s' })
const { data: sheet4 } = await spl.client.rpc('competition_run_sheet', { p_competition: cup.id })
const gf2 = sheet4.find(f => f.round === 'Final')
!gf2.home_name ? ok('no winner invented from a draw — penalties happen off the app') : bad('picked a winner from a 1-1')

// ---------- comms only ----------
head('COMMS ONLY — someone else runs it, we carry the messages')
const { data: league } = await spl.client.from('competitions').insert({
  organiser_id: SPL_ORG, name:'Dribl League', type:'season', season:'2026', mode:'comms_only',
}).select('id').single()
await admin.from('competition_clubs').insert([
  { competition_id: league.id, academy_id: NRIFA, status:'active' },
  { competition_id: league.id, academy_id: RAVENS, status:'active' },
])

head('7. The draw button is refused, not merely hidden')
const { error: ge } = await spl.client.rpc('generate_fixtures', {
  p_competition: league.id, p_division:'U8s',
  p_start_at: new Date().toISOString(), p_fields:['Field 1'] })
ge ? ok(`refused: "${ge.message.slice(0, 60)}…"`) : bad('built a draw for a competition run elsewhere')

const { error: fe } = await spl.client.rpc('create_finals', {
  p_competition: league.id, p_division:'U8s', p_start_at: new Date().toISOString() })
fe ? ok('finals refused too') : bad('created finals')

head('8. But one message reaches every club')
const before = await admin.from('messages').select('id',{count:'exact',head:true})
const { data: reached, error: be } = await spl.client.rpc('broadcast_to_competition', {
  p_competition: league.id,
  p_body: 'Round 12 is off — grounds closed. Details Monday.',
  p_urgent: true,
})
be ? bad(be.message) : reached === 2 ? ok(`delivered into ${reached} clubs' own announcement channels`) : bad(`reached ${reached}`)

const { data: nrifaMsgs } = await admin.from('messages')
  .select('body, is_announcement, academy_id').ilike('body','%grounds closed%')
nrifaMsgs.length === 2 ? ok('one message per club, in their own channel') : bad(`${nrifaMsgs.length} messages`)
nrifaMsgs.every(m => m.is_announcement) ? ok('sent as an announcement, so a muted channel still shows it') : bad('not an announcement')
new Set(nrifaMsgs.map(m=>m.academy_id)).size === 2 ? ok('no shared channel — the clubs never see each other') : bad('clubs share a channel')

head('9. A parent sees it in their own club, and nothing of the other')
const { data: samSees } = await sam.client.from('messages').select('body').ilike('body','%grounds closed%')
samSees.length === 1 ? ok('exactly one copy, their own') : bad(`saw ${samSees.length}`)

head('10. Only the organiser can broadcast')
const { error: pe } = await sam.client.rpc('broadcast_to_competition', {
  p_competition: league.id, p_body: 'free lollies at mine' })
pe ? ok('a parent is refused') : bad('a parent broadcast to the league')

for (const n of ['Finals Test Cup','Dribl League']) await admin.from('competitions').delete().eq('name', n)
await admin.from('messages').delete().ilike('body','%grounds closed%')
console.log(process.exitCode ? '\n\x1b[31mBROKEN\x1b[0m\n' : '\n\x1b[32mBOTH MODES WORK\x1b[0m\n')
process.exit(process.exitCode ?? 0)
