import Stripe from 'stripe'

/**
 * The Stripe client, and the one place that decides whether payments exist
 * at all on this deployment.
 *
 * Returning null rather than throwing is deliberate. An academy that has not
 * set payments up should see "payments aren't set up yet", not a 500 — and a
 * deployment without keys should still run everything else.
 */
export function stripeOrNull(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null
  return new Stripe(key, {
    // Pinned. An API version that moves under a payment system is how a
    // silent behaviour change becomes a reconciliation problem months later.
    apiVersion: '2026-08-26.dahlia',
    typescript: true,
    appInfo: { name: 'Squadroom', url: 'https://squadroom-dev.netlify.app' },
  })
}

/**
 * Where Stripe sends people back to. Netlify serves the same app from a
 * deploy-unique hostname as well as the canonical one, and a return URL built
 * from the request origin can therefore land on a host with no session
 * cookie — which reads as being signed out immediately after paying.
 */
export function siteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.URL ??
    'https://squadroom-dev.netlify.app'
  ).replace(/\/$/, '')
}
