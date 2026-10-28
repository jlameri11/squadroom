'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Attachment } from '@/lib/adapters/images'

/**
 * The bucket is private, so every image needs a signed URL. They are minted
 * on render and expire in an hour: a URL that leaks out of a screenshot or a
 * copied link stops working, rather than being a permanent public link to a
 * photograph of somebody's child.
 */
export function MessageAttachments({ attachments }: { attachments: unknown }) {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const list = normalise(attachments)

  useEffect(() => {
    if (list.length === 0) return
    let cancelled = false
    const supabase = createClient()

    supabase.storage
      .from('attachments')
      .createSignedUrls(list.map((a) => a.path), 3600)
      .then(({ data }) => {
        if (cancelled || !data) return
        const map: Record<string, string> = {}
        for (const row of data) {
          if (row.path && row.signedUrl) map[row.path] = row.signedUrl
        }
        setUrls(map)
      })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(list.map((a) => a.path))])

  if (list.length === 0) return null

  return (
    <div className={`mt-1 grid gap-1 ${list.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
      {list.map((a) => {
        const url = urls[a.path]
        const ratio = a.width && a.height ? a.width / a.height : 4 / 3

        if (a.mime === 'application/pdf') {
          return (
            <a
              key={a.path}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-2 text-sm"
            >
              <span className="text-lg">📄</span>
              <span className="min-w-0 flex-1 truncate">{a.name}</span>
            </a>
          )
        }

        return (
          <a key={a.path} href={url} target="_blank" rel="noopener noreferrer" className="block">
            {url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={url}
                alt={a.name}
                loading="lazy"
                className="w-full rounded-lg object-cover"
                style={{
                  aspectRatio: list.length > 1 ? '1 / 1' : String(ratio),
                  // A single portrait photo filled the entire phone screen —
                  // one picture, and the conversation either side of it was
                  // gone. The aspect ratio is kept, so nothing is distorted;
                  // it simply stops growing. Tapping still opens the full
                  // image.
                  maxHeight: list.length > 1 ? undefined : '60vh',
                  objectPosition: 'center',
                }}
              />
            ) : (
              <div
                className="w-full animate-pulse rounded-lg bg-[var(--surface-2)]"
                // The placeholder is capped the same way, or the message
                // jumps by half a screen when the picture arrives.
                style={{
                  aspectRatio: list.length > 1 ? '1 / 1' : String(ratio),
                  maxHeight: list.length > 1 ? undefined : '60vh',
                }}
              />
            )}
          </a>
        )
      })}
    </div>
  )
}

/** attachments is jsonb, so treat anything unexpected as nothing. */
function normalise(value: unknown): Attachment[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (a): a is Attachment =>
      typeof a === 'object' && a !== null && typeof (a as Attachment).path === 'string'
  )
}
