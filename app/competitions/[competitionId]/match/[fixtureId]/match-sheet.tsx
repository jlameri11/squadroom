'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ScreenSkeleton } from '@/components/screen-skeleton'
import { RespectPanel } from '@/components/respect-marks'
import Link from 'next/link'

type SquadPlayer = { player_id: string; number: number | null; name: string; ineligible: string | null }
type SheetPlayer = { player_id: string; number: number | null; starting: boolean; name: string }
type Sheet = {
  status: 'submitted' | 'confirmed' | 'disputed'
  our_score: number | null
  their_score: number | null
  captain_player_id: string | null
  keeper_player_id: string | null
  submitted_at: string
  confirmed_at: string | null
  players: SheetPlayer[]
}
type Correction = {
  id: string; kind: string; detail: string; proposed_home: number | null; proposed_away: number | null
  status: 'open' | 'applied' | 'declined'; requested_by: string | null; created_at: string
  decided_at: string | null; decision_note: string | null
}
type Forfeit = {
  id: string; entry_id: string; entry: string | null; reason: string
  status: 'proposed' | 'club_approved' | 'approved' | 'declined' | 'withdrawn'
  requested_by: string | null; created_at: string; club_note: string | null; league_note: string | null
}
type View = {
  fixture: {
    id: string; division: string; round: string | null; starts_at: string | null; stage: string | null
    status: string; home_score: number | null; away_score: number | null; score_disputed: boolean; notes: string | null
    home_entry_id: string; away_entry_id: string; home: string; away: string
    /** L-17 / L-19 (0187). */
    ended_at: string | null; lock_at: string | null; locked: boolean
    /** L-18 (0190). */
    referee_verified_at: string | null; referee_verified_by: string | null
  }
  can_manage_home: boolean
  can_manage_away: boolean
  is_organiser: boolean
  is_referee: boolean
  may_end: boolean
  may_reopen: boolean
  /** L-22 / L-18 (0190). */
  may_grounds: boolean
  is_club_staff_home: boolean
  is_club_staff_away: boolean
  referee_name: string | null
  can_hand_over: boolean
  rules: { squad_size_max: number | null; match_length_mins: number | null; sheet_lock_mins: number | null } | null
  sheets: { home?: Sheet; away?: Sheet }
  squads: { home: SquadPlayer[]; away: SquadPlayer[] }
  events: { id: string; entry_id: string; player_id: string | null; name: string | null; kind: string; minute: number | null; note: string | null; code?: string | null }[]
  corrections: Correction[]
  forfeits: Forfeit[]
  log: { action: string; detail: Record<string, unknown>; at: string; by: string | null }[]
}

/** L-20: the federation's sanction codes, as a referee writes them. */
const SANCTION_CODES: Record<'yellow' | 'red', [string, string][]> = {
  yellow: [
    ['Y1', 'Unsporting behaviour'], ['Y2', 'Dissent'], ['Y3', 'Persistent infringement'],
    ['Y4', 'Delaying the restart'], ['Y5', 'Not respecting the distance'], ['Y6', 'Entering or leaving without permission'],
  ],
  red: [
    ['R1', 'Serious foul play'], ['R2', 'Violent conduct'], ['R3', 'Spitting'], ['R4', 'Denying a goal by handball'],
    ['R5', 'Denying an obvious goal-scoring opportunity'], ['R6', 'Offensive or insulting language'], ['R7', 'Second caution'], ['R8', 'Other'],
  ],
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })

const KIND_LABEL: Record<string, string> = {
  goal: '⚽ Goal', assist: 'Assist', yellow: '🟨 Yellow', red: '🟥 Red', blue: '🟦 Blue',
  sub_on: 'Sub on', sub_off: 'Sub off', own_goal: 'Own goal',
}

/**
 * The match page. Each side submits its own sheet from its season squad —
 * ineligible players are shown greyed with the reason, and the database
 * refuses a sheet with one on it anyway — the other side confirms it, both
 * sides record events, both sides enter the score. Agreement makes the
 * game final; disagreement makes it disputed and leaves it to the organiser.
 */
