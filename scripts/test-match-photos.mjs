// Run: node --env-file=.env.local scripts/test-match-photos.mjs
//   (needs the app running — npm run dev, or serve:test; SHOTS=1 saves the
//   screens at 375px, light and dark, in .shots/)
//
// M5's last piece, the game in pictures (0223): the squad's coach adds a
// game's photos, the squad's people see them on the Match sheet, anyone in
// the squad can take one down at once, the coach is told and puts it back
// or deletes it.
//
// Two halves, like test-returning-offers. The screens are checked now, in a
// browser at 375px in light and dark, with 0223's answers and the photo
// bucket stood in by request interception: the coach picks photos and is
// shown who must not be photographed before anything is sent; the grid,
// the viewer, "Take it down" asking first, a photo taken down as the coach
// sees it. The rest — real files through the Storage API, who may add, the
// one push, a take-down hiding the file itself, a delete removing it — runs
// against squadroom-dev once 0223 is applied, and says it is waiting until
// then. test-rls 141–145 prove the database half locally meanwhile.
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { signInBoth } from './_auth.mjs'
import { resolveBaseUrl } from './_base-url.mjs'

const BASE = await resolveBaseUrl()
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const ref = URL_.split('//')[1].split('.')[0]
const host = new URL(URL_).host
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SHOTS = process.env.SHOTS === '1'
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const note = (m) => console.log(`  \x1b[2m… ${m}\x1b[0m`)
const head = (m) => console.log(`\n${m}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const OWNER = '00000000-0000-0000-0000-0000000000a1'
const MARCUS = '00000000-0000-0000-0000-0000000000a2'
const U8 = '00000000-0000-0000-0000-0000000d0008'
const TAG = 'TEST:: photos'

const coach = await signInBoth(admin, 'p61400000002@squadroom.invalid')
const parent = await signInBoth(admin, 'p61400000011@squadroom.invalid')
const ravens = await signInBoth(admin, 'p61400000091@squadroom.invalid')
if (!coach || !parent || !ravens) {
  console.log("  could not sign in — the project's auth rate limit, not a failure")
  process.exit(2)
}
const { error: no0223 } = await admin.from('event_photos').select('id').limit(1)
const has0223 = !no0223
if (SHOTS) mkdirSync('.shots', { recursive: true })
mkdirSync('.cache', { recursive: true })

// Marcus coaches U8 with a current check, as test-matchdays arranges it.
const { data: cl } = await admin.from('staff_clearances').select('id').eq('academy_id', NRIFA).eq('profile_id', MARCUS).maybeSingle()
const addedClearance = !cl
if (addedClearance) await admin.from('staff_clearances').insert({ academy_id: NRIFA, profile_id: MARCUS, kind: 'wwcc', number: 'WWC0000002E', outcome: 'cleared', expires_on: new Date(Date.now() + 400 * 864e5).toISOString().slice(0, 10), verified_by: OWNER })
const { data: mc } = await admin.from('team_members').select('role').eq('team_id', U8).eq('profile_id', MARCUS).maybeSingle()
const addedCoach = !mc
if (addedCoach) await admin.from('team_members').insert({ academy_id: NRIFA, team_id: U8, profile_id: MARCUS, role: 'coach' })

async function tidy() {
  const { data: evs } = await admin.from('events').select('id').like('title', `${TAG}%`)
  for (const e of evs ?? []) {
    await admin.from('notification_queue').delete().filter('payload->>event_id', 'eq', e.id)
    if (has0223) {
      const { data: files } = await admin.storage.from('match-photos').list(`${NRIFA}/${e.id}`)
      if (files?.length) await admin.storage.from('match-photos').remove(files.map((f) => `${NRIFA}/${e.id}/${f.name}`))
    }
  }
  await admin.from('events').delete().like('title', `${TAG}%`)
}
await tidy()
const played = new Date(Date.now() - 2 * 864e5)
const { data: ev } = await admin.from('events').insert({ academy_id: NRIFA, team_id: U8, type: 'match', title: `${TAG} v Hornsby`, opponent: 'Hornsby Heat', starts_at: played.toISOString(), ends_at: new Date(played.getTime() + 3600e3).toISOString(), our_score: 2, their_score: 1, created_by: OWNER }).select('id').single()

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })

// Two real JPEGs to pick, drawn by the browser.
const pics = []
{
  const p = await browser.newPage()
  for (const [i, bg] of ['linear-gradient(135deg,#2f855a,#9ae6b4)', 'linear-gradient(135deg,#2b6cb0,#90cdf4)'].entries()) {
    await p.setViewport({ width: 800, height: 600 })
    await p.setContent(`<body style="margin:0"><div style="width:800px;height:600px;background:${bg}"></div></body>`)
    const buf = await p.screenshot({ type: 'jpeg', quality: 90 })
    const file = `.cache/test-photo-${i + 1}.jpg`
    writeFileSync(file, buf)
    pics.push({ file, buf })
  }
  await p.close()
}

/** A page as someone, at 375px; `answers` stands in for database functions, `bucket` for the photos bucket. */
async function open(who, path, answers = null, bucket = false) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 375, height: 812 })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
  await page.setCookie({ name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(who.session)).toString('base64'), domain: 'localhost', path: '/' })
  await page.evaluateOnNewDocument((org) => { try { localStorage.setItem('squadroom.org', org) } catch {} }, NRIFA)
  const calls = []
  if (answers || bucket) {
    await page.setRequestInterception(true)
    page.on('request', (r) => {
      const u = new URL(r.url())
      const cors = { 'access-control-allow-origin': '*' }
      if (u.host === host) {
        const fn = u.pathname.startsWith('/rest/v1/rpc/') ? u.pathname.slice('/rest/v1/rpc/'.length) : null
        if (answers && fn && fn in answers && r.method() === 'POST') {
          let body = {}
          try { body = JSON.parse(r.postData() ?? '{}') } catch {}
          calls.push({ fn, body })
          const value = typeof answers[fn] === 'function' ? answers[fn](body) : answers[fn]
          r.respond({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(value) }).catch(() => {})
          return
        }
        if (bucket && u.pathname.startsWith('/storage/v1/object/') && u.pathname.includes('/match-photos')) {
          const rest = u.pathname.slice('/storage/v1/object/'.length)
          if (r.method() === 'GET' && rest.startsWith('sign/match-photos/')) {
            // The picture behind a signed link: one of the two, by name.
            const buf = (rest.split('/').pop() ?? '').startsWith('b') ? pics[1].buf : pics[0].buf
            r.respond({ status: 200, contentType: 'image/jpeg', headers: cors, body: buf }).catch(() => {})
            return
          }
          if (r.method() === 'POST' && rest === 'sign/match-photos') {
            const { paths = [] } = JSON.parse(r.postData() ?? '{}')
            calls.push({ fn: 'sign', body: { paths } })
            r.respond({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(paths.map((p) => ({ path: p, signedURL: `/object/sign/match-photos/${p}?token=t`, error: null }))) }).catch(() => {})
            return
          }
          if (r.method() === 'POST' && rest.startsWith('sign/match-photos/')) {
            const p = rest.slice('sign/match-photos/'.length)
            r.respond({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ signedURL: `/object/sign/match-photos/${p}?token=t` }) }).catch(() => {})
            return
          }
          if (r.method() === 'POST' && rest.startsWith('match-photos/')) {
            const p = decodeURIComponent(rest.slice('match-photos/'.length))
            calls.push({ fn: 'upload', body: { path: p, type: r.headers()['content-type'] } })
            r.respond({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ Id: crypto.randomUUID(), Key: `match-photos/${p}` }) }).catch(() => {})
            return
          }
        }
      }
      r.continue().catch(() => {})
    })
  }
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 90000 })
  return { context, page, calls }
}
const text = (page) => page.evaluate(() => document.body.innerText)
const fits = (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1)
async function bothThemes(page, name) {
  let fitted = true
  for (const scheme of ['light', 'dark']) {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }])
    await sleep(250)
    fitted = fitted && (await fits(page))
    if (SHOTS) await page.screenshot({ path: `.shots/photos-${name}-${scheme}.png` })
  }
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
  return fitted
}
async function toPhotos(page) {
  await page.waitForSelector('[data-match-photos]', { timeout: 20000 }).catch(() => null)
  await page.$eval('[data-match-photos]', (el) => el.scrollIntoView({ block: 'start' })).catch(() => null)
  await sleep(300)
}

const dir = `${NRIFA}/${ev.id}`
const photo = (id, name, extra = {}) => ({ id, path: `${dir}/${name}.jpg`, thumb: `${dir}/${name}.thumb.jpg`, width: 800, height: 600, at: new Date().toISOString(), by: 'Marcus Obi', hidden: false, hidden_by: null, ...extra })
const consent = { applies: true, document: 'Photos and media', version: 1, squad_size: 6, refused: [{ player_id: 'x', name: 'Zoe Whitfield' }], not_answered: [], nobody_has_answered: false }

try {
  // ---------------------------------------------------------------------------
  head("1. The coach adds photos (0223's answers and the bucket stood in)")
  {
    let photos = [photo('00000000-0000-4000-8000-0000000000a1', 'a')]
    const { context, page, calls } = await open(coach, `/calendar/${ev.id}#sheet`, {
      match_photos: () => ({ can_add: true, played: true, limit: 60, consent, photos }),
      add_match_photos: (b) => {
        photos = [...photos, ...b.p_photos.map((p, i) => photo(`00000000-0000-4000-8000-0000000000b${i}`, 'b', { path: p.path, thumb: p.thumb ?? p.path }))]
        return { can_add: true, played: true, limit: 60, consent, photos }
      },
    }, true)
    await toPhotos(page)
    const grid = await page.$$('[data-photo]')
    grid.length === 1 ? ok('the game\'s photo is in the grid, on the Match sheet') : bad(`grid has ${grid.length}`)
    const signed = calls.filter((c) => c.fn === 'sign')
    signed.length >= 1 && signed[0].body.paths.every((p) => p.endsWith('.thumb.jpg')) ? ok('the grid asks for the small copies, in one request') : bad(`signed: ${JSON.stringify(signed)}`)
    ;(await page.$('[data-photos-ready]')) ? bad('something is ready before any photo was picked') : ok('nothing is sent or warned about before photos are picked')

    const input = await page.$('[data-photos-file]')
    await input.uploadFile(pics[0].file, pics[1].file)
    await page.waitForSelector('[data-photos-ready]', { timeout: 5000 }).catch(() => null)
    const t = await text(page)
    t.includes('2 photos ready') && t.includes('Zoe Whitfield must not be photographed') ? ok('picked: "2 photos ready", and who must not be in them, before anything is sent') : bad(`ready: ${t.slice(0, 300)}`)
    calls.some((c) => c.fn === 'upload') ? bad('a photo went before the coach said so') : ok('nothing has gone yet')
    ;(await bothThemes(page, 'ready')) ? ok('fits 375px, light and dark') : bad('wider than the phone')

    await page.$eval('[data-photos-add]', (b) => b.click())
    await page.waitForFunction(() => document.querySelectorAll('[data-photo]').length === 3, { timeout: 20000 }).catch(() => null)
    const ups = calls.filter((c) => c.fn === 'upload')
    const full = ups.filter((u) => !u.body.path.includes('.thumb.'))
    const thumbs = ups.filter((u) => u.body.path.includes('.thumb.'))
    full.length === 2 && thumbs.length === 2 && ups.every((u) => u.body.path.startsWith(`${dir}/`)) ? ok('each photo goes up twice — the photo and its small copy — into the game\'s folder') : bad(`uploads: ${JSON.stringify(ups)}`)
    const added = calls.filter((c) => c.fn === 'add_match_photos')
    added.length === 1 && added[0].body.p_photos.length === 2 && added[0].body.p_photos.every((p) => p.thumb && p.width > 0 && p.width <= 1600)
      ? ok('then one call adds both, with their sizes (so the families get one push)')
      : bad(`add: ${JSON.stringify(added)}`)
    ;(await page.$$('[data-photo]')).length === 3 ? ok('and the grid shows three') : bad('the grid did not grow')
    ;(await bothThemes(page, 'grid')) ? ok('the grid fits 375px, light and dark') : bad('the grid is wider than the phone')
    await context.close()
  }

  // ---------------------------------------------------------------------------
  head("2. A family sees them, and can take one down (stood in)")
  {
    let photos = [photo('00000000-0000-4000-8000-0000000000c1', 'a'), photo('00000000-0000-4000-8000-0000000000c2', 'b')]
    const { context, page, calls } = await open(parent, `/calendar/${ev.id}#sheet`, {
      match_photos: () => ({ can_add: false, played: true, limit: 60, consent: null, photos }),
      take_down_match_photo: (b) => {
        photos = photos.filter((p) => p.id !== b.p_photo)
        return { can_add: false, played: true, limit: 60, consent: null, photos }
      },
    }, true)
    await toPhotos(page)
    ;(await page.$$('[data-photo]')).length === 2 ? ok('Sam sees the game\'s two photos') : bad('the family does not see the photos')
    ;(await text(page)).includes('Add photos') ? bad('a family is offered "Add photos"') : ok('a family is not offered "Add photos"')
    await page.$eval('[data-photo]', (b) => b.click())
    await page.waitForSelector('[data-photo-viewer] img', { timeout: 10000 }).catch(() => null)
    ;(await page.$('[data-photo-viewer] img')) ? ok('tapping one opens the photo itself') : bad('the viewer shows no photo')
    ;(await bothThemes(page, 'viewer')) ? ok('the viewer fits 375px, light and dark') : bad('the viewer is wider than the phone')
    await page.$eval('[data-photo-takedown]', (b) => b.click())
    await page.waitForSelector('[data-photo-sure]', { timeout: 5000 }).catch(() => null)
    const asked = (await text(page)).includes('Take this photo down for everyone? The coach is told, and can put it back.')
    asked && !calls.some((c) => c.fn === 'take_down_match_photo') ? ok('"Take it down" asks first, and says what happens') : bad('no question before taking it down')
    await page.$eval('[data-photo-confirm]', (b) => b.click())
    await page.waitForFunction(() => document.querySelectorAll('[data-photo]').length === 1, { timeout: 10000 }).catch(() => null)
    const sent = calls.filter((c) => c.fn === 'take_down_match_photo')
    sent.length === 1 && sent[0].body.p_photo === '00000000-0000-4000-8000-0000000000c1' && (await page.$$('[data-photo]')).length === 1
      ? ok('then it is down at once — gone from Sam\'s grid')
      : bad(`take down: ${JSON.stringify(sent)}`)
    await context.close()
  }

  // ---------------------------------------------------------------------------
  head('3. The coach sees a photo that was taken down (stood in)')
  {
    let photos = [photo('00000000-0000-4000-8000-0000000000d1', 'a', { hidden: true, hidden_by: 'Sam Whitfield' }), photo('00000000-0000-4000-8000-0000000000d2', 'b')]
    const { context, page, calls } = await open(coach, `/calendar/${ev.id}#sheet`, {
      match_photos: () => ({ can_add: true, played: true, limit: 60, consent, photos }),
      restore_match_photo: (b) => {
        photos = photos.map((p) => (p.id === b.p_photo ? { ...p, hidden: false, hidden_by: null } : p))
        return { can_add: true, played: true, limit: 60, consent, photos }
      },
    }, true)
    await toPhotos(page)
    ;(await page.$('[data-photo][data-hidden]')) && (await text(page)).includes('Taken down') ? ok('the coach still sees it, marked "Taken down"') : bad('the coach does not see the taken-down photo')
    await page.$eval('[data-photo][data-hidden]', (b) => b.click())
    await page.waitForSelector('[data-taken-down]', { timeout: 5000 }).catch(() => null)
    ;(await text(page)).includes('Taken down by Sam Whitfield. Only the squad') ? ok('and who asked, with "Put it back" and "Delete"') : bad('the viewer does not say who took it down')
    ;(await bothThemes(page, 'taken-down')) ? ok('fits 375px, light and dark') : bad('wider than the phone')
    await page.$eval('[data-photo-restore]', (b) => b.click())
    await page.waitForFunction(() => !document.querySelector('[data-photo][data-hidden]'), { timeout: 10000 }).catch(() => null)
    calls.some((c) => c.fn === 'restore_match_photo' && c.body.p_photo === '00000000-0000-4000-8000-0000000000d1') && !(await page.$('[data-photo][data-hidden]'))
      ? ok('"Put it back" puts it back')
      : bad('put back did not work')
    await context.close()
  }

  // ---------------------------------------------------------------------------
  head('4. Against the database')
  if (!has0223) {
    note('waiting for 0223 on squadroom-dev (the Supabase token) — real files through the Storage API, who may add, the one push, a take-down hiding the file itself and a delete removing it run then; test-rls 141–145 prove the rules locally meanwhile')
  } else {
    await endToEnd()
  }
} finally {
  await browser.close()
  await tidy()
  if (addedClearance) await admin.from('staff_clearances').delete().eq('academy_id', NRIFA).eq('profile_id', MARCUS).eq('number', 'WWC0000002E')
  if (addedCoach) await admin.from('team_members').delete().eq('team_id', U8).eq('profile_id', MARCUS)
}
console.log(process.exitCode ? '' : '\n  \x1b[32mthe game in pictures, the squad\'s own\x1b[0m\n')

