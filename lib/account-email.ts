import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'

/**
 * An email given before there was an account — joining (with the news
 * opt-in) or registering a child — becomes the account's when a coach
 * approves it. Unconfirmed until they tap the link.
 *
 * Only if the account has none: a parent joining a second team, or one who
 * signed up with their own address, keeps the one they have. Before 0214 the
 * table is not there and this quietly does nothing; the email screen then
 * asks on their first open after it lands.
 *
 * Server only, with the service role, after the caller has authorised the
 * approval itself.
 */
export async function adoptEmail(
  admin: SupabaseClient<Database>,
  profileId: string,
  email: string | null | undefined,
  newsOptInAt: string | null = null
): Promise<void> {
  if (!email) return
  const { data: has, error } = await admin.from('account_emails').select('profile_id').eq('profile_id', profileId).maybeSingle()
  if (error || has) return
  const { error: insertError } = await admin
    .from('account_emails')
    .insert({ profile_id: profileId, email: email.trim().toLowerCase(), news_opt_in_at: newsOptInAt })
  if (!insertError && newsOptInAt) {
    await admin.from('news_consents').insert({ profile_id: profileId, opted_in: true, email: email.trim().toLowerCase(), at: newsOptInAt })
  }
}
