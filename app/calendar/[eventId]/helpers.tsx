'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Helper = { profile_id: string; name: string; me: boolean }
type Job = {
  id: string
  title: string
  start_time: string | null
  end_time: string | null
  time: string | null
  spots: number
  note: string | null
  helpers: Helper[]
}
type Data = { can_manage: boolean; can_help: boolean; jobs: Job[]; ground?: { event_id: string; title: string; jobs: Job[] } | null }
type Draft = { id?: string; title: string; start_time: string; end_time: string; spots: string; helpers: Helper[] }

const SUGGESTED = ['Canteen', 'BBQ', 'Linesman', 'Gate', 'Set-up', 'Pack-down', 'First aid', 'Scorer', 'Field marshal']

/**
 * Helpers wanted (G-07, 0225): the jobs a game or a club day needs done by
 * people who are not playing — each with a time on the day and a number of
 * spots. Anyone who can see the event puts their own name down; the coach
 * sets the jobs, asks once, and can take someone off (they are told). Each
 * helper is reminded at 6 pm the evening before. Nothing shows until the
 * coach has added a job, and nothing at all before 0225 is in.
 */
export function EventHelpers({ eventId, clubWide }: { eventId: string; clubWide: boolean }) {
  const [d, setD] = useState<Data | null>(null)
  const [editing, setEditing] = useState(false)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [asked, setAsked] = useState<number | null>(null)
  const [sureOff, setSureOff] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await createClient().rpc('event_helpers', { p_event: eventId })
    setD(error ? null : (data as unknown as Data))
  }, [eventId])

  useEffect(() => {
    ;(async () => {
      await load()
    })()
  }, [load])

  if (!d) return null
  const groundJobs = d.ground?.jobs ?? []
  if (d.jobs.length === 0 && groundJobs.length === 0 && !(d.can_manage && d.can_help)) return null

  const spots = d.jobs.reduce((n, j) => n + j.spots, 0)
  const filled = d.jobs.reduce((n, j) => n + Math.min(j.helpers.length, j.spots), 0)
  const open = spots - filled

  function startEditing() {
    setDrafts(
      d!.jobs.map((j) => ({ id: j.id, title: j.title, start_time: j.start_time ?? '', end_time: j.end_time ?? '', spots: String(j.spots), helpers: j.helpers }))
    )
    setEditing(true)
    setError(null)
    setAsked(null)
  }
  const add = (title = '') => setDrafts((ds) => [...ds, { title, start_time: '', end_time: '', spots: '1', helpers: [] }])
  const change = (i: number, patch: Partial<Draft>) => setDrafts((ds) => ds.map((x, k) => (k === i ? { ...x, ...patch } : x)))

  async function save() {
    const jobs = drafts
      .filter((x) => x.title.trim())
      .map((x) => ({ id: x.id, title: x.title.trim(), start_time: x.start_time || null, end_time: x.end_time || null, spots: Math.max(1, Math.min(30, Number(x.spots) || 1)) }))
    setBusy('save')
    setError(null)
    const { data, error } = await createClient().rpc('set_event_jobs', { p_event: eventId, p_jobs: jobs as never })
    setBusy(null)
    if (error) return setError(error.message)
    setD(data as unknown as Data)
    setEditing(false)
  }
  async function help(job: Job) {
    setBusy(job.id)
    setError(null)
    const { data, error } = await createClient().rpc('help_with', { p_job: job.id })
    setBusy(null)
    if (error) return setError(error.message)
    setD(data as unknown as Data)
  }
  async function stop(job: { id: string }, profile?: string) {
    setBusy(profile ? `${job.id}:${profile}` : job.id)
    setError(null)
    const { data, error } = await createClient().rpc('stop_helping', { p_job: job.id, ...(profile ? { p_profile: profile } : {}) })
    setBusy(null)
    setSureOff(null)
    if (error) return setError(error.message)
    const next = data as unknown as Data
    setD(next)
    // Keep the editor's names in step with what the database now says.
    if (profile) setDrafts((ds) => ds.map((x) => ({ ...x, helpers: next.jobs.find((j) => j.id === x.id)?.helpers ?? x.helpers })))
  }
  // 0252: the ground's jobs are another event's; the sign-up returns that
  // event's helpers, so this game's view is read again instead.
  async function helpGround(job: Job) {
    setBusy(job.id)
    setError(null)
    const { error } = await createClient().rpc('help_with', { p_job: job.id })
    setBusy(null)
    if (error) return setError(error.message)
    await load()
  }
  async function stopGround(job: Job) {
    setBusy(job.id)
    setError(null)
    const { error } = await createClient().rpc('stop_helping', { p_job: job.id })
    setBusy(null)
    if (error) return setError(error.message)
    await load()
  }
  async function ask() {
    setBusy('ask')
    setError(null)
    const { data, error } = await createClient().rpc('ask_for_helpers', { p_event: eventId })
    setBusy(null)
    if (error) return setError(error.message)
    setAsked(data as number)
  }

  const line = { borderColor: 'var(--line)' }
  const input = 'w-full rounded-lg border px-2 py-1.5 text-base'
  // Neutral: orange is for what needs you, and a suggestion does not.
  const chip = 'rounded-full border px-3 py-1.5 text-xs font-semibold'

  return (
    <section className="mt-4" data-helpers>
      <div className="sect">
        <span className="eyebrow">
          Helpers{d.jobs.length > 0 && !editing ? ` · ${filled} of ${spots}` : ''}
        </span>
        {d.can_manage && d.can_help && !editing && (
          <button onClick={startEditing} className="tap text-xs" style={{ color: 'var(--brand-text)' }} data-helpers-edit>
            {d.jobs.length ? 'Edit' : 'Ask for helpers'}
          </button>
        )}
      </div>

      <div className="card overflow-hidden">
        {editing ? (
          <div className="p-3" data-helpers-editor>
            <p className="text-xs text-ink-3">
              What needs doing, when on the day, and how many people. {clubWide ? 'The club' : 'The squad'} can put their names down; each is reminded at 6 pm the evening before.
            </p>
            <ul className="mt-2 flex flex-col gap-3">
              {drafts.map((x, i) => (
                <li key={x.id ?? `new-${i}`} className="rounded-lg border p-2.5" style={line} data-helper-draft={i}>
                  <label className="block text-xs text-ink-2">
                    Job
                    <input value={x.title} onChange={(e) => change(i, { title: e.target.value })} maxLength={60} placeholder="Canteen" className={`mt-0.5 ${input}`} style={line} />
                  </label>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <label className="block min-w-0 text-xs text-ink-2">
                      From
                      <input type="time" value={x.start_time} onChange={(e) => change(i, { start_time: e.target.value })} className={`mt-0.5 min-w-0 ${input}`} style={line} />
                    </label>
                    <label className="block min-w-0 text-xs text-ink-2">
                      To
                      <input type="time" value={x.end_time} onChange={(e) => change(i, { end_time: e.target.value })} className={`mt-0.5 min-w-0 ${input}`} style={line} />
                    </label>
                  </div>
                  <label className="mt-2 flex items-center gap-2 text-xs text-ink-2">
                    How many people
                    <input type="number" inputMode="numeric" min={Math.max(1, x.helpers.length)} max={30} value={x.spots} onChange={(e) => change(i, { spots: e.target.value })} className="w-16 rounded-lg border px-2 py-1.5 text-base" style={line} />
                  </label>
                  {x.helpers.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {x.helpers.map((h) => {
                        const key = `${x.id}:${h.profile_id}`
                        return (
                          <button
                            key={h.profile_id}
                            onClick={() => (sureOff === key ? stop({ id: x.id! }, h.profile_id) : setSureOff(key))}
                            disabled={busy !== null}
                            className={chip}
                            style={sureOff === key ? { borderColor: 'var(--no)', background: 'var(--no-bg)', color: 'var(--no)' } : line}
                            aria-label={sureOff === key ? `Tap again to take ${h.name} off ${x.title}` : `Take ${h.name} off ${x.title}`}
                          >
                            {sureOff === key ? `Take ${h.name.split(' ')[0]} off?` : `${h.name} ×`}
                          </button>
                        )
                      })}
                    </div>
                  )}
                  <button onClick={() => setDrafts((ds) => ds.filter((_, k) => k !== i))} className="tap mt-2 text-xs underline underline-offset-2" style={{ color: 'var(--no)' }}>
                    {x.helpers.length ? `Remove this job (${x.helpers.length} told)` : 'Remove this job'}
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2" aria-label="Common jobs">
              {SUGGESTED.filter((t) => !drafts.some((x) => x.title.trim().toLowerCase() === t.toLowerCase())).map((t) => (
                <button key={t} onClick={() => add(t)} className={chip} style={{ borderColor: 'var(--line)', color: 'var(--brand-text)' }} data-helper-suggest={t}>
                  + {t}
                </button>
              ))}
              <button onClick={() => add()} className={chip} style={{ borderColor: 'var(--line)', color: 'var(--brand-text)' }}>
                + Another job
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={save}
                disabled={busy !== null}
                className="min-w-fit flex-1 rounded-lg px-3 py-2 text-sm font-semibold text-brand-ink disabled:opacity-50"
                style={{ background: 'var(--brand)' }}
                data-helpers-save
              >
                {busy === 'save' ? 'Saving…' : 'Save the jobs'}
              </button>
              <button onClick={() => setEditing(false)} disabled={busy !== null} className="min-w-fit rounded-lg border px-3 py-2 text-sm" style={line}>
                Cancel
              </button>
            </div>
          </div>
        ) : d.jobs.length === 0 && groundJobs.length === 0 ? (
          <p className="p-3 text-sm text-ink-3">Need a hand on the day? Add the jobs and {clubWide ? 'the club' : 'the squad'} can put their names down.</p>
        ) : (
          <>
            <ul>
              {d.jobs.map((j) => {
                const mine = j.helpers.some((h) => h.me)
                const full = j.helpers.length >= j.spots
                return (
                  <li key={j.id} className="row items-center gap-3" data-helper-job={j.id}>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">
                        {j.title}
                        {j.time && <span className="ml-1.5 text-xs font-normal text-ink-3">{j.time}</span>}
                      </span>
                      <span className="block text-xs text-ink-3">
                        {j.helpers.length ? j.helpers.map((h) => (h.me ? 'You' : h.name)).join(', ') : 'Nobody yet'} · {j.helpers.length} of {j.spots}
                      </span>
                    </span>
                    {mine ? (
                      <button
                        onClick={() => stop(j)}
                        disabled={busy !== null || !d.can_help}
                        className="tap flex-none text-xs underline underline-offset-2"
                        style={{ color: 'var(--ink-2)' }}
                        aria-label={`I can't do ${j.title} now`}
                      >
                        {busy === j.id ? '…' : "Can't now"}
                      </button>
                    ) : full ? (
                      <span className="flex-none text-xs text-ink-3">Full</span>
                    ) : d.can_help ? (
                      <button
                        onClick={() => help(j)}
                        disabled={busy !== null}
                        className="min-w-fit flex-none rounded-lg px-3 py-1.5 text-sm font-semibold text-yes-ink disabled:opacity-50"
                        style={{ background: 'var(--yes)' }}
                        data-helper-take={j.id}
                      >
                        {busy === j.id ? '…' : 'I can help'}
                      </button>
                    ) : null}
                  </li>
                )
              })}
            </ul>
            {/* 0252: the ground's day — canteen, BBQ, set-up — beside the squad's own jobs. */}
            {groundJobs.length > 0 && (
              <div className={d.jobs.length ? 'border-t p-3' : 'p-3'} style={{ borderColor: 'var(--line-2)' }} data-ground-jobs={groundJobs.length}>
                <p className="text-xs text-ink-3">At the ground that day · {d.ground!.title}</p>
                <ul className="mt-1">
                  {groundJobs.map((j) => {
                    const mine = j.helpers.some((h) => h.me)
                    const full = j.helpers.length >= j.spots
                    return (
                      <li key={j.id} className="flex items-center gap-3 py-1.5 text-sm" data-ground-job={j.id}>
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">
                            {j.title}
                            {j.time && <span className="ml-1.5 text-xs font-normal text-ink-3">{j.time}</span>}
                          </span>
                          <span className="block text-xs text-ink-3">
                            {j.helpers.length ? j.helpers.map((h) => (h.me ? 'You' : h.name)).join(', ') : 'Nobody yet'} · {j.helpers.length} of {j.spots}
                          </span>
                        </span>
                        {mine ? (
                          <button onClick={() => stopGround(j)} disabled={busy !== null || !d.can_help} className="tap flex-none text-xs underline underline-offset-2" style={{ color: 'var(--ink-2)' }} aria-label={`I can't do ${j.title} now`}>
                            {busy === j.id ? '…' : "Can't now"}
                          </button>
                        ) : full ? (
                          <span className="flex-none text-xs text-ink-3">Full</span>
                        ) : d.can_help ? (
                          <button onClick={() => helpGround(j)} disabled={busy !== null} className="min-w-fit flex-none rounded-lg px-3 py-1.5 text-sm font-semibold text-yes-ink disabled:opacity-50" style={{ background: 'var(--yes)' }} data-ground-take={j.id}>
                            {busy === j.id ? '…' : 'I can help'}
                          </button>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
            {d.can_manage && d.can_help && open > 0 && (
              <div className="border-t p-3" style={{ borderColor: 'var(--line-2)' }}>
                <button
                  onClick={ask}
                  disabled={busy !== null || asked !== null}
                  className="w-full rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-60"
                  style={{ borderColor: 'var(--brand)', color: 'var(--brand-text)' }}
                  data-helpers-ask
                >
                  {busy === 'ask'
                    ? 'Asking…'
                    : asked !== null
                      ? `Asked ${asked} ${asked === 1 ? 'person' : 'people'}`
                      : `Ask ${clubWide ? 'the club' : 'the squad'} — ${open} ${open === 1 ? 'spot' : 'spots'} open`}
                </button>
              </div>
            )}
          </>
        )}
        {error && <p className="px-3 pb-3 text-xs" style={{ color: 'var(--no)' }}>{error}</p>}
      </div>
    </section>
  )
}
