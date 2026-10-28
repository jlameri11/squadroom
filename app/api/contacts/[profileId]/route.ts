import { NextResponse } from 'next/server'
import { createClient, getUserId } from '@/lib/supabase/server'
import { vcard, safeFilename } from '@/lib/contacts/vcard'

/**
 * One person from the directory, as a .vcf the phone will take.
 *
 * A server route rather than a Blob built in the browser, for two reasons.
 * iOS Safari handles a real `text/vcard` response with a filename far more
 * reliably than an object URL — it offers "Add to Contacts" rather than
 * downloading a file into Files and leaving the person to find it. And it
 * re-derives what this caller may see instead of trusting whatever the screen
 * happened to be holding: the phone number comes back through
 * `member_directory`, which is the same function that decided whether to show
 * it in the first place.
 *
 * So a parent saving their coach gets the number. A parent saving another
 * parent gets a card with a name and no number, because
 * `directory_visibility` says staff only — and the card is still worth having,
 * since it carries the squad and the club.
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ profileId: string }> }
) {
  const { profileId } = await ctx.params

  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const supabase = await createClient()

  // Which academy to read them through. Somebody in two organisations gets
  // the first one they share with this person, which is also the only one
  // either of them can see the other in.
  const { data: academies } = await supabase.from('academies').select('id, name').order('name')

  for (const academy of academies ?? []) {
    const { data: people } = await supabase.rpc('member_directory', { p_academy: academy.id })
    const person = (people ?? []).find((p) => p.profile_id === profileId)
    if (!person) continue

    const card = vcard({
      name: person.full_name ?? 'Squadroom contact',
      phone: person.phone,
      role: person.role,
      teams: person.teams ?? [],
      academy: academy.name,
    })

    return new NextResponse(card, {
      headers: {
        'content-type': 'text/vcard; charset=utf-8',
        // A filename the person recognises in a share sheet.
        'content-disposition': `inline; filename="${safeFilename(person.full_name)}.vcf"`,
        // Contact details change. Never let this sit in a CDN.
        'cache-control': 'no-store',
      },
    })
  }

  // Indistinguishable from "no such person", on purpose: whether somebody is
  // in an academy you are not in is not yours to learn.
  return NextResponse.json({ error: 'Not found' }, { status: 404 })
}
