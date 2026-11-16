import type { Metadata } from 'next'
import { HeadToHeadCard } from '@/components/head-to-head'
import { gameDay, kickOff } from '@/lib/time'
import { loadGame, loadBrand } from '../../load'
import { clubThemeCss } from '@/lib/brand/colour'

/**
 * One game of a public match centre (0279): the two teams, the time and
 * the ground, the score where the division shows scores, and the head to
 * head — the two teams' meetings this season (0281). Teams and
 * scores only; never a child's name. No cookies, cached a minute, like the
 * match centre it belongs to.
 */
export const revalidate = 60

export async function generateMetadata(ctx: { params: Promise<{ slug: string; fixtureId: string }> }): Promise<Metadata> {
  const { slug, fixtureId } = await ctx.params
  const { game } = await loadGame(slug, fixtureId)
  if (!game) return { title: 'Not found' }
  return { title: `${game.home ?? 'TBC'} v ${game.away ?? 'TBC'} — ${game.competition}`, robots: { index: false, follow: false } }
}

export default async function PublicGamePage(ctx: { params: Promise<{ slug: string; fixtureId: string }> }) {
  const { slug, fixtureId } = await ctx.params
  const [{ game, headToHead }, brand] = await Promise.all([loadGame(slug, fixtureId), loadBrand(slug)])
  if (!game) {
    return (
      <main className="grid min-h-dvh place-items-center px-6" style={{ background: 'var(--paper)' }}>
        <div className="max-w-sm text-center">
          <p className="display text-[1.625rem] leading-tight">Nothing here</p>
          <p className="mt-2 text-sm text-ink-2">This game isn&apos;t on a published page, or the link has changed.</p>
        </div>
      </main>
    )
  }
  const brandCss = brand?.primary ? clubThemeCss(brand.primary, brand.secondary, '[data-club-scope]') : ''
  const played = game.status === 'final' || game.status === 'forfeit'
  return (
    <main className="mx-auto w-full max-w-lg pb-12" data-club-scope data-public-game={game.id}>
      {brandCss && <style>{brandCss}</style>}
      <header className="px-5 pb-5 pt-6" style={{ background: 'var(--bar)', color: 'var(--bar-ink)' }}>
        <a href={`/c/${slug}`} className="text-sm underline underline-offset-4" style={{ opacity: 0.8 }}>‹ {game.competition}</a>
        <p className="eyebrow mt-3" style={{ color: 'inherit', opacity: 0.75 }}>
          {[game.division, game.round, game.season].filter(Boolean).join(' · ')}
        </p>
        <h1 className="display mt-1 text-[1.5rem] leading-tight">
          {game.home ?? 'TBC'} <span style={{ opacity: 0.6 }}>v</span> {game.away ?? 'TBC'}
        </h1>
        {played ? (
          game.scores_hidden ? (
            <p className="mt-2 text-sm" style={{ opacity: 0.8 }}>Played — this division does not publish scores.</p>
          ) : (
            <p className="display mt-2 text-4xl tabular-nums" data-public-score>
              {game.home_score}–{game.away_score}
              {game.pens_home != null && <span className="ml-2 text-base font-normal" style={{ opacity: 0.8 }}>({game.pens_home}–{game.pens_away} on penalties)</span>}
            </p>
          )
        ) : (
          <p className="mt-2 text-sm" style={{ opacity: 0.8 }}>{game.status === 'scheduled' ? 'To play' : game.status}</p>
        )}
        <p className="mt-2 text-sm" style={{ opacity: 0.8 }}>
          {game.starts_at ? `${gameDay(game.starts_at)} · ${kickOff(game.starts_at)}` : 'Time to be set'}
          {game.venue ? ` · ${game.venue}` : ''}{game.field ? ` · ${game.field}` : ''}
        </p>
        {game.address && <p className="mt-0.5 text-xs" style={{ opacity: 0.7 }}>{game.address}</p>}
      </header>
      <div className="px-3.5">
        {headToHead && <HeadToHeadCard data={headToHead} hrefBase={`/c/${slug}/game/`} />}
        <p className="mt-6 text-center text-xs text-ink-3">Run by {game.organiser} · <a href={`/c/${slug}`} className="underline underline-offset-2">{game.competition} on Squadroom</a></p>
      </div>
    </main>
  )
}
