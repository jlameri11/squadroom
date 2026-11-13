'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { isPublicPage } from '@/lib/routes'
import { deviceLabel, deviceToken } from '@/lib/two-step/device'

type Status = {
  required: boolean
  where: string | null
  enrolled: boolean
  aal2: boolean
  passed: boolean
  ok: boolean
  trusted_until: string | null
}

/** The last answer, for the life of the tab: asked again after a minute, or at once when it was asking for a code. */
let known: { at: number; status: Status | null } | null = null
const KNOWN_FOR_MS = 60_000
type Sent = { channel: 'sms' | 'email' | 'demo'; to: string; dev_code?: string; wait?: number }
type Enrolling = { factorId: string; qr: string; secret: string }
type Phase = 'device' | 'sending' | 'code' | 'no-delivery' | 'totp'

/**
 * The second step, for the people who run things (S-07; 0231, and 0232 as
 * Joey changed it on 9 Nov 2026: "no authenticator apps — too hard for
 * volunteers"). An owner, admin or league staff member of an organisation
 * that requires two-step sign-in sees nothing of the app until this
 * session is proven: a six-digit code texted to their mobile (emailed when
 * there is no mobile), typed here. "Trust this device for 30 days" means
 * the next sign-in on this device asks for nothing; a device the account
 * has not been seen on asks again.
 *
 * The database has already taken their powers away (two_step_ok_for), so
 * this wall is the explanation and the way through, not the lock. An
 * authenticator app stays an optional choice: someone who set one up is met
 * by the 0224 gate instead, which takes its six digits; someone who prefers
 * one can set it up from here. Coaches and parents never see this.
 */
