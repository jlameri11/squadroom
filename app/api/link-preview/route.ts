import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { previewable } from '@/lib/links'

/**
 * A link's title and picture, for the bubble.
 *
 * Fetched ONCE, by this server, and cached for a week — a parent's phone
 * never reaches out to a URL somebody else typed. Signed in only, a small
 * per-person rate limit, only http(s) to a public host (lib/links.ts
 * refuses the private ranges a chat message could otherwise aim us at),
 * five seconds, half a megabyte, and the tags read with a regex rather than
 * a parser: a title and a description, not a rendering of the page.
 */
export const runtime = 'nodejs'

const WEEK = 7 * 24 * 3600 * 1000
const MAX_BYTES = 512 * 1024
const PER_HOUR = 60
const recent = new Map<string, number[]>()

function limited(userId: string) {
  const now = Date.now()
  const times = (recent.get(userId) ?? []).filter((t) => now - t < 3600_000)
  if (times.length >= PER_HOUR) return true
  times.push(now)
  recent.set(userId, times)
  return false
}

function meta(html: string, prop: string) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, 'i')
  const alt = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, 'i')
  const m = html.match(re) ?? html.match(alt)
  return m ? decode(m[1]).trim() : null
}
function decode(s: string) {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return NextResponse.json({ error: 'Sign in' }, { status: 401 })

  const raw = new URL(request.url).searchParams.get('url') ?? ''
  const check = previewable(raw)
  if (!check.ok) return NextResponse.json({ error: check.why }, { status: 400 })
  const url = check.url.toString().slice(0, 2000)

  const admin = createAdminClient()
  const { data: cached } = await admin.from('link_previews').select('*').eq('url', url).maybeSingle()
  if (cached && Date.now() - new Date(cached.fetched_at).getTime() < WEEK) {
    return NextResponse.json(cached, { headers: { 'cache-control': 'private, max-age=3600' } })
  }
  if (limited(auth.user.id)) return NextResponse.json({ error: 'Too many previews this hour' }, { status: 429 })

  let row = { url, ok: false, title: null as string | null, description: null as string | null, image_url: null as string | null, site_name: null as string | null }
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'Squadroom link preview (+https://squadroom.app)', accept: 'text/html' },
    })
    clearTimeout(timer)
    const type = res.headers.get('content-type') ?? ''
    if (res.ok && type.includes('text/html')) {
      const reader = res.body?.getReader()
      let html = ''
      if (reader) {
        const decoder = new TextDecoder()
        while (html.length < MAX_BYTES) {
          const { done, value } = await reader.read()
          if (done) break
          html += decoder.decode(value, { stream: true })
        }
        reader.cancel().catch(() => {})
      }
      const title = meta(html, 'og:title') ?? (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? null)
      const image = meta(html, 'og:image')
      row = {
        url,
        ok: Boolean(title),
        title: title ? decode(title).trim().slice(0, 200) : null,
        description: (meta(html, 'og:description') ?? meta(html, 'description'))?.slice(0, 300) ?? null,
        image_url: image && /^https?:\/\//i.test(image) ? image.slice(0, 1000) : null,
        site_name: meta(html, 'og:site_name')?.slice(0, 100) ?? null,
      }
    }
  } catch {
    // A page that will not answer gets a row saying so, so it is not
    // fetched again for a week by every phone that scrolls past it.
  }
  await admin.from('link_previews').upsert({ ...row, fetched_at: new Date().toISOString() })
  return NextResponse.json(row, { headers: { 'cache-control': 'private, max-age=3600' } })
}
