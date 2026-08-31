import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

/**
 * The front door.
 *
 * Signed out → sign in. Signed in but belonging to nothing → found one.
 * Otherwise, the organisations you are part of.
 */
export default async function Home() {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) redirect('/signin')

  // RLS returns only academies this person is a member of, so no filter here.
  const { data: academies } = await supabase
    .from('academies')
    .select('id, name, slug, type, primary_colour')
    .order('name')

  if (!academies || academies.length === 0) redirect('/start')

  return (
    <main className="mx-auto max-w-md p-5">
      <h1 className="text-2xl font-semibold" style={{ color: '#202842' }}>
        Your organisations
      </h1>

      <ul className="mt-5 flex flex-col gap-3">
        {academies.map((a) => (
          <li key={a.id}>
            <div className="flex items-center gap-3 rounded-xl border border-neutral-200 p-4">
              <span
                className="grid h-10 w-10 flex-none place-items-center rounded-lg text-sm font-bold text-white"
                style={{ background: a.primary_colour }}
              >
                {a.name.slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{a.name}</div>
                <div className="text-sm capitalize text-neutral-500">{a.type}</div>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-6 flex flex-col gap-2 text-sm">
        <Link href="/chat" className="underline underline-offset-4">
          Chat
        </Link>
        <Link href="/admin/requests" className="underline underline-offset-4">
          Join requests
        </Link>
        <Link href="/admin/members" className="underline underline-offset-4">
          Members and who invited them
        </Link>
        <Link href="/start" className="underline underline-offset-4">
          Create another organisation
        </Link>
      </div>
    </main>
  )
}
