// Run: node --env-file=.env.local scripts/test-minor-dms.mjs
// Proves 0076: a child is never alone in a private chat with an adult.
import { createClient } from '@supabase/supabase-js'
const URL=process.env.NEXT_PUBLIC_SUPABASE_URL, PUB=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const admin=createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}})
const anon =createClient(URL, PUB,{auth:{persistSession:false}})
const ok=m=>console.log(`  \x1b[32m✓\x1b[0m ${m}`), bad=m=>{console.log(`  \x1b[31m✗\x1b[0m ${m}`);process.exitCode=1}
const head=m=>console.log(`\n${m}`)
const NRIFA='00000000-0000-0000-0000-0000000a0001'
const U8='00000000-0000-0000-0000-0000000d0008'
const TAG='minor-dm-test'

async function sess(email){
  const { data:l } = await admin.auth.admin.generateLink({type:'magiclink', email})
  const { data:s } = await anon.auth.verifyOtp({token_hash:l.properties.hashed_token, type:'email'})
  return { client: createClient(URL, PUB, {auth:{persistSession:false},
    global:{headers:{Authorization:`Bearer ${s.session.access_token}`}}}), id: s.user.id }
}

// A player account, linked to a players row, optionally with a guardian.
async function makePlayer(email, name, dob, guardianId){
  const { data:u } = await admin.auth.admin.createUser({ email, email_confirm:true })
  const id = u.user.id
  await admin.from('profiles').update({ full_name: name }).eq('id', id)
  await admin.from('academy_members').upsert({ academy_id:NRIFA, profile_id:id, role:'player', status:'active' },
    { onConflict:'academy_id,profile_id' })
  const { data:pl } = await admin.from('players')
    .insert({ academy_id:NRIFA, team_id:U8, profile_id:id, full_name:name, dob, notes:TAG }).select('id').single()
  if (guardianId) await admin.from('player_guardians')
    .insert({ academy_id:NRIFA, player_id:pl.id, profile_id:guardianId, relationship:'parent', is_primary:true })
  return id
}

async function cleanup(){
  const { data:pls } = await admin.from('players').select('profile_id').eq('notes', TAG)
  for (const p of pls ?? []) if (p.profile_id) await admin.auth.admin.deleteUser(p.profile_id)
  await admin.from('players').delete().eq('notes', TAG)
  await admin.from('channels').delete().like('name', `${TAG}%`)
}

const members = async (channel) =>
  (await admin.from('channel_members').select('profile_id').eq('channel_id', channel)).data.map(r => r.profile_id)

await cleanup()
const coach = await sess('joeylameri@outlook.com')            // owner
const sam   = await sess('p61400000011@squadroom.invalid')    // parent
const kid      = await makePlayer(`${TAG}-kid@squadroom.invalid`,      'Test Kid',      '2017-03-01', sam.id)
const orphan   = await makePlayer(`${TAG}-orphan@squadroom.invalid`,   'Test Orphan',   '2017-03-01', null)
const adultPl  = await makePlayer(`${TAG}-adult@squadroom.invalid`,    'Test Adult',    '2006-01-01', null)

head('1. A coach opening a DM with a child brings the child\'s parent in')
const { data:dm, error:e1 } = await coach.client.rpc('open_direct_channel', { p_academy:NRIFA, p_other:kid })
if (e1) bad(e1.message)
else {
  const m = await members(dm)
  m.includes(sam.id) ? ok('parent was added to the chat') : bad('coach and child are alone')
  const { data:c } = await admin.from('channels').select('name').eq('id', dm).single()
  c.name === 'Test Kid + parents' ? ok(`named "${c.name}"`) : bad(`named "${c.name}"`)
}

head('2. A child with no guardian on file cannot be messaged privately')
const { error:e2 } = await coach.client.rpc('open_direct_channel', { p_academy:NRIFA, p_other:orphan })
e2 ? ok(`refused: ${e2.message.slice(0, 60)}…`) : bad('one-to-one chat with an unguarded child was created')

head('3. A custom chat with a child also brings the parent in')
const { data:custom, error:e3 } = await coach.client.rpc('create_channel',
  { p_academy:NRIFA, p_name:`${TAG} 1:1`, p_members:[kid] })
if (e3) bad(e3.message)
else (await members(custom)).includes(sam.id) ? ok('parent added to the custom chat') : bad('no parent in the custom chat')

head('4. When the parent leaves, the child leaves too')
if (custom) {
  await sam.client.from('channel_members').delete().eq('channel_id', custom).eq('profile_id', sam.id)
  const m = await members(custom)
  !m.includes(kid) ? ok('child removed with their last guardian') : bad('child left alone with the coach')
}

head('5. An adult player gets an ordinary DM')
const { data:dm5, error:e5 } = await coach.client.rpc('open_direct_channel', { p_academy:NRIFA, p_other:adultPl })
e5 ? bad(e5.message) : ((await members(dm5)).length === 2 ? ok('two people, no guardians added') : bad('extra members added'))

head('6. Team channels are untouched')
const { data:team } = await admin.from('channels').select('id').eq('team_id', U8).eq('type','team').single()
const before = (await members(team.id)).length
await admin.from('channel_members').insert({ academy_id:NRIFA, channel_id:team.id, profile_id:orphan, role:'member' })
;(await members(team.id)).length === before + 1 ? ok('a child joins the team channel without a fuss') : bad('team channel changed unexpectedly')

for (const id of [dm, dm5].filter(Boolean)) await admin.from('channels').delete().eq('id', id)
await cleanup()
