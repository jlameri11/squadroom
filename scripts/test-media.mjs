// Run: node --env-file=.env.local scripts/test-media.mjs
//
// C-05: voice notes and short video live in the same private bucket as
// photos, under the same path rule. A member of the channel can post one and
// hear it; somebody from another club cannot fetch it; a file type the
// product has no use for is refused; the chat list and the push say "voice
// note" and "video", not "photo".
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
const MARCUS = '00000000-0000-0000-0000-0000000000a2'
const PARENT = '00000000-0000-0000-0000-0000000000b1'
const RAVENS_OWNER = '00000000-0000-0000-0000-0000000000c1'
const U8 = '00000000-0000-0000-0000-0000000d0008'
const PREFIX = 'media-test-'

// Sessions are cached across suites (scripts/_auth.mjs), so a full run no
// longer trips the auth rate limit.
const signInEmail = (email) => signInClient(admin, email)
const { data: ch } = await admin.from('channels').select('id, name').eq('team_id', U8).eq('status', 'active').limit(1).single()
const folder = `${NRIFA}/${ch.id}/${PARENT}`
const made = []
async function cleanup() {
  const { data: files } = await admin.storage.from('attachments').list(folder)
  const mine = (files ?? []).filter((f) => f.name.startsWith(PREFIX)).map((f) => `${folder}/${f.name}`)
  if (mine.length) await admin.storage.from('attachments').remove(mine)
  const { data: msgs } = await admin.from('messages').select('id, attachments').eq('channel_id', ch.id).is('body', null)
  const stale = (msgs ?? []).filter((m) => JSON.stringify(m.attachments ?? []).includes(PREFIX)).map((m) => m.id)
  for (const id of [...stale, ...made]) {
    await admin.from('notification_queue').delete().filter('payload->>message_id', 'eq', id)
    await admin.from('messages').delete().eq('id', id)
  }
}
await cleanup()

const parent = await signInEmail((await admin.auth.admin.getUserById(PARENT)).data.user.email)
const marcus = await signInEmail((await admin.auth.admin.getUserById(MARCUS)).data.user.email)
const outsider = await signInEmail((await admin.auth.admin.getUserById(RAVENS_OWNER)).data.user.email)
if (!parent || !marcus || !outsider) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}
await admin.from('user_settings').update({ digest_minutes: 0 }).eq('profile_id', MARCUS)
await admin.from('channel_members').update({ muted: false }).eq('channel_id', ch.id).eq('profile_id', MARCUS)

head('1. The bucket')
{
  const { data: b } = await admin.storage.getBucket('attachments')
  b?.public === false ? ok('still private') : bad('the bucket is public')
  b?.allowed_mime_types?.includes('audio/mp4') && b?.allowed_mime_types?.includes('video/mp4') && b?.allowed_mime_types?.includes('audio/webm') ? ok('accepts a Safari voice note, a Chrome one and a phone video') : bad(JSON.stringify(b?.allowed_mime_types))
  b?.file_size_limit === 26214400 ? ok('25 MB ceiling, about thirty seconds of video') : bad(`limit ${b?.file_size_limit}`)
}

