// Run: node --env-file=.env.local scripts/test-register-flow.mjs
//   (needs the app running and Chrome installed — it drives the form)
//
// R-02: the public register page is three steps, and a half-filled form
// survives the phone being put down. Driven in a real browser at 375px.
import { createClient } from '@supabase/supabase-js'
import puppeteer from 'puppeteer-core'
import { resolveBaseUrl } from './_base-url.mjs'

const BASE = await resolveBaseUrl()
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`)
  process.exitCode = 1
}
const head = (m) => console.log(`\n${m}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const TAG = 'FLOWTEST'

await admin.from('registration_requests').delete().like('child_name', `${TAG}%`)

let browser
try {
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
} catch (e) {
  console.log(`  no Chrome at ${CHROME} — set CHROME to its path. Skipping. (${e.message.slice(0, 60)})`)
  process.exit(2)
}
const page = await browser.newPage()
await page.setViewport({ width: 375, height: 812 })

const text = async () => (await page.$eval('main', (m) => m.innerText)).replace(/\s+/g, ' ')
const has = (t, s) => t.toLowerCase().includes(s.toLowerCase())
const clickText = async (selector, needle) => {
  for (const h of await page.$$(selector)) {
    const t = ((await (await h.getProperty('textContent')).jsonValue()) ?? '').trim()
    if (t === needle || t.startsWith(needle)) {
      await h.click()
      return true
    }
  }
  return false
}
const typeInto = async (labelText, value) => {
  const handle = await page.evaluateHandle((lbl) => {
    const label = [...document.querySelectorAll('label')].find((l) => l.textContent.trim().startsWith(lbl))
    return label?.querySelector('input') ?? null
  }, labelText)
  const el = handle.asElement()
  if (!el) throw new Error(`no field labelled "${labelText}"`)
  await el.click({ clickCount: 3 })
  await el.type(value)
}

head('1. Step one: a program and a child')
try {
  await page.goto(`${BASE}/nrifa/register`, { waitUntil: 'networkidle2', timeout: 45000 })
  await sleep(1500)
  ;has(await text(), '1. Who') ? ok('the progress bar shows step 1') : bad('no progress bar')
  const continueBefore = await page.$$eval('button', (bs) => bs.find((b) => /Choose a program/.test(b.textContent))?.disabled)
  continueBefore ? ok('Continue is disabled until a program is chosen') : bad('Continue enabled with nothing chosen')
  // The first program that is not full.
  const picked = await page.$$eval('button[aria-pressed]', (bs) => {
    const b = bs.find((x) => !/Full/.test(x.textContent))
    if (b) b.click()
    return b?.textContent?.trim().split('\n')[0] ?? null
  })
  picked ? ok(`chose "${picked.slice(0, 40)}"`) : bad('no program to choose')
  await typeInto('Their full name', `${TAG} Child`)
  await page.$eval('input[type=date]', (i) => {
    // React tracks the value property; a plain assignment is invisible to it.
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(i, '2017-05-05')
    i.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await sleep(300)
  ;(await clickText('button', 'Continue')) ? ok('Continue') : bad('no Continue')
  await sleep(400)
  ;has(await text(), '2. Details') && has(await text(), 'Your name') ? ok('step 2: details and agreements') : bad(`not on step 2: ${(await text()).slice(0, 120)}`)
} catch (e) {
  bad(`step 1: ${e.message.slice(0, 120)}`)
}

head('2. Half-way through, the phone goes in a pocket — the draft survives a reload')
try {
  await typeInto('Your name', `${TAG} Parent`)
  await typeInto('Mobile', '0400 999 777')
  await sleep(500)
  await page.reload({ waitUntil: 'networkidle2' })
  await sleep(1500)
  const t = await text()
  t.includes('Picked up where you left off') ? ok('told they were picked up') : bad('no resume line')
  has(t, '2. Details') ? ok('reopened on step 2') : bad('reopened on the wrong step')
  const name = await page.$$eval('input', (is) => is.find((i) => i.value.includes('FLOWTEST Parent'))?.value ?? null)
  name ? ok('the guardian’s name is still there') : bad('the draft lost the name')
  await page.evaluate(() => {
    document.querySelectorAll('input[type=checkbox]').forEach((c) => {
      if (!c.checked) c.click()
    })
  })
  // Any required questions get an answer.
  await page.evaluate(() => {
    document.querySelectorAll('button[aria-pressed="false"]').forEach((b) => {
      if (/^(Yes|No)$/.test(b.textContent.trim()) && b.closest('fieldset')) b.click()
    })
  })
  // And any text or date question the program asks, through React's setter.
  await page.evaluate(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    document.querySelectorAll('input[type=text], input[type=date]').forEach((i) => {
      if (i.value) return
      set.call(i, i.type === 'date' ? '2026-01-01' : 'n/a')
      i.dispatchEvent(new Event('input', { bubbles: true }))
    })
  })
  await sleep(300)
  ;(await clickText('button', 'Continue')) ? ok('Continue to the review') : bad(`cannot continue: ${(await page.$$eval('button', (bs) => bs.map((b) => b.textContent.trim()).filter((s) => /Answer|Agree|Fill|mobile/i.test(s)))).join(' | ')}`)
  await sleep(400)
} catch (e) {
  bad(`step 2: ${e.message.slice(0, 120)}`)
}

head('3. Review, the fee said plainly, and send')
try {
  const t = await text()
  has(t, '3. Review') ? ok('step 3: review and send') : bad(`not on step 3: ${t.slice(0, 160)}`)
  t.includes(`${TAG} Child`) && t.includes(`${TAG} Parent`) ? ok('the summary names the child and the parent') : bad('summary is missing names')
  const feeLine = /Nothing is charged now/
  feeLine.test(t) ? ok('says nothing is charged now') : bad('no fee explanation')
  ;(await clickText('button', 'Send to the club')) || (await clickText('button', 'Join the waitlist')) ? ok('Send') : bad('no Send button')
  for (let i = 0; i < 20; i++) {
    await sleep(500)
    if (/Sent to the club/.test(await text())) break
  }
  /Sent to the club/.test(await text()) ? ok('"Sent to the club"') : bad(`after send: ${(await text()).slice(0, 160)}`)
  const { data: row } = await admin.from('registration_requests').select('id, status, guardian_name').like('child_name', `${TAG}%`).maybeSingle()
  row?.status === 'pending' && row?.guardian_name === `${TAG} Parent` ? ok('the request is in the queue, pending') : bad(`row: ${JSON.stringify(row)}`)
  const draftGone = await page.evaluate((k) => localStorage.getItem(k), 'squadroom.draft.nrifa')
  draftGone === null ? ok('the draft is cleared once sent') : bad('the draft was kept after sending')
} catch (e) {
  bad(`step 3: ${e.message.slice(0, 120)}`)
}

await browser.close()
await admin.from('registration_requests').delete().like('child_name', `${TAG}%`)
console.log(process.exitCode ? '\n\x1b[31mTHE REGISTER FLOW IS WRONG\x1b[0m\n' : '\n\x1b[32mall good\x1b[0m\n')
