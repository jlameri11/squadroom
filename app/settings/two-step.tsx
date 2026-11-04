'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Factor = { id: string; status: string; friendly_name?: string | null }
type Enrolling = { factorId: string; qr: string; secret: string }

/**
 * Turning two-step sign-in on and off (S-07). An authenticator app (Google
 * Authenticator, Authy, 1Password, the iPhone's own Passwords) scans the
 * code or takes the secret, and from then on signing in takes the password
 * and the six digits. Required of the people who run a club — their account
 * can reach every family's details — and open to anyone.
 */
export function TwoStep() {
  const [factors, setFactors] = useState<Factor[] | null>(null)
  const [enrolling, setEnrolling] = useState<Enrolling | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmOff, setConfirmOff] = useState(false)

  // `all`, not `totp`: supabase-js puts only VERIFIED factors under `totp`,
  // and a half-finished attempt (unverified) has to be found to be cleared,
  // or the next "Turn on" is refused as "already exists".
  const totpFactors = (data: { all?: { id: string; status: string; factor_type: string; friendly_name?: string | null }[] } | null) =>
    ((data?.all ?? []).filter((f) => f.factor_type === 'totp') as Factor[])
  async function load() {
    const { data } = await createClient().auth.mfa.listFactors()
    setFactors(totpFactors(data))
  }
  useEffect(() => {
    let live = true
    ;(async () => {
      const { data } = await createClient().auth.mfa.listFactors()
      if (live) setFactors(totpFactors(data))
    })()
    return () => {
      live = false
    }
  }, [])

  const on = factors?.find((f) => f.status === 'verified') ?? null

  async function start() {
    setBusy(true)
    setError(null)
    const supabase = createClient()
    // A half-finished attempt from before is cleared, or Stripe-style
    // "already enrolled" errors follow a person around.
    for (const f of factors ?? []) if (f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id })
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
      return setError(chErr?.message ?? 'Could not start the check')
    }
    const { error: vErr } = await supabase.auth.mfa.verify({ factorId: enrolling.factorId, challengeId: ch.id, code: code.trim() })
    setBusy(false)
    if (vErr) {
      setCode('')
      return setError('That code did not match. Codes change every 30 seconds — try the current one.')
    }
    setEnrolling(null)
    setCode('')
    await load()
  }

  async function turnOff() {
    if (!on) return
    setBusy(true)
    setError(null)
    const { error } = await createClient().auth.mfa.unenroll({ factorId: on.id })
    setBusy(false)
    setConfirmOff(false)
    if (error) return setError(error.message)
    await load()
  }

  if (!factors) return null

  return (
    <section id="two-step" className="mt-6" data-two-step={on ? 'on' : 'off'}>
      <h2 className="font-semibold">Two-step sign-in</h2>
      <p className="mt-0.5 text-sm text-ink-2">
        Your password and a six-digit code from an authenticator app. Required for anyone who runs a club; a good idea for everyone.
      </p>

      {on && !confirmOff && (
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-sm" style={{ color: 'var(--yes)' }}>On</span>
          <button onClick={() => setConfirmOff(true)} disabled={busy} className="tap text-sm underline underline-offset-4 text-ink-2" data-two-step-off>
            Turn off
          </button>
        </div>
      )}
      {on && confirmOff && (
        <div className="mt-2 rounded-xl border p-3 text-sm" style={{ borderColor: 'var(--line)' }}>
          <p>Signing in will take the password alone again.</p>
          <div className="mt-2 flex gap-2">
            <button onClick={turnOff} disabled={busy} className="rounded-lg px-3 py-2 text-sm font-semibold text-no-ink disabled:opacity-50" style={{ background: 'var(--no)' }} data-two-step-off-confirm>
              Turn it off
            </button>
            <button onClick={() => setConfirmOff(false)} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--line)' }}>
              Keep it on
            </button>
          </div>
        </div>
      )}

      {!on && !enrolling && (
        <button onClick={start} disabled={busy} className="mt-2 rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-50" style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }} data-two-step-on>
          {busy ? 'One moment…' : 'Turn on'}
        </button>
      )}

      {enrolling && (
        <form onSubmit={finish} className="mt-2 rounded-xl border p-3" style={{ borderColor: 'var(--line)' }}>
          <p className="text-sm">Scan this with your authenticator app, or type the key into it.</p>
          {/* The QR is an SVG data URL from Supabase: an image, with the key below for a phone that cannot scan itself. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- a data URL; there is nothing for next/image to optimise */}
          <img src={enrolling.qr} alt="QR code for your authenticator app" className="mx-auto mt-2 h-44 w-44 rounded-lg bg-white p-1" />
          <p className="mt-2 break-all text-center font-mono text-xs text-ink-2" data-two-step-secret>{enrolling.secret}</p>
          <label className="mt-3 block">
            <span className="eyebrow">Then the six digits it shows</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              className="mt-1 w-full rounded-xl border px-3 py-2.5 text-center text-xl tracking-[0.4em]"
              style={{ borderColor: 'var(--line)' }}
              data-two-step-code
            />
          </label>
          <div className="mt-3 flex gap-2">
            <button type="submit" disabled={busy || code.length !== 6} className="rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50" style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }} data-two-step-finish>
              {busy ? 'Checking…' : 'Turn on'}
            </button>
            <button type="button" onClick={() => { setEnrolling(null); setCode('') }} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--line)' }}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && (
        <p className="mt-2 rounded-lg px-3 py-2 text-sm" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>
          {error}
        </p>
      )}
    </section>
  )
}
