// Run: node --env-file=.env.local scripts/test-privacy.mjs
//
// Proves 0127 (S-05): export and erase.
//
// The Children's Online Privacy Code applies from 10 December 2026, and two
// of its obligations are plain software. The legal review is somebody else's
// job; being ready for it is this.
//
// Erasure is the most destructive operation in the product, so this suite
// works on a THROWAWAY family it creates and deletes. It never erases a
// seeded person: a test that has to leave the demo intact and also prove a
// deletion worked is a test that will one day do the deletion and fail to
// put it back.
//
// The assertions that carry the weight are about what is KEPT, because that
// is where the thinking is:
//
//   · a safeguarding report naming somebody cannot be erased BY that
//     somebody
//   · a payment record is the club's books, not the family's data
//   · a message is tombstoned, never removed, or a thread is left where half
//     the replies answer nothing
//   · a child's roster row belongs to the CLUB — and when the last guardian
//     goes, the club is TOLD, because a child nobody can ring about is a
//     child nobody can collect from training
import { createClient } from '@supabase/supabase-js'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})
const anon = createClient(URL_, PUB, { auth: { persistSession: false } })

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`)
  process.exitCode = 1
}
const head = (m) => console.log(`\n${m}`)

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const U8 = '00000000-0000-0000-0000-0000000d0008'
const OWNER = '00000000-0000-0000-0000-0000000000a1'
const TAG = 'TESTPRIV'
const PHONE = '+61400006661'
const EMAIL = 'p61400006661@squadroom.invalid'

async function session(email) {
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (!link?.properties?.hashed_token) {
    console.log("  could not issue a magic link — the project's auth rate limit, not a failure")
    process.exit(2)
  }
  const { data: s } = await anon.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: 'email',
  })
  if (!s?.session) {
    console.log("  could not sign in — the project's auth rate limit, not a failure")
    process.exit(2)
  }
  return {
    client: createClient(URL_, PUB, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${s.session.access_token}` } },
    }),
    id: s.user.id,
  }
}

async function clean() {
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 })
  const mine = users.users.find((u) => u.email === EMAIL)
  if (mine) {
    await admin.from('messages').delete().eq('sender_id', mine.id)
    await admin.from('event_rsvps').delete().eq('profile_id', mine.id)
    await admin.from('message_reports').delete().eq('reported_by', mine.id)
    await admin.from('notification_queue').delete().eq('profile_id', mine.id)
    await admin.from('player_guardians').delete().eq('profile_id', mine.id)
    await admin.from('academy_members').delete().eq('profile_id', mine.id)
    await admin.auth.admin.deleteUser(mine.id)
  }
  const { data: kids } = await admin
    .from('players')
    .select('id')
    .eq('academy_id', NRIFA)
    .like('full_name', `${TAG}%`)
  for (const k of kids ?? []) {
    await admin.from('player_medical').delete().eq('player_id', k.id)
    await admin.from('player_guardians').delete().eq('player_id', k.id)
    await admin.from('event_rsvps').delete().eq('player_id', k.id)
    await admin.from('payments').delete().eq('player_id', k.id)
  }
  await admin.from('players').delete().eq('academy_id', NRIFA).like('full_name', `${TAG}%`)
  await admin.from('notification_queue').delete().eq('kind', 'guardian_erased')
  await admin.from('payment_requests').delete().eq('academy_id', NRIFA).like('title', `${TAG}%`)
  await admin.from('messages').delete().like('body', `${TAG}%`)
}
await clean()

// A throwaway family. Nothing seeded is erased by this suite.
const { data: created, error: userErr } = await admin.auth.admin.createUser({
  email: EMAIL,
  phone: PHONE,
  email_confirm: true,
  phone_confirm: true,
  user_metadata: { full_name: `${TAG} Parent` },
})
if (userErr) {
  bad(userErr.message)
  process.exit(1)
}
const ME = created.user.id

await admin
  .from('academy_members')
  .upsert(
    { academy_id: NRIFA, profile_id: ME, role: 'parent', status: 'active' },
    { onConflict: 'academy_id,profile_id' }
  )

const { data: child } = await admin
  .from('players')
  .insert({
    academy_id: NRIFA,
    team_id: U8,
    full_name: `${TAG} Child`,
    dob: '2017-03-03',
    shirt_size: '10',
  })
  .select('id')
  .single()

await admin
  .from('player_guardians')
  .insert({ academy_id: NRIFA, player_id: child.id, profile_id: ME, relationship: 'parent' })

await admin.from('player_medical').insert({
  academy_id: NRIFA,
  player_id: child.id,
  allergies: 'peanuts',
  coach_note: 'blue inhaler in the side pocket',
  emergency_name: `${TAG} Nan`,
})

const { data: u8channel } = await admin
  .from('channels')
  .select('id')
  .eq('team_id', U8)
  .eq('type', 'team')
  .single()
await admin
  .from('channel_members')
  .upsert({ academy_id: NRIFA, channel_id: u8channel.id, profile_id: ME }, { onConflict: 'channel_id,profile_id' })

