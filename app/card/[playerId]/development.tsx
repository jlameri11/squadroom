'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Sheet } from '@/components/sheet'

type Ratings = Partial<Record<'technical' | 'tactical' | 'physical' | 'social', number>>
type Report = {
  id: string
  kind: 'note' | 'report'
  term: string | null
  body: string
  ratings: Ratings
  shared: boolean
  published_at: string | null
  created_at: string
  author: string | null
  mine: boolean
}
type Clip = {
  id: string
  url: string
  title: string
  note: string | null
  shared: boolean
  created_at: string
  added_by: string | null
  event: { id: string; title: string; starts_at: string; opponent: string | null } | null
}
type Game = { id: string; title: string; starts_at: string }
type Development = {
  player: { id: string; full_name: string; preferred_name: string | null }
  can_write: boolean
  is_family: boolean
  reports: Report[]
  clips: Clip[]
  games: Game[]
}

const RATINGS: { key: keyof Ratings; label: string }[] = [
  { key: 'technical', label: 'Technique' },
  { key: 'tactical', label: 'Game sense' },
  { key: 'physical', label: 'Athleticism' },
  { key: 'social', label: 'Teamwork' },
]

function when(iso: string) {
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** "Term 4 2026" — the Australian school term the date falls in. */
function termOf(d: Date) {
  return `Term ${Math.min(4, Math.ceil((d.getMonth() + 1) / 3))} ${d.getFullYear()}`
}

/**
 * G-05: what the coach saw. A coach's private notes, termly reports the
 * coach chooses to share, and clips of the child from games — all on the
 * card, because the card is the child's page. The database decides who
 * sees what (0196); this only draws it.
 */
export function Development({ playerId }: { playerId: string }) {
  const [dev, setDev] = useState<Development | null | undefined>(undefined)
  const [sheet, setSheet] = useState<'note' | 'report' | 'clip' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState({ term: '', body: '', ratings: {} as Ratings, share: false, url: '', title: '', note: '', event: '' })

  const load = useCallback(async () => {
    const { data, error } = await createClient().rpc('player_development', { p_player: playerId })
    setDev(error ? null : (data as unknown as Development))
  }, [playerId])

  useEffect(() => {
    ;(async () => {
      await load()
    })()
  }, [load])

  if (dev === undefined || dev === null) return null
  const first = dev.player.preferred_name || dev.player.full_name.split(' ')[0]
  const shared = dev.reports.filter((r) => r.shared)

  function open(kind: 'note' | 'report' | 'clip') {
    setError(null)
    setDraft({ term: termOf(new Date()), body: '', ratings: {}, share: kind === 'clip', url: '', title: '', note: '', event: '' })
    setSheet(kind)
  }

  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true)
    setError(null)
    const { error } = await fn()
    setBusy(false)
    if (error) return setError(error.message)
    setSheet(null)
    await load()
  }

  const supabase = createClient()
  const saveReport = (kind: 'note' | 'report') =>
    run(() =>
      supabase.rpc('write_player_report', {
        p_player: playerId,
        p_kind: kind,
        p_body: draft.body,
        p_term: kind === 'report' ? draft.term : undefined,
        p_ratings: kind === 'report' ? (draft.ratings as never) : undefined,
        p_share: kind === 'report' ? draft.share : false,
      })
    )
  const saveClip = () =>
    run(() =>
      supabase.rpc('add_player_clip', {
        p_player: playerId,
        p_url: draft.url.trim(),
        p_title: draft.title,
        p_note: draft.note || undefined,
        p_event: draft.event || undefined,
        p_share: draft.share,
      })
    )
  const share = (id: string, on: boolean) => run(() => supabase.rpc('share_player_report', { p_report: id, p_share: on }))
  const removeReport = (id: string) => run(() => supabase.from('player_reports').delete().eq('id', id))
  const removeClip = (id: string) => run(() => supabase.from('player_clips').delete().eq('id', id))

  const input = 'mt-0.5 w-full rounded-lg border px-2 py-1.5 text-sm'
  const inputStyle = { borderColor: 'var(--line)', background: 'var(--surface)' }

  return (
    <section className="mt-5" id="development" data-development>
      <div className="sect">
        <div>
          <span className="eyebrow">Development</span>
          <h2 className="display text-lg leading-tight">{first}&apos;s progress</h2>
        </div>
        {dev.can_write && (
          <div className="flex flex-none gap-1.5">
            <button onClick={() => open('note')} className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold" style={{ borderColor: 'var(--line)' }} data-add-note>
              Note
            </button>
            <button onClick={() => open('report')} className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold" style={{ borderColor: 'var(--line)' }} data-add-report>
              Report
            </button>
            <button onClick={() => open('clip')} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white" style={{ background: 'var(--brand)' }} data-add-clip>
              ▶ Clip
            </button>
          </div>
        )}
      </div>

      {/* minmax(0, 1fr): a card with a long one-line title must truncate,
          not widen the column past the phone. */}
      <div className="stack grid-cols-[minmax(0,1fr)]">
      {dev.reports.length === 0 && dev.clips.length === 0 && (
        <p className="card p-3 text-sm text-ink-2" data-empty>
          {dev.can_write
            ? `Nothing yet. A note is yours alone; a report can be shared with ${first}'s family; a clip is a link to a video of ${first} playing.`
            : `Nothing shared yet. ${first}'s coaches share termly reports and clips here.`}
        </p>
      )}

      {dev.reports.map((r) => (
        <article key={r.id} className="card p-3" data-report={r.kind} data-shared={r.shared}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <span className="eyebrow">{r.kind === 'note' ? 'Coach’s note' : r.term ?? 'Report'}</span>
              <span className="block text-xs text-ink-3">
                {r.author ?? 'Coach'} · {when(r.created_at)}
              </span>
            </div>
            {dev.can_write && (
              <span className="pill flex-none" style={r.shared ? { background: 'var(--yes-bg)', color: 'var(--yes)' } : undefined}>
                {r.kind === 'note' ? 'Private' : r.shared ? 'Shared with family' : 'Not shared'}
              </span>
            )}
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-snug">{r.body}</p>
          {Object.keys(r.ratings ?? {}).length > 0 && (
            <dl className="mt-2.5 grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1 text-xs">
              {RATINGS.filter((x) => r.ratings[x.key]).map((x) => (
                <RatingRow key={x.key} label={x.label} value={r.ratings[x.key]!} />
              ))}
            </dl>
          )}
          {dev.can_write && (
            <div className="mt-2.5 flex gap-3 text-xs">
              {r.kind === 'report' && (
                <button onClick={() => share(r.id, !r.shared)} disabled={busy} className="underline underline-offset-2" style={{ color: 'var(--brand-text)' }} data-share>
                  {r.shared ? 'Stop sharing' : 'Share with the family'}
                </button>
              )}
              <button onClick={() => removeReport(r.id)} disabled={busy} className="text-ink-3 underline underline-offset-2">
                Remove
              </button>
            </div>
          )}
        </article>
      ))}

      {dev.clips.length > 0 && (
        <>
          <span className="eyebrow mt-2 block">Clips</span>
          {dev.clips.map((c) => (
            <article key={c.id} className="card p-3" data-clip data-shared={c.shared}>
              <a href={c.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3">
                <span className="grid h-10 w-10 flex-none place-items-center rounded-lg text-white" style={{ background: 'var(--brand)' }} aria-hidden>
                  ▶
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{c.title}</span>
                  <span className="block truncate text-xs text-ink-3">
                    {c.event ? `${c.event.title} · ${when(c.event.starts_at)}` : when(c.created_at)}
                    {c.added_by && ` · ${c.added_by}`}
                  </span>
                </span>
              </a>
              {c.note && <p className="mt-2 text-sm text-ink-2">{c.note}</p>}
              {dev.can_write && (
                <div className="mt-2 flex items-center gap-3 text-xs">
                  <span className="pill" style={c.shared ? { background: 'var(--yes-bg)', color: 'var(--yes)' } : undefined}>
                    {c.shared ? 'Shared with family' : 'Not shared'}
                  </span>
                  <button onClick={() => removeClip(c.id)} disabled={busy} className="text-ink-3 underline underline-offset-2">
                    Remove
                  </button>
                </div>
              )}
            </article>
          ))}
        </>
      )}

      </div>

      {dev.is_family && shared.length > 0 && (
        <p className="mt-3 text-xs text-ink-3">Reports and clips are shared by {first}&apos;s coaches with this family only. They are never public.</p>
      )}

      {sheet && (
        <Sheet onClose={() => setSheet(null)}>
          <div className="p-4" data-sheet={sheet}>
            <span className="eyebrow">{sheet === 'note' ? 'A private note' : sheet === 'report' ? 'A report for the family' : 'A clip'}</span>
            <h3 className="display text-lg leading-tight">
              {sheet === 'note' ? `What you saw in ${first}` : sheet === 'report' ? `${first}'s ${draft.term || 'report'}` : `A clip of ${first}`}
            </h3>
            {sheet === 'note' && (
              <p className="mt-1 text-xs text-ink-3">Yours and the club&apos;s staff&apos;s only. The family never sees a note.</p>
            )}

            {sheet !== 'clip' && (
              <>
                {sheet === 'report' && (
                  <label className="mt-3 block text-xs text-ink-2">
                    Term
                    <input value={draft.term} onChange={(e) => setDraft({ ...draft, term: e.target.value })} className={input} style={inputStyle} />
                  </label>
                )}
                <label className="mt-3 block text-xs text-ink-2">
                  {sheet === 'note' ? 'Note' : 'What to tell the family'}
                  <textarea
                    value={draft.body}
                    onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                    rows={sheet === 'note' ? 4 : 6}
                    placeholder={sheet === 'note' ? 'Left foot much better this week; still drifts out of position when tired.' : `${first} has had a strong term…`}
                    className={input}
                    style={inputStyle}
                  />
                </label>
                {sheet === 'report' && (
                  <div className="mt-3">
                    <span className="text-xs text-ink-2">Ratings (optional, 1–5)</span>
                    {RATINGS.map((x) => (
                      <div key={x.key} className="mt-1.5 flex items-center justify-between gap-2 text-sm">
                        <span>{x.label}</span>
                        <span className="flex gap-1" role="radiogroup" aria-label={x.label}>
                          {[1, 2, 3, 4, 5].map((n) => {
                            const on = (draft.ratings[x.key] ?? 0) >= n
                            return (
                              <button
                                key={n}
                                type="button"
                                role="radio"
                                aria-checked={draft.ratings[x.key] === n}
                                aria-label={`${x.label} ${n}`}
                                onClick={() => setDraft({ ...draft, ratings: { ...draft.ratings, [x.key]: draft.ratings[x.key] === n ? undefined : n } })}
                                className="h-7 w-7 rounded-full border text-xs font-semibold"
                                style={on ? { background: 'var(--brand)', borderColor: 'var(--brand)', color: '#fff' } : { borderColor: 'var(--line)' }}
                              >
                                {n}
                              </button>
                            )
                          })}
                        </span>
                      </div>
                    ))}
                    <label className="mt-3 flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={draft.share} onChange={(e) => setDraft({ ...draft, share: e.target.checked })} />
                      Share with {first}&apos;s family now (they get a notification)
                    </label>
                  </div>
                )}
              </>
            )}

            {sheet === 'clip' && (
              <>
                <label className="mt-3 block text-xs text-ink-2">
                  Link to the video (Veo, Hudl, YouTube, Analysis Pro…)
                  <input value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} placeholder="https://" inputMode="url" className={input} style={inputStyle} />
                </label>
                <label className="mt-3 block text-xs text-ink-2">
                  Title
                  <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Leo's run and cross, 2nd half" className={input} style={inputStyle} />
                </label>
                <label className="mt-3 block text-xs text-ink-2">
                  Which game
                  <select value={draft.event} onChange={(e) => setDraft({ ...draft, event: e.target.value })} className={input} style={inputStyle}>
                    <option value="">Not from a game / training</option>
                    {dev.games.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.title} · {when(g.starts_at)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="mt-3 block text-xs text-ink-2">
                  A word for the family (optional)
                  <input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} className={input} style={inputStyle} />
                </label>
                <label className="mt-3 flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={draft.share} onChange={(e) => setDraft({ ...draft, share: e.target.checked })} />
                  Share with {first}&apos;s family (they get a notification)
                </label>
                <p className="mt-2 text-xs text-ink-3">Squadroom hosts no video: the link opens where it lives. Never public.</p>
              </>
            )}

            {error && (
              <p className="mt-3 rounded-lg p-2.5 text-sm" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>
                {error}
              </p>
            )}
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => (sheet === 'clip' ? saveClip() : saveReport(sheet))}
                disabled={busy || (sheet === 'clip' ? !draft.url.trim() || !draft.title.trim() : !draft.body.trim())}
                className="flex-1 rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: 'var(--brand)' }}
                data-save
              >
                {busy ? '…' : sheet === 'note' ? 'Keep the note' : sheet === 'report' ? (draft.share ? 'Save and share' : 'Save for later') : 'Add the clip'}
              </button>
              <button onClick={() => setSheet(null)} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--line)' }}>
                Cancel
              </button>
            </div>
          </div>
        </Sheet>
      )}
    </section>
  )
}

function RatingRow({ label, value }: { label: string; value: number }) {
  return (
    <>
      <dt className="text-ink-2">{label}</dt>
      <dd className="h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--surface-2)' }}>
        <span className="block h-full rounded-full" style={{ width: `${value * 20}%`, background: 'var(--brand)' }} />
      </dd>
      <dd className="tabular-nums text-ink-3">{value}/5</dd>
    </>
  )
}
