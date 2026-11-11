'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getOrg } from '@/lib/org'
import { DEFAULT_TZ } from '@/lib/time'

type Incident = {
  id: string
  status: 'open' | 'reviewed'
  occurred_at: string
  created_at: string
  what: string
  who: string | null
  first_aid: string | null
  ambulance: boolean
  parent_told: boolean
  event: { id: string; title: string; starts_at: string; venue: string | null } | null
  team: string | null
  reported_by: string | null
  outcome: string | null
  reviewed_by: string | null
  reviewed_at: string | null
}

/**
 * Incidents and injuries reported from the ground (Big Club Mode item 11;
 * 0253), for the Welfare officer and the President. Each one: who, what,
 * when, the first aid given, whether an ambulance came and the parent was
 * told, and who reported it. Reviewing it says what was done.
 */
export function Incidents() {
  const [rows, setRows] = useState<Incident[] | null | undefined>(undefined)
  const [outcomes, setOutcomes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data } = await createClient().rpc('incident_register', { p_academy: (getOrg() ?? null) as unknown as string })
    setRows((data as unknown as Incident[] | null) ?? null)
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  if (rows === undefined || rows === null) return null

  async function review(r: Incident) {
    const outcome = (outcomes[r.id] ?? '').trim()
    if (!outcome) return setError('Say what was done — a closed report with no note is not a record.')
    setBusy(r.id)
    setError(null)
    const { error } = await createClient().rpc('review_incident', { p_report: r.id, p_outcome: outcome })
    setBusy(null)
    if (error) return setError(error.message)
    await load()
  }

  const when = (iso: string) => new Date(iso).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: DEFAULT_TZ })
  const open = rows.filter((r) => r.status === 'open')

  return (
    <section className="mt-5" data-incidents={rows.length}>
      <div className="sect">
        <span className="eyebrow">Incidents and injuries</span>
        <span className="text-xs text-ink-3">{open.length ? `${open.length} open` : rows.length ? 'all reviewed' : 'none reported'}</span>
      </div>
      {rows.length === 0 ? (
        <p className="card p-3 text-sm text-ink-3">Nothing reported. A coach, manager or field marshal reports one from the game&apos;s page.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.id} className="card p-3.5" data-incident={r.id} data-incident-status={r.status}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate font-semibold">{r.who ?? 'Someone'}</span>
                <span className="flex-none text-xs text-ink-3">{when(r.occurred_at)}</span>
              </div>
              <p className="mt-1 text-sm">{r.what}</p>
              <p className="mt-1 text-xs text-ink-2">
                {r.first_aid ? `First aid: ${r.first_aid}. ` : 'No first aid recorded. '}
                {r.ambulance ? 'Ambulance called. ' : ''}
                {r.parent_told ? 'Parent told. ' : 'Parent not yet told. '}
                {r.event ? `At ${r.event.title}${r.event.venue ? `, ${r.event.venue}` : ''}. ` : ''}
                {r.team ? `${r.team}. ` : ''}
                Reported by {r.reported_by ?? 'someone'}.
              </p>
              {r.status === 'reviewed' ? (
                <p className="mt-2 text-xs" style={{ color: 'var(--yes)' }}>Reviewed by {r.reviewed_by}: {r.outcome}</p>
              ) : (
                <div className="mt-2 flex gap-2">
                  <input value={outcomes[r.id] ?? ''} onChange={(e) => setOutcomes({ ...outcomes, [r.id]: e.target.value })} placeholder="What was done" className="min-w-0 flex-1 rounded-lg border px-2.5 py-1.5 text-sm" style={{ borderColor: 'var(--line)' }} aria-label="What was done" data-incident-outcome />
                  <button onClick={() => review(r)} disabled={busy !== null} className="min-w-fit rounded-lg px-3 py-1.5 text-sm font-semibold text-brand-ink disabled:opacity-50" style={{ background: 'var(--brand)' }} data-incident-review>
                    {busy === r.id ? '…' : 'Reviewed'}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 text-sm" style={{ color: 'var(--no)' }}>{error}</p>}
    </section>
  )
}
