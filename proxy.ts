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
  /**
   * Deliberately NOT every request.
   *
   * This runs a token check against Supabase, which from Netlify's us-east-2
   * to a Sydney database costs about 300ms. It was running on every page, and
   * the pages that also checked for themselves paid it twice — 667ms to draw
   * a shell with no data in it.
   *
   * Home, chat and fixtures are now static shells whose data the browser
   * fetches directly, so none of them needs a server session and none of them
   * runs this. The browser's own client refreshes the token perfectly well;
   * this exists for the routes that genuinely read the session server-side —
   * the API handlers, the join flow, and the admin pages that still render
   * their data on the server.
   */
  matcher: [
    '/api/:path*',
    '/auth/:path*',
    '/join/:path*',
    '/join-competition/:path*',
    '/admin/:path*',
    '/settings/:path*',
    '/competitions/:path*',
    '/payments/:path*',
    '/scan/:path*',
    '/platform/:path*',
    '/start/:path*',
  ],
}
