'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * Two-step sign-in, the half the app can enforce (S-07, 4 Nov 2026).
 *
 * Somebody who has turned on two-step sign-in signs in with their password
 * and lands here with a session that is only half proven (AAL1). Nothing
 * of the app shows until the six digits from their authenticator app
 * prove the rest (AAL2). Rendered above every page by the root layout, so
 * there is no screen a deep link reaches first.
 *
 * What this does NOT do yet: the database still accepts an AAL1 session
 * for staff writes, so a script with the password alone is not stopped —
 * that is the migration half (policies on `auth.jwt()->>'aal'`), queued
 * for the day a Supabase token exists. The club-admin "mandatory" is a
 * card on the Admin hub until then.
 */
export function TwoStepGate() {
  const [needed, setNeeded] = useState<{ factorId: string } | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    ;(async () => {
      const supabase = createClient()
      const { data: s } = await supabase.auth.getSession()
      if (!s.session) return
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (!live || !aal || aal.nextLevel !== 'aal2' || aal.currentLevel === 'aal2') return
      const { data: factors } = await supabase.auth.mfa.listFactors()
      const totp = factors?.totp?.find((f) => f.status === 'verified')
      if (live && totp) setNeeded({ factorId: totp.id })
    })()
    return () => {
      live = false
    }
  }, [])

  if (!needed) return null

  async function verify(e: React.FormEvent) {
    e.preventDefault()
    if (!needed) return
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId: needed.factorId })
    if (chErr || !ch) {
      setBusy(false)
      return setError(chErr?.message ?? 'Could not start the check')
    }
    const { error: vErr } = await supabase.auth.mfa.verify({ factorId: needed.factorId, challengeId: ch.id, code: code.trim() })
    setBusy(false)
    if (vErr) {
      // Cleared, so the next six digits replace rather than extend it.
      setCode('')
      return setError('That code did not match. Codes change every 30 seconds — try the current one.')
    }
    window.location.reload()
  }

  async function signOut() {
    await createClient().auth.signOut()
    window.location.replace('/signin')
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-paper p-6" data-two-step-gate role="dialog" aria-modal="true" aria-labelledby="two-step-title">
      <form onSubmit={verify} className="card w-full max-w-sm p-5">
        <h1 id="two-step-title" className="display text-[1.375rem] leading-tight">Two-step sign-in</h1>
        <p className="mt-1 text-sm text-ink-2">Open your authenticator app and type the six digits it shows for Squadroom.</p>
        <label className="mt-4 block">
          <span className="eyebrow">Code</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            pattern="[0-9]{6}"
            className="mt-1 w-full rounded-xl border px-3 py-3 text-center text-2xl tracking-[0.4em]"
            style={{ borderColor: 'var(--line)' }}
            data-two-step-code
          />
        </label>
        {error && (
          <p className="mt-2 rounded-lg px-3 py-2 text-sm" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>
            {error}
          </p>
        )}
        <button type="submit" disabled={busy || code.length !== 6} className="mt-4 w-full rounded-xl px-4 py-3 font-semibold disabled:opacity-50" style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}>
          {busy ? 'Checking…' : 'Continue'}
        </button>
        <button type="button" onClick={signOut} className="tap mt-3 w-full text-center text-sm underline underline-offset-4 text-ink-2">
          Sign out instead
        </button>
      </form>
    </div>
  )
}
