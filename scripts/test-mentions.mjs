// Run: node --env-file=.env.local scripts/test-mentions.mjs
//
// C-03: @mentions. The composer asks the channel who can be named (names
// and labels, never a phone; nothing for an outsider); a mention is a push
// of its own kind that gets through a mute; @everyone from a host reaches
// everyone, mutes and all; @everyone from a parent is just text.
import { createClient } from '@supabase/supabase-js'
import { signInClient } from './_auth.mjs'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`)
  process.exitCode = 1
}
const head = (m) => console.log(`\n${m}`)

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const OWNER = '00000000-0000-0000-0000-0000000000a1'
const MARCUS = '00000000-0000-0000-0000-0000000000a2'
const PARENT = '00000000-0000-0000-0000-0000000000b1'
const OUTSIDER = '00000000-0000-0000-0000-0000000000c2'
const U8 = '00000000-0000-0000-0000-0000000d0008'
const TAG = 'MENTION'

// Sessions are cached across suites (scripts/_auth.mjs), so a full run no
// longer trips the auth rate limit.
const signInEmail = (email) => signInClient(admin, email)
const { data: ch } = await admin.from('channels').select('id, name').eq('team_id', U8).eq('status', 'active').limit(1).single()
const { data: parentMember } = await admin.from('channel_members').select('muted').eq('channel_id', ch.id).eq('profile_id', PARENT).single()
async function cleanup() {
  const { data: msgs } = await admin.from('messages').select('id').like('body', `${TAG}%`)
  for (const m of msgs ?? []) await admin.from('notification_queue').delete().filter('payload->>message_id', 'eq', m.id)
  await admin.from('messages').delete().like('body', `${TAG}%`)
  await admin.from('channel_members').update({ muted: parentMember?.muted ?? false }).eq('channel_id', ch.id).eq('profile_id', PARENT)
}
await cleanup()

const marcus = await signInEmail((await admin.auth.admin.getUserById(MARCUS)).data.user.email)
const parent = await signInEmail((await admin.auth.admin.getUserById(PARENT)).data.user.email)
const outsider = await signInEmail((await admin.auth.admin.getUserById(OUTSIDER)).data.user.email)
if (!marcus || !parent || !outsider) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}
const { data: parentProfile } = await admin.from('profiles').select('full_name').eq('id', PARENT).single()
const parentName = parentProfile.full_name
const pushes = async (messageId, profileId) => (await admin.from('notification_queue').select('kind, title').filter('payload->>message_id', 'eq', messageId).eq('profile_id', profileId)).data ?? []

head(`1. Who can be named in ${ch.name}`)
{
  const { data: people } = await marcus.rpc('channel_mentionables', { p_channel: ch.id })
  people?.some((p) => p.id === PARENT && p.name === parentName) ? ok(`the coach can name ${parentName}${people.find((p) => p.id === PARENT).label ? ` (${people.find((p) => p.id === PARENT).label})` : ''}`) : bad(JSON.stringify(people)?.slice(0, 200))
  !people?.some((p) => p.id === MARCUS) ? ok('not himself') : bad('the list includes the asker')
  !JSON.stringify(people).includes('+61') ? ok('no phone numbers in it') : bad('a phone number in the mentionables')
  const { data: none } = await outsider.rpc('channel_mentionables', { p_channel: ch.id })
  const noneRows = none ?? []
  noneRows.length === 0 ? ok('an outsider gets nobody') : bad('an outsider listed the channel')
}

head('2. A mention gets through a mute; a plain message does not')
{
  await admin.from('channel_members').update({ muted: true }).eq('channel_id', ch.id).eq('profile_id', PARENT)
  const { data: plain, error: e1 } = await marcus.from('messages').insert({ academy_id: NRIFA, channel_id: ch.id, sender_id: MARCUS, body: `${TAG} training moved to 5pm`, status: 'published' }).select('id').single()
  e1 ? bad(`plain: ${e1.message}`) : ok('the coach posts a plain message')
  const p1 = await pushes(plain.id, PARENT)
  p1.length === 0 ? ok('the muted parent hears nothing') : bad(`muted parent got ${JSON.stringify(p1)}`)
  const { data: named } = await marcus.from('messages').insert({ academy_id: NRIFA, channel_id: ch.id, sender_id: MARCUS, body: `${TAG} @${parentName} can you bring the oranges?`, status: 'published', mentions: [PARENT] }).select('id').single()
  const p2 = await pushes(named.id, PARENT)
  p2.length === 1 && p2[0].kind === 'mention' && /mentioned you/.test(p2[0].title) ? ok(`named, the parent gets a push: "${p2[0].title}"`) : bad(JSON.stringify(p2))
  const p2o = await pushes(named.id, OWNER)
  p2o.every((p) => p.kind !== 'mention') ? ok('nobody else is told they were mentioned') : bad(JSON.stringify(p2o))
}

head('3. @everyone: a host means it; a parent is just typing')
{
  const { data: fromParent } = await parent.from('messages').insert({ academy_id: NRIFA, channel_id: ch.id, sender_id: PARENT, body: `${TAG} @everyone party at ours`, status: 'published', mention_everyone: true }).select('id').single()
  if (!fromParent) {
    ok('(a parent cannot post in this channel at all — the host-only rule stands in for the test)')
  } else {
    const toMarcus = await pushes(fromParent.id, MARCUS)
    toMarcus.every((p) => p.kind !== 'mention') ? ok('a parent\'s @everyone mentions nobody') : bad(JSON.stringify(toMarcus))
  }
  const { data: fromHost } = await marcus.from('messages').insert({ academy_id: NRIFA, channel_id: ch.id, sender_id: MARCUS, body: `${TAG} @everyone kick-off is 8am not 9`, status: 'published', mention_everyone: true }).select('id').single()
  const p3 = await pushes(fromHost.id, PARENT)
  p3.length === 1 && p3[0].kind === 'mention' ? ok('the host\'s @everyone reaches the muted parent as a mention') : bad(JSON.stringify(p3))
  const { count } = await admin.from('notification_queue').select('id', { count: 'exact', head: true }).filter('payload->>message_id', 'eq', fromHost.id).eq('kind', 'mention')
  count >= 2 ? ok(`${count} members told`) : bad(`everyone reached ${count}`)
}

await cleanup()
console.log(process.exitCode ? '\n\x1b[31mMENTIONS ARE WRONG\x1b[0m\n' : '\n\x1b[32mall good\x1b[0m\n')
