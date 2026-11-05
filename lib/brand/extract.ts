/**
 * The colours in a club's logo, suggested back to its owner (Joey, 4 Nov
 * 2026: "on upload, suggest primary + secondary colours picked from the
 * logo; owner can accept or change them").
 *
 * In the browser, from the file itself — nothing is sent anywhere to be
 * looked at. The logo is drawn small onto a canvas and its pixels counted in
 * coarse buckets; the paper behind a logo (white, or transparent) is not a
 * colour the club chose, so it is left out. The most-used colour that is not
 * grey is the first suggestion; the most-used one clearly different from it
 * is the second. A logo in one colour suggests one.
 */

export type Suggestion = { primary: string; secondary: string | null }

const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')

/** Pick the club's colours out of RGBA pixel data (also used by the tests). */
export function suggestFromPixels(data: Uint8ClampedArray | number[]): Suggestion | null {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>()
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]]
    if (a < 160) continue
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    // The paper: near-white with no colour in it.
    if (min > 232 && max - min < 18) continue
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const k = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 }
    k.n++
    k.r += r
    k.g += g
    k.b += b
    buckets.set(key, k)
  }
  const total = [...buckets.values()].reduce((s, k) => s + k.n, 0)
  if (total === 0) return null
  const colours = [...buckets.values()]
    .map((k) => {
      const [r, g, b] = [k.r / k.n, k.g / k.n, k.b / k.n]
      const max = Math.max(r, g, b) / 255
      const min = Math.min(r, g, b) / 255
      const sat = max === 0 ? 0 : (max - min) / max
      return { r, g, b, n: k.n, sat, hex: hex(r, g, b) }
    })
    // A real colour beats a big grey; a big black still counts (black clubs exist).
    .map((c) => ({ ...c, score: c.n * (0.35 + c.sat) }))
    .sort((a, b) => b.score - a.score)
  const first = colours[0]
  const far = (c: typeof first) => Math.hypot(c.r - first.r, c.g - first.g, c.b - first.b) / 255 > 0.35
  // A second colour has to be more than a speck: 3% of the inked area.
  const second = colours.find((c) => c !== first && far(c) && c.n / total > 0.03) ?? null
  return { primary: first.hex, secondary: second?.hex ?? null }
}

/** Load an image file or URL and suggest its colours. Null if it cannot be read. */
export async function suggestFromImage(src: Blob | string): Promise<Suggestion | null> {
  const url = typeof src === 'string' ? src : URL.createObjectURL(src)
  try {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = url
    await img.decode()
    // An SVG without a width reports 0; draw it at the canvas size instead.
    const w0 = img.naturalWidth || 96
    const h0 = img.naturalHeight || 96
    const scale = Math.min(1, 96 / Math.max(w0, h0))
    const w = Math.max(1, Math.round(w0 * scale))
    const h = Math.max(1, Math.round(h0 * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, w, h)
    return suggestFromPixels(ctx.getImageData(0, 0, w, h).data)
  } catch {
    return null
  } finally {
    if (typeof src !== 'string') URL.revokeObjectURL(url)
  }
}
