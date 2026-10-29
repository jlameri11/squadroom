import { createClient } from '@supabase/supabase-js'
import type { Metadata } from 'next'
import { AcademyPage, type Academy } from './academy-page'

/**
 * A club's front door: `/{slug}`.
 *
 * The one page in the product a club can put on a flyer. Crest, colour, the
 * programs open for registration with a price and the places left, a Register
 * button, and the draw. Nothing about a person.
 *
 * Built like `/c/[slug]` and for the same reason: NO COOKIES. The client is
 * made here, not from lib/supabase/server, so the response is not
 * per-request and can be cached — registration opens on a Monday night and
 * a club's whole mailing list taps the link at once. Nothing is stored about
 * whoever is reading.
 *
 * A slug that does not exist renders "not found" with a 200, as the register
 * page does. A 404 would make the URL an oracle for which clubs are on
 * Squadroom.
 */
export const revalidate = 60

async function load(slug: string): Promise<Academy | null> {
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false } }
  )
  const { data } = await anon.rpc('public_academy', { p_slug: slug })
  return (data as unknown as Academy) ?? null
}

export async function generateMetadata(ctx: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await ctx.params
  const academy = await load(slug)
  if (!academy) return { title: 'Not found', robots: { index: false, follow: false } }
  const open = academy.programs.length
  return {
    title: academy.academy.name,
    description:
      open > 0
        ? `${open === 1 ? 'One program' : `${open} programs`} open for registration at ${academy.academy.name}.`
        : `${academy.academy.name} on Squadroom.`,
    openGraph: {
      title: academy.academy.name,
      description: open > 0 ? 'Open for registration' : undefined,
    },
    // Indexed, unlike the register page one step in: this page collects
    // nothing, and being findable is what a front door is for. Not followed —
    // nothing past it is meant to be crawled.
    robots: { index: true, follow: false },
  }
}

export default async function Page(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params
  const academy = await load(slug)
  return <AcademyPage slug={slug} academy={academy} />
}
