'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getOrg } from '@/lib/org'

type Row = {
  id: string
  category: 'disclosure' | 'allegation' | 'concern' | 'boundary_breach' | 'other'
  occurred_on: string | null
  subject_name: string | null
  subject: string | null
  involves_child: boolean
  description: string
  status: 'open' | 'referred' | 'closed'
  referred_to: string | null
  outcome: string | null
  created_at: string
  reporter: string | null
  reviewed_by: string | null
  reviewed_at: string | null
}

export const CATEGORY: Record<Row['category'], string> = {
  disclosure: 'A child disclosed something',
  allegation: 'An allegation against an adult',
  concern: 'A concern about behaviour',
  boundary_breach: 'A boundary crossed (messages, lifts, alone time)',
  other: 'Something else',
}
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '')

/**
 * W-03: the reportable-conduct register — what the Child Safe Standards ask
 * a club to keep. Officers (and the owner) see it; nobody else does. A
 * report is never deleted: it is open, referred (to whom is required), or
 * closed with an outcome.
 */
export function ConductRegister() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [refused, setRefused] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<string, { outcome: string; referred: string }>>({})

  const load = useCallback(async () => {
    const { data, error } = await createClient().rpc('conduct_register', { p_academy: (getOrg() ?? null) as unknown as string })
    if (error || data === null) return setRefused(true)
    setRows((data as unknown as Row[]) ?? [])
  }, [])

  useEffect(() => {
    ;(async () => {
      await load()
    })()
  }, [load])

  async function review(r: Row, status: Row['status']) {
    setBusy(r.id)
    setError(null)
    const d = draft[r.id] ?? { outcome: '', referred: '' }
    const { error } = await createClient().rpc('review_conduct_report', { p_report: r.id, p_status: status, p_outcome: d.outcome || undefined, p_referred_to: d.referred || undefined })
    setBusy(null)
    if (error) return setError(error.message)
    await load()
  }

  if (refused || !rows) return null
  const open = rows.filter((r) => r.status !== 'closed')
  const closed = rows.filter((r) => r.status === 'closed')

  return (
    <section className="mt-6 px-4">
      <h2 className="eyebrow pb-1.5">Reportable conduct register</h2>
      <p className="mb-2 text-xs text-ink-3">
        What the Child Safe Standards ask a club to keep. Anyone at the club can file one from Settings → Report a concern; only safeguarding officers see this.
      </p>
      {error && <p className="mb-2 rounded-lg p-2 text-xs" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>{error}</p>}
      {rows.length === 0 && <p className="card p-4 text-center text-sm text-ink-3">Nothing on the register.</p>}
      {open.length > 0 && (
        <ul className="card divide-y overflow-hidden" style={{ borderColor: 'var(--line-2)' }}>
          {open.map((r) => (
            <li key={r.id} className="p-3.5 text-sm">
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 font-medium">{CATEGORY[r.category]}</span>
                <span className="pill flex-none" style={r.status === 'referred' ? { background: 'var(--maybe-bg, var(--surface-2))', color: 'var(--maybe)' } : { background: 'var(--no-bg)', color: 'var(--no)' }}>{r.status}</span>
              </div>
              <p className="mt-0.5 text-xs text-ink-3">
                Filed {day(r.created_at)} by {r.reporter ?? 'a member'}{r.occurred_on ? ` · happened ${day(r.occurred_on)}` : ''}{r.subject ?? r.subject_name ? ` · about ${r.subject ?? r.subject_name}` : ''}{r.involves_child ? ' · involves a child' : ''}
              </p>
              <p className="mt-1.5 whitespace-pre-wrap">{r.description}</p>
              {r.referred_to && <p className="mt-1 text-xs text-ink-2">Referred to {r.referred_to}</p>}
              <div className="mt-2 grid gap-1.5 text-xs">
                <input value={draft[r.id]?.referred ?? ''} onChange={(e) => setDraft({ ...draft, [r.id]: { outcome: draft[r.id]?.outcome ?? '', referred: e.target.value } })} placeholder="Referred to (police, OCG, Football NSW…)" className="w-full rounded-lg border px-2 py-1.5" style={{ borderColor: 'var(--line)' }} />
                <input value={draft[r.id]?.outcome ?? ''} onChange={(e) => setDraft({ ...draft, [r.id]: { referred: draft[r.id]?.referred ?? '', outcome: e.target.value } })} placeholder="Outcome / what was done" className="w-full rounded-lg border px-2 py-1.5" style={{ borderColor: 'var(--line)' }} />
                <div className="flex gap-2">
                  <button onClick={() => review(r, 'referred')} disabled={busy === r.id} className="rounded-lg border px-3 py-1.5 font-semibold disabled:opacity-50" style={{ borderColor: 'var(--line)' }}>Mark referred</button>
                  <button onClick={() => review(r, 'closed')} disabled={busy === r.id} className="rounded-lg px-3 py-1.5 font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }}>Close with outcome</button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {closed.length > 0 && (
        <ul className="card mt-3 divide-y overflow-hidden text-xs text-ink-3" style={{ borderColor: 'var(--line-2)' }}>
          {closed.map((r) => (
            <li key={r.id} className="p-3">
              <span className="text-ink-2">{CATEGORY[r.category]}</span> · filed {day(r.created_at)} · closed {day(r.reviewed_at)} by {r.reviewed_by ?? '—'}
              {r.outcome && <span className="block">{r.outcome}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
