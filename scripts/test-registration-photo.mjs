// Run: node --env-file=.env.local scripts/test-registration-photo.mjs
//   (the dev server on :3000; SHOTS=1 saves the screens at 375px)
//
// The registration brief, gap 2 (0263): the photo. On Inner West FC, a
// family registers from the public form's API and sends a passport-style
// photo with it: the service role keeps it in the private bucket under
// <club>/pending/<request>, where the club's coaches, its owner and its
// Registrar can see it and a parent or the Treasurer cannot. The queue shows
// it to the owner. Approval moves it to the player's own folder and onto
// the card; a decline deletes it. The club can require one: the public page
// says so, the form will not go on without it (the browser crops and
// resizes before sending), and approving a request without one is refused
// until the family adds it. Everything made here is removed and the club's
// setting put back.
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { signInBoth } from './_auth.mjs'
import { listAllUsers } from './_users.mjs'
import { resolveBaseUrl } from './_base-url.mjs'
import { createAccount, deleteAccount } from './_account.mjs'

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
mkdirSync('.cache', { recursive: true })

const IW = '00000000-0000-0000-0000-0000000a0009' // Inner West FC: club mode, no two-step
const SLUG = 'inner-west-fc'
const BUCKET = 'player-photos'
const TAG = 'Zz Photo'
const PHONE = '+61400009952'
const until = async (fn, ms = 20000, every = 1000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, every)) }
  return null
}
// The sign-up brief (12 Nov 2026): a family registers signed in. The family's
// session is the default for a post; the club's people pass theirs.
const FAMILY_EMAIL = 'photo.parent@squadroom-demo.test'
let familyCookie = ''
const post = async (path, body, cookie) => {
  const c = cookie ?? familyCookie
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(c ? { cookie: c } : {}) }, body: JSON.stringify(body) })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, ...json }
}

// A 300×400 portrait PNG — a plain ground with a darker oval — made here so
// the suite carries no binary. The form's picker crops and re-encodes it.
function portraitPng(w = 300, h = 400) {
  const crc32 = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)) } return (~c) >>> 0 }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
  }
  const rows = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    rows[y * (w * 3 + 1)] = 0
    for (let x = 0; x < w; x++) {
      const dx = (x - 150) / 90, dy = (y - 170) / 120
      const [r, g, b] = dx * dx + dy * dy < 1 ? [120, 90, 70] : [225, 228, 232]
      const o = y * (w * 3 + 1) + 1 + x * 3
      rows[o] = r; rows[o + 1] = g; rows[o + 2] = b
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}
const PNG = portraitPng()
const PNG_FILE = '.cache/zz-photo-face.png'
writeFileSync(PNG_FILE, PNG)
const dataUrl = `data:image/png;base64,${PNG.toString('base64')}`

const { data: clubBefore } = await admin.from('academies').select('photo_required').eq('id', IW).single()
// The public form allows twenty registrations an hour from one address; a
// run of suites from this machine is more than that. The throttle log is
// not demo data.
await admin.from('registration_attempts').delete().gte('created_at', '1970-01-01')