export function MatchSheet({ fixtureId, competitionId }: { fixtureId: string; competitionId: string }) {
  const [view, setView] = useState<View | null | undefined>(undefined)
  const [side, setSide] = useState<'home' | 'away'>('home')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await createClient().rpc('match_sheet_view', { p_fixture: fixtureId })
    if (error) {
      setView(null)
      return setError(error.message)
    }
    const v = data as unknown as View
    setView(v)
    // Open on the side this person manages.
    if (v.can_manage_away && !v.can_manage_home) setSide('away')
  }, [fixtureId])

  useEffect(() => {
    ;(async () => {
      await load()
    })()
  }, [load])

  if (view === undefined) return <ScreenSkeleton />
  if (view === null) return <p className="p-6 text-center text-sm" style={{ color: 'var(--no)' }}>{error}</p>

  const f = view.fixture
  const entryId = side === 'home' ? f.home_entry_id : f.away_entry_id
  const ended = Boolean(f.ended_at)
  // L-17: after the lock a manager reads; the referee and the league write.
  const official = view.is_referee || view.is_organiser
  const canManage = (side === 'home' ? view.can_manage_home : view.can_manage_away) && !(f.locked && !official) || (official && !ended)
  const canConfirm = (side === 'home' ? view.can_manage_away : view.can_manage_home) || official
  const sheet = view.sheets[side]
  const squad = view.squads[side]
  const closed = ['final', 'forfeit', 'bye', 'cancelled'].includes(f.status) || ended
  const inside = view.can_manage_home || view.can_manage_away || official

  return (
    <div className="p-3.5">
      <header className="card p-3.5">
        <span className="eyebrow">{[f.division, f.round].filter(Boolean).join(' · ')}</span>
        <h2 className="display mt-0.5 text-xl leading-tight">
          {f.home} <span className="text-ink-3">v</span> {f.away}
        </h2>
        <p className="mt-0.5 text-sm text-ink-3">
          {f.starts_at ? new Date(f.starts_at).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'Not scheduled'}
          {view.rules?.match_length_mins ? ` · ${view.rules.match_length_mins} min` : ''}
        </p>
        {f.status === 'final' && (
          <p className="display mt-2 text-3xl tabular-nums">
            {f.home_score}–{f.away_score}
          </p>
        )}
        {f.score_disputed && (
          <p className="mt-2 rounded-lg p-2.5 text-sm" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>
            The two teams entered different scores. The ladder does not move until the organiser rules.
          </p>
        )}
        {view.is_organiser && f.score_disputed && !ended && <RuleOnScore fixtureId={f.id} onDone={load} />}

        {/* L-17 / L-19: where the game is in its life. */}
        {inside && (
          <p className="mt-2 text-xs" style={{ color: ended ? 'var(--ink-3)' : f.locked ? 'var(--maybe)' : 'var(--ink-3)' }} data-lifecycle>
            {ended
              ? `Ended ${clock(f.ended_at!)} · locked. What is wrong now goes to the league as a correction.`
              : f.locked
                ? `Sheets locked${f.lock_at ? ` at ${clock(f.lock_at)}` : ''} — only the referee or the league can change them now.`
                : f.lock_at
                  ? `Sheets lock at ${clock(f.lock_at)}${view.rules?.sheet_lock_mins != null ? ` (${view.rules.sheet_lock_mins} min before kick-off)` : ''}.`
                  : ''}
          </p>
        )}
        {f.referee_verified_at && (
          <p className="mt-1 text-xs" style={{ color: 'var(--yes)' }} data-verified>
            Verified by the referee{f.referee_verified_by ? ` (${f.referee_verified_by})` : ''} at {clock(f.referee_verified_at)}.
          </p>
        )}
        {(view.may_end || view.may_reopen) && (
          <Lifecycle fixtureId={f.id} mayEnd={view.may_end} mayReopen={view.may_reopen} onDone={load} />
        )}
        {/* L-18: the scorer hands the phone over; the referee confirms on it. */}
        {view.can_hand_over && <Handover fixtureId={f.id} refereeName={view.referee_name} onDone={load} />}

        {/* W-06: the code the referee scans at the ground. */}
        {inside && !closed && (
          <Link href={`/competitions/${competitionId}/match/${f.id}/qr`} className="mt-2 inline-block text-xs underline underline-offset-2 text-ink-3">
            Referee check-in code ›
          </Link>
        )}
      </header>

      <div className="mt-3 flex gap-1.5">
        {(['home', 'away'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSide(s)}
            className="flex-1 rounded-xl px-3 py-2 text-sm font-semibold"
            style={side === s ? { background: 'var(--brand)', color: '#fff' } : { background: 'var(--surface-2)', color: 'var(--ink-2)' }}
          >
            {s === 'home' ? f.home : f.away}
            {view.sheets[s] ? ` · ${view.sheets[s]!.status}` : ''}
          </button>
        ))}
      </div>

      {error && (
        <p className="mt-3 rounded-lg p-2.5 text-sm" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>
          {error}
        </p>
      )}

      <SheetPanel
        key={side + (sheet?.submitted_at ?? '')}
        fixtureId={f.id}
        entryId={entryId}
        sheet={sheet}
        squad={squad}
        canManage={canManage && !closed}
        canConfirm={canConfirm && !closed}
        isOrganiser={view.is_organiser}
        closed={closed}
        squadMax={view.rules?.squad_size_max ?? null}
        onChanged={load}
        onError={setError}
      />

      <EventsPanel
        fixtureId={f.id}
        entryId={entryId}
        sheet={sheet}
        events={view.events.filter((e) => e.entry_id === entryId)}
        canRecord={(canManage || canConfirm || official) && !closed}
        onChanged={load}
        onError={setError}
      />

      {(side === 'home' ? view.can_manage_home : view.can_manage_away) && !closed && (
        <ScorePanel fixtureId={f.id} entryId={entryId} sheet={sheet} onChanged={load} onError={setError} />
      )}

      {/* L-22: a forfeit is asked for, not declared — coach, club, league. */}
      {inside && !ended && ['scheduled', 'postponed', 'forfeit'].includes(f.status) && (
        <ForfeitPanel
          fixtureId={f.id}
          entryId={entryId}
          entryName={side === 'home' ? f.home : f.away}
          forfeits={view.forfeits ?? []}
          canAsk={(side === 'home' ? view.can_manage_home : view.can_manage_away) && f.status !== 'forfeit'}
          canClubDecide={side === 'home' ? view.is_club_staff_home : view.is_club_staff_away}
          canLeagueDecide={view.may_grounds}
          onChanged={load}
          onError={setError}
        />
      )}

      {/* L-19: once the game has ended (or is final), what is wrong is a
          request to the league, with the answer and the reason on record. */}
      {inside && (ended || ['final', 'forfeit'].includes(f.status)) && (
        <CorrectionsPanel
          fixtureId={f.id}
          corrections={view.corrections ?? []}
          canAsk={inside}
          canDecide={view.is_organiser}
          onChanged={load}
          onError={setError}
        />
      )}

      {/* W-01: after the game, the other side marks this team — you are
          looking at the side you do NOT manage. */}
      {['final', 'forfeit'].includes(f.status) && canConfirm && !canManage && (
        <RespectPanel fixtureId={f.id} aboutEntryId={entryId} aboutName={side === 'home' ? f.home : f.away} />
      )}

      {view.log.length > 0 && (
        <section className="mt-4">
          <h3 className="eyebrow px-1 pb-1.5">Record</h3>
          <ul className="card p-3 text-xs text-ink-3">
            {view.log.map((l, i) => (
              <li key={i}>
                {new Date(l.at).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })} · {l.action.replace(/_/g, ' ')}
                {l.by ? ` · ${l.by}` : ''}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function SheetPanel({
  fixtureId, entryId, sheet, squad, canManage, canConfirm, isOrganiser, closed, squadMax, onChanged, onError,
}: {
  fixtureId: string; entryId: string; sheet: Sheet | undefined; squad: SquadPlayer[]
  canManage: boolean; canConfirm: boolean; isOrganiser: boolean; closed: boolean; squadMax: number | null
  onChanged: () => Promise<void>; onError: (m: string | null) => void
}) {
  const [editing, setEditing] = useState(!sheet && canManage)
  const [picked, setPicked] = useState<Set<string>>(new Set((sheet?.players ?? []).map((p) => p.player_id)))
  const [captain, setCaptain] = useState(sheet?.captain_player_id ?? '')
  const [keeper, setKeeper] = useState(sheet?.keeper_player_id ?? '')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    onError(null)
    const players = squad.filter((p) => picked.has(p.player_id)).map((p) => ({ player_id: p.player_id, number: p.number, starting: true }))
    const { error } = await createClient().rpc('submit_match_sheet', {
      p_fixture: fixtureId, p_entry: entryId, p_players: players as never,
      p_captain: captain || undefined, p_keeper: keeper || undefined,
    })
    setBusy(false)
    if (error) return onError(error.message)
    setEditing(false)
    await onChanged()
  }

  async function confirm() {
    setBusy(true)
    onError(null)
    const { error } = await createClient().rpc('confirm_match_sheet', { p_fixture: fixtureId, p_entry: entryId })
    setBusy(false)
    if (error) return onError(error.message)
    await onChanged()
  }

  async function seed() {
    setBusy(true)
    onError(null)
    const { error } = await createClient().rpc('seed_entry_squad', { p_entry: entryId })
    setBusy(false)
    if (error) return onError(error.message)
    await onChanged()
  }

  return (
    <section className="mt-3">
      <div className="flex items-center justify-between px-1 pb-1.5">
        <h3 className="eyebrow">Team sheet{squadMax ? ` · up to ${squadMax}` : ''}</h3>
        {sheet && canManage && !editing && (
          <button onClick={() => setEditing(true)} className="text-xs underline underline-offset-2 text-ink-3">Change</button>
        )}
      </div>

      {editing && canManage ? (
        <div className="card p-3">
          {squad.length === 0 ? (
            <div className="text-sm text-ink-2">
              No season squad yet.
              <button onClick={seed} disabled={busy} className="ml-2 underline underline-offset-2" style={{ color: 'var(--brand-text)' }}>
                Fill it from the club roster
              </button>
            </div>
          ) : (
            <ul className="flex flex-col gap-1">
              {squad.map((p) => (
                <li key={p.player_id}>
                  <label className="flex items-center gap-2 text-sm" style={{ opacity: p.ineligible ? 0.55 : 1 }}>
                    <input
                      type="checkbox"
                      checked={picked.has(p.player_id)}
                      disabled={Boolean(p.ineligible)}
                      onChange={(e) => {
                        const next = new Set(picked)
                        if (e.target.checked) next.add(p.player_id)
                        else next.delete(p.player_id)
                        setPicked(next)
                      }}
                    />
                    <span className="w-7 flex-none tabular-nums text-ink-3">{p.number ?? '—'}</span>
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    {p.ineligible && <span className="flex-none text-xs" style={{ color: 'var(--no)' }}>{p.ineligible.replace(p.name, '').trim()}</span>}
                  </label>
                </li>
              ))}
            </ul>
          )}
          {squad.length > 0 && (
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <label>
                <span className="text-ink-2">Captain</span>
                <select value={captain} onChange={(e) => setCaptain(e.target.value)} className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: 'var(--line)' }}>
                  <option value="">—</option>
                  {squad.filter((p) => picked.has(p.player_id)).map((p) => (<option key={p.player_id} value={p.player_id}>{p.name}</option>))}
                </select>
              </label>
              <label>
                <span className="text-ink-2">Keeper</span>
                <select value={keeper} onChange={(e) => setKeeper(e.target.value)} className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: 'var(--line)' }}>
                  <option value="">—</option>
                  {squad.filter((p) => picked.has(p.player_id)).map((p) => (<option key={p.player_id} value={p.player_id}>{p.name}</option>))}
                </select>
              </label>
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <button onClick={submit} disabled={busy || picked.size === 0} className="flex-1 rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }}>
              {busy ? '…' : `Submit ${picked.size} ${picked.size === 1 ? 'player' : 'players'}`}
            </button>
            {sheet && (
              <button onClick={() => setEditing(false)} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--line)' }}>Cancel</button>
            )}
          </div>
        </div>
      ) : sheet ? (
        <div className="card p-3">
          <ul className="flex flex-col gap-0.5 text-sm">
            {sheet.players.map((p) => (
              <li key={p.player_id} className="flex items-center gap-2">
                <span className="w-7 flex-none tabular-nums text-ink-3">{p.number ?? '—'}</span>
                {/* L-04: the card, for whoever may open it — the family and
                    club always, the league's officials for the season, the
                    opposition on match day. */}
                <a href={`/card/${p.player_id}`} className="min-w-0 flex-1 truncate underline decoration-dotted underline-offset-2">
                  {p.name}
                </a>
                {sheet.captain_player_id === p.player_id && <span className="pill">C</span>}
                {sheet.keeper_player_id === p.player_id && <span className="pill">GK</span>}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs" style={{ color: sheet.status === 'confirmed' ? 'var(--yes)' : sheet.status === 'disputed' ? 'var(--no)' : 'var(--maybe)' }}>
            {sheet.status === 'confirmed'
              ? `Confirmed by the other team${sheet.confirmed_at ? ` at ${new Date(sheet.confirmed_at).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}` : ''}`
              : sheet.status === 'disputed'
                ? 'Score disputed'
                : 'Submitted — waiting for the other team to confirm'}
          </p>
          {sheet.status === 'submitted' && (canConfirm || isOrganiser) && !closed && (
            <button onClick={confirm} disabled={busy} className="mt-2 w-full rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--yes)' }}>
              {busy ? '…' : 'Confirm this is who played'}
            </button>
          )}
        </div>
      ) : (
        <p className="card p-4 text-center text-sm text-ink-3">
          {closed ? 'No sheet was submitted.' : 'Not submitted yet.'}
        </p>
      )}
    </section>
  )
}

function EventsPanel({
  fixtureId, entryId, sheet, events, canRecord, onChanged, onError,
}: {
  fixtureId: string; entryId: string; sheet: Sheet | undefined
  events: View['events']; canRecord: boolean
  onChanged: () => Promise<void>; onError: (m: string | null) => void
}) {
  const [kind, setKind] = useState('goal')
  const [player, setPlayer] = useState('')
  const [minute, setMinute] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  async function add() {
    setBusy(true)
    onError(null)
    const { error } = await createClient().rpc('record_match_event', {
      p_fixture: fixtureId, p_entry: entryId, p_kind: kind as never,
      p_player: player || undefined, p_minute: minute ? Number(minute) : undefined,
      p_code: (kind === 'yellow' || kind === 'red') && code ? code : undefined,
    })
    setBusy(false)
    if (error) return onError(error.message)
    setMinute('')
    setCode('')
    await onChanged()
  }

  return (
    <section className="mt-4">
      <h3 className="eyebrow px-1 pb-1.5">Goals, cards and subs</h3>
      <div className="card p-3">
        {events.length === 0 ? (
          <p className="text-sm text-ink-3">Nothing recorded.</p>
        ) : (
          <ul className="flex flex-col gap-0.5 text-sm">
            {events.map((e) => (
              <li key={e.id} className="flex items-center gap-2">
                <span className="w-8 flex-none tabular-nums text-ink-3">{e.minute != null ? `${e.minute}'` : ''}</span>
                <span className="flex-none">{KIND_LABEL[e.kind] ?? e.kind}{e.code ? ` ${e.code}` : ''}</span>
                <span className="min-w-0 flex-1 truncate">{e.name ?? ''}</span>
              </li>
            ))}
          </ul>
        )}
        {canRecord && sheet && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded-lg border px-2 py-1.5 text-xs" style={{ borderColor: 'var(--line)' }} aria-label="Event">
              {Object.entries(KIND_LABEL).map(([k, l]) => (<option key={k} value={k}>{l}</option>))}
            </select>
            <select value={player} onChange={(e) => setPlayer(e.target.value)} className="min-w-0 flex-1 rounded-lg border px-2 py-1.5 text-xs" style={{ borderColor: 'var(--line)' }} aria-label="Player">
              <option value="">Player…</option>
              {sheet.players.map((p) => (<option key={p.player_id} value={p.player_id}>{p.number != null ? `${p.number} ` : ''}{p.name}</option>))}
            </select>
            <input value={minute} onChange={(e) => setMinute(e.target.value)} inputMode="numeric" placeholder="min" className="w-14 rounded-lg border px-2 py-1.5 text-xs tabular-nums" style={{ borderColor: 'var(--line)' }} aria-label="Minute" />
            {(kind === 'yellow' || kind === 'red') && (
              <select value={code} onChange={(e) => setCode(e.target.value)} className="min-w-0 flex-1 rounded-lg border px-2 py-1.5 text-xs" style={{ borderColor: 'var(--line)' }} aria-label="Sanction code">
                <option value="">Code…</option>
                {SANCTION_CODES[kind].map(([c, l]) => (<option key={c} value={c}>{c} · {l}</option>))}
              </select>
            )}
            <button onClick={add} disabled={busy} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }}>
              {busy ? '…' : 'Add'}
            </button>
          </div>
        )}
        {canRecord && !sheet && <p className="mt-2 text-xs text-ink-3">Submit the sheet first — events are recorded against players on it.</p>}
      </div>
    </section>
  )
}

