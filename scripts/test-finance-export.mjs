// Run: node --env-file=.env.local scripts/test-finance-export.mjs
//   (the HTTP checks need the app running — npm run dev, or serve:test)
//
// B-05: the club's money as a spreadsheet — every fee per child, and the
// totals by program, squad and family — for the club's staff and nobody
// else.
import { createClient } from '@supabase/supabase-js'
import { resolveBaseUrl } from './_base-url.mjs'

const BASE = await resolveBaseUrl()
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
const ref = URL_.split('//')[1].split('.')[0]

async function session(profileId) {
  const { data: u } = await admin.auth.admin.getUserById(profileId)
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email: u.user.email })
  if (!link?.properties?.hashed_token) return null
  const client = createClient(URL_, PUB, { auth: { persistSession: false } })
  const { data } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
  if (!data?.session) return null
  return {
    client,
    cookie: `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(data.session)).toString('base64')}`,
  }
}
const owner = await session(OWNER)
const parent = await session(PARENT)
if (!owner || !parent) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}

// A fee of our own so the numbers are known: $100 to the U8s, two children
// of one family, one of them paid.
const U8 = '00000000-0000-0000-0000-0000000d0008'
await admin.from('payment_requests').delete().eq('academy_id', NRIFA).like('title', 'FINEXP %')
const { data: req } = await admin
  .from('payment_requests')
  .insert({ academy_id: NRIFA, title: 'FINEXP U8 kit levy', amount_cents: 10000, team_id: U8, created_by: OWNER, due_on: '2026-12-01' })
  .select('id')
  .single()
const { data: kids } = await admin.from('players').select('id, full_name').eq('team_id', U8).order('full_name').limit(2)
await admin.from('payments').insert({
  academy_id: NRIFA, request_id: req.id, player_id: kids[0].id, profile_id: PARENT,
  stripe_session_id: 'cs_test_finexp', stripe_payment_intent: 'pi_test_finexp', amount_cents: 10000,
  currency: 'aud', status: 'paid', paid_at: new Date().toISOString(), instalment_seq: 1,
})

const parseCsv = (text) =>
  text.trim().split(/\r?\n/).map((line) => {
    const out = []
    let cur = '', q = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (q) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
        else if (ch === '"') q = false
        else cur += ch
      } else if (ch === '"') q = true
      else if (ch === ',') { out.push(cur); cur = '' }
      else cur += ch
    }
    out.push(cur)
    return out
  })

head('1. The function: staff only')
{
  const { data, error } = await owner.client.rpc('finance_export', { p_academy: NRIFA })
  error ? bad(`owner: ${error.message}`) : ok(`${data.length} rows for the owner`)
  const mine = (data ?? []).filter((r) => r.title === 'FINEXP U8 kit levy')
  const paid = mine.find((r) => r.player_id === kids[0].id)
  paid?.paid_cents === 10000 && paid?.outstanding_cents === 0 && paid?.status === 'paid' && paid?.stripe_payment_intents === 'pi_test_finexp'
    ? ok(`${kids[0].full_name}: paid $100, pi_test_finexp`)
    : bad(`paid row: ${JSON.stringify(paid)}`)
  const owed = mine.find((r) => r.player_id === kids[1].id)
  owed?.paid_cents === 0 && owed?.outstanding_cents === owed?.net_cents && owed?.status === 'unpaid'
    ? ok(`${kids[1].full_name}: owes ${(owed.net_cents / 100).toFixed(2)}`)
    : bad(`owed row: ${JSON.stringify(owed)}`)
  mine[0]?.scope_kind === 'team' && mine[0]?.scope_name === 'U8 SPL' ? ok('scoped to the U8 SPL squad') : bad(`scope: ${mine[0]?.scope_kind} ${mine[0]?.scope_name}`)
  const { error: pErr } = await parent.client.rpc('finance_export', { p_academy: NRIFA })
  pErr?.code === '42501' ? ok('a parent is refused') : bad(pErr ? pErr.message : 'a parent read the finances')
}

head('2. The spreadsheet')
try {
  const res = await fetch(`${BASE}/api/export/finance?academyId=${NRIFA}&view=detail`, { headers: { cookie: owner.cookie } })
  res.status === 200 && /text\/csv/.test(res.headers.get('content-type') ?? '') ? ok('200, text/csv') : bad(`${res.status} ${res.headers.get('content-type')}`)
  // Named, because a line starting with /regex/ is read as division.
  const dated = /attachment; filename="fees-\d{4}-\d{2}-\d{2}\.csv"/
  dated.test(res.headers.get('content-disposition') ?? '') ? ok('named by date') : bad(`disposition: ${res.headers.get('content-disposition')}`)
  const rows = parseCsv(await res.text())
  rows[0][0] === 'Fee' && rows[0].includes('Stripe payment ids') ? ok(`header: ${rows[0].length} columns`) : bad(`header: ${rows[0].join('|')}`)
  const paidRow = rows.find((r) => r[0] === 'FINEXP U8 kit levy' && r[5] === kids[0].full_name)
  paidRow && paidRow[10] === '100.00' && paidRow[11] === '0.00' ? ok('amounts as dollars with two places') : bad(`row: ${paidRow?.join('|')}`)
  // The four money columns only — a timestamp has milliseconds and is not
  // money.
  const moneyCells = rows.slice(1).flatMap((r) => r.slice(8, 12))
  const anyFloatGarbage = moneyCells.some((c) => !/^\d+\.\d{2}$/.test(c))
  anyFloatGarbage ? bad(`a money cell is not dollars.cents: ${moneyCells.find((c) => !/^\d+\.\d{2}$/.test(c))}`) : ok('every money cell is dollars with two places')

  const sum = await fetch(`${BASE}/api/export/finance?academyId=${NRIFA}&view=summary`, { headers: { cookie: owner.cookie } })
  const srows = parseCsv(await sum.text())
  const squad = srows.find((r) => r[0] === 'Squad' && r[1] === 'U8 SPL')
  const all = srows.find((r) => r[0] === 'All')
  squad && all ? ok(`summary has the U8 SPL squad and a grand total of ${all[3]} owed`) : bad(`summary rows: ${srows.slice(0, 4).map((r) => r.join('|')).join(' / ')}`)
  const detailOwed = rows.slice(1).reduce((n, r) => n + Math.round(Number(r[9]) * 100), 0)
  Math.round(Number(all?.[3]) * 100) === detailOwed ? ok('the grand total is the detail rows added up, to the cent') : bad(`summary ${all?.[3]} vs detail ${(detailOwed / 100).toFixed(2)}`)

  const asParent = await fetch(`${BASE}/api/export/finance?academyId=${NRIFA}`, { headers: { cookie: parent.cookie } })
  asParent.status === 403 ? ok('a parent gets 403') : bad(`parent → ${asParent.status}`)
  const nobody = await fetch(`${BASE}/api/export/finance?academyId=${NRIFA}`)
  nobody.status === 401 ? ok('a stranger gets 401') : bad(`stranger → ${nobody.status}`)
} catch (e) {
  bad(`no app at ${BASE}: ${e.message.slice(0, 60)}`)
}

await admin.from('payments').delete().eq('stripe_session_id', 'cs_test_finexp')
await admin.from('payment_requests').delete().eq('id', req.id)
console.log(process.exitCode ? '\n\x1b[31mFINANCE EXPORT IS WRONG\x1b[0m\n' : '\n\x1b[32mall good\x1b[0m\n')