export function TwoStepWall() {
  const pathname = usePathname()
  const router = useRouter()
  const [status, setStatus] = useState<Status | null>(null)
  const [phase, setPhase] = useState<Phase>('device')
  const [sent, setSent] = useState<Sent | null>(null)
  const [code, setCode] = useState('')
  const [trust, setTrust] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wait, setWait] = useState(0)
  const [enrolling, setEnrolling] = useState<Enrolling | null>(null)
  const started = useRef(false)

  const check = useCallback(async (force = false) => {
    // Asked once a minute, not on every page and auth event: it was three
    // calls per screen, on every screen (time-screens, 13 Nov 2026). A status
    // that is asking for a code is never reused — that one is answered live.
    if (!force && known && Date.now() - known.at < KNOWN_FOR_MS) {
      const s = known.status
      if (!(s && s.required && !s.enrolled && !s.ok)) return setStatus(s)
    }
    const supabase = createClient()
    const { data: s } = await supabase.auth.getSession()
    if (!s.session) {
      known = null
      return setStatus(null)
    }
    const { data } = await supabase.rpc('two_step_status')
    const status = (data as unknown as Status | null) ?? null
    known = { at: Date.now(), status }
    setStatus(status)
  }, [])

  useEffect(() => {
    if (isPublicPage(pathname)) return
    let live = true
    ;(async () => {
      if (live) await check(false)
    })()
    // Verifying an authenticator code upgrades the session; ask again when it
    // does. The first event a new listener gets is the session as it stands,
    // which the call above has just covered.
    const { data: sub } = createClient().auth.onAuthStateChange((event) => {
      if (event === 'INITIAL_SESSION') return
      if (live) void check(true)
    })
    return () => {
      live = false
      sub.subscription.unsubscribe()
    }
  }, [pathname, check])

  const asking = !isPublicPage(pathname) && !!status && status.required && !status.enrolled && !status.ok

  const send = useCallback(async () => {
    setPhase('sending')
    setError(null)
    const res = await fetch('/api/two-step/send', { method: 'POST' })
    const json = (await res.json().catch(() => ({}))) as Sent & { sent?: boolean; error?: string; reason?: string; wait?: number }
    if (res.ok && json.sent) {
      setSent(json)
      setWait(json.wait ?? 60)
      setPhase('code')
      return
    }
    if (res.status === 429) {
      setPhase('code')
      setError(`Too many codes have been sent. Try again in ${json.wait ?? 'a few'} minutes, or use an authenticator app.`)
      return
    }
    setPhase('no-delivery')
    setError(
      json.error === 'no-destination'
        ? 'There is no mobile number or email address on your account to send a code to.'
        : json.reason === 'sms-unavailable'
          ? 'Texting codes is not set up here yet.'
          : json.reason === 'email-unavailable'
            ? 'Your account has no mobile number, and emailing codes is not set up here yet.'
            : 'We could not send a code just now.'
    )
  }, [])

  // First: is this a device the account trusted within 30 days? Then no
  // code. Otherwise send one. Runs once per wall; the server also refuses a
  // second text inside a minute, so a reload costs nothing.
  useEffect(() => {
    if (!asking || started.current) return
    started.current = true
    ;(async () => {
      const device = deviceToken()
      if (device) {
        const { data } = await createClient().rpc('two_step_trust_this_session', { p_device: device })
        if ((data as { trusted?: boolean } | null)?.trusted) {
          await check(true)
          router.refresh()
          return
        }
      }
      await send()
    })()
  }, [asking, check, router, send])

  useEffect(() => {
    if (wait <= 0) return
    const t = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])

  if (!asking) return null

  async function verify(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await fetch('/api/two-step/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, trust, device: trust ? deviceToken() : null, label: deviceLabel() }),
    })
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; attempts_left?: number }
    setBusy(false)
    setCode('')
    if (res.ok && json.ok) {
      await check(true)
      router.refresh()
      return
    }
    if (json.error === 'wrong') {
      const left = json.attempts_left ?? 0
      setError(left > 0 ? `That code did not match. ${left} more ${left === 1 ? 'try' : 'tries'} before a new code is needed.` : 'That code did not match, and it has now been used up. Send a new one.')
      if (left === 0) setSent(null)
      return
    }
    if (json.error === 'expired' || json.error === 'too-many-attempts' || json.error === 'no-code') {
      setSent(null)
      setError('That code has run out. Send a new one.')
      return
    }
    setError(json.error ?? 'Could not check the code')
  }

  async function startTotp() {
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { data: factors } = await supabase.auth.mfa.listFactors()
    for (const f of factors?.all ?? []) if (f.factor_type === 'totp' && f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id })
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Squadroom' })
    setBusy(false)
    if (error || !data) return setError(error?.message ?? 'Could not start')
    setEnrolling({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret })
  }

  async function finishTotp(e: React.FormEvent) {
    e.preventDefault()
    if (!enrolling) return
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId: enrolling.factorId })
    if (chErr || !ch) {
      setBusy(false)
      return setError(chErr?.message ?? 'Could not check the code')
    }
    const { error: vErr } = await supabase.auth.mfa.verify({ factorId: enrolling.factorId, challengeId: ch.id, code: code.trim() })
    setBusy(false)
    setCode('')
    if (vErr) return setError('That code did not match. Codes change every thirty seconds — try the current one.')
    setEnrolling(null)
    await check(true)
  }

  async function signOut() {
    await createClient().auth.signOut()
    setStatus(null)
    router.push('/signin')
    router.refresh()
  }

  const where = status!.where ?? 'Your club'
  const sentLine =
    sent?.channel === 'sms' ? `We've texted a code to ${sent.to}.`
    : sent?.channel === 'email' ? `We've emailed a code to ${sent.to}.`
    : sent?.channel === 'demo' ? 'Demo account — the code is shown here instead of being sent:'
    : null

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-paper p-6" data-two-step-wall data-two-step-phase={phase} role="dialog" aria-modal="true" aria-labelledby="two-step-wall-title">
      <div className="mx-auto max-w-sm pt-6">
        <span className="eyebrow">{where}</span>
        <h1 id="two-step-wall-title" className="display mt-1 text-[1.375rem] leading-tight">
          {phase === 'totp' ? 'Set up an authenticator app' : 'Your six-digit code'}
        </h1>
        <p className="mt-2 text-sm text-ink-2">
          Your account reaches every family&apos;s details, so {where} asks for a code as well as your password.
        </p>

        {(phase === 'device' || phase === 'sending') && (
          <p className="mt-5 text-sm" aria-live="polite" data-two-step-sending>
            {phase === 'device' ? 'Checking this device…' : 'Sending your code…'}
          </p>
        )}

        {phase === 'code' && (
          <form onSubmit={verify} className="mt-5">
            {sentLine && <p className="text-sm" data-two-step-sent={sent?.channel}>{sentLine}</p>}
            {sent?.channel === 'demo' && sent.dev_code && (
              <p className="mt-1 text-center font-mono text-2xl tracking-[0.4em]" data-two-step-demo-code>{sent.dev_code}</p>
            )}
            <label className="mt-3 block text-sm">
              Type the six digits
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                className="mt-1 w-full rounded-xl border px-3 py-3 text-center font-mono text-xl tracking-[0.4em]"
                style={{ borderColor: 'var(--line)' }}
                data-two-step-wall-code
                autoFocus
              />
            </label>
            <label className="mt-3 flex items-start gap-2.5 text-sm">
              <input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} className="mt-0.5 h-5 w-5 flex-none accent-[var(--brand)]" data-two-step-trust />
              <span>
                <span className="block font-medium">Trust this device for 30 days</span>
                <span className="block text-xs text-ink-3">You&apos;ll only be asked again after 30 days, or on a device we haven&apos;t seen.</span>
              </span>
            </label>
            {error && <p className="mt-2 text-sm" style={{ color: 'var(--no)' }} role="alert">{error}</p>}
            <button type="submit" disabled={busy || code.length !== 6 || !sent} className="mt-3 w-full rounded-xl px-4 py-3 font-semibold text-brand-ink disabled:opacity-50" style={{ background: 'var(--brand)' }} data-two-step-wall-verify>
              {busy ? 'Checking…' : 'Continue'}
            </button>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
              <button type="button" onClick={send} disabled={busy || wait > 0} className="tap underline underline-offset-2 text-ink-2 disabled:no-underline disabled:opacity-60" data-two-step-resend>
                {wait > 0 ? `Send it again in ${wait} s` : sent ? 'Send it again' : 'Send a new code'}
              </button>
              <button type="button" onClick={() => { setPhase('totp'); setError(null); setCode('') }} className="tap underline underline-offset-2 text-ink-3" data-two-step-prefer-app>
                Prefer an authenticator app?
              </button>
            </div>
          </form>
        )}

        {phase === 'no-delivery' && (
          <div className="mt-5" data-two-step-no-delivery>
            <p className="text-sm" role="alert" style={{ color: 'var(--no)' }}>{error}</p>
            <p className="mt-2 text-sm text-ink-2">An authenticator app works without a text or an email. It takes two minutes, once.</p>
            <button onClick={() => { setPhase('totp'); setError(null) }} className="mt-3 w-full rounded-xl px-4 py-3 font-semibold text-brand-ink" style={{ background: 'var(--brand)' }} data-two-step-wall-start>
              Set up an authenticator app
            </button>
            <button onClick={send} className="tap mt-3 text-sm underline underline-offset-2 text-ink-2" data-two-step-resend>
              Try sending the code again
            </button>
          </div>
        )}

        {phase === 'totp' && !enrolling && (
          <>
            <p className="mt-4 text-sm text-ink-2">Optional, for anyone who prefers it: the app&apos;s six digits replace the texted code.</p>
            <button onClick={startTotp} disabled={busy} className="mt-4 w-full rounded-xl px-4 py-3 font-semibold text-brand-ink disabled:opacity-50" style={{ background: 'var(--brand)' }} data-two-step-wall-start>
              {busy ? 'One moment…' : 'Set it up now'}
            </button>
            <p className="mt-3 text-xs text-ink-3">Any authenticator app works: Google Authenticator, Authy, 1Password, or the Passwords app on an iPhone.</p>
            {error && <p className="mt-2 text-sm" style={{ color: 'var(--no)' }} role="alert">{error}</p>}
            <button onClick={() => { setPhase(sent ? 'code' : 'no-delivery'); setError(null) }} className="tap mt-4 text-sm underline underline-offset-2 text-ink-2" data-two-step-back-to-code>
              Back to the code
            </button>
          </>
        )}

        {phase === 'totp' && enrolling && (
          <form onSubmit={finishTotp} className="mt-5">
            <p className="text-sm">1. Scan this with your authenticator app, or type the key into it.</p>
            {/* The QR is an SVG data URL from the auth server: an image of a string we already have. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={enrolling.qr} alt="A QR code for your authenticator app" className="mx-auto mt-3 h-44 w-44 rounded-lg bg-white p-2" />
            <p className="mt-2 break-all text-center font-mono text-xs text-ink-2" data-two-step-wall-secret>{enrolling.secret}</p>
            <label className="mt-4 block text-sm">
              2. Type the six digits it shows
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                className="mt-1 w-full rounded-xl border px-3 py-3 text-center font-mono text-xl tracking-[0.4em]"
                style={{ borderColor: 'var(--line)' }}
                data-two-step-wall-code
                autoFocus
              />
            </label>
            {error && <p className="mt-2 text-sm" style={{ color: 'var(--no)' }} role="alert">{error}</p>}
            <button type="submit" disabled={busy || code.length !== 6} className="mt-3 w-full rounded-xl px-4 py-3 font-semibold text-brand-ink disabled:opacity-50" style={{ background: 'var(--brand)' }} data-two-step-wall-verify>
              {busy ? 'Checking…' : 'Turn it on'}
            </button>
          </form>
        )}

        <button onClick={signOut} className="tap mt-6 text-sm underline underline-offset-2 text-ink-3" data-two-step-wall-signout>
          Sign out instead
        </button>
      </div>
    </div>
  )
}
