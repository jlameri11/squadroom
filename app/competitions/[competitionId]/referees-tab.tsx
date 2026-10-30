'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { RefereePayments } from './referee-payments'

const SYDNEY = 'Australia/Sydney'

type Appointment = {
  id: string
  referee_id: string
  name: string
  grade: string | null
  claimed: boolean
  role: 'referee' | 'assistant' | 'fourth'
  status: 'offered' | 'accepted' | 'declined' | 'withdrawn'
  response_note: string | null
  checked_in_at: string | null
  reported_at: string | null
  report: Record<string, unknown> | null
}
type Game = {
  fixture_id: string
  starts_at: string | null
  division: string
  round: string | null
  venue: string | null
  field: string | null
  status: string
  home: string | null
  away: string | null
  appointments: Appointment[]
}
type Summary = { referee_id: string; name: string; grade: string | null; offered: number; accepted: number; declined: number; checked_in: number; reported: number }
type PoolRef = {
  id: string
  full_name: string
  phone: string | null
  grade: string | null
  status: 'active' | 'inactive'
  claimed: boolean
  claim_token: string | null
  upcoming: number
  games: number
  declined: number
  blockouts: { id: string; starts_at: string; ends_at: string; reason: string | null }[]
}
type Candidate = { id: string; full_name: string; grade: string | null; claimed: boolean; unavailable: string | null; already: string | null }

const ROLE: Record<Appointment['role'], string> = { referee: 'Referee', assistant: 'Assistant', fourth: '4th official' }

function when(iso: string | null) {
  if (!iso) return 'Unscheduled'
  return new Date(iso).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: SYDNEY })
}

/**
 * L-06: the Refs tab. Every game in the division with who is on it;
 * for the organiser, the pool (add a referee, hand them their link) and
 * an Appoint control per game that shows who is free, who is blocked out
 * and who is already on another pitch at that time.
 */
