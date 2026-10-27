'use client'

import { Fragment, useEffect, useState } from 'react'
import { useScreen } from '@/lib/hooks/use-screen'
import { useOrg, useReconcileOrg, getOrg } from '@/lib/org'
import { ScreenSkeleton } from '@/components/screen-skeleton'
import Link from 'next/link'
import { AppBar, Screen } from '@/components/app-shell'
import { SignOut } from '@/components/sign-out'
import { NeedsYou } from './needs-you'
import { HomeCalendar } from './home-calendar'
import { HomeCompetitions } from './home-competitions'
import { HomeOwing } from './home-owing'
import { EditHome } from './edit-home'
import { type SectionId } from '@/lib/home-sections'
import { createClient } from '@/lib/supabase/client'
import { WhyOut } from '@/components/why-out'

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
  profile: { phone: string | null; full_name: string | null } | null
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
      me={data.profile?.full_name ?? null}
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
  me,
  events,
  channels,
}: {
  academy: Academy
  otherAcademies: { id: string; name: string; type: string }[]
  role: string
  isPlatformAdmin: boolean
  needsPhone: boolean
  /** Whose account this is, for the footer. */
  me: string | null
  events: HomeEvent[]
  channels: HomeChannel[]
}) {
  const unread = channels.reduce((sum, c) => sum + (c.muted ? 0 : c.unread_count), 0)
  const isStaff = role === 'owner' || role === 'admin'
  const isCoach = isStaff || role === 'coach'
  const tint = academy.primary_colour || 'var(--brand)'


  // The layout, resolved by the database so the client never holds a second
  // opinion about what a new person sees. Falls back to the two sections the
  // screen has always had, so a failed fetch is a plain home screen rather
  // than an empty one.
  const [layoutState, setLayoutState] = useState<{
    sections: SectionId[]
    available: SectionId[]
    customised: boolean
  }>({ sections: ['needs', 'upcoming', 'chats'], available: [], customised: false })
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    let live = true
    ;(async () => {
      const { data } = await createClient().rpc('home_layout', {
        p_academy: getOrg() ?? undefined,
      })
      if (!live || !data) return
      const l = data as unknown as {
        sections: SectionId[]
        available: SectionId[]
        customised: boolean
      }
      setLayoutState(l)
    })()
    return () => {
      live = false
    }
  }, [editing])

  const layout = layoutState.sections

  // Each section, keyed by the id the database stores. Every one renders
  // nothing when it has nothing, so a section somebody has turned on but has
  // no data for costs them no space.
  const panels: Record<SectionId, React.ReactNode> = {
    needs: <NeedsYou />,
    upcoming: (
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
    ),
    calendar: <HomeCalendar />,
    chats: (
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
    ),
    competitions: <HomeCompetitions />,
    owing: <HomeOwing />,
  }

  return (
    <div
      className="mx-auto flex w-full max-w-md flex-1 flex-col"
      style={{ '--brand': tint } as React.CSSProperties}
    >
      <AppBar
        title={academy.name}
        meta={`${role[0].toUpperCase()}${role.slice(1)} · ${todayLabel()}`}
        crest={academy.name.slice(0, 2).toUpperCase()}
        action={
          layoutState.available.length > 0 && (
            <button
              onClick={() => setEditing(true)}
              className="grid h-9 w-9 flex-none place-items-center rounded-[10px] text-base"
              style={{ background: '#ffffff26', color: 'var(--brand-ink)' }}
              aria-label="Choose what you see on this screen"
            >
              ☰
            </button>
          )
        }
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
        Everything waiting on this person, in one strip. It replaced a
        bespoke card that only ever counted join requests — two things
        telling a coach the same number is one too many, and the strip
        covers registrations, registers, fees and consents as well.
      */}

      {/*
        The home screen is now ARRANGED BY THE PERSON LOOKING AT IT.

        It was two things on principle, and that principle was right while
        the product had two things worth showing. It now has competitions
        with live ladders, a month of fixtures, what the club is owed and the
        Needs You strip — and a coach and a parent want different ones of
        those at the top. The defaults still come from the database by role
        (0106), so somebody who never opens the editor never notices it
        exists.

        Rendered in the saved order rather than a fixed one. Each section is
        responsible for showing nothing when it has nothing, so an empty one
        costs a person no space.
      */}
      {layout.map((id) => (
        <Fragment key={id}>{panels[id]}</Fragment>
      ))}

      {editing && (
        <EditHome
          sections={layout}
          available={layoutState.available}
          customised={layoutState.customised}
          onClose={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      )}


      {/*
        Nothing else belongs here.

        The prototype's home screen is exactly two things — what is coming up,
        and the rooms you are in. Everything I had added underneath (tiles,
        an admin list, "elsewhere") was the screen listing the tab bar back at
        the person looking at it. Running the club now lives on the Admin tab,
        where a coach goes when that is what they came to do.

        The exception below is a FOOTER, not a tile. It says who you are
        signed in as and lets you leave — and until now there was no way out
        of an account anywhere in the product, which meant a coach could not
        hand their phone to a colleague and nobody could hold two accounts on
        one device.
      */}
      <footer className="mt-8 border-t px-4 pb-2 pt-4" style={{ borderColor: 'var(--line-2)' }}>
        <p className="px-1 text-xs text-ink-3">
          Signed in as <b>{me ?? 'you'}</b>
          {role ? ` · ${role}` : ''} at {academy.name}
        </p>
        <div className="mt-1.5">
          <SignOut />
        </div>
      </footer>
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
  const [asking, setAsking] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const when = new Date(event.starts_at)
  const cancelled = Boolean(event.cancelled_at)

  async function answer(playerId: string, status: string, note?: string) {
    // 0111 requires a reason on 'no', so ask before saving rather than let the
    // database refuse it. This is the only button on the home screen that
    // cannot be a single tap, and it earns that by being the one answer a
    // coach has to act on.
    if (status === 'no' && !note?.trim()) {
      setAsking(playerId)
      return
    }
    setAsking(null)

    // Optimistic. A parent standing in a car park should see the button move
    // the instant they press it, not after a round trip across the Pacific.
    const before = answers
    setAnswers((prev) =>
      prev.map((a) => (a.player_id === playerId ? { ...a, status } : a))
    )
    const supabase = createClient()
    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) return
    const { error } = await supabase.from('event_rsvps').upsert(
      {
        academy_id: academyId,
        event_id: event.id,
        profile_id: auth.user.id,
        player_id: playerId,
        status: status as 'yes' | 'no' | 'maybe',
        note: note?.trim() || null,
      },
      { onConflict: 'event_id,profile_id,player_id' }
    )
    // Optimism has to be undone when it turns out to be wrong. A chip reading
    // "Out" for an answer that never saved sends a coach into Saturday
    // believing something untrue.
    if (error) {
      setAnswers(before)
      setError(error.message)
    }
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
            <div key={a.player_id}>
              <div className="kidrow">
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

              {asking === a.player_id && (
                <div className="mt-2">
                  <WhyOut
                    childName={a.player_name.split(' ')[0]}
                    onSave={(note) => answer(a.player_id, 'no', note)}
                    onCancel={() => setAsking(null)}
                  />
                </div>
              )}
            </div>
          ))}

          {error && (
            <p className="text-xs" style={{ color: 'var(--no)' }}>
              {error}
            </p>
          )}
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
