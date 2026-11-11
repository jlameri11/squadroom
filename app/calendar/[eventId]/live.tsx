'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Sheet } from '@/components/sheet'
import { sendNow, sendOrQueue } from '@/lib/offline/use-outbox'
import { forgetKickOff, phoneKickOff, rememberKickOff } from '@/lib/offline/kick-off'
import { useWaitingTaps, withWaiting } from './waiting-taps'

type Tick = { id: string; kind: string; minute: number | null; note: string | null; at: string; player: string | null; assist: string | null; waiting?: boolean }
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
  /** 0218: live_tick takes a tap's own id and a kick-off's time. Absent before it. */
  taps_have_ids?: boolean
}

const ICON: Record<string, string> = { kick_off: '🟢', goal_for: '⚽', goal_against: '⚽', half_time: '⏸', full_time: '🏁', yellow: '🟨', red: '🟥', note: '📣' }
const first = (p: { name: string; preferred_name: string | null }) => p.preferred_name || p.name.split(' ')[0]

/**
 * X-01: the game, as it happens. The coach taps; every tap is a line in the
 * squad's chat (pushed) and a row in the timeline here; a tap can be undone
 * for a minute. Families see the score and the timeline, refreshed every
 * fifteen seconds while the game is on.
 *
 * WITH NO SIGNAL (X-09, 5 Nov 2026). A ground is where phones lose their
 * bars, and a goal tapped into nothing used to be a goal lost. Every tap now
 * goes through the outbox: with signal it is sent at once; without, it is
 * kept on the phone, the score and the timeline move straight away (marked
 * "waiting for signal"), and it is sent, in order, the moment signal is back.
 *
 *   · The minute is worked out when the coach taps — the database's sum, from
 *     the kick-off this phone saw — so a goal sent ten minutes late still
 *     says 12'.
 *   · Undo on a tap that is still waiting takes it off the phone: the slip
 *     never reaches the chat. Undo on a tap already sent goes to the database
 *     straight away or not at all, because it only has its minute.
 *   · A refresh that fails keeps the game on screen. Until this, one failed
 *     fifteen-second refresh with no signal blanked the panel and took the
 *     coach's buttons with it.
 */