async function cleanup() {
  const { data: progs } = await admin.from('programs').select('id').eq('academy_id', IW).like('name', `${TAG} %`)
  for (const p of progs ?? []) {
    const { data: reqs } = await admin.from('registration_requests').select('id, photo_path').eq('program_id', p.id)
    for (const r of reqs ?? []) {
      await admin.storage.from(BUCKET).remove([`${IW}/pending/${r.id}.png`, `${IW}/pending/${r.id}.jpg`, ...(r.photo_path ? [r.photo_path] : [])])
      await admin.from('registration_requests').delete().eq('id', r.id)
    }
    await admin.from('programs').delete().eq('id', p.id)
  }
  const { data: kids } = await admin.from('players').select('id').eq('academy_id', IW).like('full_name', `${TAG} %`)
  for (const k of kids ?? []) {
    const { data: files } = await admin.storage.from(BUCKET).list(`${IW}/${k.id}`)
    if (files?.length) await admin.storage.from(BUCKET).remove(files.map((f) => `${IW}/${k.id}/${f.name}`))
    await admin.from('player_guardians').delete().eq('player_id', k.id)
    await admin.from('players').delete().eq('id', k.id)
  }
  const { data: users } = await listAllUsers(admin)
  const u = users?.users?.find((x) => x.phone === PHONE.replace('+', ''))
  if (u) await admin.auth.admin.deleteUser(u.id)
  await deleteAccount(admin, FAMILY_EMAIL)
  await admin.from('academies').update({ photo_required: clubBefore?.photo_required ?? false }).eq('id', IW)
}
await cleanup()
const family = await createAccount(BASE, { first: TAG, last: 'Parent', email: FAMILY_EMAIL, mobile: PHONE })
familyCookie = family.cookie

