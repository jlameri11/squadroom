/**
 * A voice note, recorded on the phone.
 *
 * MediaRecorder is what every current browser offers, but they disagree on
 * the container: Safari records AAC in an MP4, Chrome and Firefox record
 * Opus in WebM. We take whichever the browser says it can produce and label
 * the upload honestly; the bucket accepts both and <audio> plays both.
 *
 * Behind an adapter for the same reason as images.ts: Capacitor will hand
 * us a native file instead, and only this file should have to care.
 */

export const MAX_VOICE_SECONDS = 60

export type VoiceNote = { blob: Blob; mime: string; duration: number }

export function canRecord(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia
  )
}

function pickMime(): string {
  const options = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
  return options.find((m) => MediaRecorder.isTypeSupported(m)) ?? ''
}

export type Recording = {
  /** Stops the microphone and resolves with the note; null if nothing was captured. */
  stop: () => Promise<VoiceNote | null>
  /** Stops the microphone and throws the recording away. */
  cancel: () => void
}

export async function startRecording(onTick?: (seconds: number) => void): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const mime = pickMime()
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
  const chunks: Blob[] = []
  const started = Date.now()
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
  recorder.start(250)

  const timer = onTick ? window.setInterval(() => onTick((Date.now() - started) / 1000), 250) : 0
  const release = () => {
    if (timer) window.clearInterval(timer)
    stream.getTracks().forEach((t) => t.stop())
  }

  return {
    stop: () =>
      new Promise<VoiceNote | null>((resolve) => {
        recorder.onstop = () => {
          release()
          const duration = Math.round((Date.now() - started) / 10) / 100
          if (chunks.length === 0) return resolve(null)
          // The recorder's own type carries the codec suffix; the bucket
          // wants the bare container.
          const type = (recorder.mimeType || mime || 'audio/webm').split(';')[0]
          resolve({ blob: new Blob(chunks, { type }), mime: type, duration })
        }
        if (recorder.state !== 'inactive') recorder.stop()
        else { release(); resolve(null) }
      }),
    cancel: () => {
      recorder.onstop = null
      if (recorder.state !== 'inactive') recorder.stop()
      release()
    },
  }
}

export function formatDuration(seconds: number | undefined | null): string {
  const s = Math.max(0, Math.round(seconds ?? 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
