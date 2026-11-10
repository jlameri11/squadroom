'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { DEFAULT_TZ } from '@/lib/time'

type Rating = { coach: string; rating: number; note: string | null }
type Placement = { team_id: string | null; team: string | null; published_at: string | null }
type Player = {
  player_id: string
  registration_id: string
  name: string
  dob: string | null
  status: string
  team_id: string | null
  team: string | null
  avg: number | null
  count: number
  mine: { rating: number; note: string | null } | null
  ratings: Rating[]
  placement: Placement | null
}
type Team = { id: string; name: string; age_group: string; label: string | null; players: number; capacity: number | null }
type Session = { id: string; starts_at: string; venue: string | null; cancelled: boolean }
type Board = {
  program: { id: string; name: string; season: string | null; status: string; born_from_year: number | null; born_to_year: number | null }
  can_place: boolean
  sessions: Session[]
  to_publish: number
  players: Player[]
  teams: Team[]
}
type Preview = { players: number; families: number; teams: number }

// A session's time is the ground's, never the phone's (lib/time).
const TZ = DEFAULT_TZ
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * Grading a trial (Big Club Mode item 7; 0249).
 *
 * One list, phone first: each child who trialled, with the coaches' average,
 * this coach's own 1–5 and a note nobody outside the club reads, and — for
 * the coordinator and the staff — a squad to pencil them into. On a laptop
 * the same rows read as a table. "Publish teams" turns the pencil into the
 * squads and tells each family once: squad, coach, manager, training,
 * ground; the squad's chat gets a welcome. Until then a family's app says
 * nothing, so a half-made allocation is never a surprise.
 *
 * Sessions are a club-wide event series titled after the trial, so every
 * family can see when it is; set here in one go.
 */
