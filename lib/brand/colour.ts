/**
 * Colour arithmetic for anything painted in a colour Squadroom did not pick:
 * a club's colour, mostly.
 *
 * WCAG 2.x relative luminance and contrast ratio, and the one decision built
 * on them: text on a colour is the brand's near-black or white, whichever
 * reads better. A club that picks yellow gets black text on its buttons and
 * a club that picks navy gets white, without either of them being asked.
 */

export const INK_DARK = '#101012'
export const INK_LIGHT = '#ffffff'

/** "#abc", "#aabbcc" or "#aabbccdd" → [r, g, b] in 0..1, or null. */
export function parseHex(colour: string | null | undefined): [number, number, number] | null {
  if (!colour) return null
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(colour.trim())
  if (!m) return null
  let h = m[1]
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number]
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(colour: string): number {
  const rgb = parseHex(colour)
  if (!rgb) return NaN
  const [r, g, b] = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

/**
 * The text colour for a surface painted `bg`: near-black or white, whichever
 * contrasts more. Something that is not a hex colour (a CSS variable) gets
 * the brand's own ink, which is already right for the brand's own surface.
 */
export function inkOn(bg: string | null | undefined): string {
  if (!parseHex(bg)) return 'var(--brand-ink)'
  return contrast(bg as string, INK_DARK) >= contrast(bg as string, INK_LIGHT) ? INK_DARK : INK_LIGHT
}

// ---------------------------------------------------------------- the club

export type Mode = 'light' | 'dark'

/** The grounds a club's colour has to show up on — globals.css's paper and
 *  surface in each theme. */
export const GROUNDS: Record<Mode, { paper: string; surface: string }> = {
  light: { paper: '#F4F4F5', surface: '#FFFFFF' },
  dark: { paper: '#101012', surface: '#1B1B1E' },
}

const toHex = (rgb: number[]) => '#' + rgb.map((c) => Math.round(Math.max(0, Math.min(1, c)) * 255).toString(16).padStart(2, '0')).join('')

/** `colour` moved `t` of the way (0..1) toward `toward`, in sRGB. */
export function mix(colour: string, toward: string, t: number): string {
  const a = parseHex(colour)
  const b = parseHex(toward)
  if (!a || !b) return colour
  return toHex(a.map((c, i) => c + (b[i] - c) * t))
}

/**
 * The nearest shade of `colour` that reaches `min`:1 against every ground —
 * deeper on a light page, lighter on a dark one. `adjusted` says whether it
 * had to move at all.
 */
export function reach(colour: string, grounds: string[], min: number, mode: Mode): { colour: string; adjusted: boolean } {
  const toward = mode === 'light' ? '#000000' : '#ffffff'
  for (let step = 0; step <= 50; step++) {
    const c = step === 0 ? colour.toLowerCase() : mix(colour, toward, step / 50)
    if (grounds.every((g) => contrast(c, g) >= min)) return { colour: c, adjusted: step > 0 }
  }
  return { colour: toward, adjusted: true }
}

/** "#abc" → "#aabbcc", lower case; anything else → null. */
export function normaliseHex(colour: string | null | undefined): string | null {
  const rgb = parseHex(colour)
  return rgb ? toHex(rgb) : null
}

/**
 * The CSS variables that put a club's colours on the app, for one theme.
 *
 *   --bar         the header: the club's colour exactly as it chose it, with
 *                 black or white text, whichever reads (always ≥ 4.58:1 —
 *                 no colour is below that against both);
 *   --brand       buttons, the selected chip: the club's colour, deepened or
 *                 lightened only as far as it takes to show up against the
 *                 page (3:1, the floor for a control's edge);
 *   --brand-text  the club's colour as words or a link: 4.5:1 on the page;
 *   --highlight   the second colour (else the first) for the active tab and
 *                 other highlights, held to 3:1 like a button.
 *
 * Orange, green and red are not here and never are: needs-you, going and
 * out mean the same thing in every club.
 */
export function clubTheme(primary: string | null | undefined, secondary: string | null | undefined, mode: Mode): Record<string, string> | null {
  const p = normaliseHex(primary)
  if (!p) return null
  const s = normaliseHex(secondary) ?? p
  const g = GROUNDS[mode]
  const grounds = [g.paper, g.surface]
  const brand = reach(p, grounds, 3, mode).colour
  const text = reach(p, grounds, 4.5, mode).colour
  const highlight = reach(s, grounds, 3, mode).colour
  // The header needs an edge only when it is nearly the page's own colour
  // (a white club in light mode, a black one in dark).
  const barLine = contrast(p, g.paper) < 1.3 ? (mode === 'light' ? '#1010121f' : '#ffffff1f') : 'transparent'
  return {
    '--bar': p,
    '--bar-ink': inkOn(p),
    '--bar-line': barLine,
    '--brand': brand,
    '--brand-ink': inkOn(brand),
    '--brand-text': text,
    '--brand-soft': `${brand}1a`,
    '--brand-faint': `${brand}0d`,
    '--highlight': highlight,
    '--highlight-ink': inkOn(highlight),
  }
}

/**
 * The club's colours as one stylesheet: light, dark by the phone, and dark by
 * choice — the same three states as globals.css. `selector` is
 * `:root[data-club]` for the app (the attribute is set only on the app's own
 * screens) or `[data-club-scope]` for a club's public page.
 */
export function clubThemeCss(primary: string | null | undefined, secondary: string | null | undefined, selector = ':root[data-club]'): string {
  const light = clubTheme(primary, secondary, 'light')
  const dark = clubTheme(primary, secondary, 'dark')
  if (!light || !dark) return ''
  const decl = (v: Record<string, string>) => Object.entries(v).map(([k, x]) => `${k}:${x}`).join(';')
  const onRoot = selector.startsWith(':root')
  const darkByPhone = onRoot ? `${selector}:not([data-theme="light"])` : `:root:not([data-theme="light"]) ${selector}`
  const darkByChoice = onRoot ? `:root[data-theme="dark"]${selector.slice(':root'.length)}` : `:root[data-theme="dark"] ${selector}`
  return `${selector}{${decl(light)}}@media (prefers-color-scheme: dark){${darkByPhone}{${decl(dark)}}}${darkByChoice}{${decl(dark)}}`
}

/**
 * What the owner is told when a colour had to be adjusted to be readable —
 * in words, with the shade that is used instead. Empty when nothing moved.
 */
export function clubThemeNotes(primary: string | null | undefined, secondary: string | null | undefined): string[] {
  const p = normaliseHex(primary)
  if (!p) return []
  const notes: string[] = []
  for (const mode of ['light', 'dark'] as const) {
    const g = GROUNDS[mode]
    const grounds = [g.paper, g.surface]
    const brand = reach(p, grounds, 3, mode)
    const text = reach(p, grounds, 4.5, mode)
    if (brand.adjusted || text.adjusted) {
      notes.push(
        mode === 'light'
          ? `${p} is too pale to read on a white screen, so buttons and links use a deeper ${text.adjusted ? text.colour : brand.colour} in light mode. Your header stays ${p}.`
          : `${p} is too dark to read in dark mode, so buttons and links use a lighter ${text.adjusted ? text.colour : brand.colour} there. Your header stays ${p}.`
      )
    }
    const s = normaliseHex(secondary)
    if (s) {
      const hl = reach(s, grounds, 3, mode)
      if (hl.adjusted) notes.push(`Your second colour, ${s}, shows as ${hl.colour} for highlights in ${mode} mode so it can be seen.`)
    }
  }
  return notes
}
