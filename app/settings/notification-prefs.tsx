'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const OPTIONS: [number, string][] = [
  [0, 'Every message, as it comes'],
  [10, 'Grouped every 10 minutes'],
  [30, 'Grouped every 30 minutes'],
  [60, 'Grouped once an hour'],
]

/** C-07: one push per channel per window instead of one per message. The urgent ones are never grouped. */
export function NotificationPrefs({ initialDigest }: { initialDigest: number }) {
  const [minutes, setMinutes] = useState(initialDigest)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function set(next: number) {
    setMinutes(next)
    setBusy(true)
    setError(null)
    const { error } = await createClient().rpc('set_digest_minutes', { p_minutes: next })
    setBusy(false)
    if (error) return setError(error.message)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <section className="mt-6">
      <h2 className="font-semibold">Message pushes</h2>
      <p className="mt-0.5 text-sm text-ink-2">
        A busy chat can be one push per channel instead of one per message — &ldquo;5 new messages in U8 SPL&rdquo;. Announcements, mentions, a game called off, reminders and direct messages always come straight away.
      </p>
      <select value={minutes} disabled={busy} onChange={(e) => void set(Number(e.target.value))} className="mt-2 w-full rounded-xl border px-3 py-2.5 text-base" style={{ borderColor: 'var(--line)' }}>
        {OPTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
      </select>
      {saved && <p className="mt-1 text-xs" style={{ color: 'var(--yes)' }}>Saved</p>}
      {error && <p className="mt-1 text-xs" style={{ color: 'var(--no)' }}>{error}</p>}
    </section>
  )
}
