'use client'

import { useState, useSyncExternalStore } from 'react'

/**
 * Step 1 (Joey, 16 Nov 2026): at a club, or on a program, that requires
 * PlayFootball, a family registers THERE first — Football Australia's
 * national registration — and comes back here for step 2, their team.
 *
 * One screen, two steps in plain words, a button that opens PlayFootball's
 * club search for this club in a new tab, and "I've done it", which brings
 * them back to our form. Remembered on this phone per club, so the screen
 * is shown once, not on every visit. Clubs that do not require PlayFootball
 * never render this. Squadroom never talks to PlayFootball: the button is a
 * link in the family's own browser, nothing more (CLAUDE.md).
 */
const FINDER = 'https://www.playfootball.com.au/football-finder'
const KEY = (slug: string) => `squadroom.playfootball-done:${slug}`
const EVENT = 'squadroom:playfootball'

export function playfootballDone(slug: string): boolean {
  try {
    return localStorage.getItem(KEY(slug)) === '1'
  } catch {
    return false
  }
}
function markDone(slug: string) {
  try {
    localStorage.setItem(KEY(slug), '1')
  } catch {}
  window.dispatchEvent(new Event(EVENT))
}
const subscribe = (onChange: () => void) => {
  window.addEventListener(EVENT, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}
/**
 * Whether this phone has been through Step 1 for the club. Read from the
 * phone's storage as an external store: the server renders "not yet", the
 * browser corrects it on hydration, and "I've done it" updates every reader
 * at once — no state set from an effect.
 */
export function usePlayfootballDone(slug: string): boolean {
  return useSyncExternalStore(subscribe, () => playfootballDone(slug), () => false)
}

export function PlayFootballFirst({
  slug,
  clubName,
  url,
  teamName = null,
  onDone,
}: {
  slug: string
  clubName: string
  /** The club's own page on PlayFootball when it has set one; else the club search. */
  url?: string | null
  /** The squad they are joining, when the link named one. */
  teamName?: string | null
  onDone?: () => void
}) {
  const [opened, setOpened] = useState(false)
  const href = url && /^https:\/\/([a-z0-9-]+\.)*playfootball\.com\.au(\/|$)/i.test(url) ? url : `${FINDER}?q=${encodeURIComponent(clubName)}`

  function done() {
    markDone(slug)
    onDone?.()
  }

  return (
    <section className="card mt-4 p-4" data-playfootball-step1 data-club-scope>
      <span className="eyebrow">Before you join {clubName}</span>
      <ol className="mt-3 flex flex-col gap-3">
        <li className="flex gap-3">
          <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full text-sm font-semibold text-brand-ink" style={{ background: 'var(--brand)' }}>1</span>
          <div>
            <p className="font-semibold">Register in PlayFootball</p>
            <p className="text-sm text-ink-2">
              Football Australia&apos;s national registration — every player has one, and the registration fee is paid there, not here.
              Find {clubName} and register {teamName ? `for ${teamName}` : 'your child'}.
            </p>
          </div>
        </li>
        <li className="flex gap-3">
          <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full border text-sm font-semibold" style={{ borderColor: 'var(--line)', color: 'var(--ink-2)' }}>2</span>
          <div>
            <p className="font-semibold">Come back here to join your team</p>
            <p className="text-sm text-ink-2">A minute: your account, your child&apos;s name, birthday and FFA number, and only what PlayFootball doesn&apos;t already have.</p>
          </div>
        </li>
      </ol>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => setOpened(true)}
        className="mt-4 block rounded-xl px-4 py-3 text-center font-semibold text-brand-ink"
        style={{ background: 'var(--brand)' }}
        data-playfootball-open
      >
        Open PlayFootball
      </a>
      <button
        type="button"
        onClick={done}
        className="tap mt-3 block w-full rounded-xl border px-4 py-3 text-center font-semibold"
        style={{ borderColor: 'var(--line)' }}
        data-playfootball-done
      >
        {opened ? 'I’ve done it — back to step 2' : 'I’ve already registered there'}
      </button>
      <p className="mt-3 text-xs text-ink-3">
        Not registered yet? Step 2 still works: your child is let in as “PlayFootball pending” until the club&apos;s next PlayFootball import confirms them, and cannot be named on a team sheet before then.
      </p>
    </section>
  )
}

/**
 * The same screen as a gate: shown until "I've done it", then the children
 * — the join link's landing and form, at a club that requires PlayFootball.
 */
export function PlayFootballGate({ when = true, slug, clubName, url, teamName = null, children }: { when?: boolean; slug: string; clubName: string; url?: string | null; teamName?: string | null; children: React.ReactNode }) {
  const done = usePlayfootballDone(slug)
  if (!when || done) return <>{children}</>
  return <PlayFootballFirst slug={slug} clubName={clubName} url={url} teamName={teamName} />
}
