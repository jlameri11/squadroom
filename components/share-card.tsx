'use client'

import { useState } from 'react'

const SIZES = [
  ['story', 'Story', '9:16 — Instagram and WhatsApp'],
  ['portrait', 'Post', '4:5 — the most feed height'],
  ['square', 'Square', '1:1'],
] as const

/**
 * Getting a card onto a phone, and from there into a group.
 *
 * X-04. The image is rendered by the server; this is only the part that gets
 * it off the device's screen and into the place a club actually posts.
 *
 * SHARE SHEET FIRST, download second. On a phone the useful action is "send
 * this to the U8 parents' WhatsApp" and the share sheet does that in one tap;
 * a download leaves the picture in Files for somebody to go and find. On a
 * desktop there is no share sheet, so it downloads, which is also what
 * somebody at a laptop wants.
 *
 * `navigator.share` with a file is not supported everywhere even where
 * `navigator.share` exists, so the capability is tested with `canShare`
 * rather than assumed — and a dismissed sheet throws AbortError, which is a
 * person changing their mind and not a failure to report.
 */
export function ShareCard({
  endpoint,
  label = 'Share a card',
  filename,
}: {
  /** The route that renders the PNG, without a size parameter. */
  endpoint: string
  label?: string
  filename: string
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function go(size: string) {
    setBusy(size)
    setError(null)
    try {
      const joiner = endpoint.includes('?') ? '&' : '?'
      const res = await fetch(`${endpoint}${joiner}size=${size}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setBusy(null)
        return setError(body.error ?? 'Could not make that card.')
      }

      const blob = await res.blob()
      const file = new File([blob], `${filename}-${size}.png`, { type: 'image/png' })

      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file] })
          setBusy(null)
          setOpen(false)
          return
        } catch (e) {
          // Dismissing the sheet is a decision, not an error.
          if ((e as Error)?.name === 'AbortError') {
            setBusy(null)
            return
          }
        }
      }

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = file.name
      a.click()
      URL.revokeObjectURL(url)
      setBusy(null)
      setOpen(false)
    } catch {
      setBusy(null)
      setError('Could not make that card.')
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-2 w-full rounded-xl border px-4 py-2.5 text-sm font-semibold"
        style={{ borderColor: 'var(--line)', color: 'var(--brand)' }}
      >
        {label}
      </button>
    )
  }

  return (
    <div className="mt-2 rounded-xl border p-3" style={{ borderColor: 'var(--line)' }}>
      <div className="flex items-baseline justify-between">
        <span className="eyebrow">Which shape?</span>
        <button onClick={() => setOpen(false)} className="text-xs text-ink-3">
          Cancel
        </button>
      </div>

      <div className="mt-2 flex flex-col gap-1.5">
        {SIZES.map(([value, name, hint]) => (
          <button
            key={value}
            onClick={() => void go(value)}
            disabled={busy !== null}
            className="flex items-center justify-between rounded-lg border px-3 py-2.5 text-left disabled:opacity-50"
            style={{ borderColor: 'var(--line)' }}
          >
            <span>
              <span className="block text-sm font-semibold">{name}</span>
              <span className="block text-xs text-ink-3">{hint}</span>
            </span>
            <span className="flex-none text-xs" style={{ color: 'var(--brand)' }}>
              {busy === value ? 'Making…' : '→'}
            </span>
          </button>
        ))}
      </div>

      {error && (
        <p className="mt-2 text-sm" style={{ color: 'var(--no)' }}>
          {error}
        </p>
      )}

      <p className="mt-2 text-xs text-ink-3">
        In your club&apos;s colours. No child is named on it.
      </p>
    </div>
  )
}
