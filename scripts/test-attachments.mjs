import { createClient } from '@supabase/supabase-js'
const URL=process.env.NEXT_PUBLIC_SUPABASE_URL, PUB=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const admin=createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}})
const anon =createClient(URL, PUB,{auth:{persistSession:false}})
const ok=m=>console.log(`  \x1b[32m✓\x1b[0m ${m}`), bad=m=>{console.log(`  \x1b[31m✗\x1b[0m ${m}`);process.exitCode=1}
const head=m=>console.log(`\n${m}`)
const NRIFA='00000000-0000-0000-0000-0000000a0001'

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

const coach   = await sess('joeylameri@outlook.com')          // U8 host
const parent  = await sess('p61400000011@squadroom.invalid')  // Sam, U8 parent
const outsider= await sess('p61400000092@squadroom.invalid')  // Ravens parent

const { data: u8 } = await admin.from('channels').select('id')
  .eq('team_id','00000000-0000-0000-0000-0000000d0008').eq('type','team').single()
await admin.from('channels').update({ posting_mode:'open' }).eq('id', u8.id)

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64')
const p = (uid) => `${NRIFA}/${u8.id}/${uid}/${crypto.randomUUID()}.png`

head('1. A parent in an open channel can upload')
const parentPath = p(parent.id)
const up1 = await parent.client.storage.from('attachments').upload(parentPath, png, { contentType:'image/png' })
up1.error ? bad(up1.error.message) : ok('uploaded')

head('2. Only into their own folder')
const spoof = await parent.client.storage.from('attachments')
  .upload(`${NRIFA}/${u8.id}/${coach.id}/${crypto.randomUUID()}.png`, png, { contentType:'image/png' })
spoof.error ? ok('refused an upload under someone else’s id') : bad('uploaded as another user')

head('3. Someone outside the channel cannot read it')
const { data: sneak } = await outsider.client.storage.from('attachments').createSignedUrl(parentPath, 60)
sneak?.signedUrl ? bad('outsider got a signed URL') : ok('refused — not a channel member')

head('4. A channel member can read it')
const { data: allowed } = await coach.client.storage.from('attachments').createSignedUrl(parentPath, 60)
allowed?.signedUrl ? ok('host got a signed URL') : bad('member could not read')

head('5. In hosts_only, a parent who cannot post also cannot upload')
await coach.client.from('channels').update({ posting_mode:'hosts_only' }).eq('id', u8.id)
const blocked = await parent.client.storage.from('attachments').upload(p(parent.id), png, { contentType:'image/png' })
blocked.error ? ok('refused — otherwise broadcast mode is text-only in name') : bad('parent uploaded in hosts_only')

head('6. But can still SEE photos posted there')
const { data: stillReads } = await parent.client.storage.from('attachments').createSignedUrl(parentPath, 60)
stillReads?.signedUrl ? ok('reading is membership, not posting rights') : bad('parent lost read access')

head('7. The bucket is private')
const { data: pub } = await admin.from('buckets').select('public').eq('id','attachments').maybeSingle().then(r=>r).catch(()=>({data:null}))
const res = await fetch(`${URL}/storage/v1/object/public/attachments/${parentPath}`)
res.status === 400 || res.status === 404
  ? ok(`no public URL works (${res.status})`)
  : bad(`public URL returned ${res.status}`)

await coach.client.from('channels').update({ posting_mode:'open' }).eq('id', u8.id)
await admin.storage.from('attachments').remove([parentPath])
console.log(process.exitCode ? '\n\x1b[31mSTORAGE RULES BROKEN\x1b[0m\n' : '\n\x1b[32mSTORAGE RULES HOLD\x1b[0m\n')
process.exit(process.exitCode ?? 0)
