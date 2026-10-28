'use client'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { CalendarList, type UpcomingEvent } from './calendar-list'
import { NewSessions } from './new-sessions'
import { CallOffDay } from './call-off-day'
import { DrawFilters, applyDrawFilter, type DrawFilter } from './draw-filters'
import { ShareDraw } from './share-draw'
import { ShareCard } from '@/components/share-card'
import { AppBar, Screen } from '@/components/app-shell'
import { ScreenSkeleton } from '@/components/screen-skeleton'
import { useScreen } from '@/lib/hooks/use-screen'
import { useOrg } from '@/lib/org'

type Data = {
  academy: { id: string; name: string; slug: string } | null
  is_staff: boolean
  teams: { id: string; name: string }[]
  events: UpcomingEvent[]
}

export function FixturesScreen() {
  const org = useOrg()
  const { data, failed } = useScreen<Data>('fixtures_screen', { p_days: 60, p_academy: org })
  const [adding, setAdding] = useState(false)
  const [callingOff, setCallingOff] = useState(false)
  // Not remembered between visits. A fixtures screen that opens already
  // narrowed is a fixtures screen with somebody's game missing from it, and
  // the person who would notice last is the one who set the filter weeks ago.
  // A squad can arrive in the URL, which is how a search result for "U10"
  // lands somebody on the games rather than on a staff screen they cannot
  // open. Read once, as the starting filter — not kept in sync, because
  // after that the chips are what the person is driving.
  const params = useSearchParams()
  const [filter, setFilter] = useState<DrawFilter>({
    day: null,
    team: params.get('squad'),
    what: null,
  })

  // Screen is the scroll container, so everything sticky inside it sticks to
  // the SAME top. The filter bar and the day headings both did, and the day
  // heading sat invisibly behind the filter bar — a draw with no dates on it.
  // So the bar is measured and the headings stick below it. Measured rather
  // than hardcoded because the bar is one row for a single-squad club and two
  // for everybody else, and it changes height when the squad row appears.
  const barRef = useRef<HTMLDivElement>(null)
  const [barHeight, setBarHeight] = useState(0)
  useEffect(() => {
    const el = barRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setBarHeight(el.offsetHeight))
    ro.observe(el)
    setBarHeight(el.offsetHeight)
    return () => ro.disconnect()
  }, [data])

  if (failed) {
    return (
      <div className="mx-auto grid min-h-dvh w-full max-w-md place-items-center p-6">
        <p className="text-center text-sm text-ink-2">Couldn&apos;t load your fixtures.</p>
      </div>
    )
  }
  if (!data?.academy) return <ScreenSkeleton />

  const all = data.events ?? []
  const shown = applyDrawFilter(all, filter)
  const narrowed = shown.length !== all.length

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
      <AppBar
        title="Fixtures"
        meta={
          narrowed
            ? `${shown.length} of ${all.length} · next 60 days`
            : `${data.academy.name} · next 60 days`
        }
        action={
          data.is_staff && (
            <button
              onClick={() => setAdding(true)}
              className="grid h-9 w-9 flex-none place-items-center rounded-[10px] text-xl"
              style={{ background: '#ffffff26', color: 'var(--brand-ink)' }}
              aria-label="Add weekly training"
            >
              ＋
            </button>
          )
        }
      />
      <Screen>
        {/*
          FOLDED AWAY, because these five controls were the first screen of
          this page. A coach opening Fixtures is looking for a fixture — the
          tools for putting them in, taking a day off and posting them are
          things they came here to do SECOND, if at all, and on a phone they
          occupied the whole of the first view before a single game appeared.

          Closed by default and one tap to open. Not hidden in a menu: a
          coach who has never found "Call off a day" cannot call off a day,
          and it is the one in here that is urgent.
        */}
        {data.is_staff && (
          <details className="border-b" style={{ borderColor: 'var(--line-2)' }}>
            <summary
              className="cursor-pointer px-4 py-2.5 text-sm font-semibold"
              style={{ color: 'var(--brand-text)' }}
            >
              Add, share or call off
            </summary>

            <div className="px-4 pb-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <button
                  onClick={() => setAdding(true)}
                  className="text-sm underline underline-offset-4"
                  style={{ color: 'var(--brand-text)' }}
                >
                  Add weekly training
                </button>
                <a
                  href="/admin/import"
                  className="text-sm underline underline-offset-4"
                  style={{ color: 'var(--brand-text)' }}
                >
                  Import a draw
                </a>
                <a
                  href="/scan"
                  className="text-sm underline underline-offset-4"
                  style={{ color: 'var(--brand-text)' }}
                >
                  From a screenshot
                </a>
                {/* Wet weather does not arrive one fixture at a time. */}
                <button
                  onClick={() => setCallingOff(true)}
                  className="text-sm underline underline-offset-4"
                  style={{ color: 'var(--no)' }}
                >
                  Call off a day
                </button>
              </div>

              <ShareDraw slug={data.academy.slug} />

              {/* The Friday post. A link is for people who already follow
                  the club; a picture is how a club reaches the ones who do
                  not. */}
              <ShareCard
                endpoint={`/api/share/weekend?academy=${data.academy.id}`}
                label="Make this weekend's card"
                filename="weekend"
              />
            </div>
          </details>
        )}

        <div ref={barRef} className="sticky top-0 z-20">
          <DrawFilters events={all} filter={filter} onChange={setFilter} />
        </div>

        {narrowed && shown.length === 0 ? (
          <div className="p-6 text-center">
            <p className="text-sm text-ink-3">Nothing matches that.</p>
            <button
              onClick={() => setFilter({ day: null, team: null, what: null })}
              className="mt-2 text-sm underline underline-offset-4"
              style={{ color: 'var(--brand-text)' }}
            >
              Clear the filter
            </button>
          </div>
        ) : (
          <CalendarList academyId={data.academy.id} events={shown} stickyTop={barHeight} />
        )}
      </Screen>

      {callingOff && data.academy && (
        <CallOffDay
          academyId={data.academy.id}
          onClose={() => setCallingOff(false)}
          onDone={() => window.location.reload()}
        />
      )}

      {adding && data.academy && (
        <NewSessions
          academyId={data.academy.id}
          teams={data.teams ?? []}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  )
}
