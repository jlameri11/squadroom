'use client'

import Link from 'next/link'

export type HomeEvent = {
  id: string
  type: string
  title: string
  starts_at: string
  venue: string | null
  team_name: string | null
  cancelled_at: string | null
  my_replies: number
  my_children: number
  source: string
  confirmed_at: string | null
}

export type HomeChannel = {
  channel_id: string
  name: string
  type: string
  unread_count: number
  muted: boolean
  last_message_body: string | null
  last_sender_name: string | null
}

type Academy = {
  id: string
  name: string
  slug: string
  type: string
  primary_colour: string
  logo_url: string | null
}

const TYPE_TINT: Record<string, string> = {
  match: '#202842',
  tournament: '#9C6B06',
  training: '#6B7280',
  social: '#1C7A4C',
  other: '#6B7280',
}

/**
 * What is coming up, then the rooms you are in, then the things you can do.
 *
 * That order is the brief's, and it is right: a parent opening this at 7am on
 * a Saturday wants a kick-off time, not a menu. The screen used to be a list
 * of thirteen identical underlined links in the order I happened to build
 * them, which showed a parent "Collect payments" and "Platform" and let them
 * discover by tapping that neither was theirs.
 *
 * Everything below is gated on role now. A menu that offers what you cannot
 * do is not a menu, it is a maze.
 */
