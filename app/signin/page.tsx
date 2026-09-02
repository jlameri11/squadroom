'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

/**
 * Sign-in for staff only — owners, admins, coaches.
 *
 * Parents never come here. They arrive through a join link and are signed in
 * by their coach's approval, which is the whole point of the product. This
 * page exists because someone has to be able to approve the first parent.
 *
 * Email magic link rather than SMS: it costs nothing, needs no Twilio
 * account, and staff are a handful of people per academy rather than
 * hundreds.
 */
export default function SignIn() {
  const [email, setEmail] = useState('')
  const [checking, setChecking] = useState(true)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Somebody arriving here with a valid session has almost always just come
  // through a link that worked. Showing them a login form is how a successful
  // sign-in looks like a failed one.
  useEffect(() => {
    // An emailed link lands here carrying its token in the fragment, because
    // /auth/callback cannot see a fragment and bounces. HashSession is
    // already signing that person in, so showing the form for the moment it
    // takes would flash a login screen at somebody who just logged in.
    if (window.location.hash.includes('access_token=')) return

    const supabase = createClient()
    supabase.auth.getClaims().then(({ data }) => {
      if (data?.claims?.sub) window.location.replace('/')
      else setChecking(false)
    })
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)

    const supabase = createClient()
    // Trimmed and lowercased before it goes anywhere. A phone keyboard
    // capitalises the first letter and autocomplete often leaves a trailing
    // space, and `type="email"` then refuses to submit at all — the browser
    // shows its own tooltip, our error never runs, and it reads as the form
    // being broken.
    const address = email.trim().toLowerCase()
    const { error } = await supabase.auth.signInWithOtp({
      email: address,
      options: {
        // Never create an account from this form. A stranger typing an email
        // must not become a user; staff are added by an existing owner.
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    setBusy(false)
    if (error) {
      // These are three different problems and they need three different
      // sentences. "Check the address" sent people to re-type a correct
      // email when the real answer was "wait a minute" or "you have no
      // account yet".
      const status = error.status ?? 0
      if (status === 429) {
        return setError('Too many attempts just now. Wait a minute and try again.')
      }
      if (/not found|signups not allowed|invalid/i.test(error.message)) {
        return setError(
          `We don't recognise ${address}. Ask whoever runs your academy to add you — or if you are a parent, use the link your coach sent you.`
        )
      }
      return setError(error.message)
    }
    setEmail(address)
    setSent(true)
  }

  if (checking) {
    return (
      <main
        className="grid min-h-dvh place-items-center"
        style={{ background: 'var(--paper)' }}
      >
        <p className="text-sm text-ink-2">Signing you in…</p>
      </main>
    )
  }

  if (sent) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 p-6">
        <h1 className="text-2xl font-semibold">Check your email</h1>
        <p className="text-sm text-ink-2">
          We sent a sign-in link to {email}. It expires shortly and works once.
        </p>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Squadroom</h1>
        <p className="mt-1 text-sm text-ink-2">Coach and admin sign-in.</p>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-2">Email</span>
          <input
            required
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-xl border border-[var(--line)] px-3 py-3 text-base"
            autoComplete="email"
            // A phone will otherwise capitalise and autocorrect an email
            // address into something that no longer exists.
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="rounded-xl px-4 py-3 font-medium text-white disabled:opacity-50"
          style={{ background: 'var(--brand)' }}
        >
          {busy ? 'Sending…' : 'Email me a link'}
        </button>

        <p className="text-center text-sm text-ink-2">
          New here?{' '}
          <Link href="/signup" className="underline underline-offset-4">
            Set up an academy or club
          </Link>
        </p>
        <p className="text-center text-xs text-ink-2">
          Parents don&apos;t sign in — their coach lets them in.
        </p>
      </form>
    </main>
  )
}
