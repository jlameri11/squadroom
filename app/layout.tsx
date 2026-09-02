import type { Metadata, Viewport } from 'next'
import { IBM_Plex_Sans, Barlow_Condensed } from 'next/font/google'
import './globals.css'
import { HashSession } from '@/components/hash-session'

const plex = IBM_Plex_Sans({
  variable: '--font-plex',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
})

// Headings, tabs and chips. A condensed face holds "U8s NRIFA SPL Team" in a
// phone-width column without having to shrink it.
const barlow = Barlow_Condensed({
  variable: '--font-barlow',
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  display: 'swap',
})

export const metadata: Metadata = {
  // This said "Create Next App" until now — which is what iOS wrote under the
  // icon when a parent added it to their home screen.
  title: 'Squadroom',
  description: 'Fixtures, chat and RSVPs for junior football clubs.',
  applicationName: 'Squadroom',
  appleWebApp: { capable: true, title: 'Squadroom', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
}

export const viewport: Viewport = {
  themeColor: '#202842',
  // The app is a phone app. Letting it be pinch-zoomed is fine; letting iOS
  // zoom it on every input focus is not, and that is handled by the 16px
  // rule in globals.css rather than by locking scale.
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en-AU" className={`${plex.variable} ${barlow.variable} h-full`}>
      <body className="min-h-full flex flex-col bg-paper text-ink">
        <HashSession />
        {children}
      </body>
    </html>
  )
}
