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

export function MemberTree({
  academyId,
  rows,
  emails = {},
  nameChecks = {},
}: {
  academyId: string
  rows: TreeRow[]
  /** Your own members' emails (0214); nobody else's ever reaches this screen. */
  emails?: Record<string, { email: string; verified: boolean }>
  /** 0272: members whose split name wants a look — the parts as they stand. */
  nameChecks?: Record<string, { first: string; last: string }>
}) {
  const [items, setItems] = useState(rows)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [checks, setChecks] = useState(nameChecks)
  const [fixing, setFixing] = useState<string | null>(null)
  const [fixFirst, setFixFirst] = useState('')
  const [fixLast, setFixLast] = useState('')

  /** The club confirms an odd name (0272): first and last, as the person would write them. */
  async function fixName(profileId: string) {
    setBusy(true)
    setError(null)
    const { error } = await createClient().rpc('set_member_name', {
      p_academy: academyId,
      p_profile: profileId,
      p_first: fixFirst.trim(),
      p_middle: undefined,
      p_last: fixLast.trim(),
    })
    setBusy(false)
    if (error) return setError(error.message)
    const full = `${fixFirst.trim()} ${fixLast.trim()}`.trim()
    setItems((prev) => prev.map((r) => (r.profileId === profileId ? { ...r, fullName: full } : r)))
    setChecks((prev) => {
      const next = { ...prev }
      delete next[profileId]
      return next
    })
    setFixing(null)
  }

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
              {!removed && checks[r.profileId] && (
                <button
                  type="button"
                  onClick={() => {
                    setFixing(fixing === r.profileId ? null : r.profileId)
                    setFixFirst(checks[r.profileId].first)
                    setFixLast(checks[r.profileId].last)
                  }}
                  className="tap rounded px-1.5 py-0.5 text-xs font-semibold"
                  style={{ background: 'var(--surface-2)', color: 'var(--accent)' }}
                  data-name-check
                >
                  Check name
                </button>
              )}
            </div>
            {fixing === r.profileId && (
              <div className="mt-2 flex flex-wrap items-end gap-2" data-name-fix>
                <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-ink-2">
                  First name
                  <input value={fixFirst} onChange={(e) => setFixFirst(e.target.value)} className="rounded-lg border px-2.5 py-2 text-sm text-ink" style={{ borderColor: 'var(--line)' }} data-name-fix-first />
                </label>
                <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-ink-2">
                  Last name
                  <input value={fixLast} onChange={(e) => setFixLast(e.target.value)} className="rounded-lg border px-2.5 py-2 text-sm text-ink" style={{ borderColor: 'var(--line)' }} data-name-fix-last />
                </label>
                <button
                  type="button"
                  onClick={() => fixName(r.profileId)}
                  disabled={busy || !fixFirst.trim() || !fixLast.trim()}
                  className="rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50"
                  style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
                  data-name-fix-save
                >
                  Save
                </button>
              </div>
            )}

            <div className="mt-0.5 text-sm text-ink-2">
              {r.inviterName ? `Invited by ${r.inviterName}` : 'Founded this organisation'}
              {kids > 0 && ` · brought ${kids}`}
            </div>
            {emails[r.profileId] && (
              <div className="mt-0.5 break-all text-xs text-ink-3" data-member-email>
                {emails[r.profileId].email}
                {!emails[r.profileId].verified && ' · not confirmed yet'}
              </div>
            )}

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
                    className="tap text-sm underline underline-offset-4"
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
