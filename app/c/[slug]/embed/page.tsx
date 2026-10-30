import { MatchCentre } from '../match-centre'
import { load } from '../load'
import { siteUrl } from '@/lib/site'

/**
 * L-12: the widget — the public page with no header, for a league's own
 * website. `?view=ladder|fixtures|scorers&division=U8` picks what opens.
 * Same function, same boundary, same cache; no cookies, no session, and the
 * only path next.config.ts allows to be framed.
 */
export const revalidate = 60

export default async function EmbedPage(ctx: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ view?: string; division?: string }>
}) {
  const { slug } = await ctx.params
  const { view, division } = await ctx.searchParams
  const centre = await load(slug)
  if (!centre) {
    return (
      <main className="grid min-h-40 place-items-center px-6 text-center text-sm text-ink-2" style={{ background: 'var(--paper)' }}>
        This competition page isn&apos;t published.
      </main>
    )
  }
  return (
    <MatchCentre
      centre={centre}
      embed
      initialTab={view}
      initialDivision={division}
      shareUrl={`${siteUrl()}/c/${slug}`}
    />
  )
}