export function TrialGrading({ programId, academyId }: { programId: string; academyId: string }) {
  const [board, setBoard] = useState<Board | null | undefined>(undefined)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<Preview | null>(null)
  const [published, setPublished] = useState<Preview | null>(null)
  const [showSessions, setShowSessions] = useState(false)
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({ days: [2] as number[], time: '17:00', from: today, until: new Date(Date.now() + 28 * 864e5).toISOString().slice(0, 10), venue: '' })

  const load = useCallback(async () => {
    const { data } = await createClient().rpc('trial_board', { p_program: programId })
    setBoard((data as unknown as Board | null) ?? null)
  }, [programId])
  useEffect(() => {
    void load()
  }, [load])

  if (board === undefined) return null
  // Not a grader: nothing, not a locked box.
  if (board === null) return null

  const seasonYear = Number(board.program.season) || new Date().getFullYear()
  const ageOf = (ag: string) => Number((ag.match(/^U(\d+)$/) ?? [])[1]) || null
  const inBand = (t: Team) => {
    const age = ageOf(t.age_group)
    if (!age || board.program.born_from_year == null || board.program.born_to_year == null) return false
    const born = seasonYear - age
    return born >= board.program.born_from_year && born <= board.program.born_to_year
  }
  const bandTeams = board.teams.filter(inBand)
  const otherTeams = board.teams.filter((t) => !inBand(t))

  async function rate(p: Player, rating: number) {
    setBusy(p.player_id)
    setError(null)
    const note = notes[p.player_id] ?? p.mine?.note ?? ''
    const { error } = await createClient().rpc('rate_trial_player', { p_program: programId, p_player: p.player_id, p_rating: rating, p_note: (note || null) as unknown as string })
    setBusy(null)
    if (error) return setError(error.message)
    await load()
  }

  async function saveNote(p: Player) {
    const note = notes[p.player_id]
    if (note === undefined || (note || null) === (p.mine?.note ?? null)) return
    if (!p.mine) return // a note rides on a rating; tap a number first
    await rate(p, p.mine.rating)
  }

  async function place(p: Player, teamId: string) {
    setBusy(p.player_id)
    setError(null)
    const { error } = await createClient().rpc('place_trial_player', { p_program: programId, p_player: p.player_id, p_team: (teamId || null) as unknown as string })
    setBusy(null)
    if (error) return setError(error.message)
    await load()
  }

  async function askToPublish() {
    setBusy('preview')
    setError(null)
    const { data, error } = await createClient().rpc('publish_teams_preview', { p_academy: academyId, p_program: programId })
    setBusy(null)
    if (error) return setError(error.message)
    setPreview((data as unknown as Preview | null) ?? { players: 0, families: 0, teams: 0 })
  }

  async function publish() {
    setBusy('publish')
    setError(null)
    const { data, error } = await createClient().rpc('publish_teams', { p_academy: academyId, p_program: programId })
    setBusy(null)
    setPreview(null)
    if (error) return setError(error.message)
    setPublished(data as unknown as Preview)
    await load()
  }

  async function addSessions() {
    setBusy('sessions')
    setError(null)
    const { error } = await createClient().rpc('create_trial_sessions', {
      p_program: programId,
      p_days: form.days,
      p_time: form.time,
      p_from: form.from,
      p_until: form.until,
      p_venue: (form.venue.trim() || null) as unknown as string,
      p_duration: 60,
    })
    setBusy(null)
    if (error) return setError(error.message)
    setShowSessions(false)
    await load()
  }

  const next = board.sessions.find((s) => !s.cancelled && new Date(s.starts_at) > new Date())
  const when = (iso: string) => new Date(iso).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: TZ })

  return (
    <section className="card mb-4 p-3.5" data-trial-grading>
      <div className="sect">
        <span className="eyebrow">Grading</span>
        <span className="text-xs text-ink-3">{board.players.length} trialling</span>
      </div>

      {/* The sessions, and one form to set them. */}
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="text-ink-2" data-trial-sessions={board.sessions.length}>
          {board.sessions.length === 0
            ? 'No sessions set yet.'
            : `${board.sessions.length} ${board.sessions.length === 1 ? 'session' : 'sessions'}${next ? ` · next ${when(next.starts_at)}${next.venue ? ` at ${next.venue}` : ''}` : ''}`}
        </span>
        <button onClick={() => setShowSessions((v) => !v)} className="tap text-xs font-semibold underline underline-offset-4" data-toggle-sessions>
          {showSessions ? 'Not now' : 'Add sessions'}
        </button>
      </div>
      {showSessions && (
        <div className="mt-2 rounded-xl p-3 text-sm" style={{ background: 'var(--surface-2)' }} data-session-form>
          <div className="flex flex-wrap gap-1.5">
            {[1, 2, 3, 4, 5, 6, 0].map((d) => {
              const on = form.days.includes(d)
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setForm({ ...form, days: on ? form.days.filter((x) => x !== d) : [...form.days, d].sort() })}
                  className="rounded-full px-3 py-1.5 text-xs font-semibold"
                  style={on ? { background: 'var(--brand)', color: 'var(--brand-ink)' } : { background: 'var(--surface)', color: 'var(--ink-2)' }}
                  aria-pressed={on}
                >
                  {DAYS[d]}
                </button>
              )
            })}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="text-xs text-ink-2">
              Time
              <input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} className="mt-0.5 w-full rounded-lg border p-2 text-sm" style={{ borderColor: 'var(--line)' }} />
            </label>
            <label className="text-xs text-ink-2">
              Where
              <input value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} placeholder="Ground" className="mt-0.5 w-full rounded-lg border p-2 text-sm" style={{ borderColor: 'var(--line)' }} />
            </label>
            <label className="text-xs text-ink-2">
              From
              <input type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} className="mt-0.5 w-full rounded-lg border p-2 text-sm" style={{ borderColor: 'var(--line)' }} />
            </label>
            <label className="text-xs text-ink-2">
              Until
              <input type="date" value={form.until} onChange={(e) => setForm({ ...form, until: e.target.value })} className="mt-0.5 w-full rounded-lg border p-2 text-sm" style={{ borderColor: 'var(--line)' }} />
            </label>
          </div>
          <button onClick={addSessions} disabled={busy !== null || form.days.length === 0} className="mt-2 w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-brand-ink disabled:opacity-50" style={{ background: 'var(--brand)' }} data-add-sessions>
            {busy === 'sessions' ? 'Adding…' : 'Add the sessions'}
          </button>
          <p className="mt-1.5 text-xs text-ink-3">Club-wide, titled after the trial, so every family can see when it is.</p>
        </div>
      )}

      {error && <p className="mt-2 rounded-lg px-3 py-2 text-sm" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>{error}</p>}

      {board.players.length === 0 ? (
        <p className="mt-3 text-sm text-ink-2">Nobody has registered for the trial yet.</p>
      ) : (
        <div className="mt-3" data-trial-table>
          {/* On a laptop the rows line up under these; on a phone each row carries its own labels. */}
          <div className="hidden text-xs text-ink-3 lg:grid lg:grid-cols-[minmax(0,2fr)_7rem_11rem_minmax(0,2fr)_12rem] lg:gap-3 lg:px-1 lg:pb-1">
            <span>Player</span><span>Coaches</span><span>Your rating</span><span>Your note</span>{board.can_place && <span>Squad</span>}
          </div>
          <ul className="flex flex-col divide-y divide-[var(--line-2)]">
            {board.players.map((p) => {
              const noteValue = notes[p.player_id] ?? p.mine?.note ?? ''
              const placed = p.placement?.team_id ? p.placement : null
              return (
                <li key={p.player_id} className="grid grid-cols-1 gap-2 py-3 lg:grid-cols-[minmax(0,2fr)_7rem_11rem_minmax(0,2fr)_12rem] lg:items-center lg:gap-3 lg:px-1" data-trial-player={p.player_id}>
                  <div className="min-w-0">
                    <span className="block truncate font-semibold">{p.name}</span>
                    <span className="block text-xs text-ink-3">
                      {p.dob ? `born ${p.dob.slice(0, 4)}` : ''}
                      {p.team ? ` · now ${p.team}` : ''}
                      {p.status !== 'approved' ? ` · ${p.status}` : ''}
                    </span>
                  </div>
                  <div className="text-sm" data-trial-avg={p.avg ?? ''}>
                    {p.count === 0 ? (
                      <span className="text-ink-3">no ratings yet</span>
                    ) : (
                      <details>
                        <summary className="tap cursor-pointer tabular-nums">
                          ★ {p.avg} <span className="text-xs text-ink-3">· {p.count} {p.count === 1 ? 'coach' : 'coaches'}</span>
                        </summary>
                        <ul className="mt-1 flex flex-col gap-0.5 text-xs text-ink-2">
                          {p.ratings.map((r, i) => (
                            <li key={i}><b>{r.coach}</b> {r.rating}{r.note ? ` — ${r.note}` : ''}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                  <div className="flex items-center gap-1" role="group" aria-label={`Your rating for ${p.name}`}>
                    {[1, 2, 3, 4, 5].map((n) => {
                      const on = p.mine?.rating === n
                      return (
                        <button
                          key={n}
                          onClick={() => rate(p, n)}
                          disabled={busy !== null}
                          aria-label={`Rate ${p.name} ${n}`}
                          aria-pressed={on}
                          className="h-8 w-8 rounded-lg text-sm font-semibold tabular-nums disabled:opacity-50"
                          style={on ? { background: 'var(--brand)', color: 'var(--brand-ink)' } : { background: 'var(--surface-2)', color: 'var(--ink-2)' }}
                          data-rate={n}
                        >
                          {n}
                        </button>
                      )
                    })}
                  </div>
                  <input
                    value={noteValue}
                    onChange={(e) => setNotes({ ...notes, [p.player_id]: e.target.value })}
                    onBlur={() => void saveNote(p)}
                    placeholder={p.mine ? 'A note only coaches see' : 'Rate first, then a note'}
                    aria-label={`Your note on ${p.name}`}
                    className="min-w-0 rounded-lg border px-2.5 py-2 text-sm"
                    style={{ borderColor: 'var(--line)' }}
                    data-note
                  />
                  {board.can_place && (
                    placed?.published_at ? (
                      <span className="text-sm" style={{ color: 'var(--yes)' }} data-placed-published>Published → {placed.team}</span>
                    ) : (
                      <select
                        value={p.placement?.team_id ?? ''}
                        onChange={(e) => place(p, e.target.value)}
                        disabled={busy !== null}
                        aria-label={`Squad for ${p.name}`}
                        className="rounded-lg border px-2.5 py-2 text-sm"
                        style={{ borderColor: p.placement?.team_id ? 'var(--brand)' : 'var(--line)' }}
                        data-place
                      >
                        <option value="">— not placed —</option>
                        {bandTeams.length > 0 && (
                          <optgroup label="This age band">
                            {bandTeams.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.players}{t.capacity ? `/${t.capacity}` : ''}</option>)}
                          </optgroup>
                        )}
                        {otherTeams.length > 0 && (
                          <optgroup label="Other squads">
                            {otherTeams.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.players}{t.capacity ? `/${t.capacity}` : ''}</option>)}
                          </optgroup>
                        )}
                      </select>
                    )
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {board.can_place && (
        <div className="mt-3">
          {published && (
            <p className="mb-2 rounded-lg px-3 py-2 text-sm" style={{ background: 'var(--yes-bg)', color: 'var(--yes)' }} data-published>
              Published: {published.players} {published.players === 1 ? 'player' : 'players'} on {published.teams} {published.teams === 1 ? 'squad' : 'squads'}, {published.families} {published.families === 1 ? 'family' : 'families'} told once.
            </p>
          )}
          {preview ? (
            <div className="rounded-xl p-3 text-sm" style={{ background: 'var(--surface-2)' }} data-publish-confirm>
              <p>
                This puts <b>{preview.players}</b> {preview.players === 1 ? 'player' : 'players'} on {preview.teams} {preview.teams === 1 ? 'squad' : 'squads'} and tells <b>{preview.families}</b> {preview.families === 1 ? 'family' : 'families'} once — squad, coach, manager, training, ground — with a welcome in each squad&apos;s chat.
              </p>
              <div className="mt-2 flex gap-2">
                <button onClick={publish} disabled={busy !== null} className="flex-1 rounded-xl px-4 py-2.5 font-semibold text-brand-ink disabled:opacity-50" style={{ background: 'var(--brand)' }} data-publish-now>
                  {busy === 'publish' ? 'Publishing…' : 'Publish now'}
                </button>
                <button onClick={() => setPreview(null)} className="rounded-xl border px-4 py-2.5 text-sm" style={{ borderColor: 'var(--line)' }}>Not yet</button>
              </div>
            </div>
          ) : (
            <button
              onClick={askToPublish}
              disabled={busy !== null || board.to_publish === 0}
              className="w-full rounded-xl border px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
              style={{ borderColor: 'var(--brand)', color: 'var(--brand-text)' }}
              data-publish-teams
            >
              Publish teams · {board.to_publish} {board.to_publish === 1 ? 'player' : 'players'} pencilled in
            </button>
          )}
          <p className="mt-1.5 text-xs text-ink-3">Families see nothing until you publish. Ratings and notes stay with the club&apos;s coaches.</p>
        </div>
      )}
    </section>
  )
}
