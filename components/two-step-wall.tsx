'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { isPublicPage } from '@/lib/routes'

type Status = { required: boolean; where: string | null; enrolled: boolean; aal2: boolean }
type Enrolling = { factorId: string; qr: string; secret: string }

/**
 * Two-step sign-in, compulsory for the people who run things (S-07, 0231;
 * Joey, 9 Nov 2026): an owner, admin or league staff member of an
 * organisation that requires it, who has not set up an authenticator app,
 * sees nothing of the app until they have. The database has already taken
 * their powers away (0231), so this wall is the explanation and the way
 * through, not the lock. Someone who HAS enrolled but signed in with a
 * password alone meets the 0224 gate instead, which takes the six digits.
 *
 * Coaches and parents never see this: for them two-step is a choice in
 * Settings.
 */
export function TwoStepWall() {
  const pathname = usePathname()
  const router = useRouter()
  const [status, setStatus] = useState<Status | null>(null)
  const [enrolling, setEnrolling] = useState<Enrolling | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const check = useCallback(async () => {
    const supabase = createClient()
    const { data: s } = await supabase.auth.getSession()
    if (!s.session) return setStatus(null)
    const { data } = await supabase.rpc('two_step_status')
    setStatus((data as unknown as Status | null) ?? null)
  }, [])

  useEffect(() => {
    if (isPublicPage(pathname)) return
    let live = true
    ;(async () => {
      if (live) await check()
    })()
    // Verifying the factor upgrades the session; ask again when it does.
    const { data: sub } = createClient().auth.onAuthStateChange(() => {
      if (live) void check()
    })
    return () => {
      live = false
      sub.subscription.unsubscribe()
    }
  }, [pathname, check])

  if (isPublicPage(pathname) || !status || !status.required || status.enrolled) return null

  async function start() {
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

  async function finish(e: React.FormEvent) {
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
    if (vErr) {
      setCode('')
      return setError('That code did not match. Codes change every thirty seconds — try the current one.')
    }
    setEnrolling(null)
    await check()
  }

  async function signOut() {
    await createClient().auth.signOut()
    setStatus(null)
    router.push('/signin')
    router.refresh()
  }

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-paper p-6" data-two-step-wall role="dialog" aria-modal="true" aria-labelledby="two-step-wall-title">
      <div className="mx-auto max-w-sm pt-6">
        <span className="eyebrow">{status.where}</span>
        <h1 id="two-step-wall-title" className="display mt-1 text-[1.375rem] leading-tight">Set up two-step sign-in</h1>
        <p className="mt-2 text-sm text-ink-2">
          Your account reaches every family&apos;s details, so {status.where} requires a six-digit code from an authenticator app
          as well as your password. It takes two minutes, once.
        </p>

        {!enrolling ? (
          <>
            <button onClick={start} disabled={busy} className="mt-5 w-full rounded-xl px-4 py-3 font-semibold text-brand-ink disabled:opacity-50" style={{ background: 'var(--brand)' }} data-two-step-wall-start>
              {busy ? 'One moment…' : 'Set it up now'}
            </button>
            <p className="mt-3 text-xs text-ink-3">
              Any authenticator app works: Google Authenticator, Authy, 1Password, or the Passwords app on an iPhone.
            </p>
          </>
        ) : (
          <form onSubmit={finish} className="mt-5">
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
        {error && !enrolling && <p className="mt-2 text-sm" style={{ color: 'var(--no)' }} role="alert">{error}</p>}
        <button onClick={signOut} className="tap mt-6 text-sm underline underline-offset-2 text-ink-3" data-two-step-wall-signout>
          Sign out instead
        </button>
      </div>
    </div>
  )
}
