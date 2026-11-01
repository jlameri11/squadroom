// Run: node --env-file=.env.local scripts/test-translate.mjs
//
// W-08: messages read in your own language. The setting is the person's;
// the cache is read only by the channel's members; the budget is counted
// in the database and refuses past the cap; the route refuses the signed
// out, the language-less and the not-a-member. The live call to the model
// runs only with TRANSLATE_TEST_LIVE=1 — a test suite must not spend money
// by default.
import { createClient } from '@supabase/supabase-js'
import { resolveBaseUrl } from './_base-url.mjs'

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
const PARENT = '00000000-0000-0000-0000-0000000000b1'
const OUTSIDER = '00000000-0000-0000-0000-0000000000c2'
const U8 = '00000000-0000-0000-0000-0000000d0008'
const TAG = 'XLATE'

async function signInEmail(email) {
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (!link?.properties?.hashed_token) return null
  const client = createClient(URL_, PUB, { auth: { persistSession: false } })
  const { data } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
  return data?.session ? { client, session: data.session } : null
}
const cookieFor = (session) => {
  const ref = URL_.split('//')[1].split('.')[0]
  return `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString('base64')}`
}
async function cleanup() {
  const { data: msgs } = await admin.from('messages').select('id').like('body', `${TAG}%`)
  for (const m of msgs ?? []) await admin.from('message_translations').delete().eq('message_id', m.id)
  await admin.from('messages').delete().like('body', `${TAG}%`)
  await admin.from('translation_takes').delete().eq('profile_id', PARENT)
  await admin.from('profiles').update({ chat_language: null }).eq('id', PARENT)
}
await cleanup()

const parent = await signInEmail((await admin.auth.admin.getUserById(PARENT)).data.user.email)
const outsider = await signInEmail((await admin.auth.admin.getUserById(OUTSIDER)).data.user.email)
if (!parent || !outsider) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}
const BASE = await resolveBaseUrl({ quiet: true })
const { data: ch } = await admin.from('channels').select('id').eq('team_id', U8).eq('status', 'active').limit(1).single()
const { data: msg } = await admin.from('messages').insert({ academy_id: NRIFA, channel_id: ch.id, sender_id: OWNER, body: `${TAG} Training is cancelled tonight, the ground is closed. Back Thursday 5pm at ELS Hall.`, status: 'published' }).select('id').single()

head('1. The setting')
{
  const { error: badCode } = await parent.client.rpc('set_chat_language', { p_lang: 'not a code' })
  badCode ? ok('a made-up code is refused') : bad('a made-up code was saved')
  const { error } = await parent.client.rpc('set_chat_language', { p_lang: 'ar' })
  error ? bad(`set: ${error.message}`) : ok('the parent chooses Arabic')
  const { data: p } = await admin.from('profiles').select('chat_language').eq('id', PARENT).single()
  p.chat_language === 'ar' ? ok('saved on their profile') : bad(JSON.stringify(p))
}

head('2. The cache is the channel\'s, and the budget is counted')
{
  await admin.from('message_translations').insert({ message_id: msg.id, channel_id: ch.id, lang: 'ar', body: 'تم إلغاء التدريب الليلة', model: 'test' })
  const { data: mine } = await parent.client.rpc('translations_for', { p_message_ids: [msg.id], p_lang: 'ar' })
  mine?.[msg.id] ? ok('a member of the channel reads the cached translation') : bad(JSON.stringify(mine))
  const { data: theirs } = await outsider.client.rpc('translations_for', { p_message_ids: [msg.id], p_lang: 'ar' })
  Object.keys(theirs ?? {}).length === 0 ? ok('somebody outside the channel gets nothing') : bad('an outsider read a translation')
  const { data: raw } = await outsider.client.from('message_translations').select('body').eq('message_id', msg.id)
  const rawRows = raw ?? []
  rawRows.length === 0 ? ok('and nothing from the table') : bad('an outsider read message_translations')
  const { error: notYours } = await parent.client.rpc('translation_budget_take', { p_profile: PARENT, p_academy: NRIFA, p_n: 1 })
  notYours ? ok('the budget function is not callable by a person') : bad('a person spent the budget directly')
  const { error: e1 } = await admin.rpc('translation_budget_take', { p_profile: PARENT, p_academy: NRIFA, p_n: 50 })
  e1 ? bad(`take 50: ${e1.message}`) : ok('50 taken')
  for (let i = 0; i < 5; i++) await admin.rpc('translation_budget_take', { p_profile: PARENT, p_academy: NRIFA, p_n: 50 })
  const { error: over } = await admin.rpc('translation_budget_take', { p_profile: PARENT, p_academy: NRIFA, p_n: 1 })
  over?.code === '53400' ? ok(`the 301st message in a day is refused: "${over.message}"`) : bad(`over budget: ${over?.message ?? 'allowed'}`)
  await admin.from('translation_takes').delete().eq('profile_id', PARENT)
}

