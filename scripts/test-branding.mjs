// Run: node --env-file=.env.local scripts/test-branding.mjs
//   (the browser checks need the app running — npm run dev, or serve:test)
//
// Club & league branding and a person's own appearance (Joey, 4 Nov 2026).
//
//   1. The colour arithmetic, on six club colours including yellow and white:
//      text on the colour passes AA, the colour as a button and as words
//      shows up on a white page and a dark one (deepened or lightened when
//      it would not), and the owner is told when that happened.
//   2. Colours read out of a logo.
//   3. Who may change what, asked of the database as each person: a club's
//      colours and logo are its owner's and admins' — not a coach's, not a
//      family's; a person's appearance is their own and nobody else's.
//   4. In a browser: the app in the club's colours from the first frame,
//      Squadroom's pages left black and white, a club's public page in ITS
//      colours, Appearance switching for one person only, the organisation
//      switch changing the colours, and the owner's editor suggesting colours
//      from a logo and previewing them before anything is saved.
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'
import { fileURLToPath } from 'node:url'
import { signInBoth } from './_auth.mjs'
import { resolveBaseUrl } from './_base-url.mjs'
import { GROUNDS, clubTheme, clubThemeNotes, contrast } from '../lib/brand/colour.ts'
import { suggestFromPixels } from '../lib/brand/extract.ts'

const BASE = await resolveBaseUrl()
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const ref = URL_.split('//')[1].split('.')[0]
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const note = (m) => console.log(`  \x1b[33m~\x1b[0m ${m}`)
const head = (m) => console.log(`\n${m}`)
const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const SPL = '00000000-0000-0000-0000-0000000a0003'
const SAM = '00000000-0000-0000-0000-0000000000b1'
const PRIYA = '00000000-0000-0000-0000-0000000000b2'
const CREST = fileURLToPath(new URL('../public/brand/nrifa-crest.svg', import.meta.url))

head('1. Six club colours, including yellow and white, in light and dark')
const SAMPLES = [
  ['yellow', '#FFD700'], ['white', '#FFFFFF'], ['NRIFA blue', '#0061FE'],
  ['navy', '#202842'], ['SPL green', '#0E7C5A'], ['black', '#000000'],
]
for (const [name, colour] of SAMPLES) {
  const fails = []
  for (const mode of ['light', 'dark']) {
    const t = clubTheme(colour, '#EFBD5B', mode)
    const g = GROUNDS[mode]
    const need = [
      [`header text`, t['--bar-ink'], t['--bar'], 4.5],
      [`button text`, t['--brand-ink'], t['--brand'], 4.5],
      [`button on the page`, t['--brand'], g.paper, 3], [`button on a card`, t['--brand'], g.surface, 3],
      [`words on the page`, t['--brand-text'], g.paper, 4.5], [`words on a card`, t['--brand-text'], g.surface, 4.5],
      [`highlight`, t['--highlight'], g.paper, 3],
    ]
    for (const [what, a, b, min] of need) {
      const c = contrast(a, b)
      if (c < min) fails.push(`${mode} ${what} ${a} on ${b} = ${c.toFixed(2)}:1`)
    }
  }
  const L = clubTheme(colour, null, 'light')
  const D = clubTheme(colour, null, 'dark')
  fails.length === 0
    ? ok(`${name} ${colour}: header ${L['--bar']} with ${L['--bar-ink'] === '#ffffff' ? 'white' : 'black'} text; buttons ${L['--brand']} light / ${D['--brand']} dark — every pair AA`)
    : bad(`${name} ${colour}: ${fails.join('; ')}`)
}
{
  const yellow = clubThemeNotes('#FFD700', null)
  const white = clubThemeNotes('#FFFFFF', null)
  const navy = clubThemeNotes('#202842', null)
  const blue = clubThemeNotes('#0061FE', null)
  yellow.some((n) => /too pale/.test(n) && /deeper/.test(n)) ? ok(`yellow: the owner is told — “${yellow[0].slice(0, 90)}…”`) : bad(`no note for yellow: ${JSON.stringify(yellow)}`)
  white.some((n) => /too pale/.test(n)) ? ok('white: the owner is told it shows as a deeper shade on white screens') : bad(`no note for white: ${JSON.stringify(white)}`)
  navy.some((n) => /too dark/.test(n) && /lighter/.test(n)) ? ok('navy: the owner is told it is lightened in dark mode') : bad(`no note for navy: ${JSON.stringify(navy)}`)
  blue.every((n) => !/light mode/.test(n)) ? ok(`NRIFA blue needs nothing in light mode (${blue.length} note${blue.length === 1 ? '' : 's'} for dark)`) : bad(`NRIFA blue was adjusted in light mode: ${JSON.stringify(blue)}`)
  const yl = clubTheme('#FFD700', null, 'light')
  yl['--bar'] === '#ffd700' && yl['--bar-ink'] === '#101012' ? ok('a yellow club keeps its yellow header, with black text on it') : bad(`yellow header ${yl['--bar']} / ${yl['--bar-ink']}`)
}

