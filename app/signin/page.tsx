'use client'

import { useState } from 'react'
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
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // Never create an account from this form. A stranger typing an email
        // must not become a user; staff are added by an existing owner.
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    setBusy(false)
    if (error) return setError('Could not send the link. Check the address.')
    setSent(true)
  }

  if (sent) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 p-6">
        <h1 className="text-2xl font-semibold">Check your email</h1>
        <p className="text-sm text-neutral-500">
          We sent a sign-in link to {email}. It expires shortly and works once.
        </p>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Squadroom</h1>
        <p className="mt-1 text-sm text-neutral-500">Coach and admin sign-in.</p>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Email</span>
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-xl border border-neutral-300 px-3 py-3"
            autoComplete="email"
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="rounded-xl px-4 py-3 font-medium text-white disabled:opacity-50"
          style={{ background: '#202842' }}
        >
          {busy ? 'Sending…' : 'Email me a link'}
        </button>

        <p className="text-center text-sm text-neutral-500">
          New here?{' '}
          <Link href="/signup" className="underline underline-offset-4">
            Set up an academy or club
          </Link>
        </p>
        <p className="text-center text-xs text-neutral-500">
          Parents don&apos;t sign in — their coach lets them in.
        </p>
      </form>
    </main>
  )
}
