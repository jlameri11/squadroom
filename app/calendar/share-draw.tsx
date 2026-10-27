'use client'

import { useState } from 'react'

/**
 * The public draw, for the people who do not have the app.
 *
 * Grandparents, a visiting club, the player's other parent who never
 * installed anything. The page at /c/{slug} already exists and publishes
 * teams and scores and no children, so the only thing missing was a way for
 * a coach to find the link without being told what it is.
 *
 * Share sheet where the browser has one, clipboard where it does not, and
 * the link itself in plain text underneath either way — because a copy
 * button that silently fails is how somebody ends up reading a URL off
 * a coach's screen over the phone.
 */
export function ShareDraw({ slug }: { slug: string }) {
  const [said, setSaid] = useState<string | null>(null)
  const url = typeof window === 'undefined' ? '' : `${window.location.origin}/c/${slug}`

  async function share() {
    // navigator.share needs a user gesture and a secure context, and throws
    // AbortError when somebody dismisses the sheet — which is not a failure
    // and must not be reported as one.
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Fixtures', url })
        return
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      setSaid('Link copied')
    } catch {
      setSaid('Copy it from below')
    }
  }

  return (
    <div className="border-b px-4 py-2.5" style={{ borderColor: 'var(--line-2)' }}>
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 text-sm text-ink-2">
          Public draw — no app, no login
        </span>
        <button
          onClick={share}
          className="flex-none rounded-lg border px-3 py-1.5 text-xs font-semibold"
          style={{ borderColor: 'var(--brand)', color: 'var(--brand)' }}
        >
          {said ?? 'Share'}
        </button>
      </div>
      <a
        href={`/c/${slug}`}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-0.5 block truncate text-xs underline underline-offset-2 text-ink-3"
      >
        /c/{slug}
      </a>
    </div>
  )
}
