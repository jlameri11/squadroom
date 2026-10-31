import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/supabase/server'
import { AppShellPage } from '@/components/shell-page'
import { ReportForm } from './report-form'

/**
 * W-03: report a concern about an adult's conduct. Any member of the club;
 * read only by the club's safeguarding officers. Thin.
 */
export default async function ReportConcernPage() {
  const userId = await getUserId()
  if (!userId) redirect('/signin?next=/settings/report')
  return (
    <AppShellPage title="Report a concern" meta="Seen only by the club's safeguarding officers" back="/settings">
      <ReportForm />
    </AppShellPage>
  )
}
