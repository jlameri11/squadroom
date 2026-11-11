// Run: node --env-file=.env.local scripts/test-registrations-csv.mjs
//   (needs the app running — npm run dev, or serve:test; SHOTS=1 saves the
//   Registrations screen at 375px, light and dark)
//
// Part C item 5 (0259): the registrations as a spreadsheet, answers and
// all. A throwaway camp on NRIFA with three questions and two requests, a
// second program with one: the owner downloads the whole club's file and
// one program's; a column per question headed by its label; the answers as
// a person would write them; a parent is refused; the Registrations screen
// carries the link. Everything made here is deleted.
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'
import { signInBoth } from './_auth.mjs'
import { resolveBaseUrl } from './_base-url.mjs'

const BASE = await resolveBaseUrl()
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const ref = URL_.split('//')[1].split('.')[0]
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SHOTS = process.env.SHOTS === '1'
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const head = (m) => console.log(`\n${m}`)
if (SHOTS) mkdirSync('.shots', { recursive: true })

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const OWNER = '00000000-0000-0000-0000-0000000000a1'
const TAG = 'Zz CSV'

async function cleanup() {
  const { data: progs } = await admin.from('programs').select('id').eq('academy_id', NRIFA).like('name', `${TAG} %`)
  for (const p of progs ?? []) {
    await admin.from('registration_requests').delete().eq('program_id', p.id)
    await admin.from('programs').delete().eq('id', p.id)
  }
}
await cleanup()

const { data: camp } = await admin.from('programs').insert({
  academy_id: NRIFA, name: `${TAG} Camp`, kind: 'camp', status: 'open', season: '2026', created_by: OWNER,
  questions: [
    { id: 'school', label: 'Which school?', type: 'text' },
    { id: 'swim', label: 'Can they swim?', type: 'yesno', required: true },
    { id: 'size', label: 'Jacket size', type: 'choice', options: ['S', 'M', 'L'] },
  ],
}).select('id').single()
const { data: other } = await admin.from('programs').insert({ academy_id: NRIFA, name: `${TAG} Other`, kind: 'camp', status: 'open', season: '2026', created_by: OWNER }).select('id').single()
const inWeek = new Date(Date.now() + 7 * 864e5).toISOString()
// Every row with every key: supabase-js sends null for a key one row lacks,
// and answers and consents are not-null columns.
const { error: reqErr } = await admin.from('registration_requests').insert([
  { academy_id: NRIFA, program_id: camp.id, guardian_name: 'Zz Guardian One', guardian_phone: '+61400009911', guardian_email: 'zz-one@squadroom.invalid', child_name: 'Zz Child One', child_dob: '2017-03-03', answers: { school: 'Summer Hill PS', swim: true, size: 'M' }, consents: [{ id: 'code_of_conduct', accepted_at: '2026-11-11T00:00:00Z' }], secret_hash: 'zz1', expires_at: inWeek },
  { academy_id: NRIFA, program_id: camp.id, guardian_name: 'Zz Guardian Two', guardian_phone: null, guardian_email: null, child_name: 'Zz Child, Two', child_dob: '2016-04-04', answers: { school: 'Dulwich Hill "Public"', swim: false }, consents: [], secret_hash: 'zz2', expires_at: inWeek },
  { academy_id: NRIFA, program_id: other.id, guardian_name: 'Zz Guardian Three', guardian_phone: null, guardian_email: null, child_name: 'Zz Child Three', child_dob: '2015-05-05', answers: {}, consents: [], secret_hash: 'zz3', expires_at: inWeek },
])
if (reqErr) { console.log(`  could not make the requests: ${reqErr.message}`); await cleanup(); process.exit(1) }

const headOf = await signInBoth(admin, 'head@squadroom-demo.test')
const sam = await signInBoth(admin, 'p61400000011@squadroom.invalid')
if (!headOf || !sam) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  await cleanup()
  process.exit(2)
}
const cookieOf = (who) => `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(who.session)).toString('base64')}`
const get = (path, who) => fetch(`${BASE}${path}`, { headers: who ? { Cookie: cookieOf(who) } : {} })
const parse = (text) => text.trim().split('\r\n').map((line) => {
  const out = []; let cur = ''; let q = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ } else if (ch === '"') q = false; else cur += ch }
    else if (ch === '"') q = true
    else if (ch === ',') { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out
})

