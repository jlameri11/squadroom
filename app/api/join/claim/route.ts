import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { secretMatches, syntheticEmail } from '@/lib/join'
import { mintSession, signInEmailOf } from '@/lib/account/session'

/**
 * "Has my coach approved me yet?"
 *
 * Since the sign-up brief (12 Nov 2026) a request is made signed in, so the
 * session is the proof: the person asks about their own request and is told
 * pending, approved or declined. Approved means they are already in — the
 * membership rows are theirs — and nothing is minted.
 *
 * The older shape stays for requests made before the brief: the browser
 * that made the request comes back with the secret it was issued and
 * collects its session. That is one of the two places a session is created
 * without anyone typing anything, so the four conditions all still hold —
 * the request exists, a coach approved it, it was never claimed, and the
 * caller holds the secret — and the address minted for is the account's own
 * sign-in address, read from the account (0214's hazard), never guessed.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const { requestId, secret } = (body ?? {}) as { requestId?: string; secret?: string }
  if (!requestId) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: req } = await admin
    .from('join_requests')
    .select('id, status, secret_hash, claimed_at, profile_id, phone')
    .eq('id', requestId)
    .maybeSingle()
  if (!req) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (!secret) {
    const supabase = await createClient()
    const { data: claims } = await supabase.auth.getClaims()
    const sub = claims?.claims?.sub as string | undefined
    if (!sub || req.profile_id !== sub) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (req.status === 'pending') return NextResponse.json({ status: 'pending' }, { status: 202 })
    if (req.status !== 'approved') return NextResponse.json({ status: req.status }, { status: 403 })
    return NextResponse.json({ status: 'approved' })
  }

  if (!secretMatches(secret, req.secret_hash)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (req.status === 'pending') {
    return NextResponse.json({ status: 'pending' }, { status: 202 })
  }
  if (req.status !== 'approved' || !req.profile_id) {
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

  const authEmail = (await signInEmailOf(admin, req.profile_id)) ?? (req.phone ? syntheticEmail(req.phone) : null)
  if (!authEmail || !(await mintSession(admin, authEmail))) {
    return NextResponse.json({ error: 'Could not sign you in.' }, { status: 500 })
  }

  // verifyOtp on the ssr client wrote the session cookies for us.
  return NextResponse.json({ status: 'approved' })
}
