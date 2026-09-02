'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * Rescues a sign-in that arrives in the URL fragment.
 *
 * Supabase's default email template sends people through the implicit flow,
 * which lands them at the Site URL with `#access_token=...&refresh_token=...`.
 * A fragment is never sent to the server, so the server-side callback cannot
 * see it — the request looks exactly like a signed-out visit and bounces
 * straight to /signin. Clicking a valid, working sign-in link and being asked
 * to sign in is about as bad as an error message gets.
 *
 * Changing the email template to `{{ .TokenHash }}` would also fix it, but
 * that is a dashboard setting on someone else's screen. Handling both shapes
 * here means the app works however the project happens to be configured, and
 * keeps working if the template is ever reset.
 *
 * Mounted in the root layout because the fragment lands on whatever page the
 * Site URL points at, which is not necessarily the callback.
 */
export function HashSession() {
  const [working, setWorking] = useState(false)

  useEffect(() => {
    const hash = window.location.hash
    if (!hash.includes('access_token=')) return

    const params = new URLSearchParams(hash.slice(1))
    const access_token = params.get('access_token')
    const refresh_token = params.get('refresh_token')
    if (!access_token || !refresh_token) return

    setWorking(true)
    const supabase = createClient()
    supabase.auth.setSession({ access_token, refresh_token }).then(({ error }) => {
      // Strip the tokens from the address bar either way. They are
      // credentials, and leaving them in history or a shared screenshot is
      // exactly the leak this whole flow exists to avoid.
      window.history.replaceState(null, '', window.location.pathname)

      if (error) {
        window.location.replace('/signin?error=expired')
        return
      }

      // NOT the current path. The fragment arrives at /auth/callback, whose
      // route handler cannot see it and has already bounced to /signin — so
      // reloading "where we are" put a freshly signed-in person back on the
      // login screen, which is exactly how it looked: the link works, and you
      // end up at sign-in anyway.
      const here = window.location.pathname
      const destination = here === '/signin' || here === '/auth/callback' || here === '/signup'
        ? '/'
        : here + window.location.search

      // A full load rather than a router refresh: the server has to read the
      // cookie setSession just wrote.
      window.location.replace(destination)
    })
  }, [])

  if (!working) return null

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center"
      style={{ background: 'var(--paper)' }}
    >
      <p className="text-sm text-ink-2">Signing you in…</p>
    </div>
  )
}
