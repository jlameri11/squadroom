'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AppBar, Screen } from '@/components/app-shell'
import { ScreenSkeleton } from '@/components/screen-skeleton'
import { Sheet } from '@/components/sheet'
import { createClient } from '@/lib/supabase/client'
import { getOrg } from '@/lib/org'

export type Program = {
  id: string
  name: string
  kind: 'squad' | 'development' | 'trial' | 'camp' | 'term_class' | 'tournament' | 'tour' | 'other'
  status: 'draft' | 'open' | 'closed'
  season: string | null
  born_from_year: number | null
  born_to_year: number | null
  capacity: number | null
  opens_at: string | null
  closes_at: string | null
  counts: { pending: number; approved: number; waitlisted: number }
}

type Kind = Program['kind']

const KINDS: { value: Kind; label: string; hint: string }[] = [
  { value: 'squad', label: 'Squad', hint: 'A season in a team' },
  { value: 'development', label: 'Development', hint: 'Weekly skills program' },
  { value: 'trial', label: 'Trials', hint: 'Selection for a squad' },
  { value: 'camp', label: 'Holiday camp', hint: 'School holidays' },
  { value: 'term_class', label: 'Term class', hint: 'Weekly, by term' },
  { value: 'tournament', label: 'Tournament entry', hint: 'A gala day or cup' },
  { value: 'tour', label: 'Tour', hint: 'Away, overnight' },
  { value: 'other', label: 'Something else', hint: '' },
]

/**
 * What families can sign up to.
 *
 * One screen for squads, development, trials, camps, term classes, tournament
 * entries and tours, because they differ by kind, price and dates rather than
 * by shape — and seven screens would drift apart within a season.
 */
