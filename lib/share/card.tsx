/**
 * The look of a share card.
 *
 * X-04. A club that posts a result on Saturday afternoon is marketing itself
 * and, incidentally, us — so the card has to look like the club rather than
 * like a Squadroom template. Everything on it is built from the academy's own
 * colour and name; there is no logo, deliberately, because `logo_url` is
 * usually empty and a card that falls back to a grey box looks worse than one
 * that never had a logo in it.
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
 * Is this colour dark enough for white text?
 *
 * A club's colour is whatever they picked, and some of them pick yellow.
 * White on #EFBD5B is unreadable, so the text colour is computed rather than
 * assumed — relative luminance, the same sum a contrast checker uses.
 */
export function inkOn(hex: string): string {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const r = parseInt(full.slice(0, 2), 16) / 255
  const g = parseInt(full.slice(2, 4), 16) / 255
  const b = parseInt(full.slice(4, 6), 16) / 255
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  return luminance > 0.45 ? '#111827' : '#ffffff'
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
}: {
  brand: string
  width: number
  height: number
  children: React.ReactNode
  footer: string
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
            height: 2,
            width: '100%',
            background: ink,
            opacity: 0.25,
            marginBottom: 28,
          }}
        />
        <div style={{ display: 'flex', fontSize: 34, letterSpacing: 1, opacity: 0.85 }}>
          {footer}
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
