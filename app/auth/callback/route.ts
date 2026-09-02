import { NextResponse } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { siteUrl } from '@/lib/site'

/**
 * Where a magic link lands.
 *
 * Two shapes arrive here and both have to work:
 *
 *   ?code=...        PKCE, when the sign-in STARTED in this same browser.
 *                    The verifier is in a cookie, so it only works on the
 *                    device that asked.
 *
 *   ?token_hash=...  What Supabase's email templates send, and what an
 *   &type=magiclink  admin-generated link produces. No verifier, so it works
 *                    from any device — which is the point of emailing a link
 *                    to someone who will open it on their phone.
 *
 * Redirects go to siteUrl(), NOT the request origin. Netlify also serves this
 * app from a per-deploy hostname, and redirecting there set the session
 * cookie on a host the person would never visit again: they landed signed in
 * somewhere real, and the actual site still sent them to /signin. It looked
 * for all the world like sign-in being broken.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null

  // Only ever a path on this site. An open redirect in an auth callback is
  // how a phishing page borrows your domain.
  const requested = searchParams.get('next') ?? '/'
  const next = requested.startsWith('/') && !requested.startsWith('//') ? requested : '/'

  const site = siteUrl()
  const supabase = await createClient()

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) return NextResponse.redirect(`${site}/signin?error=expired`)
    return NextResponse.redirect(`${site}${next}`)
  }

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
    if (error) return NextResponse.redirect(`${site}/signin?error=expired`)
    return NextResponse.redirect(`${site}${next}`)
  }

  return NextResponse.redirect(`${site}/signin?error=missing_code`)
}
