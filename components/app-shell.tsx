'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { OrgSwitcher } from '@/components/org-switcher'
import { getOrg } from '@/lib/org'

/**
 * The navy bar at the top and the tab bar at the bottom.
 *
 * These are the two things that make the prototype read as an app rather than
 * a web page, and the real product had neither — every screen was a white
 * page with a heading, so there was no way to get anywhere without going back
 * to the home screen first.
 *
 * Both live here rather than being repeated per screen, which is also what
 * keeps the Capacitor build cheap: one file to swap, not twenty-seven.
 */

export type Tab = 'home' | 'chat' | 'calendar' | 'team' | 'admin'

export function AppBar({
  title,
  meta,
  crest,
  crestColour = 'var(--brand)',
  back,
  action,
}: {
  title: string
  meta?: string
  crest?: string
  crestColour?: string
  back?: string
  action?: React.ReactNode
}) {
  // The crest doubles as the organisation switcher for anyone who belongs to
  // more than one. Deciding that here rather than per screen is what makes it
  // appear on all of them without a prop being threaded through twenty-seven
  // pages — and the count comes from the same nav_badges call the tab bar
  // already makes, so it costs no extra request.
  const badges = useNavBadges()
  const [switching, setSwitching] = useState(false)
  const canSwitch = (badges?.org_count ?? 1) > 1

  return (
    <header
      className="sticky top-0 z-20 flex items-center gap-3 px-4 pb-3.5 pt-3"
      style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
    >
      {back ? (
        <Link
          href={back}
          aria-label="Back"
          className="-ml-1 grid h-9 w-9 flex-none place-items-center rounded-[10px] text-xl"
          style={{ background: '#ffffff26' }}
        >
          ‹
        </Link>
      ) : (
        crest &&
        (canSwitch ? (
          <button
            onClick={() => setSwitching(true)}
            aria-label="Switch organisation"
            className="relative -ml-0.5 grid h-9 w-9 flex-none place-items-center rounded-[10px]"
            style={{ background: crestColour === 'var(--brand)' ? '#ffffff26' : crestColour }}
          >
            <span className="display text-[15px]">{crest}</span>
            {/* A chevron on the crest, because a crest that does nothing on
                every other account looks identical to one that does. */}
            <span
              className="absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-full text-[9px] leading-none"
              style={{ background: 'var(--gold)', color: '#202842' }}
              aria-hidden
            >
              ▾
            </span>
          </button>
        ) : (
          <span
            className="display grid h-9 w-9 flex-none place-items-center rounded-[10px] text-[15px]"
            style={{ background: crestColour === 'var(--brand)' ? '#ffffff26' : crestColour }}
          >
            {crest}
          </span>
        ))
      )}

      {switching && <OrgSwitcher onClose={() => setSwitching(false)} />}

      <span className="min-w-0 flex-1">
        <span className="display block truncate text-[21px] leading-tight">{title}</span>
        {meta && <span className="block truncate text-xs opacity-75">{meta}</span>}
      </span>

      {action}
    </header>
  )
}

type TabDef = {
  tab: Tab
  href: string
  label: string
  icon: React.ReactNode
  staffOnly?: boolean
  badge?: 'unread' | 'pending'
}

/**
 * Five destinations, and no more.
 *
 * A tab bar is a promise that these are the places worth going. Every one
 * added past five makes the other four harder to hit and the labels harder to
 * read, and there is no sixth thing in this product that a coach reaches for
 * often enough to earn a permanent seat.
 *
 * "Team" rather than "Directory" because that is what it is to a parent
 * looking for another parent's number. The label people use beats the label
 * the route uses.
 */
const TABS: TabDef[] = [
  {
    tab: 'home',
    href: '/',
    label: 'Home',
    icon: (
      <>
        <path d="M3 10.5 12 3l9 7.5" />
        <path d="M5 9.5V20h14V9.5" />
      </>
    ),
  },
  {
    tab: 'chat',
    href: '/chat',
    label: 'Chat',
    badge: 'unread',
    icon: <path d="M21 11.5a8.4 8.4 0 0 1-12.6 7.3L3 20.5l1.8-5.2A8.4 8.4 0 1 1 21 11.5z" />,
  },
  {
    tab: 'calendar',
    href: '/calendar',
    label: 'Fixtures',
    icon: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M8 3v4M16 3v4M3 10h18" />
      </>
    ),
  },
  {
    tab: 'team',
    href: '/directory',
    label: 'Team',
    icon: (
      <>
        <circle cx="9" cy="8" r="3.2" />
        <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
        <path d="M16 5.5a3 3 0 0 1 0 5.6M17.5 20a6.4 6.4 0 0 0-2-4.6" />
      </>
    ),
  },
  {
    tab: 'admin',
    href: '/admin',
    label: 'Admin',
    staffOnly: true,
    badge: 'pending',
    icon: (
      <>
        <path d="M12 3.5 20 7v5.5c0 4.4-3.2 7.4-8 8.5-4.8-1.1-8-4.1-8-8.5V7z" />
        <path d="m9.5 12.2 1.8 1.8 3.4-3.6" />
      </>
    ),
  },
]

type Badges = {
  unread: number
  pending: number
  is_staff: boolean
  // Both arrive with 0080. Until it is applied they are undefined, and the
  // switcher stays hidden rather than offering a choice the server would
  // ignore — a switcher that silently keeps showing the same organisation is
  // worse than no switcher.
  org_count?: number
  academy_id?: string
}