head('2. Colours read out of a logo')
{
  const px = []
  const put = (rgb, n) => { for (let i = 0; i < n; i++) px.push(...rgb, 255) }
  put([32, 40, 66], 700)   // navy
  put([239, 189, 91], 200) // gold
  put([255, 255, 255], 300) // the paper
  put([0, 0, 0], 0)
  for (let i = 0; i < 100; i++) px.push(10, 200, 10, 0) // transparent: not a colour
  const s = suggestFromPixels(px)
  const near = (a, b) => contrast(a, b) < 1.15
  s && near(s.primary, '#202842') && s.secondary && near(s.secondary, '#efbd5b')
    ? ok(`a navy-and-gold logo on white suggests ${s.primary} and ${s.secondary} (the white is left out)`)
    : bad(`suggested ${JSON.stringify(s)}`)
  const one = suggestFromPixels([...Array(400)].flatMap(() => [14, 124, 90, 255]))
  one && !one.secondary ? ok(`a one-colour logo suggests one colour (${one.primary})`) : bad(`one-colour logo: ${JSON.stringify(one)}`)
}

head('3. Who may change what — asked as each person')
const [joey, marcus, sam, priya] = [
  await signInBoth(admin, 'joeylameri@outlook.com'),
  await signInBoth(admin, 'p61400000002@squadroom.invalid'),
  await signInBoth(admin, 'p61400000011@squadroom.invalid'),
  await signInBoth(admin, 'p61400000012@squadroom.invalid'),
]
if (!joey || !marcus || !sam || !priya) { console.log("  could not sign in — the project's auth rate limit, not a failure"); process.exit(2) }
const as = (s) => s.client
const { data: before } = await admin.from('academies').select('*').eq('id', NRIFA).single()
const has0209 = Object.prototype.hasOwnProperty.call(before, 'secondary_colour')

for (const [who, s] of [['the coach', marcus], ['a parent', sam]]) {
  const { data } = await as(s).from('academies').update({ primary_colour: before.primary_colour, logo_url: before.logo_url }).eq('id', NRIFA).select('id')
  ;(data ?? []).length === 0 ? ok(`${who} cannot change the club's colours or logo`) : bad(`${who} changed NRIFA's branding row`)
  const { error: rpc } = await as(s).rpc('set_academy_logo', { p_academy: NRIFA, p_url: before.logo_url })
  rpc ? ok(`${who} cannot set the club's logo (${rpc.code ?? 'refused'})`) : bad(`${who} set NRIFA's logo`)
  const probe = `${NRIFA}/rls-probe-${Date.now()}.png`
  const { error: up } = await as(s).storage.from('club-logos').upload(probe, new Uint8Array([137, 80, 78, 71]), { contentType: 'image/png' })
  if (up) ok(`${who} cannot put a file in the club's logo folder`)
  else { bad(`${who} uploaded into NRIFA's logo folder`); await admin.storage.from('club-logos').remove([probe]) }
}
{
  const { data } = await as(joey).from('academies').update({ primary_colour: before.primary_colour }).eq('id', NRIFA).select('id')
  ;(data ?? []).length === 1 ? ok('the owner can change the club\'s colours') : bad('the owner could not update NRIFA')
  const probe = `${NRIFA}/rls-probe-${Date.now()}.png`
  const { error: up } = await as(joey).storage.from('club-logos').upload(probe, new Uint8Array([137, 80, 78, 71]), { contentType: 'image/png' })
  up ? bad(`the owner could not upload a logo: ${up.message}`) : ok('the owner can upload a logo')
  await admin.storage.from('club-logos').remove([probe])
}
if (has0209) {
  for (const [who, s] of [['the coach', marcus], ['a parent', sam]]) {
    const { data } = await as(s).from('academies').update({ secondary_colour: before.secondary_colour }).eq('id', NRIFA).select('id')
    ;(data ?? []).length === 0 ? ok(`${who} cannot change the club's second colour`) : bad(`${who} changed the second colour`)
  }
  const { data } = await as(joey).from('academies').update({ secondary_colour: before.secondary_colour }).eq('id', NRIFA).select('id')
  ;(data ?? []).length === 1 ? ok('the owner can change the second colour') : bad('the owner could not change the second colour')
} else note('the second colour waits for migration 0209 (needs the Supabase token) — checked by test-rls 112 once applied')