try {
  head('1. The whole club, as the owner')
  {
    const res = await get(`/api/export/registrations?academyId=${NRIFA}`, headOf)
    const text = await res.text()
    res.status === 200 && /text\/csv/.test(res.headers.get('content-type') ?? '') ? ok(`200, text/csv, ${text.length} bytes`) : bad(`${res.status} ${res.headers.get('content-type')}: ${text.slice(0, 120)}`)
    const rows = parse(text)
    const header = rows[0]
    const col = (name) => header.indexOf(name)
    ;['Program', 'Child', 'Date of birth', 'Guardian', 'Consents', 'Which school?', 'Can they swim?', 'Jacket size'].every((h) => col(h) >= 0)
      ? ok('a column per question, headed by its label, after the fixed columns')
      : bad(`header: ${header.join(' | ')}`)
    const one = rows.find((r) => r[col('Child')] === 'Zz Child One')
    const two = rows.find((r) => r[col('Child')] === 'Zz Child, Two')
    const three = rows.find((r) => r[col('Child')] === 'Zz Child Three')
    one && one[col('Which school?')] === 'Summer Hill PS' && one[col('Can they swim?')] === 'Yes' && one[col('Jacket size')] === 'M'
      ? ok('Zz Child One: Summer Hill PS · Yes · M') : bad(`row one: ${JSON.stringify(one)}`)
    one && one[col('Guardian phone')] === '+61400009911' && one[col('Guardian email')] === 'zz-one@squadroom.invalid' && one[col('Consents')] === 'code_of_conduct 2026-11-11'
      ? ok('the guardian\'s phone and email, the consent with its day') : bad(`row one guardian: ${JSON.stringify(one)}`)
    two && two[col('Which school?')] === 'Dulwich Hill "Public"' && two[col('Can they swim?')] === 'No' && two[col('Jacket size')] === ''
      ? ok('a comma in a name and quotes in an answer survive; an unanswered question is blank') : bad(`row two: ${JSON.stringify(two)}`)
    three && three[col('Program')] === `${TAG} Other` && three[col('Which school?')] === ''
      ? ok('the other program\'s request is in the club file, with no answer to a question it never asked') : bad(`row three: ${JSON.stringify(three)}`)
  }

  head('2. One program; a parent refused')
  {
    const res = await get(`/api/export/registrations?academyId=${NRIFA}&programId=${camp.id}`, headOf)
    const rows = parse(await res.text())
    const children = rows.slice(1).map((r) => r[rows[0].indexOf('Child')])
    res.status === 200 && children.length === 2 && !children.includes('Zz Child Three') ? ok(`the camp's file: ${children.join(', ')}`) : bad(`program file: ${res.status} ${JSON.stringify(children)}`)
    const named = /filename="registrations-program-/.test(res.headers.get('content-disposition') ?? '')
    named ? ok('named for one program') : bad(`disposition: ${res.headers.get('content-disposition')}`)
    const parent = await get(`/api/export/registrations?academyId=${NRIFA}`, sam)
    parent.status === 403 ? ok('a parent is refused (403)') : bad(`a parent got ${parent.status}`)
    const nobody = await get(`/api/export/registrations?academyId=${NRIFA}`)
    nobody.status === 401 ? ok('signed out, 401') : bad(`signed out got ${nobody.status}`)
  }

  head('3. The link on the Registrations screen')
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
  try {
    for (const scheme of ['light', 'dark']) {
      const context = await browser.createBrowserContext()
      const page = await context.newPage()
      await page.setViewport({ width: 375, height: 812 })
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }])
      await page.setCookie({ name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(headOf.session)).toString('base64'), domain: 'localhost', path: '/' })
      await page.evaluateOnNewDocument((o) => { try { localStorage.setItem('squadroom.org', o) } catch {} }, NRIFA)
      await page.goto(`${BASE}/admin/registrations`, { waitUntil: 'networkidle2', timeout: 90000 })
      const href = await page.waitForSelector('[data-registrations-csv]', { timeout: 30000 }).then((el) => el.evaluate((a) => a.getAttribute('href'))).catch(() => null)
      const fits = await page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1)
      href && href.includes(`/api/export/registrations?academyId=${NRIFA}`) && fits ? ok(`${scheme}: "Download the spreadsheet" links to the file, 375px`) : bad(`${scheme}: href ${href}, fits ${fits}`)
      if (SHOTS) await page.screenshot({ path: `.shots/registrations-csv-${scheme}.png`, fullPage: true })
      await context.close()
    }
  } finally {
    await browser.close()
  }
} catch (e) {
  bad(`threw: ${e.message}`)
} finally {
  await cleanup()
  const { count } = await admin.from('programs').select('id', { count: 'exact', head: true }).eq('academy_id', NRIFA).like('name', `${TAG} %`)
  count === 0 ? ok('everything made here is gone') : bad(`${count} programs left behind`)
}
console.log(process.exitCode ? '' : '\n  \x1b[32mthe registrations as a spreadsheet, answers and all\x1b[0m\n')
