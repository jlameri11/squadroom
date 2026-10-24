'use client'

import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'

/**
 * The same browser client, without the generated row types.
 *
 * `lib/database.types.ts` is generated from the DEPLOYED schema (`npm run
 * types`), so a table that exists in a migration but has not been applied yet
 * is a compile error — `from('programs')` is "not assignable to parameter of
 * type never", which is a confusing way to be told the migration is pending.
 *
 * This is not a way around the types. It is a way to write the screens for a
 * migration before it can be applied, which is the situation this repo has
 * been in for two sessions. The methods are still typed; only the row shapes
 * are loose, and each caller declares its own.
 *
 * WHEN 0079-0085 ARE APPLIED: run `npm run types`, then replace these calls
 * with the ordinary client and delete this file. Every use is a reminder that
 * the types are behind.
 */
export function createUntypedClient(): SupabaseClient {
  return createClient() as unknown as SupabaseClient
}
