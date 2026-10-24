'use client'

import { useState } from 'react'
import { useScreen } from '@/lib/hooks/use-screen'
import { useOrg, useReconcileOrg } from '@/lib/org'
import { ScreenSkeleton } from '@/components/screen-skeleton'
import Link from 'next/link'
import { AppBar, Screen } from '@/components/app-shell'
import { createClient } from '@/lib/supabase/client'

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
  academy_id?: string
  round: string | null
  kit_colour: string | null
  going: number | null
  no_reply: number | null
  rsvps: { player_id: string; player_name: string; status: string | null }[]
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

type HomeData = {
  profile: { phone: string | null } | null
  academy: Academy | null
  role: string | null
  other_academies: { id: string; name: string; type: string }[]
  is_platform_admin: boolean
  pending_requests: number
  events: HomeEvent[]
  channels: HomeChannel[]
}

export function Home() {
  const org = useOrg()
  const { data, failed } = useScreen<HomeData>('home_screen', { p_academy: org })

  // The server says which organisation it actually served. If that is not the
  // one we asked for, the remembered choice belongs to somewhere this person
  // has left.
  useReconcileOrg(data?.academy?.id)

  if (failed) {
    return (
      <div className="mx-auto grid min-h-dvh w-full max-w-md place-items-center p-6">
        <p className="text-center text-sm text-ink-2">
          Couldn&apos;t load. Check your connection and pull down to refresh.
        </p>
      </div>
    )
  }

  if (!data) return <ScreenSkeleton />
  if (!data.academy) {
    if (typeof window !== 'undefined') window.location.replace('/start')
    return <ScreenSkeleton />
  }

  return (
    <HomeScreen
      academy={data.academy}
      otherAcademies={data.other_academies ?? []}
      role={data.role ?? 'parent'}
      isPlatformAdmin={data.is_platform_admin}
      needsPhone={!data.profile?.phone}
      pendingRequests={data.pending_requests ?? 0}
      events={data.events ?? []}
      channels={data.channels ?? []}
    />
  )
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
function HomeScreen({
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
    <div
      className="mx-auto flex w-full max-w-md flex-1 flex-col"
      style={{ '--brand': tint } as React.CSSProperties}
    >
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
          style={{ borderColor: 'var(--gold)', background: 'var(--maybe-bg)' }}
        >
          <b style={{ color: 'var(--maybe)' }}>Add your mobile number</b>
          <span className="mt-0.5 block" style={{ color: 'var(--maybe)' }}>
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

      <section className="px-3.5 pb-5 pt-4">
        <div className="sect">
          <span className="eyebrow">Upcoming · next 3 weeks</span>
          <Link href="/calendar" className="text-xs text-ink-3 underline underline-offset-2">
            All fixtures
          </Link>
        </div>

        {events.length === 0 ? (
          <p className="card p-6 text-center text-sm text-ink-3">
            Nothing in the next three weeks.
          </p>
        ) : (
          <div className="stack">
            {events.map((e) => (
              <EventCard key={e.id} event={e} isCoach={isCoach} academyId={academy.id} />
            ))}
          </div>
        )}
      </section>

      <section className="px-3.5 pb-5">
        <div className="sect">
          <span className="eyebrow">Channels</span>
          {unread > 0 ? (
            <span className="pill">{unread}</span>
          ) : (
            <Link href="/chat" className="text-xs text-ink-3 underline underline-offset-2">
              All chats
            </Link>
          )}
        </div>

        {channels.length === 0 ? (
          <p className="card p-6 text-center text-sm text-ink-3">You&apos;re not in any chats yet.</p>
        ) : (
          <div className="card overflow-hidden">
            {channels.slice(0, 5).map((c) => (
              <Link key={c.channel_id} href={`/chat/${c.channel_id}`} className="chan">
                <span className={`av ${c.unread_count > 0 ? '' : 'alt'}`}>
                  {initials(c.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold">{c.name}</span>
                    {c.muted && <span className="badge">muted</span>}
                  </span>
                  <span className="block truncate text-xs text-ink-2">
                    {c.last_message_body
                      ? `${c.last_sender_name ? `${c.last_sender_name.split(' ')[0]}: ` : ''}${c.last_message_body}`
                      : 'No messages yet'}
                  </span>
                </span>
                {c.unread_count > 0 && <span className="pill flex-none">{c.unread_count}</span>}
              </Link>
            ))}
          </div>
        )}
      </section>

      {/*
        Nothing else belongs here.

        The prototype's home screen is exactly two things — what is coming up,
        and the rooms you are in. Everything I had added underneath (tiles,
        an admin list, "elsewhere") was the screen listing the tab bar back at
        the person looking at it. Running the club now lives on the Admin tab,
        where a coach goes when that is what they came to do.
      */}
      </Screen>
    </div>
  )
}

function todayLabel() {
  return new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })
}

/**
 * One fixture, and — for a parent — the answer for each of their children
 * right on it.
 *
 * This is the difference between the app and a website. Answering "is Leo
 * playing Saturday" is the most common thing anyone does here, and it used to
 * cost a navigation: a tap, a 250ms trip to Sydney, a new page. Now it is a
 * tap that paints immediately and saves in the background.
 */
function EventCard({
  event,
  isCoach,
  academyId,
}: {
  event: HomeEvent
  isCoach: boolean
  academyId: string
}) {
  const [answers, setAnswers] = useState(event.rsvps ?? [])
  const when = new Date(event.starts_at)
  const cancelled = Boolean(event.cancelled_at)

  async function answer(playerId: string, status: string) {
    // Optimistic. A parent standing in a car park should see the button move
    // the instant they press it, not after a round trip across the Pacific.
    setAnswers((prev) =>
      prev.map((a) => (a.player_id === playerId ? { ...a, status } : a))
    )
    const supabase = createClient()
    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) return
    await supabase.from('event_rsvps').upsert(
      {
        academy_id: academyId,
        event_id: event.id,
        profile_id: auth.user.id,
        player_id: playerId,
        status: status as 'yes' | 'no' | 'maybe',
      },
      { onConflict: 'event_id,profile_id,player_id' }
    )
  }

  return (
    <article className={`card ev ${cancelled ? 'opacity-60' : ''}`}>
      <div className="ev-top">
        <Link href={`/calendar/${event.id}`} className="datechip">
          <div className="d">{when.getDate()}</div>
          <div className="m">{when.toLocaleDateString('en-AU', { weekday: 'short' })}</div>
        </Link>

        <div className="min-w-0 flex-1">
          <div className="mb-[3px] flex flex-wrap items-center gap-1.5">
            <span className={`typechip ${event.type === 'match' ? 'match' : ''}`}>
              {cancelled ? 'Called off' : event.type}
            </span>
            {event.team_name && <span className="badge">{event.team_name}</span>}
            {event.round && <span className="badge">{event.round}</span>}
            {event.source === 'screenshot' && !event.confirmed_at && (
              <span className="badge" style={{ background: 'var(--maybe-bg)', color: 'var(--maybe)' }}>
                Check
              </span>
            )}
          </div>

          <Link href={`/calendar/${event.id}`} className="block">
            <div className="ev-ttl">{event.title}</div>
            <div className="ev-sub tabular-nums">
              {when.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}
              {event.venue ? ` · ${event.venue}` : ''}
            </div>
          </Link>
        </div>
      </div>

      {/* A coach wants the tally and a way into the roster; a parent wants to
          answer. They are different jobs, and neither belongs on the other's
          screen. */}
      {isCoach && event.going !== null && !cancelled && (
        <Link href={`/calendar/${event.id}`} className="ev-sub flex justify-between">
          <span>
            <b style={{ color: 'var(--yes)' }}>{event.going} in</b>
            {event.no_reply ? ` · ${event.no_reply} no reply` : ''}
          </span>
          <span style={{ color: 'var(--brand)' }}>View roster</span>
        </Link>
      )}

      {!isCoach && !cancelled && answers.length > 0 && (
        <div className="stack">
          {answers.map((a) => (
            <div key={a.player_id} className="kidrow">
              <span className="who truncate">{a.player_name.split(' ')[0]}</span>
              <div className="rsvp">
                {(['yes', 'maybe', 'no'] as const).map((v) => (
                  <button
                    key={v}
                    data-v={v}
                    aria-pressed={a.status === v}
                    onClick={() => answer(a.player_id, v)}
                  >
                    {v === 'yes' ? 'Going' : v === 'maybe' ? 'Maybe' : 'Out'}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </article>
  )
}

function initials(name: string) {
  return (
    (name ?? '')
      .replace(/[^A-Za-z0-9 ]/g, '')
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase() || '··'
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
