import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { cleanAnswers } from '@/lib/registration/answers'
import type { Question } from '@/components/question-field'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateSecret, hashSecret, toE164 } from '@/lib/join'

/**
 * Hashed, never stored raw. This is a spam control, not a record of who
 * looked at a football club.
 */
function clientIpHash(request: Request): string {
  const fwd =
    request.headers.get('x-nf-client-connection-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  return createHash('sha256').update(fwd).digest('hex')
}

/**
 * A family who has never heard of us registers a child.
 *
 * The most exposed surface in the product: writable by anyone on the
 * internet, with no account, no invite link and no coach who knows their
 * name. Runs with the service role because there is no user yet — that is the
 * whole point of the flow.
 *
 * NOTHING HERE GRANTS ANYTHING. It creates a pending request a human still
 * decides. No account, no membership, no channel, no roster row.
 *
 * Every rule lives in `check_registration` rather than here, so it is one
 * thing, testable without HTTP, and the route cannot drift from it. The route
 * does the two things SQL cannot: hash the caller's address, and mint a
 * secret the database only ever sees the hash of.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Bad request' }, { status: 400 })

  const {
    slug,
    programId,
    guardianName,
    guardianPhone,
    guardianEmail,
    childName,
    childDob,
    childFfa,
    childFifa,
    childGender,
    answers,
    consents,
  } = body as {
    slug?: string
    programId?: string
    guardianName?: string
    guardianPhone?: string
    guardianEmail?: string
    childName?: string
    childDob?: string
    childFfa?: string
    childFifa?: string
    childGender?: string
    answers?: Record<string, unknown>
    consents?: { id: string; version: number }[]
  }

  if (!slug || !programId || !guardianName?.trim() || !childName?.trim() || !childDob) {
    return NextResponse.json(
      { error: 'Please fill in your name, your child’s name and their date of birth.' },
      { status: 400 }
    )
  }

  // One of three values, matching the roster column this eventually feeds.
  // Anything else is refused here rather than accepted now and rejected at
  // approval, in front of a club admin who did nothing wrong.
  const GENDERS = ['male', 'female', 'other'] as const
  type Gender = (typeof GENDERS)[number]
  const gender = childGender?.trim().toLowerCase()
  if (gender && !GENDERS.includes(gender as Gender)) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }

  // A contact detail is the only way a club can come back to this family, so
  // one of the two is required — but neither is verified, and the product
  // does not pretend otherwise: coach approval is the identity gate, not an
  // OTP. See CLAUDE.md on why that is the stronger signal here.
  const e164 = guardianPhone ? toE164(guardianPhone) : null
  if (guardianPhone && !e164) {
    return NextResponse.json(
      { error: "That doesn't look like an Australian mobile number." },
      { status: 400 }
    )
  }
  if (!e164 && !guardianEmail?.trim()) {
    return NextResponse.json(
      { error: 'A mobile number or an email address, so the club can reply.' },
      { status: 400 }
    )
  }

  const admin = createAdminClient()

  // Rate limited BEFORE the eligibility check, so a program's rules cannot be
  // probed for free. The limit counts the attempt whether or not it succeeds.
  const { data: throttled } = await admin.rpc('check_registration_rate', {
    p_ip_hash: clientIpHash(request),
    p_program: programId,
  })
  if (throttled) {
    return NextResponse.json(
      { error: 'Too many registrations just now. Try again shortly.' },
      { status: 429 }
    )
  }

  // Eligibility, consents, capacity and whether the program is open at all.
  // One unhelpful message for every failure, deliberately — the differences
  // would tell somebody probing which ids are real.
  const { data: program, error: refused } = await admin.rpc('check_registration', {
    p_academy_slug: slug,
    p_program: programId,
    p_child_dob: childDob,
    p_consents: (consents ?? []) as never,
  })

  if (refused || !program) {
    return NextResponse.json(
      { error: refused?.message ?? "That isn't open for registrations." },
      { status: 400 }
    )
  }

  const { data: academy } = await admin
    .from('academies')
    .select('id')
    .eq('slug', slug.trim().toLowerCase())
    .maybeSingle()
  if (!academy) {
    return NextResponse.json({ error: "That isn't open for registrations." }, { status: 400 })
  }

  // The answers, against the questions actually asked. The form enforces
  // required questions and option lists; this is where that is true for a
  // browser that was not running the form.
  const { data: asked } = await admin
    .from('programs')
    .select('questions')
    .eq('id', program)
    .maybeSingle()
  const cleaned = cleanAnswers((asked?.questions ?? []) as unknown as Question[], answers)
  if (!cleaned.ok) {
    return NextResponse.json({ error: cleaned.error }, { status: 400 })
  }

  // R-18: PlayFootball's ids are digits. Spaces people type are dropped;
  // anything else is a typo we would rather hear about now.
  const ffa = (childFfa ?? '').replace(/\s/g, '')
  const fifa = (childFifa ?? '').replace(/\s/g, '')
  if ((ffa && !/^\d{5,20}$/.test(ffa)) || (fifa && !/^\d{5,20}$/.test(fifa))) {
    return NextResponse.json({ error: 'An FFA number or FIFA ID is digits only.' }, { status: 400 })
  }

  const secret = generateSecret()

  const { data: created, error } = await admin
    .from('registration_requests')
    .insert({
      academy_id: academy.id,
      program_id: program,
      guardian_name: guardianName.trim(),
      guardian_phone: e164,
      guardian_email: guardianEmail?.trim() || null,
      child_name: childName.trim(),
      child_dob: childDob,
      child_gender: (gender as Gender) || null,
      ffa_number: ffa || null,
      fifa_id: fifa || null,
      answers: cleaned.answers as never,
      consents: (consents ?? []) as never,
      secret_hash: hashSecret(secret),
    })
    .select('id')
    .single()

  if (error) {
    return NextResponse.json({ error: 'Could not send your registration.' }, { status: 500 })
  }

  // The id and the secret, and nothing else. It must not say whether this
  // child is already registered here — that would make an open endpoint an
  // oracle for whether a named child plays at a named club.
  return NextResponse.json({ requestId: created.id, secret })
}