export function ProgramsScreen() {
  const [academy, setAcademy] = useState<{ id: string; name: string } | null>(null)
  const [programs, setPrograms] = useState<Program[] | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async (academyId: string) => {
    const { data, error } = await createClient()
      .from('programs')
      .select('*, program_registrations(status)')
      .eq('academy_id', academyId)
      .order('created_at', { ascending: false })

    // The table arrives with 0083. Saying so plainly beats an empty list that
    // looks like the feature working and finding nothing.
    if (error && /does not exist|schema cache/i.test(error.message)) {
      setUnavailable(true)
      return setPrograms([])
    }

    setPrograms(
      (data ?? []).map((p) => {
        const regs = (p.program_registrations ?? []) as { status: string }[]
        return {
          ...p,
          counts: {
            pending: regs.filter((r) => r.status === 'pending').length,
            approved: regs.filter((r) => r.status === 'approved').length,
            waitlisted: regs.filter((r) => r.status === 'waitlisted').length,
          },
        } as Program
      })
    )
  }, [])

  useEffect(() => {
    const supabase = createClient()
    ;(async () => {
      const { data: claims } = await supabase.auth.getClaims()
      if (!claims?.claims?.sub) return window.location.replace('/signin')
      // Respect the organisation the switcher chose, rather than taking the
      // alphabetically first one as the older admin screens do.
      const chosen = getOrg()
      const { data: academies } = await supabase.from('academies').select('id, name').order('name')
      const mine = academies?.find((a) => a.id === chosen) ?? academies?.[0]
      if (!mine) return window.location.replace('/start')
      setAcademy(mine)
      await load(mine.id)
    })()
  }, [load])

  if (!academy || !programs) return <ScreenSkeleton />

  const open = programs.filter((p) => p.status === 'open')
  const other = programs.filter((p) => p.status !== 'open')
  const waiting = programs.reduce((n, p) => n + p.counts.pending, 0)

  return (
    <>
      <AppBar
        title="Programs"
        meta={academy.name}
        back="/admin"
        action={
          !unavailable && (
            <button
              onClick={() => setCreating(true)}
              className="flex-none rounded-[10px] px-3 py-1.5 text-sm font-semibold"
              style={{ background: '#ffffff26', color: 'var(--brand-ink)' }}
            >
              New
            </button>
          )
        }
      />

      <Screen>
        <div className="p-3.5">
          {unavailable ? (
            <p className="card p-6 text-center text-sm text-ink-2">
              Registration isn&apos;t switched on for this database yet. Someone needs to apply
              migration 0083.
            </p>
          ) : programs.length === 0 ? (
            <div className="card p-6 text-center">
              <p className="text-sm text-ink-2">
                Nothing to sign up to yet. A program is anything a family registers for — a squad
                season, a holiday camp, trials, a tour.
              </p>
              <button
                onClick={() => setCreating(true)}
                className="mt-3 rounded-xl px-4 py-2.5 text-sm font-semibold text-white"
                style={{ background: 'var(--brand)' }}
              >
                Create the first one
              </button>
            </div>
          ) : (
            <>
              {waiting > 0 && (
                <p
                  className="mb-3.5 rounded-[14px] p-3 text-sm text-white"
                  style={{ background: 'var(--accent)' }}
                >
                  <b>
                    {waiting} {waiting === 1 ? 'registration' : 'registrations'} waiting
                  </b>
                  <span className="block opacity-90">
                    Families see &ldquo;pending&rdquo; until somebody decides.
                  </span>
                </p>
              )}

              {open.length > 0 && (
                <>
                  <h2 className="eyebrow px-1 pb-2">Open now</h2>
                  <ul className="card mb-5 overflow-hidden">
                    {open.map((p) => (
                      <ProgramRow key={p.id} program={p} />
                    ))}
                  </ul>
                </>
              )}

              {other.length > 0 && (
                <>
                  <h2 className="eyebrow px-1 pb-2">Drafts and closed</h2>
                  <ul className="card overflow-hidden">
                    {other.map((p) => (
                      <ProgramRow key={p.id} program={p} />
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </div>
      </Screen>

      {creating && (
        <NewProgram
          academyId={academy.id}
          onClose={() => setCreating(false)}
          onCreated={async () => {
            setCreating(false)
            await load(academy.id)
          }}
        />
      )}
    </>
  )
}

function ProgramRow({ program: p }: { program: Program }) {
  const kind = KINDS.find((k) => k.value === p.kind)?.label ?? p.kind
  const years =
    p.born_from_year && p.born_to_year
      ? p.born_from_year === p.born_to_year
        ? `born ${p.born_from_year}`
        : `born ${p.born_from_year}–${p.born_to_year}`
      : null

  return (
    <li>
      <Link href={`/admin/programs/${p.id}`} className="row justify-between">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate font-medium">{p.name}</span>
            {p.status === 'draft' && (
              <span className="tag flex-none" style={{ background: 'var(--surface-2)', color: 'var(--ink-3)' }}>
                draft
              </span>
            )}
          </span>
          <span className="block truncate text-sm text-ink-3">
            {[kind, years, p.season].filter(Boolean).join(' · ')}
          </span>
        </span>

        <span className="flex flex-none items-center gap-2">
          {p.counts.pending > 0 && (
            <span
              className="grid h-6 min-w-6 place-items-center rounded-full px-1.5 text-xs font-bold text-white"
              style={{ background: 'var(--accent)' }}
            >
              {p.counts.pending}
            </span>
          )}
          <span className="text-xs tabular-nums text-ink-3">
            {p.capacity ? `${p.counts.approved}/${p.capacity}` : p.counts.approved || ''}
          </span>
          <span className="text-lg text-ink-3">›</span>
        </span>
      </Link>
    </li>
  )
}

/**
 * Creating one.
 *
 * Birth years rather than an age group, and the field says so. An academy
 * that types "U10" has to work out which years that is every season; an
 * academy that types 2016 has said something that is still true next year.
 */
function NewProgram({
  academyId,
  onClose,
  onCreated,
}: {
  academyId: string
  onClose: () => void
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<Kind>('camp')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [capacity, setCapacity] = useState('')
  const [closes, setCloses] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const thisYear = new Date().getFullYear()

  async function create(status: 'draft' | 'open') {
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { data: claims } = await supabase.auth.getClaims()
    const { error } = await supabase.from('programs').insert({
      academy_id: academyId,
      name: name.trim(),
      kind,
      status,
      season: String(thisYear),
      born_from_year: from ? Number(from) : null,
      born_to_year: to ? Number(to) : null,
      capacity: capacity ? Number(capacity) : null,
      closes_at: closes ? new Date(`${closes}T23:59:59`).toISOString() : null,
      created_by: claims?.claims?.sub,
    })
    setBusy(false)
    if (error) return setError(error.message)
    onCreated()
  }

  return (
    <Sheet onClose={onClose}>
      <div className="p-4">
        <h2 className="display text-[22px] leading-tight">New program</h2>
        <p className="mt-0.5 text-sm text-ink-2">
          Anything a family signs up to. You can open it now or keep it as a draft.
        </p>

        <div className="mt-4 flex flex-col gap-3.5">
          <label className="flex flex-col gap-1.5">
            <span className="eyebrow">What is it called</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="January Holiday Camp"
              className="rounded-xl border px-3.5 py-3 text-base"
              style={{ borderColor: 'var(--line)' }}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="eyebrow">Kind</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as Kind)}
              className="rounded-xl border px-3.5 py-3 text-base"
              style={{ borderColor: 'var(--line)' }}
            >
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                  {k.hint ? ` — ${k.hint}` : ''}
                </option>
              ))}
            </select>
          </label>

          <div>
            <span className="eyebrow">Who can register</span>
            <p className="mb-1.5 mt-0.5 text-xs text-ink-3">
              Birth years, not an age group. A January and a December child are the same football
              age all season, and an age is wrong a week later.
            </p>
            <div className="flex items-center gap-2">
              <input
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                inputMode="numeric"
                placeholder={String(thisYear - 12)}
                className="min-w-0 flex-1 rounded-xl border px-3 py-3 text-center text-base tabular-nums"
                style={{ borderColor: 'var(--line)' }}
              />
              <span className="flex-none text-sm text-ink-3">to</span>
              <input
                value={to}
                onChange={(e) => setTo(e.target.value)}
                inputMode="numeric"
                placeholder={String(thisYear - 8)}
                className="min-w-0 flex-1 rounded-xl border px-3 py-3 text-center text-base tabular-nums"
                style={{ borderColor: 'var(--line)' }}
              />
            </div>
          </div>

          <div className="flex gap-2">
            <label className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="eyebrow">Places</span>
              <input
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                inputMode="numeric"
                placeholder="no limit"
                className="rounded-xl border px-3.5 py-3 text-base"
                style={{ borderColor: 'var(--line)' }}
              />
            </label>
            <label className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="eyebrow">Closes</span>
              <input
                type="date"
                value={closes}
                onChange={(e) => setCloses(e.target.value)}
                className="rounded-xl border px-3.5 py-3 text-base"
                style={{ borderColor: 'var(--line)' }}
              />
            </label>
          </div>

          {capacity && (
            <p className="text-xs text-ink-3">
              Past {capacity}, families go on a waitlist in the order they applied rather than
              being turned away.
            </p>
          )}

          {error && (
            <p className="rounded-lg p-2.5 text-sm" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => create('open')}
              disabled={busy || !name.trim()}
              className="flex-1 rounded-xl px-4 py-3 font-semibold text-white disabled:opacity-50"
              style={{ background: 'var(--brand)' }}
            >
              {busy ? 'Creating…' : 'Create and open'}
            </button>
            <button
              onClick={() => create('draft')}
              disabled={busy || !name.trim()}
              className="rounded-xl border px-4 py-3 font-medium disabled:opacity-50"
              style={{ borderColor: 'var(--line)' }}
            >
              Draft
            </button>
          </div>
        </div>
      </div>
    </Sheet>
  )
}
