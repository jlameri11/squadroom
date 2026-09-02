'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export type TreeRow = {
  profileId: string
  fullName: string
  role: string
  status: string
  inviterName: string | null
  depth: number
}

export function MemberTree({ academyId, rows }: { academyId: string; rows: TreeRow[] }) {
  const [items, setItems] = useState(rows)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /** How many people go with them, so the confirmation is honest about it. */
  function descendantCount(index: number) {
    const depth = items[index].depth
    let n = 0
    for (let i = index + 1; i < items.length && items[i].depth > depth; i++) n++
    return n
  }

  async function revoke(profileId: string) {
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { data, error } = await supabase.rpc('revoke_member_tree', {
      p_academy: academyId,
      p_profile: profileId,
    })
    setBusy(false)
    setConfirming(null)

    if (error) return setError(error.message)
    setItems((prev) =>
      prev.map((r) =>
        r.profileId === profileId || wasBelow(prev, profileId, r) ? { ...r, status: 'removed' } : r
      )
    )
    setError(`Removed ${data} ${data === 1 ? 'person' : 'people'}.`)
  }

  if (items.length === 0) {
    return (
      <p className="rounded-xl bg-[var(--surface-2)] p-5 text-center text-sm text-ink-2">
        Only owners and admins can see who invited whom.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {error && <p className="text-sm text-ink-2">{error}</p>}

      {items.map((r, i) => {
        const kids = descendantCount(i)
        const removed = r.status === 'removed'
        return (
          <div
            key={r.profileId}
            style={{ marginLeft: `${Math.min(r.depth, 4) * 16}px` }}
            className={`rounded-xl border p-3 ${
              removed ? 'border-[var(--line)] opacity-50' : 'border-[var(--line)]'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="font-medium">{r.fullName}</span>
              <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-xs capitalize text-ink-2">
                {r.role}
              </span>
              {removed && <span className="text-xs text-ink-2">removed</span>}
            </div>

            <div className="mt-0.5 text-sm text-ink-2">
              {r.inviterName ? `Invited by ${r.inviterName}` : 'Founded this organisation'}
              {kids > 0 && ` · brought ${kids}`}
            </div>

            {!removed && r.depth > 0 && (
              <div className="mt-2">
                {confirming === r.profileId ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => revoke(r.profileId)}
                      disabled={busy}
                      className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {kids > 0 ? `Remove all ${kids + 1}` : 'Remove'}
                    </button>
                    <button
                      onClick={() => setConfirming(null)}
                      className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirming(r.profileId)}
                    className="text-sm  underline underline-offset-4"
                  >
                    {/* Say the consequence up front. Removing a coach quietly
                        taking fourteen families with them is not acceptable. */}
                    {kids > 0 ? `Remove — takes ${kids} with them` : 'Remove'}
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Rows are returned in tree order, so anyone below until depth drops is theirs. */
function wasBelow(rows: TreeRow[], profileId: string, candidate: TreeRow) {
  const start = rows.findIndex((r) => r.profileId === profileId)
  if (start === -1) return false
  const depth = rows[start].depth
  for (let i = start + 1; i < rows.length && rows[i].depth > depth; i++) {
    if (rows[i].profileId === candidate.profileId) return true
  }
  return false
}
