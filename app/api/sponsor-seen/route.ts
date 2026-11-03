import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * X-08: the public match centre says it showed the sponsor strip; one row
 * per sponsor per day goes up by one. No cookie, nothing about the reader —
 * a slug and a count. The function itself is callable by the service role
 * only, so a browser cannot inflate a sponsor's number by calling it.
 */
export const runtime = 'nodejs'

export async function POST(request: Request) {
  let slug = ''
  try {
    const body = (await request.json()) as { slug?: string }
    slug = String(body.slug ?? '').slice(0, 120)
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  if (!/^[a-z0-9-]+$/i.test(slug)) return NextResponse.json({ ok: false }, { status: 400 })
  const { data } = await createAdminClient().rpc('count_sponsor_views', { p_slug: slug })
  return NextResponse.json({ ok: true, counted: data ?? 0 })
}
