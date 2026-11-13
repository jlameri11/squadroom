'use client'

import { Fragment, useEffect, useState } from 'react'
import { prefetchScreen, useScreen } from '@/lib/hooks/use-screen'
import { useOrg, useReconcileOrg, getOrg } from '@/lib/org'
import { ScreenSkeleton } from '@/components/screen-skeleton'
import Link from 'next/link'
import { AppBar, Screen } from '@/components/app-shell'
import { SignOut } from '@/components/sign-out'
import { NeedsYou } from './needs-you'
import { HomeJobs, rememberedHat, type JobsHandoff } from './home-jobs'
import { HomeCalendar } from './home-calendar'
import { HomeCompetitions } from './home-competitions'
import { HomeOwing } from './home-owing'
import { EditHome } from './edit-home'
import { type SectionId } from '@/lib/home-sections'
import { createClient } from '@/lib/supabase/client'
import { sendOrQueue, signedInHere } from '@/lib/offline/use-outbox'
import { WhyOut } from '@/components/why-out'
import { ChildChips, childColour, type Child } from './child-chips'
import { TrainingBlock, groupTraining } from './training-block'
import { DEFAULT_TZ } from '@/lib/time'

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
  children: Child[]
  events: HomeEvent[]
}

export function Home() {
  const org = useOrg()
  const { data, failed } = useScreen<HomeData>('home_screen', { p_academy: org })

  // The sections' requests start now, alongside the screen's, instead of
  // after it has rendered — through the screen cache, with the SAME
  // arguments each section asks with, so a section joins the request already
  // on its way rather than making its own (the "Feels instant" pass).
  useEffect(() => {
    const o = getOrg() ?? undefined
    prefetchScreen('home_layout', { p_academy: o })
    prefetchScreen('needs_you', { p_academy: o })
    prefetchScreen('home_jobs', { p_academy: o, p_persona: rememberedHat(getOrg()) })
    prefetchScreen('home_competitions', { p_academy: o })
  }, [])

  // Once Home has drawn: the four tabs and the next game are fetched into
  // the same cache, so tapping any of them paints at once (item 3 of the
  // brief). The arguments are exactly those screens' own.
  useEffect(() => {
    if (!data) return
    // After Home's own requests have settled, never racing them for the 4G.
    const t = setTimeout(() => {
      prefetchScreen('chat_screen', { p_academy: org })
      prefetchScreen('fixtures_screen', { p_days: 60, p_academy: org })
      const next = data.events.find((e) => (e.type === 'match' || e.type === 'tournament') && !e.cancelled_at)
      if (next) prefetchScreen('game_screen', { p_event: next.id })
      if (data.role === 'owner' || data.role === 'admin' || data.role === 'coach') prefetchScreen('admin_hub', { p_academy: data.academy?.id })
    }, 1500)
    return () => clearTimeout(t)
  }, [data, org])

  // The server says which organisation it actually served. If that is not the
  // one we asked for, the remembered choice belongs to somewhere this person
  // has left.
  useReconcileOrg(data?.academy?.id)

  // A signed-out visit to / goes to /signin, not to "Couldn't load": the
  // screen fetch fails for them too, and a failure with no session is not a
  // connection problem.
  const [signedOut, setSignedOut] = useState<boolean | null>(null)
  useEffect(() => {
    let live = true
    ;(async () => {
      const { data: s } = await createClient().auth.getSession()
      if (!live) return
      if (!s.session) window.location.replace('/signin')
      setSignedOut(!s.session)
    })()
    return () => {
      live = false
    }
  }, [])

  if (failed && signedOut !== false) return <ScreenSkeleton />
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
      childList={data.children ?? []}
      me={data.profile?.full_name ?? null}
      events={data.events ?? []}
    />
  )
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
  childList,
  events,
}: {
  academy: Academy
  otherAcademies: { id: string; name: string; type: string }[]
  role: string
  isPlatformAdmin: boolean
  needsPhone: boolean
  /** Whose account this is, for the footer. */
  me: string | null
  /** This person's own children in this academy, for the filter chips. */
  childList: Child[]
  events: HomeEvent[]
}) {
  const isStaff = role === 'owner' || role === 'admin'
  const isCoach = isStaff || role === 'coach'
  // A league's owner is its organiser; "run the club" is the wrong sentence
  // for somebody whose organisation has no squads of its own.
  const isLeague = academy.type === 'league'
  const roleWord = isLeague && isStaff ? 'Organiser' : `${role[0].toUpperCase()}${role.slice(1)}`

  // Which child's Saturday this is. Null is everyone, which is the default
  // and what a parent getting the family out the door wants; filtering is for
  // checking one thing. Deliberately NOT remembered between visits — a
  // narrowed home screen a parent does not remember narrowing is a home
  // screen that is quietly hiding a fixture.
  const [onlyChild, setOnlyChild] = useState<string | null>(null)

  // An academy-wide event has no team, so every child is asked about it and
  // it survives any filter. A team fixture survives only if the selected
  // child is one of the people being asked.
  const shownEvents = onlyChild
    ? events.filter((e) => (e.rsvps ?? []).some((r) => r.player_id === onlyChild))
    : events

  // The parent's three jobs, from home_jobs, folded into Needs you (Joey,
  // 4 Nov 2026: one list, never a strip and a list). The strip fetches them
  // and hands them here; Needs you draws them as rows.
  const [jobs, setJobs] = useState<JobsHandoff | null>(null)

  // The layout, resolved by the database so the client never holds a second
  // opinion about what a new person sees. Falls back to the two sections the
  // screen has always had, so a failed fetch is a plain home screen rather
  // than an empty one.
  const [layoutState, setLayoutState] = useState<{
    sections: SectionId[]
    available: SectionId[]
    customised: boolean
  }>({ sections: ['needs', 'upcoming'], available: [], customised: false })
  const [editing, setEditing] = useState(false)

  // Cached with the screen, so a customised layout is the first thing drawn
  // rather than a reorder a moment later; asked again after the editor closes.
  const { data: layoutData } = useScreen<{ sections: SectionId[]; available: SectionId[]; customised: boolean }>(
    'home_layout',
    { p_academy: getOrg() ?? undefined },
    { revalidateKey: editing }
  )
  useEffect(() => {
    if (layoutData) setLayoutState(layoutData)
  }, [layoutData])

  // The Channels list is gone from Home (Joey, 4 Nov 2026): the Chat tab is
  // one tap away and carries the same list with the same counts, and a parent
  // was scrolling past it to reach nothing. The stored layout may still name
  // it, so it is dropped here rather than offered.
  const layout = layoutState.sections.filter((id) => id !== 'chats')
  const available = layoutState.available.filter((id) => id !== 'chats')

  // Home shows the next few things, not the next three weeks: a parent's
  // screen is at most a screen and a half (Joey, 4 Nov 2026), and the
  // Fixtures tab has the rest. A parent's card carries a row per child to
  // answer, so two of them is a screen's worth; a coach's is a line.
  const grouped = groupTraining(shownEvents)
  const shownItems = grouped.slice(0, isCoach ? 3 : 2)

  // Each section, keyed by the id the database stores. Every one renders
  // nothing when it has nothing, so a section somebody has turned on but has
  // no data for costs them no space.
  const panels: Record<SectionId, React.ReactNode> = {
    needs: <NeedsYou jobs={role === 'parent' ? jobs : null} />,
    upcoming: (
          <section className="px-3.5 pb-5 pt-4">
            <div className="sect">
              <span className="eyebrow">Coming up</span>
              <Link href="/calendar" className="text-xs text-ink-3 underline underline-offset-2">
                {grouped.length > shownItems.length ? `All ${shownEvents.length} in the next 3 weeks` : 'All fixtures'}
              </Link>
            </div>

            <ChildChips children={childList} selected={onlyChild} onSelect={setOnlyChild} />

            {shownEvents.length === 0 ? (
              <p className="card p-6 text-center text-sm text-ink-3">
                {onlyChild
                  ? `Nothing in the next three weeks for ${
                      childList.find((c) => c.id === onlyChild)?.short_name ?? 'them'
                    }.`
                  : 'Nothing in the next three weeks.'}
              </p>
            ) : (
              <div className="stack">
                {/* An evening of training is one row, not three identical
                    ones. A club that trains three squads on a Thursday was
                    filling three of the five slots here with the same date,
                    the same venue and the same word — so the Saturday match
                    started below the fold. */}
                {shownItems.map((item) =>
                  item.kind === 'training' ? (
                    <TrainingBlock
                      key={item.events[0].id}
                      events={item.events}
                      isCoach={isCoach}
                    />
                  ) : (
                    <EventCard
                      key={item.event.id}
                      event={item.event}
                      isCoach={isCoach}
                      academyId={academy.id}
                      onlyChild={onlyChild}
                      colourChildren={childList.length > 1}
                    />
                  )
                )}
              </div>
            )}
          </section>
    ),
    calendar: <HomeCalendar />,
    chats: null,
    competitions: <HomeCompetitions />,
    owing: <HomeOwing />,
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
      <AppBar
        title={academy.name}
        meta={`${roleWord} · ${todayLabel()}`}
        crest={academy.name.slice(0, 2).toUpperCase()}
        logo={academy.logo_url}
        action={
          available.length > 0 && (
            // The word, not a glyph. ☰ reads as a menu, and this is not one.
            <button
              onClick={() => setEditing(true)}
              className="flex h-9 flex-none items-center gap-1 rounded-[10px] px-2.5 text-xs font-semibold"
              style={{ background: 'color-mix(in srgb, var(--bar-ink) 16%, transparent)', color: 'var(--bar-ink)' }}
              aria-label="Edit this screen"
              data-edit-home
            >
              <span aria-hidden>✎</span> Edit
            </button>
          )
        }
      />

      <Screen>
      {needsPhone && (
        <Link
          href="/settings"
          className="card mx-4 mb-4 mt-4 block p-3.5 text-sm"
          style={{ borderColor: 'var(--line)' }}
        >
          <b>Add your mobile number</b>
          <span className="mt-0.5 block text-ink-2">
            Your team can&apos;t call or text you without it.
          </span>
        </Link>
      )}

      {/*
        Who you are here and your three jobs, first. Product direction, 2 Nov
        2026: each of the four roles sees its own priorities, reaches each
        job in two taps, and switches organisation in one.
      */}
      <HomeJobs onJobs={setJobs} />

      {/*
        Everything waiting on this person, in one strip. It replaced a
        bespoke card that only ever counted join requests — two things
        telling a coach the same number is one too many, and the strip
        covers registrations, registers, fees and consents as well. For a
        parent the three jobs live inside it (one list, 4 Nov 2026).
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
          available={available}
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
      {/*
        Asked for directly, and worth having even though the tab bar already
        carries an Admin tab for staff: the bar is a row of five icons at the
        very bottom of a phone, and the thing a coach is looking for after
        reading their fixtures is a sentence that says where to run the club.
        A control somebody cannot find is a control that is not there.
      */}
      {isCoach && (
        <Link
          href="/admin"
          className="mt-8 flex items-center justify-between border-t px-4 py-4"
          style={{ borderColor: 'var(--line-2)' }}
        >
          <span>
            <span className="block text-sm font-semibold" style={{ color: 'var(--brand-text)' }}>
              {isLeague ? 'Run the league' : 'Run the club'}
            </span>
            <span className="block text-xs text-ink-3">
              {isLeague ? 'Competitions, officials, clubs, members' : 'Squads, fixtures, registrations, payments'}
            </span>
          </span>
          <span className="flex-none text-lg text-ink-3">›</span>
        </Link>
      )}

      <footer className="mt-8 border-t px-4 pb-2 pt-4" style={{ borderColor: 'var(--line-2)' }}>
        <p className="px-1 text-xs text-ink-3">
          Signed in as <b>{me ?? 'you'}</b>
          {role ? ` · ${role}` : ''} at {academy.name}
        </p>
        {/*
          `isPlatformAdmin` was threaded all the way from home_screen into
          this component and then never rendered, so /platform — the console
          for every academy on Squadroom — was reachable only by typing the
          URL. Found by auditing which pages have a link to them rather than
          by reading code, which is the same way /programs and /payments
          turned up.

          In the footer, not the main list. It is ours, not a club's, and it
          has no business sitting between a coach's fixtures and their chats.
        */}
        {isPlatformAdmin && (
          <Link
            href="/platform"
            className="mt-1 block px-1 text-xs underline underline-offset-2"
            style={{ color: 'var(--ink-3)' }}
          >
            Platform console
          </Link>
        )}
        <div className="mt-1.5">
          <SignOut />
        </div>
      </footer>
      </Screen>
    </div>
  )
}

