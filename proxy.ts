import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import type { Database } from '@/lib/database.types'

/**
 * Keeps the Supabase session fresh on every request.
 *
 * Named `proxy`, not `middleware`: Next 16 renamed the file convention and
 * the exported function. It runs on the Node runtime only — the edge runtime
 * is not supported here.
 *
 * Parents are meant never to sign in again after the coach approves them, so
 * silent refresh is not a nicety. If this stops working they get bounced to a
 * login screen that, by design, does not exist for them.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value)
          }
          response = NextResponse.next({ request })
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options)
          }
        },
      },
    }
  )

  // Refreshes the token when it is near expiry and rewrites the cookies. Do
  // not remove: parents are meant never to see a sign-in screen again after
  // their coach approves them.
  //
  // getClaims rather than getUser. getUser calls Supabase on EVERY request,
  // and with each page doing the same that was two round trips to Sydney
  // before a single query ran. getClaims verifies the signature locally
  // against cached JWKS and still refreshes an expiring token.
  await supabase.auth.getClaims()

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
