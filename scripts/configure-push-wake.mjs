/**
 * Points the database at the wake endpoint. Run after a deploy that changes
 * the site URL, or after rotating PUSH_WAKE_SECRET.
 *
 * The secret is read from the environment and written straight into
 * app_private, which nothing but the service role can reach. It is never
 * printed.
 */
import { createClient } from '@supabase/supabase-js'

const url = process.env.PUSH_WAKE_URL
  ?? 'https://squadroom-dev.netlify.app/.netlify/functions/push-now'
const secret = process.env.PUSH_WAKE_SECRET

if (!secret) {
  console.error('PUSH_WAKE_SECRET is not set. Nothing written.')
  process.exit(1)
}

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

const { error } = await admin.rpc('set_push_wake_config', { p_url: url, p_secret: secret })
if (error) {
  console.error(error.message)
  process.exit(1)
}
console.log(`wake endpoint set to ${url}`)
