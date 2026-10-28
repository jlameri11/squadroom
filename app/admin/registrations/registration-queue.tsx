'use client'

import { useCallback, useEffect, useState } from 'react'
import { AppBar, Screen } from '@/components/app-shell'
import { ScreenSkeleton } from '@/components/screen-skeleton'
import { createClient } from '@/lib/supabase/client'
import { getOrg } from '@/lib/org'

type Row = {
  request_id: string
  program_id: string
  program_name: string
  guardian_name: string
  guardian_phone: string | null
  guardian_email: string | null
  child_name: string
  child_dob: string
  child_gender: string | null
  answers: Record<string, string> | null
  consents: { id: string; version: number }[] | null
  status: string
  created_at: string
  decided_by: string | null
  decided_at: string | null
  decision_note: string | null
  existing_player_id: string | null
  spots_left: number | null
}

/**
 * Families a club has never met, waiting to hear.
 *
 * Oldest first, because a family who filled in a form on Monday and heard
 * nothing by Saturday has already decided what kind of club this is.
 *
 * Accepting is a bigger decision than approving a join request, so this
 * screen is separate from `/admin/requests` rather than a tab on it: a join
 * request lets somebody into a conversation, and this puts a child on a
 * roster, into a program with a capacity, and starts a relationship with
 * money in it.
 *
 * Three things are surfaced because they change the decision:
 *   · the squad has to be chosen, since that is what puts the family in the
 *     right channels
 *   · whether this child is ALREADY on the roster, so a second guardian does
 *     not create a twin
 *   · how many places are left, so a club does not accept twelve into eight
 */
