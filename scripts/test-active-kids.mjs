// Run: node --env-file=.env.local scripts/test-active-kids.mjs
//   (the dev server on :3000; SHOTS=1 saves the screens at 375px)
//
// The registration brief, gap 3 (0264): the Active & Creative Kids voucher
// on Inner West FC. The owner says the club is a provider (Settings → Club);
// a family puts a voucher on a child's fee from their Payments screen — the
// number and the child's details as on the voucher — and $50 comes off; a
// coach who is not the family cannot; a number is used once, one voucher
// per fee, and $30 of fee takes $30. The Treasurer sees the list to redeem
// in Service NSW on Admin → Payments and ticks one; a parent sees no list.
// With the feature off, nothing of it shows anywhere and the public page
// says the club takes none. Everything made here is removed and the club's
// setting and switch put back.
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

const IW = '00000000-0000-0000-0000-0000000a0009' // Inner West FC: club mode, no two-step
const SLUG = 'inner-west-fc'
const U8_RED = 'af495ca5-3827-450f-8a4e-5e90a2f5a9b3'
const U13_BLACK = '8166af8d-e315-4032-aed2-4dd8268350ec'
const AMARA = '547fae37-239c-4fef-bb24-cb813d6049db' // iw.parent's, U8 Red, born 2018-04-12
const JONAH = '50390257-4ced-4e1b-8081-371782ad56da' // iw.parent's, U13 Black
const TAG = 'Zz AK'
const NUMBERS = ['1234567890123456', '2222333344445555', '3333444455556666', '4444555566667777', '5555666677778888']
const until = async (fn, ms = 20000, every = 1000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, every)) }
  return null
}

const { data: clubBefore } = await admin.from('academies').select('active_kids_provider').eq('id', IW).single()
const { data: switchBefore } = await admin.from('academy_features').select('enabled').eq('academy_id', IW).eq('feature', 'active_kids').maybeSingle()

const president = await signInBoth(admin, 'iw.president@squadroom-demo.test')
const parent = await signInBoth(admin, 'iw.parent@squadroom-demo.test')
const coach = await signInBoth(admin, 'iw.coach@squadroom-demo.test')
const treasurer = await signInBoth(admin, 'iw.treasurer@squadroom-demo.test')
if (!president || !parent || !coach || !treasurer) { console.log("  could not sign in — the project's auth rate limit, not a failure"); process.exit(2) }

