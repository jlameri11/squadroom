import { NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { toE164 } from '@/lib/join'

/**
 * L-16: a team asks to enter a competition from its public page. No account
 * — a club name, a team, a division and a contact. The service role writes
 * the request after the function rate-limits by IP; the organiser decides
 * from the Clubs tab, and the club then joins with the invitation it is
 * sent. Nothing about the contact is shown to anyone but the organiser.
 */
function clientIpHash(request: Request): string {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown'
  return createHash('sha256').update(ip).digest('hex').slice(0, 32)
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const { slug, clubName, teamName, division, contactName, contactPhone, contactEmail, note, captain, squadSize, payMode } = (body ?? {}) as {
    slug?: string
    clubName?: string
    teamName?: string
    division?: string
    contactName?: string
    contactPhone?: string
    contactEmail?: string
    note?: string
    /** 0261: a captain entering a team of their own — no club. */
    captain?: boolean
    squadSize?: number
    payMode?: 'split' | 'captain'
  }
  const asCaptain = captain === true
  if (!slug || (!asCaptain && !clubName?.trim()) || !teamName?.trim() || !contactName?.trim()) {
    return NextResponse.json({ error: asCaptain ? 'Please fill in the team and who to contact.' : 'Please fill in the club, the team and who to contact.' }, { status: 400 })
  }
  if (asCaptain && (!Number.isInteger(squadSize) || (squadSize as number) < 5 || (squadSize as number) > 30)) {
    return NextResponse.json({ error: 'How many players — between 5 and 30.' }, { status: 400 })
  }
  if (asCaptain && payMode !== 'split' && payMode !== 'captain') {
    return NextResponse.json({ error: 'Who pays — split between the players, or the captain.' }, { status: 400 })
  }
  if (!contactPhone?.trim() && !contactEmail?.trim()) {
    return NextResponse.json({ error: 'A phone number or an email, so the organiser can reply.' }, { status: 400 })
  }
  const phone = contactPhone?.trim() ? toE164(contactPhone) : ''
  if (contactPhone?.trim() && !phone) {
    return NextResponse.json({ error: 'That phone number does not look right.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('request_competition_entry', {
    p_slug: slug.trim().toLowerCase(),
    p_club_name: (clubName ?? '').trim().slice(0, 120),
    p_team_name: teamName.trim().slice(0, 120),
    p_division: (division ?? '').trim().slice(0, 80),
    p_contact_name: contactName.trim().slice(0, 120),
    p_contact_phone: phone || '',
    p_contact_email: (contactEmail ?? '').trim().slice(0, 200),
    p_note: (note ?? '').trim().slice(0, 1000),
    p_ip_hash: clientIpHash(request),
    p_captain: asCaptain,
    p_squad_size: (asCaptain ? squadSize : null) as unknown as number,
    p_pay_mode: (asCaptain ? payMode : null) as unknown as string,
  })
  if (error) {
    const status = error.code === '23505' ? 409 : /Too many/.test(error.message) ? 429 : 400
    return NextResponse.json({ error: error.message }, { status })
  }
  return NextResponse.json({ ok: true, id: data })
}
