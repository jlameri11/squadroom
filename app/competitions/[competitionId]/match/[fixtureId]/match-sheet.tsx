'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ScreenSkeleton } from '@/components/screen-skeleton'

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
type View = {
  fixture: {
    id: string; division: string; round: string | null; starts_at: string | null
    status: string; home_score: number | null; away_score: number | null; score_disputed: boolean; notes: string | null
    home_entry_id: string; away_entry_id: string; home: string; away: string
  }
  can_manage_home: boolean
  can_manage_away: boolean
  is_organiser: boolean
  rules: { squad_size_max: number | null; match_length_mins: number | null } | null
  sheets: { home?: Sheet; away?: Sheet }
  squads: { home: SquadPlayer[]; away: SquadPlayer[] }
  events: { id: string; entry_id: string; player_id: string | null; name: string | null; kind: string; minute: number | null; note: string | null }[]
  log: { action: string; detail: Record<string, unknown>; at: string; by: string | null }[]
}

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
export function MatchSheet({ fixtureId }: { fixtureId: string }) {
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
  const canManage = side === 'home' ? view.can_manage_home : view.can_manage_away
  const canConfirm = side === 'home' ? view.can_manage_away : view.can_manage_home
  const sheet = view.sheets[side]
  const squad = view.squads[side]
  const closed = ['final', 'forfeit', 'bye', 'cancelled'].includes(f.status)

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
        {view.is_organiser && f.score_disputed && <RuleOnScore fixtureId={f.id} onDone={load} />}
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
        canRecord={(canManage || canConfirm || view.is_organiser) && !closed}
        onChanged={load}
        onError={setError}
      />

      {canManage && !closed && (
        <ScorePanel fixtureId={f.id} entryId={entryId} sheet={sheet} onChanged={load} onError={setError} />
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
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
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
  const [busy, setBusy] = useState(false)

  async function add() {
    setBusy(true)
    onError(null)
    const { error } = await createClient().rpc('record_match_event', {
      p_fixture: fixtureId, p_entry: entryId, p_kind: kind as never,
      p_player: player || undefined, p_minute: minute ? Number(minute) : undefined,
    })
    setBusy(false)
    if (error) return onError(error.message)
    setMinute('')
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
                <span className="flex-none">{KIND_LABEL[e.kind] ?? e.kind}</span>
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
