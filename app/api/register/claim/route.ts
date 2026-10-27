import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { secretMatches, syntheticEmail } from '@/lib/join'

/**
 * The family comes back and collects their session.
 *
 * The same four conditions as the join claim, and the same reasoning: this is
 * one of only two places a session is created without anybody typing a
 * password, so it is the most sensitive route in the app. The request must
 * exist, a club must have approved it, it must never have been claimed, and
 * the caller must hold the secret issued to that browser.
 *
 * The secret is what binds the account to the DEVICE that registered. A club
 * approving "Sam Whitfield" does not sign in whoever else happens to hold the
 * link — which matters more here than for a join link, because a registration
 * page is public and its URL is meant to be shared.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const { requestId, secret } = (body ?? {}) as { requestId?: string; secret?: string }
  if (!requestId || !secret) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: req } = await admin
    .from('registration_requests')
    .select('id, status, secret_hash, claimed_at, profile_id, guardian_phone, expires_at')
    .eq('id', requestId)
    .maybeSingle()

  // One answer for "no such request" and "wrong secret". Distinguishing them
  // tells somebody probing which ids are real.
  if (!req || !secretMatches(secret, req.secret_hash)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (new Date(req.expires_at) < new Date()) {
    return NextResponse.json({ status: 'expired' }, { status: 410 })
  }
  if (req.status === 'pending') {
    return NextResponse.json({ status: 'pending' }, { status: 202 })
  }
  if (req.status !== 'approved' || !req.profile_id || !req.guardian_phone) {
    return NextResponse.json({ status: req.status }, { status: 403 })
  }
  // One claim only. A second device with the same secret gets nothing.
  if (req.claimed_at) {
    return NextResponse.json({ error: 'Already used' }, { status: 409 })
  }

  // Marked claimed BEFORE minting, so two simultaneous requests cannot both
  // succeed. The conditional update is the lock.
  const { data: locked } = await admin
    .from('registration_requests')
    .update({ claimed_at: new Date().toISOString() })
    .eq('id', requestId)
    .is('claimed_at', null)
    .select('id')
    .maybeSingle()

  if (!locked) return NextResponse.json({ error: 'Already used' }, { status: 409 })

  // A one-time token generated and redeemed here on the server, so the
  // session never travels as a URL.
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: syntheticEmail(req.guardian_phone),
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
