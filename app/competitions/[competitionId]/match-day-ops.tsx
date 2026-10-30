'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const REASONS: [string, string][] = [
  ['wet_weather', 'Wet weather'],
  ['ground_closed', 'Ground closed'],
  ['not_enough_players', 'Not enough players'],
  ['other', 'Other'],
]

/**
 * L-09: the organiser's match-day controls.
 *
 * CallOffDay sits above the run sheet: a date, optionally one ground, a
 * reason, postpone or cancel — and it names every game it touched before
 * anything else happens, because this is the one button in a league that
 * reaches every club at once. Nothing here notifies anybody directly: the
 * fixture changes, each club's event follows (0031), and the squad's push
 * follows that (0064), with the reason.
 */
export function CallOffDay({ competitionId }: { competitionId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState('')
  const [venue, setVenue] = useState('')
  const [reason, setReason] = useState('wet_weather')
  const [cancel, setCancel] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ affected: number; games: string[]; status: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function go() {
    setBusy(true)
    setError(null)
    const { data, error } = await createClient().rpc('call_off_fixtures', {
      p_competition: competitionId, p_date: date, p_reason: reason,
      p_venue: venue.trim() || undefined, p_cancel: cancel,
    })
    setBusy(false)
    if (error) return setError(error.message)
    setDone(data as unknown as typeof done)
    router.refresh()
  }

  if (!open) {
    return (
      <div className="px-4 pt-3">
        <button onClick={() => setOpen(true)} className="w-full rounded-xl border px-3 py-2 text-sm font-semibold" style={{ borderColor: 'var(--maybe)', color: 'var(--maybe)' }}>
          Call off a day or a ground
        </button>
      </div>
    )
  }

  return (
    <div className="mx-4 mt-3 rounded-xl border p-3" style={{ borderColor: 'var(--maybe)' }}>
      <p className="text-sm font-semibold">Call games off</p>
      <p className="mt-0.5 text-xs text-ink-3">Every club involved is told in its squad chat, with the reason. Postponed games come back when you reschedule them.</p>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <label>
          <span className="text-ink-2">Day</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: 'var(--line)' }} />
        </label>
        <label>
          <span className="text-ink-2">Ground (blank = all)</span>
          <input value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="e.g. ELS Hall" className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: 'var(--line)' }} />
        </label>
        <label>
          <span className="text-ink-2">Why</span>
          <select value={reason} onChange={(e) => setReason(e.target.value)} className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: 'var(--line)' }}>
            {REASONS.map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
          </select>
        </label>
        <label className="flex items-end gap-2 pb-1.5">
          <input type="checkbox" checked={cancel} onChange={(e) => setCancel(e.target.checked)} />
          <span className="text-ink-2">Cancel outright (not postpone)</span>
        </label>
      </div>
      {error && <p className="mt-2 text-xs" style={{ color: 'var(--no)' }}>{error}</p>}
      {done && (
        <p className="mt-2 rounded-lg p-2 text-xs" style={{ background: 'var(--yes-bg)', color: 'var(--yes)' }}>
          {done.affected === 0 ? 'Nothing to call off on that day.' : `${done.status === 'cancelled' ? 'Cancelled' : 'Postponed'} ${done.affected}: ${done.games.join(' · ')}`}
        </p>
      )}
      <div className="mt-2 flex gap-2">
        <button onClick={go} disabled={busy || !date} className="flex-1 rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--no)' }}>
          {busy ? '…' : cancel ? 'Cancel the games' : 'Postpone the games'}
        </button>
        <button onClick={() => { setOpen(false); setDone(null) }} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--line)' }}>
          Close
        </button>
      </div>
    </div>
  )
}