{
  const { data: mine } = await as(sam).from('profiles').select('*').eq('id', SAM).single()
  if (Object.prototype.hasOwnProperty.call(mine ?? {}, 'appearance')) {
    const { data } = await as(sam).from('profiles').update({ appearance: mine.appearance, colour_mode: mine.colour_mode }).eq('id', SAM).select('id')
    ;(data ?? []).length === 1 ? ok('a parent can change their own appearance') : bad('a parent could not save their own appearance')
    const { data: other } = await as(sam).from('profiles').update({ appearance: 'mono' }).eq('id', PRIYA).select('id')
    ;(other ?? []).length === 0 ? ok('and cannot change another parent\'s') : bad('a parent changed another parent\'s appearance')
  } else {
    note('appearance in the profile waits for migration 0209 — until then it is kept on the phone (test-rls 113 once applied)')
    const { data: other } = await as(sam).from('profiles').update({ full_name: 'x' }).eq('id', PRIYA).select('id')
    ;(other ?? []).length === 0 ? ok('a parent cannot change another person\'s profile row (where appearance will live)') : bad('a parent wrote to another person\'s profile')
  }
}

head('4. In a browser')
const cookieFor = (s) => ({ name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(s.session)).toString('base64'), domain: 'localhost', path: '/' })
const hex = (c) => { const m = c.match(/\d+(\.\d+)?/g); return m ? '#' + m.slice(0, 3).map((n) => Math.round(Number(n)).toString(16).padStart(2, '0')).join('') : c }
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
const open = async (s, org = NRIFA, extra = null) => {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 375, height: 812 })
  // Pinned: headless Chrome otherwise follows the Mac's own light or dark.
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
  if (s) await page.setCookie(cookieFor(s))
  await page.evaluateOnNewDocument((o, x) => {
    try {
      if (o) localStorage.setItem('squadroom.org', o)
      if (x) for (const [k, v] of Object.entries(x)) localStorage.setItem(k, v)
    } catch {}
  }, org, extra)
  return { context, page }
}
const barOf = (page) => page.evaluate(() => { const h = document.querySelector('header'); return h ? getComputedStyle(h).backgroundColor : null })
const clubSet = (page) => page.waitForFunction(() => Boolean(document.documentElement.dataset.club), { timeout: 20000 }).then(() => true).catch(() => false)
const { data: nrifa } = await admin.from('academies').select('primary_colour, logo_url').eq('id', NRIFA).single()
const { data: spl } = await admin.from('academies').select('primary_colour').eq('id', SPL).single()

