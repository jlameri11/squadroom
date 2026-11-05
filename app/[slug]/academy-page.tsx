'use client'

import Link from 'next/link'
import { clubThemeCss } from '@/lib/brand/colour'
import { ProgramSummary, type PublicProgram } from './program-card'

export type Academy = {
  academy: {
    name: string
    slug: string
    primary_colour: string
    logo_url: string | null
    timezone: string
  }
  programs: PublicProgram[]
  competitions: {
    slug: string
    name: string
    season: string | null
    organiser: string | null
    starts_on: string | null
    ends_on: string | null
  }[]
}

/**
 * The club, to somebody who is not in it yet.
 *
 * Two things a stranger wants from a club's page, in the order they want
 * them: can my child play here (the programs, with a price and whether there
 * is room), and what does the club actually do on a Saturday (the draw).
 * Everything else a club might put on a website — history, committee, the
 * sponsor logos — is the club's website's job. This page has one button.
 *
 * Every program card goes to the same place, the register form, because
 * which program a family wants is the first question that form asks and it
 * is better asked there, next to the child's date of birth, than guessed
 * from a tap here.
 */
export function AcademyPage({ slug, academy, secondary = null }: { slug: string; academy: Academy | null; secondary?: string | null }) {
  if (!academy) {
    return (
      <main className="mx-auto min-h-dvh w-full max-w-lg p-5">
        <h1 className="display text-xl">Not found</h1>
        <p className="mt-1 text-sm text-ink-2">
          Check the link with your club — this one does not point at a club we have.
        </p>
      </main>
    )
  }

  const { academy: club, programs, competitions } = academy
  // The club's colours for this page only, in light and dark, through the
  // same arithmetic as the app: black or white text on the colour, and a
  // deeper or lighter shade wherever the colour itself would not read.
  const css = clubThemeCss(club.primary_colour, secondary, '[data-club-scope]')

  return (
    <main className="mx-auto min-h-dvh w-full max-w-lg pb-12" data-club-scope>
      {css && <style>{css}</style>}
      <header
        className="px-5 pb-6 pt-7"
        style={{ background: 'var(--bar)', color: 'var(--bar-ink)', borderBottom: '1px solid var(--bar-line)' }}
      >
        {/* The name drops under the crest when larger text no longer fits
            both on one line (X-10). */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          {/* The crest at a size that reads as a crest and not a logo wall.
              Plain <img>: it is one small file from the club's own bucket,
              and next/image would need a remote-pattern entry per host. */}
          {club.logo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={club.logo_url}
              alt=""
              width={64}
              height={64}
              className="h-16 w-16 flex-none rounded-xl bg-white object-contain p-1"
              data-club-logo
            />
          )}
          <div className="min-w-[min(100%,12rem)] flex-1">
            <h1 className="display text-[1.75rem] leading-tight" style={{ textWrap: 'balance' }}>
              {club.name}
            </h1>
            <p className="mt-1 text-sm" style={{ opacity: 0.8 }}>
              {programs.length === 0
                ? 'Registration is closed at the moment'
                : programs.length === 1
                  ? 'One program open for registration'
                  : `${programs.length} programs open for registration`}
            </p>
          </div>
        </div>
      </header>

      <div className="px-4">
        {programs.length > 0 ? (
          <section className="mt-5">
            <span className="eyebrow">Open for registration</span>
            <div className="mt-1.5 flex flex-col gap-2">
              {programs.map((p) => (
                <Link
                  key={p.id}
                  href={`/${slug}/register`}
                  className="card block p-3.5"
                  style={{ borderColor: 'var(--line)' }}
                >
                  <ProgramSummary program={p} />
                </Link>
              ))}
            </div>

            <Link
              href={`/${slug}/register`}
              className="mt-4 block w-full rounded-xl px-4 py-3 text-center font-semibold"
              style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
            >
              Register
            </Link>
          </section>
        ) : (
          <section className="mt-5">
            <span className="eyebrow">Registration</span>
            <p className="card mt-1.5 p-3.5 text-sm text-ink-2">
              Nothing is open right now. Ask the club when the next intake is.
            </p>
          </section>
        )}

        {competitions.length > 0 && (
          <section className="mt-6">
            <span className="eyebrow">Fixtures, results and ladders</span>
            <div className="card mt-1.5 overflow-hidden">
              {competitions.map((c) => (
                <Link
                  key={c.slug}
                  href={`/c/${c.slug}`}
                  className="flex items-center gap-3 border-t px-3.5 py-3 text-sm first:border-t-0"
                  style={{ borderColor: 'var(--line-2)' }}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{c.name}</span>
                    <span className="block text-xs text-ink-3">
                      {[c.season, c.organiser].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="flex-none text-ink-3" aria-hidden>
                    ›
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* The same sentence the register page makes above its button, here
            so a parent reads it before they tap rather than after. */}
        <p className="mt-6 text-center text-xs text-ink-3">
          Children do not get accounts here, and nothing about them is published. Registering
          sends your details to {club.name} and to nobody else.
        </p>
      </div>
    </main>
  )
}
