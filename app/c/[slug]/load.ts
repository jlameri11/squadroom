import { createClient } from '@supabase/supabase-js'
import type { Centre } from './match-centre'

/**
 * The public page's one read, shared by the page and its embed. An anon
 * client built here rather than lib/supabase/server: no cookies, so the
 * response is cacheable and nothing is stored about whoever is reading.
 */
export async function load(slug: string): Promise<Centre | null> {
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false } }
  )
  const { data } = await anon.rpc('public_match_centre', { p_slug: slug })
  return (data as unknown as Centre) ?? null
}