function ScorePanel({
  fixtureId, entryId, sheet, onChanged, onError,
}: {
  fixtureId: string; entryId: string; sheet: Sheet | undefined
  onChanged: () => Promise<void>; onError: (m: string | null) => void
}) {
  const [ours, setOurs] = useState(sheet?.our_score?.toString() ?? '')
  const [theirs, setTheirs] = useState(sheet?.their_score?.toString() ?? '')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  async function enter() {
    setBusy(true)
    onError(null)
    const { data, error } = await createClient().rpc('enter_sheet_score', {
      p_fixture: fixtureId, p_entry: entryId, p_ours: Number(ours), p_theirs: Number(theirs),
    })
    setBusy(false)
    if (error) return onError(error.message)
    const r = data as unknown as { state: string }
    setResult(r.state === 'final' ? 'Both teams agree — the game is final.' : r.state === 'disputed' ? 'The other team entered a different score. The organiser will rule.' : 'Recorded. Waiting for the other team.')
    await onChanged()
  }

  return (
    <section className="mt-4">
      <h3 className="eyebrow px-1 pb-1.5">Score, as your team saw it</h3>
      <div className="card p-3">
        <div className="flex items-center gap-2">
          <label className="flex-1 text-xs">
            <span className="text-ink-2">Us</span>
            <input value={ours} onChange={(e) => setOurs(e.target.value)} inputMode="numeric" className="mt-0.5 w-full rounded-lg border px-2 py-2 text-center text-lg tabular-nums" style={{ borderColor: 'var(--line)' }} aria-label="Our score" />
          </label>
          <span className="pt-4 text-ink-3">–</span>
          <label className="flex-1 text-xs">
            <span className="text-ink-2">Them</span>
            <input value={theirs} onChange={(e) => setTheirs(e.target.value)} inputMode="numeric" className="mt-0.5 w-full rounded-lg border px-2 py-2 text-center text-lg tabular-nums" style={{ borderColor: 'var(--line)' }} aria-label="Their score" />
          </label>
          <button onClick={enter} disabled={busy || ours === '' || theirs === ''} className="mt-4 rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }}>
            {busy ? '…' : 'Enter'}
          </button>
        </div>
        <p className="mt-2 text-xs text-ink-3">
          {result ?? 'The other team enters theirs too. If the two agree the game is final; if not, the organiser rules — never an average.'}
        </p>
      </div>
    </section>
  )
}

