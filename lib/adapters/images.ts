/**
 * Downsizing before upload.
 *
 * A modern phone photo is 3-5 MB and about 4000px wide. Nobody needs that to
 * see whether their kid scored, and at a few hundred academies it is the
 * single biggest storage cost in the product. This runs on the phone, so the
 * bytes are never sent at all.
 *
 * Behind an adapter because Capacitor's camera returns a native path rather
 * than a File, and only this file should have to care.
 */

const MAX_EDGE = 1600
const QUALITY = 0.82

export type PreparedImage = {
  blob: Blob
  width: number
  height: number
  mime: string
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  // Anything we cannot decode (HEIC on some browsers, PDFs) goes up as-is
  // rather than being silently mangled.
  if (!file.type.startsWith('image/') || file.type === 'image/gif') {
    return { blob: file, width: 0, height: 0, mime: file.type }
  }

  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) return { blob: file, width: 0, height: 0, mime: file.type }

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return { blob: file, width: bitmap.width, height: bitmap.height, mime: file.type }

  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', QUALITY)
  )

  // Re-encoding is not always a win — a small screenshot can come out bigger.
  if (!blob || blob.size >= file.size) {
    return { blob: file, width, height, mime: file.type }
  }
  return { blob, width, height, mime: 'image/jpeg' }
}

export type Attachment = {
  path: string
  mime: string
  size: number
  width: number
  height: number
  name: string
}