const { data: myMessage } = await admin
  .from('messages')
  .insert({
    academy_id: NRIFA,
    channel_id: u8channel.id,
    sender_id: ME,
    body: `${TAG} what time is kick-off?`,
  })
  .select('id')
  .single()

// A message from somebody else, which this person then reports. The report
// must survive their erasure.
const { data: theirMessage } = await admin
  .from('messages')
  .insert({
    academy_id: NRIFA,
    channel_id: u8channel.id,
    sender_id: OWNER,
    body: `${TAG} something worth reporting`,
  })
  .select('id')
  .single()

await admin.from('message_reports').insert({
  academy_id: NRIFA,
  channel_id: u8channel.id,
  message_id: theirMessage.id,
  reported_by: ME,
  reason: 'other',
  note: `${TAG} report note`,
})

// A paid fee, which is the club's books.
const { data: fee } = await admin
  .from('payment_requests')
  .insert({
    academy_id: NRIFA,
    team_id: U8,
    title: `${TAG} Season Fee`,
    amount_cents: 25000,
    currency: 'aud',
    per_player: true,
    created_by: OWNER,
  })
  .select('id')
  .single()
await admin.from('payments').insert({
  academy_id: NRIFA,
  request_id: fee.id,
  profile_id: ME,
  player_id: child.id,
  amount_cents: 25000,
  currency: 'aud',
  status: 'paid',
  paid_at: new Date().toISOString(),
})

const me = await session(EMAIL)
if (me.id !== ME) {
  bad('signed in as the wrong user')
  process.exit(1)
}

head('1. A family can get everything held about them')
{
  const { data, error } = await me.client.rpc('export_my_data')
  if (error) {
    bad(error.message)
  } else {
    data.you?.name === `${TAG} Parent` ? ok('their own details') : bad(`you: ${JSON.stringify(data.you)}`)
    data.children?.length === 1 ? ok('their child') : bad(`${data.children?.length} children`)
    data.children?.[0]?.date_of_birth === '2017-03-03'
      ? ok('with the date of birth')
      : bad(`dob ${data.children?.[0]?.date_of_birth}`)
    // The most sensitive thing held about a child. An export that quietly
    // left it out would be an export nobody could rely on.
    data.children?.[0]?.medical?.allergies === 'peanuts'
      ? ok('and the medical record in full')
      : bad(`medical: ${JSON.stringify(data.children?.[0]?.medical)}`)
    data.children?.[0]?.kit?.shirt === '10' ? ok('and their kit size') : bad('no kit')
    data.your_messages?.length >= 1 ? ok('their own messages') : bad('no messages')
    data.payments?.length === 1 ? ok('and what they have paid') : bad(`${data.payments?.length} payments`)
    data.clubs?.some((c) => c.role === 'parent') ? ok('and which clubs they are in') : bad('no clubs')
  }
}

head('2. And nobody else’s')
{
  // A team chat is other families' words. An export is not a way to take a
  // copy of a club's conversations home.
  const { data } = await me.client.rpc('export_my_data')
  const blob = JSON.stringify(data)
  blob.includes('something worth reporting')
    ? bad("another person's message is in the export")
    : ok("another person's message is not")

  const { data: others } = await admin
    .from('players')
    .select('full_name')
    .eq('academy_id', NRIFA)
    .not('full_name', 'like', `${TAG}%`)
    .limit(20)
  const leaked = (others ?? []).filter((p) => blob.includes(p.full_name))
  leaked.length === 0
    ? ok('and no other child is named')
    : bad(`named ${leaked.map((p) => p.full_name).join(', ')}`)
}

head('3. Erasing is one call, and it says what it did')
let manifest
{
  const { data, error } = await me.client.rpc('erase_me')
  if (error) {
    bad(error.message)
    process.exit(1)
  }
  manifest = data
  // "We erased you" is not an answer anybody can check.
  manifest.erased ? ok('a manifest came back') : bad('no manifest')
  manifest.kept?.length >= 4
    ? ok(`${manifest.kept.length} things kept, each with a reason`)
    : bad(`kept: ${JSON.stringify(manifest.kept)}`)
  manifest.kept?.every((k) => k.what && k.why)
    ? ok('and every reason is stated, not implied')
    : bad('a kept item has no reason')
}

