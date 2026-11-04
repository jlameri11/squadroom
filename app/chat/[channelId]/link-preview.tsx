'use client'

import { useEffect, useState } from 'react'

type Preview = { url: string; ok: boolean; title: string | null; description: string | null; image_url: string | null; site_name: string | null }

/**
 * The first link in a message, as a small card: picture, title, site. The
 * server fetched it once (api/link-preview); this only asks the server.
 */
export function LinkPreview({ url, mine }: { url: string; mine: boolean }) {
  const [p, setP] = useState<Preview | null | undefined>(undefined)

  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const res = await fetch(`/api/link-preview?url=${encodeURIComponent(url)}`)
        const data = res.ok ? ((await res.json()) as Preview) : null
        if (live) setP(data && data.ok ? data : null)
      } catch {
        if (live) setP(null)
      }
    })()
    return () => {
      live = false
    }
  }, [url])

  if (!p) return null
  let host = ''
  try {
    host = new URL(p.url).hostname.replace(/^www\./, '')
  } catch {
    host = ''
  }
  return (
    <a
      href={p.url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1.5 block overflow-hidden rounded-lg border text-left"
      style={{ borderColor: mine ? '#ffffff33' : 'var(--line)', background: mine ? '#ffffff14' : 'var(--surface-2)' }}
      data-link-preview
    >
      {p.image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.image_url} alt="" loading="lazy" className="max-h-40 w-full object-cover" />
      )}
      <span className="block p-2">
        <span className="block truncate text-[0.625rem] uppercase tracking-wide opacity-70">{p.site_name ?? host}</span>
        <span className="line-clamp-2 block text-sm font-semibold leading-snug">{p.title}</span>
        {p.description && <span className="line-clamp-2 block text-xs leading-snug opacity-80">{p.description}</span>}
      </span>
    </a>
  )
}
