// Run: node --env-file=.env.local scripts/test-support.mjs
//
// G-03 (0205): help inside the app. A person writes to Squadroom; the
// platform admin sees the inbox and replies; the person is pushed and sees
// the reply; nobody sees anybody else's; the status page says whether
// anything is wrong, to anyone, with no account.
import { createClient } from '@supabase/supabase-js'
import { signInClient } from './_auth.mjs'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const anon = createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } })
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const head = (m) => console.log(`\n${m}`)

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const OWNER = '00000000-0000-0000-0000-0000000000a1'   // the platform admin, in the seed
const PARENT = '00000000-0000-0000-0000-0000000000b1'

const staff = await signInClient(admin, 'joeylameri@outlook.com')
const parent = await signInClient(admin, 'p61400000011@squadroom.invalid')
const other = await signInClient(admin, 'p61400000012@squadroom.invalid')
if (!staff || !parent || !other) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}
const tidy = async () => {
  const { data: rs } = await admin.from('support_requests').select('id').like('subject', 'TEST::%')
  for (const r of rs ?? []) await admin.from('notification_queue').delete().like('dedupe_key', `support:${r.id}%`)
  await admin.from('notification_queue').delete().eq('kind', 'support_reply').like('title', '%TEST::%')
  await admin.from('support_requests').delete().like('subject', 'TEST::%')
  await admin.from('platform_status').delete().like('title', 'TEST::%')
}
await tidy()

head('1. A parent asks')
const { data: reqId, error: oe } = await parent.rpc('open_support_request', { p_subject: 'TEST:: push not arriving', p_body: 'I get no push for U8 announcements since Sunday.', p_academy: NRIFA })
if (oe) { bad(`open: ${oe.message}`); await tidy(); process.exit(1) }
ok('a request is opened')
const { data: mine } = await parent.rpc('support_threads', { p_inbox: false })
mine.length >= 1 && mine[0].id === reqId && mine[0].status === 'open' && mine[0].from === null ? ok('the parent sees it in their own list, open') : bad(`mine: ${JSON.stringify(mine?.[0])}`)
const { data: told } = await admin.from('notification_queue').select('profile_id, title').eq('kind', 'support_reply').filter('payload->>request_id', 'eq', reqId)
told?.some((t) => t.profile_id === OWNER && /Support: TEST::/.test(t.title)) ? ok('the platform admin is told') : bad(`admin push: ${JSON.stringify(told)}`)
const { data: theirs } = await other.rpc('support_threads', { p_inbox: false })
!(theirs ?? []).some((t) => t.id === reqId) ? ok("another parent does not see it") : bad('another parent saw the request')
const { error: ie } = await other.rpc('support_threads', { p_inbox: true })
ie?.code === '42501' ? ok('nor the inbox') : bad(`other inbox: ${ie?.code ?? 'allowed'}`)
const { data: rawOther } = await other.from('support_requests').select('id').eq('id', reqId)
;(rawOther ?? []).length === 0 ? ok('and reads no row through the table') : bad('another parent read the row')

head('2. Squadroom replies')
const { data: inbox } = await staff.rpc('support_threads', { p_inbox: true })
const t = (inbox ?? []).find((x) => x.id === reqId)
t && t.from?.name === 'Sam Whitfield' && t.from.academy ? ok(`the inbox shows it from ${t.from.name} · ${t.from.academy}`) : bad(`inbox: ${JSON.stringify(t?.from)}`)
const { data: replyId, error: re } = await staff.rpc('reply_support', { p_request: reqId, p_body: 'Thanks Sam — fixed this morning; please reinstall the app from the home screen.' })
re ? bad(`reply: ${re.message}`) : ok('Squadroom replies')
const { data: after } = await parent.rpc('support_threads', { p_inbox: false })
const th = after.find((x) => x.id === reqId)
th?.status === 'answered' && th.replies.length === 1 && th.replies[0].from_staff && th.replies[0].name === 'Squadroom' ? ok('the parent sees the reply, as "Squadroom", status Replied') : bad(`after: ${JSON.stringify(th)}`)
const { data: push } = await admin.from('notification_queue').select('profile_id, title, url').eq('kind', 'support_reply').filter('payload->>reply_id', 'eq', replyId)
push?.[0]?.profile_id === PARENT && /Squadroom replied/.test(push[0].title) && push[0].url === '/settings/help' ? ok(`and is pushed: "${push[0].title}" → Help`) : bad(`parent push: ${JSON.stringify(push)}`)
await parent.rpc('reply_support', { p_request: reqId, p_body: 'That did it, thank you.' })
const { data: again } = await staff.rpc('support_threads', { p_inbox: true })
again.find((x) => x.id === reqId)?.status === 'open' ? ok("the parent's reply reopens it for Squadroom") : bad('status after the parent replied is wrong')
const { error: oe2 } = await other.rpc('reply_support', { p_request: reqId, p_body: 'me too' })
oe2?.code === '42501' ? ok("another parent cannot reply to someone else's") : bad(`other reply: ${oe2?.code ?? 'allowed'}`)
await parent.rpc('close_support_request', { p_request: reqId })
const { data: closed } = await parent.rpc('support_threads', { p_inbox: false })
closed.find((x) => x.id === reqId)?.status === 'closed' ? ok('the parent closes it') : bad('close failed')
for (let i = 0; i < 10; i++) await parent.rpc('open_support_request', { p_subject: `TEST:: many ${i}`, p_body: 'x' })
const { error: tooMany } = await parent.rpc('open_support_request', { p_subject: 'TEST:: eleven', p_body: 'x' })
tooMany ? ok('ten open requests is the cap') : bad('an eleventh open request was accepted')

head('3. The status page, with no account')
let { data: st } = await anon.rpc('public_status')
st && typeof st.ok === 'boolean' ? ok(`anyone reads the status page: ${st.ok ? 'all good' : 'an incident is open'}`) : bad(`status: ${JSON.stringify(st)}`)
const { error: pse } = await parent.from('platform_status').insert({ kind: 'incident', title: 'TEST:: parent incident' })
pse ? ok('a parent cannot post a notice') : bad('a parent posted a status notice')
const { error: sse } = await staff.from('platform_status').insert({ kind: 'incident', title: 'TEST:: push delays', body: 'Pushes are arriving late. Working on it.' })
sse ? bad(`admin notice: ${sse.message}`) : ok('the platform admin posts an incident')
;({ data: st } = await anon.rpc('public_status'))
st.ok === false && st.items.some((i) => i.title === 'TEST:: push delays') ? ok('the status page shows it, and is not "all good"') : bad(`status after: ${JSON.stringify(st)}`)
await staff.from('platform_status').update({ resolved_at: new Date().toISOString() }).like('title', 'TEST:: push delays')
;({ data: st } = await anon.rpc('public_status'))
st.ok === true ? ok('resolved: all good again') : bad('still not ok after resolving')

await tidy()
process.exit(process.exitCode ?? 0)