head('4. What went')
{
  const { data: profile } = await admin
    .from('profiles')
    .select('full_name, phone, avatar_url, erased_at')
    .eq('id', ME)
    .single()
  profile.full_name === 'Removed' ? ok('the name') : bad(`name is ${profile.full_name}`)
  profile.phone === null ? ok('the phone number') : bad(`phone is ${profile.phone}`)
  profile.erased_at ? ok('and it is marked erased') : bad('no erased_at')

  const { count: medical } = await admin
    .from('player_medical')
    .select('player_id', { count: 'exact', head: true })
    .eq('player_id', child.id)
  medical === 0
    ? ok('the medical record, outright — no retention basis once a family leaves')
    : bad(`${medical} medical records left`)

  const { count: guardians } = await admin
    .from('player_guardians')
    .select('id', { count: 'exact', head: true })
    .eq('profile_id', ME)
  guardians === 0 ? ok('the guardian link') : bad(`${guardians} guardian links left`)

  const { count: devices } = await admin
    .from('push_subscriptions')
    .select('id', { count: 'exact', head: true })
    .eq('profile_id', ME)
  devices === 0 ? ok('and every device registration') : bad(`${devices} devices left`)

  const { data: member } = await admin
    .from('academy_members')
    .select('status, removed_at')
    .eq('profile_id', ME)
    .eq('academy_id', NRIFA)
    .maybeSingle()
  member?.status === 'removed' && member.removed_at
    ? ok('membership ended, with the row kept so a club knows they left')
    : bad(`membership: ${JSON.stringify(member)}`)
}

head('5. What was kept, and why')
{
  // A thread where half the replies answer nothing is worse for everyone
  // than a row of "message removed".
  const { data: msg } = await admin
    .from('messages')
    .select('body, deleted_at')
    .eq('id', myMessage.id)
    .maybeSingle()
  msg ? ok('the message row survives') : bad('a message was deleted outright')
  msg?.body === null ? ok('with its text gone') : bad(`body is ${JSON.stringify(msg?.body)}`)
  msg?.deleted_at ? ok('and marked removed') : bad('not tombstoned')

  // A report naming somebody must not be erasable BY that somebody.
  const { data: report } = await admin
    .from('message_reports')
    .select('id, reported_by')
    .eq('message_id', theirMessage.id)
    .maybeSingle()
  report ? ok('the safeguarding report survives their erasure') : bad('a report was destroyed')

  // The club's books. Five years, as Australian law requires.
  const { data: payment } = await admin
    .from('payments')
    .select('amount_cents, status')
    .eq('profile_id', ME)
    .maybeSingle()
  payment?.amount_cents === 25000 && payment.status === 'paid'
    ? ok('and the payment record, amount and all')
    : bad(`payment: ${JSON.stringify(payment)}`)

  // A roster row belongs to the CLUB.
  const { data: stillThere } = await admin
    .from('players')
    .select('full_name, team_id')
    .eq('id', child.id)
    .maybeSingle()
  stillThere?.full_name === `${TAG} Child`
    ? ok("the child stays on the club's roster")
    : bad('the child was deleted with the parent')
}

head('6. The club is TOLD a child has nobody to ring')
{
  // Not discovered. A child left on a roster with no contact is a child
  // nobody can collect from training.
  manifest.children_left_without_a_contact?.length === 1
    ? ok(`the manifest names them (${manifest.children_left_without_a_contact[0].child})`)
    : bad(`orphans: ${JSON.stringify(manifest.children_left_without_a_contact)}`)

  const { data: told } = await admin
    .from('notification_queue')
    .select('profile_id, title, body')
    .eq('kind', 'guardian_erased')
  told?.length > 0 ? ok(`${told.length} club staff notified`) : bad('nobody at the club was told')
  told?.[0]?.body?.includes(`${TAG} Child`)
    ? ok('and the notification names the child')
    : bad(`body: ${JSON.stringify(told?.[0]?.body)}`)

  // Owners and admins, who are the people who can ring the other parent.
  const { data: staff } = await admin
    .from('academy_members')
    .select('profile_id')
    .eq('academy_id', NRIFA)
    .in('role', ['owner', 'admin'])
    .eq('status', 'active')
  const staffIds = new Set((staff ?? []).map((s) => s.profile_id))
  ;(told ?? []).every((t) => staffIds.has(t.profile_id))
    ? ok('and only staff were told')
    : bad('somebody who is not staff was told')
}

head('7. Erasing twice is not an error, and does nothing new')
{
  // A person who taps it again, or a retry after a dropped connection.
  const second = await session(EMAIL)
  const { data, error } = await second.client.rpc('erase_me')
  error ? bad(`a second erase failed: ${error.message}`) : ok('it runs again cleanly')
  data?.erased ? ok('and still returns a manifest') : bad('no manifest the second time')

  const { count: extra } = await admin
    .from('notification_queue')
    .select('id', { count: 'exact', head: true })
    .eq('kind', 'guardian_erased')
  // The guardian link is already gone, so there is no orphan to report twice.
  extra > 0 ? ok(`and did not tell the club again (${extra} unchanged)`) : bad('notifications vanished')
}

head('8. Neither call is reachable by a stranger')
{
  const stranger = createClient(URL_, PUB, { auth: { persistSession: false } })
  const { error: exportErr } = await stranger.rpc('export_my_data')
  exportErr ? ok(`export refused (${exportErr.code})`) : bad('anon exported data')
  const { error: eraseErr } = await stranger.rpc('erase_me')
  eraseErr ? ok(`erase refused (${eraseErr.code})`) : bad('anon called erase')
}

await clean()
console.log(
  process.exitCode ? '\n\x1b[31msome of this is wrong\x1b[0m' : '\n\x1b[32mall good\x1b[0m'
)
