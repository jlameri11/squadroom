import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  /**
   * `npm run serve:test` sets DIST_DIR=.next-test so a test build can be made
   * and served WHILE a dev server is running.
   *
   * They would otherwise share `.next`. The whole point of serve:test is to
   * have somewhere to run the HTTP suites when `next dev` has wedged — and
   * building into the wedged server's own directory, mid-request, is how you
   * turn a stalled test run into a broken checkout as well. Keeping them
   * apart means the fallback never has to ask whether dev is healthy first.
   */
  distDir: process.env.DIST_DIR || '.next',

  /**
   * Netlify runs this app in Ohio and the database is in Sydney, so a screen
   * costs about 370ms no matter how few queries it makes — 250ms of that is
   * the Pacific. The only way below it is to stop making the trip at the
   * moment somebody taps.
   *
   * staleTimes keeps the client router cache, so going back to a screen you
   * were just on is instant instead of another round trip. 60 seconds is
   * chosen against how the app is actually used: a coach bouncing between
   * chat and fixtures wants speed, and a minute-old unread count is not
   * wrong enough to pay 250ms for. Anything that must be current — sending a
   * message, answering an RSVP — writes through its own client and updates
   * in place, so it is never reading this cache.
   */
  experimental: {
    staleTimes: {
      dynamic: 60,
      static: 300,
    },
  },

  /**
   * Set here rather than in netlify.toml: Netlify's [[headers]] apply to
   * static assets, not to server-rendered responses, so the pages that
   * actually matter were going out bare.
   *
   * The referrer policy is the one that counts. A join token sits in the URL
   * path, and a full referrer would hand it to any third-party host the page
   * happens to reference.
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'geolocation=(), microphone=(), camera=(self)' },
        ],
      },
    ]
  },
}

export default nextConfig
