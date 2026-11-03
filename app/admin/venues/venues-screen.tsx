'use client'

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getOrg } from '@/lib/org'
import { ScreenSkeleton } from '@/components/screen-skeleton'
import { GroundSvg, type Layout, type LayoutPitch } from '@/app/calendar/[eventId]/pitch-map'

type VenueRow = { id: string; name: string; address: string | null; pitches: number }
type Hours = { weekday: number; opens: string; closes: string }
type Rule = { age_group: string; size: string; is_default: boolean }

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const SIZES: [string, string][] = [['full', 'Full pitch'], ['half', 'Half'], ['third', 'Third'], ['quarter', 'Quarter']]

/**
 * L-29: venues and pitches, drawn.
 *
 * A list of the club's (or league's) grounds; one open at a time with its
 * details, its layout and its hours. The layout is an SVG the owner draws
 * on with a finger: add a full pitch, cut it into halves, thirds or
 * quarters, drag it where it is, name it. Nudge arrows do the same for
 * anyone who cannot drag. Every change is a function call the database
 * checks; this screen only draws what venue_layout says.
 */
export function VenuesScreen() {
  const [academyId, setAcademyId] = useState<string | null>(null)
  const [venues, setVenues] = useState<VenueRow[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [layout, setLayout] = useState<Layout | null>(null)
  const [pitches, setPitches] = useState<LayoutPitch[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [details, setDetails] = useState({ name: '', address: '', lat: '', lng: '', notes: '', parking: '', toilets: '', canteen: '' })
  const [newVenue, setNewVenue] = useState<{ name: string; address: string } | null>(null)
  // The hours being edited for the selected pitch; null = as saved.
  const [hoursDraft, setHoursDraft] = useState<{ id: string; hours: Hours[] } | null>(null)
  const [rules, setRules] = useState<Rule[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const svgBox = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: string; startX: number; startY: number; px: number; py: number; moved: boolean } | null>(null)

  const loadVenues = useCallback(async (org: string) => {
    const supabase = createClient()
    const [{ data: v }, { data: p }] = await Promise.all([
      supabase.from('venues').select('id, name, address').eq('academy_id', org).order('name'),
      supabase.from('pitches').select('venue_id').eq('academy_id', org),
    ])
    const counts: Record<string, number> = {}
    for (const row of p ?? []) counts[row.venue_id] = (counts[row.venue_id] ?? 0) + 1
    setVenues((v ?? []).map((x) => ({ id: x.id, name: x.name, address: x.address, pitches: counts[x.id] ?? 0 })))
  }, [])

  const loadLayout = useCallback(async (id: string) => {
    const { data, error } = await createClient().rpc('venue_layout', { p_venue: id })
    if (error) return setError(error.message)
    const l = data as unknown as Layout
    setLayout(l)
    setPitches(l.pitches)
    setDetails({
      name: l.name, address: l.address ?? '', lat: l.lat == null ? '' : String(l.lat), lng: l.lng == null ? '' : String(l.lng), notes: l.notes ?? '',
      parking: l.amenities?.parking ?? '', toilets: l.amenities?.toilets ?? '', canteen: l.amenities?.canteen ?? '',
    })
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
      await loadVenues(org)
      const { data: r } = await supabase.rpc('pitch_size_rules_for', { p_academy: org })
      setRules((r as unknown as Rule[]) ?? [])
    })()
  }, [loadVenues])

  useEffect(() => {
    if (!openId) return
    ;(async () => {
      await loadLayout(openId)
    })()
  }, [openId, loadLayout])

  if (!academyId) return error ? <p className="p-6 text-center text-sm text-ink-2">{error}</p> : <ScreenSkeleton />

  const sel = pitches.find((p) => p.id === selected) ?? null
  const hours: Hours[] = hoursDraft && hoursDraft.id === selected ? hoursDraft.hours : sel?.hours ?? []
  const editHours = (fn: (all: Hours[]) => Hours[]) => { if (selected) setHoursDraft({ id: selected, hours: fn(hours) }) }

  async function run(label: string, fn: () => PromiseLike<{ error: { message: string } | null }>, reload = true) {
    setBusy(label)
    setError(null)
    setSaved(null)
    const { error } = await fn()
    setBusy(null)
    if (error) return setError(error.message)
    if (reload && openId) await loadLayout(openId)
    if (academyId) await loadVenues(academyId)
  }
  const supabase = createClient()

  // ---- venues
  async function addVenue() {
    if (!newVenue?.name.trim() || !academyId) return
    setBusy('venue')
    const { data, error } = await supabase.from('venues').insert({ academy_id: academyId, name: newVenue.name.trim(), address: newVenue.address.trim() || null }).select('id').single()
    setBusy(null)
    if (error) return setError(error.message)
    setNewVenue(null)
    await loadVenues(academyId)
    setOpenId(data.id)
  }
  const saveDetails = () =>
    run('details', () =>
      supabase.from('venues').update({
        name: details.name.trim(), address: details.address.trim() || null,
        lat: details.lat ? Number(details.lat) : null, lng: details.lng ? Number(details.lng) : null,
        notes: details.notes.trim() || null,
        amenities: { parking: details.parking.trim() || undefined, toilets: details.toilets.trim() || undefined, canteen: details.canteen.trim() || undefined },
        updated_at: new Date().toISOString(),
      }).eq('id', openId as string)
    ).then(() => setSaved('Venue saved.'))
  const removeVenue = () => run('remove-venue', () => supabase.from('venues').delete().eq('id', openId as string), false).then(() => { setOpenId(null); setLayout(null) })

  // ---- pitches
  const addPitch = () => run('add', () => supabase.rpc('add_pitch', { p_venue: openId as string }))
  const split = (into: number) => run('split', () => supabase.rpc('split_pitch', { p_pitch: selected as string, p_into: into }))
  const unsplit = () => run('unsplit', () => supabase.from('pitches').delete().eq('parent_id', selected as string))
  const removePitch = () => run('remove', () => supabase.from('pitches').delete().eq('id', selected as string)).then(() => setSelected(null))
  const rename = (name: string) => run('rename', () => supabase.from('pitches').update({ name: name.trim() }).eq('id', selected as string))
  const nudge = (dx: number, dy: number) => {
    const p = pitches.find((x) => x.id === selected)
    if (!p) return
    return run('move', () => supabase.rpc('move_pitch', { p_pitch: p.id, p_x: Number(p.x) + dx, p_y: Number(p.y) + dy }))
  }
  const saveHours = () => run('hours', () => supabase.rpc('set_pitch_hours', { p_pitch: selected as string, p_hours: hours as never })).then(() => { setHoursDraft(null); setSaved('Hours saved.') })
  const saveRules = () =>
    run('rules', () => supabase.rpc('set_pitch_size_rules', { p_academy: academyId as string, p_rules: Object.fromEntries((rules ?? []).map((r) => [r.age_group, r.size])) as never }), false)
      .then(async () => { const { data: r } = await supabase.rpc('pitch_size_rules_for', { p_academy: academyId as string }); setRules((r as unknown as Rule[]) ?? []); setSaved('Sizes saved.') })

  // ---- dragging on the SVG: a finger (or a mouse) moves a pitch; a tap selects it.
  function unitsPerPx() {
    const box = svgBox.current?.getBoundingClientRect()
    if (!box) return 1
    return 100 / Math.min(box.width, box.height)
  }
  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    const el = (e.target as Element).closest?.('[data-pitch]') as Element | null
    if (!el) return
    const id = el.getAttribute('data-pitch') as string
    const p = pitches.find((x) => x.id === id)
    if (!p) return
    setSelected(id)
    drag.current = { id, startX: e.clientX, startY: e.clientY, px: Number(p.x), py: Number(p.y), moved: false }
    ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current
    if (!d || !layout?.can_edit) return
    const k = unitsPerPx()
    const dx = (e.clientX - d.startX) * k
    const dy = (e.clientY - d.startY) * k
    if (!d.moved && Math.abs(dx) < 1 && Math.abs(dy) < 1) return
    d.moved = true
    const p = pitches.find((x) => x.id === d.id)
    if (!p) return
    const nx = Math.max(0, Math.min(100 - Number(p.w), d.px + dx))
    const ny = Math.max(0, Math.min(100 - Number(p.h), d.py + dy))
    const sx = nx - Number(p.x), sy = ny - Number(p.y)
    setPitches((all) => all.map((x) => (x.id === d.id || x.parent_id === d.id ? { ...x, x: Number(x.x) + sx, y: Number(x.y) + sy } : x)))
  }
  async function onPointerUp() {
    const d = drag.current
    drag.current = null
    if (!d || !d.moved) return
    const p = pitches.find((x) => x.id === d.id)
    if (!p) return
    await run('move', () => supabase.rpc('move_pitch', { p_pitch: p.id, p_x: Number(p.x), p_y: Number(p.y) }))
  }

  const input = 'mt-0.5 w-full rounded-lg border px-2 py-1.5 text-sm'
  const line = { borderColor: 'var(--line)' }

  return (
    <div className="p-3.5" data-venues>
      {!openId && (
        <>
          <section className="card p-3.5">
            <h2 className="eyebrow pb-1.5">Grounds</h2>
            {venues === null ? (
              <p className="text-sm text-ink-3">Loading…</p>
            ) : venues.length === 0 ? (
              <p className="text-sm text-ink-2">No grounds yet. Add the one you play at, then draw its pitches.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {venues.map((v) => (
                  <li key={v.id}>
                    <button onClick={() => { setOpenId(v.id); setSelected(null); setSaved(null) }} className="flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left" style={line} data-venue={v.id}>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{v.name}</span>
                        <span className="block truncate text-xs text-ink-3">{v.address ?? 'No address yet'}</span>
                      </span>
                      <span className="pill">{v.pitches} {v.pitches === 1 ? 'pitch' : 'pitches'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {newVenue ? (
              <div className="mt-3 flex flex-col gap-1.5">
                <input value={newVenue.name} onChange={(e) => setNewVenue({ ...newVenue, name: e.target.value })} placeholder="ELS Hall Park" className={input} style={line} aria-label="Venue name" />
                <input value={newVenue.address} onChange={(e) => setNewVenue({ ...newVenue, address: e.target.value })} placeholder="14 Kent Rd, North Ryde NSW 2113" className={input} style={line} aria-label="Address" />
                <div className="flex gap-2">
                  <button onClick={addVenue} disabled={busy !== null || !newVenue.name.trim()} className="flex-1 rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }} data-venue-add>
                    {busy === 'venue' ? '…' : 'Add the ground'}
                  </button>
                  <button onClick={() => setNewVenue(null)} className="rounded-lg border px-3 py-2 text-sm" style={line}>Cancel</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setNewVenue({ name: '', address: '' })} className="mt-3 w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-white" style={{ background: 'var(--brand)' }} data-venue-new>
                Add a ground
              </button>
            )}
            {error && <p className="mt-2 text-xs" style={{ color: 'var(--no)' }}>{error}</p>}
          </section>

          <section className="card mt-4 p-3.5" data-size-rules>
            <h2 className="eyebrow pb-1.5">Which pitch each age group plays on</h2>
            <p className="text-xs text-ink-3">The draw builder uses these; a division can override its own in its settings.</p>
            {rules && (
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
                {rules.map((r) => (
                  <label key={r.age_group} className="flex items-center justify-between gap-2 text-sm">
                    <span>{r.age_group}</span>
                    <select value={r.size} onChange={(e) => setRules((all) => (all ?? []).map((x) => (x.age_group === r.age_group ? { ...x, size: e.target.value, is_default: false } : x)))} className="rounded-lg border px-2 py-1 text-xs" style={line} aria-label={`${r.age_group} pitch size`}>
                      {SIZES.map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
                    </select>
                  </label>
                ))}
              </div>
            )}
            <button onClick={saveRules} disabled={busy !== null} className="mt-3 w-full rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-50" style={{ borderColor: 'var(--brand)', color: 'var(--brand-text)' }} data-rules-save>
              {busy === 'rules' ? '…' : 'Save the sizes'}
            </button>
            {saved && <p className="mt-2 text-xs" style={{ color: 'var(--yes)' }}>{saved}</p>}
          </section>
        </>
      )}

      {openId && layout && (
        <>
          <button onClick={() => { setOpenId(null); setLayout(null); setSelected(null) }} className="mb-2 text-sm text-ink-2">‹ All grounds</button>

          <section className="card p-3.5" data-layout>
            <div className="sect">
              <div>
                <span className="eyebrow">Layout</span>
                <h2 className="display text-lg leading-tight">{layout.name}</h2>
              </div>
              {layout.can_edit && (
                <button onClick={addPitch} disabled={busy !== null} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }} data-add-pitch>
                  + Full pitch
                </button>
              )}
            </div>
            <div
              ref={svgBox}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              style={{ touchAction: 'none' }}
              data-ground
            >
              <GroundSvg pitches={pitches} selected={selected} height={260} />
            </div>
            <p className="mt-1.5 text-xs text-ink-3">
              {pitches.length === 0 ? 'No pitches yet. Add a full pitch, then cut it up if the little ones play across it.' : layout.can_edit ? 'Tap a pitch to edit it; drag it to move it.' : 'Tap a pitch to see its hours.'}
            </p>

            {sel && (
              <div className="mt-3 rounded-xl border p-2.5" style={line} data-pitch-editor={sel.id}>
                <div className="flex items-center gap-2">
                  <input
                    defaultValue={sel.name}
                    key={sel.id}
                    onBlur={(e) => { if (e.target.value.trim() && e.target.value.trim() !== sel.name) void rename(e.target.value) }}
                    disabled={!layout.can_edit}
                    className="min-w-0 flex-1 rounded-lg border px-2 py-1 text-sm font-semibold"
                    style={line}
                    aria-label="Pitch name"
                  />
                  <span className="pill">{sel.parent_id ? sel.size : 'full'}</span>
                </div>
                {layout.can_edit && (
                  <>
                    {!sel.parent_id && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                        <span className="text-ink-2">Cut into</span>
                        <button onClick={() => split(2)} disabled={busy !== null} className="rounded-lg border px-2 py-1" style={line} data-split="2">halves</button>
                        <button onClick={() => split(3)} disabled={busy !== null} className="rounded-lg border px-2 py-1" style={line} data-split="3">thirds</button>
                        <button onClick={() => split(4)} disabled={busy !== null} className="rounded-lg border px-2 py-1" style={line} data-split="4">quarters</button>
                        {pitches.some((p) => p.parent_id === sel.id) && (
                          <button onClick={unsplit} disabled={busy !== null} className="rounded-lg border px-2 py-1" style={line}>one piece again</button>
                        )}
                      </div>
                    )}
                    <div className="mt-2 flex items-center gap-1.5 text-xs">
                      <span className="text-ink-2">Nudge</span>
                      {([['←', -2, 0], ['→', 2, 0], ['↑', 0, -2], ['↓', 0, 2]] as [string, number, number][]).map(([k, dx, dy]) => (
                        <button key={k} onClick={() => nudge(dx, dy)} disabled={busy !== null} className="h-7 w-7 rounded-lg border" style={line} aria-label={`Nudge ${k}`}>{k}</button>
                      ))}
                      <button onClick={removePitch} disabled={busy !== null} className="ml-auto text-ink-3 underline underline-offset-2" data-remove-pitch>Remove</button>
                    </div>
                  </>
                )}

                <div className="mt-3" data-hours>
                  <p className="text-xs font-semibold">Hours{sel.parent_id && hours.length === 0 ? ' (uses the full pitch’s)' : ''}</p>
                  {hours.length === 0 && <p className="text-xs text-ink-3">{sel.parent_id ? 'Set hours here only if this piece differs from the full pitch.' : 'No hours set: always open. Add the days the ground is open.'}</p>}
                  {hours.map((h, i) => (
                    <div key={i} className="mt-1 flex items-center gap-1.5 text-xs">
                      <select value={h.weekday} onChange={(e) => editHours((all) => all.map((x, k) => (k === i ? { ...x, weekday: Number(e.target.value) } : x)))} disabled={!layout.can_edit} className="rounded-lg border px-1.5 py-1" style={line} aria-label="Day">
                        {DAYS.map((d, k) => (<option key={d} value={k}>{d}</option>))}
                      </select>
                      <input type="time" value={h.opens} onChange={(e) => editHours((all) => all.map((x, k) => (k === i ? { ...x, opens: e.target.value } : x)))} disabled={!layout.can_edit} className="rounded-lg border px-1.5 py-1" style={line} aria-label="Opens" />
                      <span>–</span>
                      <input type="time" value={h.closes} onChange={(e) => editHours((all) => all.map((x, k) => (k === i ? { ...x, closes: e.target.value } : x)))} disabled={!layout.can_edit} className="rounded-lg border px-1.5 py-1" style={line} aria-label="Closes" />
                      {layout.can_edit && <button onClick={() => editHours((all) => all.filter((_, k) => k !== i))} className="text-ink-3" aria-label="Remove these hours">✕</button>}
                    </div>
                  ))}
                  {layout.can_edit && (
                    <div className="mt-2 flex gap-2 text-xs">
                      <button onClick={() => editHours((all) => [...all, { weekday: 6, opens: '08:00', closes: '12:00' }])} className="rounded-lg border px-2 py-1" style={line} data-hours-add>+ Day</button>
                      <button onClick={saveHours} disabled={busy !== null} className="rounded-lg px-2.5 py-1 font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }} data-hours-save>{busy === 'hours' ? '…' : 'Save hours'}</button>
                    </div>
                  )}
                </div>
              </div>
            )}
            {error && <p className="mt-2 text-xs" style={{ color: 'var(--no)' }}>{error}</p>}
            {saved && <p className="mt-2 text-xs" style={{ color: 'var(--yes)' }}>{saved}</p>}
          </section>

          {layout.can_edit && (
            <section className="card mt-4 p-3.5" data-venue-details>
              <h2 className="eyebrow pb-1.5">The ground</h2>
              <label className="block text-xs text-ink-2">Name<input value={details.name} onChange={(e) => setDetails({ ...details, name: e.target.value })} className={input} style={line} /></label>
              <label className="mt-2 block text-xs text-ink-2">Address<input value={details.address} onChange={(e) => setDetails({ ...details, address: e.target.value })} className={input} style={line} /></label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="block text-xs text-ink-2">Map pin · latitude<input value={details.lat} onChange={(e) => setDetails({ ...details, lat: e.target.value })} inputMode="decimal" placeholder="-33.79" className={input} style={line} /></label>
                <label className="block text-xs text-ink-2">longitude<input value={details.lng} onChange={(e) => setDetails({ ...details, lng: e.target.value })} inputMode="decimal" placeholder="151.12" className={input} style={line} /></label>
              </div>
              <p className="mt-1 text-[11px] text-ink-3">Directions use the pin when it is set, else the address.</p>
              <label className="mt-2 block text-xs text-ink-2">Parking<input value={details.parking} onChange={(e) => setDetails({ ...details, parking: e.target.value })} placeholder="Street, and the school car park on Saturdays" className={input} style={line} /></label>
              <label className="mt-2 block text-xs text-ink-2">Toilets<input value={details.toilets} onChange={(e) => setDetails({ ...details, toilets: e.target.value })} placeholder="By the canteen" className={input} style={line} /></label>
              <label className="mt-2 block text-xs text-ink-2">Canteen<input value={details.canteen} onChange={(e) => setDetails({ ...details, canteen: e.target.value })} placeholder="Saturdays from 8" className={input} style={line} /></label>
              <label className="mt-2 block text-xs text-ink-2">Notes<textarea value={details.notes} onChange={(e) => setDetails({ ...details, notes: e.target.value })} rows={2} className={input} style={line} /></label>
              <div className="mt-3 flex gap-2">
                <button onClick={saveDetails} disabled={busy !== null || !details.name.trim()} className="flex-1 rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }} data-venue-save>
                  {busy === 'details' ? '…' : 'Save the ground'}
                </button>
                <button onClick={removeVenue} disabled={busy !== null} className="rounded-xl border px-3 py-2 text-sm text-ink-3" style={line}>Remove</button>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
