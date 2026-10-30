'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * R-18: does this program need the child registered in PlayFootball first?
 *
 * Per program, because Circular 26-02 binds affiliated clubs and
 * competitions and says nothing about a holiday camp. On, the queue will
 * not accept a child until somebody at the club has confirmed the
 * PlayFootball registration (or the export import has).
 */
export function OfficialRegoToggle({
  programId,
  value,
  onSaved,
}: {
  programId: string
  value: boolean
  onSaved: (value: boolean) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function set(next: boolean) {
    setBusy(true)
    setError(null)
    const { error } = await createClient().from('programs').update({ requires_official_rego: next }).eq('id', programId)
    setBusy(false)
    if (error) return setError(error.message)
    onSaved(next)
  }

  return (
    <section className="card mb-5 p-3.5">
      <label className="flex items-start gap-3">
        <input type="checkbox" checked={value} disabled={busy} onChange={(e) => void set(e.target.checked)} className="mt-1 flex-none" />
        <span className="min-w-0 text-sm">
          <span className="block font-medium">Requires PlayFootball registration</span>
          <span className="block text-ink-3">
            Football Australia&apos;s Circular 26-02: for an affiliated club or competition, the child is
            registered in PlayFootball first. With this on, Accept waits until the club has confirmed it
            — by hand on the request, or by importing your PlayFootball export.
          </span>
        </span>
      </label>
      {error && <p className="mt-2 text-sm" style={{ color: 'var(--no)' }}>{error}</p>}
    </section>
  )
}
