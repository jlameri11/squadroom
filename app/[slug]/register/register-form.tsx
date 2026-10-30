'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ProgramSummary, money, type PublicProgram } from '../program-card'
import { QuestionField, unanswered } from '@/components/question-field'

type Program = PublicProgram

type Consent = {
  id: string
  kind: string
  title: string
  version: number
  body: string
  required: boolean
}

type Data = {
  academy: {
    name: string
    slug: string
    primary_colour: string
    logo_url: string | null
    timezone: string
  }
  programs: Program[]
  consents: Consent[]
}

const KEY = (slug: string) => `squadroom.registration.${slug}`
const DRAFT = (slug: string) => `squadroom.draft.${slug}`

type Draft = {
  step: 1 | 2 | 3
  chosen: string | null
  childName: string
  childDob: string
  childGender: string
  guardianName: string
  guardianPhone: string
  guardianEmail: string
  answers: Record<string, string>
  agreed: Record<string, boolean>
  savedAt: number
}

// Short enough to sit three abreast on a 375px phone without truncating.
const STEPS = ['Who’s playing', 'Details', 'Review & send'] as const

/**
 * Registering a child at a club that has never heard of you.
 *
 * No account, no login, no invite link — a parent who saw a flyer at a school
 * gate. The page is public, so it is also the only screen in the product a
 * stranger can reach, which shapes two things:
 *
 *   · it collects a child's name and date of birth, so it says plainly what
 *     happens to them and who sees them, above the button rather than behind
 *     a link. Buried honesty is not honesty.
 *   · it shows the consent documents it asks people to agree to. A checkbox
 *     next to a title nobody can read is not consent.
 *
 * THREE STEPS, and a draft that survives. A parent fills this in on a phone
 * at a bus stop, gets interrupted, and comes back; one long page that
 * forgot everything was the form most likely to be abandoned at the
 * agreements. Every field is kept in this browser as it is typed, and the
 * page reopens on the step they were on. Nothing is sent until "Send".
 *
 * THE FEE IS SHOWN, NOT TAKEN. The third step says what the fee is and when
 * it is paid — after the club accepts, in the app. Charging before a human
 * says yes means refunding everyone the club turns away (B-01).
 *
 * What comes back is a request id and a secret. The secret lives in this
 * browser and nowhere else: it is what lets THIS device collect the session
 * once the club approves, so a club accepting "Sam Whitfield" does not sign
 * in whoever else was forwarded the link.
 */
