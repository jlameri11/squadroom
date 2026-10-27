import { createClient } from '@supabase/supabase-js'
const URL=process.env.NEXT_PUBLIC_SUPABASE_URL, PUB=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const admin=createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}})
const anon =createClient(URL, PUB,{auth:{persistSession:false}})
const ok=m=>console.log(`  \x1b[32m✓\x1b[0m ${m}`), bad=m=>{console.log(`  \x1b[31m✗\x1b[0m ${m}`);process.exitCode=1}
const head=m=>console.log(`\n${m}`)
const NRIFA='00000000-0000-0000-0000-0000000a0001'
const U8='00000000-0000-0000-0000-0000000d0008'

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
const coach  = await sess('joeylameri@outlook.com')
const parent = await sess('p61400000011@squadroom.invalid')

await admin.from('events').delete().eq('source','import')

const DATE = new Date(Date.now() + 10*864e5).toISOString().slice(0,10)
const draw = [
  { external_ref:'DRIBL-1001', local_date:DATE, local_time:'09:00', title:'Round 14 vs Gladesville',
    opponent:'Gladesville Ravens', venue:'ELS Hall Park, Field 3', round:'Round 14' },
  { external_ref:'DRIBL-1002', local_date:DATE, local_time:'10:30', title:'Round 14 vs Hornsby',
    opponent:'Hornsby', venue:'Pennant Hills Park', round:'Round 14' },
  { external_ref:'DRIBL-1003', local_date:DATE, local_time:'19:30', end_time:'21:00',
    title:'Night game', opponent:'Epping', venue:'Somerset Field', round:'Round 14' },
]

head('1. A coach imports a draw')
const { data: first, error: fe } = await coach.client.rpc('create_imported_events',
  { p_academy: NRIFA, p_team: U8, p_events: draw })
fe ? bad(fe.message) : first[0].created === 3
  ? ok(`${first[0].created} games created, ${first[0].updated} updated`)
  : bad(JSON.stringify(first[0]))

head("2. The club's timezone is applied, not the server's")
const { data: made } = await admin.from('events').select('starts_at, title, external_ref')
  .eq('source','import').order('starts_at')
const sydney = new Date(made[0].starts_at).toLocaleString('en-AU',
  { timeZone:'Australia/Sydney', hour:'numeric', minute:'2-digit', hour12:false })
sydney === '09:00' ? ok(`9:00 in the spreadsheet is 9:00 in Sydney`)
                   : bad(`came out as ${sydney}`)

head('3. Re-importing the same file does not duplicate the season')
const { data: again } = await coach.client.rpc('create_imported_events',
  { p_academy: NRIFA, p_team: U8, p_events: draw })
again[0].created === 0 && again[0].updated === 3
  ? ok(`second run: 0 created, ${again[0].updated} updated — matched on the fixture reference`)
  : bad(`second run created ${again[0].created}`)
const { count } = await admin.from('events').select('*',{count:'exact',head:true}).eq('source','import')
count === 3 ? ok(`still ${count} games, not 6`) : bad(`${count} events after two imports`)

head('4. A game that moved, moves — it does not appear twice')
const moved = draw.map(d => d.external_ref === 'DRIBL-1002' ? { ...d, local_time:'14:15' } : d)
await coach.client.rpc('create_imported_events', { p_academy: NRIFA, p_team: U8, p_events: moved })
const { data: after } = await admin.from('events').select('starts_at')
  .eq('external_ref','DRIBL-1002').single()
const movedTo = new Date(after.starts_at).toLocaleString('en-AU',
  { timeZone:'Australia/Sydney', hour:'numeric', minute:'2-digit', hour12:false })
movedTo === '14:15' ? ok('10:30 became 14:15 on the same row') : bad(`shows ${movedTo}`)
const { count: stillThree } = await admin.from('events').select('*',{count:'exact',head:true}).eq('source','import')
stillThree === 3 ? ok('still 3 games') : bad(`${stillThree} games after a reschedule`)

head('5. A file with no id column still cannot duplicate')
const noRef = draw.map(({ external_ref, ...rest }) => rest)
await admin.from('events').delete().eq('source','import')
await coach.client.rpc('create_imported_events', { p_academy: NRIFA, p_team: U8, p_events: noRef })
const { data: pass2 } = await coach.client.rpc('create_imported_events',
  { p_academy: NRIFA, p_team: U8, p_events: noRef })
pass2[0].created === 0
  ? ok('falls back to team + kick-off: one team cannot play twice at one moment')
  : bad(`created ${pass2[0].created} duplicates without a reference column`)

head('6. A row with no date is skipped, not guessed at')
const { data: partial } = await coach.client.rpc('create_imported_events', {
  p_academy: NRIFA, p_team: U8,
  p_events: [{ local_date:'', local_time:'09:00', title:'Broken row' },
             { external_ref:'DRIBL-2001', local_date:DATE, local_time:'08:00', title:'Good row' }],
})
partial[0].skipped === 1 && partial[0].created === 1
  ? ok('1 skipped, 1 created — and the screen names the skipped row')
  : bad(JSON.stringify(partial[0]))

head('7. A parent cannot import a draw')
const { error: parentImport } = await parent.client.rpc('create_imported_events',
  { p_academy: NRIFA, p_team: U8, p_events: draw })
parentImport ? ok(`refused: ${parentImport.message}`)
             : bad('a parent created team fixtures for everyone')

head('8. Imported games behave like any other fixture')
const { data: upcoming } = await parent.client.rpc('my_upcoming_events',
  { p_academy: NRIFA, p_days: 30 })
const imported = (upcoming ?? []).filter(e => e.source === 'import')
imported.length > 0
  ? ok(`a parent in that team sees ${imported.length} of them, with RSVP and reminders`)
  : bad('imported fixtures are invisible to the team')

await admin.from('events').delete().eq('source','import')
console.log('\ncleaned up\n')
