import { createClient } from '@supabase/supabase-js'
import type { Centre, PublicClub } from './match-centre'
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

/** Who runs this competition, in their colours: public_brand (0209). Null
 *  until that is applied, and the page is then Squadroom's black and white. */
export type Brand = { name: string; primary: string | null; secondary: string | null; logo: string | null }
export async function loadBrand(slug: string): Promise<Brand | null> {
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false } }
  )
  const { data, error } = await anon.rpc('public_brand', { p_slug: slug, p_kind: 'competition' })
  if (error || !data) return null
  return data as unknown as Brand
}

/** X-08: the organiser's sponsors for the strip — a name, a logo, a link. */
/** 0260: what the organiser's switches let this page offer (the ladder breakdown). */
export type PublicSwitches = { ladder_breakdown?: boolean }
export async function loadSwitches(slug: string): Promise<PublicSwitches> {
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false } }
  )
  const { data } = await anon.rpc('public_switches', { p_slug: slug })
  return (data as unknown as PublicSwitches) ?? {}
}

/** 0266: the clubs in this competition — a name, a crest, the door to each club's page. */
export async function loadClubs(slug: string): Promise<PublicClub[]> {
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false } }
  )
  const { data } = await anon.rpc('public_competition_clubs', { p_slug: slug })
  return (data as unknown as PublicClub[]) ?? []
}

export async function loadSponsors(slug: string): Promise<PublicSponsor[]> {
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false } }
  )
  const { data } = await anon.rpc('public_sponsors', { p_slug: slug })
  return (data as unknown as PublicSponsor[]) ?? []
}