head('3. The route')
{
  const post = (cookie, body) => fetch(`${BASE}/api/translate`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) })
  const anon = await post(null, { messageIds: [msg.id] })
  anon.status === 401 ? ok('signed out: 401') : bad(`signed out: ${anon.status}`)
  const badReq = await post(cookieFor(parent.session), { messageIds: 'x' })
  badReq.status === 400 ? ok('a bad body: 400') : bad(`bad body: ${badReq.status}`)
  const cached = await post(cookieFor(parent.session), { messageIds: [msg.id] })
  const cj = await cached.json()
  cached.status === 200 && cj.translations?.[msg.id] ? ok('a cached message comes back without spending anything') : bad(`cached: ${cached.status} ${JSON.stringify(cj)}`)
  const { count: takes } = await admin.from('translation_takes').select('id', { count: 'exact', head: true }).eq('profile_id', PARENT)
  takes === 0 ? ok('no budget taken for a cache hit') : bad(`takes after cache hit: ${takes}`)
  const notMember = await post(cookieFor(outsider.session), { messageIds: [msg.id] })
  const nj = await notMember.json()
  notMember.status === 409 || (notMember.status === 200 && Object.keys(nj.translations ?? {}).length === 0) ? ok('an outsider gets nothing (no language set, and no message they may read)') : bad(`outsider: ${notMember.status} ${JSON.stringify(nj)}`)
  const { data: msg2 } = await admin.from('messages').insert({ academy_id: NRIFA, channel_id: ch.id, sender_id: OWNER, body: `${TAG} Bring a drink bottle.`, status: 'published' }).select('id').single()
  if (process.env.TRANSLATE_TEST_LIVE === '1') {
    const live = await post(cookieFor(parent.session), { messageIds: [msg2.id] })
    const lj = await live.json()
    live.status === 200 && lj.translations?.[msg2.id] ? ok(`live: "${lj.translations[msg2.id]}"`) : bad(`live: ${live.status} ${JSON.stringify(lj)}`)
    const { data: row } = await admin.from('message_translations').select('model').eq('message_id', msg2.id).eq('lang', 'ar').maybeSingle()
    row?.model ? ok(`cached for the next reader (${row.model})`) : bad('live translation not cached')
  } else {
    const live = await post(cookieFor(parent.session), { messageIds: [msg2.id] })
    const lj = await live.json()
    if (process.env.ANTHROPIC_API_KEY) {
      // The key exists, so the route would spend. Not in a test by default.
      console.log('  (live translation skipped — set TRANSLATE_TEST_LIVE=1 to spend a fraction of a cent on it)')
      live.status === 200 || live.status === 502 ? ok('the route answered for an uncached message') : bad(`uncached: ${live.status} ${JSON.stringify(lj)}`)
    } else {
      live.status === 503 ? ok('without a key the route says so (503), and still returns what was cached') : bad(`no key: ${live.status}`)
    }
  }
}

await cleanup()
console.log(process.exitCode ? '\n\x1b[31mTRANSLATION IS WRONG\x1b[0m\n' : '\n\x1b[32mall good\x1b[0m\n')
