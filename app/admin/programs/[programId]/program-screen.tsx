'use client'

import { useCallback, useEffect, useState } from 'react'
import { AppBar, Screen } from '@/components/app-shell'
import { ScreenSkeleton } from '@/components/screen-skeleton'
import { createClient } from '@/lib/supabase/client'
import type { Question } from '@/components/question-field'
import { QuestionsEditor } from './questions-editor'
import { OfferControl, type TrialOffer } from './offer-control'
import { WithdrawPolicy } from './withdraw-policy'
import { OfficialRegoToggle } from './official-rego-toggle'

type Registration = {
  id: string
  status: 'pending' | 'approved' | 'rejected' | 'waitlisted' | 'withdrawn'
  waitlist_position: number | null
  created_at: string
  note: string | null
  decision_note: string | null
  player: { id: string; full_name: string; dob: string | null } | null
}

type Program = {
  id: string
  academy_id: string
  name: string
  kind: string
  status: 'draft' | 'open' | 'closed'
  capacity: number | null
  born_from_year: number | null
  born_to_year: number | null
  team_id: string | null
  closes_at: string | null
  questions: Question[] | null
  withdraw_until: string | null
  refund_bps_after: number
  requires_official_rego: boolean
}

/**
 * The queue.
 *
 * Deliberately the same shape as the join-request queue at /admin/requests,
 * because it is the same job and a coach should not have to learn it twice:
 * a list, who is waiting longest at the top, and one tap per decision.
 *
 * Approving can also put the child straight into a team, and the existing
 * triggers on team_members then add the family to the team channel and the
 * calendar. That is why approval assigns a team rather than doing any of that
 * itself.
 */
