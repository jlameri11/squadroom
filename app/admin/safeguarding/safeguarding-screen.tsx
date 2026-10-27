'use client'

import { useCallback, useEffect, useState } from 'react'
import { AppBar, Screen } from '@/components/app-shell'
import { ScreenSkeleton } from '@/components/screen-skeleton'
import { createClient } from '@/lib/supabase/client'
import { getOrg } from '@/lib/org'

type Report = {
  report_id: string
  reason: string
  note: string | null
  status: 'open' | 'actioned' | 'dismissed'
  created_at: string
  reporter: string | null
  channel_name: string | null
  sender_name: string | null
  body: string | null
  deleted: boolean
  outcome: string | null
  reviewed_by: string | null
  reviewed_at: string | null
}

const REASON_LABEL: Record<string, string> = {
  safeguarding: "A child's welfare",
  inappropriate: 'Inappropriate',
  bullying: 'Bullying',
  wrong_channel: 'Wrong place',
  spam: 'Spam',
  other: 'Something else',
}

/**
 * The reports queue.
 *
 * Open first and oldest-concern-first within that, because a safeguarding
 * report that has sat for a week is the worst thing this screen can contain.
 *
 * Each report carries the message itself. An officer cannot act on "a message
 * in U8 SPL was reported" and must not have to go hunting through a thread
 * they may not even be in — so the body, the sender and the reporter all
 * travel with it.
 *
 * Closing one requires a sentence. "Dismissed" on its own is the state a club
 * cannot defend when somebody asks a year later, so the database refuses it
 * and this screen says so before the button is pressed.
 */
export function SafeguardingScreen() {
  const [reports, setReports] = useState<Report[] | null>(null)
  const [tab, setTab] = useState<'open' | 'closed'>('open')
  const [refused, setRefused] = useState(false)
  const [working, setWorking] = useState<string | null>(null)
  const [outcomes, setOutcomes] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await createClient().rpc('safeguarding_queue', {
      p_academy: (getOrg() ?? null) as unknown as string,
      p_status: null as unknown as 'open',
    })
    if (error) {
      // Not an error state: most people are not safeguarding officers, and
      // telling them so plainly beats a red box.
      setRefused(true)
      return setReports([])
    }
    setReports((data ?? []) as Report[])
  }, [])

  useEffect(() => {
    ;(async () => {
      await load()
    })()
  }, [load])

  async function close(id: string, status: 'actioned' | 'dismissed') {
    const outcome = (outcomes[id] ?? '').trim()
    if (!outcome) {
      return setError('Say what was done — a closed report with no note is not a record.')
    }
    setWorking(id)
    setError(null)
    const { error } = await createClient().rpc('review_report', {
      p_report: id,
      p_status: status,
      p_outcome: outcome,
    })
    setWorking(null)
    if (error) return setError(error.message)
    await load()
  }

  if (reports === null) return <ScreenSkeleton />

  if (refused) {
    return (
      <>
        <AppBar title="Safeguarding" back="/admin" />
        <Screen>
          <p className="card m-4 p-6 text-center text-sm text-ink-2">
            Only a safeguarding officer or the club owner can read reports. Ask whoever runs the
            club to appoint you in Club settings.
          </p>
        </Screen>
      </>
    )
  }

  const open = reports.filter((r) => r.status === 'open')
  const closed = reports.filter((r) => r.status !== 'open')
  const shown = tab === 'open' ? open : closed

  return (
    <>
      <AppBar
        title="Safeguarding"
        meta={open.length > 0 ? `${open.length} to look at` : 'Nothing open'}
        back="/admin"
      />
      <Screen>
        <div className="p-3.5">
          <div className="mb-3 flex gap-1.5">
            {(['open', 'closed'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className="flex-1 rounded-xl px-3 py-2 text-sm font-semibold"
                style={
                  tab === t
                    ? { background: 'var(--surface-2)', color: 'var(--ink)' }
                    : { background: 'transparent', color: 'var(--ink-3)' }
                }
              >
                {t === 'open' ? `Open · ${open.length}` : `Dealt with · ${closed.length}`}
              </button>
            ))}
          </div>

          {error && (
            <p
              className="mb-3 rounded-lg px-3 py-2.5 text-sm"
              style={{ background: 'var(--no-bg)', color: 'var(--no)' }}
            >
              {error}
            </p>
          )}

          {shown.length === 0 ? (
            <p className="card p-6 text-center text-sm text-ink-2">
              {tab === 'open'
                ? 'Nothing reported. That is the result you want.'
                : 'Nothing dealt with yet.'}
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {shown.map((r) => (
                <li key={r.report_id} className="card p-3.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span
                      className="tag"
                      style={
                        r.reason === 'safeguarding'
                          ? { background: 'var(--no-bg)', color: 'var(--no)' }
                          : { background: 'var(--surface-2)', color: 'var(--ink-2)' }
                      }
                    >
                      {REASON_LABEL[r.reason] ?? r.reason}
                    </span>
                    <span className="text-xs text-ink-3">{when(r.created_at)}</span>
                  </div>

                  <p className="mt-2 text-sm text-ink-3">
                    {r.reporter ?? 'Someone'} reported {r.sender_name ?? 'a message'}
                    {r.channel_name && ` in ${r.channel_name}`}
                  </p>

                  {/* The message itself, quoted, so a judgement can be made
                      here rather than in a thread. */}
                  <blockquote
                    className="mt-2 rounded-lg border-l-2 px-3 py-2 text-sm"
                    style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}
                  >
                    {r.deleted ? (
                      <span className="text-ink-3">
                        This message was deleted. Its text is not kept.
                      </span>
                    ) : (
                      (r.body ?? <span className="text-ink-3">No text — a card or a photo.</span>)
                    )}
                  </blockquote>

                  {r.note && (
                    <p className="mt-2 text-sm">
                      <span className="text-ink-3">They said: </span>
                      {r.note}
                    </p>
                  )}

                  {r.status === 'open' ? (
                    <div className="mt-3">
                      <textarea
                        value={outcomes[r.report_id] ?? ''}
                        onChange={(e) =>
                          setOutcomes({ ...outcomes, [r.report_id]: e.target.value })
                        }
                        rows={2}
                        placeholder="What did you do about it?"
                        className="w-full rounded-xl border px-3 py-2.5 text-sm"
                        style={{ borderColor: 'var(--line)' }}
                      />
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={() => close(r.report_id, 'actioned')}
                          disabled={working === r.report_id}
                          className="flex-1 rounded-xl px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                          style={{ background: 'var(--brand)' }}
                        >
                          {working === r.report_id ? 'Saving…' : 'Acted on it'}
                        </button>
                        <button
                          onClick={() => close(r.report_id, 'dismissed')}
                          disabled={working === r.report_id}
                          className="rounded-xl border px-3 py-2.5 text-sm disabled:opacity-50"
                          style={{ borderColor: 'var(--line)' }}
                        >
                          No action
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2 rounded-lg p-2.5 text-sm" style={{ background: 'var(--surface-2)' }}>
                      <b>{r.status === 'actioned' ? 'Acted on' : 'No action'}</b>
                      {r.reviewed_by && <span className="text-ink-3"> by {r.reviewed_by}</span>}
                      {r.outcome && <span className="block">{r.outcome}</span>}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Screen>
    </>
  )
}

function when(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}
