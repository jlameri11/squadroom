import { createHash, randomInt } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/** Hashed, never stored raw — the same spam control as the request route. */
function clientIpHash(request: Request): string {
  const fwd =
    request.headers.get('x-nf-client-connection-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  return createHash('sha256').update(fwd).digest('hex')
}

// No 0/O or 1/I: a code read out over the phone has to survive it.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const newCode = () => {
  let s = ''
  for (let i = 0; i < 6; i++) s += ALPHABET[randomInt(ALPHABET.length)]
  return s
}
const normalise = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '')
const pretty = (code: string) => `${code.slice(0, 3)}-${code.slice(3)}`
const MAX_DRAFT_BYTES = 16 * 1024

/**
 * A draft saved beyond the browser, for a family with no account yet (the
 * registration brief, gap 8; 0269). `save` keeps the half-filled form under
 * a six-letter code and hands the code back; `load` returns it on any
 * phone; `clear` removes it once the registration is sent. A signed-in
 * person's draft never comes here — the form keeps theirs against their
 * account, under RLS. The code is the key, rate-limited like the form
 * itself; a draft lasts fourteen days.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const { action, slug, draft, code } = (body ?? {}) as { action?: string; slug?: string; draft?: unknown; code?: string }
  if (!slug || !action) return NextResponse.json({ error: 'Bad request' }, { status: 400 })

  const admin = createAdminClient()
  const { data: throttled } = await admin.rpc('check_registration_rate', { p_ip_hash: clientIpHash(request), p_program: null as unknown as string })
  if (throttled) return NextResponse.json({ error: 'Too many tries just now. Try again shortly.' }, { status: 429 })

  const { data: academy } = await admin.from('academies').select('id').eq('slug', slug.trim().toLowerCase()).neq('type', 'league').maybeSingle()
  if (!academy) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Expired drafts go when anyone passes by; nothing else sweeps them.
  await admin.from('registration_drafts').delete().lt('expires_at', new Date().toISOString())

  if (action === 'save') {
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
    if (JSON.stringify(draft).length > MAX_DRAFT_BYTES) return NextResponse.json({ error: 'That draft is too big to keep.' }, { status: 413 })
    for (let attempt = 0; attempt < 5; attempt++) {
      const c = newCode()
      const { error } = await admin.from('registration_drafts').insert({ academy_id: academy.id, code: c, draft: draft as never })
      if (!error) return NextResponse.json({ code: pretty(c), expires_in_days: 14 })
      if (error.code !== '23505') return NextResponse.json({ error: 'Could not save the draft.' }, { status: 500 })
    }
    return NextResponse.json({ error: 'Could not save the draft.' }, { status: 500 })
  }

  const c = normalise(code ?? '')
  if (c.length !== 6) return NextResponse.json({ error: 'A code is six letters and numbers.' }, { status: 400 })

  if (action === 'load') {
    const { data: row } = await admin.from('registration_drafts').select('draft, expires_at').eq('academy_id', academy.id).eq('code', c).maybeSingle()
    if (!row || new Date(row.expires_at) < new Date()) {
      return NextResponse.json({ error: 'No draft with that code here — it may have expired (they keep for 14 days).' }, { status: 404 })
    }
    return NextResponse.json({ draft: row.draft, code: pretty(c) })
  }

  if (action === 'clear') {
    await admin.from('registration_drafts').delete().eq('academy_id', academy.id).eq('code', c)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Bad request' }, { status: 400 })
}
