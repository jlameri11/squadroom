// Run: node scripts/test-navigation.mjs
//
// Named test-* so scripts/test-all.mjs picks it up. It was audit-* first,
// which meant the suite ignored it — and a check that only runs when
// somebody remembers is the kind that was missing in the first place.
//
// Which pages can a person actually reach by tapping?
//
// This exists because three screens have now been built and left reachable
// only by typing a URL — /programs, /payments, and then /platform and the
// competition invite page, which is the one action the whole commercial case
// for Tournament Mode rests on. Every one of them was found by looking at
// navigation rather than at code, and none of them would ever fail a test.
//
// A page nobody can reach is worse than a missing page: it looks finished.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const APP = 'app'
const EXTRA = ['components', 'lib']

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`)
  process.exitCode = 1
}

/**
 * Pages a person can be sent to. `api` is left out — a route handler is not
 * somewhere anybody navigates — and so is anything under a `_` folder.
 */
function pages(dir, prefix = '') {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (!statSync(full).isDirectory()) {
      if (name === 'page.tsx') out.push(prefix || '/')
      continue
    }
    if (name === 'api' || name.startsWith('_')) continue
    // A route group — (marketing) — adds no path segment.
    const seg = name.startsWith('(') ? '' : '/' + name
    out.push(...pages(full, prefix + seg))
  }
  return out
}

function sources(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === '.next') continue
      sources(full, acc)
    } else if (/\.tsx?$/.test(name)) {
      acc.push(readFileSync(full, 'utf8'))
    }
  }
  return acc
}

const all = pages(APP).sort()
const text = [...sources(APP), ...EXTRA.flatMap((d) => sources(d))].join('\n')

/**
 * Does anything point here?
 *
 * A dynamic segment is matched as a wildcard rather than by its literal
 * name, because a link is written `/calendar/${event.id}` and never
 * `/calendar/[eventId]`. The first version of this check joined the static
 * segments together — turning `/competitions/[id]/invite` into
 * `/competitions/invite` — and then reported a page it had just been linked
 * to as unreachable. A tool that cries wolf is a tool nobody runs twice.
 */
function reachable(route) {
  if (route === '/') return true

  const parts = route.split('/').filter(Boolean)
  const pattern = parts
    .map((p, i) => {
      if (!p.startsWith('[')) return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      // Anything that is not a slash or a quote: an id, a template
      // expression, a variable.
      //
      // The LAST segment may also be empty, because a link to a dynamic
      // route is often built by concatenation or by a replace and so appears
      // in the source as a bare `'/my/'`. Requiring a character after the
      // slash reported /my/[token] as unreachable when settings links to it
      // on two lines — the second false positive this check produced, and a
      // tool that cries wolf is a tool nobody runs twice.
      const last = i === parts.length - 1
      return last ? '[^/\'"`\\s)]*' : '[^/\'"`\\s)]+'
    })
    .join('/')

  // Inside a string or a template literal, which is every way a route is
  // written in this codebase.
  return new RegExp(`['"\`]/${pattern}`).test(text)
}

console.log(`\n${all.length} pages\n`)

const unreachable = []
for (const route of all) {
  // A page whose FIRST segment is dynamic is an entry point — a public
  // register link, a join token, a slug somebody is given. Nothing in the app
  // links to it and nothing should.
  const entryPoint = route.split('/').filter(Boolean)[0]?.startsWith('[')
  if (entryPoint) {
    console.log(`  \x1b[2mentry\x1b[0m     ${route}`)
    continue
  }
  if (reachable(route)) continue
  unreachable.push(route)
}

if (unreachable.length === 0) {
  ok(`every page is reachable by tapping (${all.length} checked)`)
} else {
  for (const r of unreachable) bad(`nothing links to ${r}`)
  console.log(
    '\n  A page nobody can reach is worse than a missing one: it looks\n' +
      '  finished. Link it, or delete it.\n'
  )
}

// A second, cheaper check with the same purpose: a tap that goes nowhere.
const dangling = [...text.matchAll(/href=["'`](\/[a-z0-9[\]/-]*)["'`]/gi)]
  .map((m) => m[1])
  .filter((h) => !h.startsWith('/api'))
const known = new Set(all)
const missing = [...new Set(dangling)].filter((h) => {
  if (known.has(h)) return false
  // A link into a dynamic route, which the page list holds under its
  // bracketed name.
  return ![...known].some((k) => {
    const parts = k.split('/').filter(Boolean)
    const pattern = parts
      .map((p) => (p.startsWith('[') ? '[^/]+' : p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      .join('/')
    return new RegExp(`^/${pattern}$`).test(h)
  })
})

if (missing.length === 0) {
  ok('and every link points at a page that exists')
} else {
  for (const m of missing) bad(`link to ${m}, which is not a page`)
}

console.log(
  process.exitCode
    ? '\n\x1b[31mNAVIGATION HAS DEAD ENDS\x1b[0m\n'
    : '\n\x1b[32mNAVIGATION HOLDS\x1b[0m\n'
)
