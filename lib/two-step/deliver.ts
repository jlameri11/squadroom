import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { isPlaceholderEmail } from '@/lib/email'
import { escapeHtml, fromAs, sendEach } from '@/lib/mail/resend'

/**
 * Getting a six-digit code to the person who runs a club (0232; Joey,
 * 9 Nov 2026: "no authenticator apps — too hard for volunteers").
 *
 * Order: a text to the mobile on their account (Twilio Verify — Twilio
 * makes the code, holds it ten minutes, and checks it; we never see it),
 * else an email (a code we make here, kept as a salted SHA-256), else, for
 * a demo or placeholder account that can receive neither, the code itself
 * goes back to the screen. Server only: the Twilio secret and the codes
 * table never reach a bundle.
 *
 * Twilio Verify is the "existing" one: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
 * and TWILIO_VERIFY_SERVICE_SID in the environment. A text costs money, so
 * a demo number is never sent to Twilio, and the route holds the rate.
 */
export type Destination = {
  phone: string | null
  email: string | null
  demo: boolean
  maskedPhone: string | null
  maskedEmail: string | null
}

/** A demo sign-in (docs/DEMO.md) or a placeholder made from a phone number: neither receives anything. */
export function isDemoAccount(email: string | null | undefined): boolean {
  if (!email) return false
  const e = email.toLowerCase()
  return isPlaceholderEmail(e) || e.endsWith('@squadroom-demo.test')
}

/** +61400000301 from p61400000301@squadroom.invalid (lib/join.ts). */
function phoneFromPlaceholder(email: string | null | undefined): string | null {
  const m = email?.toLowerCase().match(/^p(\d{8,15})@squadroom\.invalid$/)
  return m ? `+${m[1]}` : null
}

/** E.164 or nothing. An Australian mobile typed as 04… becomes +614…; anything else unclear is refused rather than guessed (CLAUDE.md, normalisePhone). */
export function e164(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = String(raw).replace(/[\s()-]/g, '')
  if (/^\+\d{8,15}$/.test(s)) return s
  if (/^04\d{8}$/.test(s)) return `+61${s.slice(1)}`
  if (/^614\d{8}$/.test(s)) return `+${s}`
  return null
}

export function maskPhone(phone: string): string {
  return `•••• ${phone.slice(-3)}`
}

export function maskEmail(email: string): string {
  const [user, domain] = email.split('@')
  return `${(user ?? '').slice(0, 1)}•••@${domain ?? ''}`
}

/**
 * Where the code goes: the mobile first (profile, then the auth record,
 * then a placeholder sign-in's number), the email they read as the
 * fallback. A demo account is marked so the route shows the code instead.
 */
export function chooseDestination(x: {
  signInEmail: string | null
  authPhone: string | null
  profilePhone: string | null
  accountEmail: string | null
}): Destination | null {
  const phone = e164(x.profilePhone) ?? e164(x.authPhone) ?? phoneFromPlaceholder(x.signInEmail)
  const emailCandidate = x.accountEmail && !isDemoAccount(x.accountEmail) ? x.accountEmail : x.signInEmail && !isDemoAccount(x.signInEmail) ? x.signInEmail : null
  const demo = isDemoAccount(x.signInEmail) || isDemoAccount(x.accountEmail) || (!emailCandidate && !!x.signInEmail && isPlaceholderEmail(x.signInEmail))
  if (!phone && !emailCandidate && !demo) return null
  return {
    phone,
    email: emailCandidate,
    demo,
    maskedPhone: phone ? maskPhone(phone) : null,
    maskedEmail: emailCandidate ? maskEmail(emailCandidate) : null,
  }
}

// ------------------------------------------------------------------ texts

export function smsConfigured(): boolean {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_VERIFY_SERVICE_SID)
}

function twilio(): { auth: string; base: string } | null {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const service = process.env.TWILIO_VERIFY_SERVICE_SID
  if (!sid || !token || !service) return null
  return { auth: Buffer.from(`${sid}:${token}`).toString('base64'), base: `https://verify.twilio.com/v2/Services/${service}` }
}

/** Ask Twilio Verify to text a code. True when Twilio accepted it. */
export async function startSmsVerification(phone: string): Promise<boolean> {
  const t = twilio()
  if (!t) return false
  try {
    const res = await fetch(`${t.base}/Verifications`, {
      method: 'POST',
      headers: { authorization: `Basic ${t.auth}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: phone, Channel: 'sms' }),
    })
    if (!res.ok) {
      console.error('twilio verify refused', res.status, (await res.text()).slice(0, 200))
      return false
    }
    return true
  } catch (err) {
    console.error('twilio verify failed', err instanceof Error ? err.message : err)
    return false
  }
}

/** Twilio's answer to the digits typed. Only "approved" is yes. */
export async function checkSmsVerification(phone: string, code: string): Promise<boolean> {
  const t = twilio()
  if (!t) return false
  try {
    const res = await fetch(`${t.base}/VerificationCheck`, {
      method: 'POST',
      headers: { authorization: `Basic ${t.auth}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: phone, Code: code }),
    })
    if (!res.ok) return false
    const json = (await res.json().catch(() => null)) as { status?: string } | null
    return json?.status === 'approved'
  } catch {
    return false
  }
}

// ------------------------------------------------------------- our codes

export function makeCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

export function hashCode(code: string, salt: string = randomBytes(16).toString('hex')): { hash: string; salt: string } {
  return { hash: createHash('sha256').update(`${salt}:${code}`).digest('hex'), salt }
}

export function codeMatches(code: string, hash: string | null, salt: string | null): boolean {
  if (!hash || !salt) return false
  const a = Buffer.from(hashCode(code, salt).hash, 'hex')
  const b = Buffer.from(hash, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

/** The email fallback. True when Resend took it (needs RESEND_API_KEY). */
export async function sendCodeEmail(email: string, code: string): Promise<boolean> {
  const text = `${code} is your Squadroom sign-in code. It works for ten minutes. If you did not just sign in, ignore this email.`
  const [id] = await sendEach([
    {
      from: fromAs('Squadroom'),
      to: email,
      subject: `${code} is your Squadroom code`,
      text,
      html: `<p style="font-size:28px;letter-spacing:0.3em;font-family:monospace"><b>${escapeHtml(code)}</b></p><p>${escapeHtml(text)}</p>`,
    },
  ])
  return id !== null
}
