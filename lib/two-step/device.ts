/**
 * This device, for "Trust this device for 30 days" (0232).
 *
 * A random token made once per browser and kept in localStorage. The
 * database stores only its hash; a new session on this device hands the
 * token over and, if the account trusted it within 30 days, gets its pass
 * without a code. Clearing site data makes a new device, which is right:
 * that is a browser the account has not been seen on.
 *
 * Browser only.
 */
const KEY = 'squadroom.device'

export function deviceToken(): string | null {
  try {
    const have = localStorage.getItem(KEY)
    if (have && have.length >= 32) return have
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    const token = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    localStorage.setItem(KEY, token)
    return token
  } catch {
    // Private windows and blocked storage: no device to trust, the code is
    // asked for each time, and nothing breaks.
    return null
  }
}

/** "iPhone · Safari", for the trusted-devices list in Settings. */
export function deviceLabel(): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  const device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Device'
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) && !/Chromium/.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'browser'
  return `${device} · ${browser}`
}
