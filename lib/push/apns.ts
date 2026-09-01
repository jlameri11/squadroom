import http2 from 'node:http2'
import { createPrivateKey, sign as cryptoSign } from 'node:crypto'

/**
 * Apple Push Notification service, spoken directly.
 *
 * No Firebase. Android push has to go through FCM because Google owns the
 * transport, but iOS does not, and the whole reason this phase exists is that
 * web push on iPhone only works after a parent installs the PWA — which most
 * never do. Adding a Google project, a second SDK and a second set of
 * credentials to solve an Apple problem would be paying twice.
 *
 * Two things about APNs that are not obvious and will waste a day each:
 *
 *   * It is HTTP/2 only. fetch() will not do. node:http2 is built in.
 *   * The JWT must be ES256 with the signature in raw r||s form. Node's
 *     default for EC keys is DER, which Apple rejects with a 403 and the
 *     unhelpful message "InvalidProviderToken". `dsaEncoding: 'ieee-p1363'`
 *     is the fix.
 *
 * The provider token is valid for an hour and Apple rate-limits minting, so
 * it is cached rather than made per notification.
 */

export type ApnsConfig = {
  keyId: string
  teamId: string
  bundleId: string
  privateKey: string
  production: boolean
}

export function apnsConfigFromEnv(): ApnsConfig | null {
  const keyId = process.env.APNS_KEY_ID
  const teamId = process.env.APNS_TEAM_ID
  const bundleId = process.env.APNS_BUNDLE_ID
  // Netlify env vars cannot hold real newlines, so the .p8 is stored with
  // literal \n and put back together here.
  const privateKey = process.env.APNS_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!keyId || !teamId || !bundleId || !privateKey) return null
  return {
    keyId,
    teamId,
    bundleId,
    privateKey,
    // Sandbox and production are different hosts AND different device
    // tokens. A TestFlight build is production; only a debug build from
    // Xcode is sandbox.
    production: process.env.APNS_ENVIRONMENT !== 'sandbox',
  }
}

const b64url = (input: Buffer | string) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

let cached: { token: string; mintedAt: number } | null = null

function providerToken(config: ApnsConfig): string {
  // Apple rejects tokens older than an hour and rate-limits new ones, so
  // this is refreshed well inside the window rather than per send.
  if (cached && Date.now() - cached.mintedAt < 45 * 60 * 1000) return cached.token

  const header = b64url(JSON.stringify({ alg: 'ES256', kid: config.keyId }))
  const claims = b64url(
    JSON.stringify({ iss: config.teamId, iat: Math.floor(Date.now() / 1000) })
  )
  const signature = b64url(
    cryptoSign(
      'sha256',
      Buffer.from(`${header}.${claims}`),
      { key: createPrivateKey(config.privateKey), dsaEncoding: 'ieee-p1363' }
    )
  )

  cached = { token: `${header}.${claims}.${signature}`, mintedAt: Date.now() }
  return cached.token
}

export type ApnsResult = { ok: boolean; gone: boolean; reason?: string }

export async function sendApns(
  config: ApnsConfig,
  deviceToken: string,
  payload: { title: string; body: string | null; url: string | null; tag: string | null },
  urgent: boolean
): Promise<ApnsResult> {
  const host = config.production ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com'
  const client = http2.connect(host)

  try {
    return await new Promise<ApnsResult>((resolve) => {
      const body = JSON.stringify({
        aps: {
          alert: { title: payload.title, body: payload.body ?? '' },
          sound: 'default',
          // Collapsing by conversation, same as the web tag: one line per
          // channel that updates, not a stack of twelve.
          'thread-id': payload.tag ?? undefined,
          // A cancelled match may interrupt a focus mode. A chat message
          // may not, and treating everything as urgent is how an app gets
          // muted permanently.
          'interruption-level': urgent ? 'time-sensitive' : 'active',
        },
        url: payload.url,
      })

      const request = client.request({
        ':method': 'POST',
        ':path': `/3/device/${deviceToken}`,
        authorization: `bearer ${providerToken(config)}`,
        'apns-topic': config.bundleId,
        'apns-push-type': 'alert',
        'apns-priority': urgent ? '10' : '5',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      })

      let status = 0
      let responseBody = ''
      request.on('response', (headers) => {
        status = Number(headers[':status'] ?? 0)
      })
      request.setEncoding('utf8')
      request.on('data', (chunk) => {
        responseBody += chunk
      })
      request.on('error', (err) => resolve({ ok: false, gone: false, reason: err.message }))
      request.on('end', () => {
        if (status === 200) return resolve({ ok: true, gone: false })
        // 410 is Apple saying the app was deleted; 400 BadDeviceToken means
        // it was never valid. Both are permanent, and retrying either is how
        // a queue silts up.
        const reason = safeReason(responseBody)
        const gone = status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered'
        resolve({ ok: false, gone, reason: `${status} ${reason}` })
      })

      request.end(body)
    })
  } finally {
    client.close()
  }
}

function safeReason(body: string): string {
  try {
    return (JSON.parse(body) as { reason?: string }).reason ?? body.slice(0, 120)
  } catch {
    return body.slice(0, 120)
  }
}
