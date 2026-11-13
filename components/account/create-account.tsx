'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { AccountCard, AccountField, AccountFrame, PRIMARY_BUTTON, primaryStyle, TermsLine } from './frame'
import { PasswordField, MIN_PASSWORD } from './password-field'
import { CodeStep } from './code-step'

/**
 * Create account — one plain screen (the sign-up brief, 12 Nov 2026):
 * first, middle (optional), last, email, mobile, password with an eye; one
 * button; the terms line under it. Then the code, then straight back to
 * `next` — the join request, the registration, the club set-up.
 *
 * The password never leaves this screen until the code is proven
 * (/api/account/confirm sets it), so nothing is usable before confirming.
 */
export function CreateAccount({ next, why }: { next: string; why?: string | null }) {
  const [checking, setChecking] = useState(true)
  const [stage, setStage] = useState<'form' | 'code'>('form')
  const [first, setFirst] = useState('')
  const [middle, setMiddle] = useState('')
  const [last, setLast] = useState('')
  const [email, setEmail] = useState('')
  const [mobile, setMobile] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [offerSignIn, setOfferSignIn] = useState(false)
  const [issued, setIssued] = useState<{ wait: number; demo_code?: string } | null>(null)
  const signInHref = `/signin?next=${encodeURIComponent(next)}`

  // Already signed in: there is nothing to create — carry on to where they were going.
  useEffect(() => {
    createClient().auth.getClaims().then(({ data }) => {
      if (data?.claims?.sub) window.location.replace(next)
      else setChecking(false)
    })
  }, [next])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const address = email.trim().toLowerCase()
    if (!first.trim() || !last.trim()) return setError('Your first and last name, please.')
    if (!address) return setError('Your email, please.')
    if (!mobile.trim()) return setError('Your mobile, please.')
    if (password.length < MIN_PASSWORD) return setError(`A password of at least ${MIN_PASSWORD} characters, please.`)
    setBusy(true)
    setError(null)
    setOfferSignIn(false)
    const res = await fetch('/api/account/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ first: first.trim(), middle: middle.trim(), last: last.trim(), email: address, mobile: mobile.trim() }),
    })
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; wait?: number; demo_code?: string; error?: string; message?: string }
    setBusy(false)
    if (!res.ok) {
      setOfferSignIn(data.error === 'exists' || data.error === 'phone-taken')
      return setError(data.message ?? data.error ?? 'Something went wrong.')
    }
    setEmail(address)
    setIssued({ wait: data.wait ?? 30, demo_code: data.demo_code })
    setStage('code')
  }

  if (checking) return <AccountFrame><p className="text-sm" style={{ color: 'var(--bar-ink)', opacity: 0.7 }}>One moment…</p></AccountFrame>

  if (stage === 'code') {
    return <CodeStep email={email} purpose="confirm" next={next} password={password} demoCode={issued?.demo_code} wait={issued?.wait} onBack={() => setStage('form')} />
  }

  return (
    <AccountFrame>
      <AccountCard data-create-account>
        <h1 className="display text-[1.5rem] leading-tight">Create account</h1>
        {why && <p className="mt-1 text-sm text-ink-2" data-create-why>{why}</p>}
        <form onSubmit={submit} className="mt-4 flex flex-col gap-3.5" noValidate>
          <AccountField label="First name" required value={first} onChange={setFirst} inputProps={{ autoComplete: 'given-name', 'data-first': '' } as React.InputHTMLAttributes<HTMLInputElement>} />
          <AccountField label="Middle name" optional value={middle} onChange={setMiddle} inputProps={{ autoComplete: 'additional-name', 'data-middle': '' } as React.InputHTMLAttributes<HTMLInputElement>} />
          <AccountField label="Last name" required value={last} onChange={setLast} inputProps={{ autoComplete: 'family-name', 'data-last': '' } as React.InputHTMLAttributes<HTMLInputElement>} />
          <AccountField
            label="Email"
            required
            type="email"
            value={email}
            onChange={setEmail}
            inputProps={{ inputMode: 'email', autoComplete: 'email', autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false, 'data-email': '' } as React.InputHTMLAttributes<HTMLInputElement>}
          />
          <AccountField
            label="Mobile"
            required
            type="tel"
            value={mobile}
            onChange={setMobile}
            hint="Australian numbers as 04…; another country’s with its code, like +64."
            inputProps={{ inputMode: 'tel', autoComplete: 'tel', placeholder: '04xx xxx xxx', 'data-mobile': '' } as React.InputHTMLAttributes<HTMLInputElement>}
          />
          <PasswordField value={password} onChange={setPassword} autoComplete="new-password" inputProps={{ 'data-password': '' } as React.InputHTMLAttributes<HTMLInputElement>} />
          {error && (
            <p role="alert" className="rounded-lg px-3 py-2 text-sm" style={{ background: 'var(--no-bg)', color: 'var(--no)' }} data-create-error>
              {error}
              {offerSignIn && (
                <>
                  {' '}
                  <Link href={signInHref} className="font-semibold underline underline-offset-4">Sign in</Link>
                </>
              )}
            </p>
          )}
          <button type="submit" disabled={busy} className={`${PRIMARY_BUTTON} mt-1`} style={primaryStyle} data-create-submit>
            {busy ? 'Creating…' : 'Create account'}
          </button>
          <TermsLine />
        </form>
      </AccountCard>
      <p className="mt-4 text-center text-sm" style={{ color: 'var(--bar-ink)', opacity: 0.85 }}>
        I already have an account →{' '}
        <Link href={signInHref} className="font-semibold underline underline-offset-4" style={{ color: 'var(--bar-ink)' }} data-have-account>
          Sign in
        </Link>
      </p>
    </AccountFrame>
  )
}