/** Per game: postpone, reschedule, forfeit, bye. */
export function FixtureOps({
  fixtureId, status, homeName, awayName, homeEntryId, awayEntryId,
}: {
  fixtureId: string; status: string; homeName: string; awayName: string
  homeEntryId: string | null; awayEntryId: string | null
}) {
  const router = useRouter()
  const [mode, setMode] = useState<null | 'postpone' | 'reschedule' | 'forfeit'>(null)
  const [reason, setReason] = useState('wet_weather')
  const [when, setWhen] = useState('')
  const [venue, setVenue] = useState('')
  const [who, setWho] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(fn: string, args: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    const { error } = await createClient().rpc(fn as never, args as never)
    setBusy(false)
    if (error) return setError(error.message)
    setMode(null)
    router.refresh()
  }

  const played = status === 'final' || status === 'forfeit'
  if (played && !mode) {
    return null
  }

  return (
    <div className="mt-1.5 text-xs">
      {!mode && (
        <div className="flex flex-wrap gap-1.5">
          {status !== 'postponed' && status !== 'cancelled' && (
            <button onClick={() => setMode('postpone')} className="rounded border px-2 py-0.5" style={{ borderColor: 'var(--line)' }}>Postpone</button>
          )}
          <button onClick={() => setMode('reschedule')} className="rounded border px-2 py-0.5" style={{ borderColor: 'var(--line)' }}>
            {status === 'postponed' || status === 'cancelled' ? 'Reschedule' : 'Move'}
          </button>
          {homeEntryId && awayEntryId && (
            <button onClick={() => setMode('forfeit')} className="rounded border px-2 py-0.5" style={{ borderColor: 'var(--line)' }}>Forfeit</button>
          )}
          {status !== 'bye' && (
            <button onClick={() => run('set_bye', { p_fixture: fixtureId })} disabled={busy} className="rounded border px-2 py-0.5" style={{ borderColor: 'var(--line)' }}>Bye</button>
          )}
        </div>
      )}
      {mode === 'postpone' && (
        <div className="flex flex-wrap items-center gap-1.5">
          <select value={reason} onChange={(e) => setReason(e.target.value)} className="rounded border px-1.5 py-1" style={{ borderColor: 'var(--line)' }}>
            {REASONS.map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
          </select>
          <button onClick={() => run('postpone_fixture', { p_fixture: fixtureId, p_reason: reason })} disabled={busy} className="rounded px-2 py-1 font-semibold text-white" style={{ background: 'var(--maybe)' }}>Postpone</button>
          <button onClick={() => run('postpone_fixture', { p_fixture: fixtureId, p_reason: reason, p_cancel: true })} disabled={busy} className="rounded px-2 py-1 font-semibold text-white" style={{ background: 'var(--no)' }}>Cancel game</button>
          <button onClick={() => setMode(null)} className="px-1">✕</button>
        </div>
      )}
      {mode === 'reschedule' && (
        <div className="flex flex-wrap items-center gap-1.5">
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="rounded border px-1.5 py-1" style={{ borderColor: 'var(--line)' }} aria-label="New time" />
          <input value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="ground (optional)" className="w-28 rounded border px-1.5 py-1" style={{ borderColor: 'var(--line)' }} />
          <button onClick={() => run('reschedule_fixture', { p_fixture: fixtureId, p_starts_at: new Date(when).toISOString(), p_venue_label: venue || undefined })} disabled={busy || !when} className="rounded px-2 py-1 font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }}>Set</button>
          <button onClick={() => setMode(null)} className="px-1">✕</button>
        </div>
      )}
      {mode === 'forfeit' && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-ink-2">Who forfeited?</span>
          <select value={who} onChange={(e) => setWho(e.target.value)} className="rounded border px-1.5 py-1" style={{ borderColor: 'var(--line)' }}>
            <option value="">—</option>
            <option value={homeEntryId ?? ''}>{homeName}</option>
            <option value={awayEntryId ?? ''}>{awayName}</option>
          </select>
          <button onClick={() => run('forfeit_fixture', { p_fixture: fixtureId, p_forfeiting_entry: who })} disabled={busy || !who} className="rounded px-2 py-1 font-semibold text-white disabled:opacity-50" style={{ background: 'var(--no)' }}>Award</button>
          <button onClick={() => setMode(null)} className="px-1">✕</button>
        </div>
      )}
      {error && <p className="mt-1" style={{ color: 'var(--no)' }}>{error}</p>}
    </div>
  )
}