export function ProgramScreen({ programId }: { programId: string }) {
  const [program, setProgram] = useState<Program | null>(null)
  const [rows, setRows] = useState<Registration[] | null>(null)
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // R-07: many at once. See registration-queue.tsx for why.
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkTeam, setBulkTeam] = useState('')
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  // R-13: for a trial, the squads a place can be offered in, and the offers made.
  const [squadPrograms, setSquadPrograms] = useState<{ id: string; name: string }[]>([])
  const [offers, setOffers] = useState<TrialOffer[]>([])

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data: p } = await supabase
      .from('programs')
      .select('id, academy_id, name, kind, status, capacity, born_from_year, born_to_year, team_id, closes_at, questions, withdraw_until, refund_bps_after, requires_official_rego')
      .eq('id', programId)
      .maybeSingle()
    if (!p) return setProgram(null)
    setProgram(p as Program)

    const [{ data: regs }, { data: ts }] = await Promise.all([
      supabase
        .from('program_registrations')
        .select('id, status, waitlist_position, created_at, note, decision_note, player:players(id, full_name, dob)')
        .eq('program_id', programId)
        .order('created_at'),
      supabase
        .from('teams')
        .select('id, name')
        .eq('academy_id', (p as Program).academy_id)
        .eq('status', 'active')
        .order('name'),
    ])
    setRows((regs ?? []) as unknown as Registration[])
    setTeams(ts ?? [])

    if ((p as Program).kind === 'trial') {
      const [{ data: squads }, { data: made }] = await Promise.all([
        supabase
          .from('programs')
          .select('id, name')
          .eq('academy_id', (p as Program).academy_id)
          .eq('kind', 'squad')
          .eq('status', 'open')
          .order('name'),
        supabase.rpc('trial_offers', { p_program: programId }),
      ])
      setSquadPrograms(squads ?? [])
      setOffers((made ?? []) as unknown as TrialOffer[])
    }
  }, [programId])

  useEffect(() => {
    // Inside an async call rather than `void load()`, which reads to the
    // linter as setState straight from the effect body — the same shape the
    // other admin screens use.
    ;(async () => {
      await load()
    })()
  }, [load])

  /** One decision. Returns what went wrong, or null. Does not reload. */
  async function decideOne(
    id: string,
    status: Registration['status'],
    teamId?: string
  ): Promise<string | null> {
    const supabase = createClient()
    const { error } = await supabase.from('program_registrations').update({ status }).eq('id', id)
    if (error) return error.message

    if (status === 'approved' && teamId) {
      const row = rows?.find((r) => r.id === id)
      if (row?.player) {
        // Assigning the team is what sets everything else off: the triggers on
        // team_members add the family to the team channel and the calendar.
        const { error: teamError } = await supabase
          .from('players')
          .update({ team_id: teamId })
          .eq('id', row.player.id)
        if (teamError) return `Approved, but could not assign the team: ${teamError.message}`
      }
    }
    return null
  }

  async function decide(id: string, status: Registration['status'], teamId?: string) {
    setBusy(id)
    setError(null)
    const problem = await decideOne(id, status, teamId)
    setBusy(null)
    if (problem) return setError(problem)
    await load()
  }

  function toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  async function bulk(status: 'approved' | 'rejected') {
    const ids = (rows ?? []).filter((r) => r.status === 'pending' && selected.has(r.id))
    if (ids.length === 0) return
    setError(null)
    const failed: string[] = []
    for (let i = 0; i < ids.length; i++) {
      setProgress({ done: i, total: ids.length })
      const problem = await decideOne(ids[i].id, status, bulkTeam || undefined)
      if (problem) failed.push(`${ids[i].player?.full_name ?? 'Unknown'}: ${problem}`)
    }
    setProgress(null)
    setSelected(new Set())
    setSelecting(false)
    if (failed.length) setError(`Could not decide ${failed.length}:\n${failed.join('\n')}`)
    await load()
  }

  async function setStatus(status: Program['status']) {
    if (!program) return
    setBusy('program')
    await createClient().from('programs').update({ status }).eq('id', program.id)
    setBusy(null)
    await load()
  }

  if (program === null && rows === null) return <ScreenSkeleton />
  if (!program) {
    return (
      <>
        <AppBar title="Not found" back="/admin/programs" />
        <Screen>
          <p className="card m-4 p-6 text-center text-sm text-ink-2">
            That program isn&apos;t here any more.
          </p>
        </Screen>
      </>
    )
  }

  const pending = (rows ?? []).filter((r) => r.status === 'pending')
  const approved = (rows ?? []).filter((r) => r.status === 'approved')
  const waitlisted = (rows ?? []).filter((r) => r.status === 'waitlisted')
  const closed = (rows ?? []).filter((r) => ['rejected', 'withdrawn'].includes(r.status))

  return (
    <>
      <AppBar
        title={program.name}
        meta={
          program.capacity
            ? `${approved.length} of ${program.capacity} places`
            : `${approved.length} registered`
        }
        back="/admin/programs"
      />

      <Screen>
        <div className="p-3.5">
          {/* Open and closed are the two states that change what a family can
              do, so they are one tap and not buried in a settings sheet. */}
          <div className="card mb-4 flex items-center gap-3 p-3.5">
            <span className="min-w-0 flex-1 text-sm">
              <b>{program.status === 'open' ? 'Open for registrations' : program.status === 'draft' ? 'Draft — nobody can see it' : 'Closed'}</b>
              {program.closes_at && program.status === 'open' && (
                <span className="block text-ink-3">
                  Closes {new Date(program.closes_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                </span>
              )}
            </span>
            <button
              onClick={() => setStatus(program.status === 'open' ? 'closed' : 'open')}
              disabled={busy === 'program'}
              className="flex-none rounded-xl px-3.5 py-2 text-sm font-semibold"
              style={
                program.status === 'open'
                  ? { background: 'var(--surface-2)', color: 'var(--ink-2)' }
                  : { background: 'var(--brand)', color: '#fff' }
              }
            >
              {program.status === 'open' ? 'Close' : 'Open it'}
            </button>
          </div>

          <QuestionsEditor
            programId={program.id}
            questions={Array.isArray(program.questions) ? program.questions : []}
            onSaved={(questions) => setProgram({ ...program, questions })}
          />

          <WithdrawPolicy
            programId={program.id}
            withdrawUntil={program.withdraw_until}
            refundBpsAfter={program.refund_bps_after ?? 0}
            onSaved={(withdraw_until, refund_bps_after) => setProgram({ ...program, withdraw_until, refund_bps_after })}
          />

          <OfficialRegoToggle
            programId={program.id}
            value={program.requires_official_rego}
            onSaved={(requires_official_rego) => setProgram({ ...program, requires_official_rego })}
          />

          {error && (
            <p className="mb-3.5 rounded-lg p-2.5 text-sm" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>
              {error}
            </p>
          )}

          {pending.length > 1 && (
            <div className="mb-2 flex justify-end px-1">
              <button
                onClick={() => {
                  setSelecting(!selecting)
                  setSelected(new Set())
                  setBulkTeam(program.team_id ?? '')
                }}
                aria-pressed={selecting}
                className="rounded-full border px-3 py-1.5 text-xs font-semibold"
                style={
                  selecting
                    ? { borderColor: 'var(--brand)', background: 'var(--brand-faint)', color: 'var(--brand-text)' }
                    : { borderColor: 'var(--line)', color: 'var(--ink-2)' }
                }
              >
                {selecting ? 'Done' : 'Select'}
              </button>
            </div>
          )}

          {selecting && (
            <div className="card mb-3 p-3">
              <div className="flex items-center gap-2 text-sm">
                <b className="flex-1">
                  {selected.size === 0 ? 'Tick the ones to decide' : `${selected.size} of ${pending.length} selected`}
                </b>
                <button
                  onClick={() =>
                    setSelected(
                      selected.size === pending.length ? new Set() : new Set(pending.map((r) => r.id))
                    )
                  }
                  className="text-xs underline underline-offset-4"
                  style={{ color: 'var(--brand-text)' }}
                >
                  {selected.size === pending.length ? 'None' : 'All'}
                </button>
              </div>
              {selected.size > 0 && (
                <>
                  {teams.length > 0 && (
                    <select
                      value={bulkTeam}
                      onChange={(e) => setBulkTeam(e.target.value)}
                      className="mt-2 w-full rounded-lg border px-3 py-2.5 text-sm"
                      style={{ borderColor: 'var(--line)' }}
                      aria-label="Squad for everyone selected"
                    >
                      <option value="">No team yet</option>
                      {teams.map((t) => (
                        <option key={t.id} value={t.id}>
                          Put them all in {t.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => void bulk('approved')}
                      disabled={progress !== null}
                      className="flex-1 rounded-lg px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                      style={{ background: 'var(--yes)' }}
                    >
                      {progress ? `${progress.done + 1} of ${progress.total}…` : `In — ${selected.size}`}
                    </button>
                    <button
                      onClick={() => void bulk('rejected')}
                      disabled={progress !== null}
                      className="rounded-lg border px-3 py-2.5 text-sm font-semibold disabled:opacity-50"
                      style={{ borderColor: 'var(--no)', color: 'var(--no)' }}
                    >
                      No — {selected.size}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          <Group
            title={pending.length ? `${pending.length} waiting` : 'Nobody waiting'}
            rows={pending}
            pick={selecting ? { selected, toggle } : undefined}
          >
            {(r) =>
              selecting ? null : (
                <Decide
                  row={r}
                  teams={teams}
                  defaultTeam={program.team_id}
                  busy={busy === r.id}
                  onDecide={decide}
                />
              )
            }
          </Group>

          {waitlisted.length > 0 && (
            <Group title="Waitlist" rows={waitlisted} hint="In the order they applied.">
              {(r) => (
                <div className="flex flex-none items-center gap-2">
                  <span className="text-xs tabular-nums text-ink-3">#{r.waitlist_position}</span>
                  <button
                    onClick={() => decide(r.id, 'approved', program.team_id ?? undefined)}
                    disabled={busy === r.id}
                    className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white"
                    style={{ background: 'var(--brand)' }}
                  >
                    Offer a place
                  </button>
                </div>
              )}
            </Group>
          )}

          {approved.length > 0 && (
            <Group
              title={program.kind === 'trial' ? `Trialled — ${approved.length}` : `In — ${approved.length}`}
              rows={approved}
              hint={
                program.kind === 'trial'
                  ? 'Offer each a place in a squad. The family accepts and pays, or declines, or it lapses.'
                  : undefined
              }
            >
              {(r) =>
                program.kind === 'trial' ? (
                  <OfferControl
                    registrationId={r.id}
                    squadPrograms={squadPrograms}
                    existing={offers.find((o) => o.trial_registration_id === r.id)}
                    onMade={load}
                  />
                ) : (
                  <button
                    onClick={() => decide(r.id, 'pending')}
                    disabled={busy === r.id}
                    className="flex-none text-xs underline underline-offset-4 text-ink-3"
                  >
                    Undo
                  </button>
                )
              }
            </Group>
          )}

          {closed.length > 0 && (
            <Group title="Rejected and withdrawn" rows={closed}>
              {(r) => <span className="flex-none text-xs text-ink-3">{r.status}</span>}
            </Group>
          )}
        </div>
      </Screen>
    </>
  )
}

function Group({
  title,
  hint,
  rows,
  pick,
  children,
}: {
  title: string
  hint?: string
  rows: Registration[]
  /** When set, each row carries a checkbox and tapping it toggles. */
  pick?: { selected: Set<string>; toggle: (id: string) => void }
  children: (r: Registration) => React.ReactNode
}) {
  return (
    <section className="mb-5">
      <h2 className="eyebrow px-1 pb-2">{title}</h2>
      {hint && <p className="px-1 pb-2 text-xs text-ink-3">{hint}</p>}
      {rows.length === 0 ? (
        <p className="card p-5 text-center text-sm text-ink-3">Nothing here.</p>
      ) : (
        <ul className="card overflow-hidden">
          {rows.map((r) => (
            <li
              key={r.id}
              className="row justify-between"
              onClick={pick ? () => pick.toggle(r.id) : undefined}
            >
              {pick && (
                <input
                  type="checkbox"
                  aria-label={`Select ${r.player?.full_name ?? 'player'}`}
                  checked={pick.selected.has(r.id)}
                  onChange={() => pick.toggle(r.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="h-5 w-5 flex-none"
                />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {r.player?.full_name ?? 'Unknown player'}
                </span>
                <span className="block truncate text-sm text-ink-3">
                  {[
                    r.player?.dob ? `born ${new Date(r.player.dob).getFullYear()}` : null,
                    `applied ${new Date(r.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                {r.note && <span className="block truncate text-sm text-ink-2">“{r.note}”</span>}
              </span>
              {children(r)}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * One decision, and the team it puts them in.
 *
 * The team picker is on the approve button rather than a separate step,
 * because approving without assigning a team leaves the family approved and
 * still seeing nothing — which is the state the whole approval queue exists
 * to get them out of.
 */
function Decide({
  row,
  teams,
  defaultTeam,
  busy,
  onDecide,
}: {
  row: Registration
  teams: { id: string; name: string }[]
  defaultTeam: string | null
  busy: boolean
  onDecide: (id: string, status: Registration['status'], teamId?: string) => void
}) {
  const [team, setTeam] = useState(defaultTeam ?? '')

  return (
    <div className="flex flex-none items-center gap-1.5">
      {teams.length > 0 && (
        <select
          value={team}
          onChange={(e) => setTeam(e.target.value)}
          className="max-w-[100px] rounded-lg border px-1.5 py-1.5 text-xs"
          style={{ borderColor: 'var(--line)' }}
          aria-label="Team"
        >
          <option value="">No team</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}
      <button
        onClick={() => onDecide(row.id, 'approved', team || undefined)}
        disabled={busy}
        className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        style={{ background: 'var(--yes)' }}
      >
        {busy ? '…' : 'In'}
      </button>
      <button
        onClick={() => onDecide(row.id, 'rejected')}
        disabled={busy}
        className="rounded-lg border px-2.5 py-1.5 text-xs disabled:opacity-50"
        style={{ borderColor: 'var(--line)' }}
      >
        No
      </button>
    </div>
  )
}