export function RefereesTab({
  competitionId,
  division,
  isOrganiser,
}: {
  competitionId: string
  division: string
  isOrganiser: boolean
}) {
  const [games, setGames] = useState<Game[] | null>(null)
  const [summary, setSummary] = useState<Summary[]>([])
  const [pool, setPool] = useState<PoolRef[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [showPool, setShowPool] = useState(false)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ full_name: '', phone: '', grade: '' })
  const [picking, setPicking] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [role, setRole] = useState<Appointment['role']>('referee')
  const [copied, setCopied] = useState<string | null>(null)
  const [openReport, setOpenReport] = useState<string | null>(null)

  const load = useCallback(async () => {
    const client = createClient()
    const [{ data, error }, poolRes] = await Promise.all([
      client.rpc('competition_appointments', { p_competition: competitionId, p_division: division || undefined }),
      isOrganiser ? client.rpc('referee_pool', { p_competition: competitionId }) : Promise.resolve({ data: null, error: null }),
    ])
    if (error) return setError(error.message)
    const r = data as unknown as { fixtures: Game[]; summary: Summary[] } | null
    setGames(r?.fixtures ?? [])
    setSummary(r?.summary ?? [])
    if (poolRes.data) setPool(poolRes.data as unknown as PoolRef[])
  }, [competitionId, division, isOrganiser])

  useEffect(() => {
    ;(async () => {
      await load()
    })()
  }, [load])

  async function addReferee() {
    setBusy('add')
    setError(null)
    const { error } = await createClient().rpc('add_referee', {
      p_competition: competitionId,
      p_full_name: draft.full_name,
      p_phone: draft.phone || undefined,
      p_grade: draft.grade || undefined,
    })
    setBusy(null)
    if (error) return setError(error.message)
    setDraft({ full_name: '', phone: '', grade: '' })
    setAdding(false)
    await load()
  }

  async function openPicker(fixtureId: string) {
    setPicking(fixtureId)
    setCandidates([])
    const { data, error } = await createClient().rpc('referee_availability', { p_fixture: fixtureId })
    if (error) return setError(error.message)
    setCandidates((data as unknown as Candidate[]) ?? [])
  }

  async function appoint(fixtureId: string, refereeId: string) {
    setBusy(refereeId)
    setError(null)
    const { error } = await createClient().rpc('appoint_referee', { p_fixture: fixtureId, p_referee: refereeId, p_role: role })
    setBusy(null)
    if (error) return setError(error.message)
    setPicking(null)
    await load()
  }

  async function withdraw(id: string) {
    setBusy(id)
    setError(null)
    const { error } = await createClient().rpc('withdraw_appointment', { p_appointment: id })
    setBusy(null)
    if (error) return setError(error.message)
    await load()
  }

  async function setActive(ref: PoolRef, active: boolean) {
    setBusy(ref.id)
    const { error } = await createClient().from('referees').update({ status: active ? 'active' : 'inactive' }).eq('id', ref.id)
    setBusy(null)
    if (error) return setError(error.message)
    await load()
  }

  async function copyLink(ref: PoolRef) {
    const url = `${window.location.origin}/ref/${ref.claim_token}`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(ref.id)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      window.prompt('Copy this link', url)
    }
  }

  if (!games) return <p className="p-5 text-center text-sm text-ink-3">{error ?? 'Loading…'}</p>

  return (
    <div className="p-3.5">
      {error && (
        <p className="mb-3 rounded-lg p-2.5 text-sm" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>
          {error}
        </p>
      )}

      {isOrganiser && (
        <section className="card mb-4 p-3.5">
          <div className="flex items-center gap-3">
            <span className="min-w-0 flex-1 text-sm">
              <b>The pool</b>
              <span className="block text-ink-3">
                {pool.filter((r) => r.status === 'active').length} active · {pool.filter((r) => !r.claimed).length} yet to open their link
              </span>
            </span>
            <button onClick={() => setShowPool((v) => !v)} className="flex-none rounded-xl px-3.5 py-2 text-sm font-semibold" style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}>
              {showPool ? 'Hide' : 'Show'}
            </button>
          </div>

          {showPool && (
            <div className="mt-3">
              {pool.length === 0 && !adding && <p className="text-sm text-ink-3">Nobody yet. Add a referee and send them their link.</p>}
              <ul className="divide-y" style={{ borderColor: 'var(--line-2)' }}>
                {pool.map((r) => (
                  <li key={r.id} className="py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate ${r.status === 'inactive' ? 'text-ink-3 line-through' : 'font-medium'}`}>{r.full_name}</span>
                        <span className="block truncate text-xs text-ink-3">
                          {[r.grade, r.phone, r.claimed ? `${r.upcoming} upcoming · ${r.games} done` : 'link not opened yet'].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      {!r.claimed && (
                        <button onClick={() => copyLink(r)} className="flex-none rounded-lg border px-2 py-1 text-xs" style={{ borderColor: 'var(--line)' }}>
                          {copied === r.id ? 'Copied' : 'Copy link'}
                        </button>
                      )}
                      <button onClick={() => setActive(r, r.status !== 'active')} disabled={busy === r.id} className="flex-none rounded-lg border px-2 py-1 text-xs disabled:opacity-50" style={{ borderColor: 'var(--line)' }}>
                        {r.status === 'active' ? 'Rest' : 'Activate'}
                      </button>
                    </div>
                    {r.blockouts.length > 0 && (
                      <p className="mt-1 text-xs text-ink-3">
                        Not free: {r.blockouts.map((b) => `${when(b.starts_at)} → ${when(b.ends_at)}${b.reason ? ` (${b.reason})` : ''}`).join('; ')}
                      </p>
                    )}
                  </li>
                ))}
              </ul>

              {adding ? (
                <div className="mt-3 grid gap-2">
                  <input value={draft.full_name} onChange={(e) => setDraft({ ...draft, full_name: e.target.value })} placeholder="Full name" className="w-full rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--line)' }} />
                  <div className="grid grid-cols-2 gap-2">
                    <input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} placeholder="Phone (optional)" inputMode="tel" className="w-full rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--line)' }} />
                    <input value={draft.grade} onChange={(e) => setDraft({ ...draft, grade: e.target.value })} placeholder="Grade (optional)" className="w-full rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--line)' }} />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={addReferee} disabled={busy === 'add' || !draft.full_name.trim()} className="flex-1 rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }}>
                      Add to the pool
                    </button>
                    <button onClick={() => setAdding(false)} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--line)' }}>Cancel</button>
                  </div>
                  <p className="text-xs text-ink-3">They get a link to open once; after that their games reach them as a push.</p>
                </div>
              ) : (
                <button onClick={() => setAdding(true)} className="mt-3 w-full rounded-lg px-3 py-2 text-sm font-semibold text-white" style={{ background: 'var(--brand)' }}>
                  Add a referee
                </button>
              )}
            </div>
          )}
        </section>
      )}

      <h3 className="eyebrow px-1 pb-1.5">Games</h3>
      {games.length === 0 ? (
        <p className="card p-5 text-center text-sm text-ink-3">No games in this division yet.</p>
      ) : (
        <ul className="card divide-y overflow-hidden" style={{ borderColor: 'var(--line-2)' }}>
          {games.map((g) => {
            const live = g.appointments.filter((a) => a.status !== 'withdrawn')
            const hasRef = live.some((a) => a.role === 'referee' && a.status !== 'declined')
            return (
              <li key={g.fixture_id} className="px-3.5 py-3 text-sm">
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{g.home ?? 'TBC'} v {g.away ?? 'TBC'}</span>
                    <span className="block truncate text-xs text-ink-3">
                      {when(g.starts_at)}{g.venue ? ` · ${g.venue}` : ''}{g.field ? ` ${g.field}` : ''}{g.round ? ` · ${g.round}` : ''}
                    </span>
                  </span>
                  {!hasRef && g.status === 'scheduled' && (
                    <span className="pill flex-none" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>No referee</span>
                  )}
                </div>

                {live.length > 0 && (
                  <ul className="mt-1.5 space-y-1">
                    {live.map((a) => (
                      <li key={a.id} className="flex items-center gap-2 text-xs">
                        <span className="min-w-0 flex-1 truncate">
                          <b className="font-medium">{a.name}</b>
                          <span className="text-ink-3"> · {ROLE[a.role]}{a.grade ? ` · ${a.grade}` : ''}</span>
                        </span>
                        <Status a={a} />
                        {isOrganiser && a.status !== 'declined' && (
                          <button onClick={() => withdraw(a.id)} disabled={busy === a.id} className="flex-none rounded border px-1.5 py-0.5 disabled:opacity-50" style={{ borderColor: 'var(--line)' }}>
                            Withdraw
                          </button>
                        )}
                        {isOrganiser && a.reported_at && (
                          <button onClick={() => setOpenReport(openReport === a.id ? null : a.id)} className="flex-none rounded border px-1.5 py-0.5" style={{ borderColor: 'var(--line)' }}>
                            Report
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {isOrganiser && openReport && live.some((a) => a.id === openReport) && (
                  <ReportView report={live.find((a) => a.id === openReport)!.report} />
                )}

                {isOrganiser && g.status === 'scheduled' && picking !== g.fixture_id && (
                  <button onClick={() => openPicker(g.fixture_id)} className="mt-2 rounded-lg border px-2.5 py-1 text-xs font-semibold" style={{ borderColor: 'var(--line)', color: 'var(--brand-text)' }}>
                    Appoint
                  </button>
                )}

                {isOrganiser && picking === g.fixture_id && (
                  <div className="mt-2 rounded-xl p-2.5" style={{ background: 'var(--surface-2)' }}>
                    <div className="mb-2 flex items-center gap-2 text-xs">
                      <span className="text-ink-2">As</span>
                      <select value={role} onChange={(e) => setRole(e.target.value as Appointment['role'])} className="rounded-lg border bg-transparent px-2 py-1" style={{ borderColor: 'var(--line)' }}>
                        <option value="referee">Referee</option>
                        <option value="assistant">Assistant</option>
                        <option value="fourth">4th official</option>
                      </select>
                      <button onClick={() => setPicking(null)} className="ml-auto text-ink-3">Close</button>
                    </div>
                    {candidates.length === 0 ? (
                      <p className="text-xs text-ink-3">{pool.length === 0 ? 'The pool is empty.' : 'Loading…'}</p>
                    ) : (
                      <ul className="space-y-1">
                        {candidates.map((c) => {
                          const taken = c.already === 'offered' || c.already === 'accepted'
                          const blocked = !!c.unavailable || taken
                          return (
                            <li key={c.id} className="flex items-center gap-2 text-xs">
                              <span className="min-w-0 flex-1 truncate">
                                <span className={blocked ? 'text-ink-3' : 'font-medium'}>{c.full_name}</span>
                                {c.grade && <span className="text-ink-3"> · {c.grade}</span>}
                                {!c.claimed && <span className="text-ink-3"> · no app yet</span>}
                                {c.unavailable && <span className="block truncate text-ink-3">{c.unavailable}</span>}
                                {taken && <span className="block text-ink-3">already on this game</span>}
                              </span>
                              <button
                                onClick={() => appoint(g.fixture_id, c.id)}
                                disabled={blocked || busy === c.id}
                                className="flex-none rounded-lg px-2.5 py-1 font-semibold text-white disabled:opacity-40"
                                style={{ background: 'var(--brand)' }}
                              >
                                Ask
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {isOrganiser && <RefereePayments competitionId={competitionId} />}

      {isOrganiser && summary.length > 0 && (
        <>
          <h3 className="eyebrow mt-5 px-1 pb-1.5">This season</h3>
          <div className="card overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-ink-3">
                  <th className="px-3 py-2 font-normal">Referee</th>
                  <th className="px-2 py-2 text-right font-normal">Asked</th>
                  <th className="px-2 py-2 text-right font-normal">Yes</th>
                  <th className="px-2 py-2 text-right font-normal">No</th>
                  <th className="px-2 py-2 text-right font-normal">Turned up</th>
                  <th className="px-3 py-2 text-right font-normal">Reports</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((s) => (
                  <tr key={s.referee_id} className="border-t" style={{ borderColor: 'var(--line-2)' }}>
                    <td className="px-3 py-1.5">{s.name}{s.grade ? <span className="text-ink-3"> · {s.grade}</span> : null}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{s.offered + s.accepted + s.declined}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{s.accepted}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{s.declined}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{s.checked_in}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{s.reported}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function Status({ a }: { a: Appointment }) {
  if (a.status === 'declined') return <span className="pill flex-none" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>Declined</span>
  if (a.status === 'offered') return <span className="pill flex-none" style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}>Asked</span>
  if (a.checked_in_at) return <span className="pill flex-none" style={{ background: 'var(--yes-bg)', color: 'var(--yes)' }}>At the ground</span>
  return <span className="pill flex-none" style={{ background: 'var(--yes-bg)', color: 'var(--yes)' }}>Accepted</span>
}

function ReportView({ report }: { report: Record<string, unknown> | null }) {
  if (!report) return null
  const rows: [string, string][] = [
    ['Score', report.home_score != null && report.away_score != null ? `${report.home_score}–${report.away_score}` : ''],
    ['Conduct', String(report.conduct ?? '')],
    ['Incidents', String(report.incidents ?? '')],
    ['Pitch', String(report.pitch ?? '')],
    ['Notes', String(report.notes ?? '')],
  ]
  return (
    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-xl p-2.5 text-xs" style={{ background: 'var(--surface-2)' }}>
      {rows.filter(([, v]) => v).map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-3">{k}</dt>
          <dd className="whitespace-pre-wrap">{v}</dd>
        </div>
      ))}
    </dl>
  )
}
