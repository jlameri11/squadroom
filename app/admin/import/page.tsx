import { redirect } from 'next/navigation'
import { createClient, getUserId } from '@/lib/supabase/server'
import { ImportClient } from './import-client'

export default async function ImportPage() {
  const supabase = await createClient()
  const userId = await getUserId()
  if (!userId) redirect('/signin')

  const { data: academies } = await supabase
    .from('academies')
    .select('id, name, timezone')
    .order('name')
  const academy = academies?.[0]
  if (!academy) redirect('/start')

  const { data: teams } = await supabase
    .from('teams')
    .select('id, name')
    .eq('academy_id', academy.id)
    .eq('status', 'active')
    .order('name')

  return (
    <ImportClient
      academyId={academy.id}
      academyName={academy.name}
      timezone={academy.timezone}
      teams={teams ?? []}
    />
  )
}
