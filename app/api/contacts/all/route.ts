import { NextResponse } from 'next/server'
import { createClient, getUserId } from '@/lib/supabase/server'
import { vcard, safeFilename } from '@/lib/contacts/vcard'

/**
 * The whole directory, as one .vcf the phone will take.
 *
 * A coach saving twenty families one tap at a time does it for three and then
 * stops, and spends the season asking the group chat for numbers.
 *
 * THIS IS THE OPPOSITE DIRECTION FROM THE ONE CLAUDE.md FORBIDS, and the
 * distinction is worth being precise about because the words are similar.
 * What must never exist is a bulk upload of somebody's address book INTO
 * Squadroom: a coach's phone holds people with no relationship to the academy,
 * and putting them on our servers is a Privacy Act problem. This sends what
 * the club already holds OUT to the person who can already see it on screen.
 *
 * It contains exactly what the directory shows this caller and nothing more.
 * The numbers come back through `member_directory`, which is the same
 * function that decided whether to show each one — so a parent at an academy
 * with `directory_visibility = staff_only` gets cards with names, squads and
 * no numbers, and a coach gets the numbers. There is no second rule here to
 * drift from the first.
 */
export async function GET(request: Request) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const url = new URL(request.url)
  const academyId = url.searchParams.get('academy')

  const supabase = await createClient()

  // RLS decides which of these come back, so a passed-in id can only ever
  // narrow to something this person is already a member of.
  const { data: academies } = await supabase
    .from('academies')
    .select('id, name')
    .order('name')

  const chosen = academyId
    ? (academies ?? []).filter((a) => a.id === academyId)
    : (academies ?? [])

  if (chosen.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const cards = []
  let academyName = 'Squadroom'

  for (const academy of chosen) {
    const { data: people } = await supabase.rpc('member_directory', { p_academy: academy.id })
    if (!people || people.length === 0) continue
    academyName = academy.name

    for (const person of people) {
      // Themselves. Nobody needs their own card, and a phone that imports it
      // creates a duplicate of the owner's own contact.
      if (person.profile_id === userId) continue

      cards.push(
        vcard({
          name: person.full_name ?? 'Squadroom contact',
          phone: person.phone,
          role: person.role,
          teams: person.teams ?? [],
          academy: academy.name,
        })
      )
    }
  }

  if (cards.length === 0) {
    return NextResponse.json({ error: 'Nobody to save' }, { status: 404 })
  }

  // Concatenated, which is how a multi-contact .vcf is expressed — one card
  // after another in one file, exactly as a phone's own export does it.
  return new NextResponse(cards.join(''), {
    headers: {
      'content-type': 'text/vcard; charset=utf-8',
      'content-disposition': `attachment; filename="${safeFilename(academyName)} contacts.vcf"`,
      // Contact details change, and this is a list of families. Never let it
      // sit in a CDN.
      'cache-control': 'no-store',
      // Useful to the screen, which says how many are in the file before
      // somebody opens it.
      'x-contact-count': String(cards.length),
    },
  })
}
