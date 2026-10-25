import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * The device secret.
 *
 * When someone asks to join, the server hands their browser a secret and
 * keeps only its hash. After the coach approves, that browser presents the
 * secret and gets a session. This is what binds the account to the device
 * that made the request: a coach approving "Sam Whitfield" does not sign in
 * whoever else happens to hold the link.
 */
export function generateSecret(): string {
  return randomBytes(32).toString('base64url')
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

/** Constant-time, so a wrong secret cannot be found byte by byte. */
export function secretMatches(secret: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashSecret(secret), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}

/**
 * Australian numbers as people type them. Returns null rather than guessing:
 * a half-parsed number is how a stranger ends up in a team channel.
 */
export function toE164(raw: string, defaultCountry = '61'): string | null {
  const cleaned = raw.replace(/[^\d+]/g, '')
  if (cleaned === '') return null
  if (cleaned.startsWith('+')) return /^\+[1-9]\d{7,14}$/.test(cleaned) ? cleaned : null
  if (cleaned.startsWith('0')) return `+${defaultCountry}${cleaned.slice(1)}`
  if (cleaned.startsWith(defaultCountry)) return `+${cleaned}`
  return null
}

/**
 * Supabase Auth is email-shaped, and our parents have phone numbers. Each
 * user gets a synthetic address derived from their number.
 *
 * .invalid is reserved by RFC 2606 so it can never resolve — nothing can be
 * delivered here, which is the point. The user never sees it and never types
 * it. If they later add a real email, it replaces this one.
 */
export function syntheticEmail(phoneE164: string): string {
  return `p${phoneE164.replace(/\D/g, '')}@squadroom.invalid`
}

/**
 * A join link can be named two ways, and this is the only place that knows it.
 *
 * `token` is 24 hex characters — right for a QR code and for a link pasted
 * into WhatsApp. `code` is six dictatable characters (0089) — right for being
 * read out at the end of training, written on a whiteboard, or printed on a
 * flyer at the school gate. They point at the same row and carry the same
 * expiry, use limit, revocation and coach approval.
 *
 * Both the join page and the request route resolve the same way, through this,
 * so they cannot drift into disagreeing about what a code means — which is the
 * sort of difference that lets a revoked link still work down one path.
 *
 * Codes are stored upper case and compared upper case, so a parent typing
 * lower case is not told their coach gave them a bad code.
 */
export function joinLinkFilter(raw: string): { column: 'token' | 'code'; value: string } {
  const trimmed = raw.trim()
  // Six of the code alphabet, in any case, with optional spaces or dashes
  // from however it was written down.
  const asCode = trimmed.toUpperCase().replace(/[\s-]/g, '')
  if (/^[ABCDEFGHJKMNPQRSTVWXYZ23456789]{6}$/.test(asCode)) {
    return { column: 'code', value: asCode }
  }
  return { column: 'token', value: trimmed }
}
