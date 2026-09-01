import { NextResponse } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

/**
 * Where a magic link lands.
 *
 * There are two shapes a link can arrive in and this has to accept both.
 *
 *   ?code=...        PKCE, when the sign-in was STARTED in this same browser.
 *                    The verifier is in a cookie, so the exchange only works
 *                    on the device that asked.
 *
 *   ?token_hash=...  What Supabase's own email templates send, and what
 *   &type=magiclink  admin-generated links produce. No verifier, so it works
 *                    from any device — which is the point of emailing a link
 *                    to someone who may open it on their phone.
 *
 * Only handling `code` meant every link that did not originate in the same
 * browser bounced silently to /signin?error=missing_code, which reads exactly
 * like "the link is broken" and is impossible to tell apart from an expired
 * one.
 *
 * Either way the tokens are exchanged server-side and land in cookies. They
 * never sit in a URL the browser could leak through a referrer.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const next = searchParams.get('next') ?? '/'

  const supabase = await createClient()

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) return NextResponse.redirect(`${origin}/signin?error=expired`)
    return NextResponse.redirect(`${origin}${next}`)
  }

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
    if (error) return NextResponse.redirect(`${origin}/signin?error=expired`)
    return NextResponse.redirect(`${origin}${next}`)
  }

  return NextResponse.redirect(`${origin}/signin?error=missing_code`)
}
