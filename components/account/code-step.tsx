'use client'

import { useEffect, useState } from 'react'
import { AccountCard, AccountFrame, PRIMARY_BUTTON, primaryStyle } from './frame'
import { PasswordField, MIN_PASSWORD } from './password-field'

export type CodePurpose = 'confirm' | 'sign_in' | 'reset'

/**
 * The six digits (the sign-up brief, 12 Nov 2026): typed once, checked by
 * /api/account/confirm, then straight on to wherever they started. Resend
 * after thirty seconds; a code lasts ten minutes; five tries. A demo
 * account's code is shown here, because it was never sent anywhere.
 *
 * For a new account the password typed on the form rides along and is set
 * when the code proves the address; lost to a reload, it is asked for again
 * here. A reset always asks for the new one here.
 */
export function CodeStep({
  email,
  purpose,
  next,
  password: given = '',
  demoCode,
  wait = 30,
  onBack,
}: {
  email: string
  purpose: CodePurpose
  next: string
  password?: string
  demoCode?: string
  wait?: number
  onBack?: () => void
}) {
  const [code, setCode] = useState('')
  const [password, setPassword] = useState(given)
  const [askPassword, setAskPassword] = useState(purpose === 'reset' || (purpose === 'confirm' && given.length < MIN_PASSWORD))
  const [demo, setDemo] = useState<string | undefined>(demoCode)
  const [left, setLeft] = useState(wait)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    if (left <= 0) return
    const t = setTimeout(() => setLeft((n) => n - 1), 1000)
    return () => clearTimeout(t)
  }, [left])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (askPassword && password.length < MIN_PASSWORD) return setError(`A password of at least ${MIN_PASSWORD} characters, please.`)
    setBusy(true)
    setError(null)
    const res = await fetch('/api/account/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, code: code.trim(), purpose, password: askPassword || purpose === 'confirm' ? password : undefined, next }),
    })
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; next?: string; error?: string; message?: string; reason?: string }
    if (!res.ok) {
      setBusy(false)
      if (data.error === 'password-needed') {
        setAskPassword(true)
        return setError(data.message ?? 'Choose your password.')
      }
      return setError(data.message ?? data.error ?? 'That didn’t work.')
    }
    // The session cookies were written by the server; a full load is what
    // makes every page render as the signed-in person.
    window.location.replace(data.next ?? next)
  }

  async function resend() {
    setBusy(true)
    setError(null)
    setNote(null)
    const res = await fetch('/api/account/code', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, purpose }),
    })
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; wait?: number; demo_code?: string; error?: string; message?: string }
    setBusy(false)
    if (!res.ok) return setError(data.message ?? data.error ?? 'Could not send another code.')
    setDemo(data.demo_code)
    setLeft(data.wait ?? wait)
    setCode('')
    setNote('A new code is on its way.')
  }

  const heading = purpose === 'confirm' ? 'Check your email' : purpose === 'reset' ? 'Reset your password' : 'Check your email'

  return (
    <AccountFrame>
      <AccountCard data-code-step={purpose}>
        <h1 className="display text-[1.5rem] leading-tight">{heading}</h1>
        <p className="mt-1 text-sm text-ink-2">
          Enter the 6-digit code we sent to <b className="text-ink">{email}</b>. It works for 10 minutes.
        </p>
        {demo && (
          <p className="mt-3 rounded-lg px-3 py-2 text-sm" style={{ background: 'var(--surface-2)' }} data-demo-code={demo}>
            Demo account — your code is <b className="font-mono tracking-widest">{demo}</b>.
          </p>
        )}
        <form onSubmit={submit} className="mt-4 flex flex-col gap-3.5" noValidate>
          <label className="block">
            <span className="block text-sm font-semibold">Code<span aria-hidden="true"> *</span></span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              autoFocus
              className="mt-1.5 w-full rounded-xl border px-3.5 py-3 text-center font-mono text-2xl tracking-[0.4em]"
              style={{ borderColor: 'var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
              data-code-input
            />
          </label>
          {askPassword && (
            <PasswordField
              label={purpose === 'reset' ? 'New password' : 'Password'}
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              inputProps={{ 'data-password': '' } as React.InputHTMLAttributes<HTMLInputElement>}
            />
          )}
          {error && (
            <p role="alert" className="rounded-lg px-3 py-2 text-sm" style={{ background: 'var(--no-bg)', color: 'var(--no)' }} data-code-error>
              {error}
            </p>
          )}
          {note && <p className="text-sm text-ink-2" data-code-note>{note}</p>}
          <button type="submit" disabled={busy || code.length !== 6} className={PRIMARY_BUTTON} style={primaryStyle} data-code-submit>
            {busy ? 'Checking…' : purpose === 'reset' ? 'Set password and sign in' : 'Continue'}
          </button>
        </form>
        <div className="mt-4 flex items-center justify-between gap-3 text-sm">
          <button type="button" onClick={resend} disabled={busy || left > 0} className="tap underline underline-offset-4 text-ink-2 disabled:no-underline disabled:opacity-60" data-resend>
            {left > 0 ? `Resend in ${left} s` : 'Resend code'}
          </button>
          {onBack && (
            <button type="button" onClick={onBack} className="tap underline underline-offset-4 text-ink-2" data-code-back>
              Wrong email?
            </button>
          )}
        </div>
      </AccountCard>
    </AccountFrame>
  )
}
