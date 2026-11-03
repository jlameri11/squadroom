import { createClient } from '@supabase/supabase-js'
import type { Centre } from './match-centre'
import type { PublicSponsor } from './sponsor-strip'

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

/** X-08: the organiser's sponsors for the strip — a name, a logo, a link. */
export async function loadSponsors(slug: string): Promise<PublicSponsor[]> {
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false } }
  )
  const { data } = await anon.rpc('public_sponsors', { p_slug: slug })
  return (data as unknown as PublicSponsor[]) ?? []
}
