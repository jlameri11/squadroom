import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PaymentsList, type Owing } from './payments-list'

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ paid?: string; cancelled?: string }>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) redirect('/signin')

  const { data: academies } = await supabase.from('academies').select('id, name').order('name')
  const academy = academies?.[0]
  if (!academy) redirect('/start')

  const { data: owing } = await supabase.rpc('my_payment_requests', { p_academy: academy.id })

  return (
    <main className="mx-auto max-w-md">
      <header className="border-b border-neutral-200 p-5">
        <h1 className="text-2xl font-semibold" style={{ color: '#202842' }}>Payments</h1>
        <p className="mt-0.5 text-sm text-neutral-500">{academy.name}</p>
      </header>
      <PaymentsList
        owing={(owing ?? []) as Owing[]}
        justPaid={params.paid === '1'}
        cancelled={params.cancelled === '1'}
      />
    </main>
  )
}
