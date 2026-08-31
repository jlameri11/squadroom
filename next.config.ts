import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
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
