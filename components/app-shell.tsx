'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

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
        crest && (
          <span
            className="display grid h-9 w-9 flex-none place-items-center rounded-[10px] text-[15px]"
            style={{ background: crestColour === 'var(--brand)' ? '#ffffff26' : crestColour }}
          >
            {crest}
          </span>
        )
      )}

      <span className="min-w-0 flex-1">
        <span className="display block truncate text-[21px] leading-tight">{title}</span>
        {meta && <span className="block truncate text-xs opacity-75">{meta}</span>}
      </span>

      {action}
    </header>
  )
}

const TABS: { tab: Tab; href: string; label: string; icon: React.ReactNode; staffOnly?: boolean }[] = [
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
    href: '/admin/teams',
    label: 'Admin',
    staffOnly: true,
    icon: (
      <>
        <path d="M12 3.5 20 7v5.5c0 4.4-3.2 7.4-8 8.5-4.8-1.1-8-4.1-8-8.5V7z" />
        <path d="m9.5 12.2 1.8 1.8 3.4-3.6" />
      </>
    ),
  },
]

export function TabBar({ isStaff, unread = 0 }: { isStaff: boolean; unread?: number }) {
  const pathname = usePathname()

  const current = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href)

  return (
    <nav
      className="sticky bottom-0 z-20 flex border-t px-1 pb-[max(9px,env(safe-area-inset-bottom))] pt-1.5"
      style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
    >
      {TABS.filter((t) => !t.staffOnly || isStaff).map((t) => {
        const on = current(t.href)
        return (
          <Link
            key={t.tab}
            href={t.href}
            aria-current={on ? 'page' : undefined}
            className="relative grid flex-1 justify-items-center gap-[3px] rounded-[10px] px-0.5 py-1.5 text-[10.5px] font-semibold"
            style={{ color: on ? 'var(--brand)' : 'var(--ink-3)' }}
          >
            <svg
              viewBox="0 0 24 24"
              className="h-[21px] w-[21px]"
              style={{ stroke: 'currentColor', fill: 'none', strokeWidth: 1.9 }}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {t.icon}
            </svg>
            {/* A dot, not a number. On a tab bar the count is noise — what
                matters is that there is something to look at. */}
            {t.tab === 'chat' && unread > 0 && (
              <span
                className="absolute h-[7px] w-[7px] rounded-full"
                style={{ background: 'var(--accent)', transform: 'translate(11px,-3px)' }}
              />
            )}
            <span>{t.label}</span>
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