async function cleanup() {
  await admin.from('vouchers').delete().eq('academy_id', IW).in('voucher_number', NUMBERS)
  await admin.from('payment_requests').delete().eq('academy_id', IW).like('title', `${TAG} %`)
  await admin.from('academies').update({ active_kids_provider: clubBefore?.active_kids_provider ?? false }).eq('id', IW)
  await president.client.rpc('set_feature', { p_academy: IW, p_feature: 'active_kids', p_enabled: switchBefore ? switchBefore.enabled : true })
}
await cleanup()

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
async function open(who, path, scheme) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 375, height: 812 })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }])
  await page.setCookie({ name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(who.session)).toString('base64'), domain: 'localhost', path: '/' })
  await page.evaluateOnNewDocument((o) => { try { localStorage.setItem('squadroom.org', o) } catch {} }, IW)
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 90000 })
  return { page, context }
}
async function waitFor(page, selector, ms = 45000) {
  const found = await page.waitForSelector(selector, { timeout: ms }).catch(() => null)
  if (found) return found
  await page.reload({ waitUntil: 'networkidle2', timeout: 90000 })
  return page.waitForSelector(selector, { timeout: ms }).catch(() => null)
}
const fits = (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1)
// A plain click scrolls the element to the bottom edge of the viewport,
// under the fixed tab bar, and taps a tab instead. Centre it first.
const tap = async (h) => { await h.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' })); await h.click() }
const shot = (page, name) => SHOTS ? page.screenshot({ path: `.shots/active-kids-${name}.png`, fullPage: true }) : null
const code = (e) => e?.code ?? e?.message ?? 'ok'

let fee = null, feeSmall = null, feeThree = null
try {
  const { data: f1 } = await admin.from('payment_requests').insert({ academy_id: IW, title: `${TAG} fee`, amount_cents: 12000, currency: 'aud', per_player: true, team_id: U8_RED, created_by: president.session.user.id }).select('id').single()
  const { data: f2 } = await admin.from('payment_requests').insert({ academy_id: IW, title: `${TAG} small fee`, amount_cents: 3000, currency: 'aud', per_player: true, team_id: U13_BLACK, created_by: president.session.user.id }).select('id').single()
  const { data: f3 } = await admin.from('payment_requests').insert({ academy_id: IW, title: `${TAG} fee three`, amount_cents: 2000, currency: 'aud', per_player: true, team_id: U13_BLACK, created_by: president.session.user.id }).select('id').single()
  fee = f1; feeSmall = f2; feeThree = f3

  head('1. The club says it is a provider')
  {
    const before = await parent.client.rpc('apply_active_kids_voucher', { p_request: fee.id, p_player: AMARA, p_number: NUMBERS[0], p_child_name: 'Amara Okoro', p_child_dob: '2018-04-12' })
    before.error && /does not take/.test(before.error.message) ? ok('before: the family cannot use one — the club is not a provider') : bad(`before: ${code(before.error)}`)
    const { page, context } = await open(president, '/settings/academy', 'light')
    const box = await waitFor(page, '[data-active-kids-provider]')
    if (!box) bad('no provider switch on Settings → Club')
    else {
      await box.click()
      const on = await until(async () => { const { data } = await admin.from('academies').select('active_kids_provider').eq('id', IW).single(); return data?.active_kids_provider ? data : null }, 15000, 500)
      on && (await fits(page)) ? ok('ticked by the owner: academies.active_kids_provider is true, 375px light') : bad(`after the tick: ${JSON.stringify(on)}`)
      await shot(page, 'settings-light')
    }
    await context.close()
    const { data: pub } = await admin.rpc('public_programs', { p_slug: SLUG })
    pub?.academy?.active_kids === true ? ok('the public page says the club takes vouchers') : bad(`public_programs academy: ${JSON.stringify(pub?.academy)}`)
  }

  head('2. The family puts a voucher on a fee: $50 off')
  {
    const { page, context } = await open(parent, '/payments', 'dark')
    const link = await waitFor(page, `xpath/.//li[contains(., ${JSON.stringify(`${TAG} fee`)}) and contains(., 'Amara')]//button[@data-active-kids]`)
    const links = await page.$$('[data-active-kids]')
    link && links.length >= 3 ? ok(`every fee row offers the voucher (${links.length} rows)`) : bad(`voucher link: ${Boolean(link)}, ${links.length} rows`)
    if (link) {
      await tap(link)
      const form = await page.waitForSelector('[data-active-kids-form]', { timeout: 15000 }).catch(() => null)
      if (!form) throw new Error(`the voucher form did not open — the page is at ${page.url()}`)
      const dob = await until(() => page.$eval('[data-ak-dob]', (el) => el.value || null), 10000, 300)
      const name = await page.$eval('[data-ak-name]', (el) => el.value)
      name === 'Amara Okoro' && dob === '2018-04-12' ? ok('the child\'s name and date of birth are filled in, as the club has them') : bad(`prefilled name "${name}" dob "${dob}"`)
      await page.type('[data-ak-number]', '1234 5678 9012 3456', { delay: 5 })
      await shot(page, 'payments-form-dark')
      await tap(await page.$('[data-ak-apply]'))
      const applied = await page.waitForSelector('[data-voucher-applied]', { timeout: 20000 }).catch(() => null)
      const text = applied ? await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ')) : ''
      applied && /Active & Creative Kids — \$50\.00 off/.test(text) && /\$70\.00/.test(text) && (await fits(page)) ? ok('applied: "Active & Creative Kids — $50.00 off", the fee now $70.00, 375px dark') : bad(`applied ${Boolean(applied)}: ${text.slice(0, 200)}`)
      await shot(page, 'payments-applied-dark')
    }
    await context.close()
    const { data: v } = await admin.from('vouchers').select('id, kind, label, amount_cents, max_uses, used_count, voucher_number, child_name, child_dob, entered_by').eq('voucher_number', NUMBERS[0]).maybeSingle()
    v && v.kind === 'government' && v.amount_cents === 5000 && v.max_uses === 1 && v.used_count === 1 && v.child_name === 'Amara Okoro' && v.child_dob === '2018-04-12' && v.entered_by === parent.session.user.id ? ok('the voucher row: government, $50, once, the child as on the voucher, entered by the parent') : bad(`voucher ${JSON.stringify(v)}`)
    const { data: red } = v ? await admin.from('voucher_redemptions').select('request_id, player_id, amount_cents').eq('voucher_id', v.id).maybeSingle() : { data: null }
    red?.request_id === fee.id && red.player_id === AMARA && red.amount_cents === 5000 ? ok('redeemed on the fee, for Amara, $50') : bad(`redemption ${JSON.stringify(red)}`)
    const { data: mine } = await parent.client.rpc('my_payment_requests', { p_academy: IW })
    const row = (mine ?? []).find((m) => m.request_id === fee.id && m.player_id === AMARA)
    row?.voucher_cents === 5000 && row.voucher_label === 'Active & Creative Kids' ? ok('the family\'s list carries it') : bad(`my_payment_requests: ${JSON.stringify(row)}`)
    const { data: owes } = await president.client.rpc('outstanding_fees', { p_academy: IW })
    const owe = (owes ?? []).find((o) => o.request_id === fee.id && o.player_id === AMARA)
    owe?.outstanding_cents === 7000 ? ok('who-owes says $70.00 for Amara') : bad(`outstanding: ${JSON.stringify(owe)}`)
  }

  head('3. The rules')
  {
    const c = await coach.client.rpc('apply_active_kids_voucher', { p_request: feeSmall.id, p_player: JONAH, p_number: NUMBERS[2], p_child_name: 'Jonah Okoro', p_child_dob: '2013-04-12' })
    c.error?.code === '42501' ? ok('a coach who is not the family cannot put one on a child\'s fee') : bad(`coach: ${code(c.error)}`)
    const twice = await parent.client.rpc('apply_active_kids_voucher', { p_request: feeSmall.id, p_player: JONAH, p_number: '1234-5678-9012-3456', p_child_name: 'Jonah Okoro', p_child_dob: '2013-04-12' })
    twice.error?.code === '23505' && /already been used/.test(twice.error.message) ? ok('the same number again, on another child: already used') : bad(`twice: ${code(twice.error)}`)
    const second = await parent.client.rpc('apply_active_kids_voucher', { p_request: fee.id, p_player: AMARA, p_number: NUMBERS[1], p_child_name: 'Amara Okoro', p_child_dob: '2018-04-12' })
    second.error?.code === '23505' && /already on this fee/.test(second.error.message) ? ok('a second voucher on the same fee: one per fee') : bad(`second: ${code(second.error)}`)
    const shape = await parent.client.rpc('apply_active_kids_voucher', { p_request: feeSmall.id, p_player: JONAH, p_number: '12', p_child_name: 'Jonah Okoro', p_child_dob: '2013-04-12' })
    shape.error && /does not look like/.test(shape.error.message) ? ok('"12" is not a voucher number') : bad(`shape: ${code(shape.error)}`)
    const { data: listed } = await parent.client.from('vouchers').select('id').eq('academy_id', IW)
    ;(listed ?? []).length === 0 ? ok('a parent lists no vouchers') : bad(`parent listed ${listed.length}`)
    const small = await parent.client.rpc('apply_active_kids_voucher', { p_request: feeSmall.id, p_player: JONAH, p_number: NUMBERS[1], p_child_name: 'Jonah Okoro', p_child_dob: '2013-04-12' })
    small.data?.off_cents === 3000 && small.data.left_cents === 0 ? ok('a $30 fee takes $30 of the voucher, nothing left to pay') : bad(`small: ${JSON.stringify(small.data)} ${code(small.error)}`)
    const list = await parent.client.rpc('active_kids_to_redeem', { p_academy: IW })
    const mark = await parent.client.rpc('mark_active_kids_redeemed', { p_voucher: (await admin.from('vouchers').select('id').eq('voucher_number', NUMBERS[0]).single()).data.id, p_redeemed: true })
    list.error?.code === '42501' && mark.error?.code === '42501' ? ok('a parent neither sees the list to redeem nor ticks one') : bad(`parent list ${code(list.error)}, mark ${code(mark.error)}`)
  }

  head('4. The Treasurer\'s list to redeem in Service NSW')
  {
    const { data: rows, error } = await treasurer.client.rpc('active_kids_to_redeem', { p_academy: IW })
    const first = (rows ?? []).find((r) => r.voucher_number === NUMBERS[0])
    !error && (rows ?? []).length === 2 && first && first.child_name === 'Amara Okoro' && first.family && first.fee_title === `${TAG} fee` && first.off_cents === 5000 && !first.redeemed_at && first.waiting === false ? ok(`the Treasurer sees both: ${first.voucher_number} · ${first.child_name} · ${first.family} · ${first.fee_title} · $50.00 off`) : bad(`treasurer list: ${code(error)} ${JSON.stringify(rows)?.slice(0, 300)}`)
    const { page, context } = await open(treasurer, '/admin/payments', 'light')
    const panel = await waitFor(page, '[data-active-kids-panel]')
    const numbers = panel ? await page.$$eval('[data-ak-number]', (els) => els.map((e) => e.textContent?.trim())) : []
    panel && numbers.includes(NUMBERS[0]) && numbers.includes(NUMBERS[1]) && (await fits(page)) ? ok('Admin → Payments shows the list with the numbers, 375px light') : bad(`panel ${Boolean(panel)} numbers ${JSON.stringify(numbers)} fits ${panel ? await fits(page) : '-'}`)
    await shot(page, 'treasurer-light')
    const tick = panel ? await page.$(`[data-ak-row="${NUMBERS[0]}"] [data-ak-redeemed]`) : null
    if (tick) {
      await tap(tick)
      const done = await until(async () => { const { data } = await admin.from('vouchers').select('redeemed_at, redeemed_by').eq('voucher_number', NUMBERS[0]).single(); return data?.redeemed_at ? data : null }, 15000, 500)
      done?.redeemed_by === treasurer.session.user.id ? ok('ticked Redeemed: the voucher carries when and by whom') : bad(`after the tick: ${JSON.stringify(done)}`)
      await page.waitForFunction(() => document.body.innerText.includes('Redeemed '), { timeout: 15000 }).catch(() => {})
      await shot(page, 'treasurer-ticked-light')
    } else bad('no Redeemed tick on the row')
    await context.close()
    const dark = await open(president, '/admin/payments', 'dark')
    const panel2 = await waitFor(dark.page, '[data-active-kids-panel]')
    panel2 && (await fits(dark.page)) ? ok('the owner sees it too, 375px dark') : bad('owner panel')
    await shot(dark.page, 'owner-dark')
    await dark.context.close()
  }

  head('5. Switched off: nothing of it anywhere')
  {
    const { error } = await president.client.rpc('set_feature', { p_academy: IW, p_feature: 'active_kids', p_enabled: false })
    if (error) bad(`set_feature: ${error.message}`)
    const { data: pub } = await admin.rpc('public_programs', { p_slug: SLUG })
    pub?.academy?.active_kids === false ? ok('the public page says the club takes none') : bad(`public_programs: ${JSON.stringify(pub?.academy)}`)
    const refused = await parent.client.rpc('apply_active_kids_voucher', { p_request: feeThree.id, p_player: JONAH, p_number: NUMBERS[3], p_child_name: 'Jonah Okoro', p_child_dob: '2013-04-12' })
    refused.error && /does not take/.test(refused.error.message) ? ok('the family cannot put one on') : bad(`refused: ${code(refused.error)}`)
    const { page, context } = await open(parent, '/payments', 'light')
    await waitFor(page, `xpath/.//li[contains(., ${JSON.stringify(`${TAG} fee three`)})]`)
    const links = await page.$$('[data-active-kids]')
    links.length === 0 ? ok('no voucher link on any fee') : bad(`${links.length} voucher links with the feature off`)
    await context.close()
    const s = await open(president, '/settings/academy', 'light')
    await waitFor(s.page, '[data-photo-required]')
    ;(await s.page.$('[data-active-kids-section]')) === null ? ok('no provider switch on Settings → Club') : bad('the settings section shows with the feature off')
    await s.context.close()
    const t = await open(treasurer, '/admin/payments', 'light')
    await waitFor(t.page, '[data-vouchers], h1')
    await new Promise((r) => setTimeout(r, 1500))
    ;(await t.page.$('[data-active-kids-panel]')) === null ? ok('no list on Admin → Payments') : bad('the panel shows with the feature off')
    await t.context.close()
    await president.client.rpc('set_feature', { p_academy: IW, p_feature: 'active_kids', p_enabled: true })
    const { data: back } = await admin.rpc('public_programs', { p_slug: SLUG })
    await admin.from('academies').update({ active_kids_provider: false }).eq('id', IW)
    const { data: off } = await admin.rpc('public_programs', { p_slug: SLUG })
    back?.academy?.active_kids === true && off?.academy?.active_kids === false ? ok('back on it takes them; a club that is no provider takes none') : bad(`back ${back?.academy?.active_kids}, provider off ${off?.academy?.active_kids}`)
  }
} catch (e) {
  bad(`threw: ${e.message}`)
} finally {
  await browser.close()
  await cleanup()
  const { count } = await admin.from('vouchers').select('id', { count: 'exact', head: true }).in('voucher_number', NUMBERS)
  const { count: fees } = await admin.from('payment_requests').select('id', { count: 'exact', head: true }).eq('academy_id', IW).like('title', `${TAG} %`)
  const { data: after } = await admin.from('academies').select('active_kids_provider').eq('id', IW).single()
  count === 0 && fees === 0 && after?.active_kids_provider === (clubBefore?.active_kids_provider ?? false) ? ok('everything made here is gone; the club\'s setting and switch as they were') : bad(`${count} vouchers, ${fees} fees, provider ${after?.active_kids_provider}`)
}
console.log(process.exitCode ? '' : '\n  \x1b[32mActive & Creative Kids: $50 off at checkout, the Treasurer\'s list to redeem, never Service NSW\x1b[0m\n')