export function RegisterForm({ slug }: { slug: string }) {
  const [data, setData] = useState<Data | null | undefined>(undefined)
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [chosen, setChosen] = useState<string | null>(null)
  const [sent, setSent] = useState<{ requestId: string; secret: string } | null>(null)
  const [status, setStatus] = useState<'pending' | 'approved' | 'declined' | null>(null)
  const [resumed, setResumed] = useState(false)

  const [guardianName, setGuardianName] = useState('')
  const [guardianPhone, setGuardianPhone] = useState('')
  const [guardianEmail, setGuardianEmail] = useState('')
  const [childName, setChildName] = useState('')
  const [childDob, setChildDob] = useState('')
  const [childGender, setChildGender] = useState('')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [agreed, setAgreed] = useState<Record<string, boolean>>({})
  const [reading, setReading] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    createClient()
      .rpc('public_programs', { p_slug: slug })
      .then(({ data }) => setData((data as unknown as Data) ?? null))
    // A registration already made from this browser. Remembered so a parent
    // who comes back is told where they stand rather than filling it in
    // again and creating a second request.
    try {
      const saved = localStorage.getItem(KEY(slug))
      if (saved) setSent(JSON.parse(saved))
      // And a form half filled in. Picked up where they left off.
      const draft = localStorage.getItem(DRAFT(slug))
      if (draft && !saved) {
        const d = JSON.parse(draft) as Draft
        setStep(d.step ?? 1)
        setChosen(d.chosen ?? null)
        setChildName(d.childName ?? '')
        setChildDob(d.childDob ?? '')
        setChildGender(d.childGender ?? '')
        setGuardianName(d.guardianName ?? '')
        setGuardianPhone(d.guardianPhone ?? '')
        setGuardianEmail(d.guardianEmail ?? '')
        setAnswers(d.answers ?? {})
        setAgreed(d.agreed ?? {})
        setResumed(Boolean(d.childName || d.guardianName || d.chosen))
      }
    } catch {
      // A private window refuses storage. The form still works; the parent
      // just cannot be told the outcome on this device.
    }
    setHydrated(true)
  }, [slug])

  // The draft, kept as it is typed. Not before the restore has run, or the
  // first render's empty fields would overwrite what was saved.
  useEffect(() => {
    if (!hydrated || sent) return
    try {
      const d: Draft = {
        step, chosen, childName, childDob, childGender, guardianName, guardianPhone, guardianEmail,
        answers, agreed, savedAt: Date.now(),
      }
      localStorage.setItem(DRAFT(slug), JSON.stringify(d))
    } catch {
      /* no storage, no draft */
    }
  }, [hydrated, sent, slug, step, chosen, childName, childDob, childGender, guardianName, guardianPhone, guardianEmail, answers, agreed])

  // Once there is a request, ask where it stands. Not polled on a timer: a
  // club approving takes hours or days, and a page left open on a phone
  // should not spend the night talking to a server.
  useEffect(() => {
    if (!sent) return
    void (async () => {
      const res = await fetch('/api/register/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sent),
      })
      if (res.status === 200) {
        setStatus('approved')
        // The session cookie is already set by the claim. Straight in.
        window.location.replace('/')
        return
      }
      if (res.status === 202) setStatus('pending')
      else if (res.status === 403) setStatus('declined')
      else setStatus('pending')
    })()
  }, [sent])

  if (data === undefined) {
    return <Frame><p className="text-center text-sm text-ink-2">Loading…</p></Frame>
  }
  if (data === null) {
    return (
      <Frame>
        <h1 className="display text-xl">Not found</h1>
        <p className="mt-1 text-sm text-ink-2">
          Check the link with your club — this one does not point at a club we have.
        </p>
      </Frame>
    )
  }

  const tint = data.academy.primary_colour || 'var(--brand)'

  if (sent) {
    return (
      <Frame tint={tint} academy={data.academy.name}>
        <h1 className="display text-xl">
          {status === 'declined' ? 'Not this time' : 'Sent to the club'}
        </h1>
        <p className="mt-2 text-sm text-ink-2">
          {status === 'declined'
            ? `${data.academy.name} could not take this registration. They may be in touch.`
            : `${data.academy.name} will look at this and come back to you. Keep this page bookmarked on this phone — when they approve it, opening it signs you in.`}
        </p>
        {status !== 'declined' && (
          <p className="mt-3 text-xs text-ink-3">
            It has to be this phone. The link only works on the device that registered.
          </p>
        )}
        <button
          onClick={() => {
            try {
              localStorage.removeItem(KEY(slug))
            } catch {
              /* nothing to clear */
            }
            setSent(null)
            setStatus(null)
            setStep(1)
            setChosen(null)
            setChildName('')
            setChildDob('')
            setChildGender('')
            setAnswers({})
            setAgreed({})
          }}
          className="mt-5 text-sm underline underline-offset-4"
          style={{ color: tint }}
        >
          Register another child
        </button>
      </Frame>
    )
  }

  const program = data.programs.find((p) => p.id === chosen) ?? null
  const required = data.consents.filter((c) => c.required)
  const missing = required.filter((c) => !agreed[c.id])
  const full = program?.spots_left === 0
  const unansweredQs = unanswered(program?.questions, answers)

  const step1Ok = Boolean(program && childName.trim() && childDob)
  const step2Ok =
    Boolean(guardianName.trim()) &&
    Boolean(guardianPhone.trim() || guardianEmail.trim()) &&
    missing.length === 0 &&
    unansweredQs.length === 0

  async function submit() {
    if (!program) return
    setBusy(true)
    setError(null)
    const res = await fetch('/api/register/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug,
        programId: program.id,
        guardianName,
        guardianPhone: guardianPhone || undefined,
        guardianEmail: guardianEmail || undefined,
        childName,
        childDob,
        childGender: childGender || undefined,
        answers,
        consents: data!.consents
          .filter((c) => agreed[c.id])
          .map((c) => ({ id: c.id, version: c.version })),
      }),
    })
    setBusy(false)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return setError(body.error ?? 'Could not send your registration.')

    const saved = { requestId: body.requestId, secret: body.secret }
    try {
      localStorage.setItem(KEY(slug), JSON.stringify(saved))
      localStorage.removeItem(DRAFT(slug))
    } catch {
      // Nothing to do. The request is made; this device just will not be
      // able to collect the session automatically.
    }
    setSent(saved)
  }

  return (
    <Frame tint={tint} academy={data.academy.name}>
      <h1 className="display text-2xl">Register</h1>

      {data.programs.length === 0 ? (
        <p className="mt-2 text-sm text-ink-2">
          Nothing is open for registration right now. Ask the club when the next intake is.
        </p>
      ) : (
        <>
          <Progress step={step} tint={tint} />
          {resumed && step > 1 && (
            <p className="mt-2 text-xs text-ink-3">Picked up where you left off.</p>
          )}

          {step === 1 && (
            <>
              <section className="mt-4">
                <span className="eyebrow">What for</span>
                <div className="mt-1.5 flex flex-col gap-2">
                  {data.programs.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setChosen(p.id === chosen ? null : p.id)}
                      aria-pressed={p.id === chosen}
                      className="rounded-xl border p-3 text-left"
                      style={{
                        borderColor: p.id === chosen ? tint : 'var(--line)',
                        background: p.id === chosen ? 'var(--brand-faint)' : 'var(--surface)',
                      }}
                    >
                      {/* The same card the club's front door shows, so a program
                          reads identically on both. */}
                      <ProgramSummary program={p} />
                    </button>
                  ))}
                </div>
              </section>

              {program && (
                <>
                  {full && program.waitlist_enabled && (
                    <p
                      className="mt-4 rounded-lg border p-3 text-sm"
                      style={{ borderColor: 'var(--maybe)', color: 'var(--maybe)' }}
                    >
                      This one is full. You can still register and the club will put you on the
                      waitlist.
                    </p>
                  )}

                  <section className="mt-5">
                    <span className="eyebrow">Your child</span>
                    <Field label="Their full name" value={childName} onChange={setChildName} />
                    <Field
                      label="Date of birth"
                      type="date"
                      value={childDob}
                      onChange={setChildDob}
                      hint={
                        program.born_from_year
                          ? `This program is for children born ${program.born_from_year}–${
                              program.born_to_year ?? program.born_from_year
                            }.`
                          : undefined
                      }
                    />
                    <fieldset className="mt-3">
                      <legend className="text-sm text-ink-2">Gender</legend>
                      <div className="mt-1 flex gap-1.5">
                        {[
                          ['male', 'Boy'],
                          ['female', 'Girl'],
                          ['other', 'Other'],
                        ].map(([value, label]) => (
                          <button
                            key={value}
                            onClick={() => setChildGender(childGender === value ? '' : value)}
                            aria-pressed={childGender === value}
                            className="flex-1 rounded-lg border py-2 text-sm font-semibold"
                            style={
                              childGender === value
                                ? { borderColor: tint, background: 'var(--brand-faint)', color: tint }
                                : { borderColor: 'var(--line)', color: 'var(--ink-2)' }
                            }
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </fieldset>
                  </section>
                </>
              )}

              <button
                onClick={() => {
                  setStep(2)
                  window.scrollTo({ top: 0 })
                }}
                disabled={!step1Ok}
                className="mt-5 w-full rounded-xl px-4 py-3 font-semibold text-white disabled:opacity-50"
                style={{ background: tint }}
              >
                {!program ? 'Choose a program' : !childName.trim() || !childDob ? 'Fill in your child’s name and date of birth' : 'Continue'}
              </button>
            </>
          )}

          {step === 2 && program && (
            <>
              <section className="mt-4">
                <span className="eyebrow">You</span>
                <Field label="Your name" value={guardianName} onChange={setGuardianName} />
                <Field
                  label="Mobile"
                  type="tel"
                  value={guardianPhone}
                  onChange={setGuardianPhone}
                  hint="This is how the club replies, and how you sign in later."
                />
                <Field
                  label="Email (optional)"
                  type="email"
                  value={guardianEmail}
                  onChange={setGuardianEmail}
                />
              </section>

              {(program.questions ?? []).length > 0 && (
                <section className="mt-5">
                  <span className="eyebrow">{data.academy.name} asks</span>
                  {(program.questions ?? []).map((q) => (
                    <QuestionField
                      key={q.id}
                      question={q}
                      value={answers[q.id] ?? ''}
                      onChange={(v) => setAnswers({ ...answers, [q.id]: v })}
                      tint={tint}
                    />
                  ))}
                </section>
              )}

              {data.consents.length > 0 && (
                <section className="mt-5">
                  <span className="eyebrow">Agreements</span>
                  {data.consents.map((c) => (
                    <div key={c.id} className="mt-2">
                      <label className="flex gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={Boolean(agreed[c.id])}
                          onChange={(e) => setAgreed({ ...agreed, [c.id]: e.target.checked })}
                          className="mt-0.5 flex-none"
                        />
                        <span>
                          {c.title}
                          {c.required && <span style={{ color: 'var(--no)' }}> *</span>}
                          <button
                            onClick={(e) => {
                              e.preventDefault()
                              setReading(reading === c.id ? null : c.id)
                            }}
                            className="ml-1.5 underline underline-offset-2"
                            style={{ color: tint }}
                          >
                            {reading === c.id ? 'hide' : 'read it'}
                          </button>
                        </span>
                      </label>
                      {/* A checkbox next to a title nobody can read is not
                          consent. */}
                      {reading === c.id && (
                        <div
                          className="mt-1.5 max-h-56 overflow-y-auto rounded-lg border p-3 text-xs"
                          style={{ borderColor: 'var(--line)', color: 'var(--ink-2)' }}
                        >
                          <p className="mb-1 font-semibold">
                            {c.title} · version {c.version}
                          </p>
                          <p className="whitespace-pre-wrap">{c.body}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </section>
              )}

              <div className="mt-5 flex gap-2">
                <button
                  onClick={() => {
                    setStep(1)
                    window.scrollTo({ top: 0 })
                  }}
                  className="rounded-xl border px-4 py-3 text-sm"
                  style={{ borderColor: 'var(--line)' }}
                >
                  Back
                </button>
                <button
                  onClick={() => {
                    setStep(3)
                    window.scrollTo({ top: 0 })
                  }}
                  disabled={!step2Ok}
                  className="flex-1 rounded-xl px-4 py-3 font-semibold text-white disabled:opacity-50"
                  style={{ background: tint }}
                >
                  {!guardianName.trim()
                    ? 'Fill in your name'
                    : !guardianPhone.trim() && !guardianEmail.trim()
                      ? 'A mobile or an email'
                      : missing.length > 0
                        ? `Agree to the ${missing.length} required ${missing.length === 1 ? 'document' : 'documents'}`
                        : unansweredQs.length > 0
                          ? `Answer the ${unansweredQs.length === 1 ? 'required question' : `${unansweredQs.length} required questions`}`
                          : 'Continue'}
                </button>
              </div>
            </>
          )}

          {step === 3 && program && (
            <>
              <section className="mt-4">
                <span className="eyebrow">Check it over</span>
                <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 rounded-xl border p-3 text-sm" style={{ borderColor: 'var(--line)' }}>
                  <dt className="text-ink-3">Program</dt>
                  <dd className="font-medium">{program.name}</dd>
                  <dt className="text-ink-3">Child</dt>
                  <dd>
                    {childName}
                    {childDob ? `, born ${new Date(childDob + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
                  </dd>
                  <dt className="text-ink-3">You</dt>
                  <dd>
                    {guardianName}
                    {guardianPhone ? ` · ${guardianPhone}` : ''}
                    {guardianEmail ? ` · ${guardianEmail}` : ''}
                  </dd>
                  <dt className="text-ink-3">Agreed</dt>
                  <dd>{data.consents.filter((c) => agreed[c.id]).map((c) => c.title).join(', ') || 'Nothing yet'}</dd>
                </dl>
              </section>

              <section className="mt-4">
                <span className="eyebrow">The fee</span>
                <p className="mt-1.5 rounded-xl border p-3 text-sm" style={{ borderColor: 'var(--line)' }}>
                  {program.amount_cents != null ? (
                    <>
                      <b>{money(program.amount_cents)}</b>
                      {program.payment_required ? ' — paid after the club accepts, in the app.' : ' — the club will tell you when it is due.'}
                      {full ? ' Nothing is owed while you are on the waitlist.' : ''}
                    </>
                  ) : (
                    'No fee for this one.'
                  )}
                </p>
                <p className="mt-1.5 text-xs text-ink-3">
                  Nothing is charged now. A registration is a request the club has not accepted yet;
                  you pay once a person has said yes.
                </p>
              </section>

              {/* Above the button, not behind a link. This page collects a
                  child's name and date of birth from somebody who has never
                  dealt with us. */}
              <p className="mt-5 text-xs text-ink-3">
                What you enter goes to {data.academy.name} and to nobody else. Your child is a
                name on a team sheet — children do not get accounts here, and nothing about
                them is published. The club decides whether to accept the registration and
                will contact you either way.
              </p>

              {error && (
                <p
                  className="mt-3 rounded-lg border p-3 text-sm"
                  style={{ borderColor: 'var(--no)', color: 'var(--no)' }}
                >
                  {error}
                </p>
              )}

              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => {
                    setStep(2)
                    window.scrollTo({ top: 0 })
                  }}
                  className="rounded-xl border px-4 py-3 text-sm"
                  style={{ borderColor: 'var(--line)' }}
                >
                  Back
                </button>
                <button
                  onClick={submit}
                  disabled={busy || !step1Ok || !step2Ok}
                  className="flex-1 rounded-xl px-4 py-3 font-semibold text-white disabled:opacity-50"
                  style={{ background: tint }}
                >
                  {busy ? 'Sending…' : full ? 'Join the waitlist' : 'Send to the club'}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </Frame>
  )
}

/** Three steps, the current one in the club's colour. */
function Progress({ step, tint }: { step: 1 | 2 | 3; tint: string }) {
  return (
    <ol className="mt-3 flex gap-1.5" aria-label={`Step ${step} of 3: ${STEPS[step - 1]}`}>
      {STEPS.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3
        const done = n < step
        const current = n === step
        return (
          <li key={label} className="min-w-0 flex-1">
            <div
              className="h-1.5 rounded-full"
              style={{ background: done || current ? tint : 'var(--line)', opacity: done ? 0.5 : 1 }}
            />
            <span
              className="mt-1 block truncate text-[11px] font-semibold uppercase tracking-wide"
              style={{ color: current ? tint : 'var(--ink-3)' }}
            >
              {n}. {label}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function Frame({
  children,
  tint,
  academy,
}: {
  children: React.ReactNode
  tint?: string
  academy?: string
}) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-md">
      {academy && (
        <div className="px-4 pb-3 pt-4" style={{ background: tint ?? 'var(--brand)' }}>
          <p className="text-sm font-semibold" style={{ color: 'var(--brand-ink)' }}>
            {academy}
          </p>
        </div>
      )}
      <div className="p-5">{children}</div>
    </main>
  )
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  hint?: string
}) {
  return (
    <label className="mt-3 block text-sm">
      <span className="text-ink-2">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 w-full rounded-lg border px-3 py-2.5 text-base"
        style={{ borderColor: 'var(--line)' }}
      />
      {hint && <span className="mt-0.5 block text-xs text-ink-3">{hint}</span>}
    </label>
  )
}
