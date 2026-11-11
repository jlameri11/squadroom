// Run: node --env-file=.env.local scripts/demo-accounts.mjs
//
// Two demo sign-ins that show one role each (Joey, 9 Nov 2026):
//   Head of academy   — NRIFA's owner, nothing else
//   League organiser  — the Sydney Premier League's staff, nothing else
// Joey's own account keeps both. Password squadroom-demo (docs/DEMO.md).
// DEV ONLY, idempotent: made once, kept in step every run. Each has an email
// (0214) nobody can receive, marked confirmed; both organisations are
// grandfathered for two-step (0231), so a password signs them in.
import { createClient } from '@supabase/supabase-js'
import { PROJECT_REF, PROJECT_NAME } from './_project.mjs'
import { listAllUsers } from './_users.mjs'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.includes(PROJECT_REF)) {
  console.error(`\n  Refusing to run: this is not ${PROJECT_NAME}.\n`)
  process.exit(1)
}
const PASSWORD = process.env.DEMO_PASSWORD ?? 'squadroom-demo'
const NRIFA = '00000000-0000-0000-0000-0000000a0001'
const SPL = '00000000-0000-0000-0000-0000000a0003'
const ACCOUNTS = [
  { email: 'head@squadroom-demo.test', name: 'Head of Academy', academy: NRIFA, role: 'owner' },
  { email: 'organiser@squadroom-demo.test', name: 'League Organiser', academy: SPL, role: 'admin' },
]

const { data: list } = await listAllUsers(admin)
for (const a of ACCOUNTS) {
  let user = list?.users?.find((u) => u.email === a.email)
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({ email: a.email, password: PASSWORD, email_confirm: true })
    if (error) throw new Error(`${a.email}: ${error.message}`)
    user = data.user
  } else {
    await admin.auth.admin.updateUserById(user.id, { password: PASSWORD })
  }
  await admin.from('profiles').upsert({ id: user.id, full_name: a.name })
  await admin.from('account_emails').upsert({ profile_id: user.id, email: a.email, verified_at: new Date().toISOString() }, { onConflict: 'profile_id' })
  // One organisation, one role — and no other membership anywhere.
  await admin.from('academy_members').delete().eq('profile_id', user.id).neq('academy_id', a.academy)
  await admin.from('academy_members').upsert({ academy_id: a.academy, profile_id: user.id, role: a.role, status: 'active' }, { onConflict: 'academy_id,profile_id' })
  // The club's rule: a staff role needs a current Working With Children Check on record.
  await admin.from('staff_clearances').upsert(
    { academy_id: a.academy, profile_id: user.id, kind: 'wwcc', number: `DEMO${a.role.toUpperCase()}1`, outcome: 'cleared', expires_on: new Date(Date.now() + 700 * 864e5).toISOString().slice(0, 10) },
    { onConflict: 'academy_id,profile_id' }
  ).then(({ error }) => error && console.log(`  (clearance for ${a.email}: ${error.message})`))
  console.log(`  ${a.name}: ${a.email} / ${PASSWORD}`)
}
console.log('\n  Done. Both are in docs/DEMO.md.\n')