function todayLabel() {
  return new Date().toLocaleDateString('en-AU', { timeZone: DEFAULT_TZ, weekday: 'long', day: 'numeric', month: 'long' })
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
  onlyChild,
  colourChildren,
}: {
  event: HomeEvent
  isCoach: boolean
  academyId: string
  /** When a chip is selected, only this child's row is offered. */
  onlyChild?: string | null
  /** A single child needs no colour — there is nothing to tell apart. */
  colourChildren?: boolean
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
    // Who is answering, asked of the phone. Asking the server, with no signal,
    // answered "nobody" and the answer was dropped while the chip still
    // showed it chosen (X-09, found 5 Nov 2026).
    const me = await signedInHere()
    if (!me) {
      setAnswers(before)
      setError('Not signed in')
      return
    }

    // X-09. A car park under a grandstand is where this button gets pressed.
    const outcome = await sendOrQueue({
      kind: 'upsert',
      table: 'event_rsvps',
      rows: [
        {
          academy_id: academyId,
          event_id: event.id,
          profile_id: me,
          player_id: playerId,
          status,
          note: note?.trim() || null,
        },
      ],
      onConflict: 'event_id,profile_id,player_id',
    })

    // Optimism is undone only when the answer is actually WRONG. A queued
    // write is saved — it just has not left the phone — so the chip stays
    // where the parent put it. Rolling it back would tell them their answer
    // did not take when it did.
    if (outcome.status === 'refused') {
      setAnswers(before)
      setError(outcome.error)
    }
  }

  return (
    <article className={`card ev ${cancelled ? 'opacity-60' : ''}`}>
      <div className="ev-top">
        <Link href={`/calendar/${event.id}`} className="datechip">
          <div className="d">{when.getDate()}</div>
          <div className="m">{when.toLocaleDateString('en-AU', { timeZone: DEFAULT_TZ, weekday: 'short' })}</div>
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
              {when.toLocaleTimeString('en-AU', { timeZone: DEFAULT_TZ, hour: 'numeric', minute: '2-digit' })}
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
          <span style={{ color: 'var(--brand-text)' }}>View roster</span>
        </Link>
      )}

      {!isCoach && !cancelled && answers.length > 0 && (
        <div className="stack">
          {(onlyChild ? answers.filter((a) => a.player_id === onlyChild) : answers).map((a) => (
            <div key={a.player_id}>
              <div className="kidrow">
                <span className="flex flex-none items-center gap-1.5">
                  {colourChildren && (
                    <span
                      aria-hidden
                      className="h-2 w-2 flex-none rounded-full"
                      style={{ background: childColour(a.player_id) }}
                    />
                  )}
                  <span className="who truncate">{a.player_name.split(' ')[0]}</span>
                </span>
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

