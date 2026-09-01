import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'
import { apnsConfigFromEnv, sendApns } from './apns.js'
import { fcmConfigFromEnv, sendFcm } from './fcm.js'

/**
 * Draining the notification queue, extracted so two callers can share it:
 * a schedule that runs every five minutes as a safety net, and a wake-up the
 * database fires the moment something is actually enqueued.
 *
 * Three transports, one queue. A person may well have all three at once — the
 * PWA on a laptop, the app on their phone, a browser at work — and each gets
 * its own row in push_subscriptions, so the same notification fans out to
 * each without the enqueuing side knowing any of this exists.
 *
 * A transport with no credentials configured is SKIPPED, not failed. Half the
 * point of the platform column is that an academy piloting on iPhones should
 * not need a Firebase project, and an Android-only deployment should not need
 * an Apple account. Marking those rows as failures would retire perfectly
 * good subscriptions for the sin of being on the other platform.
 *
 * Never called from the browser: it needs the service-role key, so it stays
 * on the server permanently — before and after the native build exists.
 */

export type DrainResult = {
  claimed: number
  sent: number
  retired: number
  skipped: number
}

type Due = {
  id: string
  profile_id: string
  kind: string
  title: string
  body: string | null
  url: string | null
  platform: 'web' | 'ios' | 'android'
  endpoint: string
  p256dh: string | null
  auth: string | null
  sub_id: string
}

// What is allowed to interrupt a focus mode. Everything else is ordinary,
// because an app that treats every message as urgent gets muted permanently
// and then delivers nothing at all.
const URGENT = new Set(['event_reminder', 'announcement'])

export async function drainNotificationQueue(): Promise<DrainResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT ?? 'mailto:hello@squadroom.app'

  if (!url || !serviceKey) throw new Error('Missing Supabase configuration')

  const webPushReady = Boolean(publicKey && privateKey)
  if (webPushReady) webpush.setVapidDetails(subject, publicKey!, privateKey!)

  const apns = apnsConfigFromEnv()
  const fcm = fcmConfigFromEnv()

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } })

  // Claiming increments attempts in the same statement, so a crash mid-send
  // cannot leave a row to be retried forever.
  const { data: due, error } = await supabase.rpc('claim_notifications', { p_limit: 200 })
  if (error) throw new Error(`claim failed: ${error.message}`)
  if (!due || due.length === 0) return { claimed: 0, sent: 0, retired: 0, skipped: 0 }

  const rows = due as Due[]
  const sent: string[] = []
  const deadSubscriptions: string[] = []
  let skipped = 0

  await Promise.all(
    rows.map(async (row) => {
      const payload = {
        title: row.title,
        body: row.body,
        url: row.url,
        // One notification per conversation, replaced as it goes, rather
        // than a stack of twelve.
        tag: row.url,
      }
      const urgent = URGENT.has(row.kind)

      if (row.platform === 'ios') {
        if (!apns) return void skipped++
        const result = await sendApns(apns, row.endpoint, payload, urgent)
        if (result.ok) sent.push(row.id)
        else if (result.gone) deadSubscriptions.push(row.sub_id)
        return
      }

      if (row.platform === 'android') {
        if (!fcm) return void skipped++
        const result = await sendFcm(fcm, row.endpoint, payload, urgent)
        if (result.ok) sent.push(row.id)
        else if (result.gone) deadSubscriptions.push(row.sub_id)
        return
      }

      if (!webPushReady) return void skipped++
      try {
        await webpush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh ?? '', auth: row.auth ?? '' } },
          JSON.stringify(payload)
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

  return { claimed: rows.length, sent: sent.length, retired: deadSubscriptions.length, skipped }
}