export function RegistrationQueue() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [refused, setRefused] = useState(false)
  const [tab, setTab] = useState<'pending' | 'decided'>('pending')
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [team, setTeam] = useState<Record<string, string>>({})
  const [note, setNote] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [slug, setSlug] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data, error } = await supabase.rpc('registration_queue', {
      p_academy: (getOrg() ?? null) as unknown as string,
      p_status: null as unknown as string,
    })
    if (error) return setRefused(true)
    setRows((data ?? []) as Row[])

    const { data: screen } = await supabase.rpc('import_screen', {
      p_academy: (getOrg() ?? null) as unknown as string,
    })
    const s = screen as unknown as {
      academy?: { id: string } | null
      teams?: { id: string; name: string }[]
    } | null
    setTeams(s?.teams ?? [])

    // Read directly rather than widening import_screen for a second caller.
    // RLS lets a member read their own academy, so this is a one-line select
    // and not a new function to keep in step.
    if (s?.academy?.id) {
      const { data: a } = await supabase
        .from('academies')
        .select('slug')
        .eq('id', s.academy.id)
        .maybeSingle()
      setSlug(a?.slug ?? null)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function decide(row: Row, decision: 'approve' | 'decline') {
    setBusy(row.request_id)
    setError(null)
    const res = await fetch('/api/register/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: row.request_id,
        decision,
        teamId: team[row.request_id] || null,
        note: note[row.request_id] || undefined,
      }),
    })
    setBusy(null)
    if (!res.ok) {
      const b = await res.json().catch(() => ({}))
      return setError(b.error ?? 'Could not save that.')
    }
    setOpen(null)
    await load()
  }

  if (refused) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        <AppBar title="Registrations" back="/admin" />
        <Screen>
          <p className="p-6 text-center text-sm text-ink-2">Only a coach can see this.</p>
        </Screen>
      </div>
    )
  }
  if (!rows) return <ScreenSkeleton />

  const pending = rows.filter((r) => r.status === 'pending')
  const decided = rows.filter((r) => r.status !== 'pending')
  const shown = tab === 'pending' ? pending : decided

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
      <AppBar
        title="Registrations"
        meta={pending.length === 0 ? 'Nobody waiting' : `${pending.length} waiting`}
        back="/admin"
      />
      <Screen>
        {/* The club's own link, where the club will look for it. A public
            page nobody can find is a public page that does nothing — the
            same reason /programs and /payments were built and reachable
            from nowhere. */}
        {slug && (
          <div className="border-b px-4 py-2.5" style={{ borderColor: 'var(--line-2)' }}>
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 text-sm text-ink-2">Your register link</span>
              <button
                onClick={async () => {
                  const url = `${window.location.origin}/${slug}/register`
                  if (navigator.share) {
                    try {
                      await navigator.share({ title: 'Register', url })
                      return
                    } catch (e) {
                      // Dismissing the share sheet throws AbortError. Not a
                      // failure, and must not be reported as one.
                      if ((e as Error)?.name === 'AbortError') return
                    }
                  }
                  try {
                    await navigator.clipboard.writeText(url)
                    setCopied(true)
                  } catch {
                    setCopied(true)
                  }
                }}
                className="flex-none rounded-lg border px-3 py-1.5 text-xs font-semibold"
                style={{ borderColor: 'var(--brand)', color: 'var(--brand-text)' }}
              >
                {copied ? 'Copied' : 'Share'}
              </button>
            </div>
            {/* The link in plain text as well, because a copy button that
                silently fails is how somebody ends up reading a URL down the
                phone. */}
            <a
              href={`/${slug}/register`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 block truncate text-xs text-ink-3 underline underline-offset-2"
            >
              /{slug}/register
            </a>
          </div>
        )}

        <div className="flex gap-2 px-3.5 pt-3">
          {(
            [
              ['pending', `Waiting${pending.length ? ` · ${pending.length}` : ''}`],
              ['decided', 'Decided'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              aria-pressed={tab === value}
              className="rounded-full border px-3 py-1.5 text-xs font-semibold"
              style={
                tab === value
                  ? {
                      borderColor: 'var(--brand)',
                      background: 'var(--brand-faint)',
                      color: 'var(--brand-text)',
                    }
                  : { borderColor: 'var(--line)', color: 'var(--ink-2)' }
              }
            >
              {label}
            </button>
          ))}
        </div>

        {error && (
          <p
            className="mx-3.5 mt-3 rounded-lg border p-3 text-sm"
            style={{ borderColor: 'var(--no)', color: 'var(--no)' }}
          >
            {error}
          </p>
        )}

        {shown.length === 0 ? (
          <p className="p-6 text-center text-sm text-ink-3">
            {tab === 'pending'
              ? 'Nothing waiting. Share the link above and they will land here.'
              : 'Nothing decided yet.'}
          </p>
        ) : (
          <div className="mt-2">
            {shown.map((r) => (
              <div key={r.request_id} className="border-b" style={{ borderColor: 'var(--line-2)' }}>
                <button
                  onClick={() => setOpen(open === r.request_id ? null : r.request_id)}
                  className="w-full px-4 py-3 text-left"
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate font-medium">{r.child_name}</span>
                    <span className="flex-none text-xs text-ink-3">{ago(r.created_at)}</span>
                  </span>
                  <span className="block truncate text-sm text-ink-2">
                    {r.program_name} · born {r.child_dob.slice(0, 4)}
                  </span>
                  <span className="block truncate text-xs text-ink-3">
                    {r.guardian_name}
                    {r.guardian_phone ? ` · ${r.guardian_phone}` : ''}
                  </span>
                  {r.status !== 'pending' && (
                    <span
                      className="mt-0.5 block text-xs font-semibold"
                      style={{ color: r.status === 'approved' ? 'var(--yes)' : 'var(--no)' }}
                    >
                      {r.status === 'approved' ? 'Accepted' : 'Declined'}
                      {r.decided_by ? ` by ${r.decided_by}` : ''}
                      {r.decision_note ? ` — ${r.decision_note}` : ''}
                    </span>
                  )}
                </button>

                {open === r.request_id && (
                  <div className="px-4 pb-4">
                    {/* The one fact that changes the decision most: this may
                        not be a new child at all, but a second guardian
                        registering one already here. */}
                    {r.existing_player_id && (
                      <p
                        className="rounded-lg border p-2.5 text-xs"
                        style={{ borderColor: 'var(--maybe)', color: 'var(--maybe)' }}
                      >
                        A child with this name and date of birth is already on your roster.
                        Accepting attaches this parent to that child rather than creating a
                        second one.
                      </p>
                    )}

                    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                      <dt className="text-ink-2">Born</dt>
                      <dd className="tabular-nums">{r.child_dob}</dd>
                      {r.child_gender && (
                        <>
                          <dt className="text-ink-2">Gender</dt>
                          <dd>{r.child_gender}</dd>
                        </>
                      )}
                      {r.guardian_email && (
                        <>
                          <dt className="text-ink-2">Email</dt>
                          <dd className="truncate">{r.guardian_email}</dd>
                        </>
                      )}
                      <dt className="text-ink-2">Agreed</dt>
                      <dd>
                        {(r.consents ?? []).length} document
                        {(r.consents ?? []).length === 1 ? '' : 's'}
                      </dd>
                      {r.spots_left != null && (
                        <>
                          <dt className="text-ink-2">Places</dt>
                          <dd>{r.spots_left} left</dd>
                        </>
                      )}
                    </dl>

                    {Object.entries(r.answers ?? {}).length > 0 && (
                      <ul className="mt-2 flex flex-col gap-0.5 text-sm">
                        {Object.entries(r.answers ?? {}).map(([k, v]) => (
                          <li key={k} className="text-ink-2">
                            <span className="text-ink-3">{k}:</span> {String(v)}
                          </li>
                        ))}
                      </ul>
                    )}

                    {r.status === 'pending' && (
                      <>
                        <label className="mt-3 block text-sm">
                          <span className="text-ink-2">Which squad?</span>
                          <select
                            value={team[r.request_id] ?? ''}
                            onChange={(e) => setTeam({ ...team, [r.request_id]: e.target.value })}
                            className="mt-0.5 w-full rounded-lg border px-3 py-2.5 text-sm"
                            style={{ borderColor: 'var(--line)' }}
                          >
                            <option value="">Decide later</option>
                            {teams.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))}
                          </select>
                          {/* Said out loud, because a club that leaves this
                              blank will wonder why the family cannot see
                              anything. */}
                          <span className="mt-0.5 block text-xs text-ink-3">
                            Choosing one now puts the family in that squad&apos;s chat and its
                            fixtures. Left blank, they are in the club but see nothing yet.
                          </span>
                        </label>

                        <input
                          value={note[r.request_id] ?? ''}
                          onChange={(e) => setNote({ ...note, [r.request_id]: e.target.value })}
                          placeholder="A note for your own records"
                          className="mt-2 w-full rounded-lg border px-3 py-2.5 text-base"
                          style={{ borderColor: 'var(--line)' }}
                        />

                        <div className="mt-2 flex gap-2">
                          <button
                            onClick={() => void decide(r, 'approve')}
                            disabled={busy === r.request_id}
                            className="flex-1 rounded-lg px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                            style={{ background: 'var(--yes)' }}
                          >
                            {busy === r.request_id ? 'Working…' : 'Accept'}
                          </button>
                          <button
                            onClick={() => void decide(r, 'decline')}
                            disabled={busy === r.request_id}
                            className="rounded-lg border px-3 py-2.5 text-sm font-semibold disabled:opacity-50"
                            style={{ borderColor: 'var(--no)', color: 'var(--no)' }}
                          >
                            Decline
                          </button>
                        </div>

                        {r.guardian_phone && (
                          <a
                            href={`tel:${r.guardian_phone}`}
                            className="mt-2 block rounded-lg border py-2 text-center text-sm"
                            style={{ borderColor: 'var(--line)' }}
                          >
                            Ring {r.guardian_name}
                          </a>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Screen>
    </div>
  )
}

function ago(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 60) return `${Math.max(mins, 0)}m`
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h`
  return `${Math.round(mins / 1440)}d`
}
