import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { secretMatches } from '@/lib/join'

/**
 * The family answers the club's question (the registration brief, gap 7;
 * 0268). No account yet, so the page that registered sends the answer with
 * the request's secret; the service role writes it onto the request, where
 * the queue shows it. Nothing here grants anything.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const { requestId, secret, reply } = (body ?? {}) as { requestId?: string; secret?: string; reply?: string }
  const text = (reply ?? '').trim()
  if (!requestId || !secret || !text) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  if (text.length > 1000) return NextResponse.json({ error: 'Keep it under a thousand characters.' }, { status: 400 })

  const admin = createAdminClient()
  const { data: req } = await admin.from('registration_requests').select('id, status, secret_hash, info_requested_at').eq('id', requestId).maybeSingle()
  if (!req || !secretMatches(secret, req.secret_hash)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (req.status !== 'pending') return NextResponse.json({ error: `This registration is ${req.status}.` }, { status: 409 })
  if (!req.info_requested_at) return NextResponse.json({ error: 'The club has not asked for anything.' }, { status: 409 })

  await admin.from('registration_requests').update({ family_reply: text, family_replied_at: new Date().toISOString() }).eq('id', req.id)
  return NextResponse.json({ ok: true })
}
