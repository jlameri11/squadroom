import { notFound, redirect } from 'next/navigation'
import QRCode from 'qrcode'
import { createClient, getUserId } from '@/lib/supabase/server'
import { AppShellPage } from '@/components/shell-page'
import { siteUrl } from '@/lib/site'

/**
 * W-06: the code a manager or the league shows the referee at the ground.
 * Rendered on the server as a static SVG of a string we already have;
 * fixture_checkin_key answers only for the game's managers and the league,
 * so anyone else gets a 404 rather than a code.
 */
export default async function MatchQrPage(props: { params: Promise<{ competitionId: string; fixtureId: string }> }) {
  const { competitionId, fixtureId } = await props.params
  const userId = await getUserId()
  if (!userId) redirect(`/signin?next=/competitions/${competitionId}/match/${fixtureId}/qr`)
  const supabase = await createClient()
  const { data: key } = await supabase.rpc('fixture_checkin_key', { p_fixture: fixtureId })
  if (!key) notFound()
  const url = `${siteUrl()}/referee/checkin?f=${fixtureId}&k=${key}`
  const svg = await QRCode.toString(url, { type: 'svg', margin: 1, width: 280, color: { dark: '#101012', light: '#ffffff' } })
  return (
    <AppShellPage title="Referee check-in" meta="Show this to the referee" back={`/competitions/${competitionId}/match/${fixtureId}`}>
      <div className="p-5">
        <div className="card mx-auto w-full max-w-[300px] p-3" dangerouslySetInnerHTML={{ __html: svg }} />
        <p className="mt-4 text-center text-sm text-ink-2">
          The referee scans it with their phone&apos;s camera. It only works for the referee appointed to this game, from three hours before kick-off.
        </p>
        <p className="mt-2 break-all text-center text-xs text-ink-3">{url}</p>
      </div>
    </AppShellPage>
  )
}
