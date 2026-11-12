'use client'

import { EMAIL_SHAPE } from '@/lib/email'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ProgramSummary, money, type PublicProgram } from '../program-card'
import { QuestionField, unanswered } from '@/components/question-field'
import { clubThemeCss } from '@/lib/brand/colour'
import { cardFeeCents } from '@/lib/stripe/card-fee'
import { prepareImage } from '@/lib/adapters/images'

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
    /** 0269: the club's id, for a signed-in person's draft. */
    id?: string
    /** 0263: the club wants a passport-style photo with every registration. */
    photo_required?: boolean
    /** 0264: the club takes Active & Creative Kids vouchers (a provider, feature on). */
    active_kids?: boolean
    /** 0270: the club passes Stripe's card fee on, as its own line before paying. */
    card_fee_passthrough?: boolean
  }
  programs: Program[]
  consents: Consent[]
}

const KEY = (slug: string) => `squadroom.registration.${slug}`
const DRAFT = (slug: string) => `squadroom.draft.${slug}`
/** Every registration sent from this phone at this club, so a family pays for all of them in one go. */
const LIST = (slug: string) => `squadroom.registrations.${slug}`
type Sent = { requestId: string; secret: string; programId?: string | null; childName?: string; covered?: boolean }

type Draft = {
  step: 1 | 2 | 3
  chosen: string | null
  childName: string
  childDob: string
  childFfa?: string
  childFifa?: string
  childGender: string
  guardianName: string
  guardianPhone: string
  guardianEmail: string
  answers: Record<string, string>
  agreed: Record<string, boolean>
  savedAt: number
  /** 0267: a role's registration. */
  registerAs?: RegisterAs
  forSelf?: boolean
  wwccNumber?: string
  wwccExpiresOn?: string
  roleNote?: string
}

// Short enough to sit three abreast on a 375px phone without truncating.
const STEPS = ['Who’s playing', 'Details', 'Review & send'] as const

