'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { inkOn } from '@/lib/brand/colour'

type Program = {
  id: string
  name: string
  kind: string
  season: string | null
  born_from_year: number | null
  born_to_year: number | null
  closes_at: string | null
}
type Club = {
  name: string
  slug: string
  suburb: string | null
  logo_url: string | null
  primary_colour: string | null
  type: string
  programs: Program[] | null
}

const years = (p: Program) => {
  if (!p.born_from_year && !p.born_to_year) return null
  if (p.born_from_year === p.born_to_year) return `born ${p.born_from_year}`
  return `born ${p.born_from_year ?? 'any'}–${p.born_to_year ?? 'any'}`
}
const closes = (iso: string | null) => (iso ? `closes ${new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}` : null)
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')

/**
 * The search and the cards. Everything open at first, narrowed as the
 * family types; each card is the club's crest or initials in its colour,
 * where it is, what is open, and two doors — register, or read about the
 * club first.
 */
export function FindClub() {
  const [query, setQuery] = useState('')
  const [clubs, setClubs] = useState<Club[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    const t = setTimeout(async () => {
      const { data, error } = await createClient().rpc('public_find_clubs', { p_query: query.trim() || undefined })
      if (!live) return
      if (error) return setError(error.message)
      setClubs((data as unknown as Club[]) ?? [])
    }, query ? 250 : 0)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [query])

  return (
    <div className="px-4 pt-4" data-find-club>
      <label className="block">
        <span className="sr-only">Club name or suburb</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Club name or suburb"
          autoComplete="off"
          className="w-full rounded-xl border px-4 py-3 text-base"
          style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}
          data-find-club-input
        />
      </label>
      {error && <p className="mt-3 text-sm" style={{ color: 'var(--no)' }}>{error}</p>}
      {clubs === null ? (
        <p className="mt-4 text-sm text-ink-3">Looking…</p>
      ) : clubs.length === 0 ? (
        <p className="card mt-4 p-5 text-center text-sm text-ink-2" data-find-club-empty>
          No club by that name or suburb is taking registrations on Squadroom yet. Ask your club — setting up takes half an hour.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3" data-find-club-results={clubs.length}>
          {clubs.map((c) => {
            const programs = c.programs ?? []
            const colour = c.primary_colour ?? '#101012'
            return (
              <li key={c.slug} className="card p-4" data-club={c.slug}>
                <div className="flex items-center gap-3">
                  {c.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- the club's own file
                    <img src={c.logo_url} alt="" className="h-11 w-11 flex-none rounded-xl object-contain p-0.5" style={{ background: 'var(--surface-2)' }} />
                  ) : (
                    <span className="grid h-11 w-11 flex-none place-items-center rounded-xl text-sm font-bold" style={{ background: colour, color: inkOn(colour) }} aria-hidden>
                      {initials(c.name)}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{c.name}</span>
                    <span className="block truncate text-sm text-ink-2">
                      {c.suburb ?? (c.type === 'academy' ? 'Academy' : 'Club')}
                      {c.suburb ? ` · ${c.type === 'academy' ? 'academy' : 'club'}` : ''}
                    </span>
                  </span>
                </div>
                <ul className="mt-3 flex flex-col gap-1 text-sm">
                  {programs.slice(0, 3).map((p) => (
                    <li key={p.id} className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate">{p.name}</span>
                      <span className="flex-none text-xs text-ink-3">{[years(p), closes(p.closes_at)].filter(Boolean).join(' · ')}</span>
                    </li>
                  ))}
                  {programs.length > 3 && <li className="text-xs text-ink-3">and {programs.length - 3} more</li>}
                </ul>
                <div className="mt-3 flex gap-2">
                  <a href={`/${c.slug}/register`} className="flex-1 rounded-xl px-4 py-2.5 text-center text-sm font-semibold text-brand-ink" style={{ background: 'var(--brand)' }} data-club-register>
                    Register ›
                  </a>
                  <a href={`/${c.slug}`} className="rounded-xl border px-4 py-2.5 text-sm font-semibold" style={{ borderColor: 'var(--line)' }}>
                    About the club
                  </a>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
