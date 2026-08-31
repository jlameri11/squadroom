'use client'

import { useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

/**
 * Public sign-up, for the person who runs something.
 *
 * Coaches, club owners and event organisers arrive here. Parents never do -
 * they come through a join link and are let in by their coach. Keeping those
 * two doors separate is what stops "sign up" ever appearing in front of a
 * parent who just wants to know what time the game is.
 */
function SignUpForm() {
  const params = useSearchParams()
  const next = params.get('next') ?? '/start'
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
        shouldCreateUser: true,
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    })

    setBusy(false)
    if (error) return setError('Could not send the link. Check the address and try again.')
    setSent(true)
  }

  if (sent) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 p-6">
        <h1 className="text-2xl font-semibold">Check your email</h1>
        <p className="text-sm text-neutral-500">
          We sent a link to {email}. Open it on the device you want to use — that&apos;s where
          you&apos;ll stay signed in.
        </p>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 p-6">
      <div>
        <h1 className="text-2xl font-semibold" style={{ color: '#202842' }}>
          Get started
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          For coaches, clubs and anyone running a competition. No password.
        </p>
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
      </form>

      <p className="text-center text-sm text-neutral-500">
        Already set up? <Link href="/signin" className="underline underline-offset-4">Sign in</Link>
      </p>
      <p className="text-center text-xs text-neutral-500">
        Parents don&apos;t need an account here — your coach sends you a link.
      </p>
    </main>
  )
}

export default function SignUp() {
  // useSearchParams needs a Suspense boundary, or the whole route opts out of
  // static rendering.
  return (
    <Suspense fallback={null}>
      <SignUpForm />
    </Suspense>
  )
}
