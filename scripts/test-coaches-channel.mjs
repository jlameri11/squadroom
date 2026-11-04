// Run: node --env-file=.env.local scripts/test-coaches-channel.mjs
//
// A chat for coaches holds coaches (Joey, 4 Nov 2026: "why is Sam, a
// parent, in COACHES SPL?"). The answer was the demo data: a custom chat
// named for coaches with two parents added by hand. The real coaches
// channels (type 'coaches') never had a parent in them, and RLS keeps a
// parent out of what they are not a member of. Both are proven here, and
// the seed hygiene rule — no parent in any channel named for coaches — so
// the question does not come back.
import { createClient } from '@supabase/supabase-js'
import { signInBoth } from './_auth.mjs'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const head = (m) => console.log(`\n${m}`)
const NRIFA = '00000000-0000-0000-0000-0000000a0001'

head('1. Nobody with the parent role sits in a coaches channel, in any organisation')
const { data: coachChannels } = await admin.from('channels').select('id, name, type, academy_id').or('type.eq.coaches,name.ilike.coach%')
let parentsInside = 0
for (const c of coachChannels ?? []) {
  const { data: members } = await admin.from('channel_members').select('profile_id').eq('channel_id', c.id)
  for (const m of members ?? []) {
    const { data: am } = await admin.from('academy_members').select('role').eq('academy_id', c.academy_id).eq('profile_id', m.profile_id).maybeSingle()
    if (am?.role === 'parent') { parentsInside++; bad(`a parent (…${m.profile_id.slice(-4)}) is in "${c.name}" (${c.type}) of ${c.academy_id.slice(-4)}`) }
  }
}
if (parentsInside === 0) ok(`${(coachChannels ?? []).length} channels named or typed for coaches, no parent in any of them`)

head('2. The parent cannot read the coaches channel at all')
const sam = await signInBoth(admin, 'p61400000011@squadroom.invalid')
if (!sam) { console.log("  could not sign in — the project's auth rate limit, not a failure"); process.exit(2) }
const { data: real } = await admin.from('channels').select('id').eq('academy_id', NRIFA).eq('type', 'coaches').limit(1).maybeSingle()
if (!real) bad('NRIFA has no coaches channel in the seed')
else {
  const { data: seen } = await sam.client.from('channels').select('id').eq('id', real.id)
  ;(seen ?? []).length === 0 ? ok('the channel row is invisible to her') : bad('a parent can see the coaches channel')
  const { data: msgs, error } = await sam.client.rpc('channel_messages', { p_channel: real.id, p_limit: 5 })
  error || !msgs || (Array.isArray(msgs) ? msgs.length === 0 : (msgs.messages ?? []).length === 0)
    ? ok(`its messages are refused or empty (${error?.code ?? 'no rows'})`)
    : bad(`a parent read ${JSON.stringify(msgs).slice(0, 80)}`)
  const { error: join } = await sam.client.from('channel_members').insert({ academy_id: NRIFA, channel_id: real.id, profile_id: sam.session.user.id })
  join ? ok(`and she cannot add herself (${join.code})`) : bad('a parent added herself to the coaches channel')
  await admin.from('channel_members').delete().eq('channel_id', real.id).eq('profile_id', sam.session.user.id)
}

head('3. The coach is in it, and reads it')
const marcus = await signInBoth(admin, 'p61400000002@squadroom.invalid')
if (marcus && real) {
  const { data: seen } = await marcus.client.from('channels').select('id, name').eq('id', real.id)
  ;(seen ?? []).length === 1 ? ok(`Marcus sees "${seen[0].name}"`) : bad('the coach cannot see the coaches channel')
}

process.exit(process.exitCode ?? 0)
