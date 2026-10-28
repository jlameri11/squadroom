import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Erasing yourself, including the login.
 *
 * Two halves, in this order, and the order is the point. `erase_me()` runs as
 * the person and does all the redaction; only then does the admin client
 * remove the auth user, which needs the service role.
 *
 * IF THE SECOND HALF FAILS THE FIRST HALF STILL HAPPENED, which is the right
 * way round: a person whose data is gone but whose login still works can sign
 * in to an empty account and ask again. The reverse — a deleted login over
 * data that is still there — leaves somebody with no way to see or chase what
 * is held about them, which is the one outcome a privacy obligation cannot
 * tolerate.
 *
 * The manifest comes back to the browser so it can be shown and saved. It is
 * the only record the person gets, because after this there is no account to
 * log into and read it from.
 */
export async function POST() {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const userId = auth.user.id

  // Every rule, every retention decision and every notification is in here.
  // The route adds nothing to it but the login deletion.
  const { data: manifest, error } = await supabase.rpc('erase_me')
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const admin = createAdminClient()
  const { error: authErr } = await admin.auth.admin.deleteUser(userId)

  // Reported, not hidden, and not fatal. The data is already gone; a login
  // that outlives it is a loose end for us to close, not a failure to put in
  // front of somebody who has just asked to be forgotten.
  if (authErr) {
    console.error('[erase] data erased but the login remains', userId, authErr.message)
    return NextResponse.json({ manifest, loginRemains: true })
  }

  return NextResponse.json({ manifest })
}
