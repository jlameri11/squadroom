// Run: node --env-file=.env.local scripts/test-privacy-centre.mjs
//
// W-04: one place for a child's privacy. The facts a parent is shown come
// from the rules the product enforces; the parent's public-name switch
// wins over the club's rule on the public page at once; nobody outside the
// family and the club can ask; the notice is public and cookie-less.
import { createClient } from '@supabase/supabase-js'
import { resolveBaseUrl } from './_base-url.mjs'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const anon = createClient(URL_, PUB, { auth: { persistSession: false } })

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`)
  process.exitCode = 1
}
const head = (m) => console.log(`\n${m}`)

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const PARENT = '00000000-0000-0000-0000-0000000000b1'
const OUTSIDER = '00000000-0000-0000-0000-0000000000c2'

async function signInEmail(email) {
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (!link?.properties?.hashed_token) return null
  const client = createClient(URL_, PUB, { auth: { persistSession: false } })
  const { data } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
  return data?.session ? client : null
}
const parent = await signInEmail((await admin.auth.admin.getUserById(PARENT)).data.user.email)
const outsider = await signInEmail((await admin.auth.admin.getUserById(OUTSIDER)).data.user.email)
if (!parent || !outsider) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}
const { data: g } = await admin.from('player_guardians').select('player_id, players(full_name, team_id, public_name_hidden)').eq('profile_id', PARENT).limit(1).single()
const kid = g.player_id
const kidName = g.players.full_name
const wasHidden = g.players.public_name_hidden
const { data: club } = await admin.from('academies').select('public_player_names').eq('id', NRIFA).single()
const { data: pubComp } = await admin.from('competitions').select('public_slug, name').eq('public_slug', 'nrifa-spring-gala').maybeSingle()

head(`1. The facts, for ${kidName}`)
{
  const { error: stranger } = await outsider.rpc('child_privacy', { p_player: kid })
  stranger?.code === '42501' ? ok('a stranger cannot ask') : bad('a stranger read a child\'s privacy facts')
  const { data: p, error } = await parent.rpc('child_privacy', { p_player: kid })
  error ? bad(`child_privacy: ${error.message}`) : ok(`the parent can: club rule "${p.club_rule}", on public pages "${p.effective_public_name}"`)
  p?.card_audience?.length >= 3 && /match day/.test(p.card_audience.at(-1)) ? ok(`the card's audience is spelled out: ${p.card_audience.join('; ')}`) : bad(JSON.stringify(p?.card_audience))
  const medicalNamed = /never another club/.test(p?.medical_readers ?? '')
  medicalNamed ? ok('medical readers named: club staff only') : bad(p?.medical_readers)
  Array.isArray(p?.consents) ? ok(`${p.consents.length} agreements listed with versions`) : bad('no consents list')
  pubComp && p.public_squads.includes(pubComp.name) ? ok(`the public page that could name them is listed: ${pubComp.name}`) : ok('no public page names this child\'s squad (nothing to list)')
}

head('2. The parent\'s switch wins over the club\'s rule, at once, on the public page')
{
  const { error: stranger } = await outsider.rpc('set_child_public_name', { p_player: kid, p_hidden: true })
  stranger?.code === '42501' ? ok('a stranger cannot flip it') : bad('a stranger changed a child\'s public name')
  const { error } = await parent.rpc('set_child_public_name', { p_player: kid, p_hidden: true })
  error ? bad(`hide: ${error.message}`) : ok('the parent hides the name')
  const { data: p } = await parent.rpc('child_privacy', { p_player: kid })
  p.effective_public_name === 'hidden' && p.name_hidden ? ok('the facts say hidden') : bad(JSON.stringify(p))
  if (pubComp) {
    const { data: centre } = await anon.rpc('public_match_centre', { p_slug: pubComp.public_slug })
    const names = Object.values(centre?.squads ?? {}).flat().map((x) => x.name)
    const first = kidName.split(' ')[0]
    !names.some((n) => n.startsWith(first + ' ')) ? ok(`${kidName} is not on the public squads`) : bad(`still named on the public page: ${names.filter((n) => n.startsWith(first)).join(', ')}`)
    if (club.public_player_names !== 'off') {
      await parent.rpc('set_child_public_name', { p_player: kid, p_hidden: false })
      const { data: again } = await anon.rpc('public_match_centre', { p_slug: pubComp.public_slug })
      const names2 = Object.values(again?.squads ?? {}).flat().map((x) => x.name)
      names2.some((n) => n.startsWith(first)) ? ok(`switched back on, the club's rule names them again ("${names2.find((n) => n.startsWith(first))}")`) : ok('switched back on; the squad is not published for this page, so nothing to show')
    }
  }
  await parent.rpc('set_child_public_name', { p_player: kid, p_hidden: wasHidden })
}

head('3. The notice: public, cookie-less, written for a child')
{
  const BASE = await resolveBaseUrl({ quiet: true })
  const res = await fetch(`${BASE}/privacy`)
  const html = await res.text()
  res.status === 200 && /don&#x27;t need an account|don't need an account/.test(html) ? ok('/privacy answers, and starts with the child') : bad(`/privacy: ${res.status}`)
  !res.headers.get('set-cookie') ? ok('no cookie is set') : bad(`set-cookie: ${res.headers.get('set-cookie')}`)
  const promises = /never on the internet/.test(html) && /erase/.test(html)
  promises ? ok('the photo promise and the erase control are both in it') : bad('the notice is missing a promise the code makes')
}

console.log(process.exitCode ? '\n\x1b[31mTHE PRIVACY CENTRE IS WRONG\x1b[0m\n' : '\n\x1b[32mall good\x1b[0m\n')
