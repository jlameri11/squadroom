'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Row = { id: string; name: string; preferred_name: string | null; number: number | null; goals: number; assists: number; minutes: number | null; potm: boolean; note: string | null; votes: number | null }
type Stats = {
  event_id: string
  can_edit: boolean
  played: boolean
  vote_open: boolean
  vote_enabled: boolean
  vote_closed: boolean
  vote_closes_at: string
  my_vote: string | null
  votes_cast: number
  players: Row[]
}

/**
 * X-02 / X-03: who scored, who starred.
 *
 * For a family: the scorers, the Player of the Match, and — when the coach
 * opens it — one vote per adult until a day after the game. For the coach:
 * the numbers per player, the star, and the tally.
 */
export function EventStats({ eventId }: { eventId: string }) {
  const [s, setS] = useState<Stats | null | undefined>(undefined)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, { goals: string; assists: string; minutes: string }>>({})
  const [star, setStar] = useState<string>('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    ;(async () => {
      const { data, error } = await createClient().rpc('event_stats', { p_event: eventId })
      if (live) setS(error ? null : (data as unknown as Stats))
    })()
    return () => {
      live = false
    }
  }, [eventId])

  if (!s || !s.played) return null
  const first = (p: Row) => p.preferred_name || p.name.split(' ')[0]
  const scorers = s.players.filter((p) => p.goals > 0 || p.assists > 0)
  const potm = s.players.find((p) => p.potm) ?? null

  function startEditing() {
    if (!s) return
    const d: typeof draft = {}
    for (const p of s.players) d[p.id] = { goals: String(p.goals), assists: String(p.assists), minutes: p.minutes == null ? '' : String(p.minutes) }
    setDraft(d)
    setStar(potm?.id ?? '')
    setNote(potm?.note ?? '')
    setEditing(true)
  }
  async function save() {
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const rows = Object.entries(draft).map(([player_id, v]) => ({ player_id, goals: Number(v.goals) || 0, assists: Number(v.assists) || 0, minutes: v.minutes === '' ? null : Number(v.minutes) }))
    const { error } = await supabase.rpc('set_player_stats', { p_event: eventId, p_rows: rows as never })
    if (error) { setBusy(false); return setError(error.message) }
    const { data, error: e2 } = await supabase.rpc('set_player_of_match', { p_event: eventId, p_player: star || undefined, p_note: note || undefined })
    setBusy(false)
    if (e2) return setError(e2.message)
    setS(data as unknown as Stats)
    setEditing(false)
  }
  async function openVote(on: boolean) {
    setBusy(true)
    const { data, error } = await createClient().rpc('open_potm_vote', { p_event: eventId, p_open: on })
    setBusy(false)
    if (error) return setError(error.message)
    setS(data as unknown as Stats)
  }
  async function vote(playerId: string) {
    setBusy(true)
    setError(null)
    const { data, error } = await createClient().rpc('vote_player_of_match', { p_event: eventId, p_player: playerId })
    setBusy(false)
    if (error) return setError(error.message)
    setS(data as unknown as Stats)
  }

  const input = 'w-12 rounded-md border px-1.5 py-1 text-center text-sm tabular-nums'
  const line = { borderColor: 'var(--line)' }

  return (
    <section className="mt-4" data-event-stats>
      <div className="sect">
        <span className="eyebrow">Goals and the star</span>
        {s.can_edit && !editing && (
          <button onClick={startEditing} className="text-xs" style={{ color: 'var(--brand-text)' }} data-stats-edit>
            {scorers.length || potm ? 'Edit' : 'Enter'}
          </button>
        )}
      </div>

      {!editing && (
        <div className="card p-3">
          {potm ? (
            <p className="text-sm" data-potm>
              <span className="mr-1" aria-hidden>🏆</span>
              <b>Player of the Match: {potm.name}</b>
              {potm.note && <span className="block text-ink-2">{potm.note}</span>}
            </p>
          ) : (
            <p className="text-sm text-ink-3">No Player of the Match yet.</p>
          )}
          {scorers.length > 0 && (
            <ul className="mt-2 flex flex-col gap-0.5 text-sm" data-scorers>
              {scorers.map((p) => (
                <li key={p.id}>
                  {p.goals > 0 && <span aria-label={`${p.goals} goals`}>{'⚽'.repeat(Math.min(p.goals, 5))}{p.goals > 5 ? ` ×${p.goals}` : ''} </span>}
                  {first(p)} {p.name.split(' ').slice(1).join(' ')}
                  {p.assists > 0 && <span className="text-ink-3"> · {p.assists} {p.assists === 1 ? 'assist' : 'assists'}</span>}
                </li>
              ))}
            </ul>
          )}
          {s.vote_enabled && (
            <div className="mt-3 border-t pt-2.5" style={{ borderColor: 'var(--line-2)' }} data-vote>
              {s.vote_open ? (
                <>
                  <p className="text-xs font-semibold">Family vote — who was today&apos;s star? {s.my_vote ? '(you can change yours)' : ''}</p>
                  <p className="text-[11px] text-ink-3">One vote per adult, until {new Date(s.vote_closes_at).toLocaleString('en-AU', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {s.players.map((p) => (
                      <button key={p.id} onClick={() => vote(p.id)} disabled={busy} className="rounded-full border px-2.5 py-1 text-xs" style={s.my_vote === p.id ? { background: 'var(--brand)', borderColor: 'var(--brand)', color: '#fff' } : line} data-vote-for={p.id}>
                        {first(p)}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-xs text-ink-3">{s.vote_closed ? `The family vote has closed — ${s.votes_cast} ${s.votes_cast === 1 ? 'vote' : 'votes'}.` : 'The family vote opens at kick-off.'}</p>
              )}
              {(s.can_edit || s.vote_closed) && s.players.some((p) => (p.votes ?? 0) > 0) && (
                <p className="mt-1.5 text-xs text-ink-2" data-tally>
                  Tally: {s.players.filter((p) => (p.votes ?? 0) > 0).sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0)).map((p) => `${first(p)} ${p.votes}`).join(' · ')}
                </p>
              )}
            </div>
          )}
          {s.can_edit && (
            <div className="mt-2.5 flex items-center justify-between text-xs">
              <label className="flex items-center gap-2 text-ink-2">
                <input type="checkbox" checked={s.vote_enabled} onChange={(e) => openVote(e.target.checked)} disabled={busy} data-vote-toggle />
                Let the families vote for the star
              </label>
            </div>
          )}
          {error && <p className="mt-2 text-xs" style={{ color: 'var(--no)' }}>{error}</p>}
        </div>
      )}

      {editing && (
        <div className="card p-3" data-stats-editor>
          <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-2 gap-y-1 text-xs">
            <span className="text-ink-3">Player</span><span className="text-center text-ink-3">G</span><span className="text-center text-ink-3">A</span><span className="text-center text-ink-3">Min</span>
            {s.players.map((p) => (
              <div key={p.id} className="contents">
                <span className="truncate text-sm">{p.number != null && <span className="text-ink-3">#{p.number} </span>}{p.name}</span>
                <input value={draft[p.id]?.goals ?? '0'} onChange={(e) => setDraft({ ...draft, [p.id]: { ...draft[p.id], goals: e.target.value } })} inputMode="numeric" className={input} style={line} aria-label={`${p.name} goals`} />
                <input value={draft[p.id]?.assists ?? '0'} onChange={(e) => setDraft({ ...draft, [p.id]: { ...draft[p.id], assists: e.target.value } })} inputMode="numeric" className={input} style={line} aria-label={`${p.name} assists`} />
                <input value={draft[p.id]?.minutes ?? ''} onChange={(e) => setDraft({ ...draft, [p.id]: { ...draft[p.id], minutes: e.target.value } })} inputMode="numeric" placeholder="–" className={input} style={line} aria-label={`${p.name} minutes`} />
              </div>
            ))}
          </div>
          <label className="mt-3 block text-xs text-ink-2">
            Player of the Match
            <select value={star} onChange={(e) => setStar(e.target.value)} className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-sm" style={line} data-potm-select>
              <option value="">Nobody yet</option>
              {s.players.map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.votes ? ` · ${p.votes} ${p.votes === 1 ? 'vote' : 'votes'}` : ''}</option>
              ))}
            </select>
          </label>
          <label className="mt-2 block text-xs text-ink-2">
            A word for the chat (optional)
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Never stopped running" className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-sm" style={line} />
          </label>
          <p className="mt-1 text-[11px] text-ink-3">Picking a star posts a 🏆 announcement in the squad&apos;s chat, once.</p>
          {error && <p className="mt-2 text-xs" style={{ color: 'var(--no)' }}>{error}</p>}
          <div className="mt-3 flex gap-2">
            <button onClick={save} disabled={busy} className="flex-1 rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }} data-stats-save>
              {busy ? '…' : 'Save'}
            </button>
            <button onClick={() => setEditing(false)} className="rounded-lg border px-3 py-2 text-sm" style={line}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  )
}
