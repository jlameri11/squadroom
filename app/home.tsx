'use client'

import Link from 'next/link'
import { AppBar, TabBar, Screen } from '@/components/app-shell'

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
  match: 'var(--brand)',
  tournament: 'var(--maybe)',
  training: 'var(--ink-2)',
  social: 'var(--yes)',
  other: 'var(--ink-2)',
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
  otherAcademies: { id: string; name: string; type: string }[]
  role: string
  isPlatformAdmin: boolean
  needsPhone: boolean
  pendingRequests: number
  events: HomeEvent[]
  channels: HomeChannel[]
}) {
  const unread = channels.reduce((sum, c) => sum + (c.muted ? 0 : c.unread_count), 0)
  const isStaff = role === 'owner' || role === 'admin'
  const isCoach = isStaff || role === 'coach'
  const tint = academy.primary_colour || 'var(--brand)'

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
      <AppBar
        title={academy.name}
        meta={`${role[0].toUpperCase()}${role.slice(1)} · ${todayLabel()}`}
        crest={academy.name.slice(0, 2).toUpperCase()}
      />

      <Screen>
      {needsPhone && (
        <Link
          href="/settings"
          className="card mx-4 mb-4 mt-4 block p-3.5 text-sm"
          style={{ borderColor: 'var(--gold)', background: '#FDF7E9' }}
        >
          <b style={{ color: '#7A5B12' }}>Add your mobile number</b>
          <span className="mt-0.5 block" style={{ color: '#8A6A22' }}>
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
          className="mx-4 mb-4 flex items-center gap-3 rounded-[14px] p-3.5 text-sm text-white"
          style={{ background: 'var(--accent)', boxShadow: 'var(--shadow)' }}
        >
          <span className="display grid h-8 w-8 flex-none place-items-center rounded-full bg-[var(--surface)]/25 text-base">
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
                    className={`row items-start ${cancelled ? 'opacity-55' : ''}`}
                  >
                    {/* The date chip from the prototype: day and time stacked
                        in a fixed column, so a list of six games scans down
                        the left edge instead of wrapping. */}
                    <span
                      className="w-[52px] flex-none rounded-[10px] py-1.5 text-center"
                      style={{ background: 'var(--surface-3)' }}
                    >
                      <span
                        className="display block text-[13px] uppercase leading-none"
                        style={{ color: TYPE_TINT[e.type] ?? 'var(--ink-2)' }}
                      >
                        {when.toLocaleDateString('en-AU', { weekday: 'short' })}
                      </span>
                      <span className="mt-0.5 block text-[13px] tabular-nums leading-none text-ink-2">
                        {when.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}
                      </span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-medium">{e.title}</span>
                        {cancelled && (
                          <span className="tag flex-none" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>
                            Off
                          </span>
                        )}
                        {e.source === 'screenshot' && !e.confirmed_at && (
                          <span className="tag flex-none" style={{ background: 'var(--maybe-bg)', color: 'var(--maybe)' }}>
                            Check
                          </span>
                        )}
                      </span>
                      <span className="block truncate text-sm text-ink-3">
                        {[e.team_name, e.venue].filter(Boolean).join(' · ') || 'No ground yet'}
                      </span>
                    </span>
                    {owed && (
                      <span className="pill flex-none self-center">
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
                  className="row"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-medium">{c.name}</span>
                      {c.muted && <span className="tag flex-none">muted</span>}
                    </span>
                    <span className="block truncate text-sm text-ink-3">
                      {c.last_message_body
                        ? `${c.last_sender_name ? `${c.last_sender_name.split(' ')[0]}: ` : ''}${c.last_message_body}`
                        : 'No messages yet'}
                    </span>
                  </span>
                  {c.unread_count > 0 && (
                    <span className="pill flex-none">{c.unread_count}</span>
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
      </Screen>

      <TabBar isStaff={isCoach} unread={unread} />
    </div>
  )
}

function todayLabel() {
  return new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })
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
    <section className="mb-6">
      <div className="flex items-baseline justify-between px-4 pb-2">
        <h2 className="eyebrow">{title}</h2>
        <Link href={href} className="text-xs text-ink-3 underline underline-offset-2">
          {more}
        </Link>
      </div>
      <div className="card mx-4 overflow-hidden">{children}</div>
    </section>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="eyebrow px-4 pb-2">{title}</h2>
      <ul className="card mx-4 overflow-hidden">{children}</ul>
    </section>
  )
}

function Item({ href, label, hint }: { href: string; label: string; hint?: string }) {
  return (
    <li>
      <Link href={href} className="row justify-between">
        <span className="min-w-0">
          <span className="block truncate font-medium">{label}</span>
          {hint && <span className="block truncate text-sm text-ink-3">{hint}</span>}
        </span>
        <span className="flex-none text-lg text-ink-3">›</span>
      </Link>
    </li>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="p-5 text-center text-sm text-ink-3">{children}</p>
  )
}
