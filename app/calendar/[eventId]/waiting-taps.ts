'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Queued } from '@/lib/offline/outbox'
import { unqueue, useQueued } from '@/lib/offline/use-outbox'

/**
 * Score taps still on this phone (X-09), as the game page shows them.
 *
 * They are read from the outbox itself, not remembered by the screen: the
 * outbox is what will actually be sent, it survives a reload, and the hero at
 * the top and the timeline under the buttons then cannot disagree about the
 * score.
 */
export type WaitingTap = {
  queueId: string
  kind: string
  minute: number | null
  player: string | null
  assist: string | null
  note: string | null
  at: number
}

/** This game's score taps in the queue, in the order they were tapped. */
export function waitingTaps(items: Queued[], eventId: string): WaitingTap[] {
  return items.flatMap((i): WaitingTap[] => {
    const w = i.write
    if (w.kind !== 'rpc' || w.fn !== 'live_tick' || w.args.p_event !== eventId) return []
    const a = w.args as { p_kind?: unknown; p_minute?: unknown; p_player?: unknown; p_assist?: unknown; p_note?: unknown }
    return [{
      queueId: i.id,
      kind: String(a.p_kind),
      minute: typeof a.p_minute === 'number' ? a.p_minute : null,
      player: typeof a.p_player === 'string' ? a.p_player : null,
      assist: typeof a.p_assist === 'string' ? a.p_assist : null,
      note: typeof a.p_note === 'string' ? a.p_note : null,
      at: i.queuedAt,
    }]
  })
}

type Scored = { kicked_off: boolean; finished: boolean; score: { ours: number; theirs: number } }

/** The game as this phone knows it: the database's, plus the taps still on it. */
export function withWaiting<L extends Scored>(live: L, taps: WaitingTap[]): L {
  if (taps.length === 0) return live
  return {
    ...live,
    kicked_off: live.kicked_off || taps.some((t) => t.kind === 'kick_off'),
    finished: live.finished || taps.some((t) => t.kind === 'full_time'),
    score: {
      ours: live.score.ours + taps.filter((t) => t.kind === 'goal_for').length,
      theirs: live.score.theirs + taps.filter((t) => t.kind === 'goal_against').length,
    },
  }
}

/**
 * This game's taps still on the phone — and the ones just sent, held on
 * screen until `reread` has fetched the game again, so the score never dips
 * back for the moment between the queue emptying and the database's answer.
 *
 * `takeBack` removes a tap that has not gone yet: a slip undone before it
 * left the phone never reaches the chat at all. It answers false if the tap
 * went in the same instant, and the caller undoes it at the database instead.
 */
export function useWaitingTaps(eventId: string, reread: () => Promise<void>) {
  const queued = useQueued()
  const taps = useMemo(() => waitingTaps(queued, eventId), [queued, eventId])
  const [held, setHeld] = useState<WaitingTap[]>([])
  const shown = useRef<WaitingTap[]>([])
  const takenBack = useRef(new Set<string>())

  useEffect(() => {
    const before = shown.current
    shown.current = taps
    const sent = before.filter((b) => !takenBack.current.has(b.queueId) && !taps.some((t) => t.queueId === b.queueId))
    if (sent.length === 0) return
    ;(async () => {
      setHeld((h) => [...h, ...sent])
      await reread()
      setHeld((h) => h.filter((x) => !sent.some((s) => s.queueId === x.queueId)))
    })()
  }, [taps, reread])

  const takeBack = useCallback(async (queueId: string) => {
    takenBack.current.add(queueId)
    const took = await unqueue(queueId)
    if (!took) takenBack.current.delete(queueId)
    return took
  }, [])

  const all = useMemo(() => [...held.filter((h) => !taps.some((t) => t.queueId === h.queueId)), ...taps], [held, taps])
  return { taps: all, waiting: taps, takeBack }
}