/** L-19: end the game (referee or league) or reopen it (league, with a reason). */
function Lifecycle({ fixtureId, mayEnd, mayReopen, onDone }: { fixtureId: string; mayEnd: boolean; mayReopen: boolean; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [reopening, setReopening] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function end() {
    setBusy(true)
    setError(null)
    const { error } = await createClient().rpc('end_match', { p_fixture: fixtureId })
    setBusy(false)
    if (error) return setError(error.message)
    await onDone()
  }
  async function reopen() {
    setBusy(true)
    setError(null)
    const { error } = await createClient().rpc('reopen_match', { p_fixture: fixtureId, p_note: note })
    setBusy(false)
    if (error) return setError(error.message)
    setReopening(false)
    setNote('')
    await onDone()
  }

  return (
    <div className="mt-2">
      {mayEnd && (
        <button onClick={end} disabled={busy} className="w-full rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }} data-end-match>
          {busy ? '…' : 'End the match — lock the sheets and the score'}
        </button>
      )}
      {mayReopen && !reopening && (
        <button onClick={() => setReopening(true)} className="text-xs underline underline-offset-2 text-ink-3">
          Reopen for a change
        </button>
      )}
      {mayReopen && reopening && (
        <div className="flex gap-2">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why — this goes on the record" className="min-w-0 flex-1 rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: 'var(--line)' }} />
          <button onClick={reopen} disabled={busy || !note.trim()} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" style={{ background: 'var(--maybe)' }}>Reopen</button>
          <button onClick={() => setReopening(false)} className="rounded-lg border px-2 py-1.5 text-xs" style={{ borderColor: 'var(--line)' }}>Cancel</button>
        </div>
      )}
      {error && <p className="mt-1.5 text-xs" style={{ color: 'var(--no)' }}>{error}</p>}
    </div>
  )
}

