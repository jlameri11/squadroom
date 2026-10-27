'use client'

import { useCallback, useEffect, useState } from 'react'
import { AppBar, Screen } from '@/components/app-shell'
import { ScreenSkeleton } from '@/components/screen-skeleton'
import { createClient } from '@/lib/supabase/client'
import { getOrg } from '@/lib/org'

type Row = {
  profile_id: string
  full_name: string
  academy_role: string
  coaches: string | null
  number: string | null
  kind: 'wwcc' | 'exemption' | null
  outcome: 'cleared' | 'applied' | 'barred' | 'not_found' | null
  expires_on: string | null
  days_left: number | null
  state: 'missing' | 'barred' | 'not_found' | 'expired' | 'expiring' | 'applied' | 'current'
  verified_by: string | null
  verified_at: string | null
}

const STATE: Record<Row['state'], { label: string; tint: string }> = {
  barred: { label: 'Barred', tint: 'var(--no)' },
  not_found: { label: 'Not on the register', tint: 'var(--no)' },
  missing: { label: 'Nothing recorded', tint: 'var(--no)' },
  expired: { label: 'Expired', tint: 'var(--no)' },
  expiring: { label: 'Running out', tint: 'var(--maybe)' },
  applied: { label: 'Applied', tint: 'var(--maybe)' },
  current: { label: 'Current', tint: 'var(--yes)' },
}

/**
 * Who is cleared to work with children, and who is not.
 *
 * Built from the PEOPLE, not from the clearances, which is the difference
 * between a screen that shows a club its filing and one that shows it its
 * risk. Somebody with no record at all is the most important row here and a
 * list of records would not contain them.
 *
 * Worst first, and the squads they coach beside the name — a missing check
 * for somebody in front of the U8s on Saturday is a different problem from a
 * missing one for the treasurer.
 */
export function ClearanceBoard() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [refused, setRefused] = useState(false)
  const [open, setOpen] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await createClient().rpc('clearance_board', {
      p_academy: (getOrg() ?? null) as unknown as string,
    })
    if (error) return setRefused(true)
    // The function returns nothing to anyone who is not club staff, which is
    // not the same as a club with no staff — so an empty list is treated as
    // "not for you" rather than rendered as reassuring emptiness.
    if ((data ?? []).length === 0) return setRefused(true)
    setRows(data as Row[])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (refused) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        <AppBar title="Checks" back="/admin" />
        <Screen>
          <p className="p-6 text-center text-sm text-ink-2">
            Only a club owner or admin can see this.
          </p>
        </Screen>
      </div>
    )
  }

  if (!rows) return <ScreenSkeleton />

  const needing = rows.filter((r) => r.state !== 'current')

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
      <AppBar
        title="Checks"
        meta={
          needing.length === 0
            ? `${rows.length} staff, all current`
            : `${needing.length} of ${rows.length} need attention`
        }
        back="/admin"
      />
      <Screen>
        <section className="px-3.5 pt-4">
          <p className="text-sm text-ink-2">
            There is no automatic lookup — check each number on the{' '}
            <a
              href="https://wwccheck.ocg.nsw.gov.au/Employer"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
              style={{ color: 'var(--brand)' }}
            >
              OCG Employer Portal
            </a>{' '}
            and record what it said. Your name and the date are saved with it.
          </p>
          {/* Said plainly, because a club admin who does not know this will
              find out by being refused. */}
          <p className="mt-1.5 text-xs text-ink-3">
            Nobody can be added to a squad as a coach without a current check, and nobody can
            record their own.
          </p>
        </section>

        <div className="mt-3">
          {rows.map((r) => (
            <div key={r.profile_id} className="border-b" style={{ borderColor: 'var(--line-2)' }}>
              <button
                onClick={() => setOpen(open === r.profile_id ? null : r.profile_id)}
                className="flex w-full items-start gap-3 px-4 py-3 text-left"
              >
                <span
                  aria-hidden
                  className="mt-1.5 h-2.5 w-2.5 flex-none rounded-full"
                  style={{ background: STATE[r.state].tint }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{r.full_name}</span>
                  <span className="block truncate text-sm text-ink-3">
                    {[r.coaches ? `Coaches ${r.coaches}` : roleWord(r.academy_role)]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <span
                    className="mt-0.5 block text-xs font-semibold"
                    style={{ color: STATE[r.state].tint }}
                  >
                    {STATE[r.state].label}
                    {r.days_left !== null && r.state !== 'current' && ` · ${days(r.days_left)}`}
                    {r.state === 'current' && r.expires_on && ` until ${when(r.expires_on)}`}
                  </span>
                </span>
                <span className="flex-none text-lg text-ink-3">{open === r.profile_id ? '−' : '+'}</span>
              </button>

              {open === r.profile_id && (
                <RecordForm
                  row={r}
                  onDone={async () => {
                    setOpen(null)
                    await load()
                  }}
                />
              )}
            </div>
          ))}
        </div>
      </Screen>
    </div>
  )
}

