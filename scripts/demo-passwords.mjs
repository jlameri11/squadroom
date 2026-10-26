// Run: node --env-file=.env.local scripts/demo-passwords.mjs
//
// Gives the demo accounts a password, so the parent view can actually be
// shown.
//
// The problem it solves: every seeded family has a SYNTHETIC email address —
// p61400000011@squadroom.invalid — because Supabase Auth is email-shaped and
// our parents arrive with phone numbers. `.invalid` is reserved by RFC 2606
// precisely so it can never resolve, which is the point for a real parent and
// a dead end for a demo: a magic link to that address goes nowhere, so there
// was no way to sign in as a parent and show the half of the product that
// matters most.
//
// A password needs no mail delivery, and the sign-in screen already defaults
// to it. DEV ONLY: this is demo data on squadroom-dev, and the password is
// deliberately obvious. Never run it anywhere with real families in it.
import { createClient } from '@supabase/supabase-js'
import { PROJECT_REF, PROJECT_NAME } from './_project.mjs'

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

const PASSWORD = process.env.DEMO_PASSWORD ?? 'squadroom-demo'
const NRIFA = '00000000-0000-0000-0000-0000000a0001'

// The ref comes from _project.mjs, which is the only place in scripts/ that
// names a project. test-project-guard.mjs scans the whole directory for a
// second copy and failed this file, correctly — a guard that can be bypassed
// by retyping a constant is a guard that will be.
if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.includes(PROJECT_REF)) {
  console.error(`\n  Refusing to run: this is not ${PROJECT_NAME}.\n`)
  process.exit(1)
}

// Only the synthetic addresses. A real address — Joey's — is left alone: it
// can receive a link, and overwriting a real person's password from a script
// is not this script's business.
// Two separate reads, and both errors checked.
//
// The embed form — profiles(full_name) — fails here with "more than one
// relationship was found", because academy_members points at profiles twice:
// once as the member and once as whoever invited them. The first version did
// not check the error, so it silently set zero passwords and reported
// success. Same shape as the seed bug that printed "13 children linked" while
// writing none.
const { data: members, error: membersError } = await admin
  .from('academy_members')
  .select('profile_id, role')
  .eq('academy_id', NRIFA)
  .eq('status', 'active')
if (membersError) throw new Error(`reading members: ${membersError.message}`)

const { data: names, error: namesError } = await admin
  .from('profiles')
  .select('id, full_name')
  .in('id', (members ?? []).map((m) => m.profile_id))
if (namesError) throw new Error(`reading names: ${namesError.message}`)
const nameOf = Object.fromEntries((names ?? []).map((p) => [p.id, p.full_name]))

console.log('\nSetting demo passwords\n')

const rows = []
for (const m of members ?? []) {
  const { data: u } = await admin.auth.admin.getUserById(m.profile_id)
  const email = u?.user?.email
  if (!email?.endsWith('@squadroom.invalid')) continue

  const { error } = await admin.auth.admin.updateUserById(m.profile_id, { password: PASSWORD })
  if (error) throw new Error(`${email}: ${error.message}`)
  rows.push({ name: nameOf[m.profile_id] ?? '(no name)', role: m.role, email })
}

// Coaches and a parent or two is what a demo needs; the rest is noise.
const show = [
  ...rows.filter((r) => r.role !== 'parent'),
  ...rows.filter((r) => r.role === 'parent').slice(0, 3),
]
for (const r of show) {
  console.log(`  ${r.role.padEnd(7)} ${r.name.padEnd(18)} ${r.email}`)
}
if (rows.length === 0) {
  console.error('\n  No synthetic accounts found — nothing was set. Check the seed data.\n')
  process.exit(1)
}

console.log(`\n  ${rows.length} accounts set. Password: ${PASSWORD}`)
console.log('  Sign in at /signin — it defaults to a password, not a link.\n')
