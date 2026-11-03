'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Video = { id: string; kind: 'link' | 'upload'; url: string | null; path: string | null; title: string | null; at: string; by: string | null }
type Data = { can_add: boolean; played: boolean; videos: Video[] }
const MAX_UPLOAD = 50 * 1024 * 1024

/**
 * The game video (Matchdays). A link or an upload, added by the coach; the
 * squad's people watch it here. An upload is served by a short signed link
 * minted for this person, so nothing about it is public.
 */
export function MatchVideo({ eventId }: { eventId: string }) {
  const [d, setD] = useState<Data | null | undefined>(undefined)
  const [signed, setSigned] = useState<Record<string, string>>({})
  const [link, setLink] = useState('')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data, error } = await supabase.rpc('matchday_videos', { p_event: eventId })
    const next = error ? null : (data as unknown as Data)
    setD(next)
    if (!next) return
    const urls: Record<string, string> = {}
    for (const v of next.videos) {
      if (v.kind === 'upload' && v.path) {
        const { data: s } = await supabase.storage.from('match-videos').createSignedUrl(v.path, 3600)
        if (s?.signedUrl) urls[v.id] = s.signedUrl
      }
    }
    setSigned(urls)
  }, [eventId])

  useEffect(() => {
    ;(async () => {
      await load()
    })()
  }, [load])

  if (!d || !d.played) return null
  if (!d.can_add && d.videos.length === 0) return null

  async function addLink() {
    setBusy('link')
    setError(null)
    const { error } = await createClient().rpc('add_match_video', { p_event: eventId, p_kind: 'link', p_url: link.trim(), p_title: title.trim() || undefined })
    setBusy(null)
    if (error) return setError(error.message)
    setLink('')
    setTitle('')
    setAdding(false)
    await load()
  }
  async function upload(file: File) {
    if (file.size > MAX_UPLOAD) return setError('That file is over 50 MB. Paste a link instead (Veo, YouTube unlisted, Google Drive).')
    setBusy('upload')
    setError(null)
    setProgress('Uploading…')
    const supabase = createClient()
    const { data: ev } = await supabase.from('events').select('academy_id').eq('id', eventId).single()
    const ext = (file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '')
    const path = `${ev?.academy_id}/${eventId}/${crypto.randomUUID()}.${ext}`
    const { error: up } = await supabase.storage.from('match-videos').upload(path, file, { contentType: file.type || 'video/mp4', upsert: false })
    if (up) {
      setBusy(null)
      setProgress(null)
      return setError(up.message)
    }
    const { error } = await supabase.rpc('add_match_video', { p_event: eventId, p_kind: 'upload', p_path: path, p_title: title.trim() || file.name })
    setBusy(null)
    setProgress(null)
    if (error) return setError(error.message)
    setTitle('')
    setAdding(false)
    await load()
  }
  async function remove(id: string) {
    setBusy(id)
    const { error } = await createClient().rpc('remove_match_video', { p_video: id })
    setBusy(null)
    if (error) return setError(error.message)
    await load()
  }

  const line = { borderColor: 'var(--line)' }
  return (
    <section className="mt-4" data-match-video>
      <div className="sect">
        <span className="eyebrow">Game video</span>
        {d.can_add && !adding && (
          <button onClick={() => setAdding(true)} className="text-xs" style={{ color: 'var(--brand-text)' }} data-video-add>
            {d.videos.length ? 'Add another' : 'Add the video'}
          </button>
        )}
      </div>
      <div className="card p-3">
        {d.videos.length === 0 && !adding && <p className="text-sm text-ink-3">No video yet.</p>}
        {d.videos.map((v) => (
          <div key={v.id} className="mb-3 last:mb-0" data-video={v.id} data-kind={v.kind}>
            {v.kind === 'upload' ? (
              signed[v.id] ? (
                <video controls playsInline preload="metadata" src={signed[v.id]} className="w-full rounded-lg bg-black" style={{ maxHeight: 260 }} />
              ) : (
                <p className="text-sm text-ink-3">Loading the video…</p>
              )
            ) : (
              <a href={v.url ?? '#'} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 rounded-lg border p-2.5" style={line}>
                <span className="grid h-10 w-10 flex-none place-items-center rounded-lg text-white" style={{ background: 'var(--brand)' }} aria-hidden>▶</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{v.title ?? 'Watch the game'}</span>
                  <span className="block truncate text-xs text-ink-3">{v.url}</span>
                </span>
              </a>
            )}
            <p className="mt-1 flex items-center gap-2 text-[11px] text-ink-3">
              {v.title && v.kind === 'upload' && <span className="truncate">{v.title} · </span>}
              {v.kind === 'upload' ? 'Uploaded — only this squad can see it' : 'A link — follows that service’s privacy settings'}
              {v.by && ` · ${v.by}`}
              {d.can_add && <button onClick={() => remove(v.id)} disabled={busy !== null} className="ml-auto underline underline-offset-2" data-video-remove>Remove</button>}
            </p>
          </div>
        ))}

        {d.can_add && adding && (
          <div className="mt-2 border-t pt-3" style={{ borderColor: 'var(--line-2)' }} data-video-form>
            <label className="block text-xs text-ink-2">
              Paste a link (Veo, YouTube unlisted, Google Drive…)
              <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" inputMode="url" className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-sm" style={line} data-video-link />
            </label>
            <label className="mt-2 block text-xs text-ink-2">
              Title (optional)
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Full game · first half" className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-sm" style={line} />
            </label>
            <div className="mt-2 flex gap-2">
              <button onClick={addLink} disabled={busy !== null || !/^https?:\/\/\S+$/i.test(link.trim())} className="flex-1 rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }} data-video-save-link>
                {busy === 'link' ? '…' : 'Add the link'}
              </button>
              <label className="flex-1 cursor-pointer rounded-lg border px-3 py-2 text-center text-sm font-semibold" style={line}>
                {progress ?? 'Upload a file'}
                <input type="file" accept="video/mp4,video/quicktime,video/webm" className="sr-only" disabled={busy !== null} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = '' }} data-video-file />
              </label>
              <button onClick={() => setAdding(false)} className="rounded-lg border px-3 py-2 text-sm" style={line}>Cancel</button>
            </div>
            <p className="mt-2 text-[11px] text-ink-3" data-video-privacy>
              <b>Privacy:</b> a Veo, YouTube or Drive link follows that service&apos;s own settings and can be forwarded by anyone who has it. An upload stays private to this squad (up to 50 MB). Either way, the squad&apos;s families get one push: &quot;video is up&quot;.
            </p>
          </div>
        )}
        {error && <p className="mt-2 text-xs" style={{ color: 'var(--no)' }}>{error}</p>}
      </div>
    </section>
  )
}
