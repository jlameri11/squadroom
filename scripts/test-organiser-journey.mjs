import { createClient } from '@supabase/supabase-js'
const URL=process.env.NEXT_PUBLIC_SUPABASE_URL, PUB=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const admin=createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}})
const anon =createClient(URL, PUB,{auth:{persistSession:false}})
const ok=m=>console.log(`  \x1b[32m✓\x1b[0m ${m}`), bad=m=>{console.log(`  \x1b[31m✗\x1b[0m ${m}`);process.exitCode=1}
const head=m=>console.log(`\n${m}`)

async function userFor(email, name){
  const { data:{users} } = await admin.auth.admin.listUsers({perPage:200})
  const found = users.find(u=>u.email===email)
  if (found) await admin.auth.admin.deleteUser(found.id)
  const { data } = await admin.auth.admin.createUser({ email, email_confirm:true, user_metadata:{full_name:name} })
  return data.user.id
}
async function sessionFor(email){
  const { data:l } = await admin.auth.admin.generateLink({type:'magiclink', email})
  const { data:s } = await anon.auth.verifyOtp({token_hash:l.properties.hashed_token, type:'email'})
  return createClient(URL, PUB, {auth:{persistSession:false}, global:{headers:{Authorization:`Bearer ${s.session.access_token}`}}})
}

// clean
for (const n of ['Magic Group','Joga Bonito FC']) await admin.from('academies').delete().eq('name', n)

head('1. The event group signs up and creates a competition')
const magicUid = await userFor('promoter@magicgroup.test','Magic Promoter')
const magic = await sessionFor('promoter@magicgroup.test')
const { data: magicOrg, error: e1 } = await magic.rpc('create_academy', { p_name:'Magic Group', p_type:'league' })
e1 ? bad(e1.message) : ok('Magic Group created as a league')

const { data: comp, error: e2 } = await magic.from('competitions')
  .insert({ organiser_id: magicOrg, name:'SPL Season 4', type:'season', season:'2027',
            organiser:'Magic Group', starts_on:'2027-04-03' })
  .select('id').single()
e2 ? bad(e2.message) : ok('SPL Season 4 created')

head('2. 120 clubs, none of whom have accounts')
const clubs = Array.from({length:120},(_,i)=>({ club_name:`Club ${i+1} FC`, group_label:String.fromCharCode(65+(i%6)) }))
clubs[0].club_name = 'Joga Bonito FC'
const { data: invites, error: e3 } = await magic.rpc('bulk_invite_clubs', {
  p_competition: comp.id, p_division:'U8s Championship', p_clubs: clubs })
e3 ? bad(e3.message) : ok(`${invites.length} entries + invite links created in one call`)

const { count: entryCount } = await admin.from('competition_entries')
  .select('*',{count:'exact',head:true}).eq('competition_id', comp.id)
entryCount===120 ? ok('the draw exists before anyone has signed up') : bad(`entries=${entryCount}`)

head('3. The organiser schedules a game between two names')
const { data: ents } = await admin.from('competition_entries').select('id, display_name')
  .eq('competition_id', comp.id).in('display_name',['Joga Bonito FC','Club 2 FC'])
const joga = ents.find(e=>e.display_name==='Joga Bonito FC')
const { error: e4 } = await magic.from('fixtures').insert({
  competition_id: comp.id, division:'U8s Championship', group_label:'A', round:'Round 1',
  home_entry_id: joga.id, away_entry_id: ents.find(e=>e.display_name!=='Joga Bonito FC').id,
  starts_at: new Date(Date.now()+30*864e5).toISOString(), duration_mins:40,
  venue_label:'Valentine Park', field_label:'Field 5' })
e4 ? bad(e4.message) : ok('fixture scheduled between two clubs that do not exist yet')

head('4. A club owner claims their invite')
const jogaInvite = invites.find(i=>i.club_name==='Joga Bonito FC')
const peek = await anon.rpc('peek_competition_invite', { p_token: jogaInvite.token })
peek.data?.[0]?.competition_name==='SPL Season 4'
  ? ok(`invite previewable without an account: "${peek.data[0].club_name}" in ${peek.data[0].competition_name}`)
  : bad('peek failed: '+JSON.stringify(peek.error ?? peek.data))

await userFor('owner@jogabonito.test','Joga Owner')
const joey = await sessionFor('owner@jogabonito.test')
const { data: jogaOrg } = await joey.rpc('create_academy', { p_name:'Joga Bonito FC', p_type:'academy' })
const { data: jogaTeam } = await joey.from('teams')
  .insert({ academy_id: jogaOrg, name:'U8s', age_group:'U8', season:'2027' }).select('id').single()
const { error: e5 } = await joey.rpc('claim_competition_invite', {
  p_token: jogaInvite.token, p_academy: jogaOrg, p_team: jogaTeam.id })
e5 ? bad(`claim: ${e5.message}`) : ok('claimed — their org is now in the competition')

head('5. What the club can and cannot see')
const { count: fx } = await joey.from('fixtures').select('*',{count:'exact',head:true}).eq('competition_id', comp.id)
fx===1 ? ok('sees the fixture scheduled before they joined') : bad(`fixtures visible=${fx}`)

const { data: theirEvents } = await admin.from('events').select('id, opponent').eq('academy_id', jogaOrg)
theirEvents?.length===1
  ? ok(`the fixture appeared in their own calendar (vs ${theirEvents[0].opponent})`)
  : bad(`events mirrored into their calendar: ${theirEvents?.length ?? 0} — expected 1`)

const { count: otherClubMembers } = await joey.from('academy_members')
  .select('*',{count:'exact',head:true}).eq('academy_id', magicOrg)
otherClubMembers===0 ? ok('cannot see the organiser’s members') : bad(`saw ${otherClubMembers}`)

// cleanup
for (const n of ['Magic Group','Joga Bonito FC']) await admin.from('academies').delete().eq('name', n)
for (const e of ['promoter@magicgroup.test','owner@jogabonito.test']) {
  const { data:{users} } = await admin.auth.admin.listUsers({perPage:200})
  const u = users.find(x=>x.email===e); if (u) await admin.auth.admin.deleteUser(u.id)
}
console.log(process.exitCode ? '\n\x1b[31mSOMETHING IS MISSING\x1b[0m\n' : '\n\x1b[32mORGANISER JOURNEY WORKS\x1b[0m\n')
