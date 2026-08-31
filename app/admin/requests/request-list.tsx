'use client'

import { useState } from 'react'

export type PendingRequest = {
  id: string
  fullName: string
  phone: string | null
  children: string[]
  team: string | null
  academy: string | null
}

export function RequestList({ initial }: { initial: PendingRequest[] }) {
  const [rows, setRows] = useState(initial)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function decide(id: string, decision: 'approve' | 'decline') {
    setBusyId(id)
    setError(null)

    const res = await fetch('/api/join/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: id, decision }),
    })

    setBusyId(null)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      return setError(body.error ?? 'That did not work.')
    }
    setRows((r) => r.filter((x) => x.id !== id))
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-xl bg-neutral-100 p-5 text-center text-sm text-neutral-500">
        Nobody waiting. New requests land here the moment someone taps your team link.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-sm text-red-600">{error}</p>}

      {rows.map((r) => (
        <article key={r.id} className="rounded-xl border border-neutral-200 p-4">
          <div className="font-semibold">{r.fullName}</div>
          <div className="mt-0.5 text-sm text-neutral-500">
            {[r.team ?? r.academy, r.phone].filter(Boolean).join(' · ')}
          </div>
          {r.children.length > 0 && (
            <div className="mt-1 text-sm text-neutral-500">
              Children: {r.children.join(', ')}
            </div>
          )}

          {/* Nothing about this person is verified. The coach knowing them is
              the check, so the screen shows exactly what they typed and no
              more — no green ticks implying we checked something. */}
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => decide(r.id, 'approve')}
              disabled={busyId === r.id}
              className="flex-1 rounded-lg px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: '#202842' }}
            >
              {busyId === r.id ? 'Working…' : 'Approve'}
            </button>
            <button
              onClick={() => decide(r.id, 'decline')}
              disabled={busyId === r.id}
              className="rounded-lg border border-neutral-300 px-3 py-2.5 text-sm font-medium disabled:opacity-50"
            >
              Decline
            </button>
          </div>
        </article>
      ))}
    </div>
  )
}