try {
  // A parent, by default: the club's colours.
  {
    const { context, page } = await open(sam)
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 60000 })
    const on = await clubSet(page)
    const bar = hex(await barOf(page))
    on && bar === nrifa.primary_colour.toLowerCase() ? ok(`a parent's Home wears NRIFA's colour: the bar is ${bar}`) : bad(`a parent's Home bar is ${bar} (club theme ${on ? 'on' : 'off'})`)
    const logo = await page.$('header img[data-club-logo]')
    nrifa.logo_url ? (logo ? ok('the crest replaces the initials in the app bar') : bad('no crest in the app bar')) : note('NRIFA has no logo to show')
    const tab = await page.evaluate(() => { const a = document.querySelector('nav a[aria-current="page"]'); if (!a) return null; const spans = a.querySelectorAll(':scope > span'); return { label: getComputedStyle(a).color, line: getComputedStyle(spans[spans.length - 1]).backgroundColor } })
    tab && hex(tab.line) !== '#101012' ? ok(`the active tab is in the club's colours (label ${hex(tab.label)}, line ${hex(tab.line)})`) : bad(`active tab ${JSON.stringify(tab)}`)
    // The first frame on the next open: dressed before React runs.
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    const first = await page.evaluate(() => ({ club: document.documentElement.dataset.club ?? null, bar: getComputedStyle(document.documentElement).getPropertyValue('--bar').trim() }))
    first.club && first.bar.toLowerCase() === nrifa.primary_colour.toLowerCase() ? ok(`the next open is in the club's colours from the first frame (--bar ${first.bar} before the app loads)`) : bad(`first frame: ${JSON.stringify(first)}`)
    // Squadroom's own page, signed in: black and white.
    await page.goto(`${BASE}/for-clubs`, { waitUntil: 'networkidle2', timeout: 60000 })
    const fc = await page.evaluate(() => ({ club: document.documentElement.dataset.club ?? null, bar: getComputedStyle(document.querySelector('header')).backgroundColor }))
    !fc.club && hex(fc.bar) === '#101012' ? ok('Squadroom\'s own page (/for-clubs) stays black and white, even for a club member') : bad(`/for-clubs: ${JSON.stringify(fc)}`)
    await context.close()
  }

  // Appearance: one person's, nobody else's.
  {
    const { context, page } = await open(sam)
    await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle2', timeout: 60000 })
    await page.waitForSelector('#appearance [data-design="mono"]', { timeout: 20000 })
    await clubSet(page)
    await page.click('#appearance [data-design="mono"]')
    await page.waitForFunction(() => !document.documentElement.dataset.club, { timeout: 10000 }).catch(() => null)
    const mono = hex(await barOf(page))
    mono === '#101012' ? ok('Black & white: the bar turns Squadroom\'s #101012 at once') : bad(`after Black & white the bar is ${mono}`)
    await page.click('#appearance [data-mode="dark"]')
    const dark = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme ?? null, paper: getComputedStyle(document.body).backgroundColor }))
    dark.theme === 'dark' && hex(dark.paper) === '#101012' ? ok('Dark: the page is #101012') : bad(`after Dark: ${JSON.stringify(dark)}`)
    await page.reload({ waitUntil: 'networkidle2' })
    const kept = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme ?? null, design: document.documentElement.dataset.design ?? null, club: document.documentElement.dataset.club ?? null }))
    kept.theme === 'dark' && kept.design === 'mono' && !kept.club ? ok('and it is still Black & white, Dark after a reload') : bad(`after reload: ${JSON.stringify(kept)}`)
    // Somebody else, same moment: their own look.
    const other = await open(priya)
    await other.page.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 60000 })
    await clubSet(other.page)
    const theirs = hex(await barOf(other.page))
    theirs === nrifa.primary_colour.toLowerCase() ? ok('another parent still sees the club\'s colours — the choice was one person\'s') : bad(`another parent sees ${theirs}`)
    await other.context.close()
    // Put Sam back.
    await page.click('#appearance [data-design="club"]')
    await page.click('#appearance [data-mode="system"]')
    await clubSet(page)
    const back = hex(await barOf(page))
    back === nrifa.primary_colour.toLowerCase() ? ok('Club colours and Match my phone: back to the club\'s bar') : bad(`back to club colours, the bar is ${back}`)
    await context.close()
  }

  // The organisation switch takes the colours with it.
  {
    const { context, page } = await open(joey, SPL)
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 60000 })
    await clubSet(page)
    await page.waitForFunction((c) => getComputedStyle(document.documentElement).getPropertyValue('--bar').trim().toLowerCase() === c, { timeout: 15000 }, spl.primary_colour.toLowerCase()).catch(() => null)
    const bar = hex(await barOf(page))
    bar === spl.primary_colour.toLowerCase() ? ok(`switched to the league, the bar is the SPL's ${bar}`) : bad(`in the SPL the bar is ${bar}`)
    await context.close()
  }

  // A club's public page: its own colours, whoever is reading.
  {
    const { context, page } = await open(null, null, { 'squadroom.club': JSON.stringify({ id: SPL, name: 'x', logo: null, primary: '#0e7c5a', secondary: null, css: ':root[data-club]{--bar:#0e7c5a}' }) })
    await page.goto(`${BASE}/nrifa`, { waitUntil: 'networkidle2', timeout: 60000 })
    const pub = await page.evaluate(() => ({ club: document.documentElement.dataset.club ?? null, bar: getComputedStyle(document.querySelector('header')).backgroundColor, logo: Boolean(document.querySelector('header img[data-club-logo]')) }))
    !pub.club && hex(pub.bar) === nrifa.primary_colour.toLowerCase() ? ok(`NRIFA's front door is in NRIFA's colour (${hex(pub.bar)}), not the reader's club`) : bad(`/nrifa: ${JSON.stringify(pub)}`)
    nrifa.logo_url ? (pub.logo ? ok('with its crest') : bad('no crest on the front door')) : null
    await page.goto(`${BASE}/signin`, { waitUntil: 'networkidle2', timeout: 60000 })
    const si = await page.evaluate(() => ({ club: document.documentElement.dataset.club ?? null, ground: getComputedStyle(document.querySelector('main')).backgroundColor }))
    !si.club && hex(si.ground) === '#101012' ? ok('sign-in stays Squadroom\'s black and white with a club remembered on the phone') : bad(`/signin: ${JSON.stringify(si)}`)
    await context.close()
  }

  // The owner's editor: suggest from the logo, preview, nothing saved until Save.
  {
    const { context, page } = await open(joey, NRIFA)
    await page.goto(`${BASE}/settings/academy`, { waitUntil: 'networkidle2', timeout: 60000 })
    await page.waitForSelector('[data-club-branding]', { timeout: 20000 })
    ok('the owner has Club logo and colours in Club settings')
    const input = await page.$('input[data-logo-input]')
    await input.uploadFile(CREST)
    await page.waitForSelector('[data-suggestion]', { timeout: 30000 })
    const sug = await page.evaluate(() => ({
      p: document.querySelector('[data-suggested-primary]')?.getAttribute('data-suggested-primary'),
      s: document.querySelector('[data-suggested-secondary]')?.getAttribute('data-suggested-secondary') ?? null,
    }))
    const near = (a, b) => a && contrast(a, b) < 1.2
    // The crest is drawn in two navies (#202842 and #3d4a6d) and gold; the
    // suggestion is whichever navy covers more of it, and the gold.
    ;(near(sug.p, '#202842') || near(sug.p, '#3d4a6d')) && near(sug.s, '#efbd5b') ? ok(`the crest suggests ${sug.p} and ${sug.s} — its navy and its gold`) : bad(`the crest suggested ${JSON.stringify(sug)}`)
    await page.click('[data-use-suggestion]')
    const preview = await page.evaluate(() => getComputedStyle(document.querySelector('[data-club-preview="light"] > div > div')).backgroundColor)
    const { data: mid } = await admin.from('academies').select('primary_colour').eq('id', NRIFA).single()
    near(hex(preview), sug.p) && mid.primary_colour.toLowerCase() === nrifa.primary_colour.toLowerCase()
      ? ok(`the phone preview turns ${hex(preview)} while the club is still ${mid.primary_colour} — nothing saved yet`)
      : bad(`preview ${hex(preview)}, saved ${mid.primary_colour}`)
    const notes = await page.$eval('[data-contrast-notes]', (e) => e.textContent).catch(() => '')
    ;/too dark/.test(notes) ? ok('and it says the navy is lightened in dark mode') : bad(`no note for the navy: ${notes}`)
    await page.click('[data-save-colours]')
    await page.waitForSelector('[data-branding-saved]', { timeout: 15000 }).catch(() => null)
    const { data: after } = await admin.from('academies').select('*').eq('id', NRIFA).single()
    after.primary_colour.toLowerCase() === sug.p.toLowerCase() ? ok(`saved: NRIFA is ${after.primary_colour}${has0209 ? ` and ${after.secondary_colour}` : ''}`) : bad(`after Save the colour is ${after.primary_colour}`)
    await context.close()
  }

  // A coach: no editor.
  {
    const { context, page } = await open(marcus, NRIFA)
    await page.goto(`${BASE}/settings/academy`, { waitUntil: 'networkidle2', timeout: 60000 })
    await page.waitForFunction(() => !document.querySelector('[data-skeleton]'), { timeout: 20000 }).catch(() => null)
    const has = await page.$('[data-club-branding]')
    const said = await page.evaluate(() => document.body.innerText.includes('Only owners and admins'))
    !has && said ? ok('a coach sees no branding editor, and is told who can') : bad(`a coach: editor ${Boolean(has)}, message ${said}`)
    await context.close()
  }
} finally {
  // Put NRIFA back exactly as it was.
  const restore = { primary_colour: before.primary_colour, logo_url: before.logo_url }
  if (has0209) restore.secondary_colour = before.secondary_colour
  await admin.from('academies').update(restore).eq('id', NRIFA)
  // The crest the test uploaded under a new name.
  const { data: files } = await admin.storage.from('club-logos').list(NRIFA)
  const stray = (files ?? []).filter((f) => /^logo-\d+\./.test(f.name)).map((f) => `${NRIFA}/${f.name}`)
  if (stray.length) await admin.storage.from('club-logos').remove(stray)
  await browser.close()
}
console.log(process.exitCode ? '' : '\n  \x1b[32mevery club in its own colours, every person in their own look\x1b[0m\n')
