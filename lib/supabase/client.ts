import { createBrowserClient } from '@supabase/ssr'

/**
 * The browser client. Everything the app reads and writes goes through this,
 * under the signed-in user's own identity, so RLS is doing the authorisation.
 * There is no second, privileged path from the client.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  )
}
