import type { Metadata, Viewport } from 'next'
import { IBM_Plex_Sans, Barlow_Condensed } from 'next/font/google'
import './globals.css'
import { HashSession } from '@/components/hash-session'
import { TabBar } from '@/components/app-shell'
import { OfflineBanner } from '@/components/offline-banner'
import { TwoStepGate } from '@/components/two-step-gate'
import { TEXT_SIZE_SCRIPT } from '@/lib/text-size'
import { THEME_SCRIPT } from '@/lib/brand/theme-script'
import { ThemeController } from '@/components/theme-controller'

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
  // Chrome on Android (146+): the root font size follows the phone's text
  // size setting, and every size here is in rem (X-10; lib/text-size.ts
  // does the same job on an iPhone). Ignored where it is not supported.
  other: { 'text-scale': 'scale' },
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#101012' },
    { media: '(prefers-color-scheme: dark)', color: '#101012' },
  ],
  // The app is a phone app. Letting it be pinch-zoomed is fine; letting iOS
  // zoom it on every input focus is not, and that is handled by the 16px
  // rule in globals.css rather than by locking scale.
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  // suppressHydrationWarning: the scripts in <head> set data-theme,
  // data-design and data-club (the person's appearance and their club's
  // colours) and, on an iPhone set to larger text, the root font size before
  // React hydrates, so the attributes differ from the server's on purpose. It covers this one
  // element only, not its children.
  return (
    <html lang="en-AU" className={`${plex.variable} ${barlow.variable} h-full`} suppressHydrationWarning>
      {/*
        Applied before the first paint. Reading the choice in an effect would
        show a light screen for a frame and then swap, which on a phone at
        6am is worse than either theme.
      */}
      <head>
        {/* Light or dark from the person's Appearance, and their club's
            colours on the app's own screens (lib/brand/theme-script.ts). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        {/* The iPhone's text size (Dynamic Type), before the first paint for
            the same reason. Does nothing anywhere else. */}
        <script dangerouslySetInnerHTML={{ __html: TEXT_SIZE_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col bg-paper text-ink">
        <HashSession />
        <ThemeController />
        {/* Above every page: somebody with two-step sign-in on sees nothing
            until the second step is done (S-07). Renders nothing otherwise. */}
        <TwoStepGate />
        {/*
          Rendered once, above every page, so it survives navigation.
          It used to be rendered BY each screen, which meant it unmounted and
          rebuilt on every tap — and refetched its counts each time. A bar
          that flickers on every tap is most of what "slow between pages"
          feels like, whatever the actual numbers say.
        */}
        <div className="flex min-h-dvh flex-col">
          <div className="flex-1">{children}</div>
          {/* Above the tab bar and stuck to the bottom with it, so it is in
              view however far down a long screen somebody is — the match
              sheet is where it matters most, and in the flow it was only
              seen by scrolling to the very end (5 Nov 2026). Renders
              nothing unless there is something waiting. */}
          <div className="sticky bottom-0 z-20">
            <OfflineBanner />
            <TabBar />
          </div>
        </div>
      </body>
    </html>
  )
}