/**
 * The bar asks for its own counts rather than being told.
 *
 * It used to take them as props, and only the home screen ever passed any —
 * so the unread dot appeared there and nowhere else, which reads as "nothing
 * unread" rather than "not counted on this screen". Fetching once per
 * navigation from the browser costs almost nothing: the query is two integers
 * and, for anyone in Australia, Supabase is a few milliseconds away.
 */
/**
 * Screens that have no tab bar.
 *
 * A full-screen conversation and the join flow are not places you tab away
 * from — the conversation has its own back arrow, and the join flow is for
 * somebody who is not signed in yet and has nowhere to go.
 */
const BARE = [
  '/signin', '/signup', '/start', '/auth',
  '/join', '/join-competition',
  // Opened by people with no account at all — a child with their family's
  // link, or anyone with a public competition link. Offering them Home and
  // Chat would be offering a sign-in screen to someone who must not have one.
  '/my', '/c',
]

// Counts live outside the component, so moving between tabs does not throw
// them away and ask for them again.
let lastBadges: Badges | null = null
let inFlight: Promise<Badges | null> | null = null
const badgeListeners = new Set<(b: Badges | null) => void>()

/**
 * The counts, fetched once however many components ask.
 *
 * The app bar and the tab bar both want them — the bar for the organisation
 * switcher, the tab bar for the unread dot — and they are rendered separately,
 * the tab bar at the root layout and the app bar inside each page. Sharing one
 * in-flight promise means two subscribers still make one request.
 */
function useNavBadges(): Badges | null {
  const pathname = usePathname()
  const [badges, setBadges] = useState<Badges | null>(lastBadges)

  useEffect(() => {
    // Nobody is signed in on the sign-in, join or public pages, so asking
    // would spend a request to be told null.
    if (BARE.some((p) => pathname === p || pathname.startsWith(p + '/'))) return

    const fn = (b: Badges | null) => setBadges(b)
    badgeListeners.add(fn)

    if (!inFlight) {
      // The generated types are produced from the deployed schema, which does
      // not yet have 0080's p_academy. Cast at the call rather than hand-
      // editing lib/database.types.ts, which is regenerated.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rpc = createClient().rpc as any
      inFlight = (async () => {
        // The organisation the browser remembers. Pre-0080 the function takes
        // no argument and PostgREST rejects the call, so fall back to asking
        // without it — the app then behaves exactly as it did before.
        const { data, error } = await rpc('nav_badges', { p_academy: getOrg() })
        if (error?.code === 'PGRST202') {
          const retry = await rpc('nav_badges')
          return (retry.data ?? null) as Badges | null
        }
        return (data ?? null) as Badges | null
      })().then((b) => {
        lastBadges = b ?? lastBadges
        inFlight = null
        for (const l of badgeListeners) l(lastBadges)
        return lastBadges
      })
    }
    void inFlight

    return () => {
      badgeListeners.delete(fn)
    }
    // Refreshed on every navigation, but the previous answer stays on display
    // while it does — so nothing empties and rebuilds.
  }, [pathname])

  return badges
}

export function TabBar({ isStaff, unread }: { isStaff?: boolean; unread?: number }) {
  const pathname = usePathname()

  const hidden =
    BARE.some((p) => pathname === p || pathname.startsWith(p + '/')) ||
    // A channel is full screen. /chat itself keeps its bar.
    /^\/chat\/[^/]+$/.test(pathname)

  const badges = useNavBadges()

  if (hidden) return null

  // The prop is the first paint; the fetch corrects it. Neither waits for the
  // other, so the bar never renders empty.
  const showAdmin = badges?.is_staff ?? isStaff ?? false
  const counts = {
    unread: badges?.unread ?? unread ?? 0,
    pending: badges?.pending ?? 0,
  }

  const current = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href))

  return (
    <nav
      className="sticky bottom-0 z-20 flex border-t px-1 pb-[max(8px,env(safe-area-inset-bottom))] pt-1"
      style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
    >
      {TABS.filter((t) => !t.staffOnly || showAdmin).map((t) => {
        const on = current(t.href)
        const count = t.badge ? counts[t.badge] : 0

        return (
          <Link
            key={t.tab}
            href={t.href}
            prefetch
            aria-current={on ? 'page' : undefined}
            className="relative flex flex-1 flex-col items-center gap-[3px] rounded-[10px] px-0.5 pb-1 pt-1.5 text-[10.5px] font-semibold"
            style={{ color: on ? 'var(--brand)' : 'var(--ink-3)' }}
          >
            <span className="relative">
              <svg
                viewBox="0 0 24 24"
                className="h-[22px] w-[22px]"
                style={{
                  stroke: 'currentColor',
                  fill: 'none',
                  // The current tab is drawn heavier as well as darker.
                  // Colour alone is a weak signal on a small screen in
                  // sunlight, which is where this app gets used.
                  strokeWidth: on ? 2.3 : 1.8,
                }}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {t.icon}
              </svg>

              {count > 0 && (
                <span
                  className="absolute -right-2.5 -top-1.5 grid h-[17px] min-w-[17px] place-items-center rounded-full px-1 text-[10px] font-bold text-white"
                  style={{ background: 'var(--accent)' }}
                >
                  {count > 99 ? '99+' : count}
                </span>
              )}
            </span>

            <span>{t.label}</span>

            {/* A short bar under the label. On a phone held at arm's length
                the weight change alone is easy to miss. */}
            <span
              aria-hidden
              className="h-[2px] w-5 rounded-full transition-opacity"
              style={{ background: 'var(--brand)', opacity: on ? 1 : 0 }}
            />
          </Link>
        )
      })}
    </nav>
  )
}

/** The scrolling area between the two bars. */
export function Screen({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 overflow-y-auto pb-6">{children}</div>
}