// -----------------------------------------------------------------------------
async function endToEnd() {
  // Two real files, as the coach's phone sends them.
  const paths = []
  for (const [i, p] of pics.entries()) {
    const path = `${dir}/e2e-${i}.jpg`
    const { error } = await coach.client.storage.from('match-photos').upload(path, p.buf, { contentType: 'image/jpeg' })
    if (error) return bad(`the coach could not upload: ${error.message}`)
    paths.push(path)
  }
  {
    const { error: e1 } = await parent.client.storage.from('match-photos').upload(`${dir}/by-a-parent.jpg`, pics[0].buf, { contentType: 'image/jpeg' })
    e1 ? ok('a family cannot put a file in the game\'s folder') : bad('a parent uploaded into the game\'s folder')
    const { error: e2 } = await parent.client.rpc('add_match_photos', { p_event: ev.id, p_photos: paths.map((p) => ({ path: p })) })
    const { error: e3 } = await ravens.client.rpc('add_match_photos', { p_event: ev.id, p_photos: paths.map((p) => ({ path: p })) })
    e2?.code === '42501' && e3?.code === '42501' ? ok('only the coach adds them (not a family, not another club)') : bad(`${e2?.message} / ${e3?.message}`)
  }
  {
    const { data, error } = await coach.client.rpc('add_match_photos', { p_event: ev.id, p_photos: paths.map((p) => ({ path: p, width: 800, height: 600 })) })
    data?.photos?.length === 2 ? ok('the coach adds both') : bad(`add: ${error?.message} ${JSON.stringify(data)}`)
    const { data: pushes } = await admin.from('notification_queue').select('profile_id, title, url').eq('kind', 'match_photos').filter('payload->>event_id', 'eq', ev.id)
    const toSam = (pushes ?? []).filter((p) => p.profile_id === parent.session.user.id)
    toSam.length === 1 && toSam[0].title.includes('photos are up') && toSam[0].url === `/calendar/${ev.id}#sheet` ? ok(`one push to Sam: "${toSam[0].title}", opening the Match sheet`) : bad(`pushes: ${JSON.stringify(pushes)}`)
  }
  let first
  {
    const { data } = await parent.client.rpc('match_photos', { p_event: ev.id })
    first = data?.photos?.[0]
    const { data: link } = await parent.client.storage.from('match-photos').createSignedUrl(first.path, 60)
    data?.photos?.length === 2 && link?.signedUrl ? ok('Sam sees both and can open one') : bad(`Sam: ${JSON.stringify(data)}`)
    const { error: re } = await ravens.client.rpc('match_photos', { p_event: ev.id })
    const { data: rl } = await ravens.client.storage.from('match-photos').createSignedUrl(first.path, 60)
    re && !rl?.signedUrl ? ok('another club sees nothing and can open nothing') : bad('another club reached the photos')
  }
  {
    await parent.client.rpc('take_down_match_photo', { p_photo: first.id })
    const { data } = await parent.client.rpc('match_photos', { p_event: ev.id })
    const { data: link } = await parent.client.storage.from('match-photos').createSignedUrl(first.path, 60)
    const { data: told } = await admin.from('notification_queue').select('id').eq('kind', 'photo_hidden').eq('profile_id', MARCUS).filter('payload->>photo_id', 'eq', first.id)
    data?.photos?.length === 1 && !link?.signedUrl && (told?.length ?? 0) === 1 ? ok('Sam takes one down: gone from the list, no new link to the file, Marcus told') : bad(`after take down: ${JSON.stringify(data)} link ${Boolean(link?.signedUrl)} told ${told?.length}`)
  }
  {
    const { data } = await coach.client.rpc('remove_match_photo', { p_photo: first.id })
    await coach.client.storage.from('match-photos').remove(data?.files ?? [])
    const { data: left } = await admin.storage.from('match-photos').list(dir)
    !(left ?? []).some((f) => first.path.endsWith(f.name)) ? ok('the coach deletes it, and the file goes with it') : bad('the file is still there')
  }
  {
    const { context, page } = await open(parent, `/calendar/${ev.id}#sheet`)
    await toPhotos(page)
    ;(await page.$$('[data-photo]')).length === 1 && (await fits(page)) ? ok('Sam\'s real Match sheet shows the one left, at 375px') : bad('the real page does not show the photo')
    await context.close()
  }
}
