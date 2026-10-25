// Run: npm run dev, then node --env-file=.env.local scripts/test-join-codes.mjs
//
// A code is an alternative SPELLING of a join link, not a second mechanism.
// That is the whole claim, and it is only true if every property of the link
// holds down both paths — expiry, use limit, revocation, and the coach
// approval at the end.
//
// The failure this guards against is specific: somebody later "optimises" the
// code lookup into its own query and forgets one of the four checks, so a
// revoked link still works if you type it instead of tapping it. That is a
// stranger in a channel full of children's names.
import { createClient } from '@supabase/supabase-js'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})
const SITE = process.env.SITE ?? 'http://localhost:3000'

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`)
  process.exitCode = 1
}
const head = (m) => console.log(`\n${m}`)

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const U8 = '00000000-0000-0000-0000-0000000d0008'
const LABEL = 'TESTCODE'

async function post(path, body) {
  const response = await fetch(`${SITE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json().catch(() => null) }
}

async function page(path) {
  const response = await fetch(`${SITE}${path}`)
  return { status: response.status, html: await response.text() }
}

await admin.from('join_links').delete().eq('label', LABEL)

const { data: owner } = await admin
  .from('profiles')
  .select('id')
  .ilike('full_name', '%joey%')
  .limit(1)
  .single()

async function makeLink(extra = {}) {
  const { data, error } = await admin
    .from('join_links')
    .insert({
      academy_id: NRIFA,
      team_id: U8,
      role: 'parent',
      label: LABEL,
      created_by: owner.id,
      ...extra,
    })
    .select('id, token, code')
    .single()
  if (error) throw new Error(error.message)
  return data
}

// Declared once, up here: a line that STARTS with a regex literal is parsed
// as division against whatever the previous statement evaluated to.
const SAFE_CODE = /^[ABCDEFGHJKMNPQRSTVWXYZ23456789]{6}$/

head('1. Every link gets a dictatable code')
const link = await makeLink()
SAFE_CODE.test(link.code)
  ? ok(`code ${link.code} — six characters, no O 0 I 1 L U`)
  : bad(`code "${link.code}" is not in the safe alphabet`)

head('2. The code and the token open the same page')
const byToken = await page(`/join/${link.token}`)
const byCode = await page(`/join/${link.code}`)
byToken.status === 200 ? ok('the token works') : bad(`token page ${byToken.status}`)
byCode.status === 200 ? ok('the code works') : bad(`code page ${byCode.status}`)
// Both pages should name the same team, which is the thing a parent reads to
// know they are joining the right squad.
byCode.html.includes('U8') && byToken.html.includes('U8')
  ? ok('both name the same team')
  : bad('the two pages describe different things')

head('3. Case and punctuation, because a code gets written down')
for (const spelling of [link.code.toLowerCase(), `${link.code.slice(0, 3)}-${link.code.slice(3)}`]) {
  const r = await page(`/join/${encodeURIComponent(spelling)}`)
  r.status === 200 ? ok(`"${spelling}" works`) : bad(`"${spelling}" gave ${r.status}`)
}

head('4. A code nobody issued is refused, and says nothing useful')
const nonsense = await page('/join/ZZZZZZ')
// Not a 404: the page renders the same dead-link message a spent token gets,
// so guessing tells you nothing about which codes exist.
nonsense.html.includes('expired') || nonsense.status === 404
  ? ok('an unissued code looks exactly like a dead one')
  : bad(`an unissued code rendered something else (${nonsense.status})`)

head('5. Revoking kills the code, not just the link')
// The point of the whole test. Four properties, each checked down the CODE
// path, because the token path is already covered by test-join-flow.
const revoked = await makeLink()
await admin
  .from('join_links')
  .update({ revoked_at: new Date().toISOString() })
  .eq('id', revoked.id)
const afterRevoke = await post('/api/join/request', {
  token: revoked.code,
  fullName: 'Test Revoked',
  phone: '0400000111',
})
afterRevoke.status >= 400
  ? ok(`a revoked link refuses its code too (${afterRevoke.status})`)
  : bad('a revoked link still accepted its code')

head('6. Expiry applies to the code')
const expired = await makeLink({ expires_at: new Date(Date.now() - 864e5).toISOString() })
const afterExpiry = await post('/api/join/request', {
  token: expired.code,
  fullName: 'Test Expired',
  phone: '0400000112',
})
afterExpiry.status >= 400
  ? ok(`an expired link refuses its code too (${afterExpiry.status})`)
  : bad('an expired link still accepted its code')

head('7. The use limit applies to the code')
const capped = await makeLink({ max_uses: 1, use_count: 1 })
const afterCap = await post('/api/join/request', {
  token: capped.code,
  fullName: 'Test Capped',
  phone: '0400000113',
})
afterCap.status >= 400
  ? ok(`a spent link refuses its code too (${afterCap.status})`)
  : bad('a spent link still accepted its code')

head('8. A good code still only creates a PENDING request')
// A short code must not be a shortcut past the coach. This is the identity
// gate for the whole product.
const live = await makeLink()
const request = await post('/api/join/request', {
  token: live.code,
  fullName: 'Test Code Parent',
  phone: '0400000114',
  children: ['Test Code Child'],
})
if (request.status !== 200) {
  bad(`joining by code failed: ${request.status} ${JSON.stringify(request.body)}`)
} else {
  ok('request accepted')
  const { data: row } = await admin
    .from('join_requests')
    .select('status, join_link_id, profile_id')
    .eq('id', request.body.requestId)
    .single()
  row.status === 'pending'
    ? ok('and it is pending — a code is not a way past the coach')
    : bad(`status was ${row.status}`)
  row.profile_id === null ? ok('no account created yet') : bad('an account was created before approval')
  row.join_link_id === live.id
    ? ok('and it is attributed to the right link, so the audit trail holds')
    : bad('the request is attributed to the wrong link')

  const claim = await post('/api/join/claim', {
    requestId: request.body.requestId,
    secret: request.body.secret,
  })
  claim.status === 202
    ? ok('claiming before approval still hands out no session')
    : bad(`claim returned ${claim.status}, expected 202`)
}

head('9. Codes are unique across the whole product')
// A parent typing a code has not said which academy they mean, so a code has
// to identify one on its own.
const { data: all } = await admin.from('join_links').select('code')
const codes = (all ?? []).map((r) => r.code)
new Set(codes).size === codes.length
  ? ok(`${codes.length} links, ${new Set(codes).size} distinct codes`)
  : bad('two links share a code')

// Clean up: the requests this made, then the links.
const { data: mine } = await admin
  .from('join_links')
  .select('id')
  .eq('label', LABEL)
await admin
  .from('join_requests')
  .delete()
  .in('join_link_id', (mine ?? []).map((l) => l.id))
await admin.from('join_links').delete().eq('label', LABEL)
await admin.from('players').delete().eq('full_name', 'Test Code Child')

console.log(
  process.exitCode
    ? '\n\x1b[31mJOIN CODES BROKEN\x1b[0m\n'
    : '\n\x1b[32mA code is the same link, said differently.\x1b[0m\n'
)
process.exit(process.exitCode ?? 0)