const president = await signInBoth(admin, 'iw.president@squadroom-demo.test')
const coach = await signInBoth(admin, 'iw.coach@squadroom-demo.test')
const registrar = await signInBoth(admin, 'iw.registrar@squadroom-demo.test')
const parent = await signInBoth(admin, 'iw.parent@squadroom-demo.test')
const treasurer = await signInBoth(admin, 'iw.treasurer@squadroom-demo.test')
if (!president || !coach || !registrar || !parent || !treasurer) { console.log("  could not sign in — the project's auth rate limit, not a failure"); process.exit(2) }
const cookie = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(president.session)).toString('base64')}`

const { data: program } = await admin.from('programs').insert({
  academy_id: IW, name: `${TAG} Squad`, kind: 'squad', status: 'open', season: '2026', created_by: president.session.user.id,
  payment_required: false, born_from_year: 2015, born_to_year: 2018,
}).select('id').single()
const { data: pub } = await admin.rpc('public_programs', { p_slug: SLUG })
const consents = (pub?.consents ?? []).map((c) => ({ id: c.id, version: c.version }))

const canSign = async (who, path) => { const { data, error } = await who.client.storage.from(BUCKET).createSignedUrl(path, 60); return Boolean(data?.signedUrl) && !error }
const inPending = async (requestId) => { const { data } = await admin.storage.from(BUCKET).list(`${IW}/pending`, { limit: 1000 }); return (data ?? []).some((f) => f.name.startsWith(requestId)) }
const register = async (child, dob) => post('/api/register/request', { slug: SLUG, programId: program.id, guardianName: `${TAG} Parent`, guardianPhone: PHONE, guardianEmail: 'photo.parent@example.com', childName: child, childDob: dob, consents })

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
async function open(who, path, scheme, { org = IW, seed } = {}) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 375, height: 812 })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }])
  if (who?.session) await page.setCookie({ name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(who.session)).toString('base64'), domain: 'localhost', path: '/' })
  else if (who?.browserCookies) await page.setCookie(...who.browserCookies)
  await page.evaluateOnNewDocument((o, s) => { try { if (o) localStorage.setItem('squadroom.org', o); for (const [k, v] of Object.entries(s ?? {})) localStorage.setItem(k, v) } catch {} }, org, seed ?? {})
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 90000 })
  return { page, context }
}
// The dev server's first compile of a page can hand back a near-empty frame.
async function waitFor(page, selector, ms = 45000) {
  const found = await page.waitForSelector(selector, { timeout: ms }).catch(() => null)
  if (found) return found
  await page.reload({ waitUntil: 'networkidle2', timeout: 90000 })
  return page.waitForSelector(selector, { timeout: ms }).catch(() => null)
}
const fits = (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1)
const shot = (page, name) => SHOTS ? page.screenshot({ path: `.shots/registration-photo-${name}.png`, fullPage: true }) : null

const ONE = `${TAG} Child One`, TWO = `${TAG} Child Two`, THREE = `${TAG} Child Three`
let one = null, two = null, three = null, oneKid = null
try {
  head('1. The photo rides with the registration, into the club\'s pending folder')
  one = await register(ONE, '2016-03-03')
  one.status === 200 ? ok(`registered ${ONE}`) : bad(`request: ${one.status} ${one.error ?? ''}`)
  const up = await post('/api/register/photo', { requestId: one.requestId, secret: one.secret, image: dataUrl })
  const pendingPath = `${IW}/pending/${one.requestId}.png`
  up.status === 200 && up.path === pendingPath ? ok(`kept at ${pendingPath.replace(IW, '<club>')}`) : bad(`photo: ${up.status} ${up.error ?? JSON.stringify(up)}`)
  const { data: row1 } = await admin.from('registration_requests').select('photo_path').eq('id', one.requestId).single()
  row1?.photo_path === pendingPath && (await inPending(one.requestId)) ? ok('the request points at it and the object is there') : bad(`row ${JSON.stringify(row1)}, in bucket ${await inPending(one.requestId)}`)
  const wrong = await post('/api/register/photo', { requestId: one.requestId, secret: 'not-the-secret', image: dataUrl })
  const notImage = await post('/api/register/photo', { requestId: one.requestId, secret: one.secret, image: 'data:text/html;base64,PGh0bWw+PC9odG1sPg==' })
  const empty = await post('/api/register/photo', { requestId: one.requestId, secret: one.secret, image: 'data:image/png;base64,AAAA' })
  wrong.status === 404 && notImage.status === 400 && empty.status === 400 ? ok('the wrong secret, a non-image and an empty one are refused') : bad(`wrong ${wrong.status}, non-image ${notImage.status}, empty ${empty.status}`)
  const again = await post('/api/register/photo', { requestId: one.requestId, secret: one.secret, image: dataUrl })
  const { data: files } = await admin.storage.from(BUCKET).list(`${IW}/pending`, { limit: 1000 })
  again.status === 200 && (files ?? []).filter((f) => f.name.startsWith(one.requestId)).length === 1 ? ok('sent again, it replaces: one object for the request') : bad(`again ${again.status}; ${(files ?? []).filter((f) => f.name.startsWith(one.requestId)).length} objects`)

  head('2. While it waits: the club\'s coaches, owner and Registrar see it; a parent and the Treasurer do not')
  const seen = { coach: await canSign(coach, pendingPath), owner: await canSign(president, pendingPath), registrar: await canSign(registrar, pendingPath), parent: await canSign(parent, pendingPath), treasurer: await canSign(treasurer, pendingPath) }
  seen.coach && seen.owner && seen.registrar ? ok('the coach, the owner and the Registrar can open it') : bad(`coach ${seen.coach}, owner ${seen.owner}, registrar ${seen.registrar}`)
  !seen.parent && !seen.treasurer ? ok('a parent and the Treasurer cannot') : bad(`parent ${seen.parent}, treasurer ${seen.treasurer}`)
  const { data: signed } = await coach.client.storage.from(BUCKET).createSignedUrl(pendingPath, 60)
  const got = signed?.signedUrl ? await fetch(signed.signedUrl) : null
  got?.ok && (got.headers.get('content-type') ?? '').startsWith('image/') ? ok('and the coach\'s link serves the picture') : bad(`signed fetch: ${got?.status}`)
  const { data: anonList, error: anonErr } = await createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } }).storage.from(BUCKET).list(`${IW}/pending`)
  !anonList?.length || anonErr ? ok('a stranger lists nothing in the folder') : bad(`anon listed ${anonList.length}`)

  head('3. The queue shows the owner the photo')
  {
    const { page, context } = await open(president, '/admin/registrations', 'dark')
    const row = await waitFor(page, `xpath/.//button[contains(., ${JSON.stringify(ONE)})]`)
    if (!row) bad('the request never appeared in the queue')
    else {
      await row.click()
      const img = await page.waitForSelector('[data-request-photo="shown"] img', { timeout: 30000 }).catch(() => null)
      // The element is not the proof; the picture arriving through the
      // owner's signed link is.
      const loaded = img ? await page.waitForFunction(() => { const i = document.querySelector('[data-request-photo="shown"] img'); return Boolean(i && i.complete && i.naturalWidth > 0) }, { timeout: 20000 }).then(() => true).catch(() => false) : false
      img && loaded && (await fits(page)) ? ok('opened the request: the photo is shown, 375px dark') : bad(`photo block: ${await page.evaluate(() => document.querySelector('[data-request-photo]')?.getAttribute('data-request-photo') ?? 'absent')}, loaded ${loaded}, fits ${await fits(page)}`)
      await shot(page, 'queue-dark')
    }
    await context.close()
  }

  head('4. Approved: the photo moves to the player and onto the card')
  const a = await post('/api/register/approve', { requestId: one.requestId, decision: 'approve' }, cookie)
  a.status === 200 ? ok(`approved ${ONE}`) : bad(`approve: ${a.status} ${a.error ?? ''}`)
  const { data: kid } = await admin.from('players').select('id, photo_url').eq('academy_id', IW).eq('full_name', ONE).maybeSingle()
  oneKid = kid
  const dest = kid ? `${IW}/${kid.id}/registration.png` : null
  kid?.photo_url === dest ? ok(`players.photo_url is <club>/<player>/registration.png`) : bad(`player ${JSON.stringify(kid)}`)
  const { data: moved } = kid ? await admin.storage.from(BUCKET).list(`${IW}/${kid.id}`) : { data: [] }
  ;(moved ?? []).some((f) => f.name === 'registration.png') && !(await inPending(one.requestId)) ? ok('the object moved: in the player\'s folder, gone from pending') : bad(`player folder ${JSON.stringify((moved ?? []).map((f) => f.name))}, still pending ${await inPending(one.requestId)}`)
  const { data: card } = kid ? await coach.client.rpc('player_card', { p_player: kid.id }) : { data: null }
  card?.photo_path === dest ? ok('the card names it') : bad(`card: ${JSON.stringify(card)?.slice(0, 160)}`)
  kid && (await canSign(coach, dest)) && !(await canSign(parent, dest)) ? ok('the coach may open it; a parent who is not this child\'s may not') : bad('card photo visibility')
  const late = await post('/api/register/photo', { requestId: one.requestId, secret: one.secret, image: dataUrl })
  late.status === 409 ? ok('a photo for a decided request is refused') : bad(`late photo: ${late.status}`)
  if (kid) {
    const { page, context } = await open(coach, `/card/${kid.id}`, 'light')
    const img = await waitFor(page, `img[alt=${JSON.stringify(ONE)}]`)
    const src = img ? await img.evaluate((el) => el.getAttribute('src') ?? '') : ''
    img && src.includes(BUCKET) && (await fits(page)) ? ok('the card page shows it, 375px light') : bad(`card page img ${Boolean(img)} src ${src.slice(0, 60)} fits ${await fits(page)}`)
    await shot(page, 'card-light')
    await context.close()
  }

  head('5. Declined: the photo is deleted')
  two = await register(TWO, '2017-04-04')
  await post('/api/register/photo', { requestId: two.requestId, secret: two.secret, image: dataUrl })
  const before = await inPending(two.requestId)
  const d = await post('/api/register/approve', { requestId: two.requestId, decision: 'decline', note: 'Zz: full' }, cookie)
  const { data: row2 } = await admin.from('registration_requests').select('photo_path, status').eq('id', two.requestId).single()
  before && d.status === 200 && row2?.status === 'declined' && row2.photo_path === null && !(await inPending(two.requestId)) ? ok('declined: the object is gone and the request points at nothing') : bad(`before ${before}, decline ${d.status}, row ${JSON.stringify(row2)}, pending ${await inPending(two.requestId)}`)

  head('6. The club can require a photo')
  {
    const { page, context } = await open(president, '/settings/academy', 'light')
    const box = await waitFor(page, '[data-photo-required]')
    if (!box) bad('no "A photo is required" switch on Settings → Club')
    else {
      await shot(page, 'settings-light')
      await box.click()
      const on = await until(async () => { const { data } = await admin.from('academies').select('photo_required').eq('id', IW).single(); return data?.photo_required ? data : null }, 15000, 500)
      on && (await fits(page)) ? ok('ticked by the owner: academies.photo_required is true, 375px light') : bad(`photo_required after the tick: ${JSON.stringify(on)}`)
    }
    await context.close()
    const dark = await open(president, '/settings/academy', 'dark')
    const box2 = await waitFor(dark.page, '[data-photo-required]')
    box2 && (await box2.evaluate((el) => el.checked)) && (await fits(dark.page)) ? ok('and reads ticked in dark') : bad('dark settings')
    await shot(dark.page, 'settings-dark')
    await dark.context.close()
  }
  const { data: pub2 } = await admin.rpc('public_programs', { p_slug: SLUG })
  pub2?.academy?.photo_required === true ? ok('the public page says so') : bad(`public_programs academy: ${JSON.stringify(pub2?.academy)}`)
  const { data: pubParent } = await parent.client.from('academies').select('photo_required').eq('id', IW).single()
  const { error: parentWrite } = await parent.client.from('academies').update({ photo_required: false }).eq('id', IW).select('id')
  const { data: stillOn } = await admin.from('academies').select('photo_required').eq('id', IW).single()
  ;(pubParent?.photo_required === true || pubParent === null) && stillOn?.photo_required === true ? ok(`a parent cannot turn it off${parentWrite ? ` (${parentWrite.code})` : ''}`) : bad(`parent write: ${JSON.stringify(parentWrite)}, now ${JSON.stringify(stillOn)}`)

  three = await register(THREE, '2015-05-05')
  const refused = await post('/api/register/approve', { requestId: three.requestId, decision: 'approve' }, cookie)
  refused.status === 422 && /no photo yet/.test(refused.error ?? '') ? ok(`approving without a photo is refused: "${refused.error.slice(0, 60)}…"`) : bad(`approve without photo: ${refused.status} ${refused.error ?? ''}`)
  const { data: still } = await admin.from('registration_requests').select('status').eq('id', three.requestId).single()
  still?.status === 'pending' ? ok('and the request still waits') : bad(`status ${still?.status}`)
  await post('/api/register/photo', { requestId: three.requestId, secret: three.secret, image: dataUrl })
  const a3 = await post('/api/register/approve', { requestId: three.requestId, decision: 'approve' }, cookie)
  const { data: kid3 } = await admin.from('players').select('id, photo_url').eq('academy_id', IW).eq('full_name', THREE).maybeSingle()
  a3.status === 200 && kid3?.photo_url === `${IW}/${kid3.id}/registration.png` ? ok('with the photo added, approved — and on the player') : bad(`approve after photo: ${a3.status} ${a3.error ?? ''}; ${JSON.stringify(kid3)}`)

  head('7. The form: required, cropped in the browser, sent with the request')
  {
    const FOUR = `${TAG} Child Four`
    const draft = { step: 2, chosen: program.id, childName: FOUR, childDob: '2016-06-06', childGender: '', guardianName: `${TAG} Parent`, guardianPhone: PHONE, guardianEmail: 'photo.parent@example.com', answers: {}, agreed: Object.fromEntries((pub?.consents ?? []).map((c) => [c.id, true])), savedAt: Date.now() }
    // Signed in as the family (the sign-up brief): step 2 asks a stranger to create an account first.
    const { page, context } = await open(family, `/${SLUG}/register`, 'dark', { org: null, seed: { [`squadroom.draft.${SLUG}`]: JSON.stringify(draft) } })
    const step = await waitFor(page, '[data-photo-step]')
    const state = step ? await step.evaluate((el) => el.getAttribute('data-photo-step')) : 'absent'
    const nextDisabled = () => page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.previousElementSibling?.textContent?.trim() === 'Back')?.disabled ?? null)
    state === 'required' && (await nextDisabled()) === true ? ok('step 2 asks for the photo and will not go on without it') : bad(`photo step ${state}, continue disabled ${await nextDisabled()}`)
    const text = await page.evaluate(() => document.body.innerText)
    ;/face in full view/i.test(text) && /no hat or sunglasses/i.test(text) ? ok('the passport rules are on the screen') : bad('no rules text')
    await shot(page, 'form-step2-dark')
    const input = await page.$('[data-photo-input]')
    if (!input) bad('no file input')
    else {
      await input.uploadFile(PNG_FILE)
      const picked = await page.waitForSelector('[data-photo-step="picked"] [data-photo-preview]', { timeout: 30000 }).catch(() => null)
      const dims = picked ? await picked.evaluate((el) => new Promise((r) => { const i = new Image(); i.onload = () => r([i.naturalWidth, i.naturalHeight]); i.onerror = () => r(null); i.src = el.getAttribute('src') })) : null
      picked && dims && dims[0] === 600 && dims[1] === 800 && (await nextDisabled()) === false ? ok(`picked: cropped to ${dims[0]}×${dims[1]} in the browser, Continue enabled`) : bad(`picked ${Boolean(picked)} dims ${JSON.stringify(dims)} disabled ${await nextDisabled()}`)
      await shot(page, 'form-step2-picked-dark')
      await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.previousElementSibling?.textContent?.trim() === 'Back')?.click())
      const review = await page.waitForSelector('[data-photo-review]', { timeout: 15000 }).catch(() => null)
      review && (await fits(page)) ? ok('the review step shows the photo, 375px dark') : bad(`review ${Boolean(review)} fits ${await fits(page)}`)
      await shot(page, 'form-review-dark')
      await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Send to the club|Join the waitlist/.test(b.textContent ?? ''))?.click())
      await page.waitForFunction(() => document.body.innerText.includes('Sent to the club'), { timeout: 30000 }).catch(() => {})
      const req4 = await until(async () => { const { data } = await admin.from('registration_requests').select('id, photo_path').eq('program_id', program.id).eq('child_name', FOUR).maybeSingle(); return data?.photo_path ? data : null }, 20000, 1000)
      req4 && req4.photo_path === `${IW}/pending/${req4.id}.jpg` && (await inPending(req4.id)) ? ok('sent: the request and its JPEG are with the club') : bad(`request four: ${JSON.stringify(req4)}`)
      await shot(page, 'form-sent-dark')
    }
    await context.close()
  }
} catch (e) {
  bad(`threw: ${e.message}`)
} finally {
  await browser.close()
  await cleanup()
  const { count } = await admin.from('programs').select('id', { count: 'exact', head: true }).eq('academy_id', IW).like('name', `${TAG} %`)
  const { data: after } = await admin.from('academies').select('photo_required').eq('id', IW).single()
  const { data: left } = await admin.storage.from(BUCKET).list(`${IW}/pending`, { limit: 1000 })
  const ours = (left ?? []).filter((f) => [one, two, three].some((r) => r?.requestId && f.name.startsWith(r.requestId)))
  count === 0 && after?.photo_required === (clubBefore?.photo_required ?? false) && ours.length === 0 && !(oneKid && (await admin.storage.from(BUCKET).list(`${IW}/${oneKid.id}`)).data?.length) ? ok('everything made here is gone; the club\'s setting as it was') : bad(`${count} programs, photo_required ${after?.photo_required}, ${ours.length} pending objects left`)
}
console.log(process.exitCode ? '' : '\n  \x1b[32mthe photo: private until approved, then on the card; required when the club says\x1b[0m\n')