function RecordForm({ row, onDone }: { row: Row; onDone: () => void }) {
  const [number, setNumber] = useState(row.number ?? '')
  const [outcome, setOutcome] = useState<Row['outcome']>(row.outcome ?? 'cleared')
  const [expires, setExpires] = useState(row.expires_on ?? '')
  const [kind, setKind] = useState<'wwcc' | 'exemption'>(row.kind ?? 'wwcc')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    setError(null)
    const { error } = await createClient().rpc('record_clearance', {
      p_academy: (getOrg() ?? null) as unknown as string,
      p_profile: row.profile_id,
      p_number: number,
      p_outcome: outcome as 'cleared',
      p_expires_on: expires,
      p_kind: kind,
      p_note: note || undefined,
    })
    setBusy(false)
    if (error) return setError(error.message)
    onDone()
  }

  return (
    <div className="px-4 pb-4">
      <label className="block text-sm">
        <span className="text-ink-2">Number, as printed</span>
        <input
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          placeholder="WWC1234567E"
          autoCapitalize="characters"
          className="mt-0.5 w-full rounded-lg border px-3 py-2.5 text-base"
          style={{ borderColor: 'var(--line)' }}
        />
      </label>

      <fieldset className="mt-2">
        <legend className="text-sm text-ink-2">What the portal said</legend>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {(
            [
              ['cleared', 'Cleared'],
              ['applied', 'Applied'],
              ['barred', 'Barred'],
              ['not_found', 'Not found'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setOutcome(value)}
              aria-pressed={outcome === value}
              className="rounded-full border px-3 py-1.5 text-xs font-semibold"
              style={
                outcome === value
                  ? { borderColor: 'var(--brand)', background: 'var(--brand-faint)', color: 'var(--brand)' }
                  : { borderColor: 'var(--line)', color: 'var(--ink-2)' }
              }
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="mt-2 block text-sm">
        <span className="text-ink-2">
          {outcome === 'applied' ? 'Check again by' : 'Expires'}
        </span>
        <input
          type="date"
          value={expires}
          onChange={(e) => setExpires(e.target.value)}
          className="mt-0.5 w-full rounded-lg border px-3 py-2.5 text-base"
          style={{ borderColor: 'var(--line)' }}
        />
        {/* A date is required even for an application and an exemption,
            because a record with no date never expires and a clearance that
            never expires is the thing this screen exists to prevent. */}
        <span className="mt-0.5 block text-xs text-ink-3">
          {outcome === 'applied'
            ? 'An application still needs a date by which somebody looks again.'
            : kind === 'exemption'
              ? 'An exemption still gets a review date.'
              : 'As shown on the check.'}
        </span>
      </label>

      <label className="mt-2 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={kind === 'exemption'}
          onChange={(e) => setKind(e.target.checked ? 'exemption' : 'wwcc')}
        />
        <span>A teacher or police exemption</span>
      </label>

      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Anything worth noting"
        className="mt-2 w-full rounded-lg border px-3 py-2.5 text-base"
        style={{ borderColor: 'var(--line)' }}
      />

      {error && (
        <p className="mt-2 text-sm" style={{ color: 'var(--no)' }}>
          {error}
        </p>
      )}

      <button
        onClick={save}
        disabled={busy || !number.trim() || !expires}
        className="mt-2 w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        style={{ background: 'var(--brand)' }}
      >
        {busy ? 'Saving…' : row.number ? 'Update the record' : 'Record it'}
      </button>

      {row.verified_by && row.verified_at && (
        <p className="mt-1.5 text-xs text-ink-3">
          Last checked by {row.verified_by} on {when(row.verified_at)}
        </p>
      )}
    </div>
  )
}

function roleWord(role: string) {
  return role === 'owner' ? 'Owner' : role === 'admin' ? 'Club admin' : 'Coach'
}

function days(n: number) {
  if (n < 0) return `${Math.abs(n)} ${Math.abs(n) === 1 ? 'day' : 'days'} ago`
  if (n === 0) return 'today'
  return `${n} ${n === 1 ? 'day' : 'days'} left`
}

function when(value: string) {
  // A plain yyyy-mm-dd is read as UTC midnight by `new Date`, which shows the
  // previous day in Sydney. Split it instead.
  const [y, m, d] = value.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}
