'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { AccountCard, AccountField, AccountFrame, PRIMARY_BUTTON, primaryStyle } from '@/components/account/frame'
import { PasswordField } from '@/components/account/password-field'
import { CodeStep } from '@/components/account/code-step'

type Mode = 'password' | 'code' | 'forgot'

function lastEmail(): string {
  if (typeof window === 'undefined') return ''
  try {
    return localStorage.getItem('squadroom.lastEmail') ?? ''
  } catch {
    return ''
  }
}

function remember(address: string) {
  try {
    localStorage.setItem('squadroom.lastEmail', address)
  } catch {}
}

/**
 * Sign in (the sign-up brief, 12 Nov 2026): email and password. Backups:
 * "Email me a code instead" and "Forgot password" (reset by code). Owners,
 * admins and league staff still get the two-step code after this (the
 * wall in the root layout). Honours `next`, so a coach's link or a
 * registration carries on where it started.
 */
function SignInInner() {
  const params = useSearchParams()
  const raw = params.get('next') ?? '/'
  const next = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/'
  const expired = params.get('error') === 'expired'
  const [email, setEmail] = useState(lastEmail)
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<Mode>('password')
  const [stage, setStage] = useState<'form' | 'code'>('form')
  const [issued, setIssued] = useState<{ wait: number; demo_code?: string } | null>(null)
  const [checking, setChecking] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unfinished, setUnfinished] = useState(false)

  // Somebody arriving here with a valid session has almost always just come
  // through a link that worked. Showing them a login form is how a successful
  // sign-in looks like a failed one.
  useEffect(() => {
    // An emailed link lands here carrying its token in the fragment;
    // HashSession is already signing that person in.
    if (window.location.hash.includes('access_token=')) return
    createClient().auth.getClaims().then(({ data }) => {
      if (data?.claims?.sub) window.location.replace(next)
      else setChecking(false)
    })
  }, [next])

  async function withPassword(e: React.FormEvent) {
    e.preventDefault()
    // A phone keyboard capitalises the first letter and autocomplete often
    // leaves a trailing space.
    const address = email.trim().toLowerCase()
    setBusy(true)
    setError(null)
    setUnfinished(false)
    const { error } = await createClient().auth.signInWithPassword({ email: address, password })
    setBusy(false)
    if (error) {
      if (/not confirmed/i.test(error.message)) {
        setUnfinished(true)
        return setError('That account was never confirmed. Create it again and we’ll send the code.')
      }
      return setError(
        /invalid login/i.test(error.message)
          ? 'That email and password don’t match. Forgot it? Email me a code, or reset it below.'
          : error.message
      )
    }
    remember(address)
    window.location.replace(next)
  }

  async function sendCode(e: React.FormEvent) {
    e.preventDefault()
    const address = email.trim().toLowerCase()
    if (!address) return setError('Your email, please.')
    setBusy(true)
    setError(null)
    setUnfinished(false)
    const res = await fetch('/api/account/code', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: address, purpose: mode === 'forgot' ? 'reset' : 'sign_in' }),
    })
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; wait?: number; demo_code?: string; error?: string; message?: string }
    setBusy(false)
    if (!res.ok) {
      if (data.error === 'unconfirmed') setUnfinished(true)
      return setError(data.message ?? data.error ?? 'Could not send a code.')
    }
    remember(address)
    setEmail(address)
    setIssued({ wait: data.wait ?? 30, demo_code: data.demo_code })
    setStage('code')
  }

  if (checking) {
    return (
      <AccountFrame>
        <p className="text-sm" style={{ color: 'var(--bar-ink)', opacity: 0.7 }}>Signing you in…</p>
      </AccountFrame>
    )
  }

  if (stage === 'code') {
    return (
      <CodeStep
        email={email}
        purpose={mode === 'forgot' ? 'reset' : 'sign_in'}
        next={next}
        demoCode={issued?.demo_code}
        wait={issued?.wait}
        onBack={() => setStage('form')}
      />
    )
  }

  const signUpHref = `/signup?next=${encodeURIComponent(next)}`

  return (
    <AccountFrame>
      <AccountCard data-sign-in={mode}>
        <h1 className="display text-[1.5rem] leading-tight">{mode === 'forgot' ? 'Forgot password' : 'Sign in'}</h1>
        {expired && (
          <p className="mt-2 rounded-lg px-3 py-2 text-sm" style={{ background: 'var(--surface-2)' }}>
            That link had expired. Sign in here instead.
          </p>
        )}
        {mode !== 'password' && (
          <p className="mt-1 text-sm text-ink-2">
            {mode === 'forgot' ? 'We’ll email you a 6-digit code, then you choose a new password.' : 'We’ll email you a 6-digit code to sign in with.'}
          </p>
        )}
        <form onSubmit={mode === 'password' ? withPassword : sendCode} className="mt-4 flex flex-col gap-3.5" noValidate>
          <AccountField
            label="Email"
            required
            type="email"
            value={email}
            onChange={setEmail}
            inputProps={{ inputMode: 'email', autoComplete: 'username', autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false, 'data-email': '' } as React.InputHTMLAttributes<HTMLInputElement>}
          />
          {mode === 'password' && (
            <PasswordField
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
              hint={null}
              inputProps={{ 'data-password': '' } as React.InputHTMLAttributes<HTMLInputElement>}
            />
          )}
          {error && (
            <p role="alert" className="rounded-lg px-3 py-2 text-sm" style={{ background: 'var(--no-bg)', color: 'var(--no)' }} data-sign-in-error>
              {error}
              {unfinished && (
                <>
                  {' '}
                  <Link href={signUpHref} className="font-semibold underline underline-offset-4">Create account</Link>
                </>
              )}
            </p>
          )}
          <button type="submit" disabled={busy} className={PRIMARY_BUTTON} style={primaryStyle} data-sign-in-submit>
            {busy ? (mode === 'password' ? 'Signing in…' : 'Sending…') : mode === 'password' ? 'Sign in' : 'Email me a code'}
          </button>
        </form>
        <div className="mt-4 flex flex-col items-start gap-2.5 text-sm">
          {mode === 'password' ? (
            <>
              <button type="button" onClick={() => { setMode('code'); setError(null) }} className="tap underline underline-offset-4 text-ink-2" data-email-code>
                Email me a code instead
              </button>
              <button type="button" onClick={() => { setMode('forgot'); setError(null) }} className="tap underline underline-offset-4 text-ink-2" data-forgot>
                Forgot password
              </button>
            </>
          ) : (
            <button type="button" onClick={() => { setMode('password'); setError(null) }} className="tap underline underline-offset-4 text-ink-2" data-use-password>
              Use my password instead
            </button>
          )}
        </div>
      </AccountCard>
      <p className="mt-4 text-center text-sm" style={{ color: 'var(--bar-ink)', opacity: 0.85 }}>
        New here?{' '}
        <Link href={signUpHref} className="font-semibold underline underline-offset-4" style={{ color: 'var(--bar-ink)' }} data-create-account-link>
          Create account
        </Link>
      </p>
      <p className="mt-2 text-center text-sm" style={{ color: 'var(--bar-ink)', opacity: 0.85 }}>
        Have a join code?{' '}
        <Link href="/join" className="font-semibold underline underline-offset-4" style={{ color: 'var(--bar-ink)' }}>
          Enter it
        </Link>
      </p>
    </AccountFrame>
  )
}

export default function SignIn() {
  // useSearchParams needs a Suspense boundary, or the whole route opts out of
  // static rendering.
  return (
    <Suspense fallback={null}>
      <SignInInner />
    </Suspense>
  )
}
