'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * Fetch a screen's data from the BROWSER rather than the server.
 *
 * Where everyone is decides this. Netlify runs the app in us-east-2 and
 * Supabase is in Sydney, so a server-rendered page pays a 250ms Pacific
 * crossing before it can draw anything — and the people using it are in
 * Sydney, a few milliseconds from that same database. Rendering on the server
 * was making an Australian club pay for an American detour on every tap.
 *
 * So the server does only the auth check, which getClaims answers locally for
 * free, and hands over a shell. The shell paints immediately; the data lands
 * on the next frame.
 *
 * It is also what CLAUDE.md meant by client-first: every rule lives in the
 * database, so which side asks makes no difference to what comes back.
 */
export function useScreen<T>(fn: string, args?: Record<string, unknown>) {
  const [data, setData] = useState<T | null>(null)
  const [failed, setFailed] = useState(false)
  const key = JSON.stringify(args ?? {})

  useEffect(() => {
    let live = true
    createClient()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .rpc(fn as any, args as any)
      .then(({ data, error }: { data: unknown; error: { code?: string } | null }) => {
        if (!live) return

        // These screens no longer check the session on the server, so this is
        // where a signed-out visitor is turned away. Every screen RPC returns
        // null when auth.uid() is null, and PostgREST answers 401 when the
        // token is missing or expired — both mean the same thing here.
        const unauthenticated = data === null || error?.code === 'PGRST301' || error?.code === '401'
        if (unauthenticated && !error) {
          window.location.replace('/signin')
          return
        }
        if (error || data == null) return setFailed(true)
        setData(data as T)
      })
    return () => {
      live = false
    }
    // args is compared by value, not identity — an object literal in a caller
    // would otherwise re-fetch on every render.
  }, [fn, key])  // eslint-disable-line react-hooks/exhaustive-deps

  return { data, failed }
}
