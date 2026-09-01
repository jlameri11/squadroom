import type { Config } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'

/**
 * Drains the notification queue and sends web push. Scheduled, not triggered:
 * posting a message must not wait on a push provider, and a provider being
 * slow must not make chat feel broken.
 *
 * Lives here rather than in the Next app because it needs the service-role
 * key, which can never ship inside a Capacitor bundle. This is the sanctioned
 * server, and it will still be the server after the native build exists.
 */
export default async function handler() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT ?? 'mailto:hello@squadroom.app'

  if (!url || !serviceKey || !publicKey || !privateKey) {
    return new Response('Missing configuration', { status: 500 })
  }

  webpush.setVapidDetails(subject, publicKey, privateKey)
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } })

  // Claiming increments attempts in the same statement, so a crash mid-send
  // cannot leave a row to be retried forever.
  const { data: due, error } = await supabase.rpc('claim_notifications', { p_limit: 200 })
  if (error) return new Response(`claim failed: ${error.message}`, { status: 500 })
  if (!due || due.length === 0) return new Response('nothing due', { status: 200 })

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

  return new Response(
    JSON.stringify({ claimed: rows.length, sent: sent.length, retired: deadSubscriptions.length }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}

export const config: Config = {
  schedule: '* * * * *',
}
