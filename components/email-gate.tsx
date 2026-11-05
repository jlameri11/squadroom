'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { isPublicPage } from '@/lib/routes'
import { checkEmail } from '@/lib/email'

type Gate =
  | { kind: 'email' }
  | { kind: 'teen'; status: 'waiting' | 'refused'; firstName: string | null; club: string | null }

/**
 * Every account has an email (Joey, 5 Nov 2026).
 *
 * An account that has none — the parents who joined by phone before this —
 * is asked once, on its next open: one screen, one field, and no way past
 * except giving one or signing out. Any address is fine; it never has to
 * match PlayFootball's. The "news and offers" box is separate, unticked, and
 * never required. A one-tap link to confirm the address follows when
 * Squadroom can send email.
 *
 * And a teenager whose parent set up their login (0215) is matched to the
 * invitation here, on their first open, and waits — seeing nothing of the
 * club — until the parent says yes.
 *
 * Rendered above every page by the root layout, like the two-step gate. Not
 * on the pages that are not the app (signing in, joining, a club's public
 * pages), not when signed out, and not before 0214 exists (the functions
 * error, and nothing is asked).
 */
export function EmailGate() {
  const pathname = usePathname()
  const [gate, setGate] = useState<Gate | null>(null)
  const checked = useRef(false)

  useEffect(() => {
    if (checked.current || isPublicPage(pathname)) return
    checked.current = true
    let live = true
    ;(async () => {
      const supabase = createClient()
      const { data: s } = await supabase.auth.getSession()
      if (!s.session) return
      const { data: teen, error: teenError } = await supabase.rpc('claim_player_login')
      const t = teen as { status?: string; first_name?: string | null; club?: string | null } | null
      if (!teenError && t && (t.status === 'waiting' || t.status === 'refused')) {
        if (live) setGate({ kind: 'teen', status: t.status, firstName: t.first_name ?? null, club: t.club ?? null })
        return
      }
      const { data: me, error } = await supabase.rpc('my_email')
      if (!live || error || !me) return
      if ((me as { needs_email?: boolean }).needs_email) setGate({ kind: 'email' })
    })()
    return () => {
      live = false
    }
  }, [pathname])

  if (!gate) return null

  async function signOut() {
    await createClient().auth.signOut()
    window.location.replace('/signin')
  }

  if (gate.kind === 'teen') {
    return (
      <div className="fixed inset-0 z-50 grid place-items-center bg-paper p-6" data-teen-gate={gate.status} role="dialog" aria-modal="true" aria-labelledby="teen-title">
        <div className="card w-full max-w-sm p-5">
          <h1 id="teen-title" className="display text-[1.375rem] leading-tight">
            {gate.status === 'waiting' ? 'Waiting for your parent' : 'Not this time'}
          </h1>
          <p className="mt-1 text-sm text-ink-2">
            {gate.status === 'waiting'
              ? `${gate.firstName ? `Hi ${gate.firstName}. ` : ''}Your parent set up your login${gate.club ? ` for ${gate.club}` : ''}. They need to approve it in Squadroom before you can see your team. Ask them to open My family.`
              : 'Your parent didn’t approve this login. If that’s a mistake, ask them to set it up again from My family.'}
          </p>
          <button onClick={() => window.location.reload()} className="mt-4 w-full rounded-xl px-4 py-3 font-semibold" style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}>
            Check again
          </button>
          <button type="button" onClick={signOut} className="tap mt-3 w-full text-center text-sm underline underline-offset-4 text-ink-2">
            Sign out
          </button>
        </div>
      </div>
    )
  }

  return <AskForEmail onDone={() => setGate(null)} onSignOut={signOut} />
}

function AskForEmail({ onDone, onSignOut }: { onDone: () => void; onSignOut: () => void }) {
  const [email, setEmail] = useState('')
  const [news, setNews] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const check = checkEmail(email)
    if (!check.ok) return setError(check.error)
    setBusy(true)
    setError(null)
    const { error } = await createClient().rpc('set_my_email', { p_email: check.email, p_news: news })
    if (error) {
      setBusy(false)
      return setError(error.message)
    }
    // The one-tap link; silent when Squadroom cannot send email yet.
    await fetch('/api/email/confirm', { method: 'POST' }).catch(() => null)
    setBusy(false)
    onDone()
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-paper p-6" data-email-gate role="dialog" aria-modal="true" aria-labelledby="email-title">
      <form onSubmit={save} className="card w-full max-w-sm p-5" noValidate>
        <h1 id="email-title" className="display text-[1.375rem] leading-tight">Add your email</h1>
        <p className="mt-1 text-sm text-ink-2">
          Every Squadroom account has one, so your club and your league can reach you. Any email you read —
          it doesn&apos;t have to match PlayFootball. You&apos;ll still sign in the way you do now.
        </p>
        <label className="mt-4 block">
          <span className="eyebrow">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            inputMode="email"
            autoComplete="email"
            autoFocus
            placeholder="you@example.com"
            className="mt-1 w-full rounded-xl border px-3 py-3"
            style={{ borderColor: 'var(--line)' }}
            data-email-input
          />
        </label>
        <label className="mt-3 flex items-start gap-2.5 text-sm text-ink-2">
          <input
            type="checkbox"
            checked={news}
            onChange={(e) => setNews(e.target.checked)}
            className="mt-0.5 h-4 w-4 flex-none"
            data-news-opt-in
          />
          <span>Send me news and offers from Squadroom <span className="text-ink-3">(optional)</span></span>
        </label>
        {error && (
          <p className="mt-3 rounded-lg px-3 py-2 text-sm" style={{ background: 'var(--no-bg)', color: 'var(--no)' }} role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy || !email.trim()} className="mt-4 w-full rounded-xl px-4 py-3 font-semibold disabled:opacity-50" style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}>
          {busy ? 'Saving…' : 'Save and continue'}
        </button>
        <button type="button" onClick={onSignOut} className="tap mt-3 w-full text-center text-sm underline underline-offset-4 text-ink-2">
          Sign out instead
        </button>
      </form>
    </div>
  )
}
