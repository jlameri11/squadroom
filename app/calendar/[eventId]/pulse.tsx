'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type View = {
  can_answer: boolean
  is_coach: boolean
  mine: { mood: number; note: string | null } | null
  summary: { happy: number; so_so: number; not_great: number; answers: { name: string; mood: number; note: string | null; at: string }[] } | null
}
const FACES: [number, string, string][] = [[3, '😀', 'Good'], [2, '😐', 'So-so'], [1, '🙁', 'Not great']]

/**
 * X-11: after the game, one tap from each family — how was today? Only the
 * coaches see the answers, with names: a sad face is the start of a phone
 * call, not a statistic.
 */
export function ParentPulse({ eventId }: { eventId: string }) {
  const [v, setV] = useState<View | null | undefined>(undefined)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [thanks, setThanks] = useState(false)

  useEffect(() => {
    let live = true
    ;(async () => {
      const { data, error } = await createClient().rpc('event_pulse_view', { p_event: eventId })
      if (live) setV(error ? null : (data as unknown as View))
    })()
    return () => {
      live = false
    }
  }, [eventId])

  if (!v || !v.can_answer) return null

  async function answer(mood: number) {
    setBusy(true)
    const { error } = await createClient().rpc('pulse_in', { p_event: eventId, p_mood: mood, p_note: note || undefined })
    setBusy(false)
    if (error) return
    setV((prev) => (prev ? { ...prev, mine: { mood, note: note || null } } : prev))
    setThanks(true)
  }

  if (v.is_coach) {
    const s = v.summary
    if (!s || s.answers.length === 0) return null
    return (
      <section className="mt-4" data-pulse-summary>
        <div className="sect">
          <span className="eyebrow">How was today?</span>
          <span className="text-xs text-ink-3">coaches only</span>
        </div>
        <div className="card p-3">
          <p className="text-sm">
            😀 {s.happy} · 😐 {s.so_so} · 🙁 {s.not_great}
          </p>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {s.answers.map((a, i) => (
              <li key={i} className="flex items-start gap-2">
                <span aria-hidden>{a.mood === 3 ? '😀' : a.mood === 2 ? '😐' : '🙁'}</span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{a.name}</span>
                  {a.note && <span className="block text-ink-2">“{a.note}”</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    )
  }

  return (
    <section className="mt-4" data-pulse>
      <span className="eyebrow">How was today?</span>
      <div className="card p-3">
        <p className="text-xs text-ink-3">One tap. Only the coaches see it.</p>
        <div className="mt-2 flex gap-2">
          {FACES.map(([mood, face, word]) => (
            <button
              key={mood}
              onClick={() => answer(mood)}
              disabled={busy}
              className="flex flex-1 flex-col items-center rounded-xl border py-2 text-2xl disabled:opacity-50"
              style={v.mine?.mood === mood ? { borderColor: 'var(--brand)', background: 'var(--brand-soft)' } : { borderColor: 'var(--line)' }}
              aria-label={word}
              data-mood={mood}
            >
              <span>{face}</span>
              <span className="text-[0.6875rem] text-ink-2">{word}</span>
            </button>
          ))}
        </div>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={v.mine?.note ?? 'A word for the coach (optional)'}
          className="mt-2 w-full rounded-lg border px-2 py-1.5 text-sm"
          style={{ borderColor: 'var(--line)' }}
          data-pulse-note
        />
        {(thanks || v.mine) && <p className="mt-1.5 text-xs" style={{ color: 'var(--yes)' }}>Thanks — the coach has it.</p>}
      </div>
    </section>
  )
}