/** L-18: the scorer's phone, in the referee's hands. */
function Handover({ fixtureId, refereeName, onDone }: { fixtureId: string; refereeName: string | null; onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [phone, setPhone] = useState('')
  const [word, setWord] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function verify() {
    setBusy(true)
    setError(null)
    const { data, error } = await createClient().rpc('referee_verify_by_phone', { p_fixture: fixtureId, p_phone: phone, p_word: word })
    setBusy(false)
    if (error) return setError(error.message)
    const r = data as unknown as { ok: boolean; reason?: string; tries_left?: number }
    if (!r?.ok) return setError(`${r?.reason ?? 'Not verified.'}${r?.tries_left != null ? ` ${r.tries_left} ${r.tries_left === 1 ? 'try' : 'tries'} left.` : ''}`)
    setOpen(false)
    await onDone()
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-2 w-full rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: 'var(--brand)', color: 'var(--brand-text)' }} data-handover>
        Hand your phone to the referee
      </button>
    )
  }
  return (
    <div className="mt-2 rounded-lg border p-2.5" style={{ borderColor: 'var(--brand)' }} data-handover>
      <p className="text-xs font-semibold">For the referee{refereeName ? ` — ${refereeName}` : ''}</p>
      <p className="mt-0.5 text-xs text-ink-3">Check the sheets, the events and the score above. Then your mobile number, and the word Confirm. That ends the game in your name.</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="Your mobile" className="min-w-0 flex-1 rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: 'var(--line)' }} aria-label="Referee's mobile" />
        <input value={word} onChange={(e) => setWord(e.target.value)} placeholder="Confirm" className="w-24 rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: 'var(--line)' }} aria-label="Type Confirm" />
        <button onClick={verify} disabled={busy || !phone.trim() || !word.trim()} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }}>Verify</button>
        <button onClick={() => setOpen(false)} className="rounded-lg border px-2 py-1.5 text-xs" style={{ borderColor: 'var(--line)' }}>Cancel</button>
      </div>
      {error && <p className="mt-1.5 text-xs" style={{ color: 'var(--no)' }}>{error}</p>}
    </div>
  )
}

