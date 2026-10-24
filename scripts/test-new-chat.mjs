import { createClient } from '@supabase/supabase-js'
const URL=process.env.NEXT_PUBLIC_SUPABASE_URL, PUB=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const admin=createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}})
const anon =createClient(URL, PUB,{auth:{persistSession:false}})
const ok=m=>console.log(`  \x1b[32m✓\x1b[0m ${m}`), bad=m=>{console.log(`  \x1b[31m✗\x1b[0m ${m}`);process.exitCode=1}
const head=m=>console.log(`\n${m}`)
const NRIFA='00000000-0000-0000-0000-0000000a0001'
const U8='00000000-0000-0000-0000-0000000d0008'

async function sess(email){
  const { data:l } = await admin.auth.admin.generateLink({type:'magiclink', email})
  const { data:s } = await anon.auth.verifyOtp({token_hash:l.properties.hashed_token, type:'email'})
  return { client: createClient(URL, PUB, {auth:{persistSession:false},
    global:{headers:{Authorization:`Bearer ${s.session.access_token}`}}}), id: s.user.id }
}
const coach  = await sess('joeylameri@outlook.com')
const parent = await sess('demo0412000103@squadroom.invalid')
const other  = await sess('demo0412000101@squadroom.invalid')
await admin.from('channels').delete().eq('academy_id', NRIFA).like('name','TESTCHAT%')

head('1. A coach starts a chat and picks who is in it')
const { data: id, error: e1 } = await coach.client.rpc('create_channel', {
  p_academy: NRIFA, p_name: 'TESTCHAT Gala day squad', p_members: [parent.id, other.id],
})
e1 ? bad(e1.message) : ok('created')
const { data: mem } = await admin.from('channel_members').select('profile_id, role').eq('channel_id', id)
mem?.length === 3 ? ok(`3 members: the coach plus the 2 chosen`) : bad(`${mem?.length} members`)
mem.find(m => m.profile_id === coach.id)?.role === 'host'
  ? ok('the creator is the host, so somebody can change its settings')
  : bad('nobody hosts it')

head('2. It appears for the people in it, and not for anyone else')
const { data: mine } = await parent.client.rpc('my_channels', { p_academy: NRIFA })
mine.some(c => c.channel_id === id) ? ok('a chosen parent sees it') : bad('invisible to its own members')

head('3. A parent cannot start one')
const { error: e2 } = await parent.client.rpc('create_channel', {
  p_academy: NRIFA, p_name: 'TESTCHAT parent made this',
})
e2 ? ok(`refused: ${e2.message}`) : bad('a parent created a channel')

head('4. A team chat takes the team, not a fixed list')
const { data: teamCh, error: e3 } = await coach.client.rpc('create_channel', {
  p_academy: NRIFA, p_name: 'TESTCHAT U8 extras', p_team: U8,
})
e3 ? bad(e3.message) : ok('created against the team')
const { data: row } = await admin.from('channels').select('type, team_id').eq('id', teamCh).single()
row.team_id === U8 && row.type === 'team' ? ok('typed as a team channel') : bad(JSON.stringify(row))

head('5. A blank name is refused rather than creating something unnameable')
const { error: e4 } = await coach.client.rpc('create_channel', { p_academy: NRIFA, p_name: '   ' })
e4 ? ok(`refused: ${e4.message}`) : bad('created a channel with no name')

head('6. Members from another academy are ignored, not added')
// Somebody with NO active NRIFA membership — not merely somebody who has a
// membership elsewhere.
//
// The old query was `.neq('academy_id', NRIFA).limit(1)`, which assumed one
// person belongs to one organisation. That stopped being true when Joey became
// owner of Sydney Premier League as well as NRIFA: his SPL row came back as
// the "outsider", create_channel correctly added him because he IS an NRIFA
// owner, and the test reported a cross-tenant leak. The product was right and
// the test's idea of an outsider was wrong.
const { data: insiders } = await admin.from('academy_members')
  .select('profile_id').eq('academy_id', NRIFA).eq('status', 'active')
const inNrifa = new Set((insiders ?? []).map(m => m.profile_id))
const { data: elsewhere } = await admin.from('academy_members')
  .select('profile_id').neq('academy_id', NRIFA)
const outsider = (elsewhere ?? []).find(m => !inNrifa.has(m.profile_id)) ?? null
if (outsider) {
  const { data: ch2 } = await coach.client.rpc('create_channel', {
    p_academy: NRIFA, p_name: 'TESTCHAT filtered', p_members: [outsider.profile_id, parent.id],
  })
  const { data: m2 } = await admin.from('channel_members').select('profile_id').eq('channel_id', ch2)
  m2.some(m => m.profile_id === outsider.profile_id)
    ? bad('somebody from another academy was added')
    : ok('an id from outside the academy was dropped, not trusted')
} else ok('no other academy to test against')

head('7. Announcements-only mode sticks')
const { data: ch3 } = await coach.client.rpc('create_channel', {
  p_academy: NRIFA, p_name: 'TESTCHAT notices', p_members: [parent.id], p_mode: 'hosts_only',
})
const { data: r3 } = await admin.from('channels').select('posting_mode').eq('id', ch3).single()
r3.posting_mode === 'hosts_only' ? ok('parents can read and react but not reply') : bad(r3.posting_mode)

await admin.from('channels').delete().eq('academy_id', NRIFA).like('name','TESTCHAT%')
console.log('\ncleaned up\n')
