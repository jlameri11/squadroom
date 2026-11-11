'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useCurrentOrg } from '@/lib/use-current-org'

type Pending = {
  id: string
  profile_id: string
  name: string
  kind: string
  words: string
  teams: { id: string; name: string }[]
  area: string | null
  note: string | null
  created_at: string
  needs_check: boolean
  has_check: boolean
  committee: boolean
  can_decide: boolean
}

/**
 * Role requests (Joey, 11 Nov 2026; 0256): the members asking to be a
 * coach, a manager, a volunteer, a referee or a committee member. Approve
 * or decline, with a note the person sees. Who may decide which is the
 * database's call (can_decide): the staff, the President and the Secretary;
 * a coordinator inside their own age groups; a committee seat only the
 * owner or the President. A coach, a manager or a referee without a current
 * Working With Children Check waits — the row says so and points at Checks.
 */
export function RoleRequests({ onHome = false }: { onHome?: boolean }) {
  const org = useCurrentOrg()
  const [rows, setRows] = useState<Pending[] | null | undefined>(undefined)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<Record<string, string>>({})

  const load = useCallback(async (orgId: string) => {
    const { data } = await createClient().rpc('role_requests_pending', { p_academy: orgId })
    setRows((data as unknown as Pending[] | null) ?? null)
  }, [])
  useEffect(() => {
    if (!org) return
    void load(org.id)
  }, [org, load])

  if (!org || rows === undefined || rows === null) return null
  // On Club HQ the list is there only while someone is waiting on it.
  if (onHome && rows.length === 0 && Object.keys(done).length === 0) return null

  async function decide(r: Pending, approve: boolean) {
    setBusy(r.id)
    setError(null)
    const { data, error } = await createClient().rpc('decide_role_request', { p_request: r.id, p_approve: approve, p_note: (notes[r.id]?.trim() || null) as unknown as string })
    setBusy(null)
    if (error) return setError(error.message)
    const words = (data as unknown as { words?: string } | null)?.words ?? r.words
    setDone({ ...done, [r.id]: approve ? `${r.name} is now ${words}.` : `${r.name} has been told.` })
    setRows((rs) => (rs ?? []).filter((x) => x.id !== r.id))
  }

  const when = (iso: string) => new Date(iso).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
  const line = { borderColor: 'var(--line)' }
  return (
    <section className={onHome ? 'mt-4' : 'mb-5'} data-role-requests={rows.length} data-on-home={onHome || undefined}>
      <div className="sect">
        <span className="eyebrow">Role requests</span>
        <span className="text-xs text-ink-3">{rows.length === 0 ? 'none waiting' : `${rows.length} waiting`}</span>
      </div>
      {error && <p className="mt-2 rounded-lg px-3 py-2 text-sm" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>{error}</p>}
      {Object.values(done).map((d, i) => (
        <p key={i} className="mt-2 text-sm text-ink-2" data-role-request-done>{d}</p>
      ))}
      {rows.length === 0 && Object.keys(done).length === 0 && (
        <p className="mt-2 rounded-xl bg-[var(--surface-2)] p-4 text-center text-sm text-ink-2">Nobody is asking for a role. Members ask from Settings → Request a role.</p>
      )}
      <div className="mt-2 flex flex-col gap-3">
        {rows.map((r) => {
          const waiting = r.needs_check && !r.has_check
          const cannot = !r.can_decide
          return (
            <article key={r.id} className="rounded-xl border p-4" style={line} data-role-request-row={r.kind} data-role-request-id={r.id}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate font-semibold">{r.name}</span>
                <span className="flex-none text-xs text-ink-3">{when(r.created_at)}</span>
              </div>
              <div className="mt-0.5 text-sm text-ink-2">wants to be {r.words}</div>
              {r.note && <p className="mt-1.5 text-sm">“{r.note}”</p>}
              <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                {waiting && (
                  <Link href="/admin/clearances" className="rounded-full px-2.5 py-1 font-semibold underline-offset-2 hover:underline" style={{ background: 'var(--no-bg)', color: 'var(--no)' }} data-waiting-on-wwcc>
                    waiting on WWCC — record it under Checks
                  </Link>
                )}
                {r.needs_check && r.has_check && <span className="rounded-full px-2.5 py-1 font-semibold" style={{ background: 'var(--yes-bg)', color: 'var(--yes)' }}>check on record</span>}
                {cannot && r.committee && <span className="rounded-full px-2.5 py-1 font-semibold" style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}>only the owner or the President decides this</span>}
                {cannot && !r.committee && <span className="rounded-full px-2.5 py-1 font-semibold" style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}>outside your age groups</span>}
              </div>
              {!cannot && (
                <>
                  <input
                    value={notes[r.id] ?? ''}
                    onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
                    maxLength={500}
                    placeholder="A note for them (optional)"
                    className="mt-3 w-full rounded-lg border px-3 py-2 text-sm"
                    style={line}
                    data-role-request-note
                  />
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => decide(r, true)} disabled={busy !== null || waiting} className="flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-brand-ink disabled:opacity-50" style={{ background: 'var(--brand)' }} data-approve-role-request={r.id}>
                      {busy === r.id ? '…' : 'Approve'}
                    </button>
                    <button onClick={() => decide(r, false)} disabled={busy !== null} className="flex-1 rounded-xl border px-4 py-2.5 text-sm font-semibold disabled:opacity-50" style={line} data-decline-role-request={r.id}>
                      Decline
                    </button>
                  </div>
                </>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}
