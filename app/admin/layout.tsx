import Link from 'next/link'

const TABS = [
  { href: '/chat', label: 'Chat' },
  { href: '/calendar', label: 'Fixtures' },
  { href: '/directory', label: 'Directory' },
  { href: '/admin/requests', label: 'Requests' },
  { href: '/admin/teams', label: 'Teams' },
  { href: '/admin/invites', label: 'Invites' },
  { href: '/admin/members', label: 'Members' },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <nav className="sticky top-0 z-10 border-b border-neutral-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-md gap-1 overflow-x-auto p-2">
          <Link href="/" className="rounded-lg px-3 py-2 text-sm text-neutral-500">
            ←
          </Link>
          {TABS.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className="whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
            >
              {t.label}
            </Link>
          ))}
        </div>
      </nav>
      {children}
    </div>
  )
}
