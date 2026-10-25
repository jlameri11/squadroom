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
  // Read in the initialiser rather than set from an effect. Setting state
  // synchronously inside an effect costs a second render of the whole form,
  // and localStorage answers immediately — the guard is only because these
  // components also render on the server to produce the shell.
  const [email, setEmail] = useState(() => {
    if (typeof window === 'undefined') return ''
    try {
      return localStorage.getItem('squadroom.lastEmail') ?? ''
    } catch {
      return ''
    }
  })
  const [password, setPassword] = useState('')
  // Password first. A magic link is the right door for a coach arriving for
  // the first time; it is the wrong one for anybody who signs in regularly —
  // it needs a working inbox, a working mail server, and a wait.
  const [mode, setMode] = useState<'link' | 'password'>('password')
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

  /**
   * Password sign-in, for anyone who would rather not wait for an email.
   *
   * Ordinary Supabase auth, not a shortcut around it: the same session, the
   * same RLS, the same everything. It exists because a magic link needs a
   * working inbox and a working mail server, and when either is having a bad
   * day there has to be another door that is not a back one.
   */
  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })
    setBusy(false)
    if (error) {
      return setError(
        /invalid login/i.test(error.message)
          ? 'That email and password do not match. If you have never set a password, use the emailed link instead.'
          : error.message
      )
    }
    try {
      localStorage.setItem('squadroom.lastEmail', email.trim().toLowerCase())
    } catch {}
    window.location.replace('/')
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)

    // A phone keyboard capitalises the first letter and autocomplete often
    // leaves a trailing space, and `type="email"` then refuses to submit at
    // all — the browser shows its own tooltip, our error never runs, and it
    // reads as the form being broken.
    const address = email.trim().toLowerCase()

    // Squadroom's own email first. Supabase's built-in mail server allows a
    // couple of messages an hour across the whole project, which means two
    // coaches signing in on a Saturday lock each other out.
    const ours = await fetch('/api/auth/send-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: address }),
    })

    if (ours.ok) {
      setBusy(false)
      setEmail(address)
      return setSent(true)
    }

    if (ours.status === 429) {
      const payload = await ours.json().catch(() => null)
      setBusy(false)
      return setError(payload?.error ?? 'A link is already on its way. Check your inbox.')
    }

    // 503 means no mail provider is configured on this deployment. Fall back
    // to Supabase's own, which works — just slowly, and with the shared limit.
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email: address,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    setBusy(false)
    if (error) {
      const status = error.status ?? 0
      if (status === 429) {
        return setError(
          'Too many sign-in emails have gone out from this club in the last hour. Ask whoever set Squadroom up to add a mail provider, or try again shortly.'
        )
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
      <Frame>
        <p className="text-sm" style={{ color: '#ffffffb3' }}>
          Signing you in…
        </p>
      </Frame>
    )
  }

  if (sent) {
    return (
      <Frame>
        <h1 className="display text-[28px] leading-tight" style={{ color: 'var(--brand-ink)' }}>
          Check your email
        </h1>
        <p className="mt-2 text-sm" style={{ color: '#ffffffb3' }}>
          A sign-in link is on its way to <b style={{ color: '#fff' }}>{email}</b>. It works once
          and expires shortly.
        </p>
        <button
          onClick={() => setSent(false)}
          className="mt-5 text-sm underline underline-offset-4"
          style={{ color: '#ffffffb3' }}
        >
          Use a password instead
        </button>
      </Frame>
    )
  }

  return (
    <Frame>
      <h1 className="display text-[34px] leading-none" style={{ color: 'var(--brand-ink)' }}>
        Squadroom
      </h1>
      {/*
        Said on the sign-in screen itself, because the people most likely to
        land here by mistake are parents who were sent a join link and tapped
        the wrong thing. Telling them they do not need an account is faster
        than them failing to make one.
      */}
      <p className="mt-1.5 text-sm" style={{ color: '#ffffffb3' }}>
        For coaches and club admins. Parents don&apos;t need an account yet — tap your coach&apos;s
        link, or{' '}
        <Link href="/join" className="underline underline-offset-4" style={{ color: '#fff' }}>
          enter their join code
        </Link>
        .
      </p>

      <form
        onSubmit={mode === 'password' ? signInWithPassword : submit}
        className="mt-6 flex flex-col gap-4"
      >
        <label className="flex flex-col gap-1.5">
          <span className="eyebrow" style={{ color: '#ffffff99' }}>Email</span>
          <input
            required
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-xl border px-3.5 py-3 text-base"
            style={{ background: '#ffffff14', borderColor: '#ffffff2e', color: '#fff' }}
            autoComplete="username"
            // A phone will otherwise capitalise and autocorrect an email
            // address into something that no longer exists.
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>

        {mode === 'password' && (
          <label className="flex flex-col gap-1.5">
            <span className="eyebrow" style={{ color: '#ffffff99' }}>Password</span>
            <input
              required
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="rounded-xl border px-3.5 py-3 text-base"
              style={{ background: '#ffffff14', borderColor: '#ffffff2e', color: '#fff' }}
            />
          </label>
        )}

        {error && (
          <p
            className="rounded-lg px-3 py-2.5 text-sm"
            style={{ background: '#ffffff1f', color: '#FFD9CE' }}
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="rounded-xl px-4 py-3.5 font-semibold disabled:opacity-50"
          style={{ background: 'var(--gold)', color: '#202842' }}
        >
          {busy
            ? mode === 'password' ? 'Signing in…' : 'Sending…'
            : mode === 'password' ? 'Sign in' : 'Email me a link'}
        </button>

        <button
          type="button"
          onClick={() => { setMode(mode === 'password' ? 'link' : 'password'); setError(null) }}
          className="text-center text-sm underline underline-offset-4"
          style={{ color: '#ffffffb3' }}
        >
          {mode === 'password' ? 'Email me a link instead' : 'Use a password instead'}
        </button>

        {/*
          The two doors, named for what the person is rather than what they
          will do: somebody joining a club, and somebody running one. "Sign up"
          alone has always sent parents to found an academy by mistake.
        */}
        <p className="pt-1 text-center text-sm" style={{ color: '#ffffff99' }}>
          Joining a club?{' '}
          <Link href="/join" className="underline underline-offset-4" style={{ color: '#fff' }}>
            Use your join code
          </Link>
        </p>
        <p className="text-center text-sm" style={{ color: '#ffffff99' }}>
          Running one?{' '}
          <Link href="/signup" className="underline underline-offset-4" style={{ color: '#fff' }}>
            Set up an academy, club or league
          </Link>
        </p>
      </form>
    </Frame>
  )
}

/**
 * The navy ground every state sits on.
 *
 * A sign-in screen is the first thing a coach sees, and a bare white form
 * with two inputs says nothing about what they are signing in to. The crest
 * mark and the club navy do the work that a logo file would, without needing
 * one — Squadroom is multi-tenant, so this screen cannot wear any single
 * club's badge.
 */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main
      className="flex min-h-dvh flex-col justify-center px-6 py-10"
      style={{ background: 'var(--brand)' }}
    >
      <div className="mx-auto w-full max-w-sm">
        <span
          className="display mb-6 grid h-12 w-12 place-items-center rounded-[14px] text-lg"
          style={{ background: 'var(--gold)', color: '#202842' }}
          aria-hidden
        >
          SQ
        </span>
        {children}
      </div>
    </main>
  )
}
