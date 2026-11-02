// Run: node --env-file=.env.local scripts/test-threads.mjs
//
// C-06: replies under an announcement are a thread. They notify the
// announcement's author and the people already in the thread — never the
// whole channel; the feed counts them on the announcement and marks each
// reply so the screen can fold it. A reply to an ordinary message is
// unchanged. A mention inside a thread still reaches whoever it names.
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
const U8 = '00000000-0000-0000-0000-0000000d0008'
const TAG = 'THREAD'

// Sessions are cached across suites (scripts/_auth.mjs), so a full run no
// longer trips the auth rate limit.
const signInEmail = (email) => signInClient(admin, email)
const { data: ch } = await admin.from('channels').select('id, name, posting_mode').eq('team_id', U8).eq('status', 'active').limit(1).single()
const { data: members } = await admin.from('channel_members').select('profile_id').eq('channel_id', ch.id)
const memberCount = members.length
async function cleanup() {
  const { data: msgs } = await admin.from('messages').select('id').like('body', `${TAG}%`)
  for (const m of msgs ?? []) await admin.from('notification_queue').delete().filter('payload->>message_id', 'eq', m.id)
  await admin.from('messages').delete().like('body', `${TAG}%`)
}
await cleanup()

const marcus = await signInEmail((await admin.auth.admin.getUserById(MARCUS)).data.user.email)
const parent = await signInEmail((await admin.auth.admin.getUserById(PARENT)).data.user.email)
if (!marcus || !parent) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}
// Digests off and everyone unmuted for a clean count.
await admin.from('user_settings').update({ digest_minutes: 0 }).in('profile_id', members.map((m) => m.profile_id))
const recipients = async (id) => (await admin.from('notification_queue').select('profile_id').filter('payload->>message_id', 'eq', id)).data?.map((r) => r.profile_id) ?? []

head('1. The announcement reaches the channel; replies reach the thread')
let ann
{
  const { data: a } = await marcus.from('messages').insert({ academy_id: NRIFA, channel_id: ch.id, sender_id: MARCUS, body: `${TAG} Saturday: meet 8:15 at Nolan Reserve, white socks`, status: 'published', is_announcement: true }).select('id').single()
  ann = a.id
  const r0 = await recipients(ann)
  r0.length >= memberCount - 2 ? ok(`the announcement goes to ${r0.length} members`) : bad(`announcement reached ${r0.length} of ${memberCount}`)
  const { data: rep1, error } = await parent.from('messages').insert({ academy_id: NRIFA, channel_id: ch.id, sender_id: PARENT, body: `${TAG} thanks, we'll be there`, status: 'published', reply_to_id: ann }).select('id').single()
  error ? bad(`reply: ${error.message}`) : ok('a parent replies under it')
  const r1 = await recipients(rep1.id)
  r1.length === 1 && r1[0] === MARCUS ? ok('only the coach (the author) is told — not the other forty families') : bad(`reply reached ${r1.length}: ${JSON.stringify(r1)}`)
  const { data: rep2 } = await marcus.from('messages').insert({ academy_id: NRIFA, channel_id: ch.id, sender_id: MARCUS, body: `${TAG} great`, status: 'published', reply_to_id: ann }).select('id').single()
  const r2 = await recipients(rep2.id)
  r2.length === 1 && r2[0] === PARENT ? ok('the coach\'s reply reaches the one parent in the thread') : bad(`coach reply reached ${JSON.stringify(r2)}`)
  const { data: rep3 } = await admin.from('messages').insert({ academy_id: NRIFA, channel_id: ch.id, sender_id: OWNER, body: `${TAG} same here`, status: 'published', reply_to_id: ann }).select('id').single()
  const r3 = await recipients(rep3.id)
  r3.length === 2 && r3.includes(MARCUS) && r3.includes(PARENT) ? ok('a third person\'s reply reaches the two already in the thread') : bad(`third reply reached ${JSON.stringify(r3)}`)
  const { data: rep4 } = await admin.from('messages').insert({ academy_id: NRIFA, channel_id: ch.id, sender_id: OWNER, body: `${TAG} @Marcus Obi one more thing`, status: 'published', reply_to_id: ann, mentions: [MARCUS] }).select('id').single()
  const kinds = (await admin.from('notification_queue').select('profile_id, kind').filter('payload->>message_id', 'eq', rep4.id)).data ?? []
  kinds.find((k) => k.profile_id === MARCUS)?.kind === 'mention' ? ok('a mention inside the thread is still a mention') : bad(JSON.stringify(kinds))
}

head('2. The feed folds them')
{
  const { data: feed } = await parent.rpc('channel_messages', { p_channel: ch.id, p_limit: 50 })
  const a = feed.find((m) => m.id === ann)
  a?.reply_count === 4 ? ok('the announcement carries reply_count 4') : bad(`reply_count: ${a?.reply_count}`)
  const replies = feed.filter((m) => m.reply_to_id === ann)
  replies.length === 4 && replies.every((m) => m.reply_to_announcement) ? ok('each reply is marked as a reply to an announcement, for the screen to fold') : bad(JSON.stringify(replies.map((m) => m.reply_to_announcement)))
  const { data: plain } = await marcus.from('messages').insert({ academy_id: NRIFA, channel_id: ch.id, sender_id: MARCUS, body: `${TAG} who has the balls?`, status: 'published' }).select('id').single()
  const { data: rp } = await parent.from('messages').insert({ academy_id: NRIFA, channel_id: ch.id, sender_id: PARENT, body: `${TAG} I do`, status: 'published', reply_to_id: plain.id }).select('id').single()
  const r = await recipients(rp.id)
  r.length >= memberCount - 2 ? ok(`a reply to an ordinary message still reaches the channel (${r.length})`) : bad(`plain reply reached ${r.length}`)
  const { data: feed2 } = await parent.rpc('channel_messages', { p_channel: ch.id, p_limit: 50 })
  feed2.find((m) => m.id === rp.id)?.reply_to_announcement === false ? ok('and is not marked for folding') : bad('a plain reply marked as a thread')
}

await cleanup()
console.log(process.exitCode ? '\n\x1b[31mTHREADS ARE WRONG\x1b[0m\n' : '\n\x1b[32mall good\x1b[0m\n')
