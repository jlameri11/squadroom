import { createPrivateKey, sign as cryptoSign } from 'node:crypto'

/**
 * Firebase Cloud Messaging, for Android only.
 *
 * Google owns Android push, so there is no way around a Firebase project
 * here — unlike iOS, where talking to APNs directly avoids one entirely.
 * Kept separate from apns.ts for exactly that reason: a club piloting on
 * iPhones should never need a Google account.
 *
 * The OAuth token is minted from the service account and lasts an hour, so
 * it is cached the same way the APNs provider token is.
 */

export type FcmConfig = { projectId: string; clientEmail: string; privateKey: string }

export function fcmConfigFromEnv(): FcmConfig | null {
  const raw = process.env.FCM_SERVICE_ACCOUNT
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as {
      project_id?: string
      client_email?: string
      private_key?: string
    }
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) return null
    return {
      projectId: parsed.project_id,
      clientEmail: parsed.client_email,
      privateKey: parsed.private_key.replace(/\\n/g, '\n'),
    }
  } catch {
    return null
  }
}

const b64url = (input: Buffer | string) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

let cached: { token: string; expiresAt: number } | null = null

async function accessToken(config: FcmConfig): Promise<string> {
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached.token

  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(
    JSON.stringify({
      iss: config.clientEmail,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })
  )
  const signature = b64url(
    cryptoSign('sha256', Buffer.from(`${header}.${claims}`), createPrivateKey(config.privateKey))
  )

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${signature}`,
    }),
  })

  if (!response.ok) throw new Error(`FCM auth failed: ${response.status}`)
  const json = (await response.json()) as { access_token: string; expires_in: number }
  cached = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 }
  return json.access_token
}

export type FcmResult = { ok: boolean; gone: boolean; reason?: string }

export async function sendFcm(
  config: FcmConfig,
  deviceToken: string,
  payload: { title: string; body: string | null; url: string | null; tag: string | null },
  urgent: boolean
): Promise<FcmResult> {
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${config.projectId}/messages:send`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await accessToken(config)}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token: deviceToken,
          notification: { title: payload.title, body: payload.body ?? '' },
          data: payload.url ? { url: payload.url } : undefined,
          android: {
            priority: urgent ? 'HIGH' : 'NORMAL',
            // Same collapsing as the web tag and the APNs thread-id: one
            // line per conversation, replaced as it goes.
            notification: { tag: payload.tag ?? undefined },
          },
        },
      }),
    }
  )

  if (response.ok) return { ok: true, gone: false }

  const text = await response.text()
  // UNREGISTERED means the app was uninstalled; the token will never work
  // again, so it is retired rather than retried.
  const gone = response.status === 404 || text.includes('UNREGISTERED')
  return { ok: false, gone, reason: `${response.status} ${text.slice(0, 120)}` }
}
