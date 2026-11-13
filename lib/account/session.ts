import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'
import { createClient } from '@/lib/supabase/server'

type Admin = SupabaseClient<Database>

/**
 * A session minted here on the server: a one-time link generated and
 * redeemed in the same request, so the session never travels as a URL. The
 * ssr client writes the cookies. Used by the two claim routes and by the
 * account routes once a code has been proven.
 *
 * Takes the address the account SIGNS IN WITH — read from the account, never
 * guessed from a phone number: a generated link for an address nobody holds
 * makes a brand-new empty account (0214 learnt this with Joey's).
 */
export async function mintSession(admin: Admin, authEmail: string): Promise<boolean> {
  const { data: link, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: authEmail })
  const tokenHash = link?.properties?.hashed_token
  if (error || !tokenHash) return false
  const supabase = await createClient()
  const { error: verifyErr } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'email' })
  return !verifyErr
}

/** The address an account signs in with: a real one, or the placeholder made from its mobile. */
export async function signInEmailOf(admin: Admin, profileId: string): Promise<string | null> {
  const { data } = await admin.auth.admin.getUserById(profileId)
  return data?.user?.email ?? null
}
