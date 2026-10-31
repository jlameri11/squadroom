'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const SYDNEY = 'Australia/Sydney'
type Req = {
  id: string
  fixture_id: string
  status: 'proposed' | 'agreed' | 'declined' | 'approved' | 'rejected' | 'withdrawn'
  reason: string
  home: string | null
  away: string | null
  division: string
  round: string | null
  starts_at: string | null
  venue: string | null
  field: string | null
  proposed_starts_at: string | null
  proposed_venue: string | null
  proposed_field: string | null
  by: string | null
  other: string | null
  mine: boolean
  theirs: boolean
  league: boolean
  answer_note: string | null
  decision_note: string | null
  created_at: string
  notes: { body: string; author: string | null; at: string }[]
}
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: SYDNEY }) : 'same time')
const STATUS: Record<Req['status'], string> = { proposed: 'Waiting for the other team', agreed: 'Both agree — league to decide', declined: 'Declined by the other team', approved: 'Moved', rejected: 'Kept as drawn', withdrawn: 'Withdrawn' }

/**
 * W-07: change requests on a fixture. The same list for everyone who may
 * see it; the buttons follow who you are — the other team answers, the
 * league decides, the proposer withdraws, all three can add a note.
 */
export function ChangeRequests({ competitionId }: { competitionId: string }) {
  const [rows, setRows] = useState<Req[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    const { data, error } = await createClient().rpc('fixture_change_requests', { p_competition: competitionId })
    if (error) return setError(error.message)
    setRows((data as unknown as Req[]) ?? [])
  }, [competitionId])

  useEffect(() => {
    ;(async () => {
      await load()
    })()
  }, [load])

  async function call(fn: 'answer_fixture_change' | 'decide_fixture_change' | 'withdraw_fixture_change' | 'add_fixture_change_note', args: Record<string, unknown>, id: string) {
    setBusy(id)
    setError(null)
    const { error } = await createClient().rpc(fn, args as never)
    setBusy(null)
    if (error) return setError(error.message)
    setNote({ ...note, [id]: '' })
    await load()
  }

  if (!rows || rows.length === 0) return null
  return (
    <div className="m-3.5 rounded-xl border p-3.5" style={{ borderColor: 'var(--line)' }}>
      <h3 className="text-sm font-semibold">Game changes</h3>
      <p className="mt-0.5 text-xs text-ink-2">A club proposes, the other agrees, the league decides. Talk about it here, not in the team chat.</p>
      {error && <p className="mt-2 rounded-lg p-2 text-xs" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>{error}</p>}
      <ul className="mt-2 divide-y text-sm" style={{ borderColor: 'var(--line-2)' }}>
        {rows.map((r) => (
          <li key={r.id} className="py-2.5">
            <div className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 font-medium">{r.home ?? 'TBC'} v {r.away ?? 'TBC'} <span className="font-normal text-ink-3">· {r.division}</span></span>
              <span className="pill flex-none" style={r.status === 'approved' ? { background: 'var(--yes-bg)', color: 'var(--yes)' } : r.status === 'declined' || r.status === 'rejected' ? { background: 'var(--no-bg)', color: 'var(--no)' } : { background: 'var(--surface-2)', color: 'var(--ink-2)' }}>{STATUS[r.status]}</span>
            </div>
            <p className="mt-0.5 text-xs text-ink-3">
              {r.by} asked: {when(r.starts_at)}{r.venue ? ` at ${r.venue}` : ''} → <b>{when(r.proposed_starts_at)}</b>{r.proposed_venue ? ` at ${r.proposed_venue}` : ''}{r.proposed_field ? ` ${r.proposed_field}` : ''}
            </p>
            <p className="mt-0.5 text-xs">“{r.reason}”</p>
            {r.answer_note && <p className="mt-0.5 text-xs text-ink-2">{r.other}: {r.answer_note}</p>}
            {r.decision_note && <p className="mt-0.5 text-xs text-ink-2">League: {r.decision_note}</p>}
            {r.notes.length > 0 && (
              <ul className="mt-1.5 space-y-0.5 rounded-lg p-2 text-xs" style={{ background: 'var(--surface-2)' }}>
                {r.notes.map((n, i) => (
                  <li key={i}><b>{n.author ?? '—'}:</b> {n.body}</li>
                ))}
              </ul>
            )}
            {(r.status === 'proposed' || r.status === 'agreed') && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                <input value={note[r.id] ?? ''} onChange={(e) => setNote({ ...note, [r.id]: e.target.value })} placeholder="A note for the other side" className="min-w-0 flex-1 rounded-lg border px-2 py-1.5" style={{ borderColor: 'var(--line)' }} />
                <button onClick={() => call('add_fixture_change_note', { p_request: r.id, p_body: note[r.id] ?? '' }, r.id)} disabled={busy === r.id || !(note[r.id] ?? '').trim()} className="rounded-lg border px-2 py-1.5 disabled:opacity-50" style={{ borderColor: 'var(--line)' }}>Add</button>
                {r.theirs && r.status === 'proposed' && (
                  <>
                    <button onClick={() => call('answer_fixture_change', { p_request: r.id, p_agree: true, p_note: note[r.id] || undefined }, r.id)} disabled={busy === r.id} className="rounded-lg px-2.5 py-1.5 font-semibold text-white disabled:opacity-50" style={{ background: 'var(--yes)' }}>Agree</button>
                    <button onClick={() => call('answer_fixture_change', { p_request: r.id, p_agree: false, p_note: note[r.id] || undefined }, r.id)} disabled={busy === r.id} className="rounded-lg border px-2.5 py-1.5 font-semibold disabled:opacity-50" style={{ borderColor: 'var(--no)', color: 'var(--no)' }}>Can&apos;t</button>
                  </>
                )}
                {r.league && (
                  <>
                    <button onClick={() => call('decide_fixture_change', { p_request: r.id, p_approve: true, p_note: note[r.id] || undefined }, r.id)} disabled={busy === r.id || (r.status !== 'agreed' && Boolean(r.other))} title={r.status !== 'agreed' ? 'Waits for the other team' : undefined} className="rounded-lg px-2.5 py-1.5 font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }}>Approve — move it</button>
                    <button onClick={() => call('decide_fixture_change', { p_request: r.id, p_approve: false, p_note: note[r.id] || undefined }, r.id)} disabled={busy === r.id} className="rounded-lg border px-2.5 py-1.5 disabled:opacity-50" style={{ borderColor: 'var(--line)' }}>Keep as drawn</button>
                  </>
                )}
                {r.mine && (
                  <button onClick={() => call('withdraw_fixture_change', { p_request: r.id }, r.id)} disabled={busy === r.id} className="text-ink-3 underline underline-offset-2 disabled:opacity-50">Withdraw</button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The club manager's button on a run-sheet row. */
export function ProposeChange({ fixtureId, startsAt, onDone }: { fixtureId: string; startsAt: string | null; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState(() => (startsAt ? new Date(new Date(startsAt).getTime() - new Date(startsAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''))
  const [venue, setVenue] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function propose() {
    setBusy(true)
    setError(null)
    const { error } = await createClient().rpc('propose_fixture_change', {
      p_fixture: fixtureId,
      p_reason: reason,
      p_starts_at: at ? new Date(at).toISOString() : undefined,
      p_venue: venue || undefined,
    })
    setBusy(false)
    if (error) return setError(error.message)
    setSent(true)
    setOpen(false)
    onDone()
  }

  if (sent) return <p className="mt-1 text-xs text-ink-3">Change proposed — the other team is asked.</p>
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-1 ml-3 inline-block text-xs underline underline-offset-2 text-ink-3">
        Propose a change
      </button>
    )
  }
  return (
    <div className="mt-2 grid gap-1.5 rounded-xl p-2.5 text-xs" style={{ background: 'var(--surface-2)' }}>
      <label>
        <span className="text-ink-2">New kick-off</span>
        <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: 'var(--line)' }} />
      </label>
      <input value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="New ground (optional)" className="w-full rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: 'var(--line)' }} />
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why" className="w-full rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: 'var(--line)' }} />
      {error && <p style={{ color: 'var(--no)' }}>{error}</p>}
      <div className="flex gap-2">
        <button onClick={propose} disabled={busy || !reason.trim()} className="flex-1 rounded-lg px-3 py-1.5 font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }}>Ask the other team</button>
        <button onClick={() => setOpen(false)} className="rounded-lg border px-3 py-1.5" style={{ borderColor: 'var(--line)' }}>Cancel</button>
      </div>
    </div>
  )
}
