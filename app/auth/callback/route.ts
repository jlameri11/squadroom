import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Where a magic link lands. @supabase/ssr uses PKCE, so the email link comes
 * back with a code that is exchanged here, server-side, for a session — the
 * tokens never appear in a URL the browser can leak through a referrer.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/admin/requests'

  if (!code) return NextResponse.redirect(`${origin}/signin?error=missing_code`)

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) return NextResponse.redirect(`${origin}/signin?error=expired`)

  return NextResponse.redirect(`${origin}${next}`)
}