export function LiveScore({ eventId }: { eventId: string }) {
  const [live, setLive] = useState<Live | null | undefined>(undefined)
  const [picking, setPicking] = useState<'goal' | 'yellow' | 'red' | 'note' | 'full_time' | null>(null)
  const [scorer, setScorer] = useState('')
  const [assist, setAssist] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The game from the database; nothing to ask with no signal.
  const read = useCallback(async (): Promise<Live | null> => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return null
    const { data, error } = await createClient().rpc('event_live', { p_event: eventId })
    return error ? null : (data as unknown as Live)
  }, [eventId])
  // Asked again: an answer replaces the game, a failure leaves it as it was.
  const reread = useCallback(async () => {
    const l = await read()
    if (l) setLive(l)
  }, [read])

  useEffect(() => {
    let on = true
    ;(async () => {
      const l = await read()
      if (on) setLive((was) => l ?? (was === undefined ? null : was))
    })()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void reread()
    }, 15_000)
    return () => {
      on = false
      clearInterval(timer)
    }
  }, [read, reread])

  // Taps still on this phone, read from the outbox (waiting-taps.ts).
  const { taps, waiting, takeBack } = useWaitingTaps(eventId, reread)

  if (!live) return null
  // The game as the coach sees it: the database's, plus the taps still on
  // this phone.
  const shown = withWaiting(live, taps)
  const kickedOff = shown.kicked_off
  const finished = shown.finished
  // 0251: MiniRoos keep no score — the database sends null; the goals are still cheered.
  const score = (shown.score ?? null) as { ours: number; theirs: number } | null
  // Full names, as the database's ticker gives them, so a tap does not
  // change its name when the signal comes back.
  const nameOf = (id: string | null) => (id ? live.players.find((x) => x.id === id)?.name ?? null : null)
  const ticks: Tick[] = [
    ...live.ticks,
    ...taps.map((t) => ({ id: t.queueId, kind: t.kind, minute: t.minute, note: t.note, at: new Date(t.at).toISOString(), player: nameOf(t.player), assist: nameOf(t.assist), waiting: true })),
  ]
  // Taps are offered from half an hour before kick-off until full time —
  // but not on a game that ended hours ago with no ticker at all.
  const on = live.window_open && !finished && !(live.over && !kickedOff)
  // Nothing to show a family before anything has happened.
  if (!live.can_tap && ticks.length === 0) return null
  if (live.can_tap && !on && ticks.length === 0) return null

  // The minute as the database works it out — from kick-off — taken at the
  // tap, so a tap that waits for signal keeps it. From the kick-off THIS
  // phone saw when it has one (lib/offline/kick-off.ts).
  const minuteNow = () => {
    const ko =
      phoneKickOff(eventId) ??
      (live.kick_off_at ? new Date(live.kick_off_at).getTime() : null) ??
      taps.find((t) => t.kind === 'kick_off')?.at ??
      null
    if (!ko) return null
    return Math.max(0, Math.min(130, Math.floor((Date.now() - ko) / 60000)))
  }

  async function tap(kind: string, extra: { p_player?: string; p_assist?: string; p_note?: string } = {}) {
    setBusy(true)
    setError(null)
    const minute = kind === 'kick_off' ? null : minuteNow()
    const tappedAt = Date.now()
    if (kind === 'kick_off') rememberKickOff(eventId, tappedAt)
    // 0218: an id made here, so a tap sent twice (its answer lost to the
    // signal) is counted once; and a kick-off's own time, so the clock starts
    // when the whistle went. Only when the database says it takes them.
    const once = live?.taps_have_ids
      ? { p_client_id: crypto.randomUUID(), ...(kind === 'kick_off' ? { p_at: new Date(tappedAt).toISOString() } : {}) }
      : {}
    const args = { p_event: eventId, p_kind: kind, ...extra, ...(minute !== null ? { p_minute: minute } : {}), ...once }
    const outcome = await sendOrQueue({ kind: 'rpc', fn: 'live_tick', args })
    setBusy(false)
    if (outcome.status === 'refused') {
      if (kind === 'kick_off') forgetKickOff(eventId)
      return setError(outcome.error)
    }
    // Queued: the outbox shows it (useWaitingTaps). Sent: read the game back.
    if (outcome.status === 'sent') await reread()
    setPicking(null)
    setScorer('')
    setAssist('')
    setNote('')
  }

  async function undo() {
    setBusy(true)
    setError(null)
    // Still on the phone: taken off it, and it never reaches anybody.
    const last = waiting.at(-1)
    if (last && (await takeBack(last.queueId))) {
      if (last.kind === 'kick_off') forgetKickOff(eventId)
      setBusy(false)
      return
    }
    // In the database: undone there now, or not at all — it has a minute.
    const lastSent = live?.ticks.at(-1)
    const result = await sendNow({ kind: 'rpc', fn: 'undo_last_tick', args: { p_event: eventId } })
    setBusy(false)
    if (!result.ok) {
      return setError(
        result.retry
          ? 'No signal, so that undo did not go. If the tap was wrong, add a word once the signal is back.'
          : result.error
      )
    }
    if (lastSent?.kind === 'kick_off') forgetKickOff(eventId)
    await reread()
  }
  const big = 'rounded-xl px-3 py-3 text-sm font-semibold disabled:opacity-50'
  const line = { borderColor: 'var(--line)' }

  return (
    <section className="mt-4" data-live>
      <div className="sect">
        <span className="eyebrow">{finished ? 'Full time' : kickedOff ? 'Live' : 'Match day'}</span>
        {live.can_tap && (live.undoable || waiting.length > 0) && (
          <button onClick={undo} disabled={busy} className="text-xs underline underline-offset-2" style={{ color: 'var(--no)' }} data-undo>
            Undo the last one
          </button>
        )}
      </div>
      <div className="card p-3">
        <div className="flex items-center justify-center gap-4" data-live-score>
          <span className="display text-4xl tabular-nums" style={{ color: finished ? 'var(--ink)' : 'var(--brand-text)' }}>
            {score ? `${score.ours} – ${score.theirs}` : 'No score kept'}
          </span>
          {kickedOff && !finished && <span className="rounded-full px-2 py-0.5 text-[0.6875rem] font-bold uppercase tracking-wide text-no-ink" style={{ background: 'var(--no)' }}>Live</span>}
        </div>
        <p className="text-center text-xs text-ink-3">Us v {live.opponent ?? 'the opposition'}</p>

        {live.can_tap && on && (
          <div className="mt-3 grid grid-cols-2 gap-2" data-live-controls>
            {!kickedOff ? (
              <button onClick={() => tap('kick_off')} disabled={busy} className={`${big} col-span-2 text-yes-ink`} style={{ background: 'var(--yes)' }} data-tap="kick_off">🟢 Kick-off</button>
            ) : (
              <>
                <button onClick={() => setPicking('goal')} disabled={busy} className={`${big} text-brand-ink`} style={{ background: 'var(--brand)' }} data-tap="goal_for">+1 Us</button>
                <button onClick={() => tap('goal_against')} disabled={busy} className={`${big} border`} style={line} data-tap="goal_against">+1 Them</button>
                <button onClick={() => tap('half_time')} disabled={busy} className={`${big} border`} style={line} data-tap="half_time">⏸ Half time</button>
                <button onClick={() => setPicking('full_time')} disabled={busy} className={`${big} border`} style={line} data-tap="full_time">🏁 Full time</button>
                <button onClick={() => setPicking('yellow')} disabled={busy} className="rounded-lg border px-2 py-1.5 text-xs" style={line}>🟨 Card</button>
                <button onClick={() => setPicking('note')} disabled={busy} className="rounded-lg border px-2 py-1.5 text-xs" style={line}>📣 A word</button>
              </>
            )}
          </div>
        )}
        {live.can_tap && on && waiting.length === 0 && <p className="mt-1.5 text-center text-[0.6875rem] text-ink-3">Every tap goes to the squad&apos;s chat as it happens. A slip can be undone for a minute.</p>}
        {waiting.length > 0 && (
          <p className="mt-1.5 rounded-lg px-2 py-1.5 text-center text-xs font-semibold" style={{ background: 'var(--maybe-bg)', color: 'var(--maybe)' }} role="status" data-live-waiting>
            {waiting.length === 1
              ? 'No signal: 1 tap is kept on this phone and goes to the chat when the signal comes back.'
              : `No signal: ${waiting.length} taps are kept on this phone and go to the chat, in order, when the signal comes back.`}
          </p>
        )}
        {live.in_competition && finished && <p className="mt-1.5 text-center text-[0.6875rem] text-ink-3">The official score goes on the match sheet.</p>}
        {error && <p className="mt-2 text-xs" style={{ color: 'var(--no)' }}>{error}</p>}

        {ticks.length > 0 && (
          <ol className="mt-3 flex flex-col gap-1 border-t pt-2 text-sm" style={{ borderColor: 'var(--line-2)' }} data-ticker>
            {[...ticks].reverse().map((t) => (
              <li key={t.id} className="flex items-start gap-2" data-tick={t.kind} data-waiting={t.waiting ? '' : undefined} style={t.waiting ? { opacity: 0.7 } : undefined}>
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
                  {t.waiting && <span className="block text-xs text-ink-3">waiting for signal</span>}
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
                <h3 className="display text-lg leading-tight">{score ? `${score.ours} – ${score.theirs}` : 'Full time'}{live.opponent ? ` v ${live.opponent}` : ''}</h3>
                <p className="mt-1 text-sm text-ink-2">{live.in_competition ? 'Posts full time to the chat. The official score goes on the match sheet.' : 'Posts full time to the chat, writes the result on the game and the goals into the stats.'}</p>
                <div className="mt-4 flex gap-2">
                  <button onClick={() => tap('full_time')} disabled={busy} className="flex-1 rounded-lg px-3 py-2 text-sm font-semibold text-brand-ink disabled:opacity-50" style={{ background: 'var(--brand)' }} data-confirm-full-time>🏁 Full time</button>
                  <button onClick={() => setPicking(null)} className="rounded-lg border px-3 py-2 text-sm" style={line}>Not yet</button>
                </div>
              </>
            ) : picking === 'note' ? (
              <>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Great spell of pressure. Keeper has been brilliant." className="mt-2 w-full rounded-lg border px-2 py-1.5 text-sm" style={line} />
                <div className="mt-3 flex gap-2">
                  <button onClick={() => tap('note', { p_note: note })} disabled={busy || !note.trim()} className="flex-1 rounded-lg px-3 py-2 text-sm font-semibold text-brand-ink disabled:opacity-50" style={{ background: 'var(--brand)' }}>Post it</button>
                  <button onClick={() => setPicking(null)} className="rounded-lg border px-3 py-2 text-sm" style={line}>Cancel</button>
                </div>
              </>
            ) : (
              <>
                <div className="mt-2 flex flex-wrap gap-1.5" data-scorer-pick>
                  {live.players.map((p) => (
                    <button key={p.id} onClick={() => setScorer(p.id)} className="rounded-full border px-2.5 py-1 text-sm" style={scorer === p.id ? { background: 'var(--brand)', borderColor: 'var(--brand)', color: 'var(--brand-ink)' } : line} data-scorer={p.id}>
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
                    <button onClick={() => tap('goal_for', { p_player: scorer || undefined, p_assist: assist || undefined })} disabled={busy} className="flex-1 rounded-lg px-3 py-2 text-sm font-semibold text-brand-ink disabled:opacity-50" style={{ background: 'var(--brand)' }} data-confirm-goal>
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
