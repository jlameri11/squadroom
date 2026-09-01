import type { Config } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

/**
 * Deletes screenshots seven days after they were uploaded.
 *
 * The event survives; the picture does not. A fixture list is harmless, but
 * the same box will eventually take a team sheet with children's names on
 * it, and the honest answer to "how long do you keep it" has to be a number
 * we actually enforce rather than an intention.
 *
 * Two steps on purpose. Deleting the row in storage.objects would leave the
 * object sitting in the bucket, so the file goes first and only then is the
 * scan marked purged — a crash in between means it is tried again tomorrow,
 * which is harmless.
 */
export default async function handler() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return new Response('Missing configuration', { status: 500 })

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } })

  const { data: due, error } = await supabase.rpc('scans_due_for_purge')
  if (error) return new Response(`lookup failed: ${error.message}`, { status: 500 })
  if (!due || due.length === 0) return new Response('nothing to purge', { status: 200 })

  const rows = due as { id: string; storage_path: string }[]
  const { error: removeError } = await supabase.storage
    .from('scans')
    .remove(rows.map((r) => r.storage_path))

  if (removeError) return new Response(`remove failed: ${removeError.message}`, { status: 500 })

  for (const row of rows) {
    await supabase.rpc('mark_scan_purged', { p_scan: row.id })
  }

  return new Response(`purged ${rows.length}`, { status: 200 })
}

export const config: Config = { schedule: '17 3 * * *' }
