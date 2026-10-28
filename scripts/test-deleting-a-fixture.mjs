// Run: node --env-file=.env.local scripts/test-deleting-a-fixture.mjs
//
// Proves 0129: a coach who posts a fixture to the team can delete it again.
//
// They could not. Posting a fixture leaves a CARD — a message whose only
// content is the event — and deleting the event blanked it, which
// `messages_not_empty` refused, so the delete failed with a constraint name
// about a table the coach never touched. There was no way for them to work
// out that the cause was something they posted three weeks ago.
//
// The distinction that matters: a card with no words goes with the fixture,
// because it has nothing left to say. A message a coach TYPED, with the
// fixture attached, keeps its words — deleting a fixture is not permission
// to delete a sentence.
import { createClient } from '@supabase/supabase-js'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`)
  process.exitCode = 1
}
const head = (m) => console.log(`\n${m}`)

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const U8 = '00000000-0000-0000-0000-0000000d0008'
const OWNER = '00000000-0000-0000-0000-0000000000a1'
const TAG = 'TESTDELFIX'

const { data: channel } = await admin
  .from('channels')
  .select('id')
  .eq('team_id', U8)
  .eq('type', 'team')
  .single()

async function clean() {
  await admin.from('messages').delete().like('body', `${TAG}%`)
  const { data: evs } = await admin
    .from('events')
    .select('id')
    .eq('academy_id', NRIFA)
    .like('title', `${TAG}%`)
  for (const e of evs ?? []) {
    await admin.from('notification_queue').delete().eq('payload->>event_id', e.id)
    await admin.from('messages').delete().eq('event_id', e.id)
  }
  await admin.from('events').delete().eq('academy_id', NRIFA).like('title', `${TAG}%`)
}
await clean()

async function fixtureWithCard(body) {
  const { data: event } = await admin
    .from('events')
    .insert({
      academy_id: NRIFA,
      team_id: U8,
      type: 'match',
      title: `${TAG} vs Gladesville`,
      starts_at: new Date(Date.now() + 5 * 864e5).toISOString(),
      ends_at: new Date(Date.now() + 5 * 864e5 + 36e5).toISOString(),
      source: 'manual',
    })
    .select('id')
    .single()
  const { data: card, error } = await admin
    .from('messages')
    .insert({
      academy_id: NRIFA,
      channel_id: channel.id,
      sender_id: OWNER,
      event_id: event.id,
      body,
    })
    .select('id')
    .single()
  if (error) throw new Error(`could not post the card: ${error.message}`)
  return { event, card }
}

head('1. A fixture posted to the team can be deleted')
{
  const { event, card } = await fixtureWithCard(null)
  const { error } = await admin.from('events').delete().eq('id', event.id)
  error
    ? bad(`still refused: ${error.message.slice(0, 80)}`)
    : ok('the delete goes through')

  const { data: left } = await admin
    .from('messages')
    .select('id')
    .eq('id', card.id)
    .maybeSingle()
  // A card whose event is gone has no text, nothing to open and nothing to
  // say. A tombstone is for words somebody wrote and withdrew; nobody wrote
  // this.
  left ? bad('the empty card survived with nothing in it') : ok('and the card goes with it')
}

head('2. But a coach’s own words are not collateral')
{
  const { event, card } = await fixtureWithCard(`${TAG} bring your boots`)
  const { error } = await admin.from('events').delete().eq('id', event.id)
  error ? bad(`refused: ${error.message.slice(0, 80)}`) : ok('the delete goes through')

  const { data: kept } = await admin
    .from('messages')
    .select('body, event_id')
    .eq('id', card.id)
    .maybeSingle()
  kept ? ok('the message is still there') : bad('a typed message was deleted with the fixture')
  kept?.body === `${TAG} bring your boots`
    ? ok('with the words a coach typed')
    : bad(`body is ${JSON.stringify(kept?.body)}`)
  kept?.event_id === null
    ? ok('and only the card is gone from it')
    : bad(`event_id is ${kept?.event_id}`)
}

head('3. An attachment counts as content too')
{
  // A message with a photo and a fixture card, and no words. The photo is
  // somebody's content even though they typed nothing.
  const { event } = await fixtureWithCard(null)
  const { data: withPhoto } = await admin
    .from('messages')
    .insert({
      academy_id: NRIFA,
      channel_id: channel.id,
      sender_id: OWNER,
      event_id: event.id,
      body: null,
      attachments: [{ path: 'demo/x.jpg', name: 'x.jpg', kind: 'image' }],
    })
    .select('id')
    .single()

  const { error } = await admin.from('events').delete().eq('id', event.id)
  error ? bad(`refused: ${error.message.slice(0, 80)}`) : ok('the delete goes through')

  const { data: kept } = await admin
    .from('messages')
    .select('id, attachments')
    .eq('id', withPhoto.id)
    .maybeSingle()
  kept ? ok('the photo survives the fixture') : bad('a photo was deleted with the fixture')
  await admin.from('messages').delete().eq('id', withPhoto.id)
}

await clean()
console.log(
  process.exitCode ? '\n\x1b[31msome of this is wrong\x1b[0m' : '\n\x1b[32mall good\x1b[0m'
)