const FORFEIT_STATUS: Record<Forfeit['status'], string> = {
  proposed: 'Waiting for the club', club_approved: 'Club agrees — the league decides', approved: 'Forfeit', declined: 'Declined — play the game', withdrawn: 'Withdrawn',
}

/** L-22: a forfeit is asked for by the coach, approved by the club, decided by the league. */
function ForfeitPanel({ fixtureId, entryId, entryName, forfeits, canAsk, canClubDecide, canLeagueDecide, onChanged, onError }: {
  fixtureId: string; entryId: string; entryName: string; forfeits: Forfeit[]
  canAsk: boolean; canClubDecide: boolean; canLeagueDecide: boolean
  onChanged: () => Promise<void>; onError: (m: string | null) => void
}) {
  const [asking, setAsking] = useState(false)
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const mine = forfeits.filter((r) => r.entry_id === entryId)
  const open = mine.find((r) => r.status === 'proposed' || r.status === 'club_approved')

  async function call(fn: 'request_forfeit' | 'club_decide_forfeit' | 'league_decide_forfeit' | 'withdraw_forfeit_request', args: Record<string, unknown>) {
    setBusy(true)
    onError(null)
    const { error } = await createClient().rpc(fn, args as never)
    setBusy(false)
    if (error) return onError(error.message)
    setAsking(false)
    setReason('')
    setNote('')
    await onChanged()
  }

  if (mine.length === 0 && !canAsk) return null
  return (
    <section className="mt-4" data-forfeits>
      <div className="flex items-center justify-between px-1 pb-1.5">
        <h3 className="eyebrow">Forfeit</h3>
        {canAsk && !open && !asking && (
          <button onClick={() => setAsking(true)} className="text-xs underline underline-offset-2" style={{ color: 'var(--no)' }}>
            We can&apos;t field a team
          </button>
        )}
      </div>
      {asking && (
        <div className="card mb-2 p-3">
          <p className="text-xs text-ink-3">{entryName} ask to forfeit. The club approves, then the league decides; only then does the forfeit score apply.</p>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Why" className="mt-2 w-full rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: 'var(--line)' }} />
          <div className="mt-2 flex gap-2">
            <button onClick={() => call('request_forfeit', { p_fixture: fixtureId, p_entry: entryId, p_reason: reason })} disabled={busy || !reason.trim()} className="flex-1 rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--no)' }}>
              {busy ? '…' : 'Ask to forfeit'}
            </button>
            <button onClick={() => setAsking(false)} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--line)' }}>Cancel</button>
          </div>
        </div>
      )}
      {mine.length > 0 && (
        <ul className="card divide-y" style={{ borderColor: 'var(--line-2)' }}>
          {mine.map((r) => (
            <li key={r.id} className="p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{r.entry ?? entryName}</span>
                <span className="pill" style={r.status === 'approved' ? { background: 'var(--no-bg)', color: 'var(--no)' } : r.status === 'declined' ? { background: 'var(--yes-bg)', color: 'var(--yes)' } : undefined}>
                  {FORFEIT_STATUS[r.status]}
                </span>
              </div>
              <p className="mt-0.5 text-ink-2">{r.reason}</p>
              <p className="mt-0.5 text-xs text-ink-3">
                {r.requested_by ?? 'Somebody'} · {new Date(r.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                {r.club_note ? ` · club: ${r.club_note}` : ''}{r.league_note ? ` · league: ${r.league_note}` : ''}
              </p>
              {(r.status === 'proposed' || r.status === 'club_approved') && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {((r.status === 'proposed' && canClubDecide) || (r.status === 'club_approved' && canLeagueDecide) || (r.status === 'proposed' && canLeagueDecide)) && (
                    <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="note" className="min-w-0 flex-1 rounded-lg border px-2 py-1.5 text-xs" style={{ borderColor: 'var(--line)' }} />
                  )}
                  {r.status === 'proposed' && canClubDecide && (
                    <>
                      <button onClick={() => call('club_decide_forfeit', { p_request: r.id, p_approve: true, p_note: note || undefined })} disabled={busy} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }}>Club: approve</button>
                      <button onClick={() => call('club_decide_forfeit', { p_request: r.id, p_approve: false, p_note: note || undefined })} disabled={busy} className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" style={{ borderColor: 'var(--line)' }}>Play the game</button>
                    </>
                  )}
                  {canLeagueDecide && (
                    <>
                      <button onClick={() => call('league_decide_forfeit', { p_request: r.id, p_approve: true, p_note: note || undefined })} disabled={busy} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" style={{ background: 'var(--no)' }}>League: forfeit</button>
                      <button onClick={() => call('league_decide_forfeit', { p_request: r.id, p_approve: false, p_note: note || undefined })} disabled={busy} className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" style={{ borderColor: 'var(--line)' }}>League: play it</button>
                    </>
                  )}
                  {canAsk && (
                    <button onClick={() => call('withdraw_forfeit_request', { p_request: r.id })} disabled={busy} className="text-xs underline underline-offset-2 text-ink-3">Withdraw</button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

const CORRECTION_KIND: Record<string, string> = { score: 'The score', event: 'A goal or card', sheet: 'The team sheet', other: 'Something else' }

/** L-19: corrections after the end — asked by a team, the referee or the league; decided by the league. */
function CorrectionsPanel({ fixtureId, corrections, canAsk, canDecide, onChanged, onError }: {
  fixtureId: string; corrections: Correction[]; canAsk: boolean; canDecide: boolean
  onChanged: () => Promise<void>; onError: (m: string | null) => void
}) {
  const [asking, setAsking] = useState(false)
  const [kind, setKind] = useState('score')
  const [detail, setDetail] = useState('')
  const [home, setHome] = useState('')
  const [away, setAway] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function ask() {
    setBusy(true)
    onError(null)
    const { error } = await createClient().rpc('request_match_correction', {
      p_fixture: fixtureId, p_kind: kind, p_detail: detail,
      p_home: kind === 'score' && home !== '' ? Number(home) : undefined,
      p_away: kind === 'score' && away !== '' ? Number(away) : undefined,
    })
    setBusy(false)
    if (error) return onError(error.message)
    setAsking(false)
    setDetail('')
    setHome('')
    setAway('')
    await onChanged()
  }
  async function decide(id: string, apply: boolean) {
    setBusy(true)
    onError(null)
    const { error } = await createClient().rpc('decide_match_correction', { p_correction: id, p_apply: apply, p_note: note || undefined })
    setBusy(false)
    if (error) return onError(error.message)
    setNote('')
    await onChanged()
  }

  return (
    <section className="mt-4" data-corrections>
      <div className="flex items-center justify-between px-1 pb-1.5">
        <h3 className="eyebrow">Corrections</h3>
        {canAsk && !asking && (
          <button onClick={() => setAsking(true)} className="text-xs underline underline-offset-2" style={{ color: 'var(--brand-text)' }}>
            Ask for a correction
          </button>
        )}
      </div>
      {asking && (
        <div className="card mb-2 p-3">
          <div className="flex flex-wrap gap-1.5">
            <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded-lg border px-2 py-1.5 text-xs" style={{ borderColor: 'var(--line)' }} aria-label="What is wrong">
              {Object.entries(CORRECTION_KIND).map(([k, l]) => (<option key={k} value={k}>{l}</option>))}
            </select>
            {kind === 'score' && (
              <>
                <input value={home} onChange={(e) => setHome(e.target.value)} inputMode="numeric" placeholder="home" className="w-16 rounded-lg border px-2 py-1.5 text-center text-xs tabular-nums" style={{ borderColor: 'var(--line)' }} aria-label="Home score" />
                <input value={away} onChange={(e) => setAway(e.target.value)} inputMode="numeric" placeholder="away" className="w-16 rounded-lg border px-2 py-1.5 text-center text-xs tabular-nums" style={{ borderColor: 'var(--line)' }} aria-label="Away score" />
              </>
            )}
          </div>
          <textarea value={detail} onChange={(e) => setDetail(e.target.value)} rows={2} placeholder="What is wrong, and how you know" className="mt-2 w-full rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: 'var(--line)' }} />
          <div className="mt-2 flex gap-2">
            <button onClick={ask} disabled={busy || !detail.trim() || (kind === 'score' && (home === '' || away === ''))} className="flex-1 rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }}>
              {busy ? '…' : 'Send to the league'}
            </button>
            <button onClick={() => setAsking(false)} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--line)' }}>Cancel</button>
          </div>
        </div>
      )}
      {corrections.length === 0 ? (
        <p className="card p-4 text-center text-sm text-ink-3">Nothing asked for.</p>
      ) : (
        <ul className="card divide-y" style={{ borderColor: 'var(--line-2)' }}>
          {corrections.map((c) => (
            <li key={c.id} className="p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  {CORRECTION_KIND[c.kind] ?? c.kind}
                  {c.kind === 'score' && c.proposed_home != null ? ` → ${c.proposed_home}–${c.proposed_away}` : ''}
                </span>
                <span className="pill" style={c.status === 'open' ? { background: 'var(--maybe-bg)', color: 'var(--maybe)' } : c.status === 'applied' ? { background: 'var(--yes-bg)', color: 'var(--yes)' } : undefined}>
                  {c.status}
                </span>
              </div>
              <p className="mt-0.5 text-ink-2">{c.detail}</p>
              <p className="mt-0.5 text-xs text-ink-3">
                {c.requested_by ?? 'Somebody'} · {new Date(c.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                {c.decision_note ? ` · ${c.decision_note}` : ''}
              </p>
              {canDecide && c.status === 'open' && (
                <div className="mt-2 flex gap-2">
                  <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="note" className="min-w-0 flex-1 rounded-lg border px-2 py-1.5 text-xs" style={{ borderColor: 'var(--line)' }} />
                  <button onClick={() => decide(c.id, true)} disabled={busy} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" style={{ background: 'var(--yes)' }}>
                    {c.kind === 'score' ? 'Apply' : 'Reopen to fix'}
                  </button>
                  <button onClick={() => decide(c.id, false)} disabled={busy} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" style={{ background: 'var(--no)' }}>Decline</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function RuleOnScore({ fixtureId, onDone }: { fixtureId: string; onDone: () => Promise<void> }) {
  const [home, setHome] = useState('')
  const [away, setAway] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function rule() {
    setBusy(true)
    setError(null)
    const { error } = await createClient().rpc('rule_on_score', { p_fixture: fixtureId, p_home: Number(home), p_away: Number(away), p_note: note || undefined })
    setBusy(false)
    if (error) return setError(error.message)
    await onDone()
  }
  return (
    <div className="mt-2 rounded-lg border p-2.5" style={{ borderColor: 'var(--line)' }}>
      <p className="text-xs font-semibold">Organiser&apos;s ruling</p>
      <div className="mt-1.5 flex items-center gap-2">
        <input value={home} onChange={(e) => setHome(e.target.value)} inputMode="numeric" placeholder="home" className="w-16 rounded-lg border px-2 py-1.5 text-center tabular-nums" style={{ borderColor: 'var(--line)' }} aria-label="Home score" />
        <span className="text-ink-3">–</span>
        <input value={away} onChange={(e) => setAway(e.target.value)} inputMode="numeric" placeholder="away" className="w-16 rounded-lg border px-2 py-1.5 text-center tabular-nums" style={{ borderColor: 'var(--line)' }} aria-label="Away score" />
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="why" className="min-w-0 flex-1 rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: 'var(--line)' }} />
        <button onClick={rule} disabled={busy || home === '' || away === ''} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }}>Rule</button>
      </div>
      {error && <p className="mt-1.5 text-xs" style={{ color: 'var(--no)' }}>{error}</p>}
    </div>
  )
}
