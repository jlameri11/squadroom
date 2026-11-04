// Run: node scripts/brand-icons.mjs
//
// Every icon the app ships, rendered from Joey's brand kit (brand/, 4 Nov
// 2026) so a change to the brand is one command, not an afternoon in an
// image editor:
//
//   app/favicon.ico            16, 32 and 48 px, PNG inside an ICO
//   app/apple-icon.png         180 px — iOS "Add to Home Screen"
//   public/icon-192.png        PWA icon; also the push notification's icon
//   public/icon-512.png        PWA icon
//   public/icon-maskable-512.png  the artwork at 80% on the brand's black,
//                              so a launcher's circle or squircle mask never
//                              clips the letters
//   public/badge.png           Android's notification badge: the white SR
//                              letters on transparent (Android draws only the
//                              alpha)
//   public/brand/*.svg         the icon and logo the pages use
//
// All from squadroom-app-store-icon-white.svg (full-bleed, no border — the
// OS rounds the corners), as brand/README.md says.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

const ROOT = new URL('..', import.meta.url).pathname
const BRAND = join(ROOT, 'brand')
const BLACK = '#101012'
const src = readFileSync(join(BRAND, 'squadroom-app-store-icon-white.svg'))

const png = (size, input = src) => sharp(input, { density: Math.max(72, Math.ceil((72 * size) / 100)) }).resize(size, size).png({ compressionLevel: 9 }).toBuffer()

async function ico(sizes) {
  const images = await Promise.all(sizes.map((s) => png(s)))
  const header = Buffer.alloc(6 + 16 * sizes.length)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(sizes.length, 4)
  let offset = header.length
  sizes.forEach((s, i) => {
    const e = 6 + 16 * i
    header.writeUInt8(s >= 256 ? 0 : s, e)
    header.writeUInt8(s >= 256 ? 0 : s, e + 1)
    header.writeUInt8(0, e + 2) // palette
    header.writeUInt8(0, e + 3) // reserved
    header.writeUInt16LE(1, e + 4) // planes
    header.writeUInt16LE(32, e + 6) // bits per pixel
    header.writeUInt32LE(images[i].length, e + 8)
    header.writeUInt32LE(offset, e + 12)
    offset += images[i].length
  })
  return Buffer.concat([header, ...images])
}

const out = []
const save = (rel, buf) => { writeFileSync(join(ROOT, rel), buf); out.push(`${rel} (${buf.length} bytes)`) }

save('app/favicon.ico', await ico([16, 32, 48]))
save('app/apple-icon.png', await png(180))
save('public/icon-192.png', await png(192))
save('public/icon-512.png', await png(512))

// Maskable: the full icon at 80%, centred on the brand's black.
const inner = await png(410)
save('public/icon-maskable-512.png', await sharp({ create: { width: 512, height: 512, channels: 4, background: BLACK } }).composite([{ input: inner, gravity: 'center' }]).png({ compressionLevel: 9 }).toBuffer())

// The badge: the same letters with the black square taken out.
const letters = Buffer.from(src.toString('utf8').replace(/<rect width="100" height="100" fill="#101012"\s*\/>/, ''))
if (letters.equals(src)) throw new Error('the background square was not found in the app-store icon; badge.png would be a white square')
save('public/badge.png', await png(96, letters))

mkdirSync(join(ROOT, 'public/brand'), { recursive: true })
for (const f of ['squadroom-icon-white.svg', 'squadroom-icon-white-small.svg', 'squadroom-logo-white.svg']) {
  copyFileSync(join(BRAND, f), join(ROOT, 'public/brand', f))
  out.push(`public/brand/${f}`)
}
console.log(out.map((o) => `  ${o}`).join('\n'))
