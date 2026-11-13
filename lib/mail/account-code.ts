import { escapeHtml, fromAs, sendEach } from '@/lib/mail/resend'

export type CodePurpose = 'confirm' | 'sign_in' | 'reset'

/**
 * The six-digit code for an account: confirming a new one, signing in
 * without a password, resetting one (the sign-up brief, 12 Nov 2026).
 * Through Resend when there is a key; nothing, and false, without one
 * (NEEDS JOEY #19). An email, not a page: px is the size mail clients read.
 */
export async function sendAccountCodeEmail(email: string, code: string, purpose: CodePurpose): Promise<boolean> {
  const what =
    purpose === 'confirm' ? 'confirms your new Squadroom account'
    : purpose === 'reset' ? 'resets your Squadroom password'
    : 'signs you in to Squadroom'
  const text = `${code} ${what}. It works for ten minutes. If this wasn’t you, ignore this email.`
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
