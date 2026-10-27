'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export const SHIRT_SIZES = [
  '4', '6', '8', '10', '12', '14', '16',
  'YXS', 'YS', 'YM', 'YL',
  'S', 'M', 'L', 'XL', '2XL', '3XL',
] as const

export const SOCK_SIZES = ['K9-12', 'K13-3', '2-7', '7-11', '11-14'] as const

export type Sizes = {
  shirt_size: string | null
  shorts_size: string | null
  socks_size: string | null
}

/**
 * What size this child takes.
 *
 * On the roster rather than behind a player screen, because there is no
 * player screen — and without somewhere to type a size, a club whose roster
 * was imported last season could never produce a kit list. The feature would
 * only work for families who registered after the day it shipped.
 *
 * Both lists come from the database's own enums, and the shortcut of letting
 * somebody type a size is the one thing this must not do: the value of
 * recording a size is the count on a purchase order, and "10" next to
 * "Size 10" is two sizes to a database and one to a human.
 */
export function KitSizes({ playerId, sizes }: { playerId: string; sizes: Sizes }) {
  const [open, setOpen] = useState(false)
  const [shirt, setShirt] = useState(sizes.shirt_size ?? '')
  const [shorts, setShorts] = useState(sizes.shorts_size ?? '')
  const [socks, setSocks] = useState(sizes.socks_size ?? '')
  const [saved, setSaved] = useState<Sizes>(sizes)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    setError(null)
    const { error } = await createClient().rpc('set_kit_sizes', {
      p_player: playerId,
      // Blank means CLEAR, not "leave alone". A size typed into the wrong row
      // is worse than a blank: a blank is a question a club asks a family,
      // and a wrong size is a shirt discovered not to fit on the morning.
      p_shirt: (shirt || undefined) as never,
      p_shorts: (shorts || undefined) as never,
      p_socks: (socks || undefined) as never,
    })
    setBusy(false)
    if (error) return setError(error.message)
    setSaved({ shirt_size: shirt || null, shorts_size: shorts || null, socks_size: socks || null })
    setOpen(false)
  }

  const summary = [saved.shirt_size, saved.shorts_size, saved.socks_size].filter(Boolean)

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-0.5 text-xs underline underline-offset-2"
        style={{ color: summary.length === 0 ? 'var(--maybe)' : 'var(--ink-3)' }}
      >
        {summary.length === 0
          ? 'No kit sizes'
          : `Kit ${summary.join(' · ')}`}
      </button>
    )
  }

  return (
    <div className="mt-2 rounded-lg border p-2.5" style={{ borderColor: 'var(--line)' }}>
      <Row label="Shirt" value={shirt} onChange={setShirt} options={SHIRT_SIZES} />
      <Row label="Shorts" value={shorts} onChange={setShorts} options={SHIRT_SIZES} />
      {/* Their own list: junior football socks are sold by shoe size, and a
          sock field offering S/M/L forces a club to invent a mapping and then
          remember it. */}
      <Row label="Socks" value={socks} onChange={setSocks} options={SOCK_SIZES} />

      {error && (
        <p className="mt-1.5 text-xs" style={{ color: 'var(--no)' }}>
          {error}
        </p>
      )}

      <div className="mt-2 flex gap-2">
        <button
          onClick={save}
          disabled={busy}
          className="flex-1 rounded-lg px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
          style={{ background: 'var(--brand)' }}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={() => {
            setShirt(saved.shirt_size ?? '')
            setShorts(saved.shorts_size ?? '')
            setSocks(saved.socks_size ?? '')
            setOpen(false)
          }}
          className="rounded-lg border px-3 py-2 text-xs"
          style={{ borderColor: 'var(--line)' }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function Row({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: readonly string[]
}) {
  return (
    <label className="mt-1 flex items-center gap-2 text-xs">
      <span className="w-12 flex-none text-ink-2">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 rounded-lg border px-2 py-1.5 text-sm"
        style={{ borderColor: 'var(--line)' }}
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  )
}
