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
