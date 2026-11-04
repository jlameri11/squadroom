'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getOrg } from '@/lib/org'
import { prepareImage } from '@/lib/adapters/images'
import { ScreenSkeleton } from '@/components/screen-skeleton'

type Sponsor = { id: string; name: string; url: string | null; logo_url: string | null; tagline: string | null; slots: string[]; active: boolean; sort: number; views: number }
const SLOTS: [string, string][] = [['match_centre', 'Public match centre'], ['cards', 'Share cards']]

/**
 * X-08: the club's sponsors, sold by the club, shown where the club says.
 * Squadroom takes nothing. The strip on the public match centre and the
 * "with thanks to" line on the cards read this list; the daily view count
 * is what the club shows the sponsor at renewal.
 */
export function SponsorsScreen() {
  const [academyId, setAcademyId] = useState<string | null>(null)
  const [rows, setRows] = useState<Sponsor[] | null>(null)
  const [draft, setDraft] = useState<{ name: string; url: string; tagline: string; slots: string[] } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (org: string) => {
    const supabase = createClient()
    const [{ data: s }, { data: v }] = await Promise.all([
      supabase.from('academy_sponsors').select('id, name, url, logo_url, tagline, slots, active, sort').eq('academy_id', org).order('sort').order('name'),
      supabase.from('sponsor_impressions').select('sponsor_id, views').gte('day', new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)),
    ])
    const views: Record<string, number> = {}
    for (const r of v ?? []) views[r.sponsor_id] = (views[r.sponsor_id] ?? 0) + r.views
    setRows((s ?? []).map((x) => ({ ...x, views: views[x.id] ?? 0 })))
  }, [])

  useEffect(() => {
    ;(async () => {
      const supabase = createClient()
      let org = getOrg()
      if (!org) {
        const { data: m } = await supabase.from('academy_members').select('academy_id').eq('status', 'active').limit(1).maybeSingle()
        org = m?.academy_id ?? null
      }
      if (!org) return setError('You are not in a club yet.')
      setAcademyId(org)
      await load(org)
    })()
  }, [load])

  if (!academyId) return error ? <p className="p-6 text-center text-sm text-ink-2">{error}</p> : <ScreenSkeleton />

  async function run(label: string, fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(label)
    setError(null)
    const { error } = await fn()
    setBusy(null)
    if (error) return setError(error.message)
    await load(academyId as string)
  }
  const supabase = createClient()
  const add = () => draft && run('add', () => supabase.from('academy_sponsors').insert({ academy_id: academyId as string, name: draft.name.trim(), url: draft.url.trim() || null, tagline: draft.tagline.trim() || null, slots: draft.slots, sort: (rows?.length ?? 0) + 1 })).then(() => setDraft(null))
  const toggle = (s: Sponsor) => run(s.id, () => supabase.from('academy_sponsors').update({ active: !s.active }).eq('id', s.id))
  const setSlots = (s: Sponsor, slots: string[]) => run(s.id, () => supabase.from('academy_sponsors').update({ slots }).eq('id', s.id))
  const remove = (s: Sponsor) => run(s.id, () => supabase.from('academy_sponsors').delete().eq('id', s.id))
  async function logo(s: Sponsor, file: File) {
    setBusy(s.id)
    setError(null)
    try {
      const prepared = await prepareImage(file)
      const path = `${academyId}/${s.id}-${crypto.randomUUID().slice(0, 8)}.${prepared.mime === 'image/png' ? 'png' : prepared.mime === 'image/webp' ? 'webp' : 'jpg'}`
      const { error: up } = await supabase.storage.from('sponsor-logos').upload(path, prepared.blob, { contentType: prepared.mime, upsert: true })
      if (up) throw up
      const url = supabase.storage.from('sponsor-logos').getPublicUrl(path).data.publicUrl
      const { error } = await supabase.from('academy_sponsors').update({ logo_url: url }).eq('id', s.id)
      if (error) throw error
      await load(academyId as string)
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(null)
  }

  const line = { borderColor: 'var(--line)' }
  const input = 'mt-0.5 w-full rounded-lg border px-2 py-1.5 text-sm'
  return (
    <div className="p-3.5" data-sponsors>
      <section className="card p-3.5">
        <h2 className="eyebrow pb-1.5">Your sponsors</h2>
        <p className="text-sm text-ink-2">Sold by you, shown where you say: a strip on the public match centre and a &quot;with thanks to&quot; line on your share cards. Squadroom takes nothing.</p>
        {rows && rows.length === 0 && <p className="mt-3 text-sm text-ink-3">No sponsors yet.</p>}
        <div className="stack mt-3">
          {(rows ?? []).map((s) => (
            <article key={s.id} className="rounded-xl border p-3" style={{ ...line, opacity: s.active ? 1 : 0.6 }} data-sponsor={s.id}>
              <div className="flex items-center gap-3">
                <label className="grid h-12 w-12 flex-none cursor-pointer place-items-center overflow-hidden rounded-lg text-[0.625rem] text-ink-3" style={{ background: 'var(--surface-2)' }} title="Logo">
                  {s.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.logo_url} alt="" className="h-full w-full object-contain" />
                  ) : 'logo'}
                  <input type="file" accept="image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void logo(s, f); e.target.value = '' }} />
                </label>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{s.name}</p>
                  <p className="truncate text-xs text-ink-3">{s.tagline ?? s.url ?? '—'}</p>
                </div>
                <span className="pill flex-none" title="Views on the public match centre, last 30 days">{s.views} views</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                {SLOTS.map(([k, label]) => (
                  <label key={k} className="flex items-center gap-1.5 text-ink-2">
                    <input type="checkbox" checked={s.slots.includes(k)} disabled={busy !== null} onChange={(e) => setSlots(s, e.target.checked ? [...s.slots, k] : s.slots.filter((x) => x !== k))} />
                    {label}
                  </label>
                ))}
                <button onClick={() => toggle(s)} disabled={busy !== null} className="tap ml-auto underline underline-offset-2" style={{ color: 'var(--brand-text)' }}>{s.active ? 'Pause' : 'Resume'}</button>
                <button onClick={() => remove(s)} disabled={busy !== null} className="tap text-ink-3 underline underline-offset-2">Remove</button>
              </div>
            </article>
          ))}
        </div>
        {draft ? (
          <div className="mt-3 flex flex-col gap-2">
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Ryde Physio" className={input} style={line} aria-label="Sponsor name" data-sponsor-name />
            <input value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} placeholder="https://" inputMode="url" className={input} style={line} aria-label="Sponsor link" />
            <input value={draft.tagline} onChange={(e) => setDraft({ ...draft, tagline: e.target.value })} placeholder="A line for the strip (optional)" className={input} style={line} aria-label="Tagline" />
            <div className="flex gap-2">
              <button onClick={add} disabled={busy !== null || !draft.name.trim()} className="flex-1 rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }} data-sponsor-add>Add the sponsor</button>
              <button onClick={() => setDraft(null)} className="rounded-lg border px-3 py-2 text-sm" style={line}>Cancel</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setDraft({ name: '', url: '', tagline: '', slots: ['match_centre', 'cards'] })} className="mt-3 w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-white" style={{ background: 'var(--brand)' }} data-sponsor-new>
            Add a sponsor
          </button>
        )}
        {error && <p className="mt-2 text-xs" style={{ color: 'var(--no)' }}>{error}</p>}
        <p className="mt-2 text-[0.6875rem] text-ink-3">Tap a logo box to upload the logo (1 MB, PNG/JPG/SVG). It is public, like the match centre.</p>
      </section>
    </div>
  )
}
