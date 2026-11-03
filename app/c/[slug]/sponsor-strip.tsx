'use client'

import { useEffect } from 'react'

export type PublicSponsor = { id: string; name: string; url: string | null; logo_url: string | null; tagline: string | null }

/**
 * X-08: the organiser's sponsors under the public match centre's header. A
 * name, a logo, a link — nothing about anyone. Tells the server once per
 * load so the club can show the sponsor a number.
 */
export function SponsorStrip({ sponsors, slug }: { sponsors: PublicSponsor[]; slug: string }) {
  useEffect(() => {
    if (sponsors.length === 0) return
    void fetch('/api/sponsor-seen', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug }), keepalive: true }).catch(() => {})
  }, [sponsors.length, slug])

  if (sponsors.length === 0) return null
  return (
    <div className="flex items-center gap-3 overflow-x-auto border-b px-5 py-2" style={{ borderColor: 'var(--line-2)', background: 'var(--surface)' }} data-sponsor-strip>
      <span className="flex-none text-[10px] uppercase tracking-wide text-ink-3">With thanks to</span>
      {sponsors.map((s) => {
        const inner = (
          <>
            {s.logo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.logo_url} alt="" className="h-6 w-auto max-w-[80px] object-contain" />
            )}
            <span className="text-xs font-semibold">{s.name}</span>
          </>
        )
        return s.url ? (
          <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer sponsored" className="flex flex-none items-center gap-1.5" data-sponsor={s.id}>{inner}</a>
        ) : (
          <span key={s.id} className="flex flex-none items-center gap-1.5" data-sponsor={s.id}>{inner}</span>
        )
      })}
    </div>
  )
}
