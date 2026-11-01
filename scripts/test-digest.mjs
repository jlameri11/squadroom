// Run: node --env-file=.env.local scripts/test-digest.mjs
//
// C-07: grouped pushes. With a digest on, three ordinary messages in a
// channel are ONE queued push — "3 new messages in U8 SPL" — timed for the
// end of the window; a mention and an announcement still go at once, on
// their own; with it off, each message is its own push.
import { createClient } from '@supabase/supabase-js'

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
const MARCUS = '00000000-0000-0000-0000-0000000000a2'
const PARENT = '00000000-0000-0000-0000-0000000000b1'
const U8 = '00000000-0000-0000-0000-0000000d0008'
const TAG = 'DIGEST'

async function signInEmail(email) {
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (!link?.properties?.hashed_token) return null
  const client = createClient(URL_, PUB, { auth: { persistSession: false } })
  const { data } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
  return data?.session ? client : null
}
const { data: ch } = await admin.from('channels').select('id, name').eq('team_id', U8).eq('status', 'active').limit(1).single()
const { data: before } = await admin.from('user_settings').select('digest_minutes, quiet_hours_enabled').eq('profile_id', PARENT).maybeSingle()
async function cleanup() {
  const { data: msgs } = await admin.from('messages').select('id').like('body', `${TAG}%`)
  for (const m of msgs ?? []) await admin.from('notification_queue').delete().filter('payload->>message_id', 'eq', m.id)
  await admin.from('notification_queue').delete().like('dedupe_key', `digest:${ch.id}:${PARENT}:%`)
  await admin.from('messages').delete().like('body', `${TAG}%`)
  await admin.from('user_settings').update({ digest_minutes: before?.digest_minutes ?? 0, quiet_hours_enabled: before?.quiet_hours_enabled ?? true }).eq('profile_id', PARENT)
}
await cleanup()

const marcus = await signInEmail((await admin.auth.admin.getUserById(MARCUS)).data.user.email)
const parent = await signInEmail((await admin.auth.admin.getUserById(PARENT)).data.user.email)
if (!marcus || !parent) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}
// Quiet hours off for the test, so the timing assertion is about the window.
await admin.from('user_settings').update({ quiet_hours_enabled: false }).eq('profile_id', PARENT)
await admin.from('channel_members').update({ muted: false }).eq('channel_id', ch.id).eq('profile_id', PARENT)
const post = (body, extra = {}) => marcus.from('messages').insert({ academy_id: NRIFA, channel_id: ch.id, sender_id: MARCUS, body, status: 'published', ...extra }).select('id').single()
const parentPushes = async () => (await admin.from('notification_queue').select('kind, body, scheduled_for, dedupe_key, payload').eq('profile_id', PARENT).or(`dedupe_key.like.digest:${ch.id}:${PARENT}:%,payload->>message_id.in.(${(await admin.from('messages').select('id').like('body', `${TAG}%`)).data.map((m) => m.id).join(',') || '00000000-0000-0000-0000-000000000000'})`)).data ?? []

head('1. Off: one push per message')
{
  const { error: badV } = await parent.rpc('set_digest_minutes', { p_minutes: 7 })
  badV ? ok('7 minutes is not an option') : bad('an odd window was saved')
  await parent.rpc('set_digest_minutes', { p_minutes: 0 })
  await post(`${TAG} one`)
  await post(`${TAG} two`)
  const p = await parentPushes()
  p.length === 2 && p.every((x) => x.kind === 'message') ? ok('two messages, two pushes') : bad(JSON.stringify(p.map((x) => x.body)))
}

head('2. On: three messages, one push, at the end of the window')
{
  await cleanup()
  await admin.from('user_settings').update({ quiet_hours_enabled: false }).eq('profile_id', PARENT)
  const { error } = await parent.rpc('set_digest_minutes', { p_minutes: 30 })
  error ? bad(`set: ${error.message}`) : ok('the parent groups messages every 30 minutes')
  const { data: mine } = await parent.rpc('my_digest_minutes')
  mine === 30 ? ok('and the setting reads back') : bad(`reads ${mine}`)
  await post(`${TAG} one`)
  await post(`${TAG} two`)
  await post(`${TAG} three`)
  const p = await parentPushes()
  const digest = p.filter((x) => x.dedupe_key.startsWith('digest:'))
  digest.length === 1 ? ok('one queued push for the three') : bad(`${digest.length} digest rows, ${p.length} rows in all`)
  digest[0]?.body === `3 new messages in ${ch.name}` ? ok(`it says "${digest[0].body}"`) : bad(`body: ${digest[0]?.body}`)
  const lead = new Date(digest[0]?.scheduled_for).getTime() - Date.now()
  lead > 0 && lead <= 30 * 60_000 ? ok(`timed ${Math.round(lead / 60000)} min from now, the end of the window`) : bad(`lead ${Math.round(lead / 60000)} min`)
  p.filter((x) => !x.dedupe_key.startsWith('digest:')).length === 0 ? ok('and no per-message pushes') : bad('per-message pushes alongside the digest')
}

head('3. Urgent things are never grouped')
{
  await post(`${TAG} @everyone kick-off moved to 8`, { mention_everyone: true })
  await post(`${TAG} announcement: presentation night`, { is_announcement: true })
  const p = await parentPushes()
  const urgent = p.filter((x) => !x.dedupe_key.startsWith('digest:'))
  urgent.length === 2 && urgent.some((x) => x.kind === 'mention') && urgent.some((x) => x.kind === 'announcement') ? ok('the mention and the announcement are their own pushes') : bad(JSON.stringify(urgent.map((x) => [x.kind, x.body])))
  urgent.every((x) => new Date(x.scheduled_for).getTime() <= Date.now() + 5000) ? ok('both timed now') : bad('an urgent push was delayed')
  const digest = p.find((x) => x.dedupe_key.startsWith('digest:'))
  digest?.body === `3 new messages in ${ch.name}` ? ok('the digest still counts only the ordinary three') : bad(`digest body: ${digest?.body}`)
}

await cleanup()
console.log(process.exitCode ? '\n\x1b[31mTHE DIGEST IS WRONG\x1b[0m\n' : '\n\x1b[32mall good\x1b[0m\n')
