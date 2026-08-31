import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ChannelList } from './channel-list'

export default async function ChatPage() {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) redirect('/signin')

  const { data: academies } = await supabase.from('academies').select('id, name').order('name')
  const academy = academies?.[0]
  if (!academy) redirect('/start')

  const { data: channels } = await supabase.rpc('my_channels', { p_academy: academy.id })

  return (
    <main className="mx-auto max-w-md">
      <header className="border-b border-neutral-200 p-5">
        <h1 className="text-2xl font-semibold" style={{ color: '#202842' }}>Chats</h1>
        <p className="mt-0.5 text-sm text-neutral-500">{academy.name}</p>
      </header>
      <ChannelList channels={channels ?? []} />
    </main>
  )
}
