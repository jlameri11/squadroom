/**
 * The look of a share card.
 *
 * X-04. A club that posts a result on Saturday afternoon is marketing itself
 * and, incidentally, us — so the card has to look like the club rather than
 * like a Squadroom template. Everything on it is built from the academy's own
 * colour and name — and its logo beside the name when it has one (Joey, 4 Nov
 * 2026), on a white tile so a crest never vanishes into the club's colour.
 * No logo, no tile: a card that falls back to a grey box looks worse than
 * one that never had a logo in it. The second colour, when there is one, is
 * the line above the footer.
 *
 * SATORI, NOT A BROWSER. These render through next/og, which means a useful
 * subset of CSS and some hard rules worth stating once rather than
 * rediscovering per card:
 *
 *   · flexbox only. No grid, no float. Every container sets display:flex.
 *   · no shorthand that expands to several properties in ways Satori guesses
 *     at — padding and margin are written out per side where it matters.
 *   · no external images or webfonts fetched at render time. A card that
 *     waits on a font host is a card that sometimes does not render.
 *
 * NOTHING ON A CARD NAMES A CHILD. R-16 exists because other products got
 * this wrong, and a graphic is the single most shareable thing the product
 * makes — once it is in a WhatsApp group it is out of everyone's hands. Teams
 * and scores and times; never a roster, never a scorer, never a photo.
 */

import { inkOn as readableInk } from '@/lib/brand/colour'

export const SIZES = {
  /** Instagram and WhatsApp stories. */
  story: { width: 1080, height: 1920 },
  /** An Instagram feed post. */
  square: { width: 1080, height: 1080 },
  /** Instagram portrait, which gets the most feed height. */
  portrait: { width: 1080, height: 1350 },
} as const

export type SizeName = keyof typeof SIZES

export function sizeOf(name: string | null): { width: number; height: number } {
  return SIZES[(name ?? 'story') as SizeName] ?? SIZES.story
}

/**
 * Black or white text on the club's colour, whichever reads better — the
 * same decision the app makes (lib/brand/colour.ts), so a yellow club's card
 * and its app bar agree.
 */
export function inkOn(hex: string): string {
  return readableInk(hex)
}

/**
 * The club's logo as a data URI for Satori, or null. Fetched with a short
 * deadline: a card that waits on a slow file is a card that sometimes does
 * not render, and the card is complete without it. PNG, JPG and SVG only —
 * what Satori draws.
 */
export async function logoDataUri(url: string | null | undefined): Promise<string | null> {
  if (!url || !/^https:\/\//.test(url)) return null
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), 2000)
  try {
    const res = await fetch(url, { signal: abort.signal })
    if (!res.ok) return null
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim()
    if (!['image/png', 'image/jpeg', 'image/svg+xml'].includes(type)) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > 1_500_000) return null
    return `data:${type};base64,${buf.toString('base64')}`
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** A hex that Satori will accept, whatever the club typed. */
export function safeColour(value: string | null | undefined, fallback = '#202842'): string {
  const v = (value ?? '').trim()
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? v : fallback
}

export function Frame({
  brand,
  width,
  height,
  children,
  footer,
  logo = null,
  accent = null,
}: {
  brand: string
  width: number
  height: number
  children: React.ReactNode
  footer: string
  /** A data URI (logoDataUri), never a URL Satori would have to fetch. */
  logo?: string | null
  /** The club's second colour, for the line above the footer. */
  accent?: string | null
}) {
  const ink = inkOn(brand)

  return (
    <div
      style={{
        width,
        height,
        display: 'flex',
        flexDirection: 'column',
        // The content is centred and the footer pinned, rather than the two
        // pushed apart. space-between with two children left a third of the
        // card empty between the result and the club's name, which reads as
        // a template somebody forgot to fill in.
        justifyContent: 'space-between',
        background: brand,
        color: ink,
        fontFamily: 'sans-serif',
        paddingTop: height * 0.09,
        paddingBottom: height * 0.06,
        paddingLeft: width * 0.08,
        paddingRight: width * 0.08,
      }}
    >
      <div
        style={{
          display: 'flex',
          flex: 1,
          flexDirection: 'column',
          justifyContent: 'center',
        }}
      >
        {children}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            display: 'flex',
            // A hairline in the ink colour rather than a border, because
            // Satori treats a 1px border inconsistently at this scale.
            height: accent ? 6 : 2,
            width: '100%',
            background: accent ?? ink,
            opacity: accent ? 1 : 0.25,
            marginBottom: 28,
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {logo && (
            // eslint-disable-next-line @next/next/no-img-element -- Satori draws <img>, not next/image
            <img
              src={logo}
              alt=""
              width={84}
              height={84}
              style={{ width: 84, height: 84, borderRadius: 18, background: '#ffffff', padding: 8, marginRight: 24, objectFit: 'contain' }}
            />
          )}
          <div style={{ display: 'flex', fontSize: 34, letterSpacing: 1, opacity: 0.85 }}>
            {footer}
          </div>
        </div>
      </div>
    </div>
  )
}

/** An uppercase label, the one piece of type that repeats across every card. */
export function Eyebrow({ children, ink }: { children: string; ink: string }) {
  return (
    <div
      style={{
        display: 'flex',
        fontSize: 36,
        letterSpacing: 6,
        textTransform: 'uppercase',
        opacity: 0.75,
        color: ink,
      }}
    >
      {children}
    </div>
  )
}
