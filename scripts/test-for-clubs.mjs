// Run: node --env-file=.env.local scripts/test-for-clubs.mjs
//   (needs the app running)
//
// The public "for academies, clubs and leagues" page: answers a stranger
// with no cookie, says who it is for and what the deal is, sets nothing on
// their browser, offers the free trial and nothing that needs an account.
import { resolveBaseUrl } from './_base-url.mjs'

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`)
  process.exitCode = 1
}
const head = (m) => console.log(`\n${m}`)

const BASE = await resolveBaseUrl()

head('1. The front door for a club')
const res = await fetch(`${BASE}/for-clubs`, { redirect: 'manual' })
res.status === 200 ? ok('answers a stranger') : bad(`status ${res.status}`)
const html = await res.text()
const says = (re, what) => (re.test(html) ? ok(what) : bad(`missing: ${what}`))
says(/academies/i, 'says it is for academies')
says(/leagues/i, 'and leagues')
says(/never by parents/i, 'and that parents never pay')
says(/signup\?next=%2Fstart|signup\?next=\/start/, 'offers the free trial, which lands in the setup checklist')
says(/privacy/i, 'links the privacy page')
!/<nav/.test(html) ? ok('no tab bar — nothing that needs an account') : bad('a tab bar is offered to a stranger')
;(res.headers.get('set-cookie') ?? '') === '' ? ok('sets no cookie') : bad(`sets a cookie: ${res.headers.get('set-cookie')}`)
// A dollar figure followed by "a month", "per team" and the like — not the
// "$1" that React's own payload is full of.
!/\$\s?\d[\d,.]*\s*(a|per|\/)\s*(month|year|team|player|club|season)/i.test(html) ? ok('names no price — pricing is still Joey\'s call') : bad('a price is on the page')

head('2. The trial really starts there')
const signup = await fetch(`${BASE}/signup?next=/start`, { redirect: 'manual' })
signup.status === 200 ? ok('the sign-up page answers') : bad(`signup: ${signup.status}`)

console.log(process.exitCode ? '\n\x1b[31mTHE FRONT DOOR IS WRONG\x1b[0m\n' : '\n\x1b[32mall good\x1b[0m\n')
