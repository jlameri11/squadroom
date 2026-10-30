import type { Metadata, Viewport } from 'next'
import { IBM_Plex_Sans, Barlow_Condensed } from 'next/font/google'
import './globals.css'
import { HashSession } from '@/components/hash-session'
import { TabBar } from '@/components/app-shell'
import { OfflineBanner } from '@/components/offline-banner'

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
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#202842' },
    { media: '(prefers-color-scheme: dark)', color: '#080D16' },
  ],
  // The app is a phone app. Letting it be pinch-zoomed is fine; letting iOS
  // zoom it on every input focus is not, and that is handled by the 16px
  // rule in globals.css rather than by locking scale.
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  // suppressHydrationWarning: the script in <head> sets data-theme before
  // React hydrates, so the attribute differs from the server's on purpose.
  // It covers this one element only, not its children.
  return (
    <html lang="en-AU" className={`${plex.variable} ${barlow.variable} h-full`} suppressHydrationWarning>
      {/*
        Applied before the first paint. Reading the choice in an effect would
        show a light screen for a frame and then swap, which on a phone at
        6am is worse than either theme.
      */}
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:"try{var t=localStorage.getItem('squadroom.theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t}catch(e){}",
          }}
        />
      </head>
      <body className="min-h-full flex flex-col bg-paper text-ink">
        <HashSession />
        {/*
          Rendered once, above every page, so it survives navigation.
          It used to be rendered BY each screen, which meant it unmounted and
          rebuilt on every tap — and refetched its counts each time. A bar
          that flickers on every tap is most of what "slow between pages"
          feels like, whatever the actual numbers say.
        */}
        <div className="flex min-h-dvh flex-col">
          <div className="flex-1">{children}</div>
          {/* Above the tab bar, so it is the last thing in view on a
              phone and does not push a screen's content around. Renders
              nothing unless there is something waiting. */}
          <OfflineBanner />
          <TabBar />
        </div>
      </body>
    </html>
  )
}
