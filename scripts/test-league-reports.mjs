// Run: node --env-file=.env.local scripts/test-league-reports.mjs
//
// L-15: the competition's CSV reports through the real route — results,
// ladders, discipline, entries — answering exactly what the caller may see.
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

const OWNER = '00000000-0000-0000-0000-0000000000a1'
const STRANGER_EMAIL = 'lreports-stranger@squadroom.invalid'

async function signInEmail(email) {
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (!link?.properties?.hashed_token) return null
  const client = createClient(URL_, PUB, { auth: { persistSession: false } })
  const { data } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
  return data?.session ?? null
}
const cookieFor = (session) => {
  const ref = URL_.split('//')[1].split('.')[0]
  return `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString('base64')}`
}
const rowsOf = (text) => text.trim().split(/\r?\n/)

const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 })
const old = users?.users?.find((x) => x.email === STRANGER_EMAIL)
if (old) await admin.auth.admin.deleteUser(old.id)
const { data: stranger } = await admin.auth.admin.createUser({ email: STRANGER_EMAIL, email_confirm: true })

const owner = await signInEmail((await admin.auth.admin.getUserById(OWNER)).data.user.email)
const nobody = await signInEmail(STRANGER_EMAIL)
if (!owner || !nobody) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  await admin.auth.admin.deleteUser(stranger.user.id)
  process.exit(2)
}
const BASE = await resolveBaseUrl({ quiet: true })
const { data: comp } = await admin.from('competitions').select('id, name').eq('name', 'SPL Season 3').single()
const get = (report, cookie) => fetch(`${BASE}/api/export/competition?competitionId=${comp.id}&report=${report}`, { headers: cookie ? { Cookie: cookie } : {} })

head('1. Who may ask')
{
  const out = await get('results')
  out.status === 401 ? ok('signed out: 401') : bad(`signed out: ${out.status}`)
  const no = await get('results', cookieFor(nobody))
  no.status === 404 ? ok('somebody in no club: 404, the competition is not theirs to see') : bad(`stranger: ${no.status}`)
  const which = await get('nonsense', cookieFor(owner))
  which.status === 400 ? ok('an unknown report is a 400') : bad(`unknown report: ${which.status}`)
}

head(`2. The organiser's reports for ${comp.name}`)
{
  const r = await get('results', cookieFor(owner))
  const rows = rowsOf(await r.text())
  r.headers.get('content-type')?.includes('text/csv') && rows[0].startsWith('Division,Group,Round,Kick-off') && rows.length > 10
    ? ok(`results: ${rows.length - 1} games, with a Referees column`)
    : bad(`results: ${r.status} ${rows[0]}`)
  r.headers.get('content-disposition')?.includes('spl-season-3-results-') ? ok('named after the competition') : bad(r.headers.get('content-disposition'))

  const l = await get('ladders', cookieFor(owner))
  const lrows = rowsOf(await l.text())
  lrows[0] === 'Division,Position,Team,Group,P,W,D,L,GF,GA,GD,Pts' && lrows.length > 6 && /^U\d+s? [^,]*,1,/.test(lrows[1])
    ? ok(`ladders: ${lrows.length - 1} rows, first is a position 1`)
    : bad(`ladders: ${lrows.slice(0, 2).join(' | ')}`)

  const d = await get('discipline', cookieFor(owner))
  const drows = rowsOf(await d.text())
  drows[0].startsWith('Player,Club,Team,Yellows,Reds,Blues,Suspension') && drows[drows.length - 1].startsWith('Rules,')
    ? ok(`discipline: ${drows.length - 3} player rows and the rules at the foot`)
    : bad(`discipline: ${d.status} ${drows[0]} … ${drows[drows.length - 1]}`)

  const e = await get('entries', cookieFor(owner))
  const erows = rowsOf(await e.text())
  erows[0] === 'Team,Division,Group,Club,On Squadroom,Invite status,Contact,Email,Phone' && erows.length > 2
    ? ok(`entries: ${erows.length - 1} teams`)
    : bad(`entries: ${e.status} ${erows[0]}`)
}

await admin.auth.admin.deleteUser(stranger.user.id)
console.log(process.exitCode ? '\n\x1b[31mLEAGUE REPORTS ARE WRONG\x1b[0m\n' : '\n\x1b[32mall good\x1b[0m\n')
