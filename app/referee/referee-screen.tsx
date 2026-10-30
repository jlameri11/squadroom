'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const SYDNEY = 'Australia/Sydney'

type Pool = { id: string; league: string; grade: string | null; status: 'active' | 'inactive'; bank_details: string | null }
type Appointment = {
  id: string
  role: 'referee' | 'assistant' | 'fourth'
  status: 'offered' | 'accepted' | 'declined' | 'withdrawn'
  offered_at: string
  checked_in_at: string | null
  reported_at: string | null
  report: Record<string, unknown> | null
  withdrawn_note: string | null
  fixture_id: string
  starts_at: string | null
  fixture_status: string
  competition: string
  competition_id: string
  league: string
  division: string
  round: string | null
  venue: string | null
  address: string | null
  field: string | null
  home: string | null
  away: string | null
  home_score: number | null
  away_score: number | null
  /** L-07: the match fee, and when the league paid it. */
  fee_cents: number | null
  paid_at: string | null
}
type Blockout = { id: string; referee_id: string; starts_at: string; ends_at: string; reason: string | null }
type Mine = { pools: Pool[]; appointments: Appointment[]; blockouts: Blockout[] }

const ROLE: Record<Appointment['role'], string> = { referee: 'Referee', assistant: 'Assistant referee', fourth: '4th official' }

function when(iso: string | null) {
  if (!iso) return 'Time to be confirmed'
  return new Date(iso).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: SYDNEY })
}
function day(iso: string) {
  return new Date(iso).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: SYDNEY })
}
/** Three hours before kick-off to two after — the same window the database enforces. */
function canCheckIn(a: Appointment, now: number) {
  if (!a.starts_at || a.status !== 'accepted' || a.checked_in_at) return false
  const ko = new Date(a.starts_at).getTime()
  return now >= ko - 3 * 3600_000 && now <= ko + 2 * 3600_000
}
function afterKickOff(a: Appointment, now: number) {
  return !!a.starts_at && now >= new Date(a.starts_at).getTime()
}

