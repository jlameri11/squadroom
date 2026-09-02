'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * Subscribe once, and the season keeps itself up to date.
 *
 * The important difference from a downloaded .ics: a subscription re-fetches,
 * so a game moved on Thursday moves in the parent's phone too. A downloaded
 * file is a photograph of a fixture list taken on the day you pressed it.
 */
export function CalendarFeed() {
  const [url, setUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [confirmRotate, setConfirmRotate] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    supabase.rpc('my_calendar_token').then(({ data }) => {
      if (data) setUrl(`${window.location.origin}/api/calendar/${data}`)
    })
  }, [])

  async function rotate() {
    setBusy(true)
    const supabase = createClient()
    const { data } = await supabase.rpc('my_calendar_token', { p_rotate: true })
    setBusy(false)
    setConfirmRotate(false)
    if (data) setUrl(`${window.location.origin}/api/calendar/${data}`)
  }

  if (!url) return null

  return (
    <section className="mt-8 rounded-xl border border-[var(--line)] p-4">
      <h2 className="font-semibold">Your fixtures in your phone&apos;s calendar</h2>
      <p className="mt-1 text-sm text-ink-2">
        Subscribe once and every game your children play appears automatically — including when a
        time or ground changes.
      </p>

      <p className="mt-3 break-all rounded-lg bg-[var(--surface-2)] p-2 font-mono text-xs">{url}</p>

      <div className="mt-3 flex gap-2">
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(url)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          }}
          className="flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-white"
          style={{ background: 'var(--brand)' }}
        >
          {copied ? 'Copied' : 'Copy link'}
        </button>
        <a
          href={url.replace(/^https?:/, 'webcal:')}
          className="rounded-xl border border-[var(--line)] px-4 py-2.5 text-sm font-medium"
        >
          Subscribe
        </a>
      </div>

      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-ink-2">How to add it</summary>
        <p className="mt-2 text-xs text-ink-2">
          <b>iPhone:</b> Settings → Apps → Calendar → Accounts → Add Account → Other → Add
          Subscribed Calendar, and paste the link.<br />
          <b>Google Calendar:</b> Other calendars → + → From URL.
        </p>
      </details>

      <div className="mt-3 border-t border-[var(--line-2)] pt-3">
        {/* Anyone holding the link can read this person's fixtures without
            signing in. That is what makes it work in a calendar app, and it
            is worth saying rather than burying. */}
        <p className="text-xs text-ink-2">
          Anyone with this link can see your children&apos;s fixtures without signing in. It shows
          your games only — never another family&apos;s.
        </p>
        {confirmRotate ? (
          <div className="mt-2 flex gap-2">
            <button onClick={rotate} disabled={busy}
                    className="flex-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
              {busy ? 'Working…' : 'Yes, break the old link'}
            </button>
            <button onClick={() => setConfirmRotate(false)}
                    className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs">
              Cancel
            </button>
          </div>
        ) : (
          <button onClick={() => setConfirmRotate(true)}
                  className="mt-1 text-xs  underline underline-offset-4">
            Shared it by mistake? Get a new link
          </button>
        )}
      </div>
    </section>
  )
}
