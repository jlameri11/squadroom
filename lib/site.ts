/**
 * The canonical address of this app.
 *
 * Netlify serves every deploy from a unique hostname as well as the real one
 * — `6a97b409b494--squadroom-dev.netlify.app` alongside
 * `squadroom-dev.netlify.app`. Anything built from the incoming request's
 * origin therefore inherits whichever host that request happened to arrive
 * on, and the consequences are not cosmetic:
 *
 *   * A sign-in callback set the session cookie on the deploy hostname. You
 *     landed signed in on a URL you would never visit again, and the real
 *     site still bounced you to /signin — which reads exactly like the login
 *     being broken, and cost an afternoon.
 *
 *   * A join link is worse. A coach pastes it into the WhatsApp group parents
 *     already use, and it contains a deploy hash that stops resolving the
 *     next time anything ships. The families who tap it late get nothing.
 *
 * So every externally-visible URL comes from here. `URL` is Netlify's own
 * canonical site address; NEXT_PUBLIC_SITE_URL overrides it when there is a
 * custom domain.
 */
export function siteUrl(): string {
  const configured =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    process.env.URL

  if (configured) return configured.replace(/\/$/, '')

  // Local development. Never reached in a deploy, because Netlify always
  // sets URL.
  return 'http://localhost:3000'
}
