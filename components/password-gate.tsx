'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { isPublicPage } from '@/lib/routes'
import { PasswordField, MIN_PASSWORD } from '@/components/account/password-field'

type Me = { has_password?: boolean; password_deferred?: boolean; placeholder?: boolean; sign_in_email?: string | null }
type Gate = { email: string | null; canDefer: boolean; memo: string }

/**
 * "Anyone without a password sets one next time they sign in (one screen,
 * 'Not now' allowed once)" — the sign-up brief, 12 Nov 2026.
 *
 * For an account that signs in with a real address and has no password yet
 * (the coaches and owners who came in by emailed link). Asked once per
 * sign-in (the token's session id); "Not now" is the database's to allow,
 * once (`defer_password`), and after that the screen comes back on the next
 * sign-in without it. An account made from a phone number has no address a
 * password could go with; it sets one from Settings, where adding the email
 * comes first. Rendered above every page by the root layout, like the email
 * gate; nothing on the public pages or when signed out.
 */
export function PasswordGate() {
  const pathname = usePathname()
  const [gate, setGate] = useState<Gate | null>(null)

  useEffect(() => {
    if (isPublicPage(pathname)) return
    let live = true
    ;(async () => {
      const supabase = createClient()
      const { data: c } = await supabase.auth.getClaims()
      const sub = c?.claims?.sub as string | undefined
      if (!sub) return
      const sid = (c?.claims?.session_id as string | undefined) ?? sub
      const memo = `squadroom.password.${sid}`
      try {
        if (sessionStorage.getItem(memo) === 'clear') return
      } catch {
        // A private window: ask every time.
      }
      const { data, error } = await supabase.rpc('my_account')
      if (!live) return
      const me = data as unknown as Me | null
      if (!error && me && me.has_password === false && !me.placeholder) {
        setGate({ email: me.sign_in_email ?? null, canDefer: !me.password_deferred, memo })
        return
      }
      try {
        sessionStorage.setItem(memo, 'clear')
      } catch {}
    })()
    return () => {
      live = false
    }
  }, [pathname])

  if (!gate) return null
  const done = () => {
    try {
      sessionStorage.setItem(gate.memo, 'clear')
    } catch {}
    setGate(null)
  }
  return <SetPasswordScreen email={gate.email} canDefer={gate.canDefer} onDone={done} />
}

function SetPasswordScreen({ email, canDefer, onDone }: { email: string | null; canDefer: boolean; onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < MIN_PASSWORD) return setError(`At least ${MIN_PASSWORD} characters, please.`)
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setBusy(false)
      return setError(error.message)
    }
    // Recorded with the account: auth.users cannot say whether a person set one (0272).
    await supabase.rpc('mark_password_set')
    setBusy(false)
    onDone()
  }

  async function later() {
    setBusy(true)
    await createClient().rpc('defer_password')
    setBusy(false)
    onDone()
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-paper p-6" data-password-gate role="dialog" aria-modal="true" aria-labelledby="password-title">
      <form onSubmit={save} className="card w-full max-w-sm p-5" noValidate>
        <h1 id="password-title" className="display text-[1.375rem] leading-tight">Set a password</h1>
        <p className="mt-1 text-sm text-ink-2">
          Next time you sign in with {email ? <b className="text-ink">{email}</b> : 'your email'} and this password — no waiting for an email.
        </p>
        <div className="mt-4">
          <PasswordField value={password} onChange={setPassword} autoComplete="new-password" inputProps={{ autoFocus: true, 'data-password': '' } as React.InputHTMLAttributes<HTMLInputElement>} />
        </div>
        {error && (
          <p className="mt-3 rounded-lg px-3 py-2 text-sm" style={{ background: 'var(--no-bg)', color: 'var(--no)' }} role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy || password.length < MIN_PASSWORD} className="mt-4 w-full rounded-xl px-4 py-3 font-semibold disabled:opacity-50" style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }} data-set-password-save>
          {busy ? 'Saving…' : 'Save password'}
        </button>
        {canDefer && (
          <button type="button" onClick={later} disabled={busy} className="tap mt-3 w-full text-center text-sm underline underline-offset-4 text-ink-2" data-set-password-later>
            Not now
          </button>
        )}
      </form>
    </div>
  )
}
