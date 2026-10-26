'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { getOrg } from '@/lib/org'

type Dot = { on_date: string; events: number; has_match: boolean }

const SYDNEY = 'Australia/Sydney'

/**
 * A month at a glance.
 *
 * The thing a fixture list cannot do: show the SHAPE of a month. "Two games
 * and four trainings next week, then nothing until the 14th" is a sentence a
 * parent builds in two seconds from a grid and never builds from a list.
 *
 * Deliberately dots, not titles. A square 40 pixels wide cannot hold "U8 SPL
 * vs Gladesville Ravens", and a grid that tries is a grid you cannot read —
 * so a filled square means a game, an outline means training or something
 * else, and tapping a day goes to the list, which is where detail belongs.
 *
 * It asks for a date and a count and nothing else. Shipping forty events to
 * draw forty dots would make the lightest thing on the screen the most
 * expensive.
 */
export function HomeCalendar() {
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const [dots, setDots] = useState<Map<string, Dot> | null>(null)

  useEffect(() => {
    let live = true
    ;(async () => {
      setDots(null)
      const { data } = await createClient().rpc('month_dots', {
        p_academy: getOrg() ?? undefined,
        p_month: iso(month),
      })
      if (!live) return
      setDots(new Map(((data ?? []) as Dot[]).map((d) => [d.on_date, d])))
    })()
    return () => {
      live = false
    }
  }, [month])

  const cells = monthCells(month)
  const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: SYDNEY })

  return (
    <section className="px-3.5 pb-5 pt-4">
      <div className="sect">
        <span className="eyebrow">
          {month.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })}
        </span>
        <span className="flex items-center gap-1">
          <button
            onClick={() => setMonth(addMonths(month, -1))}
            aria-label="Previous month"
            className="grid h-7 w-7 place-items-center rounded-lg text-ink-3"
            style={{ background: 'var(--surface-2)' }}
          >
            ‹
          </button>
          <button
            onClick={() => setMonth(addMonths(month, 1))}
            aria-label="Next month"
            className="grid h-7 w-7 place-items-center rounded-lg text-ink-3"
            style={{ background: 'var(--surface-2)' }}
          >
            ›
          </button>
        </span>
      </div>

      <div className="card p-2.5">
        <div className="grid grid-cols-7 gap-1">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
            <span key={i} className="pb-1 text-center text-[10px] font-semibold text-ink-3">
              {d}
            </span>
          ))}

          {cells.map((cell, i) => {
            if (!cell) return <span key={`pad-${i}`} />
            const key = iso(cell)
            const dot = dots?.get(key)
            const isToday = key === todayKey

            return (
              <Link
                key={key}
                href="/calendar"
                aria-label={
                  dot
                    ? `${cell.getDate()} — ${dot.events} ${dot.events === 1 ? 'event' : 'events'}`
                    : `${cell.getDate()} — nothing on`
                }
                className="relative grid aspect-square place-items-center rounded-lg text-sm tabular-nums"
                style={{
                  background: isToday ? 'var(--brand)' : 'transparent',
                  color: isToday ? '#fff' : dot ? 'var(--ink)' : 'var(--ink-3)',
                  fontWeight: dot ? 600 : 400,
                }}
              >
                {cell.getDate()}
                {/* Filled for a game, outlined for training. The difference a
                    parent actually cares about on a Saturday. */}
                {dot && (
                  <span
                    aria-hidden
                    className="absolute bottom-1 h-1.5 w-1.5 rounded-full"
                    style={
                      dot.has_match
                        ? { background: isToday ? '#fff' : 'var(--brand)' }
                        : {
                            border: `1.5px solid ${isToday ? '#fff' : 'var(--ink-3)'}`,
                          }
                    }
                  />
                )}
              </Link>
            )
          })}
        </div>
      </div>

      <p className="px-1 pt-1.5 text-xs text-ink-3">
        <span
          className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle"
          style={{ background: 'var(--brand)' }}
        />
        game
        <span
          className="ml-3 mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle"
          style={{ border: '1.5px solid var(--ink-3)' }}
        />
        training
      </p>
    </section>
  )
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function addMonths(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1)
}

/** Local parts, never toISOString — that would shift a Sydney date back a day. */
function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`
}

/**
 * The grid, Monday first.
 *
 * Australian calendars start on Monday and `getDay()` starts on Sunday, so
 * the padding is (day + 6) % 7 rather than day. Off by one here puts every
 * fixture on the wrong weekday, which is the kind of bug somebody spots from
 * across a room.
 */
function monthCells(month: Date): (Date | null)[] {
  const first = startOfMonth(month)
  const pad = (first.getDay() + 6) % 7
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()

  return [
    ...Array.from({ length: pad }, () => null),
    ...Array.from({ length: days }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1)),
  ]
}
