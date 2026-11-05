/**
 * An email address someone reads (Joey, 5 Nov 2026: every account has one).
 *
 * Any address is fine — it never has to match PlayFootball's, which is the
 * login complaint people have about Dribl. Not one of the placeholder
 * addresses Squadroom makes for a phone sign-in (lib/join.ts): those receive
 * nothing. The database checks the same shape (0214).
 *
 * No imports, so the suites can run it directly.
 */
export const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export type EmailCheck = { ok: true; email: string } | { ok: false; error: string }

export function checkEmail(raw: unknown): EmailCheck {
  const email = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (!email) {
    return { ok: false, error: 'An email address, please — any one you read. It doesn’t have to match PlayFootball.' }
  }
  if (!EMAIL_SHAPE.test(email) || email.length > 254) {
    return { ok: false, error: 'That doesn’t look like an email address.' }
  }
  if (email.endsWith('@squadroom.invalid')) {
    return { ok: false, error: 'That address can’t receive email. Use one you read.' }
  }
  return { ok: true, email }
}

/** A sign-in address made from a phone number, which nobody reads. */
export function isPlaceholderEmail(email: string | null | undefined): boolean {
  return !email || email.toLowerCase().endsWith('@squadroom.invalid')
}
