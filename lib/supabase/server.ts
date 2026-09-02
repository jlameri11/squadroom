import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/lib/database.types'

/**
 * Server-side client acting as the signed-in user. Still subject to RLS —
 * this is not a privileged client. Use it in route handlers that need to
 * know who is asking.
 *
 * cookies() is async in Next 16; synchronous access was removed.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options)
            }
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // Harmless: proxy.ts refreshes the session on every request.
          }
        },
      },
    }
  )
}

/**
 * Who is asking, without a network round trip.
 *
 * `getUser()` calls Supabase to revalidate the token on EVERY page render.
 * With the proxy doing it too that was two round trips to Sydney before a
 * page had run a single query — and it is why a signed-in screen took 1-2
 * seconds while /signin took 29ms.
 *
 * `getClaims()` verifies the JWT signature locally against the project's
 * cached JWKS, so it is arithmetic rather than a request. It is exactly as
 * trustworthy: a forged token fails signature verification either way, and
 * RLS is still the thing that decides what any of it can read.
 *
 * Returns null rather than throwing, because every caller's next line is a
 * redirect to /signin.
 */
export async function getUserId(): Promise<string | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getClaims()
  if (error || !data?.claims?.sub) return null
  return data.claims.sub
}
