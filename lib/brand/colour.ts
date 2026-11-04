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
