import type { Config } from '@netlify/functions'
import { drainNotificationQueue } from '../../lib/push/drain.js'

/**
 * The safety net, not the delivery mechanism.
 *
 * push-now.mts is what actually makes a phone buzz: the database calls it the
 * instant a notification is enqueued. This exists for the times that call
 * never lands — pg_net down, a deploy mid-flight, a row whose scheduled_for
 * has only just come around — and to sweep up anything left behind.
 *
 * It ran every minute until the Netlify allowance was half gone with no users
 * on the product. Almost all of those invocations found an empty queue.
 */
export default async function handler() {
  try {
    const result = await drainNotificationQueue()
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'drain failed'
    return new Response(message, { status: 500 })
  }
}

export const config: Config = {
  schedule: '*/5 * * * *',
}