export function RefereeScreen() {
  const [mine, setMine] = useState<Mine | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [reporting, setReporting] = useState<string | null>(null)
  const [report, setReport] = useState({ home_score: '', away_score: '', conduct: '', incidents: '', pitch: '', notes: '' })
  const [bank, setBank] = useState<string | null>(null)
  const [addingBlock, setAddingBlock] = useState(false)
  const [block, setBlock] = useState({ from: '', to: '', reason: '' })
  // The clock is state, not a call during render: the check-in window
  // opens while the page is sitting open at the ground.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  const load = useCallback(async () => {
    const { data, error } = await createClient().rpc('my_appointments')
    if (error) return setError(error.message)
    setMine(data as unknown as Mine)
  }, [])

  useEffect(() => {
    ;(async () => {
      await load()
    })()
  }, [load])

  async function respond(id: string, accept: boolean) {
    setBusy(id)
    setError(null)
    const { error } = await createClient().rpc('respond_appointment', { p_appointment: id, p_accept: accept })
    setBusy(null)
    if (error) return setError(error.message)
    await load()
  }

  async function checkIn(id: string) {
    setBusy(id)
    setError(null)
    const { error } = await createClient().rpc('referee_check_in', { p_appointment: id })
    setBusy(null)
    if (error) return setError(error.message)
    await load()
  }

  async function sendReport(id: string) {
    setBusy(id)
    setError(null)
    const body = {
      home_score: report.home_score === '' ? null : Number(report.home_score),
      away_score: report.away_score === '' ? null : Number(report.away_score),
      conduct: report.conduct.trim() || null,
      incidents: report.incidents.trim() || null,
      pitch: report.pitch.trim() || null,
      notes: report.notes.trim() || null,
    }
    const { error } = await createClient().rpc('submit_referee_report', { p_appointment: id, p_report: body })
    setBusy(null)
    if (error) return setError(error.message)
    setReporting(null)
    setReport({ home_score: '', away_score: '', conduct: '', incidents: '', pitch: '', notes: '' })
    await load()
  }

  async function addBlockout() {
    if (!mine) return
    setBusy('block')
    setError(null)
    // One row per pool this person referees in: a weekend away is a
    // weekend away for every league.
    const rows = mine.pools.map((p) => ({
      referee_id: p.id,
      academy_id: '' as string,
      starts_at: new Date(block.from).toISOString(),
      ends_at: new Date(block.to).toISOString(),
      reason: block.reason.trim() || null,
    }))
    const client = createClient()
    // academy_id is the pool's own; read it rather than guess.
    const { data: refs } = await client.from('referees').select('id, academy_id').in('id', rows.map((r) => r.referee_id))
    for (const r of rows) r.academy_id = refs?.find((x) => x.id === r.referee_id)?.academy_id ?? ''
    const { error } = await client.from('referee_blockouts').insert(rows)
    setBusy(null)
    if (error) return setError(error.message)
    setAddingBlock(false)
    setBlock({ from: '', to: '', reason: '' })
    await load()
  }

  async function saveBank() {
    if (!mine || bank === null) return
    setBusy('bank')
    setError(null)
    for (const p of mine.pools) {
      const { error } = await createClient().rpc('set_my_bank_details', { p_referee: p.id, p_details: bank })
      if (error) {
        setBusy(null)
        return setError(error.message)
      }
    }
    setBusy(null)
    setBank(null)
    await load()
  }

  async function removeBlockout(id: string) {
    setBusy(id)
    const { error } = await createClient().from('referee_blockouts').delete().eq('id', id)
    setBusy(null)
    if (error) return setError(error.message)
    await load()
  }

  if (!mine) return <p className="p-5 text-center text-sm text-ink-3">{error ?? 'Loading…'}</p>

  if (mine.pools.length === 0) {
    return (
      <div className="p-5">
        <p className="card p-5 text-center text-sm text-ink-2">
          You are not in a referee pool yet. A league adds you and sends you a link to open once.
        </p>
      </div>
    )
  }

  const asked = mine.appointments.filter((a) => a.status === 'offered')
  const upcoming = mine.appointments.filter((a) => a.status === 'accepted' && (!a.starts_at || new Date(a.starts_at).getTime() >= now - 2 * 3600_000)).sort((x, y) => (x.starts_at ?? '').localeCompare(y.starts_at ?? ''))
  const past = mine.appointments.filter((a) => a.status === 'accepted' && a.starts_at && new Date(a.starts_at).getTime() < now - 2 * 3600_000)
  const other = mine.appointments.filter((a) => a.status === 'declined' || a.status === 'withdrawn')

  return (
    <div className="p-3.5">
      {error && (
        <p className="mb-3 rounded-lg p-2.5 text-sm" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>
          {error}
        </p>
      )}

      <p className="px-1 pb-3 text-sm text-ink-2">
        You referee for {mine.pools.map((p) => p.league).join(', ')}.
      </p>

      {asked.length > 0 && (
        <>
          <h3 className="eyebrow px-1 pb-1.5">Asked of you</h3>
          <ul className="card mb-4 divide-y overflow-hidden" style={{ borderColor: 'var(--line-2)' }}>
            {asked.map((a) => (
              <li key={a.id} className="px-3.5 py-3 text-sm">
                <GameLine a={a} />
                <div className="mt-2 flex gap-2">
                  <button onClick={() => respond(a.id, true)} disabled={busy === a.id} className="flex-1 rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }}>
                    Yes, I&apos;ll take it
                  </button>
                  <button onClick={() => respond(a.id, false)} disabled={busy === a.id} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50" style={{ borderColor: 'var(--line)' }}>
                    Can&apos;t
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className="eyebrow px-1 pb-1.5">Your games</h3>
      {upcoming.length === 0 ? (
        <p className="card mb-4 p-5 text-center text-sm text-ink-3">Nothing coming up.</p>
      ) : (
        <ul className="card mb-4 divide-y overflow-hidden" style={{ borderColor: 'var(--line-2)' }}>
          {upcoming.map((a) => (
            <li key={a.id} className="px-3.5 py-3 text-sm">
              <GameLine a={a} />
              {a.checked_in_at ? (
                <p className="mt-1.5 text-xs" style={{ color: 'var(--yes)' }}>
                  Checked in {new Date(a.checked_in_at).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: SYDNEY })}
                </p>
              ) : canCheckIn(a, now) ? (
                <button onClick={() => checkIn(a.id)} disabled={busy === a.id} className="mt-2 w-full rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }}>
                  I&apos;m at the ground
                </button>
              ) : (
                <p className="mt-1.5 text-xs text-ink-3">Check in from three hours before kick-off.</p>
              )}
              {afterKickOff(a, now) && !a.reported_at && (
                <ReportForm a={a} open={reporting === a.id} onOpen={() => setReporting(a.id)} onClose={() => setReporting(null)} report={report} setReport={setReport} onSend={() => sendReport(a.id)} busy={busy === a.id} />
              )}
            </li>
          ))}
        </ul>
      )}

      {past.length > 0 && (
        <>
          <h3 className="eyebrow px-1 pb-1.5">Played</h3>
          <ul className="card mb-4 divide-y overflow-hidden" style={{ borderColor: 'var(--line-2)' }}>
            {past.map((a) => (
              <li key={a.id} className="px-3.5 py-3 text-sm">
                <GameLine a={a} />
                <p className="mt-1 text-xs text-ink-3">
                  {a.checked_in_at ? 'Checked in' : 'No check-in'}
                  {a.reported_at ? ' · report sent' : ''}
                  {a.fee_cents != null ? ` · ${(a.fee_cents / 100).toFixed(2)}${a.paid_at ? ' paid' : a.checked_in_at ? ' owed' : ''}` : ''}
                </p>
                {!a.reported_at && (
                  <ReportForm a={a} open={reporting === a.id} onOpen={() => setReporting(a.id)} onClose={() => setReporting(null)} report={report} setReport={setReport} onSend={() => sendReport(a.id)} busy={busy === a.id} />
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className="eyebrow px-1 pb-1.5">Getting paid</h3>
      <section className="card mb-4 p-3.5 text-sm">
        {(() => {
          const paid = mine.appointments.filter((a) => a.paid_at).reduce((s, a) => s + (a.fee_cents ?? 0), 0)
          const owed = mine.appointments.filter((a) => !a.paid_at && a.status === 'accepted' && a.checked_in_at).reduce((s, a) => s + (a.fee_cents ?? 0), 0)
          return (
            <p>
              <b>Owed to you:</b> ${(owed / 100).toFixed(2)} · <span className="text-ink-3">paid so far ${(paid / 100).toFixed(2)}</span>
            </p>
          )
        })()}
        <p className="mt-0.5 text-xs text-ink-3">A game counts once you check in at the ground. The league pays runs of games, by bank transfer or Stripe.</p>
        {bank === null ? (
          <p className="mt-2 flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-xs text-ink-2">{mine.pools[0]?.bank_details ?? 'No bank details given yet.'}</span>
            <button onClick={() => setBank(mine.pools[0]?.bank_details ?? '')} className="flex-none rounded-lg border px-2 py-1 text-xs" style={{ borderColor: 'var(--line)' }}>
              {mine.pools[0]?.bank_details ? 'Change' : 'Add bank details'}
            </button>
          </p>
        ) : (
          <div className="mt-2 grid gap-2">
            <input value={bank} onChange={(e) => setBank(e.target.value)} placeholder="Name, BSB and account number" className="w-full rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--line)' }} />
            <p className="text-xs text-ink-3">Seen by the league&apos;s treasurer and nobody else.</p>
            <div className="flex gap-2">
              <button onClick={saveBank} disabled={busy === 'bank'} className="flex-1 rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }}>Save</button>
              <button onClick={() => setBank(null)} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--line)' }}>Cancel</button>
            </div>
          </div>
        )}
      </section>

      <h3 className="eyebrow px-1 pb-1.5">When you&apos;re not free</h3>
      <section className="card mb-4 p-3.5">
        {mine.blockouts.length === 0 && !addingBlock && (
          <p className="text-sm text-ink-3">Nothing blocked out. Leagues can ask you for any game.</p>
        )}
        <ul className="divide-y" style={{ borderColor: 'var(--line-2)' }}>
          {mine.blockouts.map((b) => (
            <li key={b.id} className="flex items-center gap-2 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate">{day(b.starts_at)} → {day(b.ends_at)}</span>
                {b.reason && <span className="block truncate text-xs text-ink-3">{b.reason}</span>}
              </span>
              <button onClick={() => removeBlockout(b.id)} disabled={busy === b.id} className="flex-none rounded-lg border px-2 py-1 text-xs disabled:opacity-50" style={{ borderColor: 'var(--line)' }}>
                Remove
              </button>
            </li>
          ))}
        </ul>
        {addingBlock ? (
          <div className="mt-3 grid gap-2">
            <label className="text-xs text-ink-2">
              From
              <input type="datetime-local" value={block.from} onChange={(e) => setBlock({ ...block, from: e.target.value })} className="mt-0.5 w-full rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--line)' }} />
            </label>
            <label className="text-xs text-ink-2">
              To
              <input type="datetime-local" value={block.to} onChange={(e) => setBlock({ ...block, to: e.target.value })} className="mt-0.5 w-full rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--line)' }} />
            </label>
            <input value={block.reason} onChange={(e) => setBlock({ ...block, reason: e.target.value })} placeholder="Reason (optional)" className="w-full rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--line)' }} />
            <div className="flex gap-2">
              <button onClick={addBlockout} disabled={busy === 'block' || !block.from || !block.to || block.to <= block.from} className="flex-1 rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }}>
                Block it out
              </button>
              <button onClick={() => setAddingBlock(false)} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--line)' }}>Cancel</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAddingBlock(true)} className="mt-3 w-full rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: 'var(--line)', color: 'var(--brand-text)' }}>
            Add dates you can&apos;t do
          </button>
        )}
      </section>

      {other.length > 0 && (
        <>
          <h3 className="eyebrow px-1 pb-1.5">Declined or withdrawn</h3>
          <ul className="card divide-y overflow-hidden" style={{ borderColor: 'var(--line-2)' }}>
            {other.map((a) => (
              <li key={a.id} className="px-3.5 py-2.5 text-sm text-ink-3">
                <GameLine a={a} muted />
                <p className="mt-0.5 text-xs">{a.status === 'declined' ? 'You declined' : `Withdrawn by the league${a.withdrawn_note ? ` — ${a.withdrawn_note}` : ''}`}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function GameLine({ a, muted = false }: { a: Appointment; muted?: boolean }) {
  return (
    <div>
      <span className={`block truncate ${muted ? '' : 'font-medium'}`}>
        {a.home ?? 'TBC'} v {a.away ?? 'TBC'}
        {a.fixture_status === 'final' && a.home_score != null && (
          <span className="text-ink-3"> · {a.home_score}–{a.away_score}</span>
        )}
      </span>
      <span className="block truncate text-xs text-ink-3">
        {when(a.starts_at)} · {ROLE[a.role]}
      </span>
      <span className="block truncate text-xs text-ink-3">
        {[a.venue, a.field, a.competition, a.division].filter(Boolean).join(' · ')}
      </span>
      {a.address && <span className="block truncate text-xs text-ink-3">{a.address}</span>}
    </div>
  )
}

function ReportForm({
  a, open, onOpen, onClose, report, setReport, onSend, busy,
}: {
  a: Appointment
  open: boolean
  onOpen: () => void
  onClose: () => void
  report: { home_score: string; away_score: string; conduct: string; incidents: string; pitch: string; notes: string }
  setReport: (r: typeof report) => void
  onSend: () => void
  busy: boolean
}) {
  if (!open) {
    return (
      <button onClick={onOpen} className="mt-2 rounded-lg border px-2.5 py-1 text-xs font-semibold" style={{ borderColor: 'var(--line)', color: 'var(--brand-text)' }}>
        Write the report
      </button>
    )
  }
  const field = 'w-full rounded-lg border px-3 py-2 text-sm'
  return (
    <div className="mt-2 grid gap-2 rounded-xl p-2.5" style={{ background: 'var(--surface-2)' }}>
      <div className="flex items-center gap-2 text-sm">
        <span className="min-w-0 flex-1 truncate text-xs text-ink-2">{a.home ?? 'Home'}</span>
        <input value={report.home_score} onChange={(e) => setReport({ ...report, home_score: e.target.value })} inputMode="numeric" placeholder="0" className="w-12 rounded-lg border px-2 py-1.5 text-center tabular-nums" style={{ borderColor: 'var(--line)' }} />
        <span className="text-ink-3">–</span>
        <input value={report.away_score} onChange={(e) => setReport({ ...report, away_score: e.target.value })} inputMode="numeric" placeholder="0" className="w-12 rounded-lg border px-2 py-1.5 text-center tabular-nums" style={{ borderColor: 'var(--line)' }} />
        <span className="min-w-0 flex-1 truncate text-right text-xs text-ink-2">{a.away ?? 'Away'}</span>
      </div>
      <textarea value={report.conduct} onChange={(e) => setReport({ ...report, conduct: e.target.value })} placeholder="Conduct of players, coaches and spectators" rows={2} className={field} style={{ borderColor: 'var(--line)' }} />
      <textarea value={report.incidents} onChange={(e) => setReport({ ...report, incidents: e.target.value })} placeholder="Incidents: cards, injuries, abandonment" rows={2} className={field} style={{ borderColor: 'var(--line)' }} />
      <input value={report.pitch} onChange={(e) => setReport({ ...report, pitch: e.target.value })} placeholder="Pitch and facilities" className={field} style={{ borderColor: 'var(--line)' }} />
      <textarea value={report.notes} onChange={(e) => setReport({ ...report, notes: e.target.value })} placeholder="Anything else" rows={2} className={field} style={{ borderColor: 'var(--line)' }} />
      <div className="flex gap-2">
        <button onClick={onSend} disabled={busy} className="flex-1 rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }}>
          Send the report
        </button>
        <button onClick={onClose} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--line)' }}>Cancel</button>
      </div>
    </div>
  )
}