/** 0267: who the form registers. A role is an adult's own registration, for no program. */
type RegisterAs = 'player' | 'coach' | 'team_manager' | 'volunteer' | 'referee'
const ROLE_OPTIONS: [RegisterAs, string][] = [
  ['player', 'Player'],
  ['coach', 'Coach'],
  ['team_manager', 'Team manager'],
  ['volunteer', 'Volunteer'],
  ['referee', 'Referee'],
]

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
  const [sent, setSent] = useState<Sent | null>(null)
  // The other registrations sent from this phone (a second child), for one checkout.
  const [familyList, setFamilyList] = useState<Sent[]>([])
  const [status, setStatus] = useState<'pending' | 'approved' | 'declined' | null>(null)
  // 0263: the photo, cropped and resized in the browser, sent once the
  // request exists (it needs the request's secret), kept until then.
  const [photo, setPhoto] = useState<string | null>(null)
  const [photoNote, setPhotoNote] = useState<string | null>(null)
  // 0262: back from Stripe with ?paid=1 — read after mount, so the server and
  // the first paint agree.
  const [paid, setPaid] = useState(false)
  // 0264: an Active & Creative Kids voucher on a pay-now registration — the
  // number and, if it differs, the child's name as on the voucher.
  // 0269: save and resume beyond this browser — to the account when signed
  // in, by a code when not.
  const [me, setMe] = useState<string | null>(null)
  const [resumeCode, setResumeCode] = useState<string | null>(null)
  const [resumeOpen, setResumeOpen] = useState(false)
  const [enterCode, setEnterCode] = useState('')
  const [resumeError, setResumeError] = useState<string | null>(null)
  const [draftBusy, setDraftBusy] = useState(false)
  const [synced, setSynced] = useState(false)
  // 0268: the club's question, and the family's answer.
  const [infoNote, setInfoNote] = useState<string | null>(null)
  const [familyReply, setFamilyReply] = useState<string | null>(null)
  const [reply, setReply] = useState('')
  const [replyBusy, setReplyBusy] = useState(false)
  const [akOpen, setAkOpen] = useState(false)
  const [akNumber, setAkNumber] = useState('')
  const [akName, setAkName] = useState('')
  useEffect(() => {
    try {
      if (new URLSearchParams(window.location.search).get('paid') === '1') setPaid(true)
    } catch {
      /* no URL to read */
    }
  }, [])
  const [resumed, setResumed] = useState(false)

  const [guardianName, setGuardianName] = useState('')
  const [guardianPhone, setGuardianPhone] = useState('')
  const [guardianEmail, setGuardianEmail] = useState('')
  const [childName, setChildName] = useState('')
  const [childDob, setChildDob] = useState('')
  // 0239: an adult registering themselves — the "child" fields are theirs.
  const [forSelf, setForSelf] = useState(false)
  // 0267: a coach, team manager, volunteer or referee registering themselves,
  // with their Working With Children Check.
  const [registerAs, setRegisterAs] = useState<RegisterAs>('player')
  const [wwccNumber, setWwccNumber] = useState('')
  const [wwccExpiresOn, setWwccExpiresOn] = useState('')
  const [roleNote, setRoleNote] = useState('')
  // R-18: PlayFootball's ids, so the club can confirm the registration.
  const [childFfa, setChildFfa] = useState('')
  const [childFifa, setChildFifa] = useState('')
  const [childGender, setChildGender] = useState('')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [agreed, setAgreed] = useState<Record<string, boolean>>({})
  const [reading, setReading] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    let localSavedAt = 0
    createClient()
      .rpc('public_programs', { p_slug: slug })
      .then(({ data }) => setData((data as unknown as Data) ?? null))
    // A registration already made from this browser. Remembered so a parent
    // who comes back is told where they stand rather than filling it in
    // again and creating a second request.
    try {
      const saved = localStorage.getItem(KEY(slug))
      if (saved) {
        const s = JSON.parse(saved) as Sent
        setSent(s)
        if (s.programId) setChosen(s.programId)
      }
      setFamilyList(JSON.parse(localStorage.getItem(LIST(slug)) ?? '[]') as Sent[])
      // And a form half filled in. Picked up where they left off.
      const draft = localStorage.getItem(DRAFT(slug))
      if (draft && !saved) {
        const d = JSON.parse(draft) as Draft
        applyDraft(d)
        localSavedAt = d.savedAt ?? 0
      }
    } catch {
      // A private window refuses storage. The form still works; the parent
      // just cannot be told the outcome on this device.
    }
    setHydrated(true)
    // 0269: a signed-in person's draft lives against their account too, so
    // the phone they finish on need not be the one they started on. The
    // newer of the two wins.
    void (async () => {
      const supabase = createClient()
      const { data: claims } = await supabase.auth.getClaims()
      const uid = claims?.claims?.sub ?? null
      if (!uid) return
      setMe(uid)
      const { data: pub } = await supabase.rpc('public_programs', { p_slug: slug })
      const academyId = (pub as unknown as Data | null)?.academy?.id
      if (!academyId) return
      const { data: row } = await supabase.from('registration_drafts').select('draft, updated_at').eq('academy_id', academyId).eq('profile_id', uid).maybeSingle()
      const d = (row?.draft ?? null) as Draft | null
      if (d && (d.savedAt ?? 0) > localSavedAt) applyDraft(d)
      if (row) setSynced(true)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  // Every field from a draft — the browser's, the account's, or a code's.
  function applyDraft(d: Draft) {
    setStep(d.step ?? 1)
    setChosen(d.chosen ?? null)
    setChildName(d.childName ?? '')
    setChildDob(d.childDob ?? '')
    setChildFfa(d.childFfa ?? '')
    setChildFifa(d.childFifa ?? '')
    setChildGender(d.childGender ?? '')
    setGuardianName(d.guardianName ?? '')
    setGuardianPhone(d.guardianPhone ?? '')
    setGuardianEmail(d.guardianEmail ?? '')
    setAnswers(d.answers ?? {})
    setAgreed(d.agreed ?? {})
    setRegisterAs(d.registerAs ?? 'player')
    setForSelf(Boolean(d.registerAs && d.registerAs !== 'player') || Boolean(d.forSelf))
    setWwccNumber(d.wwccNumber ?? '')
    setWwccExpiresOn(d.wwccExpiresOn ?? '')
    setRoleNote(d.roleNote ?? '')
    setResumed(Boolean(d.childName || d.guardianName || d.chosen))
  }

  // 0269: the current form as a draft.
  function currentDraft(): Draft {
    return {
      step, chosen, childName, childDob, childFfa, childFifa, childGender, guardianName, guardianPhone, guardianEmail,
      answers, agreed, savedAt: Date.now(),
      registerAs, wwccNumber, wwccExpiresOn, roleNote, forSelf,
    }
  }

  // 0269: no account — a code to pick the draft up on another phone.
  async function saveForLater() {
    setDraftBusy(true)
    setResumeError(null)
    const res = await fetch('/api/register/draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', slug, draft: currentDraft() }) })
    const body = await res.json().catch(() => ({}))
    setDraftBusy(false)
    if (!res.ok) return setResumeError(body.error ?? 'Could not save it.')
    setResumeCode(body.code)
  }

  async function pickUp() {
    setDraftBusy(true)
    setResumeError(null)
    const res = await fetch('/api/register/draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'load', slug, code: enterCode }) })
    const body = await res.json().catch(() => ({}))
    setDraftBusy(false)
    if (!res.ok) return setResumeError(body.error ?? 'No draft with that code.')
    applyDraft(body.draft as Draft)
    setResumeCode(body.code)
    setResumeOpen(false)
  }

  // The draft, kept as it is typed. Not before the restore has run, or the
  // first render's empty fields would overwrite what was saved.
  useEffect(() => {
    if (!hydrated || sent) return
    const d: Draft = {
      step, chosen, childName, childDob, childFfa, childFifa, childGender, guardianName, guardianPhone, guardianEmail,
      answers, agreed, savedAt: Date.now(),
      registerAs, wwccNumber, wwccExpiresOn, roleNote, forSelf,
    }
    try {
      localStorage.setItem(DRAFT(slug), JSON.stringify(d))
    } catch {
      /* no storage, no draft */
    }
    // 0269: and against the account, a moment after the typing stops.
    if (!me || !data?.academy?.id) return
    const academyId = data.academy.id
    const t = setTimeout(async () => {
      const { error } = await createClient()
        .from('registration_drafts')
        .upsert({ academy_id: academyId, profile_id: me, draft: d as never, updated_at: new Date().toISOString(), expires_at: new Date(Date.now() + 14 * 864e5).toISOString() }, { onConflict: 'academy_id,profile_id' })
      if (!error) setSynced(true)
    }, 1200)
    return () => clearTimeout(t)
  }, [hydrated, sent, slug, step, chosen, childName, childDob, childFfa, childFifa, childGender, guardianName, guardianPhone, guardianEmail, answers, agreed, registerAs, wwccNumber, wwccExpiresOn, roleNote])

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
      if (res.status === 202) {
        setStatus('pending')
        // 0268: the club may have asked for something.
        const body = (await res.json().catch(() => ({}))) as { info_note?: string | null; family_reply?: string | null }
        setInfoNote(body.info_note ?? null)
        setFamilyReply(body.family_reply ?? null)
      } else if (res.status === 403) setStatus('declined')
      else setStatus('pending')
    })()
  }, [sent])

  // 0268: the family's answer to the club's question, with the request's secret.
  async function sendReply() {
    if (!sent || !reply.trim()) return
    setReplyBusy(true)
    const res = await fetch('/api/register/reply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: sent.requestId, secret: sent.secret, reply }) })
    setReplyBusy(false)
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error ?? 'Could not send that.')
    setFamilyReply(reply.trim())
    setReply('')
  }

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

  // The club's colours for this form only, light and dark (lib/brand/colour):
  // fills and borders are --brand, words in the club's colour --brand-text,
  // each already the shade that reads on this page.
  const tint = 'var(--brand)'
  const ink = 'var(--brand-ink)'
  const clubCss = clubThemeCss(data.academy.primary_colour, null, '[data-club-scope]')
  const logo = data.academy.logo_url

  if (sent) {
    const sentProgram = data.programs.find((p) => p.id === chosen) ?? null
    const payNow = sentProgram?.pay_timing === 'now' && sentProgram.payment_required && (sentProgram.amount_cents ?? 0) > 0 && status !== 'declined'
    // 0270: what the tap will charge — the fee less a voucher, plus the card
    // fee where the club passes it on (the route works the real figure out).
    const payNowCharge = Math.max(0, (sentProgram?.amount_cents ?? 0) - (akNumber.trim() ? 5000 : 0))
    const payNowFee = data.academy.card_fee_passthrough ? cardFeeCents(payNowCharge) : 0
    // The brief's "all into one checkout": the other pay-now registrations
    // sent from this phone, paid together with this one.
    const others = familyList.filter((e) => e.requestId !== sent.requestId && !e.covered && data.programs.find((p) => p.id === e.programId)?.pay_timing === 'now')
    const allCharge = payNowCharge + others.reduce((n, e) => n + (data.programs.find((p) => p.id === e.programId)?.amount_cents ?? 0), 0)
    const allFee = data.academy.card_fee_passthrough ? cardFeeCents(allCharge) : 0
    // Cents on a button that charges a card, as the card above it has them.
    const dollars = (c: number) => `$${(c / 100).toFixed(2)}`
    return (
      <Frame css={clubCss} logo={logo} academy={data.academy.name}>
        <h1 className="display text-xl">
          {status === 'declined' ? 'Not this time' : paid ? 'Paid and sent' : 'Sent to the club'}
        </h1>
        <p className="mt-2 text-sm text-ink-2">
          {status === 'declined'
            ? `${data.academy.name} could not take this registration. They may be in touch.`
            : paid
              ? `Stripe has your payment. ${data.academy.name} confirms the place; if they cannot take it, the fee comes back in full. Keep this page bookmarked on this phone — when they approve it, opening it signs you in.`
              : `${data.academy.name} will look at this and come back to you. Keep this page bookmarked on this phone — when they approve it, opening it signs you in.`}
        </p>
        {/* 0268: the club asked for something. Answered here, with the request's secret. */}
        {status === 'pending' && infoNote && (
          <div className="mt-4 rounded-xl border p-3.5" style={{ borderColor: 'var(--accent)' }} data-needs-info>
            <p className="text-sm">
              <b>{data.academy.name} asked:</b> “{infoNote}”
            </p>
            {familyReply ? (
              <p className="mt-2 text-sm text-ink-2" data-info-replied>You replied: “{familyReply}”</p>
            ) : (
              <>
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  rows={2}
                  placeholder="Your answer"
                  aria-label="Your answer to the club"
                  className="mt-2 w-full rounded-lg border px-3 py-2 text-base"
                  style={{ borderColor: 'var(--line)' }}
                  data-info-reply
                />
                <button
                  onClick={() => void sendReply()}
                  disabled={replyBusy || !reply.trim()}
                  className="mt-2 w-full rounded-xl px-4 py-3 text-sm font-semibold disabled:opacity-50"
                  style={{ background: tint, color: ink }}
                  data-info-send
                >
                  {replyBusy ? 'Sending…' : 'Send your answer'}
                </button>
                {error && <p className="mt-2 text-sm" style={{ color: 'var(--no)' }}>{error}</p>}
              </>
            )}
          </div>
        )}
        {/* 0264: the voucher covered the fee — nothing to pay, nothing for Stripe. */}
        {payNow && !paid && sent.covered && (
          <p className="mt-4 rounded-xl border p-3.5 text-sm" style={{ borderColor: 'var(--yes)', color: 'var(--yes)' }} data-ak-covered>
            Your Active &amp; Creative Kids voucher covers the fee — nothing to pay. {data.academy.name} will look at the registration and come back to you.
          </p>
        )}
        {/* 0262: a program that charges on submit — one tap to Stripe, refunded in full on a decline. */}
        {payNow && !paid && !sent.covered && (
          <div className="mt-4 rounded-xl border p-3.5" style={{ borderColor: 'var(--brand)' }} data-pay-now>
            <p className="text-sm">
              <b>{sentProgram.name}</b> is paid on registration: <b>{`$${((sentProgram.amount_cents ?? 0) / 100).toFixed(2)}`}</b>, refunded in full if the club cannot take the place.
            </p>
            {/* 0264: the NSW voucher, taken off before the charge. Only a club that takes them. */}
            {data.academy.active_kids && (
              <div className="mt-3" data-ak-pay-now>
                {!akOpen ? (
                  <button type="button" onClick={() => setAkOpen(true)} className="tap text-xs underline underline-offset-2" style={{ color: 'var(--brand-text)' }} data-ak-toggle>
                    Have an Active &amp; Creative Kids voucher? $50 off
                  </button>
                ) : (
                  <div className="rounded-lg border p-2.5" style={{ borderColor: 'var(--line)' }} data-ak-form>
                    <p className="text-xs text-ink-2">
                      The voucher number, and the child&apos;s name if it is written differently on the voucher. The club redeems it with Service NSW.
                    </p>
                    <input
                      value={akNumber}
                      onChange={(e) => setAkNumber(e.target.value)}
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="Voucher number"
                      aria-label="Voucher number"
                      className="mt-2 w-full rounded-lg border px-2 py-1.5 font-mono text-base tracking-wide"
                      style={{ borderColor: 'var(--line)' }}
                      data-ak-number
                    />
                    <input
                      value={akName}
                      onChange={(e) => setAkName(e.target.value)}
                      placeholder={childName ? `Name on the voucher, if not ${childName}` : 'Name on the voucher, if different'}
                      aria-label="Child's name on the voucher"
                      className="mt-2 w-full rounded-lg border px-2 py-1.5 text-sm"
                      style={{ borderColor: 'var(--line)' }}
                      data-ak-name
                    />
                    {akNumber.trim() && (
                      <p className="mt-2 text-xs" style={{ color: 'var(--yes)' }} data-ak-sum>
                        {(sentProgram.amount_cents ?? 0) > 5000
                          ? `$50.00 comes off: you pay $${(((sentProgram.amount_cents ?? 0) - 5000) / 100).toFixed(2)}.`
                          : 'The voucher covers the fee — nothing to pay.'}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
            <button
              onClick={async () => {
                setBusy(true)
                setError(null)
                const voucher = akNumber.trim() ? { number: akNumber, childName: akName } : undefined
                const res = await fetch('/api/register/pay', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: sent.requestId, secret: sent.secret, voucher }) })
                const body = await res.json().catch(() => ({}))
                setBusy(false)
                if (!res.ok) return setError(body.error ?? 'Could not start the payment.')
                if (body.covered) {
                  const next = { ...sent, covered: true }
                  try {
                    localStorage.setItem(KEY(slug), JSON.stringify(next))
                  } catch {
                    /* kept on screen; the club has it either way */
                  }
                  return setSent(next)
                }
                if (!body.url) return setError('Could not start the payment.')
                window.location.href = body.url
              }}
              disabled={busy}
              className="mt-3 w-full rounded-xl px-4 py-3 text-sm font-semibold disabled:opacity-50"
              style={{ background: tint, color: ink }}
              data-pay-now-button
            >
              {busy
                ? 'Opening Stripe…'
                : akNumber.trim() && (sentProgram.amount_cents ?? 0) <= 5000
                  ? 'Use the voucher'
                  : `Pay ${dollars(payNowCharge + payNowFee)}`}
            </button>
            {/* 0270: the card fee, said before the tap. */}
            {payNowFee > 0 && (
              <p className="mt-2 text-xs text-ink-2" data-card-fee={payNowFee}>
                Includes a card processing fee of {dollars(payNowFee)}, passed on by the club at Stripe&apos;s rate (1.7% + 30c).
              </p>
            )}
            {/* Two children from one phone: one checkout for all of them. */}
            {others.length > 0 && (
              <button
                onClick={async () => {
                  setBusy(true)
                  setError(null)
                  const res = await fetch('/api/register/pay', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requests: [sent, ...others].map((e) => ({ requestId: e.requestId, secret: e.secret })) }) })
                  const body = await res.json().catch(() => ({}))
                  setBusy(false)
                  if (!res.ok || !body.url) return setError(body.error ?? 'Could not start the payment.')
                  window.location.href = body.url
                }}
                disabled={busy}
                className="mt-2 w-full rounded-xl border px-4 py-3 text-sm font-semibold disabled:opacity-50"
                style={{ borderColor: tint, color: 'var(--brand-text)' }}
                data-pay-all-registrations={others.length + 1}
              >
                Pay for {[childName || sent.childName, ...others.map((e) => e.childName)].filter(Boolean).map((n) => String(n).split(' ')[0]).join(' and ')} in one go — {dollars(allCharge + allFee)}
              </button>
            )}
            {error && <p className="mt-2 text-sm" style={{ color: 'var(--no)' }}>{error}</p>}
          </div>
        )}
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
          style={{ color: 'var(--brand-text)' }}
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

  const forRole = registerAs !== 'player'
  const needsWwcc = registerAs === 'coach' || registerAs === 'team_manager' || registerAs === 'referee'
  const roleLabel = ROLE_OPTIONS.find(([v]) => v === registerAs)?.[1] ?? registerAs
  const step1Ok = Boolean((program || forRole) && childName.trim() && childDob) && (!needsWwcc || Boolean(wwccNumber.trim() && wwccExpiresOn))
  const step2Ok =
    Boolean(guardianName.trim()) &&
    EMAIL_SHAPE.test(guardianEmail.trim()) &&
    missing.length === 0 &&
    unansweredQs.length === 0 &&
    (!data.academy.photo_required || Boolean(photo))

  async function submit() {
    if (!program && !forRole) return
    setBusy(true)
    setError(null)
    const res = await fetch('/api/register/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug,
        programId: program?.id,
        guardianName,
        guardianPhone: guardianPhone || undefined,
        guardianEmail: guardianEmail || undefined,
        childName,
        childDob,
        forSelf: forSelf || forRole,
        // 0267: the role and the Working With Children Check.
        registerAs,
        wwccNumber: forRole ? wwccNumber || undefined : undefined,
        wwccExpiresOn: forRole ? wwccExpiresOn || undefined : undefined,
        roleNote: forRole ? roleNote || undefined : undefined,
        childFfa: childFfa || undefined,
        childFifa: childFifa || undefined,
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

    // The program too (0262), so a parent who comes back sees the right
    // "Pay now" for it.
    const saved: Sent = { requestId: body.requestId, secret: body.secret, programId: program?.id ?? null, childName }
    // Every registration from this phone, so a second child can be paid with the first.
    const list = [...familyList.filter((e) => e.requestId !== saved.requestId), saved].slice(-10)
    setFamilyList(list)
    try {
      localStorage.setItem(LIST(slug), JSON.stringify(list))
    } catch {
      /* no storage: one at a time */
    }
    // 0263: the photo rides after the request, with its secret.
    if (photo) {
      const up = await fetch('/api/register/photo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: saved.requestId, secret: saved.secret, image: photo }) })
      if (!up.ok) setPhotoNote((await up.json().catch(() => ({}))).error ?? 'The photo did not go through — add it again below.')
    }
    try {
      localStorage.setItem(KEY(slug), JSON.stringify(saved))
      localStorage.removeItem(DRAFT(slug))
    } catch {
      // Nothing to do. The request is made; this device just will not be
      // able to collect the session automatically.
    }
    // 0269: the draft has done its job, wherever it was kept.
    if (resumeCode) void fetch('/api/register/draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'clear', slug, code: resumeCode }) })
    if (me && data?.academy?.id) void createClient().from('registration_drafts').delete().eq('academy_id', data.academy.id).eq('profile_id', me)
    setSent(saved)
  }

  return (
    <Frame css={clubCss} logo={logo} academy={data.academy.name}>
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

          {/* 0269: finish on another phone. Signed in, the draft follows the account as you type;
              not signed in, a code does the same job. */}
          <div className="mt-2 text-xs text-ink-3" data-save-resume={me ? 'account' : resumeCode ? 'code' : 'none'}>
            {me ? (
              synced ? (
                <span data-draft-synced>Saved to your account as you go — open this page on any phone you&apos;re signed in on.</span>
              ) : (
                <span>Your draft is saved to your account as you type.</span>
              )
            ) : resumeCode ? (
              <span className="block rounded-lg border p-2.5" style={{ borderColor: 'var(--line)', color: 'var(--ink-2)' }} data-resume-code={resumeCode}>
                Your code is <b className="font-mono text-base tracking-wider" style={{ color: 'var(--ink)' }}>{resumeCode}</b>. On any phone, open this page and tap
                &ldquo;Pick up where I left off&rdquo;. It keeps for 14 days.
              </span>
            ) : resumeOpen ? (
              <span className="block rounded-lg border p-2.5" style={{ borderColor: 'var(--line)' }} data-resume-form>
                <label className="block text-ink-2">
                  The code from the other phone
                  <input
                    value={enterCode}
                    onChange={(e) => setEnterCode(e.target.value.toUpperCase())}
                    placeholder="ABC-234"
                    autoComplete="off"
                    className="mt-1 w-full rounded-lg border px-3 py-2 font-mono text-base tracking-wider"
                    style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
                    data-resume-input
                  />
                </label>
                <span className="mt-2 flex gap-2">
                  <button type="button" onClick={() => void pickUp()} disabled={draftBusy || enterCode.replace(/[^A-Z0-9]/g, '').length < 6} className="flex-1 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50" style={{ background: tint, color: ink }} data-resume-load>
                    {draftBusy ? 'Looking…' : 'Pick it up'}
                  </button>
                  <button type="button" onClick={() => { setResumeOpen(false); setResumeError(null) }} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--line)' }}>
                    Cancel
                  </button>
                </span>
                {resumeError && <span className="mt-1.5 block" style={{ color: 'var(--no)' }} data-resume-error>{resumeError}</span>}
              </span>
            ) : (
              <span className="flex flex-wrap gap-x-3 gap-y-1">
                <button type="button" onClick={() => void saveForLater()} disabled={draftBusy} className="tap underline underline-offset-2 disabled:opacity-50" data-save-draft>
                  {draftBusy ? 'Saving…' : 'Finish on another phone? Save and get a code'}
                </button>
                {!resumed && (
                  <button type="button" onClick={() => setResumeOpen(true)} className="tap underline underline-offset-2" data-resume-open>
                    Pick up where I left off
                  </button>
                )}
                {resumeError && <span className="block w-full" style={{ color: 'var(--no)' }} data-resume-error>{resumeError}</span>}
              </span>
            )}
          </div>

          {step === 1 && (
            <>
              {/* 0267: a player (a child, or yourself), or a role. */}
              <section className="mt-4" data-register-as={registerAs}>
                <span className="eyebrow">Register as</span>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {ROLE_OPTIONS.map(([value, label]) => (
                    <button
                      key={value}
                      onClick={() => {
                        setRegisterAs(value)
                        if (value !== 'player') {
                          setChosen(null)
                          setForSelf(true)
                        } else {
                          setForSelf(false)
                        }
                      }}
                      aria-pressed={registerAs === value}
                      className="min-w-fit flex-1 rounded-lg border px-2.5 py-2 text-sm font-semibold"
                      style={
                        registerAs === value
                          ? { borderColor: tint, background: 'var(--brand-faint)', color: 'var(--brand-text)' }
                          : { borderColor: 'var(--line)', color: 'var(--ink-2)' }
                      }
                      data-role-option={value}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </section>

              {!forRole && (
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
              )}

              {(program || forRole) && (
                <>
                  {full && program?.waitlist_enabled && (
                    <p
                      className="mt-4 rounded-lg border p-3 text-sm"
                      style={{ borderColor: 'var(--maybe)', color: 'var(--maybe)' }}
                    >
                      This one is full. You can still register and the club will put you on the
                      waitlist.
                    </p>
                  )}

                  <section className="mt-5">
                    <span className="eyebrow">{forSelf ? 'You' : 'Your child'}</span>
                    {!forRole && (
                      <label className="mt-2 flex items-start gap-2.5 text-sm text-ink-2">
                        <input
                          type="checkbox"
                          checked={forSelf}
                          onChange={(e) => {
                            setForSelf(e.target.checked)
                            if (e.target.checked && !childName.trim() && guardianName.trim()) setChildName(guardianName)
                          }}
                          className="mt-0.5 h-4 w-4 flex-none"
                          data-register-for-self
                        />
                        <span>I&apos;m registering myself (I&apos;m 18 or over)</span>
                      </label>
                    )}
                    <Field label={forSelf ? 'Your full name' : 'Their full name'} value={childName} onChange={setChildName} />
                    <Field
                      label={forSelf ? 'Your date of birth' : 'Date of birth'}
                      type="date"
                      value={childDob}
                      onChange={setChildDob}
                      hint={
                        forRole
                          ? 'You need to be 18 or over.'
                          : program?.born_from_year
                            ? `This program is for children born ${program.born_from_year}–${
                                program.born_to_year ?? program.born_from_year
                              }.`
                            : undefined
                      }
                    />
                    {/* 0267: a role's Working With Children Check, and a word on where they would like to help. */}
                    {forRole && (
                      <>
                        <p className="mt-3 rounded-lg border p-3 text-sm" style={{ borderColor: 'var(--line)', color: 'var(--ink-2)' }}>
                          {needsWwcc
                            ? 'A coach, manager or referee gives their Working With Children Check number and expiry, as on the Service NSW letter. The club checks it on the register before you start.'
                            : 'If you hold a Working With Children Check, give the number and its expiry; the club checks it on the register.'}
                        </p>
                        <Field
                          label={needsWwcc ? 'Working With Children Check number' : 'Working With Children Check number (if you have one)'}
                          value={wwccNumber}
                          onChange={setWwccNumber}
                          hint="For example WWC1234567E."
                        />
                        <Field label="WWCC expiry date" type="date" value={wwccExpiresOn} onChange={setWwccExpiresOn} />
                        <label className="mt-3 flex flex-col gap-1.5">
                          <span className="eyebrow">Which team or age group would you like to help with? (optional)</span>
                          <textarea
                            value={roleNote}
                            onChange={(e) => setRoleNote(e.target.value)}
                            rows={2}
                            className="rounded-xl border px-3.5 py-3 text-base"
                            style={{ borderColor: 'var(--line)' }}
                            data-role-note
                          />
                        </label>
                      </>
                    )}
                    {!forRole && program?.requires_official_rego && (
                      <p className="mt-3 rounded-lg border p-3 text-sm" style={{ borderColor: 'var(--line)', color: 'var(--ink-2)' }}>
                        This program is for players registered in <b>PlayFootball</b> first (Football
                        Australia&apos;s rule). Register there if you haven&apos;t, then give the FFA number
                        or FIFA ID below so the club can confirm it.
                      </p>
                    )}
                    {!forRole && (
                    <>
                    <Field
                      label={program?.requires_official_rego ? 'FFA number' : 'FFA number (if registered in PlayFootball)'}
                      value={childFfa}
                      onChange={setChildFfa}
                      hint="On the PlayFootball profile, digits only."
                    />
                    <Field label="FIFA ID (optional)" value={childFifa} onChange={setChildFifa} />
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
                                ? { borderColor: tint, background: 'var(--brand-faint)', color: 'var(--brand-text)' }
                                : { borderColor: 'var(--line)', color: 'var(--ink-2)' }
                            }
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </fieldset>
                    </>
                    )}
                  </section>
                </>
              )}

              <button
                onClick={() => {
                  // A role is the person's own: their name is the contact name too.
                  if (forRole && !guardianName.trim()) setGuardianName(childName)
                  setStep(2)
                  window.scrollTo({ top: 0 })
                }}
                disabled={!step1Ok}
                className="mt-5 w-full rounded-xl px-4 py-3 font-semibold disabled:opacity-50"
                style={{ background: tint, color: ink }}
              >
                {!program && !forRole
                  ? 'Choose a program'
                  : !childName.trim() || !childDob
                    ? forRole ? 'Fill in your name and date of birth' : 'Fill in your child’s name and date of birth'
                    : needsWwcc && !(wwccNumber.trim() && wwccExpiresOn)
                      ? 'Your WWCC number and expiry'
                      : 'Continue'}
              </button>
            </>
          )}

          {step === 2 && (program || forRole) && (
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
                  label="Email"
                  type="email"
                  value={guardianEmail}
                  onChange={setGuardianEmail}
                  hint="Any email you read — it doesn’t have to match PlayFootball."
                />
              </section>

              {/* 0263: a passport-style photo — the player card and the referee's ID. */}
              <section className="mt-5" data-photo-step={photo ? 'picked' : data.academy.photo_required ? 'required' : 'optional'}>
                <span className="eyebrow">A photo of {forSelf ? 'you' : childName.split(' ')[0] || 'the child'}{data.academy.photo_required ? '' : ' (optional)'}</span>
                <p className="mt-1.5 text-sm text-ink-2">Like a passport photo: face in full view, no hat or sunglasses, plain background, taken in the last six months. Only the club sees it until they accept; then it is on the player card and the referee&apos;s team sheet.</p>
                <PhotoPicker value={photo} onChange={(v) => { setPhoto(v); setPhotoNote(null) }} tint={tint} ink={ink} />
                {photoNote && <p className="mt-1.5 text-xs" style={{ color: 'var(--no)' }}>{photoNote}</p>}
              </section>

              {(program?.questions ?? []).length > 0 && (
                <section className="mt-5">
                  <span className="eyebrow">{data.academy.name} asks</span>
                  {(program?.questions ?? []).map((q) => (
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
                            style={{ color: 'var(--brand-text)' }}
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
                  className="flex-1 rounded-xl px-4 py-3 font-semibold disabled:opacity-50"
                  style={{ background: tint, color: ink }}
                >
                  {!guardianName.trim()
                    ? 'Fill in your name'
                    : !EMAIL_SHAPE.test(guardianEmail.trim())
                      ? 'Your email'
                      : missing.length > 0
                        ? `Agree to the ${missing.length} required ${missing.length === 1 ? 'document' : 'documents'}`
                        : unansweredQs.length > 0
                          ? `Answer the ${unansweredQs.length === 1 ? 'required question' : `${unansweredQs.length} required questions`}`
                          : 'Continue'}
                </button>
              </div>
            </>
          )}

          {step === 3 && (program || forRole) && (
            <>
              <section className="mt-4">
                <span className="eyebrow">Check it over</span>
                <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 rounded-xl border p-3 text-sm" style={{ borderColor: 'var(--line)' }}>
                  {forRole ? (
                    <>
                      <dt className="text-ink-3">Registering as</dt>
                      <dd className="font-medium" data-review-role>{roleLabel}</dd>
                      {wwccNumber.trim() && (
                        <>
                          <dt className="text-ink-3">WWCC</dt>
                          <dd>
                            {wwccNumber.trim().toUpperCase()}
                            {wwccExpiresOn ? `, expires ${new Date(wwccExpiresOn + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
                          </dd>
                        </>
                      )}
                      {roleNote.trim() && (
                        <>
                          <dt className="text-ink-3">Where</dt>
                          <dd>{roleNote.trim()}</dd>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <dt className="text-ink-3">Program</dt>
                      <dd className="font-medium">{program?.name}</dd>
                    </>
                  )}
                  <dt className="text-ink-3">{forSelf || forRole ? 'You' : 'Child'}</dt>
                  <dd>
                    {childName}
                    {childDob ? `, born ${new Date(childDob + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
                  </dd>
                  {photo && (
                    <>
                      <dt className="text-ink-3">Photo</dt>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <dd><img src={photo} alt="" className="h-20 w-[60px] rounded-md object-cover" style={{ border: '1px solid var(--line)' }} data-photo-review /></dd>
                    </>
                  )}
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
                  {program?.amount_cents != null ? (
                    <>
                      <b>{money(program.amount_cents)}</b>
                      {program?.payment_required ? ' — paid after the club accepts, in the app.' : ' — the club will tell you when it is due.'}
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
                What you enter goes to {data.academy.name} and to nobody else.
                {forSelf || forRole
                  ? ' Nothing about you is published.'
                  : ' Your child is a name on a team sheet — children do not get accounts here, and nothing about them is published.'}{' '}
                The club decides whether to accept the registration and will contact you either way.
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
                  className="flex-1 rounded-xl px-4 py-3 font-semibold disabled:opacity-50"
                  style={{ background: tint, color: ink }}
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
              className="mt-1 block truncate text-[0.6875rem] font-semibold uppercase tracking-wide"
              style={{ color: current ? 'var(--brand-text)' : 'var(--ink-3)' }}
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
  css,
  logo,
  academy,
}: {
  children: React.ReactNode
  css?: string
  logo?: string | null
  academy?: string
}) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-md" data-club-scope>
      {css && <style>{css}</style>}
      {academy && (
        <div className="flex items-center gap-2.5 px-4 pb-3 pt-4" style={{ background: 'var(--bar)', color: 'var(--bar-ink)', borderBottom: '1px solid var(--bar-line)' }}>
          {logo && (
            // eslint-disable-next-line @next/next/no-img-element -- the club's own file, any format
            <img src={logo} alt="" className="h-8 w-8 flex-none rounded-lg bg-white object-contain p-0.5" data-club-logo />
          )}
          <p className="text-sm font-semibold">{academy}</p>
        </div>
      )}
      <div className="p-5">{children}</div>
    </main>
  )
}

/**
 * 0263: the photo picker. Cropped to portrait and resized in the browser
 * (lib/adapters/images.ts does the resize), so what goes up is small and
 * the shape a card wants; the family sees exactly what the club will.
 */
function PhotoPicker({ value, onChange, tint, ink }: { value: string | null; onChange: (v: string | null) => void; tint: string; ink: string }) {
  const [busy, setBusy] = useState(false)
  async function pick(file: File | undefined) {
    if (!file) return
    setBusy(true)
    try {
      const { blob } = await prepareImage(file, { maxEdge: 900, quality: 0.82 })
      const bitmap = await createImageBitmap(blob)
      // Portrait, 3:4, from the middle — a passport crop.
      const w = Math.min(bitmap.width, Math.round(bitmap.height * 0.75))
      const h = Math.min(bitmap.height, Math.round(w / 0.75))
      const canvas = document.createElement('canvas')
      canvas.width = 600
      canvas.height = 800
      canvas.getContext('2d')!.drawImage(bitmap, (bitmap.width - w) / 2, (bitmap.height - h) / 2, w, h, 0, 0, 600, 800)
      onChange(canvas.toDataURL('image/jpeg', 0.85))
    } catch {
      onChange(null)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mt-2 flex items-center gap-3">
      {value ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={value} alt="" className="h-28 w-[84px] flex-none rounded-lg object-cover" style={{ border: '1px solid var(--line)' }} data-photo-preview />
      ) : (
        <div className="grid h-28 w-[84px] flex-none place-items-center rounded-lg text-xs text-ink-3" style={{ border: '1px dashed var(--line)' }}>3:4</div>
      )}
      <div className="flex min-w-0 flex-col gap-2">
        <label className="inline-block cursor-pointer rounded-xl px-4 py-2.5 text-center text-sm font-semibold" style={{ background: tint, color: ink }}>
          {busy ? 'Reading…' : value ? 'Change photo' : 'Add a photo'}
          <input type="file" accept="image/*" capture="user" className="sr-only" onChange={(e) => void pick(e.target.files?.[0])} data-photo-input />
        </label>
        {value && (
          <button type="button" onClick={() => onChange(null)} className="text-left text-xs underline underline-offset-4 text-ink-2" data-photo-remove>Remove</button>
        )}
      </div>
    </div>
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
