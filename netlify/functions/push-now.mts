import { drainNotificationQueue } from '../../lib/push/drain.js'

/**
 * Woken by the database the moment a notification is enqueued, so a message
 * arrives in a second rather than whenever the next sweep happens.
 *
 * Not scheduled, and deliberately a separate function: Netlify does not let a
 * scheduled function be invoked over HTTP, so the schedule and the wake-up
 * cannot be the same file. They share lib/push/drain.ts, which is where the
 * actual sending lives.
 *
 * The shared secret is the whole of the authorisation. Without it this is an
 * open endpoint that anyone could hammer to burn the function allowance —
 * it sends nothing it should not, but it costs money to be hit.
 */
export default async function handler(request: Request) {
  const expected = process.env.PUSH_WAKE_SECRET
  if (!expected) return new Response('Not configured', { status: 503 })

  const offered = request.headers.get('x-squadroom-wake')
  if (offered !== expected) return new Response('No', { status: 401 })

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
