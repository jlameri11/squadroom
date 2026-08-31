import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateSecret, hashSecret, toE164 } from '@/lib/join'

/**
 * A parent taps the coach's link and says who they are.
 *
 * Runs with the service role because there is no user yet — that is the whole
 * point of the flow. Nothing here grants access: it creates a pending request
 * that a coach still has to approve.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Bad request' }, { status: 400 })

  const { token, fullName, phone, children } = body as {
    token?: string
    fullName?: string
    phone?: string
    children?: string[]
  }

  if (!token || !fullName?.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }

  const e164 = phone ? toE164(phone) : null
  if (phone && !e164) {
    return NextResponse.json(
      { error: "That doesn't look like an Australian mobile number." },
      { status: 400 }
    )
  }

  const admin = createAdminClient()

  const { data: link } = await admin
    .from('join_links')
    .select('id, academy_id, team_id, role, max_uses, use_count, expires_at, revoked_at')
    .eq('token', token)
    .maybeSingle()

  // One message for every failure. Distinguishing "revoked" from "never
  // existed" tells someone probing which tokens are real.
  const linkDead =
    !link ||
    link.revoked_at !== null ||
    new Date(link.expires_at) < new Date() ||
    (link.max_uses !== null && link.use_count >= link.max_uses)

  if (linkDead) {
    return NextResponse.json(
      { error: 'This invite link is no longer active. Ask your coach for a new one.' },
      { status: 404 }
    )
  }

  const secret = generateSecret()

  const { data: created, error } = await admin
    .from('join_requests')
    .insert({
      academy_id: link.academy_id,
      team_id: link.team_id,
      join_link_id: link.id,
      full_name: fullName.trim(),
      phone: e164,
      children_names: (children ?? []).map((c) => c.trim()).filter(Boolean),
      secret_hash: hashSecret(secret),
    })
    .select('id')
    .single()

  if (error) {
    return NextResponse.json({ error: 'Could not send your request.' }, { status: 500 })
  }

  // The secret goes to the browser and nowhere else. The database has only
  // its hash, so a database leak cannot mint anyone a session.
  return NextResponse.json({ requestId: created.id, secret })
}
