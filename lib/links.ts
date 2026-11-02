/**
 * Links in messages.
 *
 * The first http(s) URL in a body, if any — what the bubble shows a preview
 * for. One per message: a second preview is noise, and the first is the one
 * the sender meant.
 */
export function firstUrl(body: string | null | undefined): string | null {
  if (!body) return null
  const m = body.match(/https?:\/\/[^\s<>"')\]]+/i)
  if (!m) return null
  // Trailing punctuation belongs to the sentence, not the link.
  return m[0].replace(/[.,;:!?]+$/, '')
}

/**
 * Whether the server may fetch this URL for a preview.
 *
 * Only http(s); only a public-looking host. A message can contain any text
 * at all, and the preview fetcher runs on our server, so "localhost", a
 * private range or a metadata address must never be followed — that is how
 * a chat message becomes a request from inside our network.
 */
export function previewable(raw: string): { ok: true; url: URL } | { ok: false; why: string } {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, why: 'not a URL' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, why: 'not http' }
  if (url.username || url.password) return { ok: false, why: 'credentials in the URL' }
  const host = url.hostname.toLowerCase()
  if (!host.includes('.')) return { ok: false, why: 'not a public host' }
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/.test(host)) return { ok: false, why: 'not a public host' }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const [a, b] = host.split('.').map(Number)
    if (a === 10 || a === 127 || a === 0 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254) || a >= 224) {
      return { ok: false, why: 'not a public host' }
    }
  }
  if (host.includes(':') || host.startsWith('[')) return { ok: false, why: 'not a public host' }
  return { ok: true, url }
}
