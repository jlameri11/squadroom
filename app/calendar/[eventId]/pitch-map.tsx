'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export type LayoutPitch = { id: string; parent_id: string | null; name: string; size: string; x: number; y: number; w: number; h: number; hours?: { weekday: number; opens: string; closes: string }[] }
export type Layout = {
  id: string
  name: string
  address: string | null
  notes: string | null
  lat: number | null
  lng: number | null
  amenities: { parking?: string; toilets?: string; canteen?: string }
  pitches: LayoutPitch[]
  can_edit?: boolean
  pitch_id?: string | null
  field_label?: string | null
}

/**
 * The ground, drawn, with one pitch marked. Used on a game's page for the
 * family (the pitch they are looking for) and, without a mark, as the
 * picture in the venue editor. Plain SVG on a 100 × 100 canvas: no map
 * tiles, nothing fetched, nothing that needs a key.
 */
export function GroundSvg({ pitches, highlight, selected, onSelect, height = 180 }: {
  pitches: LayoutPitch[]
  highlight?: string | null
  selected?: string | null
  onSelect?: (id: string) => void
  height?: number
}) {
  const full = pitches.filter((p) => !p.parent_id)
  const subs = pitches.filter((p) => p.parent_id)
  const rect = (p: LayoutPitch, isSub: boolean) => {
    const hot = p.id === highlight
    const sel = p.id === selected
    return (
      <g key={p.id} onClick={onSelect ? () => onSelect(p.id) : undefined} style={{ cursor: onSelect ? 'pointer' : undefined }} data-pitch={p.id}>
        <rect
          x={p.x} y={p.y} width={p.w} height={p.h} rx={isSub ? 0.6 : 1.2}
          fill={hot ? 'var(--brand)' : isSub ? 'var(--pitch-sub)' : 'var(--pitch)'}
          stroke={sel ? 'var(--brand)' : hot ? 'var(--brand)' : 'var(--pitch-line)'}
          strokeWidth={sel ? 1.2 : 0.5}
          strokeDasharray={isSub ? '1.5 1' : undefined}
          vectorEffect="non-scaling-stroke"
        />
        <text
          x={p.x + p.w / 2} y={p.y + p.h / 2} textAnchor="middle" dominantBaseline="middle"
          fontSize={isSub ? 3.4 : 4} fontWeight={600} fill={hot ? 'var(--brand-ink)' : 'var(--pitch-ink)'}
          style={{ pointerEvents: 'none' }}
        >
          {p.name}
        </text>
      </g>
    )
  }
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" className="block w-full rounded-xl" style={{ height, background: 'var(--pitch-ground)' }} role="img" aria-label="Ground layout">
      {full.map((p) => rect(p, false))}
      {subs.map((p) => rect(p, true))}
    </svg>
  )
}

/** The family's view: where to go, and how to get there. */
export function PitchMap({ fixtureId }: { fixtureId: string }) {
  const [layout, setLayout] = useState<Layout | null | undefined>(undefined)

  useEffect(() => {
    let live = true
    ;(async () => {
      const { data, error } = await createClient().rpc('fixture_pitch', { p_fixture: fixtureId })
      if (live) setLayout(error ? null : ((data as unknown as Layout | null) ?? null))
    })()
    return () => {
      live = false
    }
  }, [fixtureId])

  if (!layout || layout.pitches.length === 0) return null
  const pitch = layout.pitches.find((p) => p.id === layout.pitch_id)
  const dest = layout.lat != null && layout.lng != null ? `${layout.lat},${layout.lng}` : layout.address ?? layout.name
  const a = layout.amenities ?? {}
  return (
    <section className="card mt-4 p-3" data-pitch-map>
      <div className="sect">
        <div>
          <span className="eyebrow">Where to go</span>
          <p className="text-sm font-semibold">{pitch ? `${pitch.name} at ${layout.name}` : layout.name}</p>
        </div>
        <a
          href={`https://maps.google.com/?q=${encodeURIComponent(dest)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-brand-ink"
          style={{ background: 'var(--brand)' }}
          data-directions
        >
          Directions
        </a>
      </div>
      <GroundSvg pitches={layout.pitches} highlight={layout.pitch_id ?? null} height={160} />
      {(a.parking || a.toilets || a.canteen || layout.notes) && (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          {a.parking && (<><dt className="text-ink-3">Parking</dt><dd>{a.parking}</dd></>)}
          {a.toilets && (<><dt className="text-ink-3">Toilets</dt><dd>{a.toilets}</dd></>)}
          {a.canteen && (<><dt className="text-ink-3">Canteen</dt><dd>{a.canteen}</dd></>)}
          {layout.notes && (<><dt className="text-ink-3">Notes</dt><dd>{layout.notes}</dd></>)}
        </dl>
      )}
    </section>
  )
}
