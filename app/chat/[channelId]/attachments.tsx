'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { kindOf, type Attachment } from '@/lib/adapters/images'
import { formatDuration } from '@/lib/adapters/recorder'

/**
 * The bucket is private, so every image needs a signed URL. They are minted
 * on render and expire in an hour: a URL that leaks out of a screenshot or a
 * copied link stops working, rather than being a permanent public link to a
 * photograph of somebody's child.
 *
 * C-05: a voice note and a video are the same thing with a different player.
 * Same bucket, same signed URL, same hour.
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

  const images = list.filter((a) => kindOf(a.mime) === 'image')

  return (
    <div className={`mt-1 grid gap-1 ${images.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
      {list.map((a) => {
        const url = urls[a.path]
        const ratio = a.width && a.height ? a.width / a.height : 4 / 3
        const kind = kindOf(a.mime)

        if (kind === 'audio') {
          return (
            <div
              key={a.path}
              className="col-span-full flex items-center gap-2 rounded-lg border p-2"
              style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}
            >
              <span className="text-lg" aria-hidden>🎙</span>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold">
                  Voice note{a.duration ? ` · ${formatDuration(a.duration)}` : ''}
                </div>
                {url ? (
                  <audio controls preload="metadata" src={url} className="mt-1 h-9 w-full" />
                ) : (
                  <div className="mt-1 h-9 w-full animate-pulse rounded bg-[var(--surface-2)]" />
                )}
              </div>
            </div>
          )
        }

        if (kind === 'video') {
          return (
            <div key={a.path} className="col-span-full">
              {url ? (
                // Capped like a single photo, so one clip does not take the
                // whole screen. playsInline keeps iPhone from going
                // full-screen the moment it is tapped.
                <video
                  controls
                  playsInline
                  preload="metadata"
                  src={url}
                  className="w-full rounded-lg bg-black"
                  style={{ maxHeight: '60vh', aspectRatio: a.width && a.height ? String(ratio) : '16 / 9' }}
                />
              ) : (
                <div className="w-full animate-pulse rounded-lg bg-[var(--surface-2)]" style={{ aspectRatio: '16 / 9', maxHeight: '60vh' }} />
              )}
              {a.duration ? <div className="mt-0.5 text-xs text-ink-3">Video · {formatDuration(a.duration)}</div> : null}
            </div>
          )
        }

        if (kind === 'file') {
          return (
            <a
              key={a.path}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="col-span-full flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-2 text-sm"
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
                  aspectRatio: images.length > 1 ? '1 / 1' : String(ratio),
                  // A single portrait photo filled the entire phone screen —
                  // one picture, and the conversation either side of it was
                  // gone. The aspect ratio is kept, so nothing is distorted;
                  // it simply stops growing. Tapping still opens the full
                  // image.
                  maxHeight: images.length > 1 ? undefined : '60vh',
                  objectPosition: 'center',
                }}
              />
            ) : (
              <div
                className="w-full animate-pulse rounded-lg bg-[var(--surface-2)]"
                // The placeholder is capped the same way, or the message
                // jumps by half a screen when the picture arrives.
                style={{
                  aspectRatio: images.length > 1 ? '1 / 1' : String(ratio),
                  maxHeight: images.length > 1 ? undefined : '60vh',
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
