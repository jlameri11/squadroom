import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'
import { codeMatches, hashCode, makeCode } from '@/lib/two-step/deliver'
import { mailConfigured } from '@/lib/mail/resend'
import { sendAccountCodeEmail, type CodePurpose } from '@/lib/mail/account-code'

/**
 * The six-digit email codes of the sign-up brief (12 Nov 2026; 0272):
 * confirming a new account, signing in without a password, resetting one.
 *
 * Ten minutes, five tries, a resend after thirty seconds, five an hour an
 * address (the database holds the rate, `email_code_allowed`). Kept as a
 * salted hash; a demo address's code (docs/DEMO.md) is kept in clear and
 * handed back so the screen can show it — never for a real address. Server
 * only: the codes table has no policy at all.
 */
export type Purpose = CodePurpose
export const CODE_LIFE_MS = 10 * 60_000
export const RESEND_AFTER_S = 30
export const MAX_ATTEMPTS = 5

type Admin = SupabaseClient<Database>

/** A demo sign-in: its code is shown on the screen, never sent anywhere. */
export function isDemoEmail(email: string): boolean {
  return email.toLowerCase().endsWith('@squadroom-demo.test')
}

/** Hashed, never stored raw: a spam control, not a record of who looked. */
export function clientIpHash(request: Request): string {
  const fwd =
    request.headers.get('x-nf-client-connection-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  return createHash('sha256').update(fwd).digest('hex')
}

export type Issued =
  | { ok: true; channel: 'email' | 'demo'; wait: number; demo_code?: string }
  | { ok: false; status: number; error: string; wait?: number }

export async function issueCode(
  admin: Admin,
  x: { email: string; purpose: Purpose; ipHash: string | null; userId?: string | null; payload?: Record<string, unknown> }
): Promise<Issued> {
  const demo = isDemoEmail(x.email)
  if (!demo && !mailConfigured()) {
    return { ok: false, status: 503, error: 'Squadroom can’t send email on this deployment yet, so a code can’t reach you. Ask whoever runs it.' }
  }
  const { data: allowed } = await admin.rpc('email_code_allowed', { p_email: x.email, p_purpose: x.purpose, p_ip_hash: x.ipHash ?? '' })
  const a = allowed as { ok?: boolean; reason?: string; wait?: number } | null
  if (a && a.ok === false) {
    if (a.reason === 'wait') {
      return { ok: false, status: 429, error: `A code was just sent. You can ask for another in ${a.wait ?? RESEND_AFTER_S} seconds.`, wait: a.wait }
    }
    return { ok: false, status: 429, error: 'Too many codes for now. Try again in an hour.', wait: a.wait }
  }
  const code = makeCode()
  const { hash, salt } = hashCode(code)
  const { error } = await admin.from('email_codes').insert({
    email: x.email,
    purpose: x.purpose,
    channel: demo ? 'demo' : 'email',
    code_hash: hash,
    salt,
    demo_code: demo ? code : null,
    user_id: x.userId ?? null,
    payload: (x.payload ?? {}) as never,
    ip_hash: x.ipHash,
    expires_at: new Date(Date.now() + CODE_LIFE_MS).toISOString(),
  })
  if (error) return { ok: false, status: 500, error: 'Could not make a code.' }
  if (!demo) {
    const sent = await sendAccountCodeEmail(x.email, code, x.purpose)
    if (!sent) return { ok: false, status: 502, error: 'The email could not be sent. Try again in a moment.' }
  }
  return { ok: true, channel: demo ? 'demo' : 'email', wait: RESEND_AFTER_S, demo_code: demo ? code : undefined }
}

export type CodeRow = Database['public']['Tables']['email_codes']['Row']

export type Verified =
  | { ok: true; row: CodeRow }
  | { ok: false; status: number; error: string; reason: 'none' | 'expired' | 'locked' | 'wrong' | 'used'; attempts_left?: number }

/** The latest unused code for this address and purpose, checked and consumed. */
export async function verifyCode(admin: Admin, x: { email: string; purpose: Purpose; code: string }): Promise<Verified> {
  const { data: row } = await admin
    .from('email_codes')
    .select('*')
    .eq('email', x.email)
    .eq('purpose', x.purpose)
    .is('consumed_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!row) return { ok: false, status: 400, reason: 'none', error: 'Ask for a code first.' }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, status: 410, reason: 'expired', error: 'That code has expired. Send a new one.' }
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    return { ok: false, status: 429, reason: 'locked', error: 'Too many tries. Send a new code.' }
  }
  const typed = x.code.replace(/\s+/g, '')
  if (!/^\d{6}$/.test(typed) || !codeMatches(typed, row.code_hash, row.salt)) {
    await admin.from('email_codes').update({ attempts: row.attempts + 1 }).eq('id', row.id)
    const left = MAX_ATTEMPTS - row.attempts - 1
    return {
      ok: false,
      status: 400,
      reason: 'wrong',
      error: left > 0 ? `That code isn’t right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'That code isn’t right. Send a new one.',
      attempts_left: left,
    }
  }
  // Used once. The conditional update is the lock against two tabs.
  const { data: locked } = await admin
    .from('email_codes')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', row.id)
    .is('consumed_at', null)
    .select('id')
    .maybeSingle()
  if (!locked) return { ok: false, status: 409, reason: 'used', error: 'That code was already used.' }
  return { ok: true, row }
}
