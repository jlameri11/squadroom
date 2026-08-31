import { createClient } from '@supabase/supabase-js'

/**
 * The service-role client. This bypasses every RLS policy in the database.
 *
 * It exists for exactly one reason: parts of the join flow happen before the
 * person has any identity at all, so there is no user for RLS to authorise.
 * Every other data path in the app goes through the user's own client.
 *
 * Rules for touching this file:
 *   - Never import it into a Client Component or anything under app/ that
 *     renders in the browser. The key must never reach a bundle.
 *   - Every function that uses it must do its own authorisation check first,
 *     explicitly, because the database will not do it for you.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. Add it to .env.local from ' +
        'Supabase → Project Settings → API keys → service_role.'
    )
  }

  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
