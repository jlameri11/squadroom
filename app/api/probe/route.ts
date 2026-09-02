import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * How long is one database round trip from the Netlify function?
 *
 * The answer decides the optimisation strategy: at 30ms, chase query plans;
 * at 250ms, the only thing that matters is making fewer requests. Guessing
 * wrong means optimising the wrong layer for a day.
 */
export async function GET() {
  const admin = createAdminClient()
  const timings: number[] = []
  for (let i = 0; i < 3; i++) {
    const t = Date.now()
    await admin.from('academies').select('id').limit(1)
    timings.push(Date.now() - t)
  }
  return NextResponse.json({ roundTripMs: timings, region: process.env.AWS_REGION ?? 'unknown' })
}
