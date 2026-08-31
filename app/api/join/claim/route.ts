import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { secretMatches, syntheticEmail } from '@/lib/join'

/**
 * The browser that made the request comes back and collects its session.
 *
 * This is the one place a session is created without anyone typing anything,
 * so it is the most sensitive route in the app. Four conditions, all required:
 * the request exists, a coach approved it, it has never been claimed before,
 * and the caller holds the secret we issued to that browser.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const { requestId, secret } = (body ?? {}) as { requestId?: string; secret?: string }
  if (!requestId || !secret) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: req } = await admin
    .from('join_requests')
    .select('id, status, secret_hash, claimed_at, profile_id, phone')
    .eq('id', requestId)
    .maybeSingle()

  if (!req || !secretMatches(secret, req.secret_hash)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (req.status === 'pending') {
    return NextResponse.json({ status: 'pending' }, { status: 202 })
  }
  if (req.status !== 'approved' || !req.profile_id || !req.phone) {
    return NextResponse.json({ status: req.status }, { status: 403 })
  }
  // One claim only. A second device with the same secret gets nothing.
  if (req.claimed_at) {
    return NextResponse.json({ error: 'Already used' }, { status: 409 })
  }

  // Mark it claimed BEFORE minting, so two simultaneous requests cannot both
  // succeed. The conditional update is the lock.
  const { data: locked } = await admin
    .from('join_requests')
    .update({ claimed_at: new Date().toISOString() })
    .eq('id', requestId)
    .is('claimed_at', null)
    .select('id')
    .maybeSingle()

  if (!locked) return NextResponse.json({ error: 'Already used' }, { status: 409 })

  // Generate a one-time token without sending anything anywhere, then redeem
  // it here on the server so the session never travels as a URL.
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: syntheticEmail(req.phone),
  })
  const tokenHash = link?.properties?.hashed_token
  if (linkErr || !tokenHash) {
    return NextResponse.json({ error: 'Could not sign you in.' }, { status: 500 })
  }

  const supabase = await createClient()
  const { error: verifyErr } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: 'email',
  })
  if (verifyErr) {
    return NextResponse.json({ error: 'Could not sign you in.' }, { status: 500 })
  }

  // verifyOtp on the ssr client writes the session cookies for us.
  return NextResponse.json({ status: 'approved' })
}
