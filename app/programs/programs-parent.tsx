'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AppBar, Screen } from '@/components/app-shell'
import { ScreenSkeleton } from '@/components/screen-skeleton'
import { Sheet } from '@/components/sheet'
import { QuestionField, type Question } from '@/components/question-field'
import { createClient } from '@/lib/supabase/client'
import { getOrg } from '@/lib/org'

type Program = {
  id: string
  name: string
  kind: string
  description: string | null
  born_from_year: number | null
  born_to_year: number | null
  gender: string | null
  capacity: number | null
  closes_at: string | null
  starts_on: string | null
  ends_on: string | null
  questions: Question[]
}

type Child = { id: string; full_name: string; dob: string | null; gender: string | null }

type Mine = {
  id: string
  program_id: string
  player_id: string
  status: string
  waitlist_position: number | null
}

/**
 * What a parent can sign their children up to.
 *
 * Children have no accounts, so every registration here is an adult acting
 * for a child — which is why the flow is "pick the program, then pick which of
 * your children", and not a form that asks who you are.
 *
 * Eligibility is shown rather than enforced only on submit. A parent of a
 * 2018 child looking at a 2014 program should see why they cannot register,
 * not press a button and be told off by the database.
 */
export function ProgramsParent() {
  const [academy, setAcademy] = useState<{ id: string; name: string } | null>(null)
  const [programs, setPrograms] = useState<Program[] | null>(null)
  const [children, setChildren] = useState<Child[]>([])
  const [mine, setMine] = useState<Mine[]>([])
  const [chosen, setChosen] = useState<Program | null>(null)
  // R-13: places offered after a trial, waiting on this family.
  const [offers, setOffers] = useState<{ id: string; player: string; squad: string | null; squad_program: string; expires_at: string; state: string }[]>([])

  const load = useCallback(async (academyId: string, me: string) => {
    const supabase = createClient()
    const [{ data: progs, error }, { data: links }] = await Promise.all([
      supabase
        .from('programs')
        .select('*')
        .eq('academy_id', academyId)
        .eq('status', 'open')
        .order('starts_on', { nullsFirst: false }),
      supabase.from('player_guardians').select('player_id').eq('profile_id', me),
    ])

    if (error && /does not exist|schema cache/i.test(error.message)) {
      return setPrograms([])
    }
    setPrograms((progs ?? []) as unknown as Program[])

    // A guardian with no children linked yet is a real state — a family
    // approved but not yet attached to a player. Asking for their children
    // with an empty id list would be a query that cannot match anything.
    const ids = (links ?? []).map((l) => l.player_id)
    const [kids, regs] = ids.length
      ? await Promise.all([
          supabase
            .from('players')
            .select('id, full_name, dob, gender')
            .in('id', ids)
            .then((r) => r.data),
          supabase
            .from('program_registrations')
            .select('id, program_id, player_id, status, waitlist_position')
            .in('player_id', ids)
            .then((r) => r.data),
        ])
      : [[], []]

    setChildren((kids ?? []) as unknown as Child[])
    setMine((regs ?? []) as unknown as Mine[])

    const { data: offered } = await supabase.rpc('my_offers')
    setOffers(((offered ?? []) as unknown as typeof offers).filter((o) => o.state === 'open'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const supabase = createClient()
    ;(async () => {
      const { data: claims } = await supabase.auth.getClaims()
      const me = claims?.claims?.sub
      if (!me) return window.location.replace('/signin')
      const chosenOrg = getOrg()
      const { data: academies } = await supabase.from('academies').select('id, name').order('name')
      const a = academies?.find((x) => x.id === chosenOrg) ?? academies?.[0]
      if (!a) return window.location.replace('/start')
      setAcademy(a)
      await load(a.id, me)
    })()
  }, [load])

  if (!academy || !programs) return <ScreenSkeleton />

  const registrationFor = (programId: string, playerId: string) =>
    mine.find((m) => m.program_id === programId && m.player_id === playerId)

  return (
    <>
      <AppBar title="Sign up" meta={academy.name} back="/" />
      <Screen>
        <div className="p-3.5">
          {offers.length > 0 && (
            <ul className="mb-3 flex flex-col gap-2">
              {offers.map((o) => (
                <li key={o.id}>
                  <Link
                    href={`/offer/${o.id}`}
                    className="card block p-4"
                    style={{ borderColor: 'var(--brand)' }}
                  >
                    <span className="eyebrow">A place is waiting</span>
                    <span className="mt-0.5 block font-semibold">
                      {o.player.split(' ')[0]} — {o.squad ?? o.squad_program}
                    </span>
                    <span className="block text-sm text-ink-3">
                      Accept by {new Date(o.expires_at).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })} ›
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {programs.length === 0 ? (
            <p className="card p-6 text-center text-sm text-ink-2">
              Nothing open at the moment. Your coach will let you know when there is.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {programs.map((p) => {
                const registered = children
                  .map((c) => registrationFor(p.id, c.id))
                  .filter(Boolean) as Mine[]
                return (
                  <li key={p.id} className="card p-4">
                    <h2 className="font-semibold">{p.name}</h2>
                    <p className="mt-0.5 text-sm text-ink-3">
                      {[label(p.kind), years(p), dates(p)].filter(Boolean).join(' · ')}
                    </p>
                    {p.description && <p className="mt-2 text-sm text-ink-2">{p.description}</p>}

                    {registered.length > 0 && (
                      <ul className="mt-2.5 flex flex-col gap-1">
                        {registered.map((r) => {
                          const child = children.find((c) => c.id === r.player_id)
                          return (
                            <li key={r.id} className="text-sm">
                              <b>{child?.full_name}</b>{' '}
                              <span style={{ color: tone(r.status) }}>{said(r)}</span>
                            </li>
                          )
                        })}
                      </ul>
                    )}

                    {/* Only offer it if somebody is actually eligible and not
                        already in. A button that exists to be refused is
                        worse than no button. */}
                    {children.some((c) => eligible(p, c) && !registrationFor(p.id, c.id)) && (
                      <button
                        onClick={() => setChosen(p)}
                        className="mt-3 w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-white"
                        style={{ background: 'var(--brand)' }}
                      >
                        {registered.length > 0 ? 'Sign up another child' : 'Sign up'}
                      </button>
                    )}

                    {children.length > 0 &&
                      !children.some((c) => eligible(p, c)) &&
                      registered.length === 0 && (
                        <p className="mt-2.5 text-xs text-ink-3">
                          {children.length === 1 ? 'Your child is' : 'Your children are'} outside
                          the birth years for this one.
                        </p>
                      )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </Screen>

      {chosen && academy && (
        <Register
          program={chosen}
          academyId={academy.id}
          eligible={children.filter((c) => eligible(chosen, c) && !registrationFor(chosen.id, c.id))}
          onClose={() => setChosen(null)}
          onDone={async () => {
            const supabase = createClient()
            const { data: claims } = await supabase.auth.getClaims()
            setChosen(null)
            if (claims?.claims?.sub) await load(academy.id, claims.claims.sub)
          }}
        />
      )}
    </>
  )
}

function Register({
  program,
  academyId,
  // Not `children`: that is React's own prop name, and passing a value for it
  // explicitly is both a lint error and a trap for the next person.
  eligible: eligibleChildren,
  onClose,
  onDone,
}: {
  program: Program
  academyId: string
  eligible: Child[]
  onClose: () => void
  onDone: () => void
}) {
  const [picked, setPicked] = useState<string[]>(
    eligibleChildren.length === 1 ? [eligibleChildren[0].id] : []
  )
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const questions = Array.isArray(program.questions) ? program.questions : []
  const missing = questions.filter((q) => q.required && !answers[q.id]?.trim())

  async function submit() {
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { data: claims } = await supabase.auth.getClaims()
    const me = claims?.claims?.sub
    if (!me) {
      setBusy(false)
      return setError('Your session has expired. Sign in again.')
    }

    // One row per child rather than one row for the family, because each
    // child is approved, waitlisted or refused on their own.
    const { error } = await supabase.from('program_registrations').insert(
      picked.map((player_id) => ({
        academy_id: academyId,
        program_id: program.id,
        player_id,
        submitted_by: me,
        answers,
        note: note.trim() || null,
      }))
    )
    setBusy(false)
    if (error) return setError(error.message)
    onDone()
  }

  return (
    <Sheet onClose={onClose}>
      <div className="p-4">
        <h2 className="display text-[22px] leading-tight">{program.name}</h2>
        <p className="mt-0.5 text-sm text-ink-2">
          {program.capacity
            ? 'Places are limited. If it fills up you go on the waitlist in the order you applied.'
            : 'Your coach will confirm.'}
        </p>

        <div className="mt-4 flex flex-col gap-3.5">
          <div>
            <span className="eyebrow">Who for</span>
            <div className="mt-1.5 flex flex-col gap-2">
              {eligibleChildren.map((c) => {
                const on = picked.includes(c.id)
                return (
                  <button
                    key={c.id}
                    onClick={() =>
                      setPicked(on ? picked.filter((id) => id !== c.id) : [...picked, c.id])
                    }
                    className="flex items-center gap-3 rounded-xl border p-3 text-left"
                    style={{
                      borderColor: on ? 'var(--brand)' : 'var(--line)',
                      background: on ? 'var(--surface-2)' : 'var(--surface)',
                    }}
                  >
                    <span
                      className="grid h-5 w-5 flex-none place-items-center rounded-md border text-xs"
                      style={{
                        borderColor: on ? 'var(--brand)' : 'var(--line)',
                        background: on ? 'var(--brand)' : 'transparent',
                        color: '#fff',
                      }}
                    >
                      {on ? '✓' : ''}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{c.full_name}</span>
                      {c.dob && (
                        <span className="block text-sm text-ink-3">
                          born {new Date(c.dob).getFullYear()}
                        </span>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {questions.map((q) => (
            <QuestionField
              key={q.id}
              question={q}
              value={answers[q.id] ?? ''}
              onChange={(v) => setAnswers({ ...answers, [q.id]: v })}
            />
          ))}

          <label className="flex flex-col gap-1.5">
            <span className="eyebrow">Anything the coach should know (optional)</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="rounded-xl border px-3.5 py-3 text-base"
              style={{ borderColor: 'var(--line)' }}
            />
          </label>

          {error && (
            <p className="rounded-lg p-2.5 text-sm" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>
              {error}
            </p>
          )}

          <button
            onClick={submit}
            disabled={busy || picked.length === 0 || missing.length > 0}
            className="rounded-xl px-4 py-3 font-semibold text-white disabled:opacity-50"
            style={{ background: 'var(--brand)' }}
          >
            {busy
              ? 'Sending…'
              : picked.length > 1
                ? `Sign up ${picked.length} children`
                : 'Sign up'}
          </button>
        </div>
      </div>
    </Sheet>
  )
}

/** Birth year, the same rule the database enforces. */
function eligible(p: Program, c: Child) {
  if (!c.dob) return true
  const year = new Date(c.dob).getFullYear()
  if (p.born_from_year && year < p.born_from_year) return false
  if (p.born_to_year && year > p.born_to_year) return false
  if (p.gender && c.gender && p.gender !== c.gender) return false
  return true
}

function said(r: Mine) {
  if (r.status === 'approved') return 'in'
  if (r.status === 'pending') return 'waiting to be confirmed'
  if (r.status === 'waitlisted') return `on the waitlist, number ${r.waitlist_position}`
  if (r.status === 'rejected') return 'not this time'
  return r.status
}

function tone(status: string) {
  if (status === 'approved') return 'var(--yes)'
  if (status === 'rejected') return 'var(--no)'
  if (status === 'waitlisted') return 'var(--maybe)'
  return 'var(--ink-3)'
}

function label(kind: string) {
  return (
    {
      squad: 'Squad',
      development: 'Development',
      trial: 'Trials',
      camp: 'Holiday camp',
      term_class: 'Term class',
      tournament: 'Tournament',
      tour: 'Tour',
      other: '',
    }[kind] ?? kind
  )
}

function years(p: Program) {
  if (!p.born_from_year && !p.born_to_year) return null
  if (p.born_from_year === p.born_to_year) return `born ${p.born_from_year}`
  return `born ${p.born_from_year ?? 'any'}–${p.born_to_year ?? 'any'}`
}

function dates(p: Program) {
  if (!p.starts_on) return null
  const from = new Date(p.starts_on).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
  if (!p.ends_on) return from
  return `${from} – ${new Date(p.ends_on).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}`
}
