import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'

/**
 * Draining the notification queue, extracted so two callers can share it:
 * a schedule that runs every five minutes as a safety net, and a wake-up the
 * database fires the moment something is actually enqueued.
 *
 * The schedule used to run every minute, which is 43,200 invocations a month
 * spent almost entirely on discovering there was nothing to do. It was the
 * largest single consumer of the Netlify allowance while the product had no
 * users at all.
 *
 * Never called from the browser: it needs the service-role key, so it stays
 * on the server permanently — before and after the native build exists.
 */

export type DrainResult = { claimed: number; sent: number; retired: number }

type Due = {
  id: string
  title: string
  body: string | null
  url: string | null
  endpoint: string
  p256dh: string | null
  auth: string | null
  sub_id: string
}

export async function drainNotificationQueue(): Promise<DrainResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT ?? 'mailto:hello@squadroom.app'

  if (!url || !serviceKey || !publicKey || !privateKey) {
    throw new Error('Missing configuration')
  }

  webpush.setVapidDetails(subject, publicKey, privateKey)
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } })

  // Claiming increments attempts in the same statement, so a crash mid-send
  // cannot leave a row to be retried forever.
  const { data: due, error } = await supabase.rpc('claim_notifications', { p_limit: 200 })
  if (error) throw new Error(`claim failed: ${error.message}`)
  if (!due || due.length === 0) return { claimed: 0, sent: 0, retired: 0 }

  const rows = due as Due[]
  const sent: string[] = []
  const deadSubscriptions: string[] = []

  await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: row.endpoint,
            keys: { p256dh: row.p256dh ?? '', auth: row.auth ?? '' },
          },
          JSON.stringify({
            title: row.title,
            body: row.body,
            url: row.url,
            // One notification per conversation, replaced as it goes, rather
            // than a stack of twelve.
            tag: row.url,
          })
        )
        sent.push(row.id)
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode
        // 404 and 410 mean the browser threw the subscription away — the app
        // was uninstalled, or site data cleared. Retrying that forever is how
        // a queue silts up, so the subscription is retired instead.
        if (status === 404 || status === 410) deadSubscriptions.push(row.sub_id)
      }
    })
  )

  if (sent.length > 0) {
    await supabase
      .from('notification_queue')
      .update({ sent_at: new Date().toISOString() })
      .in('id', sent)
  }

  if (deadSubscriptions.length > 0) {
    await supabase
      .from('push_subscriptions')
      .update({ failed_at: new Date().toISOString() })
      .in('id', deadSubscriptions)
  }

  return { claimed: rows.length, sent: sent.length, retired: deadSubscriptions.length }
}
