import { createClient } from '@supabase/supabase-js'
const URL=process.env.NEXT_PUBLIC_SUPABASE_URL, PUB=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const admin=createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}})
const anon =createClient(URL, PUB,{auth:{persistSession:false}})
const ok=m=>console.log(`  \x1b[32m✓\x1b[0m ${m}`), bad=m=>{console.log(`  \x1b[31m✗\x1b[0m ${m}`);process.exitCode=1}
async function sess(email){
  const { data:l } = await admin.auth.admin.generateLink({type:'magiclink', email})
  const { data:s } = await anon.auth.verifyOtp({token_hash:l.properties.hashed_token, type:'email'})
  return createClient(URL, PUB, {auth:{persistSession:false},
    global:{headers:{Authorization:`Bearer ${s.session.access_token}`}}})
}
const owner = await sess('joeylameri@outlook.com')      // in platform_admins
const spl   = await sess('p61400000301@squadroom.invalid') // a league owner, not platform
const parent= await sess('p61400000011@squadroom.invalid')

console.log('\nThe platform page')
const { data: mine } = await owner.rpc('platform_overview')
mine?.length >= 3 ? ok(`platform owner sees all ${mine.length} organisations`) : bad(`saw ${mine?.length}`)
const { data: totals } = await owner.rpc('platform_totals')
totals?.[0] ? ok(`totals: ${totals[0].organisations} orgs · ${totals[0].people} people · ${totals[0].messages} messages · ${totals[0].active_7d} active this week`) : bad('no totals')

const { data: splSees } = await spl.rpc('platform_overview')
;(splSees?.length ?? 0) === 0 ? ok('a league owner sees nothing — running an org is not running the platform') : bad(`league owner saw ${splSees.length}`)
const { data: parentSees } = await parent.rpc('platform_overview')
;(parentSees?.length ?? 0) === 0 ? ok('a parent sees nothing') : bad(`parent saw ${parentSees.length}`)

console.log('\nWhat it deliberately cannot reach')
const cols = Object.keys(mine[0] ?? {})
const leaky = cols.filter(c => /phone|email|body|dob|child/i.test(c))
leaky.length === 0 ? ok(`counts only — no contact details, message bodies or children (${cols.length} columns)`) : bad(`leaks: ${leaky}`)

// The platform owner is still just a member everywhere else.
const { count } = await owner.from('messages').select('*',{count:'exact',head:true}).eq('academy_id','00000000-0000-0000-0000-0000000a0002')
count === 0 ? ok('and still cannot read another academy’s messages') : bad(`read ${count} of Ravens' messages`)

console.log(process.exitCode ? '\n\x1b[31mBROKEN\x1b[0m\n' : '\n\x1b[32mPLATFORM PAGE HOLDS\x1b[0m\n')
process.exit(process.exitCode ?? 0)