export function Home({
  academy,
  otherAcademies,
  role,
  isPlatformAdmin,
  needsPhone,
  pendingRequests,
  events,
  channels,
}: {
  academy: Academy
  otherAcademies: Academy[]
  role: string
  isPlatformAdmin: boolean
  needsPhone: boolean
  pendingRequests: number
  events: HomeEvent[]
  channels: HomeChannel[]
}) {
  const isStaff = role === 'owner' || role === 'admin'
  const isCoach = isStaff || role === 'coach'
  const tint = academy.primary_colour || '#202842'

  return (
    <main className="mx-auto max-w-md pb-10">
      <header className="flex items-center gap-3 p-5 pb-4">
        <span
          className="grid h-11 w-11 flex-none place-items-center overflow-hidden rounded-xl text-sm font-bold text-white"
          style={{ background: tint }}
        >
          {academy.logo_url ? (
            <img src={academy.logo_url} alt="" className="h-full w-full object-cover" />
          ) : (
            academy.name.slice(0, 2).toUpperCase()
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold" style={{ color: tint }}>
            {academy.name}
          </h1>
          <p className="text-sm capitalize text-neutral-500">{role}</p>
        </div>
      </header>

      {needsPhone && (
        <Link
          href="/settings"
          className="mx-5 mb-4 block rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm"
        >
          <b className="text-amber-800">Add your mobile number</b>
          <span className="mt-0.5 block text-amber-700">
            Your team can&apos;t call or text you without it.
          </span>
        </Link>
      )}

      {/*
        A coach with families waiting cannot see anything else until they have
        dealt with it — nobody joins the app until this is tapped, so a badge
        buried in a menu would strand people.
      */}
      {isCoach && pendingRequests > 0 && (
        <Link
          href="/admin/requests"
          className="mx-5 mb-4 flex items-center gap-3 rounded-xl p-3 text-sm text-white"
          style={{ background: '#DD5620' }}
        >
          <span className="grid h-7 w-7 flex-none place-items-center rounded-full bg-white/25 font-bold">
            {pendingRequests}
          </span>
          <span>
            <b>{pendingRequests === 1 ? 'A family is' : `${pendingRequests} families are`} waiting</b>
            <span className="block opacity-90">They can&apos;t see anything until you approve them.</span>
          </span>
        </Link>
      )}

      <Section title="Next up" href="/calendar" more="All fixtures">
        {events.length === 0 ? (
          <Empty>Nothing in the next three weeks.</Empty>
        ) : (
          <ul className="flex flex-col">
            {events.map((e) => {
              const cancelled = Boolean(e.cancelled_at)
              const owed = !cancelled && e.my_children > e.my_replies
              const when = new Date(e.starts_at)
              return (
                <li key={e.id}>
                  <Link
                    href={`/calendar/${e.id}`}
                    className={`flex items-start gap-3 border-b border-neutral-100 px-5 py-3 ${
                      cancelled ? 'opacity-55' : ''
                    }`}
                  >
                    <span className="w-14 flex-none">
                      <span
                        className="block text-xs font-semibold uppercase"
                        style={{ color: TYPE_TINT[e.type] ?? '#6B7280' }}
                      >
                        {when.toLocaleDateString('en-AU', { weekday: 'short' })}
                      </span>
                      <span className="block text-sm tabular-nums text-neutral-500">
                        {when.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}
                      </span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-medium">{e.title}</span>
                        {cancelled && (
                          <span className="flex-none text-xs font-semibold text-red-600">Off</span>
                        )}
                        {e.source === 'screenshot' && !e.confirmed_at && (
                          <span className="flex-none rounded bg-amber-100 px-1.5 py-px text-[10px] font-semibold text-amber-800">
                            Check
                          </span>
                        )}
                      </span>
                      <span className="block truncate text-sm text-neutral-500">
                        {[e.team_name, e.venue].filter(Boolean).join(' · ') || 'No ground yet'}
                      </span>
                    </span>
                    {owed && (
                      <span
                        className="flex-none self-center rounded-full px-2 py-0.5 text-[11px] font-bold text-white"
                        style={{ background: '#DD5620' }}
                      >
                        {e.my_children - e.my_replies} to answer
                      </span>
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      <Section title="Chats" href="/chat" more="All chats">
        {channels.length === 0 ? (
          <Empty>You&apos;re not in any chats yet.</Empty>
        ) : (
          <ul className="flex flex-col">
            {channels.slice(0, 5).map((c) => (
              <li key={c.channel_id}>
                <Link
                  href={`/chat/${c.channel_id}`}
                  className="flex items-center gap-3 border-b border-neutral-100 px-5 py-3"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-medium">{c.name}</span>
                      {c.muted && <span className="flex-none text-xs text-neutral-400">muted</span>}
                    </span>
                    <span className="block truncate text-sm text-neutral-500">
                      {c.last_message_body
                        ? `${c.last_sender_name ? `${c.last_sender_name.split(' ')[0]}: ` : ''}${c.last_message_body}`
                        : 'No messages yet'}
                    </span>
                  </span>
                  {c.unread_count > 0 && (
                    <span
                      className="flex-none rounded-full px-2 py-0.5 text-[11px] font-bold text-white"
                      style={{ background: tint }}
                    >
                      {c.unread_count}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Group title="Yours">
        <Item href="/calendar" label="Fixtures" hint="Every game and training session" />
        <Item href="/payments" label="Payments" hint="What you owe, and what you've paid" />
        <Item href="/scan" label="Add games from a screenshot" hint="Photograph your Dribl draw" />
        <Item href="/directory" label="Directory" hint="Who's who at the club" />
        <Item href="/settings" label="Your details" hint="Phone, notifications, calendar" />
      </Group>

      {isCoach && (
        <Group title="Running the team">
          <Item href="/admin/teams" label="Teams and players" />
          <Item href="/admin/requests" label="Join requests" hint="Approve new families" />
          <Item href="/admin/import" label="Import a draw" hint="From a Dribl export" />
          <Item href="/competitions" label="Competitions" hint="Tournaments and gala days" />
        </Group>
      )}

      {isStaff && (
        <Group title="Running the club">
          <Item href="/admin/payments" label="Collect payments" hint="Fees, tournament entries" />
          <Item href="/admin/members" label="Members and who invited them" />
          <Item href="/admin/invites" label="Invites" />
          <Item href="/settings/academy" label="Club settings" hint="Privacy and branding" />
        </Group>
      )}

      {(otherAcademies.length > 0 || isPlatformAdmin) && (
        <Group title="Elsewhere">
          {otherAcademies.map((a) => (
            <Item key={a.id} href="/" label={a.name} hint={a.type} />
          ))}
          <Item href="/start" label="Create another organisation" />
          {isPlatformAdmin && <Item href="/platform" label="Platform" hint="Every academy" />}
        </Group>
      )}
    </main>
  )
}

function Section({
  title,
  href,
  more,
  children,
}: {
  title: string
  href: string
  more: string
  children: React.ReactNode
}) {
  return (
    <section className="mb-5">
      <div className="flex items-baseline justify-between px-5 pb-1.5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{title}</h2>
        <Link href={href} className="text-xs text-neutral-500 underline underline-offset-2">
          {more}
        </Link>
      </div>
      {children}
    </section>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h2 className="px-5 pb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        {title}
      </h2>
      <ul className="flex flex-col">{children}</ul>
    </section>
  )
}

function Item({ href, label, hint }: { href: string; label: string; hint?: string }) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center justify-between gap-3 border-b border-neutral-100 px-5 py-3"
      >
        <span className="min-w-0">
          <span className="block truncate font-medium">{label}</span>
          {hint && <span className="block truncate text-sm text-neutral-500">{hint}</span>}
        </span>
        <span className="flex-none text-neutral-300">›</span>
      </Link>
    </li>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="mx-5 rounded-xl bg-neutral-100 p-4 text-center text-sm text-neutral-500">
      {children}
    </p>
  )
}
