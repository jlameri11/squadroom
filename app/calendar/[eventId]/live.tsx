'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Sheet } from '@/components/sheet'

type Tick = { id: string; kind: string; minute: number | null; note: string | null; at: string; player: string | null; assist: string | null }
type Live = {
  event_id: string
  can_tap: boolean
  opponent: string | null
  window_open: boolean
  over: boolean
  kicked_off: boolean
  kick_off_at: string | null
  finished: boolean
  in_competition: boolean
  score: { ours: number; theirs: number }
  undoable: string | null
  ticks: Tick[]
  players: { id: string; name: string; preferred_name: string | null }[]
}

const ICON: Record<string, string> = { kick_off: '🟢', goal_for: '⚽', goal_against: '⚽', half_time: '⏸', full_time: '🏁', yellow: '🟨', red: '🟥', note: '📣' }

/**
 * X-01: the game, as it happens. The coach taps; every tap is a line in the
 * squad's chat (pushed) and a row in the timeline here; a tap can be undone
 * for a minute. Families see the score and the timeline, refreshed every
 * fifteen seconds while the game is on.
 */
export function LiveScore({ eventId }: { eventId: string }) {
  const [live, setLive] = useState<Live | null | undefined>(undefined)
  const [picking, setPicking] = useState<'goal' | 'yellow' | 'red' | 'note' | 'full_time' | null>(null)
  const [scorer, setScorer] = useState('')
  const [assist, setAssist] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await createClient().rpc('event_live', { p_event: eventId })
    setLive(error ? null : (data as unknown as Live))
  }, [eventId])

  useEffect(() => {
    let live = true
    ;(async () => {
      if (live) await load()
    })()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, 15_000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [load])

  if (!live) return null
  // Taps are offered from half an hour before kick-off until full time —
  // but not on a game that ended hours ago with no ticker at all.
  const on = live.window_open && !live.finished && !(live.over && !live.kicked_off)
  // Nothing to show a family before anything has happened.
  if (!live.can_tap && live.ticks.length === 0) return null
  if (live.can_tap && !on && live.ticks.length === 0) return null

  async function tap(kind: string, extra: { p_player?: string; p_assist?: string; p_note?: string } = {}) {
    setBusy(true)
    setError(null)
    const { data, error } = await createClient().rpc('live_tick', { p_event: eventId, p_kind: kind, ...extra })
    setBusy(false)
    if (error) return setError(error.message)
    setLive(data as unknown as Live)
    setPicking(null)
    setScorer('')
    setAssist('')
    setNote('')
  }
  async function undo() {
    setBusy(true)
    setError(null)
    const { data, error } = await createClient().rpc('undo_last_tick', { p_event: eventId })
    setBusy(false)
    if (error) return setError(error.message)
    setLive(data as unknown as Live)
  }
  const first = (p: { name: string; preferred_name: string | null }) => p.preferred_name || p.name.split(' ')[0]
  const big = 'rounded-xl px-3 py-3 text-sm font-semibold disabled:opacity-50'
  const line = { borderColor: 'var(--line)' }

  return (
    <section className="mt-4" data-live>
      <div className="sect">
        <span className="eyebrow">{live.finished ? 'Full time' : live.kicked_off ? 'Live' : 'Match day'}</span>
        {live.can_tap && live.undoable && (
          <button onClick={undo} disabled={busy} className="text-xs underline underline-offset-2" style={{ color: 'var(--no)' }} data-undo>
            Undo the last one
          </button>
        )}
      </div>
      <div className="card p-3">
        <div className="flex items-center justify-center gap-4" data-live-score>
          <span className="display text-4xl tabular-nums" style={{ color: live.finished ? 'var(--ink)' : 'var(--brand-text)' }}>
            {live.score.ours} – {live.score.theirs}
          </span>
          {live.kicked_off && !live.finished && <span className="rounded-full px-2 py-0.5 text-[0.6875rem] font-bold uppercase tracking-wide text-white" style={{ background: 'var(--no)' }}>Live</span>}
        </div>
        <p className="text-center text-xs text-ink-3">Us v {live.opponent ?? 'the opposition'}</p>

        {live.can_tap && on && (
          <div className="mt-3 grid grid-cols-2 gap-2" data-live-controls>
            {!live.kicked_off ? (
              <button onClick={() => tap('kick_off')} disabled={busy} className={`${big} col-span-2 text-white`} style={{ background: 'var(--yes)' }} data-tap="kick_off">🟢 Kick-off</button>
            ) : (
              <>
                <button onClick={() => setPicking('goal')} disabled={busy} className={`${big} text-white`} style={{ background: 'var(--brand)' }} data-tap="goal_for">+1 Us</button>
                <button onClick={() => tap('goal_against')} disabled={busy} className={`${big} border`} style={line} data-tap="goal_against">+1 Them</button>
                <button onClick={() => tap('half_time')} disabled={busy} className={`${big} border`} style={line} data-tap="half_time">⏸ Half time</button>
                <button onClick={() => setPicking('full_time')} disabled={busy} className={`${big} border`} style={line} data-tap="full_time">🏁 Full time</button>
                <button onClick={() => setPicking('yellow')} disabled={busy} className="rounded-lg border px-2 py-1.5 text-xs" style={line}>🟨 Card</button>
                <button onClick={() => setPicking('note')} disabled={busy} className="rounded-lg border px-2 py-1.5 text-xs" style={line}>📣 A word</button>
              </>
            )}
          </div>
        )}
        {live.can_tap && on && <p className="mt-1.5 text-center text-[0.6875rem] text-ink-3">Every tap goes to the squad&apos;s chat as it happens. A slip can be undone for a minute.</p>}
        {live.in_competition && live.finished && <p className="mt-1.5 text-center text-[0.6875rem] text-ink-3">The official score goes on the match sheet.</p>}
        {error && <p className="mt-2 text-xs" style={{ color: 'var(--no)' }}>{error}</p>}

        {live.ticks.length > 0 && (
          <ol className="mt-3 flex flex-col gap-1 border-t pt-2 text-sm" style={{ borderColor: 'var(--line-2)' }} data-ticker>
            {[...live.ticks].reverse().map((t) => (
              <li key={t.id} className="flex items-start gap-2" data-tick={t.kind}>
                <span className="w-8 flex-none text-right text-xs tabular-nums text-ink-3">{t.minute != null ? `${t.minute}'` : ''}</span>
                <span className="flex-none" aria-hidden>{ICON[t.kind] ?? '•'}</span>
                <span className="min-w-0 flex-1">
                  {t.kind === 'goal_for' && <><b>{t.player ?? 'Goal'}</b>{t.assist && <span className="text-ink-2"> · assist {t.assist}</span>}</>}
                  {t.kind === 'goal_against' && <span>{live.opponent ?? 'They'} score</span>}
                  {t.kind === 'kick_off' && 'Kick-off'}
                  {t.kind === 'half_time' && 'Half time'}
                  {t.kind === 'full_time' && 'Full time'}
                  {(t.kind === 'yellow' || t.kind === 'red') && <>{t.kind === 'yellow' ? 'Yellow' : 'Red'} card{t.player && <> · {t.player}</>}</>}
                  {t.kind === 'note' && (t.note ?? 'A word')}
                  {t.note && t.kind !== 'note' && <span className="block text-xs text-ink-2">{t.note}</span>}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      {picking && (
        <Sheet onClose={() => setPicking(null)}>
          <div className="p-4" data-live-sheet={picking}>
            <span className="eyebrow">{picking === 'goal' ? 'Who scored?' : picking === 'yellow' ? 'A card' : picking === 'note' ? 'From the sideline' : 'Full time?'}</span>
            {picking === 'full_time' ? (
              <>
                <h3 className="display text-lg leading-tight">{live.score.ours} – {live.score.theirs}{live.opponent ? ` v ${live.opponent}` : ''}</h3>
                <p className="mt-1 text-sm text-ink-2">{live.in_competition ? 'Posts full time to the chat. The official score goes on the match sheet.' : 'Posts full time to the chat, writes the result on the game and the goals into the stats.'}</p>
                <div className="mt-4 flex gap-2">
                  <button onClick={() => tap('full_time')} disabled={busy} className="flex-1 rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }} data-confirm-full-time>🏁 Full time</button>
                  <button onClick={() => setPicking(null)} className="rounded-lg border px-3 py-2 text-sm" style={line}>Not yet</button>
                </div>
              </>
            ) : picking === 'note' ? (
              <>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Great spell of pressure. Keeper has been brilliant." className="mt-2 w-full rounded-lg border px-2 py-1.5 text-sm" style={line} />
                <div className="mt-3 flex gap-2">
                  <button onClick={() => tap('note', { p_note: note })} disabled={busy || !note.trim()} className="flex-1 rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }}>Post it</button>
                  <button onClick={() => setPicking(null)} className="rounded-lg border px-3 py-2 text-sm" style={line}>Cancel</button>
                </div>
              </>
            ) : (
              <>
                <div className="mt-2 flex flex-wrap gap-1.5" data-scorer-pick>
                  {live.players.map((p) => (
                    <button key={p.id} onClick={() => setScorer(p.id)} className="rounded-full border px-2.5 py-1 text-sm" style={scorer === p.id ? { background: 'var(--brand)', borderColor: 'var(--brand)', color: '#fff' } : line} data-scorer={p.id}>
                      {first(p)}
                    </button>
                  ))}
                </div>
                {picking === 'goal' && (
                  <label className="mt-3 block text-xs text-ink-2">
                    Assist (optional)
                    <select value={assist} onChange={(e) => setAssist(e.target.value)} className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-sm" style={line} data-assist>
                      <option value="">Nobody / not sure</option>
                      {live.players.filter((p) => p.id !== scorer).map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
                    </select>
                  </label>
                )}
                {picking === 'yellow' && (
                  <div className="mt-3 flex gap-2 text-xs">
                    <button onClick={() => tap('yellow', { p_player: scorer || undefined })} disabled={busy} className="flex-1 rounded-lg border px-3 py-2" style={line}>🟨 Yellow</button>
                    <button onClick={() => tap('red', { p_player: scorer || undefined })} disabled={busy} className="flex-1 rounded-lg border px-3 py-2" style={line}>🟥 Red</button>
                  </div>
                )}
                {picking === 'goal' && (
                  <div className="mt-4 flex gap-2">
                    <button onClick={() => tap('goal_for', { p_player: scorer || undefined, p_assist: assist || undefined })} disabled={busy} className="flex-1 rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }} data-confirm-goal>
                      ⚽ Goal{scorer ? ` — ${first(live.players.find((p) => p.id === scorer)!)}` : ''}
                    </button>
                    <button onClick={() => setPicking(null)} className="rounded-lg border px-3 py-2 text-sm" style={line}>Cancel</button>
                  </div>
                )}
              </>
            )}
          </div>
        </Sheet>
      )}
    </section>
  )
}
