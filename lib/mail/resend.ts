/**
 * Email through Resend, when Squadroom has a key (RESEND_API_KEY).
 *
 * The one rule: WITHOUT A KEY, NOTHING HAPPENS AND NOTHING SAYS SO. A notice
 * still arrives in the app and by push; an email address is still saved,
 * just not confirmed yet. The key and a sending domain are on Joey's list for
 * December (NIGHT_LOG, NEEDS JOEY #19). No SDK: two REST calls.
 *
 * Server only — the key must never reach a bundle.
 */
export type Mail = {
  from: string
  to: string
  subject: string
  text: string
  html: string
  reply_to?: string
}

export function mailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY)
}

/**
 * The sending address from MAIL_FROM ("Squadroom <notices@…>" or a bare
 * address), shown as `display` — "Sydney Premier League via Squadroom".
 */
export function fromAs(display: string): string {
  const raw = process.env.MAIL_FROM ?? 'Squadroom <onboarding@resend.dev>'
  const address = raw.match(/<([^>]+)>/)?.[1] ?? raw.trim()
  // Quotes and angle brackets in a club's name would break the header.
  const name = display.replace(/["<>\r\n]/g, '').trim() || 'Squadroom'
  return `"${name}" <${address}>`
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Send each mail separately — one per person, never a list in To or Bcc —
 * in batches of a hundred (Resend's limit). Returns, in order, the provider's
 * id for each mail sent, or null where its batch failed.
 */
export async function sendEach(mails: Mail[]): Promise<(string | null)[]> {
  const key = process.env.RESEND_API_KEY
  if (!key || mails.length === 0) return mails.map(() => null)
  const out: (string | null)[] = []
  for (let i = 0; i < mails.length; i += 100) {
    const batch = mails.slice(i, i + 100)
    try {
      const res = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify(batch),
      })
      if (!res.ok) {
        out.push(...batch.map(() => null))
        continue
      }
      const json = (await res.json().catch(() => null)) as { data?: { id: string }[] } | null
      out.push(...batch.map((_, n) => json?.data?.[n]?.id ?? 'sent'))
    } catch {
      out.push(...batch.map(() => null))
    }
  }
  return out
}
