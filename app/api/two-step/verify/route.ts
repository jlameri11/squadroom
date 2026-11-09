import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkSmsVerification, codeMatches } from '@/lib/two-step/deliver'

export const runtime = 'nodejs'

const ATTEMPTS = 5

/**
 * Check the six digits and, if right, give this session its pass (0232).
 *
 * The check is Twilio's for a text (VerificationCheck) and ours for an
 * email or demo code (a salted hash). Five wrong answers burn the code.
 * The pass itself is minted by two_step_pass, a service-role-only function:
 * this route is the one place in the product that may call it, and only
 * after one of those two checks said yes. The session it names is the one
 * in the caller's own token (the session_id claim), never one the body
 * chooses.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { code?: string; trust?: boolean; device?: string | null; label?: string | null } | null
  const code = (body?.code ?? '').replace(/\D/g, '')
  if (code.length !== 6) return NextResponse.json({ ok: false, error: 'six digits' }, { status: 400 })

  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  const sub = claims?.claims?.sub
  const sessionId = (claims?.claims as { session_id?: string } | undefined)?.session_id
  if (!sub) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  if (!sessionId) return NextResponse.json({ error: 'This session cannot be passed; sign in again' }, { status: 400 })

  const admin = createAdminClient()
  const { data: row } = await admin.from('two_step_codes').select('*').eq('profile_id', sub).maybeSingle()
  if (!row) return NextResponse.json({ ok: false, error: 'no-code' }, { status: 400 })
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await admin.from('two_step_codes').delete().eq('profile_id', sub)
    return NextResponse.json({ ok: false, error: 'expired' }, { status: 410 })
  }
  if (row.attempts >= ATTEMPTS) {
    await admin.from('two_step_codes').delete().eq('profile_id', sub)
    return NextResponse.json({ ok: false, error: 'too-many-attempts' }, { status: 429 })
  }

  const right = row.channel === 'sms' ? await checkSmsVerification(row.destination, code) : codeMatches(code, row.code_hash, row.salt)
  if (!right) {
    const attempts = row.attempts + 1
    if (attempts >= ATTEMPTS) await admin.from('two_step_codes').delete().eq('profile_id', sub)
    else await admin.from('two_step_codes').update({ attempts }).eq('profile_id', sub)
    return NextResponse.json({ ok: false, error: 'wrong', attempts_left: Math.max(0, ATTEMPTS - attempts) }, { status: 400 })
  }

  await admin.from('two_step_codes').delete().eq('profile_id', sub)
  const { data: pass, error } = await admin.rpc('two_step_pass', {
    p_profile: sub,
    p_session: sessionId,
    p_trust: Boolean(body?.trust),
    p_device: body?.trust && body?.device ? body.device : undefined,
    p_label: body?.trust && body?.label ? body.label : undefined,
  })
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, ...(pass as Record<string, unknown>) })
}
