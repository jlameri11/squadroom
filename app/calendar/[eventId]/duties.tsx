'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Duty = { id: string; title: string; player_id: string; player: string; family: string; mine: boolean; requested_swap_at: string | null; swap_note: string | null }
type Data = { can_manage: boolean; can_take: boolean; titles: string[]; duties: Duty[] }

/**
 * The squad's duties for this game (Big Club Mode item 10; 0252): oranges,
 * linesperson, kit wash — one family per duty, rostered by turns from the
 * team page. A family that can't make it asks for a swap here and the squad
 * hears it in the chat; another family takes it with one tap. Nothing shows
 * until the squad has duties.
 */
export function EventDuties({ eventId, teamId }: { eventId: string; teamId: string }) {
  const [d, setD] = useState<Data | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [asking, setAsking] = useState<string | null>(null)
  const [note, setNote] = useState('')

  const load = useCallback(async () => {
    const { data } = await createClient().rpc('event_duties', { p_event: eventId })
    setD((data as unknown as Data | null) ?? null)
  }, [eventId])
  useEffect(() => {
    void load()
  }, [load])

  if (!d || d.titles.length === 0) return null

  async function swap(duty: Duty) {
    setBusy(duty.id)
    setError(null)
    const { data, error } = await createClient().rpc('request_duty_swap', { p_duty: duty.id, p_note: (note.trim() || null) as unknown as string })
    setBusy(null)
    setAsking(null)
    setNote('')
    if (error) return setError(error.message)
    setD(data as unknown as Data)
  }
  async function take(duty: Duty) {
    setBusy(duty.id)
    setError(null)
    const { data, error } = await createClient().rpc('take_duty', { p_duty: duty.id })
    setBusy(null)
    if (error) return setError(error.message)
    setD(data as unknown as Data)
  }

  return (
    <section className="mt-4" data-duties={d.duties.length}>
      <div className="sect">
        <span className="eyebrow">Duties</span>
        {d.can_manage && (
          <Link href={`/admin/teams/${teamId}`} className="tap text-xs" style={{ color: 'var(--brand-text)' }}>
            Roster
          </Link>
        )}
      </div>
      <div className="card overflow-hidden">
        {d.duties.length === 0 ? (
          <p className="p-3 text-sm text-ink-3">Not rostered yet{d.can_manage ? ' — roster the next games from the team page.' : '.'}</p>
        ) : (
          <ul>
            {d.duties.map((x) => (
              <li key={x.id} className="row items-center gap-3" data-duty={x.id} data-duty-mine={x.mine ? 'yes' : 'no'}>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{x.title}</span>
                  <span className="block text-xs text-ink-3">
                    {x.mine ? `You — the ${x.family}` : `The ${x.family}`}
                    {x.requested_swap_at && <span style={{ color: 'var(--accent)' }}> · needs a swap{x.swap_note ? ` — ${x.swap_note}` : ''}</span>}
                  </span>
                </span>
                {x.mine && !x.requested_swap_at && (
                  asking === x.id ? (
                    <span className="flex min-w-0 flex-none items-center gap-1.5">
                      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why (optional)" maxLength={200} className="w-28 min-w-0 rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: 'var(--line)' }} aria-label="Why you can't" />
                      <button onClick={() => swap(x)} disabled={busy !== null} className="min-w-fit rounded-lg px-2.5 py-1.5 text-sm font-semibold text-brand-ink disabled:opacity-50" style={{ background: 'var(--brand)' }} data-duty-swap-go>
                        Ask
                      </button>
                    </span>
                  ) : (
                    <button onClick={() => setAsking(x.id)} className="tap flex-none text-xs underline underline-offset-2" style={{ color: 'var(--ink-2)' }} data-duty-swap>
                      Can&apos;t do it
                    </button>
                  )
                )}
                {!x.mine && x.requested_swap_at && d.can_take && (
                  <button onClick={() => take(x)} disabled={busy !== null} className="min-w-fit flex-none rounded-lg px-3 py-1.5 text-sm font-semibold text-yes-ink disabled:opacity-50" style={{ background: 'var(--yes)' }} data-duty-take>
                    {busy === x.id ? '…' : "I'll take it"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {error && <p className="px-3 pb-3 text-xs" style={{ color: 'var(--no)' }}>{error}</p>}
      </div>
    </section>
  )
}
