import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { secretMatches } from '@/lib/join'

const BUCKET = 'player-photos'
const MAX_BYTES = 2 * 1024 * 1024

/**
 * The registration photo (gap 2; 0263). The family has no account yet, so
 * the form — which has already resized and cropped the picture in the
 * browser — sends it here with the request's secret, and the service role
 * puts it in the private bucket under <academy>/pending/<request>.jpg,
 * where only the club's coaches and Registrar can see it. Approval moves it
 * to the player's own folder; a decline removes it. Nothing here grants
 * anything, and the photo is never public.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const { requestId, secret, image } = (body ?? {}) as { requestId?: string; secret?: string; image?: string }
  if (!requestId || !secret || !image) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(image)
  if (!m) return NextResponse.json({ error: 'The photo must be a JPEG, PNG or WebP.' }, { status: 400 })
  const bytes = Buffer.from(m[2], 'base64')
  if (bytes.length < 64) return NextResponse.json({ error: 'That photo is empty.' }, { status: 400 })
  if (bytes.length > MAX_BYTES) return NextResponse.json({ error: 'That photo is too big — the form should have resized it.' }, { status: 413 })

  const admin = createAdminClient()
  const { data: req } = await admin.from('registration_requests').select('id, academy_id, status, secret_hash, photo_path').eq('id', requestId).maybeSingle()
  if (!req || !secretMatches(secret, req.secret_hash)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (req.status !== 'pending') return NextResponse.json({ error: `This registration is ${req.status}.` }, { status: 409 })

  const ext = m[1] === 'image/png' ? 'png' : m[1] === 'image/webp' ? 'webp' : 'jpg'
  const path = `${req.academy_id}/pending/${req.id}.${ext}`
  const { error: upErr } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: m[1], upsert: true })
  if (upErr) return NextResponse.json({ error: `Could not keep the photo: ${upErr.message}` }, { status: 500 })
  if (req.photo_path && req.photo_path !== path) await admin.storage.from(BUCKET).remove([req.photo_path])
  await admin.from('registration_requests').update({ photo_path: path }).eq('id', req.id)
  return NextResponse.json({ ok: true, path })
}
