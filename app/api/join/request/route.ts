import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { isAdult, isPlausibleDob } from '@/lib/age-group'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateSecret, hashSecret, toE164, joinLinkFilter } from '@/lib/join'
import { checkEmail } from '@/lib/email'

/**
 * Hashed, never stored raw. This is a spam control, not a record of who
 * looked at a football club.
 */
function clientIpHash(request: Request): string {
  const fwd = request.headers.get('x-nf-client-connection-ip')
    ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? 'unknown'
  return createHash('sha256').update(fwd).digest('hex')
}

/**
 * A parent taps the coach's link and says who they are.
 *
 * Runs with the service role because there is no user yet — that is the whole
 * point of the flow. Nothing here grants access: it creates a pending request
 * that a coach still has to approve.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Bad request' }, { status: 400 })

  const { token, fullName, phone, children, email, news, dob, wantedRole, wantedNote, wantedTeams } = body as {
    token?: string
    fullName?: string
    phone?: string
    /** 0256: the role they would like, filed for the committee on approval. */
    wantedRole?: string
    wantedNote?: string
    /** 0256: the squads for a coach's, a manager's or a volunteer's role. */
    wantedTeams?: string[]
    /**
     * The family's children: names, or (0248) names with dates of birth so
     * approval can find each child already on the roster. Older clients
     * still send plain names.
     */
    children?: (string | { name?: string; dob?: string | null })[]
    /** 0239: an adult team's link — the person's own date of birth. */
    dob?: string
    email?: string
    news?: boolean
  }

  if (!token || !fullName?.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }

  // One shape for the children, whichever the client sent. A birthday that
  // cannot be a birthday is refused here, with the child's name, rather
  // than matched against nothing at approval.
  const kids: { name: string; dob: string | null }[] = []
  for (const c of children ?? []) {
    const name = (typeof c === 'string' ? c : c?.name ?? '').trim()
    if (!name) continue
    const kidDob = typeof c === 'string' ? null : (c?.dob ?? null) || null
    if (kidDob && !isPlausibleDob(kidDob)) {
      return NextResponse.json({ error: `${name}'s date of birth doesn't look right.` }, { status: 400 })
    }
    kids.push({ name, dob: kidDob })
  }

  // Every account has an email (Joey, 5 Nov 2026): no joining without one.
  const mail = checkEmail(email)
  if (!mail.ok) return NextResponse.json({ error: mail.error }, { status: 400 })

  const e164 = phone ? toE164(phone) : null
  if (phone && !e164) {
    return NextResponse.json(
      { error: "That doesn't look like an Australian mobile number." },
      { status: 400 }
    )
  }

  const admin = createAdminClient()

  // Token or typed code — resolved the same way the join page resolved it.
  const { column, value } = joinLinkFilter(token)

  const { data: link } = await admin
    .from('join_links')
    .select('id, academy_id, team_id, role, max_uses, use_count, expires_at, revoked_at')
    .eq(column, value)
    .maybeSingle()

  // One message for every failure. Distinguishing "revoked" from "never
  // existed" tells someone probing which tokens are real.
  const linkDead =
    !link ||
    link.revoked_at !== null ||
    new Date(link.expires_at) < new Date() ||
    (link.max_uses !== null && link.use_count >= link.max_uses)

  if (linkDead) {
    return NextResponse.json(
      { error: 'This invite link is no longer active. Ask your coach for a new one.' },
      { status: 404 }
    )
  }

  // Approval already stops spam getting IN. This stops it burying the queue,
  // which matters just as much: a queue nobody can face is a queue nobody
  // reads, and the one real request in it gets missed.
  const { data: throttled } = await admin.rpc('check_join_rate', {
    p_ip_hash: clientIpHash(request),
    p_link: link.id,
  })

  if (throttled) {
    return NextResponse.json(
      { error: 'Too many requests just now. Try again shortly.' },
      { status: 429 }
    )
  }

  const secret = generateSecret()

  // 0239: a players' link is an adult's own door. Under 18 join through a
  // parent, as before; the date of birth is kept for the player record.
  if (link.role === 'player') {
    if (!dob || !isPlausibleDob(dob)) {
      return NextResponse.json({ error: 'Your date of birth, please.' }, { status: 400 })
    }
    if (!isAdult(dob)) {
      return NextResponse.json({ error: 'Players under 18 join through a parent — ask your coach for the family link.' }, { status: 400 })
    }
  }

  // 0256: the role they would like. Any of the nine; a squad's role names
  // its squads, which must be this club's.
  const KINDS = ['coach', 'team_manager', 'volunteer', 'referee', 'president', 'secretary', 'registrar', 'treasurer', 'welfare_officer'] as const
  type Kind = (typeof KINDS)[number]
  const wanted: Kind | null = (KINDS as readonly string[]).includes(wantedRole ?? '') ? (wantedRole as Kind) : null
  let wantedTeamIds: string[] = []
  if (wanted && ['coach', 'team_manager', 'volunteer'].includes(wanted)) {
    const asked = Array.isArray(wantedTeams) ? wantedTeams.filter((t) => typeof t === 'string').slice(0, 12) : []
    if (asked.length > 0) {
      const { data: theirs } = await admin.from('teams').select('id').eq('academy_id', link.academy_id).eq('status', 'active').in('id', asked)
      wantedTeamIds = (theirs ?? []).map((t) => t.id)
      if (wantedTeamIds.length !== asked.length) {
        return NextResponse.json({ error: 'One of those squads is not this club’s.' }, { status: 400 })
      }
    } else if (link.team_id) {
      wantedTeamIds = [link.team_id]
    }
    if (wantedTeamIds.length === 0 && wanted !== 'volunteer') {
      return NextResponse.json({ error: 'Say which squad you would like to coach or manage.' }, { status: 400 })
    }
  }

  const row = {
    academy_id: link.academy_id,
    team_id: link.team_id,
    join_link_id: link.id,
    full_name: fullName.trim(),
    phone: e164,
    children_names: link.role === 'player' ? [] : kids.map((k) => k.name),
    children: link.role === 'player' ? [] : kids,
    dob: link.role === 'player' ? dob : null,
    secret_hash: hashSecret(secret),
    wanted_role: wanted,
    wanted_note: wanted && wantedNote?.trim() ? wantedNote.trim().slice(0, 500) : null,
    wanted_team_ids: wantedTeamIds,
  }
  // The email and the news opt-in (unticked unless ticked, with its time)
  // ride on the request until approval copies them to the account (0214).
  let { data: created, error } = await admin
    .from('join_requests')
    .insert({ ...row, email: mail.email, news_opt_in_at: news === true ? new Date().toISOString() : null })
    .select('id')
    .single()
  // Before 0214 the columns are not there; the request still goes, and the
  // email is asked for again on the first open after it lands.
  if (error && /column|schema cache/i.test(error.message)) {
    ;({ data: created, error } = await admin.from('join_requests').insert(row).select('id').single())
  }

  if (error || !created) {
    return NextResponse.json({ error: 'Could not send your request.' }, { status: 500 })
  }

  // The secret goes to the browser and nowhere else. The database has only
  // its hash, so a database leak cannot mint anyone a session.
  return NextResponse.json({ requestId: created.id, secret })
}
