// Run: node --env-file=.env.local scripts/test-player-card.mjs
//
// X-06: a player card, and the one photo on it — private to the family and
// the club's coaches, in its own bucket, under the child's own path.
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
const OWNER = '00000000-0000-0000-0000-0000000000a1'
const PARENT = '00000000-0000-0000-0000-0000000000b1'
const OUTSIDER = '00000000-0000-0000-0000-0000000000c2'
const BUCKET = 'player-photos'

async function signIn(profileId) {
  const { data: u } = await admin.auth.admin.getUserById(profileId)
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email: u.user.email })
  if (!link?.properties?.hashed_token) return null
  const client = createClient(URL_, PUB, { auth: { persistSession: false } })
  const { data } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
  return data?.session ? client : null
}
const owner = await signIn(OWNER)
const parent = await signIn(PARENT)
const outsider = await signIn(OUTSIDER)
if (!owner || !parent || !outsider) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}

// The parent's first child, and a one-pixel JPEG.
const { data: link } = await admin.from('player_guardians').select('player_id').eq('profile_id', PARENT).limit(1).single()
const kid = (await admin.from('players').select('id, full_name, photo_url').eq('id', link.player_id).single()).data
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64')
const path = `${NRIFA}/${kid.id}/test-${Date.now()}.jpg`
const cleanup = async () => {
  const { data: files } = await admin.storage.from(BUCKET).list(`${NRIFA}/${kid.id}`)
  if (files?.length) await admin.storage.from(BUCKET).remove(files.map((f) => `${NRIFA}/${kid.id}/${f.name}`))
  await admin.from('players').update({ photo_url: kid.photo_url }).eq('id', kid.id)
}

head('1. The family uploads a photo into the child\'s own folder, and nowhere else')
{
  const { error } = await parent.storage.from(BUCKET).upload(path, JPEG, { contentType: 'image/jpeg' })
  error ? bad(`upload: ${error.message}`) : ok('uploaded under <club>/<child>/')
  const wrong = `${NRIFA}/${'00000000-0000-0000-0000-000000000bad'}/x.jpg`
  const { error: notTheirs } = await parent.storage.from(BUCKET).upload(wrong, JPEG, { contentType: 'image/jpeg' })
  notTheirs ? ok("not under another child's id") : bad("uploaded under another child's id")
  const { error: otherClub } = await outsider.storage.from(BUCKET).upload(`${NRIFA}/${kid.id}/sneak.jpg`, JPEG, { contentType: 'image/jpeg' })
  otherClub ? ok("an outsider cannot put a file in this child's folder") : bad('an outsider uploaded')
}

head('2. The row points at the path; a path outside the folder is refused')
{
  const { error } = await parent.rpc('set_player_photo', { p_player: kid.id, p_path: path })
  error ? bad(`set: ${error.message}`) : ok('set_player_photo as a parent')
  const { error: elsewhere } = await parent.rpc('set_player_photo', { p_player: kid.id, p_path: `${NRIFA}/00000000-0000-0000-0000-000000000bad/x.jpg` })
  elsewhere ? ok(`a path in another folder is refused: "${elsewhere.message.slice(0, 40)}"`) : bad('pointed the card at another folder')
  const { error: outErr } = await outsider.rpc('set_player_photo', { p_player: kid.id, p_path: path })
  outErr?.code === '42501' ? ok('an outsider cannot set it') : bad('an outsider set the photo')
}

head('3. Who can open the card')
{
  const { data: c, error } = await parent.rpc('player_card', { p_player: kid.id })
  error ? bad(error.message) : ok(`the parent: ${c.full_name}${c.number != null ? ` #${c.number}` : ''}${c.squad ? `, ${c.squad.name}` : ''}`)
  c?.photo_path === path && c?.club?.name ? ok('with the photo path and the club') : bad(JSON.stringify(c))
  const { error: coach } = await owner.rpc('player_card', { p_player: kid.id })
  coach ? bad(`coach: ${coach.message}`) : ok("the club's coach")
  const { error: nope } = await outsider.rpc('player_card', { p_player: kid.id })
  nope?.code === '42501' ? ok('not an outsider') : bad('an outsider opened the card')
}

head('4. Reading the photo: a signed link for the family and coaches only')
{
  const { data: mine, error } = await parent.storage.from(BUCKET).createSignedUrl(path, 60)
  !error && mine?.signedUrl ? ok('the parent gets a signed link') : bad(`parent: ${error?.message}`)
  const { data: theirs, error: cErr } = await owner.storage.from(BUCKET).createSignedUrl(path, 60)
  !cErr && theirs?.signedUrl ? ok('so does the coach') : bad(`coach: ${cErr?.message}`)
  const { data: not, error: oErr } = await outsider.storage.from(BUCKET).createSignedUrl(path, 60)
  oErr || !not?.signedUrl ? ok('an outsider does not') : bad('an outsider got a link to a child\'s photo')
  const { data: listed } = await outsider.storage.from(BUCKET).list(`${NRIFA}/${kid.id}`)
  const seen = (listed ?? []).length
  seen === 0 ? ok('and cannot list the folder') : bad(`an outsider listed ${seen} files`)
}

head('5. Nothing public carries it')
{
  const anon = createClient(URL_, PUB, { auth: { persistSession: false } })
  const { data: door } = await anon.rpc('public_academy', { p_slug: 'nrifa' })
  const { data: centre } = await anon.rpc('public_match_centre', { p_slug: 'nrifa-spring-gala' })
  const blob = JSON.stringify({ door, centre })
  !blob.includes('player-photos') && !blob.includes(kid.id) ? ok('neither the front door nor the match centre mentions the photo or the child') : bad('a public payload carries the photo path')
}

await cleanup()
console.log(process.exitCode ? '\n\x1b[31mTHE PLAYER CARD IS WRONG\x1b[0m\n' : '\n\x1b[32mall good\x1b[0m\n')
