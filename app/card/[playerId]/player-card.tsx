'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ScreenSkeleton } from '@/components/screen-skeleton'

type Card = {
  id: string
  full_name: string
  preferred_name: string | null
  dob: string | null
  photo_path: string | null
  ff_number: string | null
  official_status: 'unknown' | 'pending' | 'registered' | 'not_required'
  squad: { name: string; season: string | null; age_group: string | null } | null
  number: number | null
  club: { name: string; colour: string; logo_url: string | null; slug: string } | null
  can_edit: boolean
}

const BUCKET = 'player-photos'

/**
 * The card, and the one thing a family can change on it: the photo.
 *
 * Everything else is the club's — name, date of birth, squad, number — so
 * a card cannot be edited into saying something the roster does not. The
 * photo is downscaled in the browser before upload: a 12-megapixel phone
 * photo is 4 MB nobody needs, and a 600px square is what a card shows.
 */
export function PlayerCard({ playerId }: { playerId: string }) {
  const [card, setCard] = useState<Card | null | undefined>(undefined)
  const [photo, setPhoto] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data, error } = await supabase.rpc('player_card', { p_player: playerId })
    if (error) {
      setCard(null)
      return setError(error.code === '42501' ? 'That card is not yours to see.' : error.message)
    }
    const c = data as unknown as Card
    setCard(c)
    if (c.photo_path) {
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(c.photo_path, 600)
      setPhoto(signed?.signedUrl ?? null)
    } else {
      setPhoto(null)
    }
  }, [playerId])

  useEffect(() => {
    ;(async () => {
      await load()
    })()
  }, [load])

  async function choose(file: File) {
    if (!card) return
    setBusy(true)
    setError(null)
    try {
      const blob = await squareJpeg(file, 600)
      const path = `${await academyOf(card)}/${card.id}/photo-${Date.now()}.jpg`
      const supabase = createClient()
      const { error: up } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false })
      if (up) throw new Error(up.message)
      const { error: set } = await supabase.rpc('set_player_photo', { p_player: card.id, p_path: path })
      if (set) throw new Error(set.message)
      // The old file is not needed once the row points at the new one.
      if (card.photo_path) await supabase.storage.from(BUCKET).remove([card.photo_path])
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the photo.')
    } finally {
      setBusy(false)
    }
  }

  if (card === undefined) return <ScreenSkeleton />
  if (card === null) return <p className="card m-4 p-6 text-center text-sm text-ink-2">{error ?? 'Not found.'}</p>

  const tint = card.club?.colour || 'var(--brand)'
  const born = card.dob ? new Date(card.dob + 'T00:00:00').toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
  const eligible = card.official_status === 'registered' || card.official_status === 'not_required'

  return (
    <div className="p-3.5">
      <article className="card overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3" style={{ background: tint, color: 'var(--brand-ink)' }}>
          {card.club?.logo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={card.club.logo_url} alt="" className="h-9 w-9 flex-none rounded-lg bg-white/10 object-contain p-0.5" />
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{card.club?.name}</span>
            <span className="block text-xs" style={{ color: '#ffffffb3' }}>
              {[card.squad?.name, card.squad?.season].filter(Boolean).join(' · ') || 'No squad yet'}
            </span>
          </span>
          {card.number != null && (
            <span className="display flex-none text-3xl leading-none">#{card.number}</span>
          )}
        </div>

        <div className="flex gap-4 p-4">
          <div className="flex-none">
            <div
              className="grid h-32 w-32 place-items-center overflow-hidden rounded-xl text-xs text-ink-3"
              style={{ background: 'var(--surface-2)' }}
            >
              {photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photo} alt={card.full_name} className="h-full w-full object-cover" />
              ) : (
                'No photo'
              )}
            </div>
            {card.can_edit && (
              <label className="mt-2 block text-center text-xs underline underline-offset-2" style={{ color: 'var(--brand-text)' }}>
                {busy ? 'Saving…' : photo ? 'Change photo' : 'Add a photo'}
                <input
                  type="file"
                  accept="image/*"
                  capture="user"
                  className="sr-only"
                  disabled={busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void choose(f)
                    e.target.value = ''
                  }}
                />
              </label>
            )}
          </div>

          <dl className="min-w-0 flex-1 text-sm">
            <dt className="eyebrow">Player</dt>
            <dd className="display text-xl leading-tight">{card.full_name}</dd>
            {card.preferred_name && card.preferred_name !== card.full_name && (
              <dd className="text-ink-3">“{card.preferred_name}”</dd>
            )}
            <dt className="eyebrow mt-2">Born</dt>
            <dd className="tabular-nums">{born}</dd>
            {card.ff_number && (
              <>
                <dt className="eyebrow mt-2">FFA number</dt>
                <dd className="tabular-nums">{card.ff_number}</dd>
              </>
            )}
            <dt className="eyebrow mt-2">PlayFootball</dt>
            <dd style={{ color: eligible ? 'var(--yes)' : card.official_status === 'pending' ? 'var(--maybe)' : 'var(--ink-3)' }}>
              {card.official_status === 'registered' ? 'Registered ✓' : card.official_status === 'not_required' ? 'Not needed' : card.official_status === 'pending' ? 'Pending' : 'Not checked'}
            </dd>
          </dl>
        </div>

        <p className="border-t px-4 py-2.5 text-xs text-ink-3" style={{ borderColor: 'var(--line-2)' }}>
          Shown to the referee or the other team&apos;s manager on match day. Only this family and {card.club?.name ?? 'the club'}&apos;s coaches can open it; the photo is never published.
        </p>
      </article>

      {error && (
        <p className="mt-3 rounded-lg p-2.5 text-sm" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>
          {error}
        </p>
      )}
    </div>
  )
}

/** The academy id for the storage path. On the card as the club's slug only, so ask the row. */
async function academyOf(card: Card): Promise<string> {
  const { data } = await createClient().from('players').select('academy_id').eq('id', card.id).single()
  if (!data) throw new Error('Could not find the club for this player.')
  return data.academy_id
}

/** A centred square JPEG of the given size, made in the browser. */
async function squareJpeg(file: File, size: number): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('That file is not an image this phone can read.'))
      i.src = url
    })
    const side = Math.min(img.naturalWidth, img.naturalHeight)
    const sx = (img.naturalWidth - side) / 2
    const sy = (img.naturalHeight - side) / 2
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    canvas.getContext('2d')!.drawImage(img, sx, sy, side, side, 0, 0, size, size)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make the photo.'))), 'image/jpeg', 0.86)
    )
  } finally {
    URL.revokeObjectURL(url)
  }
}
