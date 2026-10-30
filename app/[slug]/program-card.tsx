'use client'

import type { Question } from '@/components/question-field'

/**
 * One program, as a parent reads it: name, who it is for, when, how much,
 * and whether there is room.
 *
 * Shared by the club's front door (`/{slug}`) and the register form
 * (`/{slug}/register`). It lived inline in the form first, and the front
 * door would have been a second copy of the same thirty lines, which is two
 * places for "places left" to be worded differently.
 *
 * This is the CONTENT only. The form wraps it in a selectable button and the
 * front door in a card that links to the form; what is inside should read
 * identically on both, because it is the same program.
 */
export type PublicProgram = {
  id: string
  name: string
  kind: string
  description: string | null
  season: string | null
  born_from_year: number | null
  born_to_year: number | null
  gender: string | null
  starts_on: string | null
  ends_on: string | null
  closes_at: string | null
  questions: Question[] | null
  /** R-18: PlayFootball first. */
  requires_official_rego?: boolean
  payment_required: boolean
  amount_cents: number | null
  spots_left: number | null
  waitlist_enabled: boolean
}

export function ProgramSummary({ program: p }: { program: PublicProgram }) {
  return (
    <>
      <span className="block font-semibold">{p.name}</span>
      <span className="mt-0.5 block text-sm text-ink-2">
        {[
          p.born_from_year &&
            `Born ${p.born_from_year}${
              p.born_to_year && p.born_to_year !== p.born_from_year ? `–${p.born_to_year}` : ''
            }`,
          p.starts_on && `From ${shortDate(p.starts_on)}`,
          p.amount_cents != null && money(p.amount_cents),
        ]
          .filter(Boolean)
          .join(' · ')}
      </span>
      {p.description && <span className="mt-1 block text-sm text-ink-3">{p.description}</span>}
      {/* The number, because "limited places" is what every club says and a
          number is what a parent can act on. */}
      {p.spots_left != null && (
        <span
          className="mt-1 block text-xs font-semibold"
          style={{ color: p.spots_left === 0 ? 'var(--no)' : 'var(--yes)' }}
        >
          {p.spots_left === 0
            ? p.waitlist_enabled
              ? 'Full — you can join the waitlist'
              : 'Full'
            : `${p.spots_left} ${p.spots_left === 1 ? 'place' : 'places'} left`}
        </span>
      )}
    </>
  )
}

export function money(cents: number) {
  // Integer cents, formatted once. Never arithmetic on dollars.
  return `$${(cents / 100).toFixed(2).replace(/\.00$/, '')}`
}

export function shortDate(value: string) {
  // A plain yyyy-mm-dd is read as UTC midnight by `new Date`, which shows the
  // previous day in Sydney.
  const [y, m, d] = value.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}
