import { createClient } from '@supabase/supabase-js'
const URL=process.env.NEXT_PUBLIC_SUPABASE_URL, PUB=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const admin=createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}})
const anon =createClient(URL, PUB,{auth:{persistSession:false}})
const ok=m=>console.log(`  \x1b[32m✓\x1b[0m ${m}`), bad=m=>{console.log(`  \x1b[31m✗\x1b[0m ${m}`);process.exitCode=1}
const head=m=>console.log(`\n${m}`)
const NRIFA='00000000-0000-0000-0000-0000000a0001'
const LIMIT=20

async function sess(email){
  const { data:l } = await admin.auth.admin.generateLink({type:'magiclink', email})
  // generateLink is rate limited per project as well as verifyOtp, and
  // returns null when it trips — so this property read throws before any
  // session check runs, and the runner reports a crash that is really the
  // auth budget.
  if (!l?.properties?.hashed_token) {
    console.log("  could not issue a magic link — the project's auth rate limit, not a failure")
    process.exit(2)
  }
  const { data:s } = await anon.auth.verifyOtp({token_hash:l.properties.hashed_token, type:'email'})
  return { client: createClient(URL, PUB, {auth:{persistSession:false},
    global:{headers:{Authorization:`Bearer ${s.session.access_token}`}}}), id: s.user.id }
}

const sam   = await sess('p61400000011@squadroom.invalid')
const other = await sess('p61400000012@squadroom.invalid')
await admin.from('event_scans').delete().in('profile_id', [sam.id, other.id])

const newScan = (who) => who.client.from('event_scans')
  .insert({ academy_id: NRIFA, profile_id: who.id, storage_path: `${NRIFA}/${who.id}/x.jpg` })
  .select('id').single()

head(`1. Twenty a day is allowed — nobody's real use is near it`)
let created = 0, firstError = null
for (let i = 0; i < LIMIT; i++) {
  const { error } = await newScan(sam)
  if (error) { firstError = error.message; break }
  created++
}
created === LIMIT ? ok(`${created} scans accepted`) : bad(`stopped at ${created}: ${firstError}`)

head('2. The twenty-first is refused, in words a parent can act on')
const { error: over } = await newScan(sam)
over ? ok(`refused: "${over.message}"`) : bad('the cap did not bite')
over && /try again tomorrow/i.test(over.message)
  ? ok('says what to do next, not just that it failed')
  : bad('the message is not actionable')

head('3. The cap is per person, not per academy')
const { error: neighbour } = await newScan(other)
neighbour ? bad(`another parent was blocked by someone else's usage: ${neighbour.message}`)
          : ok('a different parent at the same academy is unaffected')

head('4. It cannot be walked around by inserting directly')
// The client holds a real session, so this IS the bypass a determined person
// would try. It is the same path, which is the point of a trigger.
const { error: direct } = await sam.client.from('event_scans')
  .insert({ academy_id: NRIFA, profile_id: sam.id, storage_path: 'x/y/z.jpg' })
direct ? ok('a direct insert is refused too — the limit is in the database')
       : bad('the limit was skipped by inserting directly')

head('5. Yesterday does not count against today')
await admin.from('event_scans')
  .update({ created_at: new Date(Date.now() - 26*36e5).toISOString() })
  .eq('profile_id', sam.id)
const { error: fresh } = await newScan(sam)
fresh ? bad(`still blocked after the window moved on: ${fresh.message}`)
      : ok('a rolling 24 hours, so the cap clears rather than latching')

await admin.from('event_scans').delete().in('profile_id', [sam.id, other.id])
console.log('\ncleaned up\n')
