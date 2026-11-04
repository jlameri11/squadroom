import type { MetadataRoute } from 'next'

/**
 * What Android (and Chrome on a desktop) installs: the name under the icon,
 * the icon itself and the colour of the splash screen. iOS reads the
 * apple-icon and the appleWebApp metadata in the root layout instead.
 *
 * The icons come from the brand kit (`scripts/brand-icons.mjs`): white SR on
 * the brand's near-black. The maskable one has the letters at 80% so a
 * launcher that cuts the icon into a circle never clips them.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Squadroom',
    short_name: 'Squadroom',
    description: 'Fixtures, chat and RSVPs for junior football clubs.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#101012',
    theme_color: '#101012',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