head('2. Who may put one there, and who may fetch it')
const bytes = new Uint8Array(4096).map((_, i) => i % 251)
const audioPath = `${folder}/${PREFIX}${crypto.randomUUID()}.webm`
const videoPath = `${folder}/${PREFIX}${crypto.randomUUID()}.mp4`
{
  const { error: e1 } = await parent.storage.from('attachments').upload(audioPath, bytes, { contentType: 'audio/webm' })
  e1 ? bad(`voice note: ${e1.message}`) : ok('a parent in the channel uploads a voice note')
  const { error: e2 } = await parent.storage.from('attachments').upload(videoPath, bytes, { contentType: 'video/mp4' })
  e2 ? bad(`video: ${e2.message}`) : ok('and a video')
  const { error: e3 } = await parent.storage.from('attachments').upload(`${folder}/${PREFIX}${crypto.randomUUID()}.txt`, bytes, { contentType: 'text/plain' })
  e3 ? ok('a text file is refused by the bucket') : bad('a text file went up')
  const { error: e4 } = await parent.storage.from('attachments').upload(`${NRIFA}/${ch.id}/${MARCUS}/${PREFIX}${crypto.randomUUID()}.webm`, bytes, { contentType: 'audio/webm' })
  e4 ? ok('nobody uploads under another person\'s name') : bad('a parent wrote into the coach\'s folder')
  const { data: s1, error: s1e } = await parent.storage.from('attachments').createSignedUrl(audioPath, 60)
  s1?.signedUrl && !s1e ? ok('the parent gets a playable link') : bad(`own link: ${s1e?.message}`)
  const { data: s2, error: s2e } = await outsider.storage.from('attachments').createSignedUrl(audioPath, 60)
  !s2?.signedUrl || s2e ? ok('another club\'s owner cannot get a link to it') : bad('an outsider signed a URL for a voice note')
  const { data: d, error: de } = await outsider.storage.from('attachments').download(audioPath)
  !d || de ? ok('nor download it') : bad('an outsider downloaded it')
}

head('3. What the list and the push say')
{
  const { data: m1, error: e1 } = await parent.from('messages').insert({ academy_id: NRIFA, channel_id: ch.id, sender_id: PARENT, body: null, attachments: [{ path: audioPath, mime: 'audio/webm', size: 4096, width: 0, height: 0, name: 'voice-note.webm', duration: 7.2 }] }).select('id').single()
  if (e1) bad(`post: ${e1.message}`)
  else {
    made.push(m1.id)
    ok('a voice-note-only message posts')
    const { data: q } = await admin.from('notification_queue').select('body').filter('payload->>message_id', 'eq', m1.id).eq('profile_id', MARCUS).maybeSingle()
    const said = q?.body ?? ''
    said.endsWith('sent a voice note') ? ok(`the coach's push says "${said}"`) : bad(`push body: ${said}`)
    const { data: list } = await marcus.rpc('my_channels', { p_academy: NRIFA })
    const row = list?.find((c) => c.channel_id === ch.id)
    row?.last_message_body === '🎙 Voice note' ? ok('the chat list says "🎙 Voice note"') : bad(`list says: ${row?.last_message_body}`)
  }
  const { data: m2 } = await parent.from('messages').insert({ academy_id: NRIFA, channel_id: ch.id, sender_id: PARENT, body: null, attachments: [{ path: videoPath, mime: 'video/mp4', size: 4096, width: 1920, height: 1080, name: 'goal.mp4', duration: 12 }] }).select('id').single()
  if (m2) {
    made.push(m2.id)
    const { data: q } = await admin.from('notification_queue').select('body').filter('payload->>message_id', 'eq', m2.id).eq('profile_id', MARCUS).maybeSingle()
    const said = q?.body ?? ''
    said.endsWith('sent a video') ? ok(`and for the clip, "${said}"`) : bad(`push body: ${said}`)
    const { data: list } = await marcus.rpc('my_channels', { p_academy: NRIFA })
    const row = list?.find((c) => c.channel_id === ch.id)
    row?.last_message_body === '🎬 Video' ? ok('the chat list says "🎬 Video"') : bad(`list says: ${row?.last_message_body}`)
    const { data: feed } = await marcus.rpc('channel_messages', { p_channel: ch.id, p_limit: 5 })
    const mine = feed?.find((m) => m.id === m2.id)
    mine?.attachments?.[0]?.duration === 12 ? ok('the feed carries the duration for the player') : bad(JSON.stringify(mine?.attachments))
  }
}

await cleanup()
console.log(process.exitCode ? '\n\x1b[31mMEDIA IS WRONG\x1b[0m\n' : '\n\x1b[32mall good\x1b[0m\n')
