// Run: node scripts/simulation/fixtures.mjs
//
// The files the simulation's files scenarios push through the real storage
// (Joey, 16 Nov 2026): a photo as a PNG and a JPEG, the same photo as an
// iPhone HEIC (made with macOS's sips; skipped elsewhere), a one-page PDF,
// and a "photo" of 26 MB that the composer must refuse before a byte goes
// up. Written to .cache/fixtures/ (never committed). season.mjs calls this
// before the season; it is safe to run again.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import zlib from 'node:zlib'

const DIR = join(process.cwd(), '.cache', 'fixtures')
mkdirSync(DIR, { recursive: true })

/** A real PNG: an RGB gradient, filter 0 on every row, one IDAT. */
function png(w = 320, h = 240) {
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3
      raw[o] = Math.floor((x * 255) / w)
      raw[o + 1] = Math.floor((y * 255) / h)
      raw[o + 2] = 128
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

/** A minimal, valid PDF: one page, one line. */
function pdf(line = 'SPL Season 4 - Round 6 draw') {
  const content = Buffer.from(`BT /F1 24 Tf 72 720 Td (${line}) Tj ET`)
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let out = '%PDF-1.4\n'
  const offs = []
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xref = Buffer.byteLength(out)
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out)
}

const pngPath = join(DIR, 'photo.png')
writeFileSync(pngPath, png())
writeFileSync(join(DIR, 'draw.pdf'), pdf())
let jpg = false, heic = false
try {
  execFileSync('sips', ['-s', 'format', 'jpeg', pngPath, '--out', join(DIR, 'photo.jpg')], { stdio: 'ignore' })
  jpg = true
  execFileSync('sips', ['-s', 'format', 'heic', pngPath, '--out', join(DIR, 'photo.heic')], { stdio: 'ignore' })
  heic = true
} catch {
  // Not a Mac: the JPEG and HEIC cases are skipped by the scenarios when the files are missing.
}
if (jpg) {
  // A real JPEG header, then 26 MB of nothing: the composer's size check runs before any decoding.
  const head = readFileSync(join(DIR, 'photo.jpg'))
  writeFileSync(join(DIR, 'big.jpg'), Buffer.concat([head, Buffer.alloc(26 * 1024 * 1024)]))
}
console.log(`  fixtures in ${DIR}: photo.png, draw.pdf${jpg ? ', photo.jpg, big.jpg' : ''}${heic ? ', photo.heic' : ''}${existsSync(join(DIR, 'photo.heic')) ? '' : ' (no HEIC on this machine)'}`)
