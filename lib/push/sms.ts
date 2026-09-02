import { createClient } from '@supabase/supabase-js'

/**
 * The one case SMS is for.
 *
 * CLAUDE.md costed a general SMS fallback at roughly $4k/week at 300
 * academies and cut it. This is the exception it kept: a match cancelled or
 * moved inside 24 hours, where the alternative is a family driving to a
 * closed ground.
 *
 * The flag comes from a database trigger, never a client. A text costs money
 * and arrives whether or not anyone wanted it, so nothing reachable from a
 * browser is allowed to ask for one.
 *
 * Without Twilio credentials this does nothing and says so. Push has already
 * gone out by then — the SMS is the belt to its braces, not the delivery.
 */
export async function sendSmsEscalations(): Promise<{
  claimed: number
  sent: number
  skipped: number
}> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) throw new Error('Missing Supabase configuration')

  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_FROM_NUMBER

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } })

  const { data: due, error } = await supabase.rpc('claim_sms_escalations', { p_limit: 50 })
  if (error) throw new Error(`claim failed: ${error.message}`)
  if (!due || due.length === 0) return { claimed: 0, sent: 0, skipped: 0 }

  const rows = due as { id: string; phone: string; title: string; body: string | null }[]

  // Claimed but unsendable. Left unsent rather than marked sent, so turning
  // Twilio on later does not silently swallow the backlog — attempts caps it
  // at three, which is the right amount of a stale ground closure to send.
  if (!sid || !token || !from) {
    return { claimed: rows.length, sent: 0, skipped: rows.length }
  }

  const sent: string[] = []
  const auth = Buffer.from(`${sid}:${token}`).toString('base64')

  await Promise.all(
    rows.map(async (row) => {
      // Deliberately short. A text is read on a lock screen at 7am by
      // somebody already putting boots in the car.
      const text = [row.title, row.body].filter(Boolean).join(' — ').slice(0, 300)
      try {
        const response = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
          {
            method: 'POST',
            headers: {
              authorization: `Basic ${auth}`,
              'content-type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({ To: row.phone, From: from, Body: text }),
          }
        )
        if (response.ok) sent.push(row.id)
        else console.error('twilio refused', response.status, (await response.text()).slice(0, 200))
      } catch (err) {
        console.error('sms failed', err instanceof Error ? err.message : err)
      }
    })
  )

  if (sent.length > 0) {
    await supabase
      .from('notification_queue')
      .update({ sms_sent_at: new Date().toISOString() })
      .in('id', sent)
  }

  return { claimed: rows.length, sent: sent.length, skipped: rows.length - sent.length }
}
